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
  saavnEncUrl?: string;
  saavnSongId?: string;
  scTranscodingUrl?: string;
  scManifest?: { hasInitMap: boolean; allUrls: string[] };
  scManifestPromise?: Promise<{ hasInitMap: boolean; allUrls: string[] } | null>;
  assembledBuffer?: Buffer;
  assemblingPromise?: Promise<Buffer | null>;
  expiresAt: number;
}

const RESOLVE_TTL_MS = 25 * 60 * 1000;
const NEGATIVE_TTL_MS = 8 * 60 * 1000;
const MAX_RESOLVED_CACHE = 800;
const resolvedCache = new Map<string, InternalResolvedEntry>();
const inFlightResolves = new Map<string, Promise<InternalResolvedEntry>>();

let cachedScClientId = '';
let cachedScClientIdExpires = 0;
let inFlightScClientId: Promise<string | null> | null = null;

const BLOCKED_VARIANT_RE =
  /\b(slowed|reverb|reverbed|lofi|lo-fi|karaoke|instrumental|8d|16d|16-?bit|emulation|female\s*reply|male\s*reply|cover\s*version|tribute|ringtone|whatsapp\s*status|house\s*mix|dj\s*mix|mashup|parody|acoustic\s*cover|nightcore|sped\s*up|bootleg|ukg\s*flip|flip)\b/i;

const HARD_JUNK_RE =
  /\b(karaoke|instrumental|16-?bit|emulation|ringtone|whatsapp\s*status|parody|female\s*reply|male\s*reply|ukg\s*flip|flip|bootleg|slowed|reverb|reverbed|nightcore|sped\s*up|mashup|dj\s*mix|house\s*mix)\b/i;

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
  const allPipeSegments = decodeEntities(rawTitle)
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);

  const isShowPrefix = (seg: string) =>
    /^(coke\s*studio(\s*pakistan|\s*india|\s*season\s*\d+|\s*s\d+)?|t-?series\s*mixtape|mtv\s*unplugged|bollywood\s*classics)$/i.test(
      seg.replace(/\(.*?\)|\[.*?\]/g, '').trim()
    );

  const primaryPipeSeg =
    allPipeSegments.length > 1 && isShowPrefix(allPipeSegments[0])
      ? allPipeSegments[1]
      : allPipeSegments[0] || rawTitle;

  const extraCreditSegments = allPipeSegments
    .slice(allPipeSegments.length > 1 && isShowPrefix(allPipeSegments[0]) ? 2 : 1)
    .filter(
      (s) =>
        !/\b(official|music\s*video|lyric|audio|visuali[sz]er|8k|4k|hd|full\s*song|new\s*punjabi|punjabi\s*superhit|superhit|wedding\s*song|prod\.?\s*by|trending|#)\b/i.test(
          s
        )
    );

  const stripJunkTags = (str: string) =>
    str
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

  const cleanedTitle = stripJunkTags(primaryPipeSeg);

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
  let extractedArtistPart = [cleanedArtist, ...extraCreditSegments].filter(Boolean).join(' ').trim();

  if (cleanedTitle.includes(' - ')) {
    const [left, right] = cleanedTitle.split(' - ', 2).map((s) => s.trim());
    if (cleanedArtist && left.toLowerCase().includes(cleanedArtist.toLowerCase())) {
      extractedArtistPart = `${left} ${extractedArtistPart}`.trim();
      extractedSongPart = right;
    } else if (cleanedArtist && right.toLowerCase().includes(cleanedArtist.toLowerCase())) {
      extractedSongPart = left;
      extractedArtistPart = `${right} ${extractedArtistPart}`.trim();
    } else {
      const leftWords = tokenizeMeaningful(left);
      const rightWords = tokenizeMeaningful(right);
      const rightLooksLikeFeatOrMultiArtist = /,|\b(ft|feat|featuring)\b|&/i.test(right);
      const leftLooksLikeFeatOrMultiArtist = /,|\b(ft|feat|featuring)\b|&/i.test(left);

      if (leftLooksLikeFeatOrMultiArtist && !rightLooksLikeFeatOrMultiArtist && rightWords.length <= 5) {
        extractedArtistPart = `${left} ${extractedArtistPart}`.trim();
        extractedSongPart = right;
      } else if (
        rightLooksLikeFeatOrMultiArtist ||
        (leftWords.length >= 1 && leftWords.length <= 5 && rightWords.length >= 1 && rightWords.length <= 4)
      ) {
        extractedSongPart = left;
        extractedArtistPart = `${right} ${extractedArtistPart}`.trim();
      } else {
        extractedSongPart = right.length >= 2 ? right : cleanedTitle;
        if (left.length >= 2) extractedArtistPart = `${left} ${extractedArtistPart}`.trim();
      }
    }
  }

  // Always check if extractedSongPart still has "Artist/Movie: Song Title" colon prefix
  if (/^[A-Za-z0-9\s.'&-]{2,28}:\s+/.test(extractedSongPart)) {
    const colonIdx = extractedSongPart.indexOf(':');
    const left = extractedSongPart.slice(0, colonIdx).trim();
    const right = extractedSongPart.slice(colonIdx + 1).trim();
    if (right.length >= 2) {
      extractedSongPart = right;
      if (left.length >= 2) {
        extractedArtistPart = `${left} ${extractedArtistPart}`.trim();
      }
    }
  }

  const artistTokenList = Array.from(new Set(tokenizeMeaningful(`${extractedArtistPart} ${cleanedArtist}`)));
  const artistTokenSet = new Set(artistTokenList);

  const songWithoutFeat = extractedSongPart
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\b(ft|feat|featuring)\.?\s+.*$/i, '')
    .trim();
  const rawSongTokens = tokenizeMeaningful(songWithoutFeat || extractedSongPart);
  const strippedSongTokens = rawSongTokens.filter((t) => !artistTokenSet.has(t));
  const songCoreTokens =
    strippedSongTokens.length > 0
      ? strippedSongTokens
      : rawSongTokens.length > 0
        ? rawSongTokens
        : tokenizeMeaningful(cleanedTitle);

  const queries: string[] = [];
  const songOnly = songCoreTokens.slice(0, 5).join(' ');
  const primaryArtistOnly = tokenizeMeaningful(cleanedArtist || extractedArtistPart)
    .slice(0, 3)
    .join(' ');

  if (songOnly && primaryArtistOnly) {
    queries.push(`${songOnly} ${primaryArtistOnly}`.trim());
  }
  if (songOnly) {
    queries.push(songOnly);
  }
  if (songCoreTokens.length > 1 && primaryArtistOnly) {
    queries.push(`${songCoreTokens[0]} ${songCoreTokens[1]} ${primaryArtistOnly}`.trim());
  }
  const baseQuery =
    cleanedArtist && !cleanedTitle.toLowerCase().includes(cleanedArtist.toLowerCase())
      ? `${extractedSongPart} ${cleanedArtist}`.trim()
      : cleanedTitle.replace(/\s*-\s*/g, ' ').trim();
  if (baseQuery) queries.push(baseQuery);

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
  const candArtistTokenSet = new Set(candArtistTokens);
  if (candTokens.length === 0 || params.songCoreTokens.length === 0) return -1000;

  const fullYtHaystackTokens = new Set([
    ...tokenizeMeaningful(params.cleanedYtTitle),
    ...tokenizeMeaningful(params.rawYtTitle),
    ...params.songCoreTokens,
    ...params.artistTokens,
  ]);

  const candTokenSet = new Set(candTokens);

  // Exclude candidate artist tokens from songCoreTokens in case the YT title included the singer's name
  const effectiveSongCore = params.songCoreTokens.filter((t) => !candArtistTokenSet.has(t));
  const coreTargets = effectiveSongCore.length > 0 ? effectiveSongCore : params.songCoreTokens;

  // Verify artist attribution
  const candCombinedText = `${candArtists} ${candTitleLower}`;
  const artistHitCount =
    params.artistTokens.filter((t) => candCombinedText.includes(t)).length +
    candArtistTokens.filter((t) => fullYtHaystackTokens.has(t)).length;
  const artistMatched =
    params.artistTokens.length === 0 && candArtistTokens.length === 0 ? true : artistHitCount > 0;

  // Match song core tokens against candidate TITLE tokens
  const coreOverlap = coreTargets.filter(
    (t) => candTokenSet.has(t) || candTitleLower.includes(t)
  ).length;
  const rawCoreCoverage = coreOverlap / coreTargets.length;

  // Require proportional length match so a 1-word song like "Ishq" never steals "Ishq Wala Love"
  const candTitleInYtCount = candTokens.filter((t) => fullYtHaystackTokens.has(t)).length;
  const candTitleInYtRatio = candTitleInYtCount / candTokens.length;
  const lengthRatioOk =
    candTokens.length >= Math.max(1, coreTargets.length - 1);

  const coreCoverage =
    candTitleInYtRatio >= 0.85 && artistMatched && lengthRatioOk
      ? Math.max(rawCoreCoverage, 0.9)
      : rawCoreCoverage;

  if (coreOverlap === 0 || coreCoverage < 0.7) {
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
  const maxUnmatchedRatio = params.allowExtendedVariants ? 0.45 : 0.3;
  if (unmatchedCandTokens.length > 0 && unmatchedCandTokens.length / candTokens.length > maxUnmatchedRatio) {
    return -500;
  }

  // Duration sanity check (YouTube narrative music videos often have a 60s-140s intro/outro vs studio audio)
  let durScore = 0;
  if (params.ytDuration > 0 && params.candDuration > 0) {
    const diff = Math.abs(params.ytDuration - params.candDuration);
    const maxDiff = params.ytDuration > 240 ? 185 : 115;
    if (diff > maxDiff) return -500;
    if (diff <= 12) durScore = 35;
    else if (diff <= 28) durScore = 24;
    else if (diff <= 65) durScore = 15;
    else durScore = 6;
  }

  if (!artistMatched) {
    // Only allow unmatched artist when the full 3+ word title matches 100% AND duration is within 12s
    if (unmatchedCandTokens.length > 0 || coreCoverage < 1 || candTokens.length < 3 || durScore < 30) {
      return -200;
    }
  }

  let score = Math.round(coreCoverage * 60) + (artistMatched ? 40 : 0) + durScore;
  if (candTitleLower === params.cleanedYtTitle.toLowerCase()) score += 20;
  if (params.allowExtendedVariants) score -= 14;
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

      const threshold = allowExtendedVariants ? 80 : 72;
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

      if (score < (allowExtendedVariants ? 82 : 72)) continue;

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
      allowExtendedVariants: false,
    });

    if (score < 74) continue;
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
        allowExtendedVariants: false,
      });
      return preScore >= 74;
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

async function ensureSaavnUpstreamUrl(
  entry: InternalResolvedEntry,
  fallbackSaavnId?: string
): Promise<string | null> {
  if (entry.upstreamUrl) return entry.upstreamUrl;

  let encUrl = entry.saavnEncUrl || '';
  const songId = entry.saavnSongId || fallbackSaavnId || '';

  if (!encUrl && songId) {
    try {
      const detRes = await fetch(
        `https://www.jiosaavn.com/api.php?__call=song.getDetails&_format=json&_marker=0&cc=in&pids=${encodeURIComponent(
          songId
        )}`,
        { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(2600) }
      );
      if (detRes.ok) {
        const det = (await detRes.json()) as { songs?: SaavnSearchResultItem[]; [k: string]: unknown };
        const sObj = (det.songs?.[0] ?? det[songId]) as SaavnSearchResultItem | undefined;
        encUrl = sObj?.more_info?.encrypted_media_url || sObj?.encrypted_media_url || '';
        if (encUrl) entry.saavnEncUrl = encUrl;
      }
    } catch {
      // ignore
    }
  }

  if (!encUrl) return null;

  try {
    const authRes = await fetch(
      `https://www.jiosaavn.com/api.php?__call=song.generateAuthToken&url=${encodeURIComponent(
        encUrl
      )}&bitrate=160&api_version=4&_format=json&ctx=web6dot0&_marker=0`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(2600) }
    );
    if (!authRes.ok) return null;
    const authJson = (await authRes.json()) as { auth_url?: string };
    if (!authJson.auth_url) return null;

    entry.upstreamUrl = authJson.auth_url;
    entry.upstreamKind = 'direct-url';
    entry.upstreamHeaders = {
      Referer: 'https://www.jiosaavn.com/',
      Origin: 'https://www.jiosaavn.com',
      'User-Agent':
        'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36',
    };
    entry.expiresAt = Date.now() + RESOLVE_TTL_MS;
    return entry.upstreamUrl;
  } catch {
    return null;
  }
}

export async function resolveBackgroundAudioStream(
  videoId: string,
  title: string,
  artist: string,
  durationSeconds = 0
): Promise<ResolvedAudioStream> {
  const existing = resolvedCache.get(videoId);
  if (existing && existing.expiresAt > Date.now()) {
    if (existing.result.provider === 'jiosaavn' && !existing.upstreamUrl) {
      const saavnId = videoId.startsWith('src_js_') ? videoId.slice(7) : existing.saavnSongId;
      await ensureSaavnUpstreamUrl(existing, saavnId);
    }
    return existing.result;
  }

  // Direct JioSaavn ID recovery if cache was evicted
  if (videoId.startsWith('src_js_')) {
    const rawSaavnId = videoId.slice(7);
    const recoveredEntry: InternalResolvedEntry = {
      result: {
        mode: 'proxy',
        provider: 'jiosaavn',
        streamUrl: `/api/audio/stream?videoId=${encodeURIComponent(videoId)}`,
        matchedTitle: title || 'JioSaavn Track',
        matchedArtist: artist || 'Artist',
        durationSeconds: durationSeconds || undefined,
      },
      saavnSongId: rawSaavnId,
      upstreamKind: 'direct-url',
      expiresAt: Date.now() + RESOLVE_TTL_MS,
    };
    const signedUrl = await ensureSaavnUpstreamUrl(recoveredEntry, rawSaavnId);
    if (signedUrl) {
      resolvedCache.set(videoId, recoveredEntry);
      return recoveredEntry.result;
    }
  }

  const pending = inFlightResolves.get(videoId);
  if (pending) {
    const done = await pending;
    return done.result;
  }

  const job = (async (): Promise<InternalResolvedEntry> => {
    const resolveChain = (async (): Promise<InternalResolvedEntry | null> => {
      // Launch JioSaavn, SoundCloud, and Audius IN PARALLEL instead of sequentially!
      const saavnPromise = resolveViaJioSaavn(videoId, title, artist, durationSeconds).catch(() => null);
      const scPromise = resolveViaSoundCloud(videoId, title, artist, durationSeconds).catch(() => null);
      const audiusPromise = resolveViaAudius(videoId, title, artist, durationSeconds).catch(() => null);

      const saavnEntry = await saavnPromise;
      if (saavnEntry) return saavnEntry;

      const scEntry = await scPromise;
      if (scEntry) {
        if (scEntry.upstreamKind === 'soundcloud-hls-fmp4') {
          void fetchSoundCloudManifest(scEntry);
        }
        return scEntry;
      }

      const audiusEntry = await audiusPromise;
      if (audiusEntry) return audiusEntry;

      const archiveEntry = await resolveViaArchiveOrg(videoId, title, artist, durationSeconds).catch(
        () => null
      );
      if (archiveEntry) return archiveEntry;

      return null;
    })();

    // Strict 3.5-second budget so audio resolution never stalls song startup for 30-60s
    const timeoutGuard = new Promise<InternalResolvedEntry | null>((resolve) => {
      const t = setTimeout(() => resolve(null), 3500);
      t.unref?.();
    });

    const winner = await Promise.race([resolveChain, timeoutGuard]);
    if (winner) {
      resolvedCache.set(videoId, winner);
      return winner;
    }

    // No verified audio match within budget -> client falls back to official YouTube IFrame immediately
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

export async function fetchSaavnArtistCatalog(
  artistName: string,
  options?: { category?: string; page?: number; limit?: number }
): Promise<MultiSourceTrackResult[]> {
  const cleanArtist = artistName.trim();
  if (!cleanArtist) return [];

  const category = (options?.category || 'all').toLowerCase();
  const page = Math.max(1, options?.page ?? 1);
  const limit = Math.min(Math.max(options?.limit ?? 48, 8), 80);

  const artistTokens = tokenizeMeaningful(cleanArtist);

  const fetchSaavnPage = async (q: string, p: number, count = 40): Promise<Array<SaavnSearchResultItem & { image?: string }>> => {
    try {
      const url = `https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&_marker=0&cc=in&p=${p}&n=${count}&q=${encodeURIComponent(
        q
      )}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(3500),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as {
        results?: Array<SaavnSearchResultItem & { image?: string }>;
      };
      return data.results ?? [];
    } catch {
      return [];
    }
  };

  let queriesToRun: Array<{ q: string; p: number }> = [];
  if (category === 'all' && page === 1) {
    queriesToRun = [
      { q: cleanArtist, p: 1 },
      { q: cleanArtist, p: 2 },
      { q: `${cleanArtist} romantic songs`, p: 1 },
      { q: `${cleanArtist} sad songs`, p: 1 },
    ];
  } else if (category === 'all') {
    queriesToRun = [
      { q: cleanArtist, p: page * 2 - 1 },
      { q: cleanArtist, p: page * 2 },
    ];
  } else if (category === 'romantic') {
    queriesToRun = [
      { q: `${cleanArtist} romantic love songs`, p: page },
      { q: `${cleanArtist} ishq dil`, p: page },
    ];
  } else if (category === 'sad') {
    queriesToRun = [
      { q: `${cleanArtist} sad heartbreak songs`, p: page },
      { q: `${cleanArtist} emotional dard`, p: page },
    ];
  } else if (category === 'chill') {
    queriesToRun = [
      { q: `${cleanArtist} unplugged acoustic chill`, p: page },
      { q: `${cleanArtist} sufi melody`, p: page },
    ];
  } else if (category === 'energetic') {
    queriesToRun = [
      { q: `${cleanArtist} party dance hits`, p: page },
      { q: `${cleanArtist} upbeat beat`, p: page },
    ];
  } else if (category === 'classics') {
    queriesToRun = [
      { q: `${cleanArtist} evergreen classic hits`, p: page },
      { q: `${cleanArtist} best 90s old songs`, p: page },
    ];
  } else {
    queriesToRun = [
      { q: `${cleanArtist} top hits`, p: page },
      { q: cleanArtist, p: page },
    ];
  }

  const batches = await Promise.all(queriesToRun.map(({ q, p }) => fetchSaavnPage(q, p, 40)));
  const rawItems: Array<SaavnSearchResultItem & { image?: string }> = [];
  for (const batch of batches) {
    rawItems.push(...batch);
  }

  const seenIds = new Set<string>();
  const seenTitleKeys = new Set<string>();
  const results: MultiSourceTrackResult[] = [];

  for (const item of rawItems) {
    if (!item.id) continue;
    const cleanId = String(item.id).replace(/[^a-zA-Z0-9_-]/g, '');
    if (!cleanId || seenIds.has(cleanId)) continue;

    const title = decodeEntities(item.song || item.title || '').trim();
    if (!title || HARD_JUNK_RE.test(title)) continue;

    const artistsStr = decodeEntities(
      [item.primary_artists, item.singers, item.music].filter(Boolean).join(', ')
    ).trim();
    const combinedLower = `${artistsStr} ${title}`.toLowerCase();

    // Verify artist match so unrelated songs never pollute an artist's discography
    const matchedTokens = artistTokens.filter((tok) => combinedLower.includes(tok));
    if (artistTokens.length > 0 && matchedTokens.length === 0) continue;
    if (artistTokens.length >= 2 && matchedTokens.length < Math.min(2, artistTokens.length)) continue;

    const dur = Number(item.duration || item.more_info?.duration || 0);
    if (dur > 0 && dur < 65) continue;

    const titleKey = title
      .toLowerCase()
      .replace(/\(.*?\)|\[.*?\]/g, ' ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (titleKey && seenTitleKeys.has(titleKey)) continue;

    seenIds.add(cleanId);
    if (titleKey) seenTitleKeys.add(titleKey);

    const trackId = `src_js_${cleanId}`;
    const encUrl = item.encrypted_media_url || item.more_info?.encrypted_media_url || '';
    const thumb = (item.image || '').replace('150x150', '500x500').replace('http://', 'https://');
    const displayArtist = artistsStr ? artistsStr.split(',')[0].trim() || cleanArtist : cleanArtist;

    const existing = resolvedCache.get(trackId);
    if (!existing || existing.expiresAt <= Date.now()) {
      resolvedCache.set(trackId, {
        result: {
          mode: 'proxy',
          provider: 'jiosaavn',
          streamUrl: `/api/audio/stream?videoId=${encodeURIComponent(trackId)}`,
          matchedTitle: title,
          matchedArtist: artistsStr || cleanArtist,
          durationSeconds: dur || undefined,
        },
        saavnEncUrl: encUrl || undefined,
        saavnSongId: cleanId,
        upstreamKind: 'direct-url',
        expiresAt: Date.now() + 60 * 60 * 1000,
      });
    }

    results.push({
      id: trackId,
      title,
      artist: displayArtist,
      duration: formatDurLabel(dur),
      durationSeconds: dur,
      thumbnail: thumb,
      thumbnailHigh: thumb,
      provider: 'jiosaavn',
      sourceLabel: 'JioSaavn 320kbps',
    });

    if (results.length >= limit) break;
  }

  return results;
}

const POPULAR_COMPANION_SINGERS = [
  'Arijit Singh',
  'Shreya Ghoshal',
  'Jubin Nautiyal',
  'Diljit Dosanjh',
  'Karan Aujla',
  'Atif Aslam',
  'Sonu Nigam',
  'Armaan Malik',
  'Vishal Mishra',
  'Darshan Raval',
  'Badshah',
  'Yo Yo Honey Singh',
  'Sidhu Moose Wala',
  'Alka Yagnik',
  'Anuv Jain',
  'KK',
];

export async function fetchSaavnRelatedTracks(
  artistName: string,
  title: string,
  excludeIds: Set<string>,
  limit = 20
): Promise<MultiSourceTrackResult[]> {
  const cleanArtist = decodeEntities(artistName || '')
    .replace(/\b(t-?series|zee\s*music|sony\s*music|yrf|speed\s*records|saregama|official|topic)\b/gi, ' ')
    .replace(/[-|,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const cleanTitle = decodeEntities(title || '')
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Pick 2 rotating companion singers so radio never runs dry even after 50+ songs
  const hashSeed = (cleanTitle.length + cleanArtist.length + excludeIds.size) % POPULAR_COMPANION_SINGERS.length;
  const companionA = POPULAR_COMPANION_SINGERS[hashSeed];
  const companionB = POPULAR_COMPANION_SINGERS[(hashSeed + 5) % POPULAR_COMPANION_SINGERS.length];

  const queries = [
    cleanArtist ? `${cleanArtist} top songs` : 'Arijit Singh top songs',
    cleanTitle ? `${cleanTitle.split(' ').slice(0, 3).join(' ')} song` : `${companionA} hits`,
    `${companionA} best songs`,
    `${companionB} hit songs`,
  ];

  const pageOffset = Math.floor(excludeIds.size / 14) + 1;

  const fetchBatch = async (q: string, p: number) => {
    try {
      const url = `https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&_marker=0&cc=in&p=${p}&n=20&q=${encodeURIComponent(
        q
      )}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as {
        results?: Array<SaavnSearchResultItem & { image?: string }>;
      };
      return data.results ?? [];
    } catch {
      return [];
    }
  };

  const batches = await Promise.all([
    fetchBatch(queries[0], pageOffset),
    fetchBatch(queries[1], 1),
    fetchBatch(queries[2], (pageOffset % 3) + 1),
    fetchBatch(queries[3], 1),
  ]);

  const seedTitleNorm = cleanTitle.toLowerCase();
  const seenIds = new Set<string>(excludeIds);
  const seenTitles = new Set<string>();
  if (seedTitleNorm) seenTitles.add(seedTitleNorm);

  const out: MultiSourceTrackResult[] = [];
  const maxLen = Math.max(0, ...batches.map((b) => b.length));

  for (let i = 0; i < maxLen; i++) {
    for (const batch of batches) {
      const item = batch[i];
      if (!item?.id) continue;
      const cleanId = String(item.id).replace(/[^a-zA-Z0-9_-]/g, '');
      const trackId = `src_js_${cleanId}`;
      if (!cleanId || seenIds.has(trackId) || seenIds.has(cleanId)) continue;

      const songTitle = decodeEntities(item.song || item.title || '').trim();
      if (!songTitle || HARD_JUNK_RE.test(songTitle)) continue;

      const normTitle = songTitle
        .toLowerCase()
        .replace(/\(.*?\)|\[.*?\]/g, ' ')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!normTitle || seenTitles.has(normTitle)) continue;
      if (seedTitleNorm && (normTitle.includes(seedTitleNorm) || seedTitleNorm.includes(normTitle))) {
        continue;
      }

      const dur = Number(item.duration || item.more_info?.duration || 0);
      if (dur > 0 && dur < 65) continue;

      const artistsStr = decodeEntities(
        [item.primary_artists, item.singers, item.music].filter(Boolean).join(', ')
      ).trim();
      const displayArtist = artistsStr ? artistsStr.split(',')[0].trim() : cleanArtist || companionA;
      const encUrl = item.encrypted_media_url || item.more_info?.encrypted_media_url || '';
      const thumb = (item.image || '').replace('150x150', '500x500').replace('http://', 'https://');

      seenIds.add(trackId);
      seenTitles.add(normTitle);

      if (!resolvedCache.has(trackId)) {
        resolvedCache.set(trackId, {
          result: {
            mode: 'proxy',
            provider: 'jiosaavn',
            streamUrl: `/api/audio/stream?videoId=${encodeURIComponent(trackId)}`,
            matchedTitle: songTitle,
            matchedArtist: artistsStr || displayArtist,
            durationSeconds: dur || undefined,
          },
          saavnEncUrl: encUrl || undefined,
          saavnSongId: cleanId,
          upstreamKind: 'direct-url',
          expiresAt: Date.now() + 60 * 60 * 1000,
        });
      }

      out.push({
        id: trackId,
        title: songTitle,
        artist: displayArtist,
        duration: formatDurLabel(dur),
        durationSeconds: dur,
        thumbnail: thumb,
        thumbnailHigh: thumb,
        provider: 'jiosaavn',
        sourceLabel: 'JioSaavn 320kbps',
      });

      if (out.length >= limit) return out;
    }
  }

  return out;
}

export async function proxyAudioStream(req: Request, res: Response, videoId: string): Promise<void> {
  let entry = resolvedCache.get(videoId);

  if (entry && entry.result.provider === 'jiosaavn' && !entry.upstreamUrl) {
    const saavnId = videoId.startsWith('src_js_') ? videoId.slice(7) : entry.saavnSongId;
    await ensureSaavnUpstreamUrl(entry, saavnId);
  }

  // If not yet resolved (or expired) and query has title metadata (or is a direct src_js_ ID), resolve on-the-fly!
  if (
    (!entry || entry.expiresAt <= Date.now() || !entry.upstreamUrl) &&
    (typeof req.query.title === 'string' || videoId.startsWith('src_js_'))
  ) {
    const title = typeof req.query.title === 'string' ? req.query.title.slice(0, 180) : '';
    const artist = typeof req.query.artist === 'string' ? req.query.artist.slice(0, 120) : '';
    const dur = Number(req.query.duration);
    await resolveBackgroundAudioStream(videoId, title, artist, Number.isFinite(dur) && dur > 0 ? dur : 0);
    entry = resolvedCache.get(videoId);
    if (entry && entry.result.provider === 'jiosaavn' && !entry.upstreamUrl) {
      const saavnId = videoId.startsWith('src_js_') ? videoId.slice(7) : entry.saavnSongId;
      await ensureSaavnUpstreamUrl(entry, saavnId);
    }
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

const artistPosterCache = new Map<string, string>();

const CURATED_ARTIST_POSTERS: Record<string, string> = {
  'arijit singh': 'https://c.saavncdn.com/artists/Arijit_Singh_004_20241118063717_500x500.jpg',
  'yo yo honey singh': 'https://c.saavncdn.com/artists/Yo_Yo_Honey_Singh_004_20260811095253_500x500.jpg',
  'honey singh': 'https://c.saavncdn.com/artists/Yo_Yo_Honey_Singh_004_20260811095253_500x500.jpg',
  'sidhu moose wala': 'https://c.saavncdn.com/artists/Sidhu_Moose_Wala_004_20250617183705_500x500.jpg',
  'sidhu moosewala': 'https://c.saavncdn.com/artists/Sidhu_Moose_Wala_004_20250617183705_500x500.jpg',
  'sonu nigam': 'https://c.saavncdn.com/artists/Sonu_Nigam_003_20260813182013_500x500.jpg',
  'diljit dosanjh': 'https://c.saavncdn.com/artists/Diljit_Dosanjh_005_20231025073054_500x500.jpg',
  'armaan malik': 'https://c.saavncdn.com/artists/Armaan_Malik_006_20260813132832_500x500.jpg',
  'jubin nautiyal': 'https://c.saavncdn.com/artists/Jubin_Nautiyal_003_20231130204020_500x500.jpg',
  'neha kakkar': 'https://c.saavncdn.com/artists/Neha_Kakkar_007_20241212115832_500x500.jpg',
  'shreya ghoshal': 'https://c.saavncdn.com/artists/Shreya_Ghoshal_007_20241101074144_500x500.jpg',
  'badshah': 'https://c.saavncdn.com/artists/Badshah_006_20241118064015_500x500.jpg',
  'karan aujla': 'https://c.saavncdn.com/artists/Karan_Aujla_005_20260925061936_500x500.jpg',
  'alka yagnik': 'https://c.saavncdn.com/artists/Alka_Yagnik_002_20220314192930_500x500.jpg',
  'alaka yagnik': 'https://c.saavncdn.com/artists/Alka_Yagnik_002_20220314192930_500x500.jpg',
  'atif aslam': 'https://cdn-images.dzcdn.net/images/artist/0ea90444148fff9c11d77f06a344724e/1000x1000-000000-80-0-0.jpg',
  'shubh': 'https://c.saavncdn.com/artists/Shubh_000_20220921112507_500x500.jpg',
  'ap dhillon': 'https://c.saavncdn.com/artists/AP_Dhillon_004_20251023102150_500x500.jpg',
  'anuv jain': 'https://c.saavncdn.com/artists/Anuv_Jain_001_20231206073013_500x500.jpg',
  'kk': 'https://c.saavncdn.com/artists/KK_500x500.jpg',
  'kumar sanu': 'https://c.saavncdn.com/artists/Kumar_Sanu_500x500.jpg',
  'udit narayan': 'https://c.saavncdn.com/artists/Udit_Narayan_004_20241029065120_500x500.jpg',
  'b praak': 'https://c.saavncdn.com/artists/B_Praak_001_20191118112005_500x500.jpg',
  'vishal mishra': 'https://c.saavncdn.com/artists/Vishal_Mishra_005_20251120085316_500x500.jpg',
  'darshan raval': 'https://c.saavncdn.com/artists/Darshan_Raval_006_20250807060352_500x500.jpg',
  'sunidhi chauhan': 'https://c.saavncdn.com/artists/Sunidhi_Chauhan_005_20250515061617_500x500.jpg',
  'rahat fateh ali khan': 'https://cdn-images.dzcdn.net/images/artist/8263c6e6e75baf8387ad258459021f78/1000x1000-000000-80-0-0.jpg',
  'king': 'https://c.saavncdn.com/artists/King_004_20240819092014_500x500.jpg',
  'talha anjum': 'https://cdn-images.dzcdn.net/images/artist/380e0c7629f94b9c75b7745a8990073a/1000x1000-000000-80-0-0.jpg',
  'mohit chauhan': 'https://c.saavncdn.com/artists/Mohit_Chauhan_500x500.jpg',
  'pritam': 'https://c.saavncdn.com/artists/Pritam_Chakraborty-20170711073326_500x500.jpg',
};

export async function fetchOfficialArtistPoster(artistName: string): Promise<string | undefined> {
  const clean = artistName.trim().toLowerCase();
  if (!clean) return undefined;

  if (CURATED_ARTIST_POSTERS[clean]) {
    return CURATED_ARTIST_POSTERS[clean];
  }
  const hit = artistPosterCache.get(clean);
  if (hit) return hit;

  try {
    // 1. Try JioSaavn Artist Directory first for official Indian/South Asian artist portraits
    const saavnRes = await fetch(
      `https://www.jiosaavn.com/api.php?__call=search.getArtistResults&_format=json&_marker=0&api_version=4&ctx=web6dot0&n=5&p=1&q=${encodeURIComponent(
        artistName.trim()
      )}`,
      {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(2200),
      }
    );
    if (saavnRes.ok) {
      const data = (await saavnRes.json()) as {
        results?: Array<{ name?: string; image?: string }>;
      };
      const items = data.results || [];
      const exact = items.find(
        (r) =>
          r.image &&
          !r.image.includes('artist-default') &&
          r.image.includes('/artists/') &&
          (r.name || '').trim().toLowerCase() === clean
      );
      const best =
        exact ||
        items.find(
          (r) =>
            r.image &&
            !r.image.includes('artist-default') &&
            r.image.includes('/artists/') &&
            (r.name || '').toLowerCase().includes(clean)
        );
      if (best?.image) {
        const hiRes = best.image.replace(/_\d+x\d+\./, '_500x500.');
        artistPosterCache.set(clean, hiRes);
        return hiRes;
      }
    }
  } catch {
    // fallback to Deezer below
  }

  try {
    // 2. Fallback to Deezer artist portrait API (1000x1000 studio artist portraits)
    const dzRes = await fetch(
      `https://api.deezer.com/search/artist?q=${encodeURIComponent(artistName.trim())}`,
      { signal: AbortSignal.timeout(2200) }
    );
    if (dzRes.ok) {
      const data = (await dzRes.json()) as {
        data?: Array<{ name?: string; picture_xl?: string; picture_big?: string }>;
      };
      const first = (data.data || []).find(
        (a) =>
          (a.picture_xl || a.picture_big) &&
          !(a.picture_xl || '').includes('/artist//') &&
          (a.name || '').toLowerCase().includes(clean)
      );
      const pic = first?.picture_xl || first?.picture_big;
      if (pic) {
        artistPosterCache.set(clean, pic);
        return pic;
      }
    }
  } catch {
    // ignore
  }

  return undefined;
}

