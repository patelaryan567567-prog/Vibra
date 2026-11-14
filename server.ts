import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getCategoryTracks,
  getRelatedTracks,
  getSearchSuggestions,
  getTrendingMusic,
  getYoutubeKeyStatus,
  hasConfiguredYoutubeKeys,
  searchYouTubeTracks,
  searchYouTubeTracksPaginated,
  YouTubeApiError,
} from './server/youtube.ts';
import {
  GeminiApiError,
  generateMoodDiscoveryPlan,
  getGeminiKeyStatus,
  hasConfiguredGeminiKeys,
} from './server/gemini.ts';
import {
  proxyAudioStream,
  resolveBackgroundAudioStream,
} from './server/audioResolver.ts';
import type {
  AiDiscoveryResponse,
  CategoryId,
  IndiaLanguageFilter,
  Track,
} from './src/types/music.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const isProd = process.env.NODE_ENV === 'production';

const VALID_CATEGORIES: CategoryId[] = ['trending', 'energetic', 'sad', 'discover'];
const VALID_LANGS: IndiaLanguageFilter[] = ['all', 'hindi', 'punjabi', 'mix', 'english'];
const YOUTUBE_VIDEO_ID_RE = /^[a-zA-Z0-9_-]{6,20}$/;

function isYoutubeConfigured(): boolean {
  return hasConfiguredYoutubeKeys();
}

function isGeminiConfigured(): boolean {
  return hasConfiguredGeminiKeys();
}

function parseLang(raw: unknown): IndiaLanguageFilter {
  if (typeof raw === 'string' && VALID_LANGS.includes(raw as IndiaLanguageFilter)) {
    return raw as IndiaLanguageFilter;
  }
  return 'all';
}

function createRateLimiter(windowMs: number, maxRequests: number) {
  const hits = new Map<string, number[]>();
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip || 'local';
    const now = Date.now();
    const cutoff = now - windowMs;
    const recent = (hits.get(key) ?? []).filter((ts) => ts > cutoff);
    if (recent.length >= maxRequests) {
      res.status(429).json({
        error: 'RATE_LIMITED',
        message: 'Too many requests right now. Please wait a moment and try again.',
      });
      return;
    }
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 500) {
      for (const [ip, timestamps] of hits) {
        if (timestamps.every((t) => t <= cutoff)) hits.delete(ip);
      }
    }
    next();
  };
}

interface AiCacheItem {
  payload: AiDiscoveryResponse;
  expiresAt: number;
}

const aiDiscoveryCache = new Map<string, AiCacheItem>();
const aiInFlight = new Map<string, Promise<AiDiscoveryResponse>>();

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // Safe baseline security headers (iframe-compatible)
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });

  app.use(express.json({ limit: '16kb' }));

  // Range-capable audio stream proxy (mounted before generalApiLimiter so seeking never hits 429)
  app.get('/api/audio/stream', async (req, res) => {
    const videoId = typeof req.query.videoId === 'string' ? req.query.videoId.trim() : '';
    if (!YOUTUBE_VIDEO_ID_RE.test(videoId)) {
      res.status(400).json({ error: 'INVALID_VIDEO_ID', message: 'Invalid YouTube video ID.' });
      return;
    }
    await proxyAudioStream(req, res, videoId);
  });

  const generalApiLimiter = createRateLimiter(60_000, 120);
  const aiApiLimiter = createRateLimiter(60_000, 20);
  app.use('/api', generalApiLimiter);

  // Resolve verified native audio stream for background/screen-off mobile playback
  app.get('/api/audio/resolve', async (req, res) => {
    try {
      const videoId = typeof req.query.videoId === 'string' ? req.query.videoId.trim() : '';
      if (!YOUTUBE_VIDEO_ID_RE.test(videoId)) {
        res.status(400).json({ error: 'INVALID_VIDEO_ID', message: 'Invalid YouTube video ID.' });
        return;
      }
      const title = typeof req.query.title === 'string' ? req.query.title.slice(0, 180) : '';
      const artist = typeof req.query.artist === 'string' ? req.query.artist.slice(0, 120) : '';
      const durationRaw = Number(req.query.duration);
      const durationSeconds = Number.isFinite(durationRaw) && durationRaw > 0 ? durationRaw : 0;

      if (!title) {
        res.json({ mode: 'youtube' });
        return;
      }

      const resolved = await resolveBackgroundAudioStream(videoId, title, artist, durationSeconds);
      res.json(resolved);
    } catch {
      res.json({ mode: 'youtube' });
    }
  });

  // Configuration status check (booleans & counts only, never exposes secrets)
  app.get('/api/config-status', (_req, res) => {
    res.json({
      youtubeConfigured: isYoutubeConfigured(),
      geminiConfigured: isGeminiConfigured(),
      youtubeKeyStatus: getYoutubeKeyStatus(),
      geminiKeyStatus: getGeminiKeyStatus(),
    });
  });

  // Trending music endpoint
  app.get('/api/youtube/trending', async (req, res) => {
    try {
      const region = typeof req.query.region === 'string' ? req.query.region : 'IN';
      const lang = parseLang(req.query.lang);
      const refresh = req.query.refresh === '1';
      const tracks = await getTrendingMusic(region, refresh, lang);
      res.json({ tracks });
    } catch (err) {
      if (err instanceof YouTubeApiError) {
        res.status(err.status).json({ error: err.code, message: err.message });
        return;
      }
      res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: err instanceof Error ? err.message : 'Failed to load trending music.',
      });
    }
  });

  // Category discovery endpoint
  app.get('/api/youtube/category', async (req, res) => {
    try {
      const rawId = typeof req.query.id === 'string' ? req.query.id : 'trending';
      const category: CategoryId = VALID_CATEGORIES.includes(rawId as CategoryId)
        ? (rawId as CategoryId)
        : 'trending';
      const region = typeof req.query.region === 'string' ? req.query.region : 'IN';
      const lang = parseLang(req.query.lang);
      const refresh = req.query.refresh === '1';
      const subFilter =
        typeof req.query.sub === 'string' ? req.query.sub.trim().slice(0, 40) : undefined;

      const tracks = await getCategoryTracks({
        category,
        region,
        lang,
        forceRefresh: refresh,
        subFilter,
      });
      res.json({ tracks });
    } catch (err) {
      if (err instanceof YouTubeApiError) {
        res.status(err.status).json({ error: err.code, message: err.message });
        return;
      }
      res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: err instanceof Error ? err.message : 'Failed to load category tracks.',
      });
    }
  });

  // YouTube music & video search with pagination
  app.get('/api/youtube/search', async (req, res) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 120) : '';
      const type = req.query.type === 'videos' ? 'videos' : 'songs';
      const rawMax = Number(req.query.maxResults);
      const maxResults = Number.isFinite(rawMax) ? Math.min(Math.max(rawMax, 1), 25) : 20;
      const pageToken =
        typeof req.query.pageToken === 'string' && req.query.pageToken.length <= 64
          ? req.query.pageToken
          : undefined;

      if (!q) {
        res.json({ tracks: [] });
        return;
      }

      const result = await searchYouTubeTracksPaginated({
        query: q,
        type,
        maxResults,
        pageToken,
      });
      res.json(result);
    } catch (err) {
      if (err instanceof YouTubeApiError) {
        res.status(err.status).json({ error: err.code, message: err.message });
        return;
      }
      res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: err instanceof Error ? err.message : 'Search failed.',
      });
    }
  });

  // Live YouTube autocomplete suggestions
  app.get('/api/youtube/suggestions', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const suggestions = await getSearchSuggestions(q);
    res.json({ suggestions });
  });

  // Related music recommendations & Infinite Radio backing
  app.get('/api/youtube/related', async (req, res) => {
    try {
      const videoId = typeof req.query.videoId === 'string' ? req.query.videoId.trim() : '';
      if (!videoId) {
        res.json({ tracks: [] });
        return;
      }
      if (!YOUTUBE_VIDEO_ID_RE.test(videoId)) {
        res.status(400).json({ error: 'INVALID_VIDEO_ID', message: 'Invalid YouTube video ID.' });
        return;
      }

      const title = typeof req.query.title === 'string' ? req.query.title.slice(0, 120) : undefined;
      const artist = typeof req.query.artist === 'string' ? req.query.artist.slice(0, 80) : undefined;
      const rawExclude = typeof req.query.excludeIds === 'string' ? req.query.excludeIds : '';
      const excludeIds = rawExclude
        .split(',')
        .map((id) => id.trim())
        .filter((id) => YOUTUBE_VIDEO_ID_RE.test(id))
        .slice(0, 50);

      const tracks = await getRelatedTracks(videoId, title, artist, excludeIds);
      res.json({ tracks });
    } catch (err) {
      if (err instanceof YouTubeApiError) {
        res.status(err.status).json({ error: err.code, message: err.message });
        return;
      }
      res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: err instanceof Error ? err.message : 'Failed to load related tracks.',
      });
    }
  });

  // Gemini AI Music Discovery -> Resolves real playable YouTube tracks
  app.post('/api/ai/discover', aiApiLimiter, async (req, res) => {
    try {
      const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim().slice(0, 400) : '';
      if (!prompt) {
        res.status(400).json({ error: 'EMPTY_PROMPT', message: 'Please enter a mood, artist, or vibe prompt.' });
        return;
      }

      const cacheKey = `${prompt.toLowerCase()}::${isYoutubeConfigured()}`;
      const cached = aiDiscoveryCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        res.json(cached.payload);
        return;
      }

      let pending = aiInFlight.get(cacheKey);
      if (!pending) {
        pending = (async (): Promise<AiDiscoveryResponse> => {
          const plan = await generateMoodDiscoveryPlan(prompt);

          if (!isYoutubeConfigured()) {
            return {
              plan,
              tracks: [],
              youtubeConfigured: false,
              warning:
                'Gemini curated your mood queries, but YOUTUBE_API_KEY is not configured yet to fetch live playable YouTube tracks.',
            };
          }

          const groupedQueries: string[] = [];
          for (let i = 0; i < plan.searchQueries.length; i += 3) {
            const batch = plan.searchQueries
              .slice(i, i + 3)
              .map((q) => q.replace(/\s*[-–—]\s*/g, ' ').trim())
              .filter(Boolean);
            if (batch.length > 0) {
              groupedQueries.push(batch.join(' OR '));
            }
            if (groupedQueries.length >= 2) break;
          }

          const queryResults = await Promise.allSettled(
            groupedQueries.map((query) =>
              searchYouTubeTracks({
                query,
                type: 'songs',
                maxResults: 15,
                category: plan.categoryMatch,
              })
            )
          );

          const seen = new Set<string>();
          const tracks: Track[] = [];

          for (const result of queryResults) {
            if (result.status === 'fulfilled') {
              for (const track of result.value) {
                if (!seen.has(track.id)) {
                  seen.add(track.id);
                  tracks.push(track);
                }
              }
            }
          }

          if (tracks.length < 4) {
            try {
              const moodFallback = await getCategoryTracks({
                category: plan.categoryMatch,
                region: 'IN',
                lang: 'all',
              });
              for (const track of moodFallback) {
                if (!seen.has(track.id)) {
                  seen.add(track.id);
                  tracks.push(track);
                }
              }
            } catch {
              // ignore fallback error
            }
          }

          const payload: AiDiscoveryResponse = {
            plan,
            tracks: tracks.slice(0, 16),
            youtubeConfigured: true,
          };

          if (aiDiscoveryCache.size >= 60) {
            const oldestKey = aiDiscoveryCache.keys().next().value;
            if (oldestKey !== undefined) aiDiscoveryCache.delete(oldestKey);
          }
          aiDiscoveryCache.set(cacheKey, { payload, expiresAt: Date.now() + 2 * 60 * 60 * 1000 });
          return payload;
        })().finally(() => {
          aiInFlight.delete(cacheKey);
        });

        aiInFlight.set(cacheKey, pending);
      }

      const resultPayload = await pending;
      res.json(resultPayload);
    } catch (err) {
      if (err instanceof GeminiApiError) {
        res.status(err.status).json({ error: err.code, message: err.message });
        return;
      }
      if (err instanceof YouTubeApiError) {
        res.status(err.status).json({ error: err.code, message: err.message });
        return;
      }
      const msg = err instanceof Error ? err.message : 'AI music discovery failed.';
      res.status(500).json({ error: 'AI_DISCOVERY_ERROR', message: msg });
    }
  });

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`VIBRA server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
