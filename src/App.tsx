import React, { useEffect, useRef, useState } from 'react';
import {
  Compass,
  Heart,
  Home,
  Library,
  ListMusic,
  Search,
  Sparkles,
} from 'lucide-react';
import { AppSplashIntro } from './components/AppSplashIntro';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PersistentPlayer } from './components/PersistentPlayer';
import { PlaylistModal } from './components/PlaylistModal';
import { PWAInstallButton } from './components/PWAInstallButton';
import { VibraLogo } from './components/VibraLogo';
import { LibraryProvider, useLibrary } from './context/LibraryContext';
import { PlayerProvider, usePlayer } from './context/PlayerContext';
import { ExplorePage } from './pages/ExplorePage';
import { FavouritesPage } from './pages/FavouritesPage';
import { HomePage } from './pages/HomePage';
import { LibraryPage } from './pages/LibraryPage';
import { SearchPage } from './pages/SearchPage';
import type { NavTab, Track } from './types/music';

interface NavSnapshot {
  tab: NavTab;
  expanded: boolean;
  mobileView: 'player' | 'queue' | 'related';
  queueOpen: boolean;
  playlistModal: boolean;
}

interface VibraHistoryState extends NavSnapshot {
  vibraApp: true;
  depth: number;
}

function sameSnapshot(a: NavSnapshot, b: NavSnapshot): boolean {
  return (
    a.tab === b.tab &&
    a.expanded === b.expanded &&
    a.mobileView === b.mobileView &&
    a.queueOpen === b.queueOpen &&
    a.playlistModal === b.playlistModal
  );
}

const NAV_ITEMS: Array<{ id: NavTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'explore', label: 'Explore', icon: Compass },
  { id: 'search', label: 'Search', icon: Search },
  { id: 'library', label: 'Library', icon: Library },
  { id: 'favourites', label: 'Favourites', icon: Heart },
];

function VibraShell() {
  const { playlists, favourites, toast } = useLibrary();
  const {
    currentTrack,
    currentTime,
    duration,
    playTrack,
    togglePlay,
    nextTrack,
    prevTrack,
    seekTo,
    toggleMute,
    isExpanded,
    setIsExpanded,
    mobilePlayerView,
    setMobilePlayerView,
    isQueueOpen,
    setIsQueueOpen,
  } = usePlayer();

  const [activeTab, setActiveTab] = useState<NavTab>('home');
  const [headerSearch, setHeaderSearch] = useState('');
  const [pendingSearchQuery, setPendingSearchQuery] = useState<string | undefined>(undefined);
  const [playlistModalTrack, setPlaylistModalTrack] = useState<Track | null>(null);
  const [splashTriggerCount, setSplashTriggerCount] = useState<number>(0);
  const headerSearchInputRef = useRef<HTMLInputElement | null>(null);

  const effectiveExpanded = Boolean(isExpanded && currentTrack);
  const currentSnapshot: NavSnapshot = {
    tab: activeTab,
    expanded: effectiveExpanded,
    mobileView: effectiveExpanded ? mobilePlayerView : 'player',
    queueOpen: isQueueOpen,
    playlistModal: Boolean(playlistModalTrack),
  };

  const currentSnapshotRef = useRef<NavSnapshot>(currentSnapshot);
  currentSnapshotRef.current = currentSnapshot;

  const historyStackRef = useRef<NavSnapshot[]>([currentSnapshot]);
  const historyCursorRef = useRef<number>(0);
  const isApplyingPopRef = useRef<boolean>(false);
  const historyInitializedRef = useRef<boolean>(false);

  // Sync mobile hardware Back button & browser history across tabs, player, queue, and modals
  useEffect(() => {
    const initialState: VibraHistoryState = {
      vibraApp: true,
      depth: 0,
      ...currentSnapshotRef.current,
    };
    window.history.replaceState(initialState, '');
    historyStackRef.current = [currentSnapshotRef.current];
    historyCursorRef.current = 0;
    historyInitializedRef.current = true;

    const handlePopState = (event: PopStateEvent) => {
      const state = event.state as Partial<VibraHistoryState> | null;
      const targetDepth =
        state && state.vibraApp && typeof state.depth === 'number'
          ? Math.max(0, state.depth)
          : 0;

      const targetSnap: NavSnapshot =
        state && state.vibraApp && state.tab
          ? {
              tab: state.tab,
              expanded: Boolean(state.expanded),
              mobileView: state.mobileView || 'player',
              queueOpen: Boolean(state.queueOpen),
              playlistModal: Boolean(state.playlistModal),
            }
          : historyStackRef.current[targetDepth] ?? {
              tab: 'home',
              expanded: false,
              mobileView: 'player',
              queueOpen: false,
              playlistModal: false,
            };

      historyCursorRef.current = targetDepth;
      if (!historyStackRef.current[targetDepth]) {
        historyStackRef.current[targetDepth] = targetSnap;
      }

      if (sameSnapshot(currentSnapshotRef.current, targetSnap)) {
        return;
      }

      isApplyingPopRef.current = true;
      if (!targetSnap.playlistModal) {
        setPlaylistModalTrack(null);
      }
      setIsQueueOpen(targetSnap.queueOpen);
      setIsExpanded(targetSnap.expanded);
      setMobilePlayerView(targetSnap.mobileView);
      setActiveTab(targetSnap.tab);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [setIsExpanded, setIsQueueOpen, setMobilePlayerView]);

  useEffect(() => {
    if (!historyInitializedRef.current) return;
    if (isApplyingPopRef.current) {
      isApplyingPopRef.current = false;
      return;
    }

    const stack = historyStackRef.current;
    const cursor = historyCursorRef.current;
    const prev = stack[cursor];
    const curr = currentSnapshot;

    if (prev && sameSnapshot(prev, curr)) {
      return;
    }

    const overlayClosedOnSameTab =
      prev &&
      prev.tab === curr.tab &&
      ((prev.playlistModal && !curr.playlistModal) ||
        (prev.queueOpen && !curr.queueOpen) ||
        (prev.expanded && !curr.expanded) ||
        (prev.expanded && curr.expanded && prev.mobileView !== 'player' && curr.mobileView === 'player'));

    if (overlayClosedOnSameTab) {
      for (let i = cursor - 1; i >= 0; i--) {
        if (sameSnapshot(stack[i], curr)) {
          const delta = i - cursor;
          historyCursorRef.current = i;
          historyStackRef.current = stack.slice(0, i + 1);
          window.history.go(delta);
          return;
        }
      }
    }

    const nextStack = stack.slice(0, cursor + 1);
    nextStack.push(curr);
    const nextDepth = nextStack.length - 1;
    historyStackRef.current = nextStack;
    historyCursorRef.current = nextDepth;

    const nextState: VibraHistoryState = {
      vibraApp: true,
      depth: nextDepth,
      ...curr,
    };
    window.history.pushState(nextState, '');
  }, [
    activeTab,
    effectiveExpanded,
    mobilePlayerView,
    isQueueOpen,
    playlistModalTrack,
  ]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [activeTab]);

  // PC & Tablet Hardware Keyboard Shortcuts (Space, Arrows, M, F, /, Escape)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      const isEditable =
        tagName === 'input' ||
        tagName === 'textarea' ||
        tagName === 'select' ||
        Boolean(target?.isContentEditable);

      if (e.key === 'Escape') {
        if (playlistModalTrack) {
          setPlaylistModalTrack(null);
          return;
        }
        if (isQueueOpen) {
          setIsQueueOpen(false);
          return;
        }
        if (isExpanded) {
          setIsExpanded(false);
          return;
        }
      }

      if (isEditable || e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === '/') {
        e.preventDefault();
        if (window.innerWidth >= 768 && headerSearchInputRef.current) {
          headerSearchInputRef.current.focus();
        } else {
          setActiveTab('search');
        }
        return;
      }

      if (!currentTrack) return;

      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowRight' && e.shiftKey) {
        e.preventDefault();
        nextTrack();
      } else if (e.key === 'ArrowLeft' && e.shiftKey) {
        e.preventDefault();
        prevTrack();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        const effDur = duration > 0 ? duration : currentTrack.durationSeconds || 0;
        seekTo(effDur > 0 ? Math.min(effDur, currentTime + 5) : currentTime + 5);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        seekTo(Math.max(0, currentTime - 5));
      } else if (e.key.toLowerCase() === 'm') {
        e.preventDefault();
        toggleMute();
      } else if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setIsExpanded(!isExpanded);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    currentTrack,
    currentTime,
    duration,
    isExpanded,
    isQueueOpen,
    nextTrack,
    playlistModalTrack,
    prevTrack,
    seekTo,
    setIsExpanded,
    setIsQueueOpen,
    toggleMute,
    togglePlay,
  ]);

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

  const handleBrandLogoClick = () => {
    if (activeTab === 'home') {
      setSplashTriggerCount((c) => c + 1);
    } else {
      setActiveTab('home');
    }
  };

  return (
    <div className="min-h-screen bg-[#090A0F] text-[#F4F5F8] flex">
      {/* Aesthetic App Opening Splash Animation */}
      <AppSplashIntro forceTriggerCount={splashTriggerCount} />

      {/* Tablet Navigation Rail (md: 768px–1023px) & Laptop/Desktop Studio Sidebar (lg: 1024px+) */}
      <aside className="hidden md:flex md:flex-col md:w-[76px] lg:w-56 xl:w-64 md:fixed md:inset-y-0 md:left-0 bg-[#0D0E14] border-r border-white/[0.07] z-30 transition-all">
        <button
          type="button"
          onClick={handleBrandLogoClick}
          title="VIBRA — Click on Home to replay intro animation"
          className="h-14 lg:h-16 px-2 lg:px-6 flex items-center justify-center lg:justify-start gap-3 border-b border-white/[0.06] hover:bg-white/[0.02] transition-colors"
          aria-label="Go to Home"
        >
          <VibraLogo size="md" />
          <span className="hidden lg:inline font-display text-lg font-extrabold tracking-tight text-white whitespace-nowrap">
            VIBRA
          </span>
        </button>

        <nav className="p-2 lg:p-3 space-y-1" aria-label="Primary navigation">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                title={item.label}
                className={`w-full py-2.5 lg:py-0 lg:h-11 px-1.5 lg:px-3.5 rounded-xl flex flex-col lg:flex-row items-center justify-center lg:justify-between gap-1 lg:gap-0 text-xs lg:text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-[#4F6BFF]/15 text-white border border-[#4F6BFF]/30'
                    : 'text-slate-400 hover:text-white hover:bg-white/[0.04] border border-transparent'
                }`}
              >
                <span className="flex flex-col lg:flex-row items-center gap-1 lg:gap-3">
                  <Icon className={`w-4 h-4 ${active ? 'text-[#7A90FF]' : ''}`} />
                  <span className="text-[10px] lg:text-sm">{item.label}</span>
                </span>
                {item.id === 'favourites' && favourites.length > 0 && (
                  <span className="hidden lg:inline font-mono-tabular text-xs text-slate-400">
                    {favourites.length}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Desktop Sidebar Playlists (lg: 1024px+) */}
        <div className="hidden lg:flex lg:flex-col mt-4 px-4 pt-4 border-t border-white/[0.06] flex-1 overflow-y-auto pb-28">
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
      <div className="flex-1 md:pl-[76px] lg:pl-56 xl:pl-64 flex flex-col min-w-0">
        {/* Sticky Top Bar */}
        <header className="sticky top-0 z-30 h-13 md:h-14 lg:h-16 px-3.5 sm:px-6 lg:px-8 bg-[#090A0F]/85 backdrop-blur-xl border-b border-white/[0.06] flex items-center justify-between gap-3 sm:gap-6">
          {/* Mobile Brand Mark */}
          <button
            type="button"
            onClick={handleBrandLogoClick}
            title="VIBRA"
            className="md:hidden flex items-center gap-2 whitespace-nowrap shrink-0"
          >
            <VibraLogo size="sm" />
            <span className="font-display text-base font-extrabold tracking-tight text-white">
              VIBRA
            </span>
          </button>

          {/* Tablet & Desktop Quick Search Bar */}
          <form onSubmit={handleHeaderSearchSubmit} className="hidden md:flex flex-1 max-w-sm lg:max-w-md relative">
            <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              ref={headerSearchInputRef}
              type="text"
              value={headerSearch}
              onChange={(e) => setHeaderSearch(e.target.value)}
              placeholder="Search songs, artists, or music videos... ( / )"
              className="w-full h-10 pl-10 pr-4 rounded-xl bg-[#11131A] border border-white/[0.08] text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-[#4F6BFF] transition-colors"
            />
          </form>

          {/* Primary Action */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('search')}
              aria-label="Open search"
              className="md:hidden min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-300 hover:text-white hover:bg-white/5"
            >
              <Search className="w-5 h-5" />
            </button>

            <PWAInstallButton />

            <button
              type="button"
              onClick={() => setActiveTab('explore')}
              className="h-9 sm:h-10 px-3 sm:px-4 rounded-xl bg-[#4F6BFF] hover:bg-[#415CE6] text-white text-xs font-semibold inline-flex items-center gap-1.5 sm:gap-2 whitespace-nowrap shrink-0 transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>AI Discovery</span>
            </button>
          </div>
        </header>

        {/* Scrollable Viewport */}
        <main
          className={`flex-1 max-w-7xl w-full mx-auto px-3.5 sm:px-6 lg:px-8 pt-4 sm:pt-6 ${
            currentTrack ? 'pb-40 md:pb-32' : 'pb-24 md:pb-12'
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

      {/* Mobile Fixed Bottom Navigation Bar (< 768px) */}
      <nav
        aria-label="Mobile navigation"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 h-[56px] pb-safe bg-[#0D0E14]/95 backdrop-blur-xl border-t border-white/[0.08] grid grid-cols-5 items-center"
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
          className="fixed top-15 md:top-18 right-3.5 sm:right-4 z-50 px-4 py-2.5 rounded-xl bg-[#181B26] border border-white/15 text-xs font-medium text-white shadow-2xl max-w-[calc(100vw-2rem)] sm:max-w-md break-words"
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
