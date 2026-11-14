import type { Request, Response } from 'express';
import { Readable } from 'node:stream';

export interface ResolvedAudioStream {
  mode: 'proxy' | 'hls' | 'direct' | 'youtube';
  provider?: 'jiosaavn' | 'soundcloud';
  streamUrl?: string;
  matchedTitle?: string;
  matchedArtist?: string;
  durationSeconds?: number;
}

interface InternalResolvedEntry {
  result: ResolvedAudioStream;
  upstreamKind?: 'direct-url' | 'soundcloud-hls-fmp4';
  upstreamUrl?: string;
  upstreamHeaders?: Record<string, string>;
  scTranscodingUrl?: string;
  assembledBuffer?: Buffer;
  assemblingPromise?: Promise<Buffer | null>;
  expiresAt: number;
}

const RESOLVE_TTL_MS = 25 * 60 * 1000;
const NEGATIVE_TTL_MS = 8 * 60 * 1000;
const resolvedCache = new Map<string, InternalResolvedEntry>();
const inFlightResolves = new Map<string, Promise<InternalResolvedEntry>>();

let cachedScClientId = '';
let cachedScClientIdExpires = 0;

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

  const candTokens = tokenizeMeaningful(candTitle);
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

  for (const query of parsed.searchQueries) {
    try {
      const searchUrl = `https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&_marker=0&cc=in&n=8&q=${encodeURIComponent(
        query
      )}`;
      const res = await fetch(searchUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as { results?: SaavnSearchResultItem[] };

      for (const item of data.results ?? []) {
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
        });

        if (score < 70) continue;

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

      if (bestCandidate && bestCandidate.score >= 95) break;
    } catch {
      // ignore timeout/network error on this attempt
    }
  }

  if (!bestCandidate) return null;

  try {
    const authRes = await fetch(
      `https://www.jiosaavn.com/api.php?__call=song.generateAuthToken&url=${encodeURIComponent(
        bestCandidate.encUrl
      )}&bitrate=160&api_version=4&_format=json&ctx=web6dot0&_marker=0`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(4000) }
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
  try {
    const homeRes = await fetch('https://soundcloud.com', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(4000),
    });
    if (!homeRes.ok) return null;
    const html = await homeRes.text();
    const scripts = [...html.matchAll(/https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js/g)].map((m) => m[0]);

    for (const scriptUrl of scripts.slice(-5)) {
      const jsRes = await fetch(scriptUrl, { signal: AbortSignal.timeout(4000) });
      if (!jsRes.ok) continue;
      const js = await jsRes.text();
      const match = js.match(/client_id\s*[:=]\s*"([a-zA-Z0-9]{20,40})"/);
      if (match?.[1]) {
        cachedScClientId = match[1];
        cachedScClientIdExpires = Date.now() + 12 * 60 * 60 * 1000;
        return cachedScClientId;
      }
    }
  } catch {
    // ignore SoundCloud bootstrap error
  }
  return null;
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

  for (const query of parsed.searchQueries) {
    try {
      const searchUrl = `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(
        query
      )}&client_id=${encodeURIComponent(clientId)}&limit=10`;
      const res = await fetch(searchUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as { collection?: SoundCloudTrackItem[] };
      if (data.collection) {
        collectedItems.push(...data.collection);
      }
      if (collectedItems.length >= 10) break;
    } catch {
      // ignore SoundCloud search failure
    }
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

    // Serve SoundCloud fMP4 HLS through /api/audio/stream as a native audio/mp4 stream so Android <audio> plays in background without hls.js MSE!
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
      upstreamUrl: signJson.url,
      scTranscodingUrl: best.transcodingUrl,
      expiresAt: Date.now() + RESOLVE_TTL_MS,
    };
  } catch {
    return null;
  }
}

async function assembleSoundCloudFmp4Buffer(entry: InternalResolvedEntry): Promise<Buffer | null> {
  if (entry.assembledBuffer) return entry.assembledBuffer;
  if (entry.assemblingPromise) return entry.assemblingPromise;

  const job = (async (): Promise<Buffer | null> => {
    try {
      let m3u8Url = entry.upstreamUrl;
      if (!m3u8Url && entry.scTranscodingUrl) {
        const cid = await getSoundCloudClientId();
        if (!cid) return null;
        const sr = await fetch(`${entry.scTranscodingUrl}?client_id=${encodeURIComponent(cid)}`, {
          signal: AbortSignal.timeout(4000),
        });
        if (!sr.ok) return null;
        const sj = (await sr.json()) as { url?: string };
        m3u8Url = sj.url;
      }
      if (!m3u8Url) return null;

      let m3u8Res = await fetch(m3u8Url, { signal: AbortSignal.timeout(4500) });
      if (!m3u8Res.ok && entry.scTranscodingUrl) {
        const cid = await getSoundCloudClientId();
        if (cid) {
          const sr = await fetch(`${entry.scTranscodingUrl}?client_id=${encodeURIComponent(cid)}`, {
            signal: AbortSignal.timeout(4000),
          });
          if (sr.ok) {
            const sj = (await sr.json()) as { url?: string };
            if (sj.url) {
              entry.upstreamUrl = sj.url;
              m3u8Res = await fetch(sj.url, { signal: AbortSignal.timeout(4500) });
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

      const stripStypSidx = (buf: Buffer): Buffer => {
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
      };

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
    // 1. Prefer high-bitrate 320kbps MP4/AAC via JioSaavn proxy (native <audio src> + HTTP 206 Range seeking)
    const saavnEntry = await resolveViaJioSaavn(videoId, title, artist, durationSeconds);
    if (saavnEntry) {
      resolvedCache.set(videoId, saavnEntry);
      return saavnEntry;
    }

    // 2. Fallback to SoundCloud verified full-length fMP4/MP3 stream (also proxied as native audio/mp4 for Android background playback)
    const scEntry = await resolveViaSoundCloud(videoId, title, artist, durationSeconds);
    if (scEntry) {
      resolvedCache.set(videoId, scEntry);
      // Kick off background fMP4 buffer assembly immediately so /api/audio/stream is instant
      if (scEntry.upstreamKind === 'soundcloud-hls-fmp4') {
        void assembleSoundCloudFmp4Buffer(scEntry);
      }
      return scEntry;
    }

    // 3. No verified audio match -> client falls back to official YouTube IFrame
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

  // Evict oldest entries & free RAM buffers if cache grows
  if (resolvedCache.size > 150) {
    const oldest = resolvedCache.keys().next().value;
    if (oldest !== undefined) resolvedCache.delete(oldest);
  }

  const resolved = await job;
  return resolved.result;
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

  // Case A: SoundCloud fMP4 assembled into a native byte-range-capable audio/mp4 buffer
  if (entry.upstreamKind === 'soundcloud-hls-fmp4') {
    const buf = await assembleSoundCloudFmp4Buffer(entry);
    if (!buf || buf.length === 0) {
      res.status(502).json({ error: 'SC_STREAM_FAILED', message: 'Failed to assemble audio stream.' });
      return;
    }

    const total = buf.length;
    res.setHeader('Content-Type', 'audio/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=900');

    const rangeHeader = req.headers.range;
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

  // Case B: Direct upstream byte-range proxy (JioSaavn 320kbps MP4 or SoundCloud progressive MP3)
  const headers: Record<string, string> = {
    ...(entry.upstreamHeaders ?? {}),
  };
  if (typeof req.headers.range === 'string' && req.headers.range.startsWith('bytes=')) {
    headers.Range = req.headers.range;
  }

  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });

  try {
    const upstreamRes = await fetch(entry.upstreamUrl, {
      headers,
      signal: controller.signal,
    });

    if (!upstreamRes.ok && upstreamRes.status !== 206) {
      if (!res.headersSent) {
        res.status(upstreamRes.status).end();
      }
      return;
    }

    res.status(upstreamRes.status);
    res.setHeader('Content-Type', upstreamRes.headers.get('content-type') || 'audio/mp4');
    res.setHeader('Accept-Ranges', upstreamRes.headers.get('accept-ranges') || 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=900');

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
