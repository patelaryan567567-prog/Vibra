import type {
  AiDiscoveryResponse,
  CategoryId,
  ConfigStatus,
  IndiaLanguageFilter,
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
  const cacheKey = `related:${track.id}`;
  const hit = getClientCache<Track[]>(cacheKey);
  if (hit && hit.length > 0) {
    const excludeSet = new Set(excludeIds);
    return hit.filter((t) => !excludeSet.has(t.id));
  }

  const sp = new URLSearchParams({
    videoId: track.id,
    title: track.title,
    artist: track.artist,
  });
  if (excludeIds.length > 0) {
    sp.set('excludeIds', excludeIds.slice(0, 40).join(','));
  }
  const res = await fetch(`/api/youtube/related?${sp.toString()}`, { signal });
  const data = await handleResponse<{ tracks: Track[] }>(res);
  if (data.tracks.length > 0) {
    setClientCache(cacheKey, data.tracks, 60 * 60 * 1000);
  }
  return data.tracks;
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
  provider?: 'jiosaavn' | 'soundcloud';
  streamUrl?: string;
  matchedTitle?: string;
  matchedArtist?: string;
  durationSeconds?: number;
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

