import React, { useEffect, useState } from 'react';
import {
  Compass,
  Heart,
  Home,
  Library,
  ListMusic,
  Search,
  Sparkles,
} from 'lucide-react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PersistentPlayer } from './components/PersistentPlayer';
import { PlaylistModal } from './components/PlaylistModal';
import { VibraLogo } from './components/VibraLogo';
import { LibraryProvider, useLibrary } from './context/LibraryContext';
import { PlayerProvider, usePlayer } from './context/PlayerContext';
import { ExplorePage } from './pages/ExplorePage';
import { FavouritesPage } from './pages/FavouritesPage';
import { HomePage } from './pages/HomePage';
import { LibraryPage } from './pages/LibraryPage';
import { SearchPage } from './pages/SearchPage';
import type { NavTab, Track } from './types/music';

const NAV_ITEMS: Array<{ id: NavTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'explore', label: 'Explore', icon: Compass },
  { id: 'search', label: 'Search', icon: Search },
  { id: 'library', label: 'Library', icon: Library },
  { id: 'favourites', label: 'Favourites', icon: Heart },
];

function VibraShell() {
  const { playlists, favourites, toast } = useLibrary();
  const { currentTrack, playTrack } = usePlayer();

  const [activeTab, setActiveTab] = useState<NavTab>('home');
  const [headerSearch, setHeaderSearch] = useState('');
  const [pendingSearchQuery, setPendingSearchQuery] = useState<string | undefined>(undefined);
  const [playlistModalTrack, setPlaylistModalTrack] = useState<Track | null>(null);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [activeTab]);

  const runSearchQuery = (query: string) => {
    setPendingSearchQuery(query);
    setActiveTab('search');
  };

  const handleHeaderSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!headerSearch.trim()) {
      setActiveTab('search');
      return;
    }
    runSearchQuery(headerSearch.trim());
    setHeaderSearch('');
  };

  return (
    <div className="min-h-screen bg-[#090A0F] text-[#F4F5F8] flex">
      {/* Desktop Left Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 lg:left-0 bg-[#0D0E14] border-r border-white/[0.07] z-30">
        <div className="h-16 px-6 flex items-center gap-3 border-b border-white/[0.06]">
          <VibraLogo size="md" />
          <span className="font-display text-lg font-extrabold tracking-tight text-white whitespace-nowrap">
            VIBRA
          </span>
        </div>

        <nav className="p-3 space-y-1" aria-label="Primary navigation">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`w-full h-11 px-3.5 rounded-xl flex items-center justify-between text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-[#4F6BFF]/15 text-white border border-[#4F6BFF]/30'
                    : 'text-slate-400 hover:text-white hover:bg-white/[0.04] border border-transparent'
                }`}
              >
                <span className="flex items-center gap-3">
                  <Icon className={`w-4 h-4 ${active ? 'text-[#7A90FF]' : ''}`} />
                  <span>{item.label}</span>
                </span>
                {item.id === 'favourites' && favourites.length > 0 && (
                  <span className="font-mono-tabular text-xs text-slate-400">{favourites.length}</span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Sidebar Playlists */}
        <div className="mt-4 px-4 pt-4 border-t border-white/[0.06] flex-1 overflow-y-auto pb-28">
          <div className="flex items-center justify-between px-2 mb-2">
            <span className="text-xs font-semibold text-slate-400">Your Playlists</span>
            <button
              type="button"
              onClick={() => setActiveTab('library')}
              className="text-xs text-[#7A90FF] hover:text-white transition-colors"
            >
              Manage
            </button>
          </div>

          {playlists.length === 0 ? (
            <p className="px-2 py-2 text-xs text-slate-500">
              Create playlists in your Library to access them here.
            </p>
          ) : (
            <div className="space-y-1">
              {playlists.map((pl) => (
                <button
                  key={pl.id}
                  type="button"
                  onClick={() => {
                    if (pl.tracks.length > 0) {
                      playTrack(pl.tracks[0], pl.tracks);
                    } else {
                      setActiveTab('library');
                    }
                  }}
                  className="w-full px-2.5 py-2 rounded-lg flex items-center gap-2.5 text-left text-xs text-slate-300 hover:text-white hover:bg-white/[0.04] transition-colors"
                >
                  <ListMusic className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <span className="truncate flex-1">{pl.name}</span>
                  <span className="font-mono-tabular text-[11px] text-slate-500">
                    {pl.tracks.length}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </aside>

      {/* Main Content Shell */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        {/* Sticky Top Bar */}
        <header className="sticky top-0 z-30 h-12 lg:h-16 px-4 sm:px-6 lg:px-8 bg-[#090A0F]/85 backdrop-blur-xl border-b border-white/[0.06] flex items-center justify-between gap-4 sm:gap-8">
          {/* Mobile Brand Mark */}
          <button
            type="button"
            onClick={() => setActiveTab('home')}
            className="lg:hidden flex items-center gap-2.5 whitespace-nowrap shrink-0"
          >
            <VibraLogo size="sm" />
            <span className="font-display text-base font-extrabold tracking-tight text-white">
              VIBRA
            </span>
          </button>

          {/* Desktop Quick Search */}
          <form onSubmit={handleHeaderSearchSubmit} className="hidden lg:flex flex-1 max-w-md relative">
            <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={headerSearch}
              onChange={(e) => setHeaderSearch(e.target.value)}
              placeholder="Search songs, artists, or music videos..."
              className="w-full h-10 pl-10 pr-4 rounded-xl bg-[#11131A] border border-white/[0.08] text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-[#4F6BFF] transition-colors"
            />
          </form>

          {/* Primary Action */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('search')}
              aria-label="Open search"
              className="lg:hidden min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-300 hover:text-white hover:bg-white/5"
            >
              <Search className="w-5 h-5" />
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('explore')}
              className="h-9 sm:h-10 px-3.5 sm:px-4 rounded-xl bg-[#4F6BFF] hover:bg-[#415CE6] text-white text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>AI Discovery</span>
            </button>
          </div>
        </header>

        {/* Scrollable Viewport */}
        <main
          className={`flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 pt-6 ${
            currentTrack ? 'pb-36 lg:pb-28' : 'pb-24 lg:pb-12'
          }`}
        >
          {activeTab === 'home' && (
            <HomePage
              onAddToPlaylist={(t) => setPlaylistModalTrack(t)}
              onNavigate={setActiveTab}
            />
          )}
          {activeTab === 'explore' && (
            <ExplorePage
              onAddToPlaylist={(t) => setPlaylistModalTrack(t)}
              onRunSearchQuery={runSearchQuery}
            />
          )}
          {activeTab === 'search' && (
            <SearchPage
              initialQuery={pendingSearchQuery}
              onConsumeInitialQuery={() => setPendingSearchQuery(undefined)}
              onAddToPlaylist={(t) => setPlaylistModalTrack(t)}
            />
          )}
          {activeTab === 'library' && (
            <LibraryPage
              onAddToPlaylist={(t) => setPlaylistModalTrack(t)}
              onRunSearchQuery={runSearchQuery}
              onNavigate={setActiveTab}
            />
          )}
          {activeTab === 'favourites' && (
            <FavouritesPage
              onAddToPlaylist={(t) => setPlaylistModalTrack(t)}
              onNavigate={setActiveTab}
            />
          )}
        </main>
      </div>

      {/* Mobile Fixed Bottom Navigation Bar */}
      <nav
        aria-label="Mobile navigation"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 h-[54px] bg-[#0D0E14]/95 backdrop-blur-xl border-t border-white/[0.08] grid grid-cols-5 items-center"
      >
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 transition-colors ${
                active ? 'text-[#7A90FF]' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px] font-medium tracking-tight">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Persistent Music & Video Player */}
      <PersistentPlayer onAddToPlaylist={(t) => setPlaylistModalTrack(t)} />

      {/* Playlist Modal */}
      <PlaylistModal track={playlistModalTrack} onClose={() => setPlaylistModalTrack(null)} />

      {/* Toast Feedback */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed top-16 lg:top-20 right-4 z-50 px-4 py-2.5 rounded-xl bg-[#181B26] border border-white/15 text-xs font-medium text-white shadow-2xl"
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <LibraryProvider>
        <PlayerProvider>
          <VibraShell />
        </PlayerProvider>
      </LibraryProvider>
    </ErrorBoundary>
  );
}
