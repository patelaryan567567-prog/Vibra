import React, { useEffect, useRef, useState } from 'react';
import { Clock, Disc3, Play, Search, Trash2, TrendingUp, Tv, X } from 'lucide-react';
import { ApiNoticeBanner } from '../components/ApiNoticeBanner';
import { TrackCard, TrackCardSkeleton, TrackRow } from '../components/TrackCard';
import { TRENDING_SEARCH_KEYWORDS } from '../constants/categories';
import { useLibrary } from '../context/LibraryContext';
import { usePlayer } from '../context/PlayerContext';
import { ApiError, fetchSearchSuggestions, searchYouTube } from '../services/api';
import type { Track } from '../types/music';

interface SearchPageProps {
  initialQuery?: string;
  onConsumeInitialQuery?: () => void;
  onAddToPlaylist: (track: Track) => void;
}

export function SearchPage({
  initialQuery,
  onConsumeInitialQuery,
  onAddToPlaylist,
}: SearchPageProps) {
  const { searchHistory, addSearchQuery, removeSearchQuery, clearSearchHistory } = useLibrary();
  const { playTrack } = usePlayer();

  const [query, setQuery] = useState(initialQuery || '');
  const [activeTab, setActiveTab] = useState<'songs' | 'videos'>('songs');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [results, setResults] = useState<Track[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>(undefined);
  const [hasSearched, setHasSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchAbortRef = useRef<AbortController | null>(null);

  const executeSearch = async (targetQuery: string, targetTab: 'songs' | 'videos' = activeTab) => {
    const trimmed = targetQuery.trim();
    if (!trimmed) return;

    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;

    setQuery(trimmed);
    setShowSuggestions(false);
    setLoading(true);
    setError(null);
    setHasSearched(true);
    setNextPageToken(undefined);
    addSearchQuery(trimmed);

    try {
      const data = await searchYouTube({
        query: trimmed,
        type: targetTab,
        maxResults: 20,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setResults(data.tracks);
      setNextPageToken(data.nextPageToken);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setResults([]);
      setNextPageToken(undefined);
      setError(err instanceof ApiError ? err.message : 'Failed to search YouTube.');
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  };

  const handleLoadMore = async () => {
    if (!nextPageToken || loadingMore || !query.trim()) return;
    setLoadingMore(true);
    try {
      const data = await searchYouTube({
        query: query.trim(),
        type: activeTab,
        maxResults: 20,
        pageToken: nextPageToken,
      });
      setResults((prev) => {
        const seen = new Set(prev.map((t) => t.id));
        const uniqueNew = data.tracks.filter((t) => !seen.has(t.id));
        return [...prev, ...uniqueNew];
      });
      setNextPageToken(data.nextPageToken);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load more results.');
    } finally {
      setLoadingMore(false);
    }
  };

  // Ensure page opens at top with search bar right in front of the user
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    if (!initialQuery) {
      const raf = window.requestAnimationFrame(() => {
        inputRef.current?.focus({ preventScroll: true });
      });
      return () => window.cancelAnimationFrame(raf);
    }
  }, [initialQuery]);

  // Run incoming query from AI Studio or header search
  useEffect(() => {
    if (initialQuery && initialQuery.trim()) {
      executeSearch(initialQuery, activeTab);
      onConsumeInitialQuery?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

  // Live autocomplete suggestions with debounce + AbortController
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed || trimmed.length < 2) {
      setSuggestions([]);
      return;
    }

    const controller = new AbortController();
    const handle = window.setTimeout(async () => {
      try {
        const list = await fetchSearchSuggestions(trimmed, controller.signal);
        if (!controller.signal.aborted) {
          setSuggestions(list);
        }
      } catch {
        // ignore aborted suggestion fetch
      }
    }, 220);

    return () => {
      window.clearTimeout(handle);
      controller.abort();
    };
  }, [query]);

  // Close suggestions dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleTabSwitch = (nextTab: 'songs' | 'videos') => {
    setActiveTab(nextTab);
    if (query.trim() && hasSearched) {
      executeSearch(query, nextTab);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    executeSearch(query, activeTab);
  };

  return (
    <div className="space-y-8 pb-8">
      <div className="space-y-2">
        <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">Search Music &amp; Videos</h1>
        <p className="text-sm text-slate-400">
          Search by song title, artist, album, or keywords directly on YouTube.
        </p>
      </div>

      {/* Large Search Bar + Live Suggestions */}
      <div className="relative" ref={searchContainerRef}>
        <form onSubmit={handleSubmit} className="relative flex items-center gap-2.5">
          <div className="relative flex-1">
            <Search className="w-5 h-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onFocus={() => setShowSuggestions(true)}
              onChange={(e) => {
                setQuery(e.target.value);
                setShowSuggestions(true);
              }}
              placeholder="Search songs, artists, albums, or music videos..."
              className="w-full h-13 pl-12 pr-11 rounded-2xl bg-[#11131A] border border-white/12 text-sm sm:text-base text-white placeholder:text-slate-500 focus:outline-none focus:border-[#4F6BFF] transition-colors"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setResults([]);
                  setNextPageToken(undefined);
                  setHasSearched(false);
                  setError(null);
                  inputRef.current?.focus();
                }}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl text-slate-400 hover:text-white hover:bg-white/5"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <button
            type="submit"
            disabled={!query.trim() || loading}
            className="h-13 px-5 sm:px-6 rounded-2xl bg-[#4F6BFF] hover:bg-[#415CE6] disabled:opacity-45 text-white text-sm font-semibold whitespace-nowrap shrink-0 transition-colors"
          >
            Search
          </button>
        </form>

        {/* Live Search Suggestions Dropdown */}
        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute left-0 right-0 sm:right-28 top-15 z-30 rounded-2xl bg-[#161923] border border-white/12 shadow-2xl overflow-hidden py-1.5">
            {suggestions.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => executeSearch(item, activeTab)}
                className="w-full px-4 py-2.5 flex items-center gap-3 text-sm text-slate-200 hover:bg-white/[0.06] text-left transition-colors"
              >
                <Search className="w-4 h-4 text-slate-500 shrink-0" />
                <span className="truncate">{item}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Songs vs Videos Tabs */}
      <div className="flex items-center justify-between gap-4 border-b border-white/[0.07] pb-3">
        <div className="flex items-center gap-1 p-1 rounded-xl bg-[#11131A] border border-white/[0.07]">
          <button
            type="button"
            onClick={() => handleTabSwitch('songs')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap transition-colors ${
              activeTab === 'songs' ? 'bg-[#4F6BFF] text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Disc3 className="w-3.5 h-3.5" />
            <span>Songs</span>
          </button>
          <button
            type="button"
            onClick={() => handleTabSwitch('videos')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap transition-colors ${
              activeTab === 'videos' ? 'bg-[#4F6BFF] text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Tv className="w-3.5 h-3.5" />
            <span>Music Videos</span>
          </button>
        </div>

        {hasSearched && !loading && results.length > 0 && (
          <button
            type="button"
            onClick={() => playTrack(results[0], results, activeTab === 'videos')}
            className="h-9 px-3.5 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] text-xs font-medium text-white inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Play Results</span>
          </button>
        )}
      </div>

      {/* Idle State: Search History & Trending Searches */}
      {!hasSearched && !loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <Clock className="w-4 h-4 text-slate-400" />
                <span>Recent Searches</span>
              </h2>
              {searchHistory.length > 0 && (
                <button
                  type="button"
                  onClick={clearSearchHistory}
                  className="text-xs text-slate-400 hover:text-white"
                >
                  Clear all
                </button>
              )}
            </div>

            {searchHistory.length === 0 ? (
              <div className="rounded-xl bg-[#11131A] border border-white/[0.06] p-5 text-xs text-slate-400">
                Your recent searches will appear here for quick replay.
              </div>
            ) : (
              <div className="space-y-1.5">
                {searchHistory.slice(0, 10).map((item) => (
                  <div
                    key={item.query}
                    className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-[#11131A] border border-white/[0.05] hover:border-white/12 transition-colors"
                  >
                    <button
                      type="button"
                      onClick={() => executeSearch(item.query, activeTab)}
                      className="flex items-center gap-2.5 text-sm text-slate-200 hover:text-white flex-1 min-w-0 text-left"
                    >
                      <Clock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      <span className="truncate">{item.query}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => removeSearchQuery(item.query)}
                      aria-label={`Remove ${item.query} from history`}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-[#7A90FF]" />
              <span>Trending Searches</span>
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {TRENDING_SEARCH_KEYWORDS.map((kw) => (
                <button
                  key={kw}
                  type="button"
                  onClick={() => executeSearch(kw, activeTab)}
                  className="px-3.5 py-3 rounded-xl bg-[#11131A] hover:bg-[#181B26] border border-white/[0.06] text-left text-xs font-medium text-slate-200 hover:text-white flex items-center gap-2.5 transition-colors"
                >
                  <Search className="w-3.5 h-3.5 text-[#7A90FF] shrink-0" />
                  <span className="truncate">{kw}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Loading Skeletons */}
      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <TrackCardSkeleton key={i} />
          ))}
        </div>
      )}

      {/* Error State */}
      {!loading && error && (
        <ApiNoticeBanner
          message={error}
          onRetry={() => executeSearch(query, activeTab)}
        />
      )}

      {/* Empty Search Results */}
      {!loading && !error && hasSearched && results.length === 0 && (
        <div className="rounded-2xl bg-[#11131A] border border-white/[0.07] p-10 text-center space-y-2">
          <p className="text-base font-semibold text-white">No matching {activeTab} found</p>
          <p className="text-xs text-slate-400">
            Try another keyword, artist name, or switch between Songs and Music Videos.
          </p>
        </div>
      )}

      {/* Search Results */}
      {!loading && !error && results.length > 0 && (
        <div className="space-y-6">
          {activeTab === 'videos' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {results.map((track) => (
                <TrackCard
                  key={track.id}
                  track={track}
                  queueContext={results}
                  onAddToPlaylist={onAddToPlaylist}
                />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {results.map((track, idx) => (
                <TrackRow
                  key={track.id}
                  track={track}
                  index={idx}
                  queueContext={results}
                  onAddToPlaylist={onAddToPlaylist}
                />
              ))}
            </div>
          )}
          {/* Load More Pagination Button at Bottom */}
          {nextPageToken && (
            <div className="flex flex-col items-center gap-2 pt-4">
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="h-11 px-7 rounded-xl bg-[#161923] hover:bg-[#1E2230] border border-white/12 text-sm font-semibold text-white inline-flex items-center justify-center gap-2 disabled:opacity-50 transition-colors"
              >
                {loadingMore ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Loading more...</span>
                  </>
                ) : (
                  <span>Load More ({results.length} loaded)</span>
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
