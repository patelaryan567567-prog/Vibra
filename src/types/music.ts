export type CategoryId = 'trending' | 'energetic' | 'sad' | 'discover';

export type IndiaLanguageFilter = 'all' | 'hindi' | 'punjabi' | 'mix' | 'english';

export type NavTab = 'home' | 'explore' | 'search' | 'library' | 'favourites';

export type RepeatMode = 'off' | 'all' | 'one';

export interface Track {
  id: string; // YouTube videoId
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
