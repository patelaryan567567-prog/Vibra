import {
  enhanceLyricsWithAi,
  findAndFormatLyricsWithAi,
  hasConfiguredGeminiKeys,
} from './gemini.ts';
import type { LyricLine, LyricsResponse } from '../src/types/music.ts';

interface LrclibRecord {
  id?: number;
  trackName?: string;
  artistName?: string;
  albumName?: string;
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

interface SearchCandidate {
  title: string;
  artist: string;
}

const lyricsCache = new Map<string, { data: LyricsResponse; expiresAt: number }>();
const lyricsInFlight = new Map<string, Promise<LyricsResponse>>();

const PAREN_JUNK_RE =
  /\s*(\(|\[)\s*(official\s*(music\s*)?(video|audio|lyric\s*video|visualizer)|lyrics?|lyrical(\s*video)?|hd|4k|8k|full\s*(song|video|audio)|from\s*["'“].*?["'”]|slowed(\s*\+?\s*reverb)?|lofi|remix|live|audio|video|3d\s*audio)\s*(\)|\])/gi;
const FROM_MOVIE_PAREN_RE = /\s*(\(|\[)\s*from\s+["'“][^)"'\]]+["'”]?\s*(\)|\])/gi;
const TRAILING_LABEL_JUNK_RE =
  /\s*[-–—]?\s*\b(full\s*video\s*song|full\s*song|full\s*audio|video\s*song|lyrical\s*video|lyric\s*video|official\s*(music\s*)?(video|audio|visualizer)|audio\s*song|lyrical|song)\s*$/gi;
const PIPE_TAIL_RE = /\s*\|.*$/;
const HASHTAG_RE = /#\S+/g;
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;
const FEAT_RE = /\s*[([ ]?(?:feat\.?|ft\.?|featuring)\s+[^-|/()[\]]+[)\]]?/gi;
const LRC_LINE_RE = /\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?\]/g;
const LRC_META_TAG_RE = /^\[(ti|ar|al|au|by|length|offset|re|ve|la):[^\]]*\]$/i;
const NON_LATIN_SCRIPT_RE = /[\u0900-\u0D7F\u0600-\u06FF]/;
const SECTION_TAG_RE = /^\[(Intro|Verse|Pre-Chorus|Chorus|Post-Chorus|Bridge|Hook|Rap|Outro|Refrain)[^\]]*\]$/im;

const RECORD_LABEL_RE =
  /\b(t-series|zee music|sony music|yrf|yash raj|tips official|tips music|saregama|speed records|white hill|coke studio|desi music factory|warner music|universal music|times music|eros now|venus|junglee music|panorama music|svp music|hombale|geet mp3|jatt records|records|entertainment|films|productions|studios|official channel|music company)\b/i;

const AD_WATERMARK_LINE_RE =
  /^(\d+\s*contributors?|translations?|.*?\blyrics\b\s*$|embed$|you might also like|see .* live|get tickets as low as|lyrics powered by)/i;

function isRecordLabel(name: string): boolean {
  const n = name.trim();
  if (!n) return false;
  return RECORD_LABEL_RE.test(n);
}

function getPrimaryArtist(raw: string): string {
  return (
    raw
      .split(/,|&|\bft\.?\b|\bfeat\.?\b|\bx\b|\bwith\b|\band\b/i)[0]
      ?.trim() || raw.trim()
  );
}

function cleanTitleText(raw: string): string {
  return (raw || '')
    .replace(EMOJI_RE, ' ')
    .replace(HASHTAG_RE, ' ')
    .replace(PIPE_TAIL_RE, '')
    .replace(FROM_MOVIE_PAREN_RE, ' ')
    .replace(PAREN_JUNK_RE, ' ')
    .replace(FEAT_RE, ' ')
    .replace(TRAILING_LABEL_JUNK_RE, '')
    .replace(/\s*[-–—]\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanArtistText(raw: string): string {
  const cleaned = (raw || '')
    .replace(EMOJI_RE, ' ')
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/VEVO$/i, '')
    .replace(/\bOfficial\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (isRecordLabel(cleaned)) return '';
  return getPrimaryArtist(cleaned);
}

function buildSearchCandidates(rawTitle: string, rawArtist: string): SearchCandidate[] {
  const baseTitle = cleanTitleText(rawTitle);
  const cleanedChannelArtist = cleanArtistText(rawArtist);
  const candidates: SearchCandidate[] = [];
  const seen = new Set<string>();

  const push = (t: string, a: string) => {
    const tt = cleanTitleText(t);
    const aa = a.trim();
    if (!tt) return;
    const key = `${tt.toLowerCase()}::${aa.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      candidates.push({ title: tt, artist: aa });
    }
  };

  const dashParts = baseTitle
    .split(/\s+[-–—:]\s+/)
    .map((p) => cleanTitleText(p))
    .filter((p) => p.length >= 2);

  if (dashParts.length >= 2) {
    const left = dashParts[0];
    const right = dashParts.slice(1).join(' ').trim();
    const channelLower = cleanedChannelArtist.toLowerCase();

    // Case A: "Artist - Song Title" (e.g., "Arijit Singh - Tum Hi Ho")
    if (
      cleanedChannelArtist &&
      (left.toLowerCase().includes(channelLower) || channelLower.includes(left.toLowerCase()))
    ) {
      push(right, left);
      push(right, cleanedChannelArtist);
    }

    // Case B: "Song Title - Movie/Album" or "Song Title - Artist"
    // Prefer right as artist ONLY if we have no artist; also always keep left as pure song title!
    if (!cleanedChannelArtist) {
      push(right, left);
      push(left, right);
    }
    push(left, cleanedChannelArtist);
    push(right, cleanedChannelArtist);
  }

  push(baseTitle, cleanedChannelArtist);
  if (cleanedChannelArtist) {
    push(baseTitle, '');
  }

  return candidates;
}

function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

function hasTitleMatch(candidateTitle: string | undefined, expectedTitle: string): boolean {
  if (!candidateTitle) return false;
  const candWords = normalizeWords(candidateTitle);
  const expWords = normalizeWords(expectedTitle);
  if (candWords.length === 0 || expWords.length === 0) return true;

  const candJoined = candWords.join(' ');
  const expJoined = expWords.join(' ');
  if (candJoined.includes(expJoined) || expJoined.includes(candJoined)) return true;

  const candSet = new Set(candWords);
  let overlap = 0;
  for (const w of expWords) {
    if (candSet.has(w)) overlap++;
  }
  return overlap / Math.min(expWords.length, candWords.length) >= 0.5;
}

function cleanPlainLyricsText(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleanedLines = raw
    .split(/\r?\n/)
    .map((line) => line.replace(LRC_LINE_RE, '').trimEnd())
    .filter((line) => {
      const trimmed = line.trim();
      if (LRC_META_TAG_RE.test(trimmed)) return false;
      if (AD_WATERMARK_LINE_RE.test(trimmed)) return false;
      return true;
    });

  const normalized = cleanedLines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return normalized || null;
}

function polishLinePunctuation(line: string): string {
  const trimmed = line.trim();
  if (!trimmed) return '';
  if (/^\[[^\]]+\]$/.test(trimmed)) return trimmed;
  // Capitalize first letter if lowercase Latin, and standalone lowercase "i"
  const fixedI = trimmed.replace(/\bi\b/g, 'I').replace(/\bi'([a-z]+)\b/g, "I'$1");
  return fixedI.charAt(0).toUpperCase() + fixedI.slice(1);
}

/**
 * Deterministic 0ms local stanza & chorus formatter for plain lyrics.
 * Organizes wall-of-text lyrics into crisp readable verses & choruses without using Gemini quota.
 */
export function formatPlainLyricsLocally(text: string): string {
  const rawLines = text
    .split(/\r?\n/)
    .map((l) => polishLinePunctuation(l))
    .filter((l, idx, arr) => {
      // Collapse consecutive duplicate blank lines
      if (l === '' && arr[idx - 1]?.trim() === '') return false;
      return true;
    });

  const nonEmpty = rawLines.filter(Boolean);
  if (nonEmpty.length < 4) return rawLines.join('\n').trim();
  if (SECTION_TAG_RE.test(text)) {
    return rawLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  // Group into natural stanzas if blank lines already exist, or split every 4 lines for walls of text
  const hasBlankBreaks = rawLines.filter((l) => l === '').length >= 2;
  const stanzas: string[][] = [];
  if (hasBlankBreaks) {
    let cur: string[] = [];
    for (const l of rawLines) {
      if (l === '') {
        if (cur.length > 0) {
          stanzas.push(cur);
          cur = [];
        }
      } else {
        cur.push(l);
      }
    }
    if (cur.length > 0) stanzas.push(cur);
  } else {
    for (let i = 0; i < nonEmpty.length; i += 4) {
      stanzas.push(nonEmpty.slice(i, i + 4));
    }
  }

  // Detect repeated stanzas -> label as [Chorus], otherwise [Verse N] / [Outro]
  const stanzaFreq = new Map<string, number>();
  for (const st of stanzas) {
    const sig = st.slice(0, 2).join(' ').toLowerCase();
    stanzaFreq.set(sig, (stanzaFreq.get(sig) ?? 0) + 1);
  }

  let verseNum = 1;
  const formattedBlocks = stanzas.map((st, idx) => {
    const sig = st.slice(0, 2).join(' ').toLowerCase();
    const repeats = (stanzaFreq.get(sig) ?? 0) >= 2;
    let header: string;
    if (repeats) {
      header = '[Chorus]';
    } else if (idx === stanzas.length - 1 && stanzas.length >= 4 && st.length <= 3) {
      header = '[Outro]';
    } else {
      header = `[Verse ${verseNum++}]`;
    }
    return `${header}\n${st.join('\n')}`;
  });

  return formattedBlocks.join('\n\n').trim();
}

export function parseLrcSyncedLyrics(lrc: string | null | undefined): LyricLine[] {
  if (!lrc) return [];
  const parsed: LyricLine[] = [];

  for (const rawLine of lrc.split(/\r?\n/)) {
    if (LRC_META_TAG_RE.test(rawLine.trim())) continue;
    const matches = Array.from(rawLine.matchAll(LRC_LINE_RE));
    if (matches.length === 0) continue;
    const text = rawLine.replace(LRC_LINE_RE, '').trim();
    if (!text || /^♪+$/.test(text)) continue;

    for (const m of matches) {
      const mins = Number(m[1]) || 0;
      const secs = Number(m[2]) || 0;
      const fracRaw = m[3] || '0';
      const frac = Number(fracRaw) / Math.pow(10, fracRaw.length);
      const timeSeconds = Number((mins * 60 + secs + frac).toFixed(2));
      parsed.push({ timeSeconds, text });
    }
  }

  parsed.sort((a, b) => a.timeSeconds - b.timeSeconds);
  return parsed;
}

function recordToLyricsResponse(rec: LrclibRecord): LyricsResponse {
  const syncedLines = parseLrcSyncedLyrics(rec.syncedLyrics);
  const rawPlain = cleanPlainLyricsText(rec.plainLyrics);
  const plainLyrics = rawPlain && !NON_LATIN_SCRIPT_RE.test(rawPlain)
    ? formatPlainLyricsLocally(rawPlain)
    : rawPlain;
  return {
    found: syncedLines.length > 0 || Boolean(plainLyrics),
    trackName: rec.trackName,
    artistName: rec.artistName,
    albumName: rec.albumName,
    syncedLines,
    plainLyrics,
    source: 'LRCLIB',
  };
}

async function autoBeautifyLyrics(
  resp: LyricsResponse,
  title: string,
  artist: string
): Promise<LyricsResponse> {
  if (!resp.found) return resp;

  // Deterministic zero-quota formatting for Latin-script plain lyrics
  if (resp.syncedLines.length === 0 && resp.plainLyrics && !NON_LATIN_SCRIPT_RE.test(resp.plainLyrics)) {
    return {
      ...resp,
      plainLyrics: formatPlainLyricsLocally(resp.plainLyrics),
    };
  }

  if (!hasConfiguredGeminiKeys()) return resp;

  // Reserve automatic Gemini calls strictly for non-Latin script -> readable Hinglish transliteration
  try {
    if (resp.syncedLines.length > 0) {
      const hasNonLatin = resp.syncedLines.some((l) => NON_LATIN_SCRIPT_RE.test(l.text));
      if (!hasNonLatin) return resp;

      const enhanced = await enhanceLyricsWithAi({
        title,
        artist,
        syncedTexts: resp.syncedLines.map((l) => l.text),
        mode: 'hinglish',
      });
      if (
        enhanced.found &&
        enhanced.cleanedSyncedTexts &&
        enhanced.cleanedSyncedTexts.length === resp.syncedLines.length
      ) {
        return {
          ...resp,
          syncedLines: resp.syncedLines.map((orig, idx) => ({
            timeSeconds: orig.timeSeconds,
            text: enhanced.cleanedSyncedTexts![idx],
          })),
          plainLyrics: enhanced.plainLyrics || resp.plainLyrics,
          source: `${resp.source || 'Web'} · Hinglish AI`,
          aiEnhanced: true,
        };
      }
      return resp;
    }

    if (resp.plainLyrics && NON_LATIN_SCRIPT_RE.test(resp.plainLyrics)) {
      const enhanced = await enhanceLyricsWithAi({
        title,
        artist,
        rawLyrics: resp.plainLyrics,
        mode: 'hinglish',
      });
      if (enhanced.found && enhanced.plainLyrics) {
        return {
          ...resp,
          plainLyrics: enhanced.plainLyrics,
          source: `${resp.source || 'Web'} · Hinglish AI`,
          aiEnhanced: true,
        };
      }
    }
  } catch {
    // Fall back safely to original lyrics if AI rate-limited or unavailable
  }

  return resp;
}

async function fetchJsonSafe<T>(url: string, timeoutMs = 5500): Promise<T | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'User-Agent': 'VIBRA-Music-App/1.0',
        Accept: 'application/json',
      },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function queryLrclibCandidates(
  candidates: SearchCandidate[],
  dur: number
): Promise<LyricsResponse | null> {
  const primary = candidates[0];
  if (!primary) return null;

  // 1. Exact get on primary candidate
  if (primary.title && primary.artist) {
    const sp = new URLSearchParams({
      track_name: primary.title,
      artist_name: primary.artist,
    });
    if (dur > 0) sp.set('duration', String(dur));
    const exact = await fetchJsonSafe<LrclibRecord>(`https://lrclib.net/api/get?${sp.toString()}`, 4500);
    if (exact && (exact.syncedLyrics || exact.plainLyrics)) {
      const resp = recordToLyricsResponse(exact);
      if (resp.found) return resp;
    }
  }

  // 2. Parallel LRCLIB search across top candidate variants
  const searchUrls: Array<{ url: string; expectedTitle: string; expectedArtist: string }> = [];
  for (const cand of candidates.slice(0, 3)) {
    if (cand.artist) {
      const sp = new URLSearchParams({
        track_name: cand.title,
        artist_name: cand.artist,
      });
      searchUrls.push({
        url: `https://lrclib.net/api/search?${sp.toString()}`,
        expectedTitle: cand.title,
        expectedArtist: cand.artist,
      });
    }
    searchUrls.push({
      url: `https://lrclib.net/api/search?q=${encodeURIComponent(
        cand.artist ? `${cand.title} ${cand.artist}` : cand.title
      )}`,
      expectedTitle: cand.title,
      expectedArtist: cand.artist,
    });
  }

  // Always include bare primary title search as broad safety net
  if (primary.artist) {
    searchUrls.push({
      url: `https://lrclib.net/api/search?track_name=${encodeURIComponent(primary.title)}`,
      expectedTitle: primary.title,
      expectedArtist: primary.artist,
    });
  }

  const dedupUrls = Array.from(new Map(searchUrls.map((item) => [item.url, item])).values()).slice(0, 4);
  const batches = await Promise.all(
    dedupUrls.map(async (item) => ({
      ...item,
      records: await fetchJsonSafe<LrclibRecord[]>(item.url, 5000),
    }))
  );

  for (const batch of batches) {
    const list = batch.records;
    if (!Array.isArray(list) || list.length === 0) continue;

    const matched = list.filter(
      (r) =>
        Boolean(r.syncedLyrics || r.plainLyrics) &&
        hasTitleMatch(r.trackName, batch.expectedTitle)
    );
    if (matched.length === 0) continue;

    const artistLower = batch.expectedArtist.toLowerCase();
    const titleLower = batch.expectedTitle.toLowerCase();
    matched.sort((a, b) => {
      const score = (rec: LrclibRecord) => {
        let s = 0;
        if (rec.syncedLyrics) s += 55;
        const recTitle = rec.trackName?.toLowerCase() || '';
        const recArtist = rec.artistName?.toLowerCase() || '';
        if (recTitle === titleLower) s += 30;
        else if (recTitle.includes(titleLower)) s += 18;
        if (artistLower && recArtist.includes(artistLower)) s += 28;
        if (dur > 0 && typeof rec.duration === 'number') {
          s -= Math.min(35, Math.abs(rec.duration - dur));
        }
        return s;
      };
      return score(b) - score(a);
    });

    const best = recordToLyricsResponse(matched[0]);
    if (best.found) return best;
  }

  return null;
}

async function resolveCanonicalSongMetadata(
  query: string
): Promise<SearchCandidate[]> {
  const cleanQ = cleanTitleText(query);
  if (!cleanQ) return [];

  const [itunes, ovhSuggest] = await Promise.all([
    fetchJsonSafe<{
      results?: Array<{ trackName?: string; artistName?: string }>;
    }>(
      `https://itunes.apple.com/search?term=${encodeURIComponent(cleanQ)}&entity=song&limit=3`,
      4000
    ),
    fetchJsonSafe<{
      data?: Array<{ title?: string; title_short?: string; artist?: { name?: string } }>;
    }>(`https://api.lyrics.ovh/suggest/${encodeURIComponent(cleanQ)}`, 4000),
  ]);

  const resolved: SearchCandidate[] = [];
  const seen = new Set<string>();
  const add = (t?: string, a?: string) => {
    const title = cleanTitleText(t || '');
    const artist = getPrimaryArtist((a || '').trim());
    if (!title || !artist) return;
    const key = `${title.toLowerCase()}::${artist.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      resolved.push({ title, artist });
    }
  };

  for (const r of itunes?.results ?? []) {
    add(r.trackName, r.artistName);
  }
  for (const item of (ovhSuggest?.data ?? []).slice(0, 3)) {
    add(item.title_short || item.title, item.artist?.name);
  }

  return resolved;
}

async function fetchFromLyricsOvh(candidates: SearchCandidate[]): Promise<LyricsResponse | null> {
  const valid = candidates.filter((c) => c.title && c.artist).slice(0, 3);
  if (valid.length === 0) return null;

  for (const cand of valid) {
    const primaryArtist = getPrimaryArtist(cand.artist);
    const data = await fetchJsonSafe<{ lyrics?: string; error?: string }>(
      `https://api.lyrics.ovh/v1/${encodeURIComponent(primaryArtist)}/${encodeURIComponent(cand.title)}`,
      5000
    );
    const plain = cleanPlainLyricsText(data?.lyrics);
    if (!plain || plain.length < 40) continue;

    return {
      found: true,
      trackName: cand.title,
      artistName: primaryArtist,
      syncedLines: [],
      plainLyrics: NON_LATIN_SCRIPT_RE.test(plain) ? plain : formatPlainLyricsLocally(plain),
      source: 'Lyrics.ovh',
    };
  }
  return null;
}

export async function fetchTrackLyrics(params: {
  title: string;
  artist?: string;
  durationSeconds?: number;
  forceAi?: boolean;
}): Promise<LyricsResponse> {
  const candidates = buildSearchCandidates(params.title, params.artist || '');
  const primary = candidates[0];
  const searchTitle = primary?.title || params.title.trim();
  const searchArtist = primary?.artist || cleanArtistText(params.artist || '');
  const dur =
    Number.isFinite(params.durationSeconds) && (params.durationSeconds ?? 0) > 0
      ? Math.round(params.durationSeconds!)
      : 0;
  const forceAi = Boolean(params.forceAi);

  if (!searchTitle) {
    return { found: false, syncedLines: [], plainLyrics: null };
  }

  const cacheKey = `${forceAi ? 'ai' : 'std'}::${searchTitle.toLowerCase()}::${searchArtist.toLowerCase()}::${dur}`;
  const cached = lyricsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const pending = lyricsInFlight.get(cacheKey);
  if (pending) return pending;

  const job = (async (): Promise<LyricsResponse> => {
    // Direct AI + Google Search web lookup when explicitly requested
    if (forceAi && hasConfiguredGeminiKeys()) {
      try {
        const aiResult = await findAndFormatLyricsWithAi({
          title: searchTitle,
          artist: searchArtist,
        });
        if (aiResult.found && aiResult.plainLyrics) {
          return {
            found: true,
            trackName: searchTitle,
            artistName: searchArtist || undefined,
            syncedLines: [],
            plainLyrics: aiResult.plainLyrics,
            source: aiResult.source,
            aiEnhanced: true,
          };
        }
      } catch {
        // Fall through to standard sources if AI fails
      }
    }

    // 1. LRCLIB search across clean YouTube candidate variants
    const lrcHit = await queryLrclibCandidates(candidates, dur);
    if (lrcHit?.found) {
      return autoBeautifyLyrics(lrcHit, lrcHit.trackName || searchTitle, lrcHit.artistName || searchArtist);
    }

    // 2. Canonical catalog lookup (iTunes + Deezer/Lyrics.ovh Suggest) to strip YouTube subtitles/movie suffixes
    const canonicalCandidates = await resolveCanonicalSongMetadata(
      searchArtist ? `${searchTitle} ${searchArtist}` : searchTitle
    );
    const mergedCandidates = [...candidates];
    for (const cc of canonicalCandidates) {
      if (
        !mergedCandidates.some(
          (m) =>
            m.title.toLowerCase() === cc.title.toLowerCase() &&
            m.artist.toLowerCase() === cc.artist.toLowerCase()
        )
      ) {
        mergedCandidates.push(cc);
      }
    }

    if (canonicalCandidates.length > 0) {
      const canonicalLrcHit = await queryLrclibCandidates(canonicalCandidates, dur);
      if (canonicalLrcHit?.found) {
        return autoBeautifyLyrics(
          canonicalLrcHit,
          canonicalLrcHit.trackName || canonicalCandidates[0].title,
          canonicalLrcHit.artistName || canonicalCandidates[0].artist
        );
      }
    }

    // 3. Lyrics.ovh fallback with canonical & cleaned primary artist pairs
    const ovhHit = await fetchFromLyricsOvh(mergedCandidates);
    if (ovhHit?.found) {
      return autoBeautifyLyrics(ovhHit, ovhHit.trackName || searchTitle, ovhHit.artistName || searchArtist);
    }

    // 4. Google Search grounded Gemini AI lookup (scrapes live lyrics sites when catalog APIs miss)
    if (hasConfiguredGeminiKeys()) {
      const bestCand = canonicalCandidates[0] || primary;
      try {
        const aiResult = await findAndFormatLyricsWithAi({
          title: bestCand.title,
          artist: bestCand.artist,
        });
        if (aiResult.found && aiResult.plainLyrics) {
          return {
            found: true,
            trackName: bestCand.title,
            artistName: bestCand.artist || undefined,
            syncedLines: [],
            plainLyrics: aiResult.plainLyrics,
            source: aiResult.source,
            aiEnhanced: true,
          };
        }
      } catch {
        // ignore AI fallback error and return not-found cleanly
      }
    }

    return {
      found: false,
      trackName: searchTitle,
      artistName: searchArtist || undefined,
      syncedLines: [],
      plainLyrics: null,
    };
  })()
    .then((result) => {
      if (lyricsCache.size >= 400) {
        const oldest = lyricsCache.keys().next().value;
        if (oldest !== undefined) lyricsCache.delete(oldest);
      }
      lyricsCache.set(cacheKey, {
        data: result,
        // Keep misses short (45s) so transient API limits or retries recover right away
        expiresAt: Date.now() + (result.found ? 24 * 60 * 60 * 1000 : 45 * 1000),
      });
      return result;
    })
    .finally(() => {
      lyricsInFlight.delete(cacheKey);
    });

  lyricsInFlight.set(cacheKey, job);
  return job;
}
