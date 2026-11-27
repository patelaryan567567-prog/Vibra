import fs from 'node:fs';
import type { ArtistProfileResponse, CategoryId, IndiaLanguageFilter, Track } from '../src/types/music.ts';
import {
  fetchOfficialArtistPoster,
  fetchSaavnArtistCatalog,
  fetchSaavnRelatedTracks,
} from './audioResolver.ts';
import {
  generateCategoryQueries,
  generateTrendingViralSongs,
  hasConfiguredGeminiKeys,
} from './gemini.ts';

const YT_API_BASE = 'https://www.googleapis.com/youtube/v3';
const FETCH_TIMEOUT_MS = 8000;
const DISK_CACHE_PATH = '/tmp/vibra-yt-cache-v2.json';

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
  private onDirty?: () => void;

  constructor(maxEntries: number, defaultTtlMs: number, onDirty?: () => void) {
    this.maxEntries = maxEntries;
    this.defaultTtlMs = defaultTtlMs;
    this.onDirty = onDirty;
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
    this.onDirty?.();
  }

  exportValidEntries(): Array<[string, CacheEntry<T>]> {
    const now = Date.now();
    const out: Array<[string, CacheEntry<T>]> = [];
    for (const [k, v] of this.map.entries()) {
      if (v.expiresAt > now) out.push([k, v]);
    }
    return out;
  }

  importEntries(entries: Array<[string, CacheEntry<T>]> | undefined): void {
    if (!Array.isArray(entries)) return;
    const now = Date.now();
    for (const [k, v] of entries) {
      if (typeof k === 'string' && v && v.expiresAt > now && v.data !== undefined) {
        this.map.set(k, v);
      }
    }
  }
}

let diskSaveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleDiskCacheSave() {
  if (diskSaveTimer) return;
  diskSaveTimer = setTimeout(() => {
    diskSaveTimer = null;
    try {
      const payload = {
        video: videoCache.exportValidEntries(),
        trending: trendingCache.exportValidEntries(),
        category: categoryCache.exportValidEntries(),
        search: searchCache.exportValidEntries(),
        related: relatedCache.exportValidEntries(),
        handleUploads: handleUploadsCache.exportValidEntries(),
        playlistIds: playlistVideoIdsCache.exportValidEntries(),
        videoChannelIds: videoChannelIdCache.exportValidEntries(),
        videoTags: videoMetaCache.exportValidEntries(),
      };
      fs.writeFile(DISK_CACHE_PATH, JSON.stringify(payload), () => {});
    } catch {
      // ignore read-only fs errors
    }
  }, 2500);
}

const videoCache = new TtlCache<Track>(1200, 12 * 60 * 60 * 1000, scheduleDiskCacheSave);
const trendingCache = new TtlCache<Track[]>(48, 6 * 60 * 60 * 1000, scheduleDiskCacheSave);
const categoryCache = new TtlCache<Track[]>(120, 6 * 60 * 60 * 1000, scheduleDiskCacheSave);
const searchCache = new TtlCache<{ tracks: Track[]; nextPageToken?: string }>(
  250,
  4 * 60 * 60 * 1000,
  scheduleDiskCacheSave
);
const relatedCache = new TtlCache<Track[]>(160, 6 * 60 * 60 * 1000, scheduleDiskCacheSave);
const handleUploadsCache = new TtlCache<string>(250, 7 * 24 * 60 * 60 * 1000, scheduleDiskCacheSave);
const playlistVideoIdsCache = new TtlCache<string[]>(250, 6 * 60 * 60 * 1000, scheduleDiskCacheSave);
const videoChannelIdCache = new TtlCache<string>(1200, 7 * 24 * 60 * 60 * 1000, scheduleDiskCacheSave);
const videoMetaCache = new TtlCache<string>(1200, 12 * 60 * 60 * 1000, scheduleDiskCacheSave);
const suggestionsCache = new TtlCache<string[]>(200, 6 * 60 * 60 * 1000);
const artistCache = new TtlCache<ArtistProfileResponse>(120, 6 * 60 * 60 * 1000);

// Hydrate warm cache across dev restarts / Cloud Run warm containers
try {
  if (fs.existsSync(DISK_CACHE_PATH)) {
    const raw = JSON.parse(fs.readFileSync(DISK_CACHE_PATH, 'utf8')) as {
      video?: Array<[string, CacheEntry<Track>]>;
      trending?: Array<[string, CacheEntry<Track[]>]>;
      category?: Array<[string, CacheEntry<Track[]>]>;
      search?: Array<[string, CacheEntry<{ tracks: Track[]; nextPageToken?: string }>]>;
      related?: Array<[string, CacheEntry<Track[]>]>;
      handleUploads?: Array<[string, CacheEntry<string>]>;
      playlistIds?: Array<[string, CacheEntry<string[]>]>;
      videoChannelIds?: Array<[string, CacheEntry<string>]>;
      videoTags?: Array<[string, CacheEntry<string>]>;
    };
    videoCache.importEntries(raw.video);
    trendingCache.importEntries(raw.trending);
    categoryCache.importEntries(raw.category);
    searchCache.importEntries(raw.search);
    relatedCache.importEntries(raw.related);
    handleUploadsCache.importEntries(raw.handleUploads);
    playlistVideoIdsCache.importEntries(raw.playlistIds);
    videoChannelIdCache.importEntries(raw.videoChannelIds);
    videoMetaCache.importEntries(raw.videoTags);
  }
} catch {
  // ignore corrupted cache file
}

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

interface SlotDiagnostic {
  slot: number;
  lastScope: 'search' | 'videos';
  lastStatus: number;
  lastReason: string;
  lastMessage: string;
  updatedAt: number;
}
const slotDiagnostics = new Map<number, SlotDiagnostic>();

function isPlaceholderKey(raw: string): boolean {
  return !raw || /^MY_YOUTUBE_API_KEY(?:_?\d+)?$/i.test(raw);
}

export function getYoutubeApiKeys(): string[] {
  const numberedEnvKeys = Object.keys(process.env)
    .map((name) => {
      const m = name.match(/^YOUTUBE_(?:API_)?KEY(?:_?(\d+))?$/i);
      if (!m) return null;
      return {
        name,
        order: m[1] ? parseInt(m[1], 10) : 0,
      };
    })
    .filter((entry): entry is { name: string; order: number } => Boolean(entry))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
    .map((entry) => process.env[entry.name]);

  const candidates = [...numberedEnvKeys, process.env.YOUTUBE_API_KEYS];

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

export function hasAvailableSearchKey(): boolean {
  const keys = getYoutubeApiKeys();
  const now = Date.now();
  return keys.some(
    (key) => (exhaustedKeyUntil.get(key) ?? 0) <= now && (searchExhaustedKeyUntil.get(key) ?? 0) <= now
  );
}

export function getYoutubeKeyStatus(): {
  totalKeys: number;
  activeKeySlot: number;
  exhaustedKeysCount: number;
  searchExhaustedKeysCount: number;
  slotDiagnostics: SlotDiagnostic[];
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
    slotDiagnostics: Array.from(slotDiagnostics.values()).sort((a, b) => a.slot - b.slot),
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
  /\b(jukebox|nonstop|non-stop|non\s+stop|timestamps|all trending|songs playlist|top\s+\d+\s+songs|best\s+of\b|songs that|gen\s*z|1\s*hour|30\s*min|\d+\s*minutes?\s+of|full\s*album|back\s*to\s*back|#playlist|#shorts|lofi\s*mix|chillout\s*lo-?fi|slowed|slow\s*reverb|mashups?|mega\s*mix|megamix|yearmix|party\s*mix|dj\s*mix|mixtape|sukoon\s*mix|8d\s*audio)\b/i;
const CLUTTER_TITLE_RE =
  /\b(aarti|bhajan|chalisa|mantra|stuti|bhakti|kirtan|jai\s+jai\s+ram|ramayana|mangal\s+rang|bhojpuri|maghi|maithili|glimpse|teaser|trailer|dialogue promo|first look|motion poster|indian idol|sa re ga ma|superstar singer|whatsapp status|ringtone|became a superhit|how a song|unique dance|cover version|ai music video|ranking raaga|goldmines|gaane sune ansune|sadaabahar|90s\s*hits|co-headline|halftime show|fifa world cup)\b/i;
const DEVOTIONAL_RE = /\b(aarti|bhajan|chalisa|mantra|stuti|bhakti|kirtan|jai\s+jai\s+ram|ramayana|mangal\s+rang)\b/i;
const SOUTH_REGIONAL_RE =
  /[\u0980-\u09FF\u0B00-\u0DFF]|\b(tamil|telugu|malayalam|kannada|odia|bengali)\b.*\b(glimpse|teaser|promo|lyrical|song|official)\b/i;

function isValidMusicTrack(
  track: Track,
  lang: IndiaLanguageFilter,
  opts?: { allowDevotional?: boolean; minViews?: number }
): boolean {
  if (isPhonkTrack(track.title, track.channelTitle)) return false;

  const dur = track.durationSeconds ?? 0;
  // Individual songs are roughly 1:10 to 8:00; blocks 10s status clips and 15-100m mixtapes/jukeboxes
  if (dur > 0 && (dur < 70 || dur > 480)) return false;

  // Enforce high real viewership unless track is very recent (< 7 days old)
  const publishedMs = track.publishedAt ? Date.parse(track.publishedAt) : 0;
  const isVeryFresh = publishedMs > 0 && Date.now() - publishedMs < 7 * 24 * 60 * 60 * 1000;
  const threshold = isVeryFresh ? 25_000 : opts?.minViews ?? 100_000;
  if (typeof track.viewCountRaw === 'number' && track.viewCountRaw < threshold) return false;

  if (COMPILATION_TITLE_RE.test(track.title)) return false;

  // Reject multi-song chain titles like "Taare x Pal Pal x Aarzu x Bairan"
  if ((track.title.match(/\s[xX×]\s/g) ?? []).length >= 2) return false;
  if ((track.title.match(/\|/g) ?? []).length >= 3) return false;
  if (/mp3#/i.test(track.title)) return false;

  if (lang !== 'english') {
    const clutterMatch = CLUTTER_TITLE_RE.test(track.title) || CLUTTER_TITLE_RE.test(track.channelTitle);
    if (clutterMatch) {
      if (!(opts?.allowDevotional && DEVOTIONAL_RE.test(`${track.title} ${track.channelTitle}`))) {
        return false;
      }
    }
    if ((lang === 'all' || lang === 'hindi' || lang === 'mix') && SOUTH_REGIONAL_RE.test(track.title)) {
      return false;
    }
  }

  return true;
}

function scoreTrackQuality(track: Track, rawQuery = ''): number {
  let score = 0;
  const dur = track.durationSeconds ?? 0;
  const views = track.viewCountRaw ?? 0;
  const qLower = rawQuery.toLowerCase();
  const titleLower = track.title.toLowerCase();
  const channelLower = track.channelTitle.toLowerCase();

  // Strongly prefer normal single-song length (1:15 to 7:30)
  if (dur >= 75 && dur <= 450) {
    score += 45;
  } else if (dur > 450 && dur <= 600) {
    score += 18;
  } else if (dur > 600) {
    score -= 30;
  } else if (dur > 0 && dur < 70) {
    score -= 80;
  }

  if (views > 0) {
    score += Math.log10(views) * 12;
  }
  if (/\b(official\s*(music\s*)?(video|audio|visualiser|visualizer)|full\s*(video|song|audio)|lyric(al)?\s*video|coke studio)\b/i.test(track.title)) {
    score += 18;
  }
  if (
    /\b(t-series|zee music|yrf|sony music|saregama|tips official|desi melodies|speed records|vyrl|warner music|coke studio|universal music|rehaan records|artiste first)\b/i.test(
      track.channelTitle
    ) &&
    !/\b(bhakti|sagar|devotional)\b/i.test(track.channelTitle)
  ) {
    score += 12;
  }

  // Exact query tokens in title boost the original song
  const queryWords = qLower.split(/\s+/).filter((w) => w.length >= 3);
  let matchedWords = 0;
  for (const w of queryWords) {
    if (titleLower.includes(w) || channelLower.includes(w)) matchedWords++;
  }
  if (queryWords.length > 0 && matchedWords === queryWords.length) {
    score += 18;
  }

  // Penalize fan-edits, covers, mashups, remixes, kidz bop, 8D/16D, or bhakti unless explicitly asked for
  if (!/\b(remix|mashup|slowed|reverb|lofi|cover|karaoke|8d|16d|kids|bhakti|bhajan)\b/i.test(qLower)) {
    if (/\b(cover|karaoke|instrumental|8d|16d|slowed|reverb|lofi|status|ringtone|teaser|promo|glimpse|kidz\s*bop|tribute)\b/i.test(track.title) || /\b(kidz\s*bop|bhakti)\b/i.test(track.channelTitle)) {
      score -= 45;
    }
    if (/\b(remix|mashups?)\b/i.test(track.title) || COMPILATION_TITLE_RE.test(track.title)) {
      score -= 42;
    }
  }
  return score;
}

export function pickBestOfficialTrack(
  candidates: Track[],
  lang: IndiaLanguageFilter = 'all'
): Track | undefined {
  const valid = candidates.filter((t) => isValidMusicTrack(t, lang));
  const pool =
    valid.length > 0
      ? valid
      : candidates.filter((t) => {
          const dur = t.durationSeconds ?? 0;
          return (
            !isPhonkTrack(t.title, t.channelTitle) &&
            (dur === 0 || (dur >= 70 && dur <= 480)) &&
            !/\b(slowed|slow\s*reverb|8d\s*audio|ringtone|jukebox|playlist|nonstop)\b/i.test(t.title)
          );
        });

  if (pool.length === 0) return candidates[0];

  let bestTrack = pool[0];
  let bestScore = -Infinity;

  for (const t of pool) {
    const score = scoreTrackQuality(t);
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
    channelId?: string;
    channelTitle?: string;
    publishedAt?: string;
    tags?: string[];
    description?: string;
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
      const existingDiag = slotDiagnostics.get(keyIdx + 1);
      if (!existingDiag || existingDiag.lastScope === scope || scope === 'search') {
        slotDiagnostics.set(keyIdx + 1, {
          slot: keyIdx + 1,
          lastScope: scope,
          lastStatus: 200,
          lastReason: 'ok',
          lastMessage: `${scope} ok`,
          updatedAt: Date.now(),
        });
      }
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
      } else if (
        reason === 'keyInvalid' ||
        reason === 'keyExpired' ||
        /API key expired|API key not valid|keyInvalid|keyExpired/i.test(rawMessage)
      ) {
        code = 'YOUTUBE_API_KEY_INVALID';
        message = 'One of the configured YOUTUBE_API_KEY entries is expired or invalid. Please renew it in your environment secrets.';
      }
    } catch {
      // ignore json parse failure
    }

    slotDiagnostics.set(keyIdx + 1, {
      slot: keyIdx + 1,
      lastScope: scope,
      lastStatus: res.status,
      lastReason: reason || code,
      lastMessage: rawMessage.slice(0, 180),
      updatedAt: Date.now(),
    });

    const isKeyOrQuotaFailure =
      code === 'YOUTUBE_QUOTA_EXCEEDED' ||
      code === 'YOUTUBE_API_KEY_INVALID' ||
      res.status === 429 ||
      (res.status === 400 && /api\s*key/i.test(`${rawMessage} ${reason}`)) ||
      (res.status === 403 && /quota|limit|rate|key|forbidden|accessNotConfigured/i.test(`${rawMessage} ${reason}`));

    if (isKeyOrQuotaFailure) {
      const cooldownUntil = Date.now() + KEY_QUOTA_COOLDOWN_MS;
      const isSearchMetricOnly =
        code === 'YOUTUBE_QUOTA_EXCEEDED' &&
        scope === 'search' &&
        /search queries|quota/i.test(rawMessage) &&
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
        console.warn(`[YouTube] API key #${keyIdx + 1} hit ${code} (${reason || res.status}); switching to key #${candidateIndices[pos + 1] + 1}.`);
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

  if (snippet.channelId && snippet.channelId.startsWith('UC')) {
    videoChannelIdCache.set(item.id, snippet.channelId);
  }
  const metaText = [
    ...(Array.isArray(snippet.tags) ? snippet.tags.slice(0, 15) : []),
    (snippet.description ?? '').slice(0, 220),
  ]
    .join(' ')
    .toLowerCase();
  if (metaText.trim()) {
    videoMetaCache.set(item.id, metaText);
  }

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

async function resolveHandleToUploadsPlaylist(handle: string): Promise<string | null> {
  const cleanHandle = handle.trim().replace(/^@+/, '');
  if (!cleanHandle) return null;
  if (/^UU[a-zA-Z0-9_-]{18,}$/.test(cleanHandle) || /^PL[a-zA-Z0-9_-]{12,}$/.test(cleanHandle)) {
    return cleanHandle;
  }
  if (/^UC[a-zA-Z0-9_-]{18,}$/.test(cleanHandle)) {
    return `UU${cleanHandle.slice(2)}`;
  }

  const cacheKey = cleanHandle.toLowerCase();
  const cached = handleUploadsCache.get(cacheKey);
  if (cached !== undefined) {
    return cached || null;
  }

  return coalesce(`handle:${cacheKey}`, async () => {
    try {
      const data = await fetchYouTubeJson<{
        items?: Array<{ contentDetails?: { relatedPlaylists?: { uploads?: string } } }>;
      }>(
        (apiKey) =>
          `${YT_API_BASE}/channels?part=contentDetails&forHandle=${encodeURIComponent(
            cleanHandle
          )}&key=${encodeURIComponent(apiKey)}`,
        'videos'
      );
      const uploads = data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads ?? '';
      handleUploadsCache.set(cacheKey, uploads);
      return uploads || null;
    } catch {
      return null;
    }
  });
}

async function fetchPlaylistTracks(
  source: string,
  category?: CategoryId,
  maxResults = 25
): Promise<Track[]> {
  const playlistId = await resolveHandleToUploadsPlaylist(source);
  if (!playlistId) return [];

  const cachedIds = playlistVideoIdsCache.get(playlistId);
  let videoIds: string[] = cachedIds ?? [];

  if (!cachedIds) {
    try {
      const data = await fetchYouTubeJson<{
        items?: Array<{ contentDetails?: { videoId?: string } }>;
      }>(
        (apiKey) =>
          `${YT_API_BASE}/playlistItems?part=contentDetails&playlistId=${encodeURIComponent(
            playlistId
          )}&maxResults=${Math.min(Math.max(maxResults, 1), 25)}&key=${encodeURIComponent(apiKey)}`,
        'videos'
      );
      videoIds = (data.items ?? [])
        .map((item) => item.contentDetails?.videoId)
        .filter((id): id is string => Boolean(id));
      playlistVideoIdsCache.set(playlistId, videoIds);
    } catch {
      playlistVideoIdsCache.set(playlistId, []);
      return [];
    }
  }

  if (videoIds.length === 0) return [];
  return enrichVideoIds(videoIds.slice(0, maxResults), category, false);
}

const TRENDING_POOLS_BY_LANG: Record<IndiaLanguageFilter, { primary: string[]; secondary?: string[] }> = {
  all: {
    primary: [
      'Talha Anjum OR Kaifi Khalil OR AUR OR Afusic OR Hasan Raheem official',
      'Jhol Coke Studio OR Pal Pal Afusic OR Ishq Faheem Abdullah OR Tu Hai Kahan OR Wishes Talwiinder official',
      'Karan Aujla OR Shubh OR AP Dhillon OR Anuv Jain OR Faheem Abdullah official music video',
    ],
    secondary: [
      'Karan Aujla OR Diljit Dosanjh OR Shubh OR Anuv Jain OR Arijit Singh official music video',
      'Karan Aujla OR Sidhu Moose Wala OR Badshah OR Vishal Mishra OR Talwiinder official video',
      'Talha Anjum OR Maanu OR Abdul Hannan OR Bayaan OR Asim Azhar official video',
    ],
  },
  hindi: {
    primary: [
      'Arijit Singh OR Vishal Mishra OR Faheem Abdullah OR Anuv Jain official music video',
      'Pehle Bhi Main OR Aaj Ki Raat OR Sajni OR Jo Tum Mere Ho OR Ishq Faheem official',
      'King OR Darshan Raval OR Jubin Nautiyal OR Mitraz OR Aditya Rikhari official video',
    ],
  },
  punjabi: {
    primary: [
      'Karan Aujla OR Shubh OR Sidhu Moose Wala OR AP Dhillon official music video',
      'Winning Speech Karan Aujla OR Cheques Shubh OR Softly OR Tauba Tauba OR 295 Sidhu Moose Wala official',
      'Diljit Dosanjh OR Navaan Sandhu OR Arjan Dhillon OR Talwiinder official music video',
    ],
  },
  mix: {
    primary: [
      'Talha Anjum OR Talhah Yunus OR Kaifi Khalil OR AUR OR Hasan Raheem official',
      'Jhol Coke Studio OR Pal Pal Afusic OR Tu Hai Kahan OR Wishes Talwiinder OR Kahani Suno official',
      'Abdul Hannan OR Coke Studio Pakistan OR Umair OR Maanu OR Asim Azhar official',
    ],
  },
  english: {
    primary: [
      'The Weeknd OR Sabrina Carpenter OR Billie Eilish OR Kendrick Lamar official music video',
      'Lady Gaga OR Chappell Roan OR SZA OR Bruno Mars OR Travis Scott official music video',
      'Coldplay OR Post Malone OR Ariana Grande OR Dua Lipa official video',
    ],
  },
};

let trendingRotation = 0;

const VIRAL_UPLOAD_CHANNELS_BY_LANG: Record<IndiaLanguageFilter, string[]> = {
  all: ['KaranAujla', 'cokestudio', 'SpeedRecords', 'tseries', 'TalhaAnjum', 'AnuvJain'],
  hindi: ['tseries', 'zeemusiccompany', 'SonyMusicIndia', 'yrf', 'ArijitSingh', 'AnuvJain'],
  punjabi: ['KaranAujla', 'SpeedRecords', 'DesiMelodies', 'DiljitDosanjh', 'APDHILLON', 'SidhuMooseWalaOfficial'],
  mix: ['cokestudio', 'TalhaAnjum', 'KaifiKhalil', 'HasanRaheem', 'AtifAslam', 'AnuvJain'],
  english: ['TheWeeknd', 'BillieEilish', 'SabrinaCarpenter', 'KendrickLamar', 'DuaLipa', 'BrunoMars'],
};

async function fetchChartRegion(
  regionCode: string,
  lang: IndiaLanguageFilter,
  maxResults = 35
): Promise<Track[]> {
  const data = await fetchYouTubeJson<{ items?: YouTubeVideoItem[] }>(
    (apiKey) =>
      `${YT_API_BASE}/videos?part=snippet,contentDetails,statistics&chart=mostPopular&videoCategoryId=10&regionCode=${regionCode}&maxResults=${maxResults}&key=${encodeURIComponent(
        apiKey
      )}`,
    'videos'
  );
  return (data.items ?? [])
    .map((item) => {
      const t = mapVideoItemToTrack(item, 'trending', false);
      videoCache.set(item.id, t);
      return t;
    })
    .filter((t) => isValidMusicTrack(t, lang));
}

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
    const chartRegion = lang === 'english' && safeRegion === 'IN' ? 'US' : safeRegion;
    const shouldFetchUrduMixChart = safeRegion === 'IN' && (lang === 'all' || lang === 'mix');

    let firstYouTubeError: YouTubeApiError | null = null;
    const safeChart = (reg: string, max: number) =>
      fetchChartRegion(reg, lang, max).catch((err) => {
        if (!firstYouTubeError && err instanceof YouTubeApiError) {
          firstYouTubeError = err;
        }
        return [] as Track[];
      });

    const chartPromise = safeChart(chartRegion, 50);
    const pkChartPromise = shouldFetchUrduMixChart ? safeChart('PK', 25) : Promise.resolve([] as Track[]);

    // Only spend 100 search units if a key has active /search quota AND trending isn't rotating solely on playlistItems
    let searchViralTracks: Track[] = [];
    if (hasAvailableSearchKey()) {
      let aiViralQueries: string[] = [];
      const hasGemini = hasConfiguredGeminiKeys();
      if (hasGemini && safeRegion === 'IN' && trendingRotation % 2 === 1) {
        try {
          aiViralQueries = await generateTrendingViralSongs(lang, trendingRotation);
        } catch (err) {
          console.warn('Gemini trending grounding fallback:', err instanceof Error ? err.message : err);
        }
      }

      const pool = TRENDING_POOLS_BY_LANG[lang] ?? TRENDING_POOLS_BY_LANG.all;
      const poolQuery =
        trendingRotation % 2 === 1 && pool.secondary && pool.secondary.length > 0
          ? pool.secondary[trendingRotation % pool.secondary.length]
          : pool.primary[trendingRotation % pool.primary.length];

      const combinedSearchQuery =
        aiViralQueries.length >= 2
          ? aiViralQueries
              .slice(0, 4)
              .map((q) => q.replace(/\s*[-–—]\s*/g, ' ').trim())
              .filter(Boolean)
              .join(' OR ')
          : poolQuery;

      try {
        const searched = await searchYouTubeTracks({
          query: combinedSearchQuery,
          type: 'songs',
          maxResults: 25,
          category: 'trending',
          regionCode: safeRegion,
          lang,
          order: 'relevance',
          skipLanguageBias: true,
        });
        searchViralTracks = searched
          .filter((t) => isValidMusicTrack(t, lang))
          .map((t) => ({ ...t, category: 'trending' as const }));
      } catch (err) {
        if (!firstYouTubeError && err instanceof YouTubeApiError) {
          firstYouTubeError = err;
        }
      }
    }

    // Zero-search fallback: supplement with 1-unit official artist/label upload playlists if search quota is exhausted
    if (searchViralTracks.length < 4) {
      const handles = VIRAL_UPLOAD_CHANNELS_BY_LANG[lang] ?? VIRAL_UPLOAD_CHANNELS_BY_LANG.all;
      const pickA = handles[trendingRotation % handles.length];
      const pickB = handles[(trendingRotation + 2) % handles.length];
      const [listA, listB] = await Promise.all([
        fetchPlaylistTracks(pickA, 'trending', 15),
        fetchPlaylistTracks(pickB, 'trending', 15),
      ]);
      const combinedLists: Track[] = [];
      const maxLen = Math.max(listA.length, listB.length);
      for (let i = 0; i < maxLen; i++) {
        if (listA[i]) combinedLists.push(listA[i]);
        if (listB[i]) combinedLists.push(listB[i]);
      }
      searchViralTracks = combinedLists.filter((t) => isValidMusicTrack(t, lang));
    }

    const [inChartTracks, pkChartTracks] = await Promise.all([chartPromise, pkChartPromise]);

    const chartTracks: Track[] = [];
    const maxChartLen = Math.max(inChartTracks.length, pkChartTracks.length);
    for (let i = 0; i < maxChartLen; i++) {
      if (inChartTracks[i]) chartTracks.push(inChartTracks[i]);
      if (pkChartTracks[i]) chartTracks.push(pkChartTracks[i]);
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

    const rotatedChartTracks =
      trendingRotation > 0 && chartTracks.length > 4
        ? [
            ...chartTracks.slice((trendingRotation * 4) % chartTracks.length),
            ...chartTracks.slice(0, (trendingRotation * 4) % chartTracks.length),
          ]
        : chartTracks;

    const loopLen = Math.max(searchViralTracks.length, rotatedChartTracks.length);
    for (let i = 0; i < loopLen; i++) {
      if (searchViralTracks[i]) pushUnique(searchViralTracks[i]);
      if (rotatedChartTracks[i]) pushUnique(rotatedChartTracks[i]);
    }

    if (merged.length === 0) {
      if (firstYouTubeError) throw firstYouTubeError;
      throw new YouTubeApiError('Unable to load trending music from YouTube.', 502);
    }

    const finalTracks = merged.slice(0, 24);
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
      'Karan Aujla OR Shubh OR Sidhu Moose Wala OR AP Dhillon official music video',
      'Hanumankind OR Divine OR KR$NA OR Talha Anjum OR Diljit Dosanjh official video',
      'Tauba Tauba OR Winning Speech OR Cheques Shubh OR Big Dawgs OR 295 Sidhu Moose Wala official',
    ],
    hindi: [
      'Badshah OR Yo Yo Honey Singh OR Divine OR KR$NA OR Raftaar official music video',
      'Hanumankind OR Seedhe Maut OR Emiway Bantai OR King official music video',
      'Aaj Ki Raat OR Millionaire Honey Singh OR Tauba Tauba OR Jhoome Jo Pathaan official',
    ],
    punjabi: [
      'Karan Aujla OR Shubh OR Sidhu Moose Wala official music video',
      'Diljit Dosanjh OR AP Dhillon OR Gurinder Gill official music video',
      'Navaan Sandhu OR Prem Dhillon OR Arjan Dhillon OR Cheema Y official video',
    ],
    mix: [
      'Talha Anjum OR Talhah Yunus OR Young Stunners OR Umair official',
      'AP Dhillon OR Karan Aujla OR Shubh OR Talwiinder official music video',
      'Kaun Talha OR Downers At Dusk OR 100 Million Divine OR Hasan Raheem official',
    ],
    english: [
      'Travis Scott OR The Weeknd OR Kendrick Lamar OR Central Cee official music video',
      'Dua Lipa OR Calvin Harris OR Playboi Carti OR Future OR Eminem official music video',
      'Imagine Dragons OR David Guetta OR Drake official music video',
    ],
  },
  sad: {
    all: [
      'Faheem Abdullah OR Kaifi Khalil OR AUR OR Anuv Jain OR Talha Anjum official song',
      'B Praak OR Arijit Singh OR Vishal Mishra OR Talwiinder sad song official video',
      'Jo Tum Mere Ho OR Tu Hai Kahan OR Kahani Suno OR Husn Anuv Jain OR Raanjhan official',
    ],
    hindi: [
      'Arijit Singh OR Vishal Mishra OR B Praak OR Mithoon sad official song',
      'Anuv Jain OR Faheem Abdullah OR Atif Aslam OR Darshan Raval official video',
      'Channa Mereya OR Agar Tum Saath Ho OR Pehle Bhi Main OR Raanjhan official',
    ],
    punjabi: [
      'B Praak OR Jaani OR Harrdy Sandhu OR Ammy Virk sad official song',
      'AP Dhillon OR Talwiinder OR Shubh OR Amrinder Gill punjabi sad song official',
      'Kya Loge Tum OR Pachtaoge OR Qismat OR Filhall OR 295 Sidhu Moose Wala official',
    ],
    mix: [
      'Kaifi Khalil OR AUR OR Talha Anjum OR Hasan Raheem OR Bayaan official',
      'Maanu OR Annural Khalid OR Afusic OR Abdul Hannan OR Asim Azhar official',
      'Tu Hai Kahan OR Kahani Suno OR Jhol OR Pal Pal Afusic OR Wishes Talwiinder official',
    ],
    english: [
      'Billie Eilish OR Joji OR Lord Huron OR Adele OR Lewis Capaldi official music video',
      'The Weeknd OR Giveon OR Olivia Rodrigo OR d4vd OR Sombr official video',
      'Coldplay OR James Arthur OR Hozier OR Cigarettes After Sex official video',
    ],
  },
  discover: {
    all: [
      'Coke Studio Pakistan OR Ali Sethi OR Abdul Hannan OR Hasan Raheem OR Maanu official',
      'Arijit Singh OR Jasleen Royal OR Mitraz OR Prateek Kuhad OR Atif Aslam official video',
      'Pasoori OR Sajni Arijit OR Heeriye OR Iraaday OR Sahiba Aditya Rikhari official',
    ],
    hindi: [
      'Arijit Singh OR Shreya Ghoshal OR Mohit Chauhan OR Pritam romantic official video',
      'Jasleen Royal OR Mitraz OR Anuv Jain OR Armaan Malik official video',
      'Kesariya OR Apna Bana Le OR Ve Kamleya OR O Maahi OR Akhiyaan Gulaab official',
    ],
    punjabi: [
      'Diljit Dosanjh OR Satinder Sartaaj OR Harnoor OR Talwiinder official music video',
      'AP Dhillon OR Gurinder Gill OR Karan Aujla chill official music video',
      'Hass Hass OR Lover Diljit OR Waalian Harnoor OR Moonlight OR Admiring You official',
    ],
    mix: [
      'Coke Studio Pakistan OR Abdul Hannan OR Hasan Raheem OR Kaifi Khalil official',
      'AUR OR Maanu OR Afusic OR Ali Sethi OR Shae Gill official',
      'Jhol Coke Studio OR Pasoori OR Iraaday OR Bikhra OR Tu Hai Kahan official',
    ],
    english: [
      'SZA OR Daniel Caesar OR Frank Ocean OR Ed Sheeran official music video',
      'Lana Del Rey OR Cigarettes After Sex OR Bruno Mars OR Lauv official video',
      'Charlie Puth OR Shawn Mendes OR John Mayer OR Coldplay official video',
    ],
  },
};

const ZERO_SEARCH_CHANNELS_BY_CAT: Record<
  Exclude<CategoryId, 'trending'>,
  Record<IndiaLanguageFilter, string[]>
> = {
  energetic: {
    all: ['SpeedRecords', 'TalhaAnjum', 'DiljitDosanjh', 'Badshah', 'DesiMelodies', 'RehaanRecords'],
    hindi: ['Badshah', 'tseries', 'zeemusiccompany', 'SonyMusicIndia', 'DIVINE', 'YoYoHoneySingh'],
    punjabi: ['SpeedRecords', 'DesiMelodies', 'DiljitDosanjh', 'APDHILLON', 'SidhuMooseWalaOfficial', 'RehaanRecords'],
    mix: ['TalhaAnjum', 'APDHILLON', 'HasanRaheem', 'cokestudio', 'SpeedRecords', 'DesiMelodies'],
    english: ['TravisScottXX', 'KendrickLamar', 'TheWeeknd', 'DuaLipa', 'BrunoMars', 'SabrinaCarpenter'],
  },
  sad: {
    all: ['AnuvJain', 'cokestudio', 'KaifiKhalil', 'AtifAslam', 'zeemusiccompany', 'DesiMelodies'],
    hindi: ['zeemusiccompany', 'tseries', 'SonyMusicIndia', 'yrf', 'AnuvJain', 'AtifAslam'],
    punjabi: ['DesiMelodies', 'SpeedRecords', 'APDHILLON', 'SidhuMooseWalaOfficial', 'DiljitDosanjh'],
    mix: ['cokestudio', 'KaifiKhalil', 'TalhaAnjum', 'HasanRaheem', 'AtifAslam', 'AnuvJain'],
    english: ['BillieEilish', 'TheWeeknd', 'Coldplay', 'Adele', 'EdSheeran'],
  },
  discover: {
    all: ['cokestudio', 'AnuvJain', 'SonyMusicIndia', 'yrf', 'DesiMelodies', 'AtifAslam'],
    hindi: ['SonyMusicIndia', 'yrf', 'tseries', 'zeemusiccompany', 'saregama', 'AnuvJain'],
    punjabi: ['DiljitDosanjh', 'APDHILLON', 'SpeedRecords', 'DesiMelodies', 'RehaanRecords'],
    mix: ['cokestudio', 'HasanRaheem', 'KaifiKhalil', 'TalhaAnjum', 'AtifAslam', 'AnuvJain'],
    english: ['Coldplay', 'SabrinaCarpenter', 'EdSheeran', 'DuaLipa', 'BrunoMars', 'TheWeeknd'],
  },
};

const ARTIST_HANDLE_INDEX: Array<{ keywords: RegExp; handle: string }> = [
  { keywords: /\b(karan\s*aujla|aujla)\b/i, handle: 'RehaanRecords' },
  { keywords: /\b(talha\s*anjum|young\s*stunners|kaun\s*talha)\b/i, handle: 'TalhaAnjum' },
  { keywords: /\b(coke\s*studio|pasoori|jhol)\b/i, handle: 'cokestudio' },
  { keywords: /\b(kaifi\s*khalil|kahani\s*suno)\b/i, handle: 'KaifiKhalil' },
  { keywords: /\b(hasan\s*raheem)\b/i, handle: 'HasanRaheem' },
  { keywords: /\b(anuv\s*jain|husn|jo\s*tum\s*mere)\b/i, handle: 'AnuvJain' },
  { keywords: /\b(arijit\s*singh|sajni|kesariya|pehle\s*bhi)\b/i, handle: 'tseries' },
  { keywords: /\b(atif\s*aslam)\b/i, handle: 'AtifAslam' },
  { keywords: /\b(diljit\s*dosanjh|lover|hass\s*hass)\b/i, handle: 'DiljitDosanjh' },
  { keywords: /\b(ap\s*dhillon|brown\s*munde)\b/i, handle: 'APDHILLON' },
  { keywords: /\b(sidhu\s*moose|moosewala|295)\b/i, handle: 'SidhuMooseWalaOfficial' },
  { keywords: /\b(badshah)\b/i, handle: 'Badshah' },
  { keywords: /\b(honey\s*singh|yo\s*yo)\b/i, handle: 'YoYoHoneySingh' },
  { keywords: /\b(divine)\b/i, handle: 'DIVINE' },
  { keywords: /\b(speed\s*records|punjabi)\b/i, handle: 'SpeedRecords' },
  { keywords: /\b(desi\s*melodies|b\s*praak|jaani)\b/i, handle: 'DesiMelodies' },
  { keywords: /\b(t-?series|bollywood|hindi)\b/i, handle: 'tseries' },
  { keywords: /\b(zee\s*music)\b/i, handle: 'zeemusiccompany' },
  { keywords: /\b(sony\s*music)\b/i, handle: 'SonyMusicIndia' },
  { keywords: /\b(yrf|yash\s*raj)\b/i, handle: 'yrf' },
  { keywords: /\b(weeknd)\b/i, handle: 'TheWeeknd' },
  { keywords: /\b(billie\s*eilish)\b/i, handle: 'BillieEilish' },
  { keywords: /\b(kendrick)\b/i, handle: 'KendrickLamar' },
  { keywords: /\b(sabrina\s*carpenter)\b/i, handle: 'SabrinaCarpenter' },
  { keywords: /\b(dua\s*lipa)\b/i, handle: 'DuaLipa' },
  { keywords: /\b(coldplay)\b/i, handle: 'Coldplay' },
  { keywords: /\b(bruno\s*mars)\b/i, handle: 'BrunoMars' },
  { keywords: /\b(ed\s*sheeran)\b/i, handle: 'EdSheeran' },
];

const ENERGETIC_POSITIVE_RE =
  /\b(karan\s*aujla|shubh|sidhu\s*moose|diljit|ap\s*dhillon|talha\s*anjum|young\s*stunners|divine|kr\$na|raftaar|badshah|honey\s*singh|hanumankind|seedhe\s*maut|travis\s*scott|kendrick|dua\s*lipa|party|dance|club|rap|hip\s*hop|bass|banger|drill|gang|tauba|cheques|millionaire|aaj\s*ki\s*raat|jhoome|winning\s*speech|softly|295|g\.o\.a\.t|workout|vibe|fire|remix)\b/i;
const ENERGETIC_NEGATIVE_RE =
  /\b(sad|heartbreak|broken|tears|judai|bewafa|dard|rona|tanhai|unplugged|acoustic|lofi|tribute)\b/i;
const SAD_POSITIVE_RE =
  /\b(b\s*praak|jaani|arijit|vishal\s*mishra|anuv\s*jain|faheem\s*abdullah|kaifi\s*khalil|aur|talwiinder|atif\s*aslam|aditya\s*rikhari|billie\s*eilish|joji|lewis\s*capaldi|adele|sad|heartbreak|dard|bewafa|judai|tanhai|khoya|rona|tears|broken|acoustic|unplugged|ishq|kahani\s*suno|tu\s*hai\s*kahan|jo\s*tum\s*mere\s*ho|husn|pehle\s*bhi\s*main|channa\s*mereya|filhall|qismat|pachtaoge|kya\s*loge\s*tum|pal\s*pal|afusic|jhol|wishes|raanjhan|agar\s*tum\s*saath|ghazal)\b/i;
const SAD_NEGATIVE_RE = /\b(party|club|dance\s*number|dj|cypher|drill|workout)\b/i;
const DISCOVER_POSITIVE_RE =
  /\b(coke\s*studio|abdul\s*hannan|hasan\s*raheem|maanu|ali\s*sethi|shae\s*gill|jasleen\s*royal|mitraz|prateek\s*kuhad|zaeden|armaan\s*malik|shreya\s*ghoshal|mohit\s*chauhan|pritam|satinder\s*sartaaj|harnoor|sza|lana\s*del\s*rey|ed\s*sheeran|coldplay|bruno\s*mars|acoustic|sufi|indie|love|romantic|pasoori|jhol|iraaday|bikhra|sajni|heeriye|sahiba|kesariya|apna\s*bana\s*le|lover|hass\s*hass|waalian|moonlight|o\s*maahi|akhiyaan|ve\s*kamleya)\b/i;
const PUNJABI_SIGNAL_RE =
  /\b(punjabi|speed\s*records|apna\s*punjab|karan\s*aujla|shubh|diljit|ap\s*dhillon|sidhu\s*moose|b\s*praak|ammy\s*virk|harnoor|navaan|arjan|sartaaj|talwiinder|desi\s*melodies)\b/i;
const MIX_SIGNAL_RE =
  /\b(coke\s*studio|talha\s*anjum|kaifi\s*khalil|aur|hasan\s*raheem|abdul\s*hannan|maanu|afusic|atif\s*aslam|ali\s*sethi|anuv\s*jain|faheem\s*abdullah|urdu)\b/i;
const HINDI_SIGNAL_RE =
  /\b(t-?series|zee\s*music|sony\s*music\s*india|yrf|saregama|arijit|vishal\s*mishra|anuv\s*jain|badshah|divine|honey\s*singh|darshan\s*raval|mitraz|jasleen|hindi|bollywood)\b/i;
const ENGLISH_SIGNAL_RE =
  /\b(weeknd|billie\s*eilish|kendrick|travis\s*scott|sabrina\s*carpenter|dua\s*lipa|coldplay|bruno\s*mars|sza|ed\s*sheeran|adele|ariana\s*grande|post\s*malone|drake)\b/i;

function scoreCategoryMoodAndLang(
  track: Track,
  category: Exclude<CategoryId, 'trending'>,
  lang: IndiaLanguageFilter,
  subFilter?: string
): number {
  const meta = videoMetaCache.get(track.id) ?? '';
  const haystack = `${track.title} ${track.artist} ${track.channelTitle} ${meta}`;
  let score = scoreTrackQuality(track);

  if (category === 'energetic') {
    if (ENERGETIC_POSITIVE_RE.test(haystack)) score += 40;
    if (ENERGETIC_NEGATIVE_RE.test(track.title)) score -= 45;
  } else if (category === 'sad') {
    if (SAD_POSITIVE_RE.test(haystack)) score += 45;
    if (SAD_NEGATIVE_RE.test(track.title)) score -= 40;
  } else if (category === 'discover') {
    if (DISCOVER_POSITIVE_RE.test(haystack)) score += 40;
  }

  if (lang === 'punjabi') {
    if (PUNJABI_SIGNAL_RE.test(haystack)) score += 35;
    if (ENGLISH_SIGNAL_RE.test(haystack)) score -= 40;
  } else if (lang === 'mix') {
    if (MIX_SIGNAL_RE.test(haystack)) score += 35;
    if (ENGLISH_SIGNAL_RE.test(haystack)) score -= 40;
  } else if (lang === 'hindi') {
    if (HINDI_SIGNAL_RE.test(haystack)) score += 30;
    if (ENGLISH_SIGNAL_RE.test(haystack)) score -= 45;
  } else if (lang === 'english') {
    if (ENGLISH_SIGNAL_RE.test(haystack)) score += 45;
    if (HINDI_SIGNAL_RE.test(haystack) || PUNJABI_SIGNAL_RE.test(haystack)) score -= 60;
  }

  if (subFilter) {
    const tokens = subFilter
      .toLowerCase()
      .split(/[\s\-&/]+/)
      .filter((w) => w.length >= 3);
    for (const tok of tokens) {
      if (haystack.toLowerCase().includes(tok)) score += 28;
    }
  }

  return score;
}

async function fetchZeroSearchCategoryTracks(
  category: Exclude<CategoryId, 'trending'>,
  lang: IndiaLanguageFilter,
  rotationIdx: number,
  subFilter?: string
): Promise<Track[]> {
  const allowDevotional = subFilter?.toLowerCase() === 'devotional';
  const handles = ZERO_SEARCH_CHANNELS_BY_CAT[category][lang] ?? ZERO_SEARCH_CHANNELS_BY_CAT[category].all;

  // Pick 3 official channels in rotation (3 x 1u playlistItems + batched 1u videos = ~6 units vs 100 search units!)
  const chosenHandles: string[] = [];
  for (let i = 0; i < Math.min(3, handles.length); i++) {
    chosenHandles.push(handles[(rotationIdx + i) % handles.length]);
  }

  const chartRegions =
    lang === 'english' ? ['US', 'GB'] : lang === 'mix' ? ['PK', 'IN'] : ['IN', 'PK'];

  const [playlistBatches, chartBatches] = await Promise.all([
    Promise.all(chosenHandles.map((h) => fetchPlaylistTracks(h, category, 20))),
    Promise.all(chartRegions.map((reg) => fetchChartRegion(reg, lang, 30).catch(() => [] as Track[]))),
  ]);

  const rawPool: Track[] = [];
  const maxBatchLen = Math.max(...playlistBatches.map((b) => b.length), 0);
  for (let i = 0; i < maxBatchLen; i++) {
    for (const batch of playlistBatches) {
      if (batch[i]) rawPool.push({ ...batch[i], category });
    }
  }
  for (const chart of chartBatches) {
    for (const t of chart) {
      rawPool.push({ ...t, category });
    }
  }

  // Only sweep warm videoCache items matching the target language if playlist/chart pool is thin
  if (rawPool.length < 24) {
    for (const [, entry] of videoCache.exportValidEntries()) {
      if (rawPool.length >= 60) break;
      const hay = `${entry.data.title} ${entry.data.artist} ${entry.data.channelTitle}`;
      if (lang === 'english' && (HINDI_SIGNAL_RE.test(hay) || PUNJABI_SIGNAL_RE.test(hay) || MIX_SIGNAL_RE.test(hay))) {
        continue;
      }
      rawPool.push({ ...entry.data, category });
    }
  }

  const languageScopedPool =
    lang === 'english'
      ? rawPool.filter((t) => {
          const hay = `${t.title} ${t.artist} ${t.channelTitle}`;
          return !HINDI_SIGNAL_RE.test(hay) && !PUNJABI_SIGNAL_RE.test(hay) && !MIX_SIGNAL_RE.test(hay);
        })
      : rawPool;

  const candidatePool = languageScopedPool.length >= 6 ? languageScopedPool : rawPool;

  const strictTracks = candidatePool.filter((t) => isValidMusicTrack(t, lang, { allowDevotional }));
  const relaxedTracks = candidatePool.filter((t) =>
    isValidMusicTrack(t, lang, { allowDevotional, minViews: 10_000 })
  );
  const scoredPool = (strictTracks.length >= 6 ? strictTracks : relaxedTracks).sort(
    (a, b) =>
      scoreCategoryMoodAndLang(b, category, lang, subFilter) -
      scoreCategoryMoodAndLang(a, category, lang, subFilter)
  );

  const merged: Track[] = [];
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  for (const t of scoredPool) {
    if (seenIds.has(t.id)) continue;
    const key = normalizeSongKey(t.title);
    if (key && seenKeys.has(key)) continue;
    seenIds.add(t.id);
    if (key) seenKeys.add(key);
    merged.push({ ...t, category });
    if (merged.length >= 28) break;
  }

  if (merged.length > 4 && rotationIdx > 0) {
    const offset = (rotationIdx * 3) % merged.length;
    return [...merged.slice(offset), ...merged.slice(0, offset)].slice(0, 24);
  }
  return merged.slice(0, 24);
}

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

const SHORT_CLIP_TITLE_RE =
  /(#shorts\b|#ytshorts\b|\byoutube\s*shorts\b|\bwhatsapp\s*status\b|\bringtone\b|\bstatus\s*video\b|\bsong\s*status\b)/i;

function isShortOrSnippetClip(track: Track): boolean {
  const dur = track.durationSeconds ?? 0;
  if (dur > 0 && dur < 70) return true;
  if (SHORT_CLIP_TITLE_RE.test(track.title) && dur < 120) return true;
  return false;
}

async function fallbackSearchWithoutQuota(
  query: string,
  category: CategoryId | undefined,
  maxResults: number,
  lang: IndiaLanguageFilter = 'all'
): Promise<Track[]> {
  const qLower = query.toLowerCase();
  const queryWords = qLower
    .replace(/\b(official|music|video|song|songs|full|audio|lyrics|or)\b/gi, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3);

  const matchedHandles: string[] = [];
  for (const entry of ARTIST_HANDLE_INDEX) {
    if (entry.keywords.test(query)) {
      matchedHandles.push(entry.handle);
      if (matchedHandles.length >= 2) break;
    }
  }

  const candidatePool: Track[] = [];
  if (matchedHandles.length > 0) {
    const lists = await Promise.all(
      matchedHandles.map((h) => fetchPlaylistTracks(h, category, 25))
    );
    for (const list of lists) candidatePool.push(...list);
  }

  for (const [, entry] of videoCache.exportValidEntries()) {
    candidatePool.push(entry.data);
  }

  if (candidatePool.length < 15) {
    const [inChart, pkChart] = await Promise.all([
      fetchChartRegion('IN', lang, 35).catch(() => [] as Track[]),
      fetchChartRegion('PK', lang, 20).catch(() => [] as Track[]),
    ]);
    candidatePool.push(...inChart, ...pkChart);
  }

  const seen = new Set<string>();
  const scored: Array<{ track: Track; score: number }> = [];

  for (const raw of candidatePool) {
    if (seen.has(raw.id)) continue;
    seen.add(raw.id);
    if (isPhonkTrack(raw.title, raw.channelTitle) || isShortOrSnippetClip(raw)) continue;

    const hay = `${raw.title} ${raw.artist} ${raw.channelTitle}`.toLowerCase();
    let tokenMatches = 0;
    for (const w of queryWords) {
      if (hay.includes(w)) tokenMatches++;
    }
    if (queryWords.length > 0 && tokenMatches === 0) continue;

    const score = scoreTrackQuality(raw, query) + tokenMatches * 35;
    scored.push({
      track: category ? { ...raw, category } : raw,
      score,
    });
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map((x) => x.track);
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

  const isDirectUserSearch = !category && !skipLanguageBias && !lang;

  const refinedQuery =
    type === 'videos'
      ? trimmed.toLowerCase().includes('video')
        ? trimmed
        : `${trimmed} official music video`
      : trimmed;

  const safeRegion = regionCode && /^[A-Z]{2}$/.test(regionCode.toUpperCase()) ? regionCode.toUpperCase() : 'IN';
  const clampedMax = Math.min(Math.max(maxResults, 1), 25);
  const fetchMax = !category && clampedMax >= 8 ? 25 : clampedMax;

  const cacheKey = `search:v4:${refinedQuery}:${type}:${clampedMax}:${safeRegion}:${order}:${publishedAfter || ''}:${pageToken || ''}:${lang || ''}:${skipLanguageBias}`;
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
        maxResults: String(fetchMax),
        q: `${refinedQuery} -phonk`,
        regionCode: safeRegion,
        order,
        key: apiKey,
      });

      if (!skipLanguageBias && lang && lang !== 'english') {
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

    try {
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
      const nonPhonk = tracks.filter((t) => !isPhonkTrack(t.title, t.channelTitle));

      const fullLengthOnly = nonPhonk.filter((t) => !isShortOrSnippetClip(t));
      let filtered = fullLengthOnly.length > 0 ? fullLengthOnly : nonPhonk;

      if (isDirectUserSearch || !category) {
        filtered = [...filtered].sort((a, b) => scoreTrackQuality(b, trimmed) - scoreTrackQuality(a, trimmed));
      }

      const result = {
        tracks: filtered.slice(0, clampedMax),
        nextPageToken: searchData.nextPageToken,
      };
      searchCache.set(cacheKey, result);
      return result;
    } catch (err) {
      if (
        err instanceof YouTubeApiError &&
        (err.code === 'YOUTUBE_QUOTA_EXCEEDED' || err.code === 'YOUTUBE_API_KEY_INVALID') &&
        !pageToken
      ) {
        const fallbackTracks = await fallbackSearchWithoutQuota(
          trimmed,
          category,
          clampedMax,
          lang ?? 'all'
        );
        if (fallbackTracks.length > 0) {
          return { tracks: fallbackTracks };
        }
      }
      throw err;
    }
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
  const rotKey = `${category}:${lang}`;
  const currentIdx = categoryRotation.get(rotKey) ?? 0;
  const nextIdx = forceRefresh ? (currentIdx + 1) % langPool.length : currentIdx;
  if (forceRefresh) {
    categoryRotation.set(rotKey, nextIdx);
  }

  const normalizedSub = subFilter && subFilter !== 'All' ? subFilter.trim() : undefined;
  const cacheKey = `cat:${category}:${region}:${lang}:${normalizedSub || nextIdx}`;

  if (!forceRefresh && !customQueries) {
    const cached = categoryCache.get(cacheKey);
    if (cached) return cached;
  }

  return coalesce(`${cacheKey}:${customQueries ? 'ai' : 'std'}`, async () => {
    const allowDevotional = normalizedSub?.toLowerCase() === 'devotional';

    // Default category loads use the 1-unit playlistItems + videos engine (saves ~95 quota units per load and never breaks when /search quota is exhausted!)
    const shouldTrySearchFirst = Boolean(normalizedSub || (customQueries && customQueries.length > 0)) && hasAvailableSearchKey();

    if (shouldTrySearchFirst) {
      try {
        const aiSongList = customQueries && customQueries.length > 0 ? customQueries : [];
        const langPrefix =
          lang === 'all' ? 'hindi urdu punjabi' : lang === 'mix' ? 'hindi urdu' : lang;
        const singleQuery = normalizedSub
          ? `${langPrefix} ${normalizedSub} official song`
          : aiSongList
              .slice(0, 4)
              .map((q) => q.replace(/\s*[-–—]\s*/g, ' ').trim())
              .filter(Boolean)
              .join(' OR ');

        const rawTracks = await searchYouTubeTracks({
          query: singleQuery,
          type: 'songs',
          maxResults: 25,
          category,
          regionCode: region,
          lang,
          skipLanguageBias: true,
        });

        const strictTracks = rawTracks
          .filter((t) => isValidMusicTrack(t, lang, { allowDevotional }))
          .map((t) => ({ ...t, category }));

        const relaxedTracks = rawTracks
          .filter((t) => isValidMusicTrack(t, lang, { allowDevotional, minViews: 10_000 }))
          .map((t) => ({ ...t, category }));

        const merged: Track[] = [];
        const seenIds = new Set<string>();
        const seenKeys = new Set<string>();

        const pushUnique = (t: Track) => {
          if (seenIds.has(t.id)) return;
          const key = normalizeSongKey(t.title);
          if (key && seenKeys.has(key)) return;
          seenIds.add(t.id);
          if (key) seenKeys.add(key);
          merged.push(t);
        };

        for (const t of strictTracks) pushUnique(t);
        if (merged.length < 6) {
          for (const t of relaxedTracks) pushUnique(t);
        }

        const finalTracks = merged.slice(0, 24);
        if (finalTracks.length > 0) {
          if (!customQueries) categoryCache.set(cacheKey, finalTracks);
          return finalTracks;
        }
      } catch (err) {
        if (!(err instanceof YouTubeApiError && err.code === 'YOUTUBE_QUOTA_EXCEEDED')) {
          throw err;
        }
      }
    }

    const zeroSearchTracks = await fetchZeroSearchCategoryTracks(category, lang, nextIdx, normalizedSub);
    if (zeroSearchTracks.length === 0) {
      throw new YouTubeApiError(
        'Unable to load category tracks right now. Please check your YouTube API quota or try refreshing.',
        429,
        'YOUTUBE_QUOTA_EXCEEDED'
      );
    }

    if (!customQueries) {
      categoryCache.set(cacheKey, zeroSearchTracks);
    }
    return zeroSearchTracks;
  });
}

export async function getRelatedTracks(
  videoId: string,
  title?: string,
  artist?: string,
  excludeIds: string[] = []
): Promise<Track[]> {
  const excludeSet = new Set<string>([videoId, ...excludeIds]);

  const filterUnplayed = (list: Track[]) =>
    list.filter(
      (t) =>
        !excludeSet.has(t.id) &&
        !isPhonkTrack(t.title, t.channelTitle) &&
        !COMPILATION_TITLE_RE.test(t.title) &&
        !CLUTTER_TITLE_RE.test(t.title) &&
        !CLUTTER_TITLE_RE.test(t.channelTitle)
    );

  const cached = relatedCache.get(videoId);
  if (cached) {
    const unplayedCached = filterUnplayed(cached);
    if (unplayedCached.length >= 12) {
      return unplayedCached.slice(0, 24);
    }
  }

  const baseTracks = await coalesce(`related:${videoId}`, async () => {
    const channelId = videoChannelIdCache.get(videoId);
    let candidateTracks: Track[] = [];

    const cleanRelatedFilter = (list: Track[]) =>
      list.filter(
        (t) =>
          t.id !== videoId &&
          !isPhonkTrack(t.title, t.channelTitle) &&
          !isShortOrSnippetClip(t) &&
          !COMPILATION_TITLE_RE.test(t.title) &&
          !CLUTTER_TITLE_RE.test(t.title) &&
          !CLUTTER_TITLE_RE.test(t.channelTitle) &&
          (t.durationSeconds ?? 0) <= 520
      );

    if (hasConfiguredYoutubeKeys()) {
      // 1. Prefer artist's own official uploads playlist (only 2 units, 0 search units!)
      if (channelId && channelId.startsWith('UC')) {
        candidateTracks = await fetchPlaylistTracks(`UU${channelId.slice(2)}`, undefined, 22).catch(
          () => [] as Track[]
        );
      }

      let cleaned = cleanRelatedFilter(candidateTracks);

      // 2. Only call /search if playlist had < 4 usable tracks AND search quota is healthy
      if (cleaned.length < 6 && hasAvailableSearchKey()) {
        try {
          const baseQuery = [artist, title].filter(Boolean).join(' ').trim() || 'popular hindi mix';
          const cleanQuery = baseQuery.replace(/\(.*?\)|\[.*?\]/g, '').trim().slice(0, 90);
          const result = await searchYouTubeTracks({
            query: `${cleanQuery} official song`,
            type: 'songs',
            maxResults: 20,
            regionCode: 'IN',
            lang: 'mix',
            skipLanguageBias: true,
          });
          cleaned = cleanRelatedFilter([...cleaned, ...result]);
        } catch {
          // ignore search fallback failure
        }
      }

      // 3. Supplement with matched artist handle uploads
      if (cleaned.length < 10) {
        const hint = `${artist ?? ''} ${title ?? ''}`;
        const matched = ARTIST_HANDLE_INDEX.find((e) => e.keywords.test(hint));
        const extraList = matched
          ? await fetchPlaylistTracks(matched.handle, undefined, 20).catch(() => [] as Track[])
          : [];
        const seen = new Set<string>();
        cleaned = cleanRelatedFilter([...cleaned, ...extraList]).filter((t) => {
          if (seen.has(t.id)) return false;
          seen.add(t.id);
          return true;
        });
      }

      candidateTracks = cleaned;
    }

    // 4. Always blend in JioSaavn artist + companion catalog tracks so Infinite Radio never loops 10-12 songs!
    const saavnRelated = await fetchSaavnRelatedTracks(
      artist || '',
      title || '',
      excludeSet,
      22
    ).catch(() => []);

    const saavnAsTracks: Track[] = saavnRelated.map((item) => ({
      id: item.id,
      title: item.title,
      artist: item.artist,
      channelTitle: item.artist,
      thumbnail: item.thumbnail,
      thumbnailHigh: item.thumbnailHigh,
      duration: item.duration,
      durationSeconds: item.durationSeconds,
    }));

    const combined: Track[] = [];
    const seenIds = new Set<string>();
    const seenSongKeys = new Set<string>();

    const pushUnique = (t: Track) => {
      if (seenIds.has(t.id)) return;
      const key = normalizeSongKey(t.title);
      if (key && seenSongKeys.has(key)) return;
      seenIds.add(t.id);
      if (key) seenSongKeys.add(key);
      combined.push(t);
    };

    const maxLen = Math.max(candidateTracks.length, saavnAsTracks.length);
    for (let i = 0; i < maxLen; i++) {
      if (candidateTracks[i]) pushUnique(candidateTracks[i]);
      if (saavnAsTracks[i]) pushUnique(saavnAsTracks[i]);
    }

    relatedCache.set(videoId, combined);
    return combined;
  });

  let freshUnplayed = filterUnplayed(baseTracks);

  // If the user has already listened through most of baseTracks, dynamically fetch a fresh page from JioSaavn!
  if (freshUnplayed.length < 12) {
    const extraSaavn = await fetchSaavnRelatedTracks(
      artist || '',
      title || '',
      excludeSet,
      20
    ).catch(() => []);

    const existingIds = new Set(freshUnplayed.map((t) => t.id));
    const existingKeys = new Set(freshUnplayed.map((t) => normalizeSongKey(t.title)).filter(Boolean));

    for (const item of extraSaavn) {
      if (excludeSet.has(item.id) || existingIds.has(item.id)) continue;
      const key = normalizeSongKey(item.title);
      if (key && existingKeys.has(key)) continue;
      existingIds.add(item.id);
      if (key) existingKeys.add(key);
      freshUnplayed.push({
        id: item.id,
        title: item.title,
        artist: item.artist,
        channelTitle: item.artist,
        thumbnail: item.thumbnail,
        thumbnailHigh: item.thumbnailHigh,
        duration: item.duration,
        durationSeconds: item.durationSeconds,
      });
    }
  }

  return freshUnplayed.slice(0, 24);
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

function formatSubscriberCount(rawCount: string | undefined): string | undefined {
  if (!rawCount) return undefined;
  const num = parseInt(rawCount, 10);
  if (Number.isNaN(num) || num <= 0) return undefined;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M subscribers`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K subscribers`;
  return `${num} subscribers`;
}

export async function getArtistProfile(
  rawArtistName: string,
  seedVideoId?: string
): Promise<ArtistProfileResponse> {
  const artistName = decodeHtmlEntities(rawArtistName || '').trim().slice(0, 100);
  if (!artistName) {
    return {
      artistName: 'Unknown Artist',
      topTracks: [],
      musicVideos: [],
      relatedArtists: [],
    };
  }

  const cacheKey = `v4::${artistName.toLowerCase()}::${seedVideoId || ''}`;
  const cached = artistCache.get(cacheKey) || artistCache.get(`v4::${artistName.toLowerCase()}::`);
  if (cached && cached.topTracks.length >= 12) {
    return cached;
  }

  return coalesce(`artist:${cacheKey}`, async () => {
    let channelId = seedVideoId ? videoChannelIdCache.get(seedVideoId) : undefined;
    let avatarUrl: string | undefined;
    let subscriberCount: string | undefined;
    let channelTitle: string | undefined;
    let uploadsPlaylistId: string | null = null;

    // Load a fast, balanced initial starter batch (24 songs) instead of dumping 90 songs at once
    const saavnCatalogPromise = fetchSaavnArtistCatalog(artistName, {
      category: 'all',
      page: 1,
      limit: 24,
    }).catch(() => []);
    const officialPosterPromise = fetchOfficialArtistPoster(artistName).catch(() => undefined);

    const isRecordLabelChannel = (title: string | undefined): boolean => {
      if (!title) return false;
      return /\b(t-?series|zee\s*music|sony\s*music|yrf|yash\s*raj|speed\s*records|desi\s*melodies|rehaan\s*records|saregama|tips\s*official|shemaroo|eros\s*now|white\s*hill|humble\s*music|geet\s*mp3|jass\s*records|vyrl\s*originals|panorama\s*music|times\s*music|venus|ishtar|aditya\s*music|lahari\s*music|think\s*music|junglee\s*music)\b/i.test(
        title
      );
    };

    if (hasConfiguredYoutubeKeys()) {
      // 1. Try resolving channel info via seedVideoId -> videoChannelIdCache (or fetch video snippet if needed)
      if (!channelId && seedVideoId && /^[a-zA-Z0-9_-]{6,20}$/.test(seedVideoId)) {
        try {
          await enrichVideoIds([seedVideoId]);
          channelId = videoChannelIdCache.get(seedVideoId);
        } catch {
          // ignore
        }
      }

      // 2. Check curated handle index if artist matches well-known handle
      const matchedHandleEntry = ARTIST_HANDLE_INDEX.find((e) => e.keywords.test(artistName));

      try {
        if (channelId && channelId.startsWith('UC')) {
          const chData = await fetchYouTubeJson<{
            items?: Array<{
              id?: string;
              snippet?: { title?: string; thumbnails?: { high?: { url?: string }; medium?: { url?: string } } };
              statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean };
              contentDetails?: { relatedPlaylists?: { uploads?: string } };
            }>;
          }>(
            (apiKey) =>
              `${YT_API_BASE}/channels?part=snippet,statistics,contentDetails&id=${encodeURIComponent(
                channelId!
              )}&key=${encodeURIComponent(apiKey)}`,
            'videos'
          );
          const ch = chData.items?.[0];
          if (ch) {
            const rawChTitle = ch.snippet?.title ? decodeHtmlEntities(ch.snippet.title) : undefined;
            uploadsPlaylistId = ch.contentDetails?.relatedPlaylists?.uploads ?? `UU${channelId.slice(2)}`;
            // Only adopt channel avatar & title if it is the artist's personal channel, NEVER a record label like T-Series
            if (rawChTitle && !isRecordLabelChannel(rawChTitle)) {
              channelTitle = rawChTitle;
              avatarUrl = ch.snippet?.thumbnails?.high?.url || ch.snippet?.thumbnails?.medium?.url;
              if (!ch.statistics?.hiddenSubscriberCount) {
                subscriberCount = formatSubscriberCount(ch.statistics?.subscriberCount);
              }
            }
          }
        } else if (matchedHandleEntry) {
          const chData = await fetchYouTubeJson<{
            items?: Array<{
              id?: string;
              snippet?: { title?: string; thumbnails?: { high?: { url?: string }; medium?: { url?: string } } };
              statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean };
              contentDetails?: { relatedPlaylists?: { uploads?: string } };
            }>;
          }>(
            (apiKey) =>
              `${YT_API_BASE}/channels?part=snippet,statistics,contentDetails&forHandle=${encodeURIComponent(
                matchedHandleEntry.handle
              )}&key=${encodeURIComponent(apiKey)}`,
            'videos'
          );
          const ch = chData.items?.[0];
          if (ch) {
            const rawChTitle = ch.snippet?.title ? decodeHtmlEntities(ch.snippet.title) : undefined;
            uploadsPlaylistId = ch.contentDetails?.relatedPlaylists?.uploads ?? null;
            if (rawChTitle && !isRecordLabelChannel(rawChTitle)) {
              channelTitle = rawChTitle;
              avatarUrl = ch.snippet?.thumbnails?.high?.url || ch.snippet?.thumbnails?.medium?.url;
              if (!ch.statistics?.hiddenSubscriberCount) {
                subscriberCount = formatSubscriberCount(ch.statistics?.subscriberCount);
              }
            }
          }
        }
      } catch {
        // non-fatal channel metadata lookup failure
      }
    }

    let channelTracks: Track[] = [];
    if (uploadsPlaylistId && hasConfiguredYoutubeKeys()) {
      channelTracks = await fetchPlaylistTracks(uploadsPlaylistId, undefined, 25).catch(() => []);
    }

    let searchedSongs: Track[] = [];
    let searchedVideos: Track[] = [];
    if (hasConfiguredYoutubeKeys() && hasAvailableSearchKey()) {
      const [songsRes, videosRes] = await Promise.allSettled([
        searchYouTubeTracks({
          query: `${artistName} hit songs`,
          type: 'songs',
          maxResults: 25,
          skipLanguageBias: true,
        }),
        searchYouTubeTracks({
          query: `${artistName} official music video`,
          type: 'videos',
          maxResults: 14,
          skipLanguageBias: true,
        }),
      ]);
      if (songsRes.status === 'fulfilled') searchedSongs = songsRes.value;
      if (videosRes.status === 'fulfilled') searchedVideos = videosRes.value;
    }

    // Zero-quota cache sweep for tracks mentioning this artist
    const artistTokens = artistName
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length >= 2);
    const cachedMatches: Track[] = [];
    for (const [, entry] of videoCache.exportValidEntries()) {
      const hay = `${entry.data.artist} ${entry.data.channelTitle} ${entry.data.title}`.toLowerCase();
      if (
        hay.includes(artistName.toLowerCase()) ||
        (artistTokens.length >= 2 && artistTokens.every((tok) => hay.includes(tok)))
      ) {
        cachedMatches.push(entry.data);
      }
    }

    const saavnItems = await saavnCatalogPromise;
    const saavnTracks: Track[] = saavnItems.map((item) => ({
      id: item.id,
      title: item.title,
      artist: item.artist,
      channelTitle: item.artist,
      thumbnail: item.thumbnail,
      thumbnailHigh: item.thumbnailHigh,
      duration: item.duration,
      durationSeconds: item.durationSeconds,
    }));

    const cleanTrackPool = (list: Track[], markVideo = false) => {
      const seenIds = new Set<string>();
      const seenKeys = new Set<string>();
      const out: Track[] = [];
      for (const item of list) {
        if (seenIds.has(item.id)) continue;
        if (isPhonkTrack(item.title, item.channelTitle) || isShortOrSnippetClip(item)) continue;
        if (COMPILATION_TITLE_RE.test(item.title)) continue;
        const k = normalizeSongKey(item.title);
        if (k && seenKeys.has(k)) continue;
        seenIds.add(item.id);
        if (k) seenKeys.add(k);
        out.push(markVideo ? { ...item, isVideo: true } : item);
      }
      return out;
    };

    const ytCleaned = cleanTrackPool([...searchedSongs, ...channelTracks, ...cachedMatches]).sort(
      (a, b) => scoreTrackQuality(b, artistName) - scoreTrackQuality(a, artistName)
    );

    // Initial starter catalog: 24 unique tracks (users load more per category on demand!)
    const topTracks = cleanTrackPool([...saavnTracks.slice(0, 18), ...ytCleaned.slice(0, 12)]).slice(
      0,
      24
    );

    const musicVideosRaw =
      searchedVideos.length > 0
        ? searchedVideos
        : ytCleaned.filter((t) => /\b(official\s*(music\s*)?video|full\s*video)\b/i.test(t.title));
    const musicVideos = cleanTrackPool(musicVideosRaw, true).slice(0, 12);

    const officialPoster = await officialPosterPromise;
    if (officialPoster) {
      avatarUrl = officialPoster;
    } else if (!avatarUrl && (saavnTracks[0] || topTracks[0])) {
      const pick = saavnTracks[0] || topTracks[0];
      avatarUrl = pick.thumbnailHigh || pick.thumbnail;
    }

    // Derive related artists from featured / co-listed tracks and warm cache
    const relatedSet = new Set<string>();
    const artistLower = artistName.toLowerCase();
    for (const t of [...topTracks, ...musicVideos]) {
      const candidate = t.artist?.trim();
      if (
        candidate &&
        candidate.toLowerCase() !== artistLower &&
        !candidate.toLowerCase().includes(artistLower) &&
        !/^(t-series|zee music|sony music|yrf|speed records|saregama|tips official)$/i.test(candidate)
      ) {
        relatedSet.add(candidate);
      }
      if (relatedSet.size >= 10) break;
    }

    const profile: ArtistProfileResponse = {
      artistName,
      avatarUrl,
      subscriberCount,
      channelTitle,
      topTracks,
      musicVideos,
      relatedArtists: Array.from(relatedSet),
    };

    artistCache.set(cacheKey, profile);
    artistCache.set(`v4::${artistName.toLowerCase()}::`, profile);
    return profile;
  });
}

export async function getArtistCategorySongs(options: {
  artistName: string;
  category?: string;
  page?: number;
  excludeIds?: string[];
  excludeTitles?: string[];
}): Promise<{ tracks: Track[]; hasMore: boolean }> {
  const artistName = decodeHtmlEntities(options.artistName || '').trim().slice(0, 100);
  if (!artistName) return { tracks: [], hasMore: false };

  const category = (options.category || 'all').toLowerCase();
  const page = Math.max(1, options.page ?? 1);
  const excludeIdSet = new Set<string>((options.excludeIds || []).map((id) => String(id).trim()).filter(Boolean));
  const excludeTitleSet = new Set<string>(
    (options.excludeTitles || []).map((t) => normalizeSongKey(String(t))).filter(Boolean)
  );

  if (category === 'videos') {
    if (hasConfiguredYoutubeKeys() && hasAvailableSearchKey()) {
      try {
        const ytVideos = await searchYouTubeTracks({
          query: `${artistName} official music video ${page > 1 ? `hits vol ${page}` : ''}`.trim(),
          type: 'videos',
          maxResults: 16,
          skipLanguageBias: true,
        });
        const filtered = ytVideos
          .filter((t) => !excludeIdSet.has(t.id) && !excludeTitleSet.has(normalizeSongKey(t.title)))
          .map((t) => ({ ...t, isVideo: true }));
        return {
          tracks: filtered,
          hasMore: filtered.length >= 6 && page < 10,
        };
      } catch {
        // fallback below
      }
    }
    return { tracks: [], hasMore: false };
  }

  const saavnItems = await fetchSaavnArtistCatalog(artistName, {
    category,
    page,
    limit: 18,
    excludeIds: excludeIdSet,
    excludeTitles: options.excludeTitles || [],
  }).catch(() => []);

  const saavnTracks: Track[] = saavnItems.map((item) => ({
    id: item.id,
    title: item.title,
    artist: item.artist,
    channelTitle: item.artist,
    thumbnail: item.thumbnail,
    thumbnailHigh: item.thumbnailHigh,
    duration: item.duration,
    durationSeconds: item.durationSeconds,
  }));

  const seenIds = new Set<string>(excludeIdSet);
  const seenKeys = new Set<string>(excludeTitleSet);
  const combined: Track[] = [];

  for (const t of saavnTracks) {
    if (seenIds.has(t.id)) continue;
    if (isPhonkTrack(t.title, t.channelTitle) || isShortOrSnippetClip(t)) continue;
    if (COMPILATION_TITLE_RE.test(t.title)) continue;
    const k = normalizeSongKey(t.title);
    if (k && seenKeys.has(k)) continue;
    seenIds.add(t.id);
    if (k) seenKeys.add(k);
    combined.push(t);
  }

  return {
    tracks: combined,
    hasMore: combined.length >= 4 && page < 35,
  };
}

