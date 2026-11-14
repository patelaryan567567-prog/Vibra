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
  const sp = new URLSearchParams({
    id: params.category,
    region: params.region || 'IN',
  });
  if (params.lang && params.lang !== 'all') sp.set('lang', params.lang);
  if (params.refresh) sp.set('refresh', '1');
  if (params.ai) sp.set('ai', '1');
  if (params.subFilter && params.subFilter !== 'All') sp.set('sub', params.subFilter);

  const res = await fetch(`/api/youtube/category?${sp.toString()}`, { signal: params.signal });
  const data = await handleResponse<{ tracks: Track[] }>(res);
  return data.tracks;
}

export async function searchYouTube(params: {
  query: string;
  type: 'songs' | 'videos';
  maxResults?: number;
  pageToken?: string;
  signal?: AbortSignal;
}): Promise<{ tracks: Track[]; nextPageToken?: string }> {
  const sp = new URLSearchParams({
    q: params.query,
    type: params.type,
    maxResults: String(params.maxResults ?? 20),
  });
  if (params.pageToken) {
    sp.set('pageToken', params.pageToken);
  }
  const res = await fetch(`/api/youtube/search?${sp.toString()}`, { signal: params.signal });
  return handleResponse<{ tracks: Track[]; nextPageToken?: string }>(res);
}

export async function fetchSearchSuggestions(query: string, signal?: AbortSignal): Promise<string[]> {
  if (!query.trim()) return [];
  const res = await fetch(`/api/youtube/suggestions?q=${encodeURIComponent(query)}`, { signal });
  if (!res.ok) return [];
  const data = (await res.json()) as { suggestions?: string[] };
  return data.suggestions ?? [];
}

export async function fetchRelatedTracks(
  track: Track,
  excludeIds: string[] = [],
  signal?: AbortSignal
): Promise<Track[]> {
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
  return data.tracks;
}

export async function discoverWithAi(prompt: string, signal?: AbortSignal): Promise<AiDiscoveryResponse> {
  const res = await fetch('/api/ai/discover', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
    signal,
  });
  return handleResponse<AiDiscoveryResponse>(res);
}
