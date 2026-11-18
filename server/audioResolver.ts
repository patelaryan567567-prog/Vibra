import type { Request, Response } from 'express';
import { Readable } from 'node:stream';

export type AudioSourceProvider = 'jiosaavn' | 'soundcloud' | 'audius' | 'archive';

export interface ResolvedAudioStream {
  mode: 'proxy' | 'hls' | 'direct' | 'youtube';
  provider?: AudioSourceProvider;
  streamUrl?: string;
  matchedTitle?: string;
  matchedArtist?: string;
  durationSeconds?: number;
}

export interface MultiSourceTrackResult {
  id: string;
  title: string;
  artist: string;
  duration: string;
  durationSeconds: number;
  thumbnail: string;
  thumbnailHigh: string;
  provider: AudioSourceProvider;
  sourceLabel: string;
}

interface InternalResolvedEntry {
  result: ResolvedAudioStream;
  upstreamKind?: 'direct-url' | 'soundcloud-hls-fmp4';
  upstreamMimeType?: string;
  upstreamUrl?: string;
  upstreamHeaders?: Record<string, string>;
  scTranscodingUrl?: string;
  scManifest?: { hasInitMap: boolean; allUrls: string[] };
  scManifestPromise?: Promise<{ hasInitMap: boolean; allUrls: string[] } | null>;
  assembledBuffer?: Buffer;
  assemblingPromise?: Promise<Buffer | null>;
  expiresAt: number;
}

const RESOLVE_TTL_MS = 25 * 60 * 1000;
const NEGATIVE_TTL_MS = 8 * 60 * 1000;
const MAX_RESOLVED_CACHE = 450;
const resolvedCache = new Map<string, InternalResolvedEntry>();
const inFlightResolves = new Map<string, Promise<InternalResolvedEntry>>();

let cachedScClientId = '';
let cachedScClientIdExpires = 0;
let inFlightScClientId: Promise<string | null> | null = null;

const BLOCKED_VARIANT_RE =
  /\b(slowed|reverb|reverbed|lofi|lo-fi|karaoke|instrumental|8d|16d|16-?bit|emulation|female\s*reply|male\s*reply|cover\s*version|tribute|ringtone|whatsapp\s*status|house\s*mix|dj\s*mix|mashup|parody|acoustic\s*cover|nightcore|sped\s*up)\b/i;

const HARD_JUNK_RE =
  /\b(karaoke|instrumental|16-?bit|emulation|ringtone|whatsapp\s*status|parody|female\s*reply|male\s*reply)\b/i;

const MASHUP_X_RE = /\b[a-z0-9]{2,}\s+x\s+[a-z0-9]{2,}\b/i;

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'feat',
  'featuring',
  'ft',
  'prod',
  'official',
  'music',
  'video',
  'audio',
  'song',
  'songs',
  'full',
  'lyric',
  'lyrics',
  'lyrical',
  'visualizer',
  'visualiser',
  'latest',
  'punjabi',
  'hindi',
  'urdu',
  'bollywood',
  'hollywood',
  'new',
  'hit',
  'hits',
  'mp3',
  '8k',
  '4k',
  'hd',
]);

function decodeEntities(raw: string): string {
  return raw
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function tokenizeMeaningful(text: string): string[] {
  return decodeEntities(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
}

function parseYouTubeMetadata(rawTitle: string, rawArtist: string): {
  searchQueries: string[];
  songCoreTokens: string[];
  artistTokens: string[];
  cleanedTitle: string;
} {
  const pipeSegments = decodeEntities(rawTitle)
    .split('|')
    .map((s) => s.trim())
    .filter(
      (s, idx) =>
        idx === 0 ||
        !/\b(official|music\s*video|lyric|audio|visuali[sz]er|8k|4k|hd|full\s*song|new\s*punjabi|punjabi\s*superhit|superhit|wedding\s*song|prod\.?\s*by|trending|#)\b/i.test(
          s
        )
    );

  const cleanedTitle = pipeSegments
    .join(' - ')
    .replace(
      /\(.*?(official|music\s*video|lyric|audio|visuali[sz]er|8k|4k|hd|full\s*song|latest\s*punjabi|story\s*version|song).*?\)/gi,
      ' '
    )
    .replace(/\[.*?(official|music\s*video|lyric|audio|visuali[sz]er|8k|4k|hd|full\s*song).*?\]/gi, ' ')
    .replace(/\bprod\.?\s*by\b.*$/gi, ' ')
    .replace(
      /\b(official\s*(music\s*)?(video|audio|visuali[sz]er)|full\s*(video|song|audio)|lyric(al)?\s*video|8k\s*video|4k\s*video|music\s*video)\b/gi,
      ' '
    )
    .replace(/#\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const cleanedArtist = decodeEntities(rawArtist)
    .replace(
      /\b(t-?series(\s*apna\s*punjab)?|zee\s*music(\s*company)?|sony\s*music(\s*india)?|yrf|yash\s*raj\s*films|speed\s*records|dm\s*-\s*desi\s*melodies|desi\s*melodies|rehaan\s*records|saregama(\s*music)?|tips\s*official|coke\s*studio\s*pakistan|vyrl\s*originals|universal\s*music(\s*india)?|sagahits|tune\s*vibe|axjuu)\b/gi,
      ' '
    )
    .replace(/\b-\s*topic\b/gi, ' ')
    .replace(/\bofficial\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  let extractedSongPart = cleanedTitle;
  let extractedArtistPart = cleanedArtist;

  if (cleanedTitle.includes(' - ')) {
    const [left, right] = cleanedTitle.split(' - ', 2).map((s) => s.trim());
    if (cleanedArtist && left.toLowerCase().includes(cleanedArtist.toLowerCase())) {
      extractedArtistPart = left;
      extractedSongPart = right;
    } else if (cleanedArtist && right.toLowerCase().includes(cleanedArtist.toLowerCase())) {
      extractedSongPart = left;
      extractedArtistPart = right;
    } else {
      const leftWords = tokenizeMeaningful(left);
      const rightWords = tokenizeMeaningful(right);
      if (leftWords.length >= 1 && leftWords.length <= 3 && rightWords.length >= 2) {
        // Common pattern: "ISHQ - Faheem Abdullah, Rauhan Malik" or "Udaarian - Satinder Sartaaj"
        extractedSongPart = left;
        extractedArtistPart = `${right} ${cleanedArtist}`.trim();
      } else {
        extractedSongPart = right.length >= 2 ? right : cleanedTitle;
        if (!extractedArtistPart && left.length >= 2) extractedArtistPart = left;
      }
    }
  } else if (cleanedTitle.includes(':')) {
    const [left, right] = cleanedTitle.split(':', 2).map((s) => s.trim());
    if (right.length >= 3) {
      extractedSongPart = right;
      if (!extractedArtistPart && left.length >= 2) extractedArtistPart = left;
    }
  }

  const artistTokenList = Array.from(new Set(tokenizeMeaningful(`${extractedArtistPart} ${cleanedArtist}`)));
  const artistTokenSet = new Set(artistTokenList);

  const songWithoutFeat = extractedSongPart.replace(/\b(ft|feat|featuring)\.?\s+.*$/i, '').trim();
  const rawSongTokens = tokenizeMeaningful(songWithoutFeat || extractedSongPart);
  const strippedSongTokens = rawSongTokens.filter((t) => !artistTokenSet.has(t));
  const songCoreTokens =
    strippedSongTokens.length > 0
      ? strippedSongTokens
      : rawSongTokens.length > 0
        ? rawSongTokens
        : tokenizeMeaningful(cleanedTitle);

  const queries: string[] = [];
  const songOnly = songCoreTokens.join(' ');
  const artistOnly = artistTokenList.slice(0, 3).join(' ');

  if (songOnly && artistOnly) {
    queries.push(`${songOnly} ${artistOnly}`.trim());
  }
  if (songCoreTokens.length > 1 && artistOnly) {
    queries.push(`${songCoreTokens[0]} ${artistOnly}`.trim());
  }
  const baseQuery =
    extractedArtistPart && !cleanedTitle.toLowerCase().includes(extractedArtistPart.toLowerCase())
      ? `${extractedSongPart} ${extractedArtistPart}`.trim()
      : cleanedTitle.replace(/\s*-\s*/g, ' ').trim();
  if (baseQuery) queries.push(baseQuery);
  if (extractedSongPart && extractedSongPart !== baseQuery) {
    queries.push(extractedSongPart);
  }

  return {
    searchQueries: Array.from(new Set(queries)).filter(Boolean).slice(0, 4),
    songCoreTokens,
    artistTokens: artistTokenList,
    cleanedTitle,
  };
}

function scoreAudioCandidate(params: {
  candTitle: string;
  candArtists: string;
  candDuration: number;
  ytDuration: number;
  rawYtTitle: string;
  songCoreTokens: string[];
  artistTokens: string[];
  cleanedYtTitle: string;
  allowExtendedVariants?: boolean;
}): number {
  const candTitle = decodeEntities(params.candTitle);
  const candArtists = decodeEntities(params.candArtists).toLowerCase();
  const candTitleLower = candTitle.toLowerCase();
  const rawYtLower = params.rawYtTitle.toLowerCase();

  // Always block karaoke, instrumental, 16-bit emulations, ringtones, female/male reply covers
  if (HARD_JUNK_RE.test(candTitle) && !HARD_JUNK_RE.test(rawYtLower)) {
    return -1000;
  }

  if (!params.allowExtendedVariants) {
    if (
      (BLOCKED_VARIANT_RE.test(candTitle) && !BLOCKED_VARIANT_RE.test(rawYtLower)) ||
      (MASHUP_X_RE.test(candTitle) && !MASHUP_X_RE.test(rawYtLower))
    ) {
      return -1000;
    }
  }

  // Strip "(From \"Movie\")" or "(Original Motion Picture Soundtrack)" suffixes before token scoring
  const cleanCandTitle = candTitle
    .replace(/\(\s*(?:from|feat\.?|ft\.?|original\s+motion\s+picture.*?|from\s+the.*?)\s*[^)]*\)/gi, ' ')
    .replace(/\[\s*(?:from|feat\.?|ft\.?)\s*[^\]]*\]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const candTokens = tokenizeMeaningful(cleanCandTitle || candTitle);
  const candArtistTokens = tokenizeMeaningful(candArtists);
  if (candTokens.length === 0 || params.songCoreTokens.length === 0) return -1000;

  const fullYtHaystackTokens = new Set([
    ...tokenizeMeaningful(params.cleanedYtTitle),
    ...tokenizeMeaningful(params.rawYtTitle),
    ...params.songCoreTokens,
    ...params.artistTokens,
  ]);

  const candCombinedTokens = new Set([...candTokens, ...candArtistTokens]);

  // Verify artist attribution (either YouTube artist token is in candidate, or candidate's primary artist is explicitly in YouTube title/artist)
  const candCombinedText = `${candArtists} ${candTitleLower}`;
  const artistHitCount =
    params.artistTokens.filter((t) => candCombinedText.includes(t)).length +
    candArtistTokens.filter((t) => fullYtHaystackTokens.has(t)).length;
  const artistMatched =
    params.artistTokens.length === 0 && candArtistTokens.length === 0 ? true : artistHitCount > 0;

  // Check how many of the song's core title words appear in candidate title or artist
  const coreOverlap = params.songCoreTokens.filter(
    (t) => candCombinedTokens.has(t) || candTitleLower.includes(t)
  ).length;
  const rawCoreCoverage = coreOverlap / params.songCoreTokens.length;

  // Also check if the candidate's own song title tokens are 100% present in the YouTube title (handles "Mahiya ft. Avneet Kaur" where "Mahiya" is 1 word)
  const candTitleInYtCount = candTokens.filter((t) => fullYtHaystackTokens.has(t)).length;
  const candTitleInYtRatio = candTitleInYtCount / candTokens.length;

  const coreCoverage =
    candTitleInYtRatio >= 0.85 && artistMatched
      ? Math.max(rawCoreCoverage, 0.9)
      : rawCoreCoverage;

  if (coreOverlap === 0 || coreCoverage < 0.5) {
    return -500;
  }

  // Reject candidates introducing unrelated song words (blocks "Kahani Suno" -> "Mansoob" or multi-song mashups)
  const EXTENDED_DESCRIPTOR_TOKENS = new Set([
    'live',
    'at',
    'in',
    'from',
    'the',
    'remix',
    'edit',
    'version',
    'mix',
    'session',
    'acoustic',
    'reverb',
    'slowed',
    '2022',
    '2023',
    '2024',
    '2025',
    '2026',
  ]);
  const unmatchedCandTokens = candTokens.filter(
    (t) =>
      !fullYtHaystackTokens.has(t) &&
      !(params.allowExtendedVariants && EXTENDED_DESCRIPTOR_TOKENS.has(t))
  );
  const maxUnmatchedRatio = params.allowExtendedVariants ? 0.55 : 0.34;
  if (unmatchedCandTokens.length > 0 && unmatchedCandTokens.length / candTokens.length > maxUnmatchedRatio) {
    return -500;
  }

  // Duration sanity check (YouTube music videos often have a 30s-100s story intro/outro vs studio audio)
  let durScore = 0;
  if (params.ytDuration > 0 && params.candDuration > 0) {
    const diff = Math.abs(params.ytDuration - params.candDuration);
    const maxDiff = params.ytDuration > 280 ? 150 : 105;
    if (diff > maxDiff) return -500;
    if (diff <= 15) durScore = 35;
    else if (diff <= 35) durScore = 22;
    else if (diff <= 65) durScore = 12;
    else durScore = 4;
  }

  if (!artistMatched) {
    if (unmatchedCandTokens.length > 0 || coreCoverage < 0.9 || candTokens.length < 3 || durScore < 20) {
      return -200;
    }
  }

  let score = Math.round(coreCoverage * 60) + (artistMatched ? 40 : 0) + durScore;
  if (candTitleLower === params.cleanedYtTitle.toLowerCase()) score += 20;
  if (params.allowExtendedVariants) score -= 12;
  return score;
}

interface SaavnSearchResultItem {
  id?: string;
  song?: string;
  title?: string;
  primary_artists?: string;
  singers?: string;
  music?: string;
  duration?: string | number;
  encrypted_media_url?: string;
  more_info?: {
    duration?: string | number;
    encrypted_media_url?: string;
  };
}

async function resolveViaJioSaavn(
  videoId: string,
  title: string,
  artist: string,
  ytDuration: number
): Promise<InternalResolvedEntry | null> {
  const parsed = parseYouTubeMetadata(title, artist);
  let bestCandidate: { encUrl: string; title: string; artists: string; duration: number; score: number } | null = null;

  const collectedItems: SaavnSearchResultItem[] = [];

  const fetchSaavnQuery = async (query: string, timeoutMs = 2600): Promise<SaavnSearchResultItem[]> => {
    try {
      const searchUrl = `https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&_marker=0&cc=in&n=8&q=${encodeURIComponent(
        query
      )}`;
      const res = await fetch(searchUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as { results?: SaavnSearchResultItem[] };
      return data.results ?? [];
    } catch {
      return [];
    }
  };

  // Fire top 2 queries in parallel so resolve time is ~300-500ms instead of sequential waterfall
  const primaryBatch = await Promise.all(
    parsed.searchQueries.slice(0, 2).map((q) => fetchSaavnQuery(q, 2600))
  );
  for (const list of primaryBatch) {
    collectedItems.push(...list);
  }

  if (collectedItems.length === 0 && parsed.searchQueries.length > 2) {
    const extra = await fetchSaavnQuery(parsed.searchQueries[2], 2000);
    collectedItems.push(...extra);
  }

  for (const allowExtendedVariants of [false, true]) {
    for (const item of collectedItems) {
      let encUrl = item.encrypted_media_url || item.more_info?.encrypted_media_url || '';
      const candTitle = decodeEntities(item.song || item.title || '');
      const candArtists = decodeEntities(
        [item.primary_artists, item.singers, item.music].filter(Boolean).join(', ')
      );
      const candDuration = Number(item.duration || item.more_info?.duration || 0);
      if (candDuration > 0 && candDuration < 65) continue;

      const score = scoreAudioCandidate({
        candTitle,
        candArtists,
        candDuration,
        ytDuration,
        rawYtTitle: title,
        songCoreTokens: parsed.songCoreTokens,
        artistTokens: parsed.artistTokens,
        cleanedYtTitle: parsed.cleanedTitle,
        allowExtendedVariants,
      });

      const threshold = allowExtendedVariants ? 60 : 66;
      if (score < threshold) continue;

      if (!encUrl && item.id) {
        try {
          const detRes = await fetch(
            `https://www.jiosaavn.com/api.php?__call=song.getDetails&_format=json&_marker=0&cc=in&pids=${encodeURIComponent(
              item.id
            )}`,
            { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(3500) }
          );
          if (detRes.ok) {
            const det = (await detRes.json()) as {
              songs?: SaavnSearchResultItem[];
              [k: string]: unknown;
            };
            const sObj = (det.songs?.[0] ?? det[item.id]) as SaavnSearchResultItem | undefined;
            encUrl = sObj?.more_info?.encrypted_media_url || sObj?.encrypted_media_url || '';
          }
        } catch {
          // ignore detail fetch failure
        }
      }

      if (!encUrl) continue;

      if (!bestCandidate || score > bestCandidate.score) {
        bestCandidate = {
          encUrl,
          title: candTitle,
          artists: candArtists,
          duration: candDuration,
          score,
        };
      }
    }
    if (bestCandidate) break;
  }

  if (!bestCandidate) return null;

  try {
    const authRes = await fetch(
      `https://www.jiosaavn.com/api.php?__call=song.generateAuthToken&url=${encodeURIComponent(
        bestCandidate.encUrl
      )}&bitrate=160&api_version=4&_format=json&ctx=web6dot0&_marker=0`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(2800) }
    );
    if (!authRes.ok) return null;
    const authJson = (await authRes.json()) as { auth_url?: string };
    if (!authJson.auth_url) return null;

    return {
      result: {
        mode: 'proxy',
        provider: 'jiosaavn',
        streamUrl: `/api/audio/stream?videoId=${encodeURIComponent(videoId)}`,
        matchedTitle: bestCandidate.title,
        matchedArtist: bestCandidate.artists,
        durationSeconds: bestCandidate.duration || undefined,
      },
      upstreamKind: 'direct-url',
      upstreamUrl: authJson.auth_url,
      upstreamHeaders: {
        Referer: 'https://www.jiosaavn.com/',
        Origin: 'https://www.jiosaavn.com',
        'User-Agent':
          'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36',
      },
      expiresAt: Date.now() + RESOLVE_TTL_MS,
    };
  } catch {
    return null;
  }
}

async function getSoundCloudClientId(): Promise<string | null> {
  if (cachedScClientId && cachedScClientIdExpires > Date.now()) {
    return cachedScClientId;
  }
  if (inFlightScClientId) {
    return inFlightScClientId;
  }

  inFlightScClientId = (async (): Promise<string | null> => {
    try {
      const homeRes = await fetch('https://soundcloud.com', {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(3000),
      });
      if (!homeRes.ok) return null;
      const html = await homeRes.text();
      const scripts = [...html.matchAll(/https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js/g)].map(
        (m) => m[0]
      );
      if (scripts.length === 0) return null;

      // Scan last 5 asset bundles concurrently instead of sequentially
      const candidates = await Promise.all(
        scripts.slice(-5).map(async (scriptUrl) => {
          try {
            const jsRes = await fetch(scriptUrl, { signal: AbortSignal.timeout(2600) });
            if (!jsRes.ok) return null;
            const js = await jsRes.text();
            const match = js.match(/client_id\s*[:=]\s*"([a-zA-Z0-9]{20,40})"/);
            return match?.[1] ?? null;
          } catch {
            return null;
          }
        })
      );

      const foundId = candidates.find((id): id is string => Boolean(id));
      if (foundId) {
        cachedScClientId = foundId;
        cachedScClientIdExpires = Date.now() + 12 * 60 * 60 * 1000;
        return foundId;
      }
    } catch {
      // ignore SoundCloud bootstrap error
    }
    return null;
  })().finally(() => {
    inFlightScClientId = null;
  });

  return inFlightScClientId;
}

export function warmAudioResolverStartup(): void {
  void getSoundCloudClientId();
  const refreshTimer = setInterval(() => {
    cachedScClientIdExpires = 0;
    void getSoundCloudClientId();
  }, 6 * 60 * 60 * 1000);
  refreshTimer.unref?.();
}

interface SoundCloudTrackItem {
  title?: string;
  duration?: number;
  streamable?: boolean;
  policy?: string;
  user?: { username?: string };
  media?: {
    transcodings?: Array<{
      url?: string;
      preset?: string;
      format?: { protocol?: string; mime_type?: string };
    }>;
  };
}

async function resolveViaSoundCloud(
  videoId: string,
  title: string,
  artist: string,
  ytDuration: number
): Promise<InternalResolvedEntry | null> {
  const clientId = await getSoundCloudClientId();
  if (!clientId) return null;

  const parsed = parseYouTubeMetadata(title, artist);
  const collectedItems: SoundCloudTrackItem[] = [];

  const searchScQuery = async (query: string, timeoutMs = 2600): Promise<SoundCloudTrackItem[]> => {
    try {
      const searchUrl = `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(
        query
      )}&client_id=${encodeURIComponent(clientId)}&limit=10`;
      const res = await fetch(searchUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as { collection?: SoundCloudTrackItem[] };
      return data.collection ?? [];
    } catch {
      return [];
    }
  };

  const batch = await Promise.all(parsed.searchQueries.slice(0, 2).map((q) => searchScQuery(q, 2600)));
  for (const list of batch) {
    collectedItems.push(...list);
  }
  if (collectedItems.length === 0 && parsed.searchQueries.length > 2) {
    collectedItems.push(...(await searchScQuery(parsed.searchQueries[2], 2000)));
  }

  if (collectedItems.length === 0) return null;

  let best: {
    track: SoundCloudTrackItem;
    transcodingUrl: string;
    protocol: string;
    mimeType: string;
    score: number;
  } | null = null;

  // Pass 1: Strict studio match; Pass 2: Extended playable match (live/remix of exact song+artist)
  for (const allowExtendedVariants of [false, true]) {
    for (const item of collectedItems) {
      if (!item.streamable || item.policy === 'SNIP' || item.policy === 'BLOCK') continue;
      const transcodings = item.media?.transcodings ?? [];
      if (transcodings.length === 0) continue;

      const candDurSec = item.duration ? Math.round(item.duration / 1000) : 0;
      if (candDurSec > 0 && candDurSec < 65) continue;

      const candTitle = item.title ?? '';
      const candArtists = item.user?.username ?? '';
      const score = scoreAudioCandidate({
        candTitle,
        candArtists,
        candDuration: candDurSec,
        ytDuration,
        rawYtTitle: title,
        songCoreTokens: parsed.songCoreTokens,
        artistTokens: parsed.artistTokens,
        cleanedYtTitle: parsed.cleanedTitle,
        allowExtendedVariants,
      });

      if (score < 68) continue;

      // Prefer progressive MP3 or fMP4 HLS (aac_160k / audio/mp4) which our server assembles into a native MP4 stream
      const chosen =
        transcodings.find((t) => t.format?.protocol === 'progressive' && t.url) ||
        transcodings.find((t) => t.format?.protocol === 'hls' && t.format?.mime_type?.includes('mp4') && t.url) ||
        transcodings.find((t) => t.format?.protocol === 'hls' && t.url);

      if (!chosen?.url) continue;

      if (!best || score > best.score) {
        best = {
          track: item,
          transcodingUrl: chosen.url,
          protocol: chosen.format?.protocol ?? 'hls',
          mimeType: chosen.format?.mime_type ?? 'audio/mp4',
          score,
        };
      }
    }
    if (best) break;
  }

  if (!best) return null;

  try {
    const signRes = await fetch(`${best.transcodingUrl}?client_id=${encodeURIComponent(clientId)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(4000),
    });
    if (!signRes.ok) return null;
    const signJson = (await signRes.json()) as { url?: string };
    if (!signJson.url) return null;

    if (best.protocol === 'progressive') {
      return {
        result: {
          mode: 'proxy',
          provider: 'soundcloud',
          streamUrl: `/api/audio/stream?videoId=${encodeURIComponent(videoId)}`,
          matchedTitle: best.track.title,
          matchedArtist: best.track.user?.username,
          durationSeconds: best.track.duration ? Math.round(best.track.duration / 1000) : undefined,
        },
        upstreamKind: 'direct-url',
        upstreamUrl: signJson.url,
        upstreamHeaders: { 'User-Agent': 'Mozilla/5.0' },
        expiresAt: Date.now() + RESOLVE_TTL_MS,
      };
    }

    // Serve SoundCloud HLS through /api/audio/stream as a native byte-range stream so <audio> plays cleanly
    return {
      result: {
        mode: 'proxy',
        provider: 'soundcloud',
        streamUrl: `/api/audio/stream?videoId=${encodeURIComponent(videoId)}`,
        matchedTitle: best.track.title,
        matchedArtist: best.track.user?.username,
        durationSeconds: best.track.duration ? Math.round(best.track.duration / 1000) : undefined,
      },
      upstreamKind: 'soundcloud-hls-fmp4',
      upstreamMimeType: best.mimeType.includes('mpeg') ? 'audio/mpeg' : 'audio/mp4',
      upstreamUrl: signJson.url,
      scTranscodingUrl: best.transcodingUrl,
      expiresAt: Date.now() + RESOLVE_TTL_MS,
    };
  } catch {
    return null;
  }
}

function stripStypSidx(buf: Buffer): Buffer {
  let offset = 0;
  while (offset + 8 <= buf.length) {
    const size = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString('ascii');
    if (size < 8 || offset + size > buf.length) break;
    if (type === 'styp' || type === 'sidx') {
      offset += size;
    } else {
      break;
    }
  }
  return offset > 0 ? buf.subarray(offset) : buf;
}

async function fetchSoundCloudManifest(
  entry: InternalResolvedEntry
): Promise<{ hasInitMap: boolean; allUrls: string[] } | null> {
  if (entry.scManifest) return entry.scManifest;
  if (entry.scManifestPromise) return entry.scManifestPromise;

  const job = (async () => {
    try {
      let m3u8Url = entry.upstreamUrl;
      if (!m3u8Url && entry.scTranscodingUrl) {
        const cid = await getSoundCloudClientId();
        if (!cid) return null;
        const sr = await fetch(`${entry.scTranscodingUrl}?client_id=${encodeURIComponent(cid)}`, {
          signal: AbortSignal.timeout(3000),
        });
        if (!sr.ok) return null;
        const sj = (await sr.json()) as { url?: string };
        m3u8Url = sj.url;
      }
      if (!m3u8Url) return null;

      let m3u8Res = await fetch(m3u8Url, { signal: AbortSignal.timeout(3000) });
      if (!m3u8Res.ok && entry.scTranscodingUrl) {
        const cid = await getSoundCloudClientId();
        if (cid) {
          const sr = await fetch(`${entry.scTranscodingUrl}?client_id=${encodeURIComponent(cid)}`, {
            signal: AbortSignal.timeout(3000),
          });
          if (sr.ok) {
            const sj = (await sr.json()) as { url?: string };
            if (sj.url) {
              entry.upstreamUrl = sj.url;
              m3u8Res = await fetch(sj.url, { signal: AbortSignal.timeout(3000) });
            }
          }
        }
      }
      if (!m3u8Res.ok) return null;

      const m3u8Text = await m3u8Res.text();
      const mapMatch = m3u8Text.match(/#EXT-X-MAP:URI="([^"]+)"/);
      const segUrls = m3u8Text
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.startsWith('https://'));

      const hasInitMap = Boolean(mapMatch?.[1]);
      const allUrls = mapMatch?.[1] ? [mapMatch[1], ...segUrls] : segUrls;
      if (allUrls.length === 0) return null;

      const manifest = { hasInitMap, allUrls };
      entry.scManifest = manifest;
      return manifest;
    } catch {
      return null;
    } finally {
      entry.scManifestPromise = undefined;
    }
  })();

  entry.scManifestPromise = job;
  return job;
}

async function assembleSoundCloudFmp4Buffer(entry: InternalResolvedEntry): Promise<Buffer | null> {
  if (entry.assembledBuffer) return entry.assembledBuffer;
  if (entry.assemblingPromise) return entry.assemblingPromise;

  const job = (async (): Promise<Buffer | null> => {
    try {
      const manifest = await fetchSoundCloudManifest(entry);
      if (!manifest || manifest.allUrls.length === 0) return null;

      const { hasInitMap, allUrls } = manifest;
      const chunks: Buffer[] = new Array(allUrls.length);
      const batchSize = 32;
      for (let i = 0; i < allUrls.length; i += batchSize) {
        const slice = allUrls.slice(i, i + batchSize);
        const fetched = await Promise.all(
          slice.map(async (u, localIdx) => {
            const r = await fetch(u, { signal: AbortSignal.timeout(6000) });
            if (!r.ok) throw new Error(`Segment HTTP ${r.status}`);
            const raw = Buffer.from(await r.arrayBuffer());
            const globalIdx = i + localIdx;
            return hasInitMap && globalIdx > 0 ? stripStypSidx(raw) : raw;
          })
        );
        for (let j = 0; j < fetched.length; j++) {
          chunks[i + j] = fetched[j];
        }
      }

      const fullBuffer = Buffer.concat(chunks);
      entry.assembledBuffer = fullBuffer;
      return fullBuffer;
    } catch {
      return null;
    } finally {
      entry.assemblingPromise = undefined;
    }
  })();

  entry.assemblingPromise = job;
  return job;
}

async function streamSoundCloudFmp4Progressive(
  entry: InternalResolvedEntry,
  req: Request,
  res: Response,
  cleanFileBase: string,
  wantsDownload: boolean
): Promise<void> {
  const manifest = await fetchSoundCloudManifest(entry);
  if (!manifest || manifest.allUrls.length === 0) {
    if (!res.headersSent) {
      res.status(502).json({ error: 'SC_STREAM_FAILED', message: 'Failed to load audio manifest.' });
    }
    return;
  }

  let clientClosed = false;
  req.on('close', () => {
    clientClosed = true;
  });

  const scMime = entry.upstreamMimeType || 'audio/mp4';
  res.status(200);
  res.setHeader('Content-Type', scMime);
  res.setHeader('Cache-Control', 'private, max-age=900');
  if (wantsDownload) {
    const ext = scMime === 'audio/mpeg' ? '.mp3' : '.m4a';
    const dlName = cleanFileBase.endsWith(ext) ? cleanFileBase : `${cleanFileBase}${ext}`;
    res.setHeader('Content-Disposition', `attachment; filename="${dlName}"`);
  }

  const { hasInitMap, allUrls } = manifest;
  const collected: Buffer[] = new Array(allUrls.length);
  let allComplete = true;

  // Fetch initial 3 segments (init + first 2 audio chunks) first for < 350ms TTFB, then larger batches
  let cursor = 0;
  while (cursor < allUrls.length) {
    if (clientClosed || res.writableEnded) {
      allComplete = false;
      break;
    }
    const batchSize = cursor === 0 ? 3 : cursor < 12 ? 6 : 12;
    const slice = allUrls.slice(cursor, cursor + batchSize);
    try {
      const fetched = await Promise.all(
        slice.map(async (u, localIdx) => {
          const r = await fetch(u, { signal: AbortSignal.timeout(5500) });
          if (!r.ok) throw new Error(`Segment HTTP ${r.status}`);
          const raw = Buffer.from(await r.arrayBuffer());
          const globalIdx = cursor + localIdx;
          return hasInitMap && globalIdx > 0 ? stripStypSidx(raw) : raw;
        })
      );
      if (clientClosed || res.writableEnded) {
        allComplete = false;
        break;
      }
      for (let j = 0; j < fetched.length; j++) {
        collected[cursor + j] = fetched[j];
        res.write(fetched[j]);
      }
      cursor += slice.length;
    } catch {
      allComplete = false;
      break;
    }
  }

  if (!res.writableEnded) {
    res.end();
  }
  if (allComplete && collected.every(Boolean)) {
    entry.assembledBuffer = Buffer.concat(collected);
  }
}

function formatDurLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

interface AudiusTrackItem {
  id?: string;
  title?: string;
  duration?: number;
  is_streamable?: boolean;
  is_stream_gated?: boolean;
  artwork?: { '480x480'?: string; '150x150'?: string };
  user?: { name?: string; handle?: string };
  stream?: { url?: string };
}

async function resolveViaAudius(
  videoId: string,
  title: string,
  artist: string,
  ytDuration: number
): Promise<InternalResolvedEntry | null> {
  const parsed = parseYouTubeMetadata(title, artist);
  const collected: AudiusTrackItem[] = [];

  const fetchAudiusQuery = async (query: string): Promise<AudiusTrackItem[]> => {
    try {
      const searchUrl = `https://api.audius.co/v1/tracks/search?query=${encodeURIComponent(
        query
      )}&app_name=VIBRA`;
      const res = await fetch(searchUrl, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(2600),
      });
      if (!res.ok) return [];
      const json = (await res.json()) as { data?: AudiusTrackItem[] };
      return Array.isArray(json.data) ? json.data.slice(0, 10) : [];
    } catch {
      return [];
    }
  };

  const audiusBatches = await Promise.all(parsed.searchQueries.slice(0, 2).map(fetchAudiusQuery));
  for (const list of audiusBatches) {
    collected.push(...list);
  }

  let best: { item: AudiusTrackItem; streamUrl: string; score: number } | null = null;
  for (const item of collected) {
    if (!item.id || item.is_streamable === false || item.is_stream_gated) continue;
    const candDuration = Number(item.duration || 0);
    if (candDuration > 0 && candDuration < 65) continue;

    const candTitle = decodeEntities(item.title || '');
    const candArtist = decodeEntities(item.user?.name || item.user?.handle || '');
    const score = scoreAudioCandidate({
      candTitle,
      candArtists: candArtist,
      candDuration,
      ytDuration,
      rawYtTitle: title,
      songCoreTokens: parsed.songCoreTokens,
      artistTokens: parsed.artistTokens,
      cleanedYtTitle: parsed.cleanedTitle,
      allowExtendedVariants: true,
    });

    if (score < 64) continue;
    const streamUrl =
      item.stream?.url || `https://api.audius.co/v1/tracks/${encodeURIComponent(item.id)}/stream?app_name=VIBRA`;

    if (!best || score > best.score) {
      best = { item, streamUrl, score };
    }
  }

  if (!best) return null;

  return {
    result: {
      mode: 'proxy',
      provider: 'audius',
      streamUrl: `/api/audio/stream?videoId=${encodeURIComponent(videoId)}`,
      matchedTitle: best.item.title,
      matchedArtist: best.item.user?.name || best.item.user?.handle,
      durationSeconds: best.item.duration || undefined,
    },
    upstreamKind: 'direct-url',
    upstreamUrl: best.streamUrl,
    upstreamHeaders: { 'User-Agent': 'Mozilla/5.0' },
    expiresAt: Date.now() + RESOLVE_TTL_MS,
  };
}

function parseArchiveLengthSec(raw: string | number | undefined): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.round(raw);
  if (typeof raw !== 'string') return 0;
  if (raw.includes(':')) {
    const parts = raw.split(':').map((n) => Number(n));
    if (parts.length === 2 && parts.every(Number.isFinite)) return parts[0] * 60 + Math.round(parts[1]);
    if (parts.length === 3 && parts.every(Number.isFinite))
      return parts[0] * 3600 + parts[1] * 60 + Math.round(parts[2]);
  }
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

interface ArchiveDoc {
  identifier?: string;
  title?: string;
  creator?: string | string[];
}

interface ArchiveFileEntry {
  name?: string;
  format?: string;
  length?: string | number;
  size?: string | number;
}

async function resolveArchiveAudioFile(identifier: string): Promise<{ url: string; duration: number } | null> {
  try {
    const metaRes = await fetch(`https://archive.org/metadata/${encodeURIComponent(identifier)}/files`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!metaRes.ok) return null;
    const meta = (await metaRes.json()) as { result?: ArchiveFileEntry[] };
    const files = meta.result ?? [];
    const candidate =
      files.find((f) => /\.mp3$/i.test(f.name || '') && Number(f.size || 0) > 100_000) ||
      files.find((f) => /\.(m4a|ogg)$/i.test(f.name || '') && Number(f.size || 0) > 100_000);
    if (!candidate?.name) return null;
    const encodedName = candidate.name
      .split('/')
      .map((seg) => encodeURIComponent(seg))
      .join('/');
    const dur = parseArchiveLengthSec(candidate.length);
    if (dur > 0 && dur < 65) return null;
    return {
      url: `https://archive.org/download/${encodeURIComponent(identifier)}/${encodedName}`,
      duration: dur,
    };
  } catch {
    return null;
  }
}

async function resolveViaArchiveOrg(
  videoId: string,
  title: string,
  artist: string,
  ytDuration: number
): Promise<InternalResolvedEntry | null> {
  const parsed = parseYouTubeMetadata(title, artist);
  const mainQuery = parsed.searchQueries[0];
  if (!mainQuery) return null;

  try {
    const searchUrl = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(
      `mediatype:audio AND (${mainQuery})`
    )}&fl[]=identifier,title,creator&rows=5&output=json`;
    const res = await fetch(searchUrl, { signal: AbortSignal.timeout(2200) });
    if (!res.ok) return null;
    const data = (await res.json()) as { response?: { docs?: ArchiveDoc[] } };
    const docs = data.response?.docs ?? [];

    const matchedDocs = docs.slice(0, 3).filter((doc) => {
      if (!doc.identifier || !doc.title) return false;
      const creatorStr = Array.isArray(doc.creator) ? doc.creator.join(', ') : doc.creator || '';
      const preScore = scoreAudioCandidate({
        candTitle: doc.title,
        candArtists: creatorStr,
        candDuration: 0,
        ytDuration,
        rawYtTitle: title,
        songCoreTokens: parsed.songCoreTokens,
        artistTokens: parsed.artistTokens,
        cleanedYtTitle: parsed.cleanedTitle,
        allowExtendedVariants: true,
      });
      return preScore >= 68;
    });

    if (matchedDocs.length > 0) {
      const docFiles = await Promise.all(
        matchedDocs.slice(0, 2).map(async (doc) => ({
          doc,
          fileInfo: await resolveArchiveAudioFile(doc.identifier!),
        }))
      );
      const valid = docFiles.find((d) => Boolean(d.fileInfo));
      if (valid && valid.fileInfo) {
        const creatorStr = Array.isArray(valid.doc.creator)
          ? valid.doc.creator.join(', ')
          : valid.doc.creator || '';
        return {
          result: {
            mode: 'proxy',
            provider: 'archive',
            streamUrl: `/api/audio/stream?videoId=${encodeURIComponent(videoId)}`,
            matchedTitle: valid.doc.title,
            matchedArtist: creatorStr || 'Internet Archive',
            durationSeconds: valid.fileInfo.duration || undefined,
          },
          upstreamKind: 'direct-url',
          upstreamUrl: valid.fileInfo.url,
          upstreamHeaders: { 'User-Agent': 'Mozilla/5.0' },
          expiresAt: Date.now() + RESOLVE_TTL_MS,
        };
      }
    }
  } catch {
    // ignore Archive.org error
  }
  return null;
}

export async function resolveBackgroundAudioStream(
  videoId: string,
  title: string,
  artist: string,
  durationSeconds = 0
): Promise<ResolvedAudioStream> {
  const existing = resolvedCache.get(videoId);
  if (existing && existing.expiresAt > Date.now()) {
    return existing.result;
  }

  const pending = inFlightResolves.get(videoId);
  if (pending) {
    const done = await pending;
    return done.result;
  }

  const job = (async (): Promise<InternalResolvedEntry> => {
    // Launch JioSaavn, SoundCloud, and Audius IN PARALLEL instead of sequentially!
    // If JioSaavn resolves first (~350-550ms), return immediately; otherwise SoundCloud/Audius are already ready!
    const saavnPromise = resolveViaJioSaavn(videoId, title, artist, durationSeconds).catch(() => null);
    const scPromise = resolveViaSoundCloud(videoId, title, artist, durationSeconds).catch(() => null);
    const audiusPromise = resolveViaAudius(videoId, title, artist, durationSeconds).catch(() => null);

    const saavnEntry = await saavnPromise;
    if (saavnEntry) {
      resolvedCache.set(videoId, saavnEntry);
      return saavnEntry;
    }

    const scEntry = await scPromise;
    if (scEntry) {
      resolvedCache.set(videoId, scEntry);
      if (scEntry.upstreamKind === 'soundcloud-hls-fmp4') {
        // Pre-fetch manifest right away so progressive streaming begins immediately
        void fetchSoundCloudManifest(scEntry);
      }
      return scEntry;
    }

    const audiusEntry = await audiusPromise;
    if (audiusEntry) {
      resolvedCache.set(videoId, audiusEntry);
      return audiusEntry;
    }

    // Fast fallback race for public-domain Archive.org
    const archiveEntry = await resolveViaArchiveOrg(videoId, title, artist, durationSeconds).catch(
      () => null
    );
    if (archiveEntry) {
      resolvedCache.set(videoId, archiveEntry);
      return archiveEntry;
    }

    // No verified audio match -> client falls back to official YouTube IFrame
    const ytFallback: InternalResolvedEntry = {
      result: { mode: 'youtube' },
      expiresAt: Date.now() + NEGATIVE_TTL_MS,
    };
    resolvedCache.set(videoId, ytFallback);
    return ytFallback;
  })().finally(() => {
    inFlightResolves.delete(videoId);
  });

  inFlightResolves.set(videoId, job);

  while (resolvedCache.size > MAX_RESOLVED_CACHE) {
    const oldest = resolvedCache.keys().next().value;
    if (oldest !== undefined) resolvedCache.delete(oldest);
    else break;
  }

  const resolved = await job;
  return resolved.result;
}

export async function prewarmAudioStreamsBatch(
  items: Array<{ videoId: string; title: string; artist?: string; durationSeconds?: number }>
): Promise<Record<string, ResolvedAudioStream>> {
  const limited = items.slice(0, 8).filter((item) => item.videoId && item.title);
  const settled = await Promise.all(
    limited.map(async (item) => {
      const res = await resolveBackgroundAudioStream(
        item.videoId,
        item.title,
        item.artist || '',
        item.durationSeconds || 0
      ).catch((): ResolvedAudioStream => ({ mode: 'youtube' }));
      return [item.videoId, res] as const;
    })
  );
  return Object.fromEntries(settled);
}

export async function proxyAudioStream(req: Request, res: Response, videoId: string): Promise<void> {
  let entry = resolvedCache.get(videoId);

  // If not yet resolved (or expired) and query has title metadata, resolve on-the-fly so synchronous <audio src="/api/audio/stream?..."> works in 1 step!
  if ((!entry || entry.expiresAt <= Date.now() || !entry.upstreamUrl) && typeof req.query.title === 'string') {
    const title = req.query.title.slice(0, 180);
    const artist = typeof req.query.artist === 'string' ? req.query.artist.slice(0, 120) : '';
    const dur = Number(req.query.duration);
    await resolveBackgroundAudioStream(videoId, title, artist, Number.isFinite(dur) && dur > 0 ? dur : 0);
    entry = resolvedCache.get(videoId);
  }

  if (!entry || entry.expiresAt <= Date.now() || !entry.upstreamUrl) {
    res.status(404).json({ error: 'AUDIO_STREAM_UNAVAILABLE', message: 'Audio stream unavailable.' });
    return;
  }

  const wantsDownload = req.query.download === '1' || req.query.download === 'true';
  const rawFileBase =
    typeof req.query.filename === 'string' && req.query.filename.trim()
      ? req.query.filename.trim()
      : `${entry.result.matchedTitle || 'vibra-track'}`;
  const cleanFileBase = rawFileBase.replace(/[^\w\s.-]/g, '').trim().slice(0, 80) || 'vibra-track';

  // Case A: SoundCloud fMP4 (progressive stream on initial byte-0 play; instant 206 Range once assembled or when resuming/seeking!)
  if (entry.upstreamKind === 'soundcloud-hls-fmp4') {
    const rangeHeader = req.headers.range;
    const wantsSeekable = req.query.seek === '1' || req.query.resume === '1';
    const isInitialZeroStream =
      !wantsDownload &&
      !wantsSeekable &&
      !entry.assembledBuffer &&
      (!rangeHeader || rangeHeader === 'bytes=0-');

    if (isInitialZeroStream) {
      await streamSoundCloudFmp4Progressive(entry, req, res, cleanFileBase, false);
      return;
    }

    const buf = await assembleSoundCloudFmp4Buffer(entry);
    if (!buf || buf.length === 0) {
      res.status(502).json({ error: 'SC_STREAM_FAILED', message: 'Failed to assemble audio stream.' });
      return;
    }

    const total = buf.length;
    const scMime = entry.upstreamMimeType || 'audio/mp4';
    res.setHeader('Content-Type', scMime);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=900');
    if (wantsDownload) {
      const ext = scMime === 'audio/mpeg' ? '.mp3' : '.m4a';
      const dlName = cleanFileBase.endsWith(ext) ? cleanFileBase : `${cleanFileBase}${ext}`;
      res.setHeader('Content-Disposition', `attachment; filename="${dlName}"`);
    }

    if (typeof rangeHeader === 'string' && rangeHeader.startsWith('bytes=')) {
      const [startStr, endStr] = rangeHeader.replace(/bytes=/, '').split('-');
      const start = Math.max(0, parseInt(startStr, 10) || 0);
      const end = endStr ? Math.min(total - 1, parseInt(endStr, 10)) : total - 1;
      if (start >= total || start > end) {
        res.status(416).setHeader('Content-Range', `bytes */${total}`).end();
        return;
      }
      const chunk = buf.subarray(start, end + 1);
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
      res.setHeader('Content-Length', String(chunk.length));
      res.end(chunk);
      return;
    }

    res.status(200);
    res.setHeader('Content-Length', String(total));
    res.end(buf);
    return;
  }

  // Case B: Direct upstream byte-range proxy (JioSaavn 320kbps MP4, SoundCloud progressive MP3, Audius MP3, Archive.org MP3)
  const buildHeaders = (e: InternalResolvedEntry) => {
    const h: Record<string, string> = { ...(e.upstreamHeaders ?? {}) };
    if (typeof req.headers.range === 'string' && req.headers.range.startsWith('bytes=')) {
      h.Range = req.headers.range;
    }
    return h;
  };

  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });

  try {
    let upstreamRes = await fetch(entry.upstreamUrl, {
      headers: buildHeaders(entry),
      signal: controller.signal,
    });

    // If cached signed CDN token expired (401/403/410), re-resolve once transparently
    if (
      (upstreamRes.status === 401 || upstreamRes.status === 403 || upstreamRes.status === 410) &&
      typeof req.query.title === 'string'
    ) {
      resolvedCache.delete(videoId);
      const title = req.query.title.slice(0, 180);
      const artist = typeof req.query.artist === 'string' ? req.query.artist.slice(0, 120) : '';
      const dur = Number(req.query.duration);
      await resolveBackgroundAudioStream(videoId, title, artist, Number.isFinite(dur) && dur > 0 ? dur : 0);
      const refreshed = resolvedCache.get(videoId);
      if (refreshed?.upstreamUrl) {
        entry = refreshed;
        upstreamRes = await fetch(refreshed.upstreamUrl, {
          headers: buildHeaders(refreshed),
          signal: controller.signal,
        });
      }
    }

    if (!upstreamRes.ok && upstreamRes.status !== 206) {
      if (!res.headersSent) {
        res.status(upstreamRes.status).end();
      }
      return;
    }

    const ct = upstreamRes.headers.get('content-type') || 'audio/mp4';
    res.status(upstreamRes.status);
    res.setHeader('Content-Type', ct);
    res.setHeader('Accept-Ranges', upstreamRes.headers.get('accept-ranges') || 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=900');

    if (wantsDownload) {
      const ext = ct.includes('mpeg') ? '.mp3' : ct.includes('ogg') ? '.ogg' : '.m4a';
      const dlName = /\.(mp3|m4a|ogg|wav|flac)$/i.test(cleanFileBase)
        ? cleanFileBase
        : `${cleanFileBase}${ext}`;
      res.setHeader('Content-Disposition', `attachment; filename="${dlName}"`);
    }

    const contentLength = upstreamRes.headers.get('content-length');
    if (contentLength) res.setHeader('Content-Length', contentLength);

    const contentRange = upstreamRes.headers.get('content-range');
    if (contentRange) res.setHeader('Content-Range', contentRange);

    if (!upstreamRes.body) {
      res.end();
      return;
    }

    const nodeStream = Readable.fromWeb(upstreamRes.body as unknown as import('node:stream/web').ReadableStream);
    nodeStream.on('error', () => {
      if (!res.writableEnded) res.end();
    });
    nodeStream.pipe(res);
  } catch (err) {
    if (controller.signal.aborted) return;
    if (!res.headersSent) {
      res.status(502).json({
        error: 'AUDIO_PROXY_ERROR',
        message: err instanceof Error ? err.message : 'Unable to stream audio.',
      });
    }
  }
}

export async function searchMultiSourceTracks(
  query: string,
  source: 'all' | AudioSourceProvider = 'all'
): Promise<MultiSourceTrackResult[]> {
  const cleanQ = query.trim();
  if (!cleanQ) return [];

  const want = (p: AudioSourceProvider) => source === 'all' || source === p;

  const searchSaavn = async (): Promise<MultiSourceTrackResult[]> => {
    if (!want('jiosaavn')) return [];
    try {
      const res = await fetch(
        `https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&_marker=0&cc=in&n=8&q=${encodeURIComponent(
          cleanQ
        )}`,
        { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(4500) }
      );
      if (!res.ok) return [];
      const data = (await res.json()) as {
        results?: Array<SaavnSearchResultItem & { image?: string }>;
      };
      const items = data.results ?? [];
      const mapped: MultiSourceTrackResult[] = [];

      for (const item of items.slice(0, 6)) {
        const title = decodeEntities(item.song || item.title || '');
        const artist = decodeEntities(
          [item.primary_artists, item.singers, item.music].filter(Boolean).join(', ') || 'JioSaavn'
        );
        const dur = Number(item.duration || item.more_info?.duration || 0);
        let encUrl = item.encrypted_media_url || item.more_info?.encrypted_media_url || '';
        if (!encUrl && item.id) {
          try {
            const detRes = await fetch(
              `https://www.jiosaavn.com/api.php?__call=song.getDetails&_format=json&_marker=0&cc=in&pids=${encodeURIComponent(
                item.id
              )}`,
              { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(3000) }
            );
            if (detRes.ok) {
              const det = (await detRes.json()) as { songs?: SaavnSearchResultItem[]; [k: string]: unknown };
              const sObj = (det.songs?.[0] ?? det[item.id]) as SaavnSearchResultItem | undefined;
              encUrl = sObj?.more_info?.encrypted_media_url || sObj?.encrypted_media_url || '';
            }
          } catch {
            // ignore
          }
        }
        if (!encUrl || !title) continue;

        const authRes = await fetch(
          `https://www.jiosaavn.com/api.php?__call=song.generateAuthToken&url=${encodeURIComponent(
            encUrl
          )}&bitrate=160&api_version=4&_format=json&ctx=web6dot0&_marker=0`,
          { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(3500) }
        ).catch(() => null);
        if (!authRes || !authRes.ok) continue;
        const authJson = (await authRes.json()) as { auth_url?: string };
        if (!authJson.auth_url) continue;

        const cleanId = (item.id || Math.random().toString(36).slice(2, 10)).replace(/[^a-zA-Z0-9_-]/g, '');
        const trackId = `src_js_${cleanId}`;
        const thumb = (item.image || '').replace('150x150', '500x500').replace('http://', 'https://');

        resolvedCache.set(trackId, {
          result: {
            mode: 'proxy',
            provider: 'jiosaavn',
            streamUrl: `/api/audio/stream?videoId=${encodeURIComponent(trackId)}`,
            matchedTitle: title,
            matchedArtist: artist,
            durationSeconds: dur || undefined,
          },
          upstreamKind: 'direct-url',
          upstreamUrl: authJson.auth_url,
          upstreamHeaders: {
            Referer: 'https://www.jiosaavn.com/',
            Origin: 'https://www.jiosaavn.com',
            'User-Agent': 'Mozilla/5.0',
          },
          expiresAt: Date.now() + 60 * 60 * 1000,
        });

        mapped.push({
          id: trackId,
          title,
          artist,
          duration: formatDurLabel(dur),
          durationSeconds: dur,
          thumbnail: thumb,
          thumbnailHigh: thumb,
          provider: 'jiosaavn',
          sourceLabel: 'JioSaavn 320kbps',
        });
      }
      return mapped;
    } catch {
      return [];
    }
  };

  const searchAudius = async (): Promise<MultiSourceTrackResult[]> => {
    if (!want('audius')) return [];
    try {
      const res = await fetch(
        `https://api.audius.co/v1/tracks/search?query=${encodeURIComponent(cleanQ)}&app_name=VIBRA`,
        { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(4500) }
      );
      if (!res.ok) return [];
      const json = (await res.json()) as { data?: AudiusTrackItem[] };
      const items = (json.data ?? []).filter(
        (t) => t.id && t.is_streamable !== false && !t.is_stream_gated
      );

      return items.slice(0, 8).map((item) => {
        const cleanId = String(item.id).replace(/[^a-zA-Z0-9_-]/g, '');
        const trackId = `src_au_${cleanId}`;
        const title = decodeEntities(item.title || 'Audius Track');
        const artist = decodeEntities(item.user?.name || item.user?.handle || 'Audius Artist');
        const dur = Number(item.duration || 0);
        const streamUrl =
          item.stream?.url ||
          `https://api.audius.co/v1/tracks/${encodeURIComponent(String(item.id))}/stream?app_name=VIBRA`;
        const thumb = item.artwork?.['480x480'] || item.artwork?.['150x150'] || '';

        resolvedCache.set(trackId, {
          result: {
            mode: 'proxy',
            provider: 'audius',
            streamUrl: `/api/audio/stream?videoId=${encodeURIComponent(trackId)}`,
            matchedTitle: title,
            matchedArtist: artist,
            durationSeconds: dur || undefined,
          },
          upstreamKind: 'direct-url',
          upstreamUrl: streamUrl,
          upstreamHeaders: { 'User-Agent': 'Mozilla/5.0' },
          expiresAt: Date.now() + 60 * 60 * 1000,
        });

        return {
          id: trackId,
          title,
          artist,
          duration: formatDurLabel(dur),
          durationSeconds: dur,
          thumbnail: thumb,
          thumbnailHigh: thumb,
          provider: 'audius',
          sourceLabel: 'Audius MP3',
        };
      });
    } catch {
      return [];
    }
  };

  const searchSoundCloud = async (): Promise<MultiSourceTrackResult[]> => {
    if (!want('soundcloud')) return [];
    try {
      const clientId = await getSoundCloudClientId();
      if (!clientId) return [];
      const res = await fetch(
        `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(cleanQ)}&client_id=${encodeURIComponent(
          clientId
        )}&limit=8`,
        { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(4500) }
      );
      if (!res.ok) return [];
      const json = (await res.json()) as {
        collection?: Array<SoundCloudTrackItem & { id?: number; artwork_url?: string }>;
      };
      const items = (json.collection ?? []).filter(
        (t) => t.id && t.streamable && t.policy !== 'SNIP' && t.policy !== 'BLOCK'
      );

      const mapped: MultiSourceTrackResult[] = [];
      for (const item of items.slice(0, 6)) {
        const transcodings = item.media?.transcodings ?? [];
        const chosen =
          transcodings.find((t) => t.format?.protocol === 'progressive' && t.url) ||
          transcodings.find((t) => t.format?.protocol === 'hls' && t.format?.mime_type?.includes('mp4') && t.url) ||
          transcodings.find((t) => t.format?.protocol === 'hls' && t.url);
        if (!chosen?.url) continue;

        const signRes = await fetch(`${chosen.url}?client_id=${encodeURIComponent(clientId)}`, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(3500),
        }).catch(() => null);
        if (!signRes || !signRes.ok) continue;
        const signJson = (await signRes.json()) as { url?: string };
        if (!signJson.url) continue;

        const trackId = `src_sc_${item.id}`;
        const title = decodeEntities(item.title || 'SoundCloud Track');
        const artist = decodeEntities(item.user?.username || 'SoundCloud');
        const dur = item.duration ? Math.round(item.duration / 1000) : 0;
        const thumb = (item.artwork_url || '').replace('-large', '-t500x500');

        resolvedCache.set(trackId, {
          result: {
            mode: 'proxy',
            provider: 'soundcloud',
            streamUrl: `/api/audio/stream?videoId=${encodeURIComponent(trackId)}`,
            matchedTitle: title,
            matchedArtist: artist,
            durationSeconds: dur || undefined,
          },
          upstreamKind: chosen.format?.protocol === 'progressive' ? 'direct-url' : 'soundcloud-hls-fmp4',
          upstreamUrl: signJson.url,
          scTranscodingUrl: chosen.url,
          upstreamHeaders: { 'User-Agent': 'Mozilla/5.0' },
          expiresAt: Date.now() + 60 * 60 * 1000,
        });

        mapped.push({
          id: trackId,
          title,
          artist,
          duration: formatDurLabel(dur),
          durationSeconds: dur,
          thumbnail: thumb,
          thumbnailHigh: thumb,
          provider: 'soundcloud',
          sourceLabel: 'SoundCloud',
        });
      }
      return mapped;
    } catch {
      return [];
    }
  };

  const searchArchive = async (): Promise<MultiSourceTrackResult[]> => {
    if (!want('archive')) return [];
    try {
      const res = await fetch(
        `https://archive.org/advancedsearch.php?q=${encodeURIComponent(
          `mediatype:audio AND (${cleanQ})`
        )}&fl[]=identifier,title,creator&rows=5&output=json`,
        { signal: AbortSignal.timeout(4500) }
      );
      if (!res.ok) return [];
      const json = (await res.json()) as { response?: { docs?: ArchiveDoc[] } };
      const docs = json.response?.docs ?? [];
      const mapped: MultiSourceTrackResult[] = [];

      for (const doc of docs.slice(0, 4)) {
        if (!doc.identifier || !doc.title) continue;
        const fileInfo = await resolveArchiveAudioFile(doc.identifier);
        if (!fileInfo) continue;

        const safeId = doc.identifier.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
        const trackId = `src_ar_${safeId}`;
        const artist = Array.isArray(doc.creator)
          ? doc.creator.join(', ')
          : doc.creator || 'Internet Archive';
        const thumb = `https://archive.org/services/img/${encodeURIComponent(doc.identifier)}`;

        resolvedCache.set(trackId, {
          result: {
            mode: 'proxy',
            provider: 'archive',
            streamUrl: `/api/audio/stream?videoId=${encodeURIComponent(trackId)}`,
            matchedTitle: doc.title,
            matchedArtist: artist,
            durationSeconds: fileInfo.duration || undefined,
          },
          upstreamKind: 'direct-url',
          upstreamUrl: fileInfo.url,
          upstreamHeaders: { 'User-Agent': 'Mozilla/5.0' },
          expiresAt: Date.now() + 60 * 60 * 1000,
        });

        mapped.push({
          id: trackId,
          title: doc.title,
          artist,
          duration: formatDurLabel(fileInfo.duration),
          durationSeconds: fileInfo.duration,
          thumbnail: thumb,
          thumbnailHigh: thumb,
          provider: 'archive',
          sourceLabel: 'Internet Archive',
        });
      }
      return mapped;
    } catch {
      return [];
    }
  };

  const [saavn, audius, sc, archive] = await Promise.all([
    searchSaavn(),
    searchAudius(),
    searchSoundCloud(),
    searchArchive(),
  ]);

  // Interleave results across sources so all providers show up clearly in 'all' mode
  const buckets = [saavn, audius, sc, archive].filter((b) => b.length > 0);
  const combined: MultiSourceTrackResult[] = [];
  const maxLen = Math.max(0, ...buckets.map((b) => b.length));
  for (let i = 0; i < maxLen; i++) {
    for (const bucket of buckets) {
      if (bucket[i]) combined.push(bucket[i]);
    }
  }
  return combined.slice(0, 24);
}

function isDisallowedHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (
    !lower ||
    lower === 'localhost' ||
    lower.endsWith('.local') ||
    lower.endsWith('.internal') ||
    lower === '::1' ||
    lower === '[::1]'
  ) {
    return true;
  }
  if (/^127\./.test(lower) || /^10\./.test(lower) || /^0\./.test(lower) || /^192\.168\./.test(lower)) {
    return true;
  }
  if (/^169\.254\./.test(lower)) return true;
  const m172 = lower.match(/^172\.(\d+)\./);
  if (m172 && Number(m172[1]) >= 16 && Number(m172[1]) <= 31) return true;
  return false;
}

export async function proxyDirectAudioUrl(req: Request, res: Response, rawUrl: string): Promise<void> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    res.status(400).json({ error: 'INVALID_URL', message: 'Please enter a valid HTTP or HTTPS audio link.' });
    return;
  }

  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
    res.status(400).json({ error: 'UNSUPPORTED_PROTOCOL', message: 'Only HTTP/HTTPS audio URLs are supported.' });
    return;
  }
  if (isDisallowedHost(parsedUrl.hostname)) {
    res.status(403).json({ error: 'BLOCKED_HOST', message: 'Private or local network URLs are not allowed.' });
    return;
  }

  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });

  try {
    const upstream = await fetch(parsedUrl.toString(), {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      redirect: 'follow',
      signal: controller.signal,
    });

    if (upstream.url) {
      const finalHost = new URL(upstream.url).hostname;
      if (isDisallowedHost(finalHost)) {
        res.status(403).json({ error: 'BLOCKED_HOST', message: 'Redirect to private network blocked.' });
        return;
      }
    }

    if (!upstream.ok) {
      res.status(upstream.status).json({
        error: 'UPSTREAM_ERROR',
        message: `Audio URL returned HTTP ${upstream.status}.`,
      });
      return;
    }

    const ct = (upstream.headers.get('content-type') || '').toLowerCase();
    const looksLikeAudioUrl = /\.(mp3|m4a|aac|wav|ogg|opus|flac|webm)(\?|$)/i.test(parsedUrl.pathname);
    if (!ct.startsWith('audio/') && !ct.includes('ogg') && !(looksLikeAudioUrl && ct.includes('octet-stream'))) {
      res.status(415).json({
        error: 'NOT_AUDIO_URL',
        message: 'That link does not point to a playable audio file (.mp3, .m4a, .wav, .ogg, .flac).',
      });
      return;
    }

    const clRaw = upstream.headers.get('content-length');
    const clNum = clRaw ? Number(clRaw) : 0;
    if (clNum > 120 * 1024 * 1024) {
      res.status(413).json({ error: 'FILE_TOO_LARGE', message: 'Audio file exceeds 120 MB limit.' });
      return;
    }

    res.status(200);
    res.setHeader('Content-Type', ct.startsWith('audio/') ? ct : 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    if (clRaw) res.setHeader('Content-Length', clRaw);

    if (!upstream.body) {
      res.end();
      return;
    }

    const nodeStream = Readable.fromWeb(upstream.body as unknown as import('node:stream/web').ReadableStream);
    nodeStream.on('error', () => {
      if (!res.writableEnded) res.end();
    });
    nodeStream.pipe(res);
  } catch (err) {
    if (controller.signal.aborted) return;
    if (!res.headersSent) {
      res.status(502).json({
        error: 'FETCH_AUDIO_FAILED',
        message: err instanceof Error ? err.message : 'Unable to download from that URL.',
      });
    }
  }
}
