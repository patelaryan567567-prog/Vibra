import type { CategoryId, IndiaLanguageFilter, Track } from '../src/types/music.ts';
import { generateTrendingViralSongs } from './gemini.ts';

const YT_API_BASE = 'https://www.googleapis.com/youtube/v3';
const FETCH_TIMEOUT_MS = 8000;

export class YouTubeApiError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 500, code = 'YOUTUBE_API_ERROR') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

class TtlCache<T> {
  private map = new Map<string, CacheEntry<T>>();
  private maxEntries: number;
  private defaultTtlMs: number;

  constructor(maxEntries: number, defaultTtlMs: number) {
    this.maxEntries = maxEntries;
    this.defaultTtlMs = defaultTtlMs;
  }

  get(key: string): T | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    // Refresh LRU order
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.data;
  }

  set(key: string, data: T, ttlMs = this.defaultTtlMs): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxEntries) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) {
        this.map.delete(oldestKey);
      }
    }
    this.map.set(key, { data, expiresAt: Date.now() + ttlMs });
  }
}

const videoCache = new TtlCache<Track>(600, 120 * 60 * 1000);
const trendingCache = new TtlCache<Track[]>(32, 60 * 60 * 1000);
const categoryCache = new TtlCache<Track[]>(96, 30 * 60 * 1000);
const searchCache = new TtlCache<{ tracks: Track[]; nextPageToken?: string }>(160, 30 * 60 * 1000);
const relatedCache = new TtlCache<Track[]>(100, 60 * 60 * 1000);
const suggestionsCache = new TtlCache<string[]>(120, 60 * 60 * 1000);

const inFlight = new Map<string, Promise<unknown>>();

async function coalesce<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) {
    return existing;
  }
  const promise = fn().finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}

const KEY_QUOTA_COOLDOWN_MS = 60 * 60 * 1000;
const exhaustedKeyUntil = new Map<string, number>();
const searchExhaustedKeyUntil = new Map<string, number>();
let activeKeyIndex = 0;

function isPlaceholderKey(raw: string): boolean {
  return !raw || /^MY_YOUTUBE_API_KEY(_\d+)?$/i.test(raw);
}

export function getYoutubeApiKeys(): string[] {
  const candidates = [
    process.env.YOUTUBE_API_KEY,
    process.env.YOUTUBE_API_KEY_2,
    process.env.YOUTUBE_API_KEY_3,
    process.env.YOUTUBE_API_KEY_4,
    process.env.YOUTUBE_API_KEY_5,
    process.env.YOUTUBE_API_KEYS,
  ];

  const unique = new Set<string>();
  for (const raw of candidates) {
    if (!raw) continue;
    for (const part of raw.split(/[\s,;]+/)) {
      const cleaned = part.trim();
      if (!isPlaceholderKey(cleaned)) {
        unique.add(cleaned);
      }
    }
  }
  return Array.from(unique);
}

export function hasConfiguredYoutubeKeys(): boolean {
  return getYoutubeApiKeys().length > 0;
}

function ensureYoutubeConfigured(): string[] {
  const keys = getYoutubeApiKeys();
  if (keys.length === 0) {
    throw new YouTubeApiError(
      'YouTube Data API v3 key is not configured on the server. Add YOUTUBE_API_KEY to your environment secrets to load live music tracks and search results.',
      503,
      'YOUTUBE_API_KEY_MISSING'
    );
  }
  return keys;
}

export function getYoutubeKeyStatus(): {
  totalKeys: number;
  activeKeySlot: number;
  exhaustedKeysCount: number;
  searchExhaustedKeysCount: number;
} {
  const keys = getYoutubeApiKeys();
  const now = Date.now();
  let exhaustedKeysCount = 0;
  let searchExhaustedKeysCount = 0;

  for (const key of keys) {
    if ((exhaustedKeyUntil.get(key) ?? 0) > now) exhaustedKeysCount++;
    if ((searchExhaustedKeyUntil.get(key) ?? 0) > now) searchExhaustedKeysCount++;
  }

  return {
    totalKeys: keys.length,
    activeKeySlot: keys.length > 0 ? (activeKeyIndex % keys.length) + 1 : 0,
    exhaustedKeysCount,
    searchExhaustedKeysCount,
  };
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/');
}

function cleanArtistName(channelTitle: string): string {
  const decoded = decodeHtmlEntities(channelTitle);
  return decoded
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/VEVO$/i, '')
    .trim() || decoded;
}

function isPhonkTrack(title: string, channelTitle = ''): boolean {
  return /\bphonk\b/i.test(title) || /\bphonk\b/i.test(channelTitle);
}

const COMPILATION_TITLE_RE =
  /\b(jukebox|nonstop|non-stop|timestamps|all trending|songs playlist|top\s+\d+\s+songs|best\s+of\s+20\d\d|songs that|gen\s*z|1\s*hour|30\s*min|full\s*album|back\s*to\s*back|#playlist|#shorts|lofi mix|slowed\s*[+&]?\s*reverb|slow\s*reverb|mashup compilation|8d\s*audio)\b/i;
const CLUTTER_TITLE_RE =
  /\b(aarti|bhajan|chalisa|mantra|stuti|bhakti|kirtan|bhojpuri|maghi|maithili|glimpse|teaser|trailer|dialogue promo|first look|motion poster|indian idol|sa re ga ma|superstar singer|whatsapp status|ringtone|became a superhit|how a song|unique dance|cover version|ai music video|ranking raaga)\b/i;
const SOUTH_REGIONAL_RE =
  /[\u0980-\u09FF\u0B00-\u0DFF]|\b(tamil|telugu|malayalam|kannada|odia|bengali)\b.*\b(glimpse|teaser|promo|lyrical|song|official)\b/i;

function isValidTrendingSong(track: Track, lang: IndiaLanguageFilter): boolean {
  if (isPhonkTrack(track.title, track.channelTitle)) return false;

  const dur = track.durationSeconds ?? 0;
  // Individual songs are roughly 1:05 to 8:00; blocks <1m clips/teasers and 15-60m jukeboxes
  if (dur > 0 && (dur < 65 || dur > 480)) return false;

  // Trending viral hits in India must have meaningful real viewership (filters 37-play AI spam uploads)
  if (typeof track.viewCountRaw === 'number' && track.viewCountRaw < 25_000) return false;

  if (COMPILATION_TITLE_RE.test(track.title)) return false;

  // Reject multi-song chain titles like "Taare x Pal Pal x Aarzu x Bairan"
  if ((track.title.match(/\s[xX×]\s/g) ?? []).length >= 2) return false;
  if ((track.title.match(/\|/g) ?? []).length >= 3) return false;
  if (/mp3#/i.test(track.title)) return false;

  if (lang !== 'english') {
    if (CLUTTER_TITLE_RE.test(track.title) || CLUTTER_TITLE_RE.test(track.channelTitle)) {
      return false;
    }
    if ((lang === 'all' || lang === 'hindi' || lang === 'mix') && SOUTH_REGIONAL_RE.test(track.title)) {
      return false;
    }
  }

  return true;
}

export function pickBestOfficialTrack(
  candidates: Track[],
  lang: IndiaLanguageFilter = 'all'
): Track | undefined {
  const valid = candidates.filter((t) => isValidTrendingSong(t, lang));
  const pool =
    valid.length > 0
      ? valid
      : candidates.filter((t) => {
          const dur = t.durationSeconds ?? 0;
          return (
            !isPhonkTrack(t.title, t.channelTitle) &&
            (dur === 0 || (dur >= 65 && dur <= 480)) &&
            !/\b(slowed|slow\s*reverb|8d\s*audio|ringtone)\b/i.test(t.title)
          );
        });

  if (pool.length === 0) return candidates[0];

  let bestTrack = pool[0];
  let bestScore = -Infinity;

  for (const t of pool) {
    let score = 0;
    const views = t.viewCountRaw ?? 0;
    if (views > 0) {
      score += Math.log10(views) * 10;
    }
    if (/\b(official\s*(music\s*)?(video|audio)|full\s*video|lyric\s*video|coke studio)\b/i.test(t.title)) {
      score += 12;
    }
    if (/\b(t-series|zee music|yrf|sony music|saregama|tips official|desi melodies|speed records|vyrl|warner music|coke studio|aurora|aur)\b/i.test(t.channelTitle)) {
      score += 10;
    }
    if (/\b(cover|karaoke|instrumental|8d|reverb|lofi|status)\b/i.test(t.title)) {
      score -= 18;
    }
    if (score > bestScore) {
      bestScore = score;
      bestTrack = t;
    }
  }

  return bestTrack;
}

function normalizeSongKey(title: string): string {
  const withoutBrackets = title
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .split(/[|\-–—•]/)[0]
    .toLowerCase()
    .replace(/[^a-z0-9\u0900-\u097f]+/g, ' ')
    .trim();
  if (withoutBrackets.length >= 3) {
    return withoutBrackets.slice(0, 36);
  }
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 36);
}

export function parseIsoDuration(iso: string | undefined): { formatted: string; seconds: number } {
  if (!iso) return { formatted: '--:--', seconds: 0 };
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return { formatted: '--:--', seconds: 0 };

  const hours = parseInt(match[1] || '0', 10);
  const minutes = parseInt(match[2] || '0', 10);
  const seconds = parseInt(match[3] || '0', 10);
  const totalSeconds = hours * 3600 + minutes * 60 + seconds;

  if (hours > 0) {
    return {
      formatted: `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`,
      seconds: totalSeconds,
    };
  }
  return {
    formatted: `${minutes}:${String(seconds).padStart(2, '0')}`,
    seconds: totalSeconds,
  };
}

export function formatViewCount(rawCount: string | undefined): { formatted: string; raw: number } {
  if (!rawCount) return { formatted: '', raw: 0 };
  const num = parseInt(rawCount, 10);
  if (Number.isNaN(num)) return { formatted: '', raw: 0 };

  if (num >= 1_000_000_000) {
    return { formatted: `${(num / 1_000_000_000).toFixed(1)}B plays`, raw: num };
  }
  if (num >= 1_000_000) {
    return { formatted: `${(num / 1_000_000).toFixed(1)}M plays`, raw: num };
  }
  if (num >= 1_000) {
    return { formatted: `${(num / 1_000).toFixed(1)}K plays`, raw: num };
  }
  return { formatted: `${num} plays`, raw: num };
}

interface YouTubeVideoItem {
  id: string;
  snippet?: {
    title?: string;
    channelTitle?: string;
    publishedAt?: string;
    thumbnails?: {
      medium?: { url?: string };
      high?: { url?: string };
      maxres?: { url?: string };
    };
  };
  contentDetails?: {
    duration?: string;
  };
  statistics?: {
    viewCount?: string;
  };
}

interface YouTubeSearchItem {
  id?: {
    videoId?: string;
  };
}

type YouTubeEndpointScope = 'search' | 'videos';

function isKeyReady(key: string, scope: YouTubeEndpointScope, now: number): boolean {
  if ((exhaustedKeyUntil.get(key) ?? 0) > now) return false;
  if (scope === 'search' && (searchExhaustedKeyUntil.get(key) ?? 0) > now) return false;
  return true;
}

async function fetchYouTubeJson<T>(
  buildUrl: (apiKey: string) => string,
  scope: YouTubeEndpointScope = 'videos'
): Promise<T> {
  const keys = ensureYoutubeConfigured();
  const now = Date.now();
  const startIdx = activeKeyIndex % keys.length;

  const candidateIndices: number[] = [];
  for (let offset = 0; offset < keys.length; offset++) {
    const idx = (startIdx + offset) % keys.length;
    if (isKeyReady(keys[idx], scope, now)) {
      candidateIndices.push(idx);
    }
  }

  if (candidateIndices.length === 0) {
    const multiMsg =
      keys.length > 1
        ? `YouTube Data API quota exceeded across all ${keys.length} configured API keys. Please try again later.`
        : 'YouTube Data API daily quota exceeded. Please try again later.';
    throw new YouTubeApiError(multiMsg, 429, 'YOUTUBE_QUOTA_EXCEEDED');
  }

  let lastError: YouTubeApiError | null = null;

  for (let pos = 0; pos < candidateIndices.length; pos++) {
    const keyIdx = candidateIndices[pos];
    const currentKey = keys[keyIdx];
    const url = buildUrl(currentKey);

    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        throw new YouTubeApiError('YouTube API request timed out. Please try again.', 504, 'YOUTUBE_TIMEOUT');
      }
      throw new YouTubeApiError('Unable to reach YouTube API. Check network connectivity.', 502, 'YOUTUBE_NETWORK_ERROR');
    }

    if (res.ok) {
      activeKeyIndex = keyIdx;
      return (await res.json()) as T;
    }

    let rawMessage = `YouTube API error (${res.status})`;
    let message = rawMessage;
    let code = 'YOUTUBE_API_ERROR';
    let reason = '';

    try {
      const errBody = (await res.json()) as {
        error?: { message?: string; errors?: Array<{ reason?: string }> };
      };
      if (errBody.error?.message) {
        rawMessage = decodeHtmlEntities(errBody.error.message);
        message = rawMessage;
      }
      reason = errBody.error?.errors?.[0]?.reason ?? '';
      if (
        reason === 'quotaExceeded' ||
        reason === 'dailyLimitExceeded' ||
        reason === 'rateLimitExceeded' ||
        reason === 'userRateLimitExceeded' ||
        /quota exceeded/i.test(rawMessage)
      ) {
        code = 'YOUTUBE_QUOTA_EXCEEDED';
        message =
          keys.length > 1
            ? `YouTube Data API quota exceeded across configured API keys. Please try again later.`
            : 'YouTube Data API daily quota exceeded. Please try again later.';
      } else if (reason === 'keyInvalid' || reason === 'keyExpired') {
        code = 'YOUTUBE_API_KEY_INVALID';
        message = 'The configured YOUTUBE_API_KEY is invalid. Please verify it in your environment secrets.';
      }
    } catch {
      // ignore json parse failure
    }

    const isKeyOrQuotaFailure =
      code === 'YOUTUBE_QUOTA_EXCEEDED' ||
      code === 'YOUTUBE_API_KEY_INVALID' ||
      res.status === 429 ||
      (res.status === 403 && /quota|limit|rate|key|forbidden|accessNotConfigured/i.test(`${rawMessage} ${reason}`));

    if (isKeyOrQuotaFailure) {
      const cooldownUntil = Date.now() + KEY_QUOTA_COOLDOWN_MS;
      const isSearchMetricOnly =
        code === 'YOUTUBE_QUOTA_EXCEEDED' &&
        scope === 'search' &&
        /search queries/i.test(rawMessage) &&
        reason !== 'dailyLimitExceeded';

      if (isSearchMetricOnly) {
        searchExhaustedKeyUntil.set(currentKey, cooldownUntil);
      } else {
        exhaustedKeyUntil.set(currentKey, cooldownUntil);
        searchExhaustedKeyUntil.set(currentKey, cooldownUntil);
      }

      activeKeyIndex = (keyIdx + 1) % keys.length;
      lastError = new YouTubeApiError(message, res.status, code);

      if (pos < candidateIndices.length - 1) {
        console.warn(`[YouTube] API key #${keyIdx + 1} hit ${code}; switching to key #${candidateIndices[pos + 1] + 1}.`);
        continue;
      }
      throw lastError;
    }

    throw new YouTubeApiError(message, res.status, code);
  }

  throw lastError ?? new YouTubeApiError('YouTube API request failed.', 502, 'YOUTUBE_API_ERROR');
}

function mapVideoItemToTrack(item: YouTubeVideoItem, category?: CategoryId, isVideo?: boolean): Track {
  const snippet = item.snippet ?? {};
  const title = decodeHtmlEntities(snippet.title || 'Untitled Track');
  const channelTitle = decodeHtmlEntities(snippet.channelTitle || 'Unknown Artist');
  const durationInfo = parseIsoDuration(item.contentDetails?.duration);
  const viewInfo = formatViewCount(item.statistics?.viewCount);

  return {
    id: item.id,
    title,
    artist: cleanArtistName(channelTitle),
    channelTitle,
    thumbnail:
      snippet.thumbnails?.medium?.url ||
      snippet.thumbnails?.high?.url ||
      `https://i.ytimg.com/vi/${item.id}/mqdefault.jpg`,
    thumbnailHigh:
      snippet.thumbnails?.maxres?.url ||
      snippet.thumbnails?.high?.url ||
      `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`,
    duration: durationInfo.formatted,
    durationSeconds: durationInfo.seconds,
    viewCount: viewInfo.formatted || undefined,
    viewCountRaw: viewInfo.raw || undefined,
    publishedAt: snippet.publishedAt,
    isVideo,
    category,
  };
}

async function enrichVideoIds(
  videoIds: string[],
  category?: CategoryId,
  isVideo?: boolean
): Promise<Track[]> {
  if (videoIds.length === 0) return [];
  const uniqueIds = Array.from(new Set(videoIds)).slice(0, 25);

  const missingIds: string[] = [];
  const cachedById = new Map<string, Track>();

  for (const id of uniqueIds) {
    const hit = videoCache.get(id);
    if (hit) {
      cachedById.set(id, {
        ...hit,
        category: category ?? hit.category,
        isVideo: isVideo ?? hit.isVideo,
      });
    } else {
      missingIds.push(id);
    }
  }

  if (missingIds.length > 0) {
    const data = await fetchYouTubeJson<{ items?: YouTubeVideoItem[] }>(
      (apiKey) =>
        `${YT_API_BASE}/videos?part=snippet,contentDetails,statistics&id=${encodeURIComponent(
          missingIds.join(',')
        )}&key=${encodeURIComponent(apiKey)}`,
      'videos'
    );
    for (const item of data.items ?? []) {
      const baseTrack = mapVideoItemToTrack(item, category, isVideo);
      videoCache.set(item.id, baseTrack);
      cachedById.set(item.id, baseTrack);
    }
  }

  return uniqueIds
    .map((id) => cachedById.get(id))
    .filter((t): t is Track => Boolean(t));
}

const TRENDING_POOLS_BY_LANG: Record<IndiaLanguageFilter, { primary: string[]; secondary?: string[] }> = {
  all: {
    primary: [
      'hindi viral song -jukebox -playlist -nonstop -timestamps -bhajan -aarti',
      'bollywood new hit song -jukebox -playlist -nonstop -trailer -teaser',
      'hindi urdu song -jukebox -playlist -nonstop -timestamps',
    ],
    secondary: [
      'punjabi hindi hit song -jukebox -playlist -nonstop',
      'coke studio hindi urdu song -jukebox -playlist',
      'hindi indie romantic song -jukebox -playlist -nonstop',
    ],
  },
  hindi: {
    primary: [
      'new hindi bollywood hit song -jukebox -playlist -nonstop -trailer',
      'hindi romantic viral song -jukebox -playlist -timestamps',
      'new hindi indie hit song -jukebox -playlist',
    ],
  },
  punjabi: {
    primary: [
      'new punjabi rap hip hop hit song -jukebox -playlist -nonstop',
      'trending punjabi pop hit song -jukebox -playlist',
      'latest punjabi hit music video -jukebox -playlist',
    ],
  },
  mix: {
    primary: [
      'hindi urdu indie hit song -jukebox -playlist -nonstop -timestamps',
      'coke studio hindi urdu song -jukebox -playlist',
      'hindi romantic indie song -jukebox -playlist -nonstop',
    ],
  },
  english: {
    primary: [
      'trending english pop hits official music video -playlist -mix',
      'viral english songs pop official video -playlist -mix',
      'top english charting hits official music video -playlist',
    ],
  },
};

let trendingRotation = 0;

export async function getTrendingMusic(
  region = 'IN',
  forceRefresh = false,
  lang: IndiaLanguageFilter = 'all'
): Promise<Track[]> {
  ensureYoutubeConfigured();
  const safeRegion = /^[A-Z]{2}$/.test(region.toUpperCase()) ? region.toUpperCase() : 'IN';
  const cacheKey = `trending:${safeRegion}:${lang}`;

  if (!forceRefresh) {
    const cached = trendingCache.get(cacheKey);
    if (cached) return cached;
  } else {
    trendingRotation = (trendingRotation + 1) % 3;
  }

  return coalesce(`${cacheKey}:${forceRefresh ? trendingRotation : 'steady'}`, async () => {
    const cutoff180Days = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
    const chartRegion = lang === 'english' && safeRegion === 'IN' ? 'US' : safeRegion;
    const buildChartUrl = (apiKey: string) =>
      `${YT_API_BASE}/videos?part=snippet,contentDetails,statistics&chart=mostPopular&videoCategoryId=10&regionCode=${chartRegion}&maxResults=50&key=${encodeURIComponent(
        apiKey
      )}`;

    // For All India & Hindi-Urdu Mix, also tap South Asia's Urdu-Hindi chart (costs only 1 quota unit, 0 search quota)
    const shouldFetchUrduMixChart = safeRegion === 'IN' && (lang === 'all' || lang === 'mix');
    const buildPkChartUrl = (apiKey: string) =>
      `${YT_API_BASE}/videos?part=snippet,contentDetails,statistics&chart=mostPopular&videoCategoryId=10&regionCode=PK&maxResults=25&key=${encodeURIComponent(
        apiKey
      )}`;

    let firstYouTubeError: YouTubeApiError | null = null;
    const fetchChart = (buildUrl: (apiKey: string) => string) =>
      fetchYouTubeJson<{ items?: YouTubeVideoItem[] }>(buildUrl, 'videos')
        .then((data) =>
          (data.items ?? [])
            .map((item) => {
              const t = mapVideoItemToTrack(item, 'trending', false);
              videoCache.set(item.id, t);
              return t;
            })
            .filter((t) => isValidTrendingSong(t, lang))
        )
        .catch((err) => {
          if (!firstYouTubeError && err instanceof YouTubeApiError) {
            firstYouTubeError = err;
          }
          return [] as Track[];
        });

    const chartPromise = fetchChart(buildChartUrl);
    const pkChartPromise = shouldFetchUrduMixChart ? fetchChart(buildPkChartUrl) : Promise.resolve([] as Track[]);

    // Step 1: Use Gemini curation for top viral Reels/Shorts songs (kept to 4 search calls max to preserve YouTube daily quota)
    let aiViralQueries: string[] = [];
    const hasGemini = Boolean(process.env.GEMINI_API_KEY?.trim() && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY');
    if (hasGemini && safeRegion === 'IN') {
      try {
        aiViralQueries = await generateTrendingViralSongs(lang, trendingRotation);
      } catch (err) {
        console.warn('Gemini trending grounding fallback:', err instanceof Error ? err.message : err);
      }
    }

    const aiResolvedTracks: Track[] = [];
    if (aiViralQueries.length > 0) {
      const targetQueries = aiViralQueries.slice(0, 4);
      const songResults = await Promise.allSettled(
        targetQueries.map((songQuery) => {
          const cleanSongQuery = songQuery.replace(/\s*[-–—]\s*/g, ' ').trim();
          return searchYouTubeTracks({
            query: cleanSongQuery,
            type: 'songs',
            maxResults: 5,
            category: 'trending',
            regionCode: safeRegion,
            lang,
            order: 'relevance',
            skipLanguageBias: true,
          });
        })
      );

      for (const res of songResults) {
        if (res.status === 'fulfilled') {
          const best = pickBestOfficialTrack(res.value, lang);
          if (best && isValidTrendingSong(best, lang)) {
            aiResolvedTracks.push({ ...best, category: 'trending' });
          }
        } else if (!firstYouTubeError && res.reason instanceof YouTubeApiError) {
          firstYouTubeError = res.reason;
        }
      }
    }

    const [inChartTracks, pkChartTracks] = await Promise.all([chartPromise, pkChartPromise]);

    // Interleave India chart + Hindi-Urdu Mix chart (filtered cleanly)
    const chartTracks: Track[] = [];
    const maxChartLen = Math.max(inChartTracks.length, pkChartTracks.length);
    for (let i = 0; i < maxChartLen; i++) {
      if (inChartTracks[i]) chartTracks.push(inChartTracks[i]);
      if (pkChartTracks[i]) chartTracks.push(pkChartTracks[i]);
    }

    // Step 2: Only run 1 clean Search fallback if charts + AI together yielded fewer than 8 songs
    const fallbackTracks: Track[] = [];
    if (aiResolvedTracks.length + chartTracks.length < 8) {
      const pool = TRENDING_POOLS_BY_LANG[lang] ?? TRENDING_POOLS_BY_LANG.all;
      const primaryQuery = pool.primary[trendingRotation % pool.primary.length];

      try {
        const res = await searchYouTubeTracks({
          query: primaryQuery,
          type: 'songs',
          maxResults: 15,
          category: 'trending',
          regionCode: safeRegion,
          lang,
          order: 'viewCount',
          publishedAfter: cutoff180Days,
          skipLanguageBias: true,
        });
        for (const t of res) {
          if (isValidTrendingSong(t, lang)) {
            fallbackTracks.push({ ...t, category: 'trending' });
          }
        }
      } catch (err) {
        if (!firstYouTubeError && err instanceof YouTubeApiError) {
          firstYouTubeError = err;
        }
      }
    }

    const merged: Track[] = [];
    const seenIds = new Set<string>();
    const seenSongKeys = new Set<string>();

    const pushUnique = (track: Track) => {
      if (seenIds.has(track.id)) return;
      const songKey = normalizeSongKey(track.title);
      if (songKey && seenSongKeys.has(songKey)) return;
      seenIds.add(track.id);
      if (songKey) seenSongKeys.add(songKey);
      merged.push({ ...track, category: 'trending' });
    };

    // Rotate chart offset slightly on refresh so clicking Refresh gives fresh order even when Search quota is tight
    const rotatedChartTracks =
      trendingRotation > 0 && chartTracks.length > 4
        ? [
            ...chartTracks.slice((trendingRotation * 3) % chartTracks.length),
            ...chartTracks.slice(0, (trendingRotation * 3) % chartTracks.length),
          ]
        : chartTracks;

    // Prioritize Gemini viral Reels & Hindi-Urdu hits interleaved with India & South Asia chart hits
    const loopLen = Math.max(aiResolvedTracks.length, rotatedChartTracks.length, fallbackTracks.length);
    for (let i = 0; i < loopLen; i++) {
      if (aiResolvedTracks[i]) pushUnique(aiResolvedTracks[i]);
      if (rotatedChartTracks[i]) pushUnique(rotatedChartTracks[i]);
      if (fallbackTracks[i]) pushUnique(fallbackTracks[i]);
    }

    if (merged.length === 0) {
      if (firstYouTubeError) throw firstYouTubeError;
      throw new YouTubeApiError('Unable to load trending music from YouTube.', 502);
    }

    const finalTracks = merged.slice(0, 16);
    trendingCache.set(cacheKey, finalTracks);
    return finalTracks;
  });
}

const CATEGORY_QUERY_POOLS: Record<
  Exclude<CategoryId, 'trending'>,
  Record<IndiaLanguageFilter, string[]>
> = {
  energetic: {
    all: [
      'hindi punjabi rap party workout hits',
      'hindi gym workout motivation songs mashup',
      'latest bollywood punjabi high energy dj remix party',
      'desi hip hop punjabi rap upbeat gym songs',
    ],
    hindi: [
      'hindi bollywood high energy workout gym songs',
      'bollywood upbeat dance party hits dj mix',
      'hindi motivation energetic rap songs',
    ],
    punjabi: [
      'punjabi rap gym workout high energy hits',
      'punjabi bhangra party upbeat hits',
      'desi hip hop punjabi bass trap songs',
    ],
    mix: [
      'hindi punjabi mashup dj party workout mix',
      'bollywood upbeat reels mashup high energy',
      'hindi english club remix workout mix',
    ],
    english: [
      'english workout gym motivation pop edm hits',
      'high energy english pop dance hip hop hits',
      'upbeat english cardio running party songs',
    ],
  },
  sad: {
    all: [
      'hindi urdu sad emotional songs bollywood heartbreak',
      'arijit singh emotional unplugged hindi songs',
      'hindi acoustic sad lofi heartbreak ballads',
      'soulful hindi urdu sad melodies late night',
    ],
    hindi: [
      'hindi sad emotional bollywood heartbreak songs',
      'arijit singh emotional unplugged hindi ballads',
      'hindi slow acoustic heartbreak songs',
    ],
    punjabi: [
      'punjabi sad heartbreak emotional songs',
      'soulful punjabi sad ballads acoustic',
      'punjabi emotional late night songs',
    ],
    mix: [
      'hindi urdu sad lofi mashup heartbreak mix',
      'emotional bollywood lofi slow reverb mix',
      'hindi punjabi sad acoustic mashup',
    ],
    english: [
      'english sad emotional heartbreak ballads pop',
      'sad english acoustic late night songs',
      'emotional english r&b slow songs',
    ],
  },
  discover: {
    all: [
      'hindi urdu lofi chill mix romantic relaxing songs',
      'hindi romantic acoustic unplugged mix',
      'hindi instrumental peaceful flute sitar relaxing',
      'hindi devotional bhajan soulful peaceful music',
    ],
    hindi: [
      'hindi romantic acoustic unplugged soulful songs',
      'hindi indie chill relaxing evening songs',
      'hindi devotional peaceful bhajan soulful',
    ],
    punjabi: [
      'punjabi romantic chill acoustic soft songs',
      'punjabi sufi folk soulful relaxing music',
      'chill punjabi vibe drive songs',
    ],
    mix: [
      'hindi urdu lofi chill study beats mix',
      'bollywood romantic lofi mashup relaxing',
      'indian instrumental acoustic lofi fusion',
    ],
    english: [
      'english chill r&b acoustic relaxing indie songs',
      'english lofi chill study ambient pop',
      'smooth english romantic acoustic hits',
    ],
  },
};

const categoryRotation = new Map<string, number>();

export interface SearchTracksOptions {
  query: string;
  type?: 'songs' | 'videos';
  maxResults?: number;
  category?: CategoryId;
  regionCode?: string;
  lang?: IndiaLanguageFilter;
  order?: 'relevance' | 'viewCount' | 'date';
  publishedAfter?: string;
  pageToken?: string;
  skipLanguageBias?: boolean;
}

export async function searchYouTubeTracksPaginated(
  options: SearchTracksOptions
): Promise<{ tracks: Track[]; nextPageToken?: string }> {
  ensureYoutubeConfigured();
  const {
    query,
    type = 'songs',
    maxResults = 20,
    category,
    regionCode,
    lang,
    order = 'relevance',
    publishedAfter,
    pageToken,
    skipLanguageBias = false,
  } = options;

  const trimmed = query.trim().slice(0, 120);
  if (!trimmed) return { tracks: [] };

  const hasGenreOrLangHint =
    /\b(hindi|bollywood|punjabi|urdu|reels|shorts|english|pop|rap|rock|edm|indie|acoustic|lofi|sufi|ghazal|bhajan|mashup|remix|song|music|video)\b/i.test(
      trimmed
    );

  const refinedQuery =
    type === 'videos'
      ? trimmed.toLowerCase().includes('video')
        ? trimmed
        : `${trimmed} official music video`
      : skipLanguageBias || lang || hasGenreOrLangHint
        ? trimmed
        : `${trimmed} hindi song`;

  const safeRegion = regionCode && /^[A-Z]{2}$/.test(regionCode.toUpperCase()) ? regionCode.toUpperCase() : 'IN';
  const clampedMax = Math.min(Math.max(maxResults, 1), 25);

  const cacheKey = `search:${refinedQuery}:${type}:${clampedMax}:${safeRegion}:${order}:${publishedAfter || ''}:${pageToken || ''}:${lang || ''}:${skipLanguageBias}`;
  const cached = searchCache.get(cacheKey);
  if (cached) {
    return {
      tracks: cached.tracks.map((t) => ({ ...t, category: category ?? t.category })),
      nextPageToken: cached.nextPageToken,
    };
  }

  return coalesce(cacheKey, async () => {
    const buildSearchUrl = (apiKey: string) => {
      const params = new URLSearchParams({
        part: 'snippet',
        type: 'video',
        videoEmbeddable: 'true',
        maxResults: String(clampedMax),
        q: `${refinedQuery} -phonk`,
        regionCode: safeRegion,
        order,
        key: apiKey,
      });

      if (!skipLanguageBias && lang !== 'english') {
        params.set('relevanceLanguage', 'hi');
      }

      if (publishedAfter) {
        params.set('publishedAfter', publishedAfter);
      }

      if (pageToken) {
        params.set('pageToken', pageToken);
      }

      if (type === 'songs') {
        params.set('videoCategoryId', '10');
      }

      return `${YT_API_BASE}/search?${params.toString()}`;
    };

    const searchData = await fetchYouTubeJson<{ items?: YouTubeSearchItem[]; nextPageToken?: string }>(
      buildSearchUrl,
      'search'
    );

    const videoIds = (searchData.items ?? [])
      .map((item) => item.id?.videoId)
      .filter((id): id is string => Boolean(id));

    if (videoIds.length === 0) {
      const empty = { tracks: [], nextPageToken: searchData.nextPageToken };
      searchCache.set(cacheKey, empty);
      return empty;
    }

    const tracks = await enrichVideoIds(videoIds, category, type === 'videos');
    const filtered = tracks.filter((t) => !isPhonkTrack(t.title, t.channelTitle));
    const result = {
      tracks: filtered,
      nextPageToken: searchData.nextPageToken,
    };
    searchCache.set(cacheKey, result);
    return result;
  });
}

export async function searchYouTubeTracks(options: SearchTracksOptions): Promise<Track[]> {
  const { tracks } = await searchYouTubeTracksPaginated(options);
  return tracks;
}

export async function getCategoryTracks(options: {
  category: CategoryId;
  region?: string;
  lang?: IndiaLanguageFilter;
  forceRefresh?: boolean;
  subFilter?: string;
  customQueries?: string[];
}): Promise<Track[]> {
  const { category, region = 'IN', lang = 'all', forceRefresh = false, subFilter, customQueries } = options;

  if (category === 'trending') {
    return getTrendingMusic(region, forceRefresh, lang);
  }

  ensureYoutubeConfigured();

  const langPool = CATEGORY_QUERY_POOLS[category][lang] ?? CATEGORY_QUERY_POOLS[category].all;
  const pool = customQueries && customQueries.length > 0 ? customQueries : langPool;
  const rotKey = `${category}:${lang}`;
  const currentIdx = categoryRotation.get(rotKey) ?? 0;
  const nextIdx = forceRefresh ? (currentIdx + 1) % pool.length : currentIdx;
  if (forceRefresh) {
    categoryRotation.set(rotKey, nextIdx);
  }

  const langPrefix = lang === 'all' ? 'hindi' : lang === 'mix' ? 'hindi urdu mix' : lang;
  const query = subFilter ? `${langPrefix} ${subFilter} songs` : pool[nextIdx];
  const cacheKey = `cat:${category}:${region}:${lang}:${subFilter || nextIdx}`;

  if (!forceRefresh && !customQueries) {
    const cached = categoryCache.get(cacheKey);
    if (cached) return cached;
  }

  return coalesce(`${cacheKey}:${customQueries ? 'ai' : 'std'}`, async () => {
    const tracks = await searchYouTubeTracks({
      query,
      type: 'songs',
      maxResults: 12,
      category,
      regionCode: region,
      lang,
    });

    if (!customQueries) {
      categoryCache.set(cacheKey, tracks);
    }
    return tracks;
  });
}

export async function getRelatedTracks(
  videoId: string,
  title?: string,
  artist?: string,
  excludeIds: string[] = []
): Promise<Track[]> {
  ensureYoutubeConfigured();
  const excludeSet = new Set<string>([videoId, ...excludeIds]);

  const cached = relatedCache.get(videoId);
  if (cached) {
    return cached.filter((t) => !excludeSet.has(t.id) && !isPhonkTrack(t.title, t.channelTitle));
  }

  const tracks = await coalesce(`related:${videoId}`, async () => {
    const baseQuery = [artist, title].filter(Boolean).join(' ').trim() || 'popular hindi mix';
    const cleanQuery = baseQuery.replace(/\(.*?\)|\[.*?\]/g, '').trim().slice(0, 90);
    const result = await searchYouTubeTracks({
      query: `${cleanQuery} similar songs`,
      type: 'songs',
      maxResults: 15,
      regionCode: 'IN',
      lang: 'mix',
    });
    const cleaned = result.filter((t) => t.id !== videoId && !isPhonkTrack(t.title, t.channelTitle));
    relatedCache.set(videoId, cleaned);
    return cleaned;
  });

  return tracks.filter((t) => !excludeSet.has(t.id));
}

export async function getSearchSuggestions(query: string): Promise<string[]> {
  const trimmed = query.trim().slice(0, 100);
  if (!trimmed) return [];

  const cacheKey = trimmed.toLowerCase();
  const cached = suggestionsCache.get(cacheKey);
  if (cached) return cached;

  return coalesce(`suggest:${cacheKey}`, async () => {
    try {
      const url = `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(
        trimmed
      )}`;
      const res = await fetch(url, {
        signal: AbortSignal.timeout(4000),
        headers: {
          'User-Agent': 'Mozilla/5.0',
        },
      });
      if (!res.ok) return [];
      const payload = (await res.json()) as [string, string[]];
      if (Array.isArray(payload) && Array.isArray(payload[1])) {
        const list = payload[1].slice(0, 8);
        suggestionsCache.set(cacheKey, list);
        return list;
      }
      return [];
    } catch {
      return [];
    }
  });
}
