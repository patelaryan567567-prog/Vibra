import React, { useState } from 'react';
import { ArrowRight, ListPlus, Play, Search, Sparkles } from 'lucide-react';
import { AI_STARTER_PROMPTS } from '../constants/categories';
import { usePlayer } from '../context/PlayerContext';
import { ApiError, discoverWithAi } from '../services/api';
import type { AiDiscoveryResponse, Track } from '../types/music';
import { ApiNoticeBanner } from './ApiNoticeBanner';
import { TrackCard, TrackCardSkeleton } from './TrackCard';

interface AiDiscoveryPanelProps {
  onAddToPlaylist: (track: Track) => void;
  onRunSearchQuery: (query: string) => void;
  compact?: boolean;
}

export function AiDiscoveryPanel({
  onAddToPlaylist,
  onRunSearchQuery,
  compact = false,
}: AiDiscoveryPanelProps) {
  const { playTrack, addToQueue } = usePlayer();
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AiDiscoveryResponse | null>(null);

  const handleSubmit = async (targetPrompt?: string) => {
    const q = (targetPrompt ?? prompt).trim();
    if (!q) return;
    if (targetPrompt) setPrompt(targetPrompt);

    setLoading(true);
    setError(null);
    try {
      const data = await discoverWithAi(q);
      setResult(data);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Unable to generate AI recommendations right now.');
      }
    } finally {
      setLoading(false);
    }
  };

  const onFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSubmit();
  };

  return (
    <section className="rounded-2xl bg-[#11131A] border border-white/[0.08] p-5 sm:p-6 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium text-[#7A90FF]">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Vibra AI Curation</span>
          </div>
          <h3 className="text-lg sm:text-xl font-bold text-white mt-1">
            Describe a mood, artist, or activity
          </h3>
        </div>
      </div>

      <form onSubmit={onFormSubmit} className="flex flex-col sm:flex-row gap-2.5">
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder='Try "I want emotional Hindi songs" or "Play something energetic"'
          className="flex-1 h-12 pl-[11px] pr-4 py-[14px] rounded-xl bg-[#090A0F] border border-white/10 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#4F6BFF]"
        />
        <button
          type="submit"
          disabled={loading || !prompt.trim()}
          className="h-12 px-5 rounded-xl bg-[#4F6BFF] hover:bg-[#415CE6] disabled:opacity-45 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0 transition-colors"
        >
          <span>{loading ? 'Curating...' : 'Discover Music'}</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </form>

      {/* Prompt Starters */}
      <div className="flex flex-wrap gap-2">
        {(compact ? AI_STARTER_PROMPTS.slice(0, 4) : AI_STARTER_PROMPTS).map((starter) => (
          <button
            key={starter}
            type="button"
            onClick={() => handleSubmit(starter)}
            className="px-3 py-2 rounded-xl bg-[#181B26] hover:bg-[#202433] border border-white/[0.06] text-xs text-slate-300 hover:text-white transition-colors text-left"
          >
            {starter}
          </button>
        ))}
      </div>

      {error && <ApiNoticeBanner title="AI Discovery Notice" message={error} />}

      {loading && (
        <div className="flex gap-3.5 sm:gap-4 overflow-x-auto pb-2 no-scrollbar pt-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="w-[235px] sm:w-[255px] md:w-[265px] lg:w-[275px] shrink-0"
            >
              <TrackCardSkeleton />
            </div>
          ))}
        </div>
      )}

      {!loading && result && (
        <div className="space-y-4 pt-3 border-t border-white/[0.07]">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <span className="text-[#7A90FF] font-medium">AI Mix</span>
                {result.plan.vibeTags.map((tag) => (
                  <span key={tag} className="inline-flex items-center gap-2">
                    <span aria-hidden="true">·</span>
                    <span>{tag}</span>
                  </span>
                ))}
              </div>
              <h4 className="text-lg font-bold text-white">{result.plan.moodTitle}</h4>
              <p className="text-sm text-slate-300 max-w-2xl">{result.plan.moodSummary}</p>
            </div>

            {result.tracks.length > 0 && (
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => playTrack(result.tracks[0], result.tracks)}
                  className="h-10 px-4 rounded-xl bg-white text-[#090A0F] hover:bg-slate-200 text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap transition-colors"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Play All</span>
                </button>
                <button
                  type="button"
                  onClick={() => result.tracks.forEach((t) => addToQueue(t))}
                  className="h-10 px-4 rounded-xl bg-white/[0.07] hover:bg-white/[0.12] border border-white/10 text-xs font-medium text-white inline-flex items-center gap-2 whitespace-nowrap transition-colors"
                >
                  <ListPlus className="w-3.5 h-3.5" />
                  <span>Queue All</span>
                </button>
              </div>
            )}
          </div>

          {/* Clickable Search Queries generated by Gemini */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-500">Generated queries:</span>
            {result.plan.searchQueries.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => onRunSearchQuery(q)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#090A0F] hover:bg-[#181B26] border border-white/[0.07] text-slate-300 hover:text-white transition-colors"
              >
                <Search className="w-3 h-3 text-slate-500" />
                <span>{q}</span>
              </button>
            ))}
          </div>

          {result.warning && (
            <ApiNoticeBanner title="YouTube Playback Resolution Pending" message={result.warning} />
          )}

          {result.tracks.length > 0 && (
            <div className="flex gap-3.5 sm:gap-4 overflow-x-auto pb-2 snap-x snap-mandatory no-scrollbar">
              {result.tracks.map((track) => (
                <div
                  key={track.id}
                  className="w-[235px] sm:w-[255px] md:w-[265px] lg:w-[275px] shrink-0 snap-start"
                >
                  <TrackCard
                    track={track}
                    queueContext={result.tracks}
                    onAddToPlaylist={onAddToPlaylist}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
