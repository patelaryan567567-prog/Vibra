export type CategoryId = 'trending' | 'energetic' | 'sad' | 'discover';

export type IndiaLanguageFilter = 'all' | 'hindi' | 'punjabi' | 'mix' | 'english';

export type NavTab = 'home' | 'explore' | 'search' | 'library' | 'favourites';

export type RepeatMode = 'off' | 'all' | 'one';

export interface Track {
  id: string; // YouTube videoId or offline track id
  title: string;
  artist: string;
  channelTitle: string;
  thumbnail: string;
  thumbnailHigh: string;
  duration: string;
  durationSeconds: number;
  viewCount?: string;
  viewCountRaw?: number;
  publishedAt?: string;
  isVideo?: boolean;
  category?: CategoryId;
  isOffline?: boolean;
  offlineTrackId?: string;
}

export interface TrackResumeInfo {
  positionSeconds: number;
  durationSeconds: number;
  updatedAt: number;
}

export interface AiDiscoveryPlan {
  moodTitle: string;
  moodSummary: string;
  categoryMatch: CategoryId;
  vibeTags: string[];
  searchQueries: string[];
}

export interface AiDiscoveryResponse {
  plan: AiDiscoveryPlan;
  tracks: Track[];
  youtubeConfigured: boolean;
  warning?: string;
}

export interface Playlist {
  id: string;
  name: string;
  description: string;
  tracks: Track[];
  createdAt: number;
  updatedAt: number;
}

export interface RecentlyPlayedItem {
  track: Track;
  playedAt: number;
}

export interface SearchHistoryItem {
  query: string;
  timestamp: number;
}

export interface TrackPlayStat {
  track: Track;
  playCount: number;
  lastPlayedAt: number;
}

export interface ArtistPlayStat {
  artist: string;
  playCount: number;
  lastPlayedAt: number;
}

export interface ListeningStats {
  totalPlays: number;
  totalSecondsListened: number;
  trackStats: Record<string, TrackPlayStat>;
  artistStats: Record<string, ArtistPlayStat>;
  dailyPlays: Record<string, number>;
}

export interface ConfigStatus {
  youtubeConfigured: boolean;
  geminiConfigured: boolean;
}

export interface OfflineTrack {
  id: string;
  title: string;
  artist: string;
  album?: string;
  duration: string;
  durationSeconds: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  source: 'device-folder' | 'device-file' | 'saved-online' | 'direct-url';
  addedAt: number;
  artworkDataUrl?: string;
  relativePath?: string;
  sourceVideoId?: string;
}

export interface OfflinePlaylist {
  id: string;
  name: string;
  description: string;
  trackIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface DownloadProgressItem {
  trackId: string;
  title: string;
  artist: string;
  percent: number;
  loadedBytes: number;
  totalBytes: number;
  remainingBytes: number;
  phase: 'resolving' | 'downloading' | 'saving' | 'done';
}

export type AudioSourceProvider = 'jiosaavn' | 'soundcloud' | 'audius' | 'archive';

export interface MultiSourceTrack {
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
