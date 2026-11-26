import type {
  AiDiscoveryResponse,
  ArtistProfileResponse,
  CategoryId,
  ConfigStatus,
  IndiaLanguageFilter,
  LyricLine,
  LyricsEnhanceMode,
  LyricsResponse,
  Track,
} from '../types/music';

export class ApiError extends Error {
  code: string;
  status: number;

  constructor(message: string, code = 'API_ERROR', status = 500) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

interface ClientCacheEntry<T> {
  data: T;
  expiresAt: number;
}

const memCache = new Map<string, ClientCacheEntry<unknown>>();
const CLIENT_CACHE_PREFIX = 'vibra_api_cache:';

// Purge legacy cached lyrics from sessionStorage so stale/wrong lyrics never resurface
try {
  if (typeof sessionStorage !== 'undefined') {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (
        k &&
        k.startsWith(CLIENT_CACHE_PREFIX) &&
        (k.includes(':lyrics:') ||
          k.includes(':lyrics_v2:') ||
          k.includes(':lyrics_v3:') ||
          k.includes(':lyrics_v4:') ||
          k.includes(':lyrics_enh:') ||
          k.includes(':lyrics_enh_v2:') ||
          k.includes(':lyrics_enh_v3:') ||
          k.includes(':lyrics_enh_v4:'))
      ) {
        sessionStorage.removeItem(k);
      }
    }
  }
} catch {
  // ignore storage access issues
}

function getClientCache<T>(key: string): T | undefined {
  const now = Date.now();
  const mem = memCache.get(key) as ClientCacheEntry<T> | undefined;
  if (mem) {
    if (mem.expiresAt > now) return mem.data;
    memCache.delete(key);
  }
  try {
    const raw = sessionStorage.getItem(CLIENT_CACHE_PREFIX + key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as ClientCacheEntry<T>;
    if (parsed && parsed.expiresAt > now) {
      memCache.set(key, parsed);
      return parsed.data;
    }
    sessionStorage.removeItem(CLIENT_CACHE_PREFIX + key);
  } catch {
    // ignore storage limits
  }
  return undefined;
}

function setClientCache<T>(key: string, data: T, ttlMs: number): void {
  const entry: ClientCacheEntry<T> = { data, expiresAt: Date.now() + ttlMs };
  if (memCache.size > 120) {
    const firstKey = memCache.keys().next().value;
    if (firstKey !== undefined) memCache.delete(firstKey);
  }
  memCache.set(key, entry);
  try {
    sessionStorage.setItem(CLIENT_CACHE_PREFIX + key, JSON.stringify(entry));
  } catch {
    // ignore storage quota exceeded
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      data.message || `Request failed with status ${res.status}`,
      data.error || 'API_ERROR',
      res.status
    );
  }
  return data as T;
}

export async function getConfigStatus(signal?: AbortSignal): Promise<ConfigStatus> {
  const res = await fetch('/api/config-status', { signal });
  return handleResponse<ConfigStatus>(res);
}

export async function fetchCategoryTracks(params: {
  category: CategoryId;
  region?: string;
  lang?: IndiaLanguageFilter;
  refresh?: boolean;
  ai?: boolean;
  subFilter?: string;
  signal?: AbortSignal;
}): Promise<Track[]> {
  const region = params.region || 'IN';
  const lang = params.lang || 'all';
  const sub = params.subFilter && params.subFilter !== 'All' ? params.subFilter : '';
  const cacheKey = `cat:${params.category}:${region}:${lang}:${sub}`;

  if (!params.refresh) {
    const hit = getClientCache<Track[]>(cacheKey);
    if (hit && hit.length > 0) return hit;
  }

  const sp = new URLSearchParams({
    id: params.category,
    region,
  });
  if (lang !== 'all') sp.set('lang', lang);
  if (params.refresh) sp.set('refresh', '1');
  if (params.ai) sp.set('ai', '1');
  if (sub) sp.set('sub', sub);

  const res = await fetch(`/api/youtube/category?${sp.toString()}`, { signal: params.signal });
  const data = await handleResponse<{ tracks: Track[] }>(res);
  if (data.tracks.length > 0) {
    setClientCache(cacheKey, data.tracks, 30 * 60 * 1000);
  }
  return data.tracks;
}

export async function searchYouTube(params: {
  query: string;
  type: 'songs' | 'videos';
  maxResults?: number;
  pageToken?: string;
  signal?: AbortSignal;
}): Promise<{ tracks: Track[]; nextPageToken?: string }> {
  const cacheKey = `search:${params.query.trim().toLowerCase()}:${params.type}:${params.maxResults ?? 20}:${params.pageToken || ''}`;
  const hit = getClientCache<{ tracks: Track[]; nextPageToken?: string }>(cacheKey);
  if (hit) return hit;

  const sp = new URLSearchParams({
    q: params.query,
    type: params.type,
    maxResults: String(params.maxResults ?? 20),
  });
  if (params.pageToken) {
    sp.set('pageToken', params.pageToken);
  }
  const res = await fetch(`/api/youtube/search?${sp.toString()}`, { signal: params.signal });
  const data = await handleResponse<{ tracks: Track[]; nextPageToken?: string }>(res);
  setClientCache(cacheKey, data, 20 * 60 * 1000);
  return data;
}

export async function fetchSearchSuggestions(query: string, signal?: AbortSignal): Promise<string[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const cacheKey = `suggest:${trimmed.toLowerCase()}`;
  const hit = getClientCache<string[]>(cacheKey);
  if (hit) return hit;

  const res = await fetch(`/api/youtube/suggestions?q=${encodeURIComponent(trimmed)}`, { signal });
  if (!res.ok) return [];
  const data = (await res.json()) as { suggestions?: string[] };
  const suggestions = data.suggestions ?? [];
  if (suggestions.length > 0) {
    setClientCache(cacheKey, suggestions, 30 * 60 * 1000);
  }
  return suggestions;
}

export async function fetchRelatedTracks(
  track: Track,
  excludeIds: string[] = [],
  signal?: AbortSignal
): Promise<Track[]> {
  const excludeSet = new Set(excludeIds);
  const cacheKey = `related_v2:${track.id}`;
  const hit = getClientCache<Track[]>(cacheKey);
  if (hit && hit.length > 0) {
    const filtered = hit.filter((t) => !excludeSet.has(t.id));
    if (filtered.length >= 10) {
      return filtered;
    }
  }

  const sp = new URLSearchParams({
    videoId: track.id,
    title: track.title,
    artist: track.artist,
  });
  if (excludeIds.length > 0) {
    sp.set('excludeIds', excludeIds.slice(-100).join(','));
  }
  const res = await fetch(`/api/youtube/related?${sp.toString()}`, { signal });
  const data = await handleResponse<{ tracks: Track[] }>(res);
  if (data.tracks.length > 0) {
    setClientCache(cacheKey, data.tracks, 30 * 60 * 1000);
  }
  return data.tracks.filter((t) => !excludeSet.has(t.id));
}

export async function discoverWithAi(prompt: string, signal?: AbortSignal): Promise<AiDiscoveryResponse> {
  const cacheKey = `ai:${prompt.trim().toLowerCase()}`;
  const hit = getClientCache<AiDiscoveryResponse>(cacheKey);
  if (hit) return hit;

  const res = await fetch('/api/ai/discover', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
    signal,
  });
  const data = await handleResponse<AiDiscoveryResponse>(res);
  if (data.tracks.length > 0) {
    setClientCache(cacheKey, data, 30 * 60 * 1000);
  }
  return data;
}

export interface ResolvedAudioStream {
  mode: 'proxy' | 'hls' | 'direct' | 'youtube';
  provider?: 'jiosaavn' | 'soundcloud' | 'audius' | 'archive';
  streamUrl?: string;
  matchedTitle?: string;
  matchedArtist?: string;
  durationSeconds?: number;
}

const prewarmRequestedIds = new Set<string>();

export function getCachedAudioMode(
  videoId: string
): ResolvedAudioStream['mode'] | undefined {
  const hit = getClientCache<ResolvedAudioStream>(`audio_res:${videoId}`);
  return hit?.mode;
}

export async function resolveAudioStream(
  track: Track,
  signal?: AbortSignal
): Promise<ResolvedAudioStream> {
  const cacheKey = `audio_res:${track.id}`;
  const hit = getClientCache<ResolvedAudioStream>(cacheKey);
  if (hit) return hit;

  const sp = new URLSearchParams({
    videoId: track.id,
    title: track.title,
    artist: track.artist,
    duration: String(track.durationSeconds || 0),
  });
  try {
    const res = await fetch(`/api/audio/resolve?${sp.toString()}`, { signal });
    if (!res.ok) return { mode: 'youtube' };
    const data = (await res.json()) as ResolvedAudioStream;
    setClientCache(cacheKey, data, data.mode === 'youtube' ? 8 * 60 * 1000 : 20 * 60 * 1000);
    return data;
  } catch {
    return { mode: 'youtube' };
  }
}

export function prewarmTrackAudio(track: Track | null | undefined): void {
  if (!track?.id || !track.title) return;
  if (track.isOffline || track.offlineTrackId || track.isVideo || track.id.startsWith('dl_') || track.id.startsWith('local_')) {
    return;
  }
  if (getClientCache<ResolvedAudioStream>(`audio_res:${track.id}`)) return;
  if (prewarmRequestedIds.has(track.id)) return;

  prewarmRequestedIds.add(track.id);
  if (prewarmRequestedIds.size > 300) {
    const first = prewarmRequestedIds.values().next().value;
    if (first) prewarmRequestedIds.delete(first);
  }

  void resolveAudioStream(track);
}

export function prewarmTrackBatch(tracks: Track[]): void {
  if (!Array.isArray(tracks) || tracks.length === 0) return;
  const targets = tracks
    .filter(
      (t) =>
        Boolean(t?.id && t.title) &&
        !t.isOffline &&
        !t.offlineTrackId &&
        !t.isVideo &&
        !t.id.startsWith('dl_') &&
        !t.id.startsWith('local_') &&
        !prewarmRequestedIds.has(t.id) &&
        !getClientCache<ResolvedAudioStream>(`audio_res:${t.id}`)
    )
    .slice(0, 6);

  if (targets.length === 0) return;
  for (const t of targets) {
    prewarmRequestedIds.add(t.id);
  }
  if (prewarmRequestedIds.size > 300) {
    for (const key of Array.from(prewarmRequestedIds).slice(0, 80)) {
      prewarmRequestedIds.delete(key);
    }
  }

  void fetch('/api/audio/prewarm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tracks: targets.map((t) => ({
        videoId: t.id,
        title: t.title,
        artist: t.artist,
        durationSeconds: t.durationSeconds || 0,
      })),
    }),
  })
    .then(async (res) => {
      if (!res.ok) return;
      const data = (await res.json()) as { results?: Record<string, ResolvedAudioStream> };
      if (!data.results) return;
      for (const [vid, resolved] of Object.entries(data.results)) {
        if (resolved && resolved.mode) {
          setClientCache(
            `audio_res:${vid}`,
            resolved,
            resolved.mode === 'youtube' ? 8 * 60 * 1000 : 20 * 60 * 1000
          );
        }
      }
    })
    .catch(() => {
      // ignore background prewarm failure
    });
}

export async function fetchTrackLyrics(params: {
  title: string;
  artist?: string;
  durationSeconds?: number;
  forceAi?: boolean;
  signal?: AbortSignal;
}): Promise<LyricsResponse> {
  const title = params.title.trim();
  const artist = (params.artist || '').trim();
  const dur = Math.round(params.durationSeconds || 0);
  const forceAi = Boolean(params.forceAi);
  if (!title) return { found: false, syncedLines: [], plainLyrics: null };

  const cacheKey = `lyrics_v5:${forceAi ? 'ai' : 'std'}:${title.toLowerCase()}:${artist.toLowerCase()}:${dur}`;
  const hit = getClientCache<LyricsResponse>(cacheKey);
  if (hit && hit.found) return hit;

  const sp = new URLSearchParams({ title });
  if (artist) sp.set('artist', artist);
  if (dur > 0) sp.set('duration', String(dur));
  if (forceAi) sp.set('ai', '1');

  const res = await fetch(`/api/lyrics?${sp.toString()}`, { signal: params.signal });
  const data = await handleResponse<LyricsResponse>(res);
  if (data.found) {
    setClientCache(cacheKey, data, 6 * 60 * 60 * 1000);
  }
  return data;
}

export async function enhanceTrackLyrics(params: {
  title: string;
  artist?: string;
  rawLyrics?: string | null;
  syncedLines?: LyricLine[];
  mode: LyricsEnhanceMode;
  signal?: AbortSignal;
}): Promise<LyricsResponse> {
  const title = params.title.trim();
  const artist = (params.artist || '').trim();
  if (!title) return { found: false, syncedLines: [], plainLyrics: null };

  const cacheKey = `lyrics_enh_v5:${params.mode}:${title.toLowerCase()}:${artist.toLowerCase()}:${params.syncedLines?.length || 0}:${params.rawLyrics?.length || 0}`;
  const hit = getClientCache<LyricsResponse>(cacheKey);
  if (hit && hit.found) return hit;

  const res = await fetch('/api/lyrics/enhance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      artist,
      rawLyrics: params.rawLyrics ?? null,
      syncedLines: params.syncedLines ?? [],
      mode: params.mode,
    }),
    signal: params.signal,
  });
  const data = await handleResponse<LyricsResponse>(res);
  if (data.found) {
    setClientCache(cacheKey, data, 6 * 60 * 60 * 1000);
  }
  return data;
}

export async function fetchArtistProfile(params: {
  artist: string;
  seedVideoId?: string;
  signal?: AbortSignal;
}): Promise<ArtistProfileResponse> {
  const artist = params.artist.trim();
  if (!artist) {
    return { artistName: 'Unknown Artist', topTracks: [], musicVideos: [], relatedArtists: [] };
  }
  const cacheKey = `artist_v3:${artist.toLowerCase()}:${params.seedVideoId || ''}`;
  const hit = getClientCache<ArtistProfileResponse>(cacheKey);
  if (hit && hit.topTracks.length >= 25) return hit;

  const sp = new URLSearchParams({ artist });
  if (params.seedVideoId && !params.seedVideoId.startsWith('dl_') && !params.seedVideoId.startsWith('local_') && !params.seedVideoId.startsWith('src_')) {
    sp.set('seedVideoId', params.seedVideoId);
  }
  const res = await fetch(`/api/youtube/artist?${sp.toString()}`, { signal: params.signal });
  const data = await handleResponse<ArtistProfileResponse>(res);
  if (data.topTracks.length > 0) {
    setClientCache(cacheKey, data, 45 * 60 * 1000);
  }
  return data;
}

export async function fetchArtistCategorySongs(params: {
  artist: string;
  category: string;
  page?: number;
  signal?: AbortSignal;
}): Promise<{ tracks: Track[]; hasMore: boolean }> {
  const artist = params.artist.trim();
  if (!artist) return { tracks: [], hasMore: false };
  const category = (params.category || 'all').toLowerCase();
  const page = Math.max(1, params.page ?? 1);

  const cacheKey = `artist_songs_v1:${artist.toLowerCase()}:${category}:${page}`;
  const hit = getClientCache<{ tracks: Track[]; hasMore: boolean }>(cacheKey);
  if (hit && hit.tracks.length > 0) return hit;

  const sp = new URLSearchParams({
    artist,
    category,
    page: String(page),
  });
  const res = await fetch(`/api/youtube/artist/songs?${sp.toString()}`, { signal: params.signal });
  const data = await handleResponse<{ tracks: Track[]; hasMore: boolean }>(res);
  if (data.tracks.length > 0) {
    setClientCache(cacheKey, data, 30 * 60 * 1000);
  }
  return data;
}


