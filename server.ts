import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzip } from 'node:zlib';
import {
  getArtistProfile,
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
  enhanceLyricsWithAi,
  GeminiApiError,
  generateMoodDiscoveryPlan,
  getGeminiKeyStatus,
  hasConfiguredGeminiKeys,
} from './server/gemini.ts';
import { fetchTrackLyrics } from './server/lyrics.ts';
import {
  type AudioSourceProvider,
  prewarmAudioStreamsBatch,
  proxyAudioStream,
  proxyDirectAudioUrl,
  resolveBackgroundAudioStream,
  searchMultiSourceTracks,
  warmAudioResolverStartup,
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
const AUDIO_STREAM_ID_RE = /^[a-zA-Z0-9_-]{4,80}$/;

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
  warmAudioResolverStartup();

  // Safe baseline security headers (iframe-compatible)
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });

  // Lightweight gzip compression for JSON API payloads > 1 KB
  app.use('/api', (req, res, next) => {
    const acceptEnc = String(req.headers['accept-encoding'] || '');
    if (!acceptEnc.includes('gzip')) {
      next();
      return;
    }
    const origJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      if (res.headersSent) return origJson(body);
      const raw = JSON.stringify(body);
      if (typeof raw !== 'string' || raw.length < 1024) {
        return origJson(body);
      }
      gzip(Buffer.from(raw, 'utf8'), (err, compressed) => {
        if (err || res.headersSent) {
          origJson(body);
          return;
        }
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Encoding', 'gzip');
        res.setHeader('Vary', 'Accept-Encoding');
        res.setHeader('Content-Length', String(compressed.length));
        res.send(compressed);
      });
      return res;
    }) as typeof res.json;
    next();
  });

  app.use(express.json({ limit: '64kb' }));

  // Range-capable audio stream & attachment download proxy
  app.get('/api/audio/stream', async (req, res) => {
    const videoId = typeof req.query.videoId === 'string' ? req.query.videoId.trim() : '';
    if (!AUDIO_STREAM_ID_RE.test(videoId)) {
      res.status(400).json({ error: 'INVALID_VIDEO_ID', message: 'Invalid audio track ID.' });
      return;
    }
    await proxyAudioStream(req, res, videoId);
  });

  // Safe direct HTTP/HTTPS audio URL downloader proxy (for podcasts, direct MP3/M4A/WAV links)
  app.get('/api/audio/fetch-url', async (req, res) => {
    const rawUrl = typeof req.query.url === 'string' ? req.query.url.trim() : '';
    if (!rawUrl || rawUrl.length > 2000) {
      res.status(400).json({ error: 'INVALID_URL', message: 'Please provide a valid audio URL.' });
      return;
    }
    await proxyDirectAudioUrl(req, res, rawUrl);
  });

  const generalApiLimiter = createRateLimiter(60_000, 240);
  const aiApiLimiter = createRateLimiter(60_000, 20);
  app.use('/api', generalApiLimiter);

  // Search other direct audio sources (JioSaavn, Audius, SoundCloud, Internet Archive)
  app.get('/api/sources/search', async (req, res) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 120) : '';
      const rawSource = typeof req.query.source === 'string' ? req.query.source : 'all';
      const validSources = ['all', 'jiosaavn', 'soundcloud', 'audius', 'archive'];
      const source = (validSources.includes(rawSource) ? rawSource : 'all') as
        | 'all'
        | AudioSourceProvider;
      if (!q) {
        res.json({ tracks: [] });
        return;
      }
      const tracks = await searchMultiSourceTracks(q, source);
      res.json({ tracks });
    } catch (err) {
      res.status(500).json({
        error: 'SOURCE_SEARCH_ERROR',
        message: err instanceof Error ? err.message : 'Failed to search audio sources.',
      });
    }
  });

  // Resolve verified native audio stream for background/screen-off mobile playback
  app.get('/api/audio/resolve', async (req, res) => {
    try {
      const videoId = typeof req.query.videoId === 'string' ? req.query.videoId.trim() : '';
      if (!AUDIO_STREAM_ID_RE.test(videoId)) {
        res.status(400).json({ error: 'INVALID_VIDEO_ID', message: 'Invalid audio track ID.' });
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

  // Batch pre-warm audio stream URLs for visible/upcoming tracks so clicking Play starts near-instantly
  app.post('/api/audio/prewarm', async (req, res) => {
    try {
      const rawTracks = Array.isArray(req.body?.tracks) ? req.body.tracks : [];
      const sanitized: Array<{ videoId: string; title: string; artist?: string; durationSeconds?: number }> = [];
      for (const item of rawTracks.slice(0, 8)) {
        if (!item || typeof item !== 'object') continue;
        const videoId = typeof item.videoId === 'string' ? item.videoId.trim() : '';
        const title = typeof item.title === 'string' ? item.title.trim().slice(0, 180) : '';
        const artist = typeof item.artist === 'string' ? item.artist.trim().slice(0, 120) : '';
        const durRaw = Number(item.durationSeconds);
        const durationSeconds = Number.isFinite(durRaw) && durRaw > 0 ? durRaw : 0;
        if (AUDIO_STREAM_ID_RE.test(videoId) && title) {
          sanitized.push({ videoId, title, artist, durationSeconds });
        }
      }
      if (sanitized.length === 0) {
        res.json({ results: {} });
        return;
      }
      const results = await prewarmAudioStreamsBatch(sanitized);
      res.json({ results });
    } catch {
      res.json({ results: {} });
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

  // Artist / Channel Profile endpoint
  app.get('/api/youtube/artist', async (req, res) => {
    try {
      const artist = typeof req.query.artist === 'string' ? req.query.artist.trim().slice(0, 100) : '';
      const seedVideoId =
        typeof req.query.seedVideoId === 'string' && AUDIO_STREAM_ID_RE.test(req.query.seedVideoId.trim())
          ? req.query.seedVideoId.trim()
          : undefined;
      if (!artist) {
        res.status(400).json({ error: 'MISSING_ARTIST', message: 'Artist name is required.' });
        return;
      }
      const profile = await getArtistProfile(artist, seedVideoId);
      res.json(profile);
    } catch (err) {
      if (err instanceof YouTubeApiError) {
        res.status(err.status).json({ error: err.code, message: err.message });
        return;
      }
      res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: err instanceof Error ? err.message : 'Failed to load artist profile.',
      });
    }
  });

  // Synced & Plain Lyrics endpoint (LRCLIB + Lyrics.ovh + Web/Gemini AI)
  app.get('/api/lyrics', async (req, res) => {
    try {
      const title = typeof req.query.title === 'string' ? req.query.title.trim().slice(0, 180) : '';
      const artist = typeof req.query.artist === 'string' ? req.query.artist.trim().slice(0, 120) : '';
      const durationRaw = Number(req.query.duration);
      const durationSeconds = Number.isFinite(durationRaw) && durationRaw > 0 ? durationRaw : 0;
      const forceAi = req.query.ai === '1';

      if (!title) {
        res.json({ found: false, syncedLines: [], plainLyrics: null });
        return;
      }
      const lyrics = await fetchTrackLyrics({ title, artist, durationSeconds, forceAi });
      res.json(lyrics);
    } catch {
      res.json({ found: false, syncedLines: [], plainLyrics: null });
    }
  });

  // Gemini AI Lyrics Formatter / Hinglish Transliteration / Finder
  app.post('/api/lyrics/enhance', aiApiLimiter, async (req, res) => {
    try {
      const title = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 180) : '';
      const artist = typeof req.body?.artist === 'string' ? req.body.artist.trim().slice(0, 120) : '';
      const rawLyrics = typeof req.body?.rawLyrics === 'string' ? req.body.rawLyrics.slice(0, 9000) : null;
      const rawMode = req.body?.mode;
      const mode: 'polish' | 'hinglish' | 'find' =
        rawMode === 'hinglish' || rawMode === 'find' ? rawMode : 'polish';

      const inputSynced: Array<{ timeSeconds: number; text: string }> = Array.isArray(req.body?.syncedLines)
        ? req.body.syncedLines
            .filter(
              (l: unknown): l is { timeSeconds: number; text: string } =>
                Boolean(l) &&
                typeof l === 'object' &&
                typeof (l as { timeSeconds?: unknown }).timeSeconds === 'number' &&
                typeof (l as { text?: unknown }).text === 'string'
            )
            .slice(0, 160)
        : [];

      if (!title) {
        res.status(400).json({ error: 'MISSING_TITLE', message: 'Song title is required.' });
        return;
      }

      const aiRes = await enhanceLyricsWithAi({
        title,
        artist,
        rawLyrics,
        syncedTexts: inputSynced.map((l) => l.text),
        mode,
      });

      const rebuiltSynced =
        aiRes.cleanedSyncedTexts && aiRes.cleanedSyncedTexts.length === inputSynced.length
          ? inputSynced.map((orig, idx) => ({
              timeSeconds: orig.timeSeconds,
              text: aiRes.cleanedSyncedTexts![idx],
            }))
          : [];

      res.json({
        found: aiRes.found,
        trackName: title,
        artistName: artist || undefined,
        syncedLines: rebuiltSynced,
        plainLyrics: aiRes.plainLyrics,
        source: aiRes.source,
        aiEnhanced: true,
        mode,
      });
    } catch (err) {
      if (err instanceof GeminiApiError) {
        res.status(err.status).json({ error: err.code, message: err.message });
        return;
      }
      res.status(500).json({
        error: 'LYRICS_AI_ERROR',
        message: err instanceof Error ? err.message : 'Unable to enhance lyrics with AI.',
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
