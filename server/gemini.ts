import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type { AiDiscoveryPlan, CategoryId, IndiaLanguageFilter } from '../src/types/music.ts';

export class GeminiApiError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 500, code = 'GEMINI_API_ERROR') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const PLAN_CACHE_TTL_MS = 15 * 60 * 1000;
const planCache = new Map<string, CacheEntry<AiDiscoveryPlan>>();
const catQueryCache = new Map<string, CacheEntry<string[]>>();
const inFlightPlans = new Map<string, Promise<AiDiscoveryPlan>>();

function getCached<T>(map: Map<string, CacheEntry<T>>, key: string): T | undefined {
  const hit = map.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt <= Date.now()) {
    map.delete(key);
    return undefined;
  }
  return hit.data;
}

function setCached<T>(map: Map<string, CacheEntry<T>>, key: string, data: T, maxEntries = 60): void {
  if (map.size >= maxEntries) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(key, { data, expiresAt: Date.now() + PLAN_CACHE_TTL_MS });
}

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new GeminiApiError(
      'GEMINI_API_KEY is not configured in the server environment.',
      503,
      'GEMINI_API_KEY_MISSING'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function extractStatus(err: unknown): number {
  if (typeof err === 'object' && err !== null && 'status' in err) {
    const status = Number((err as { status?: unknown }).status);
    if (!Number.isNaN(status) && status >= 400) return status;
  }
  const msg = err instanceof Error ? err.message : '';
  if (/\b429\b|RESOURCE_EXHAUSTED/i.test(msg)) return 429;
  if (/\b503\b|UNAVAILABLE/i.test(msg)) return 503;
  if (/\b401\b|\b403\b|API_KEY_INVALID/i.test(msg)) return 403;
  return 500;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = extractStatus(err);
      if (!isRetryableStatus(status) || attempt === maxRetries) {
        if (err instanceof GeminiApiError) throw err;
        const friendly =
          status === 429
            ? 'Gemini AI is currently busy (rate limit). Please try again in a few seconds.'
            : status === 403
              ? 'The configured GEMINI_API_KEY is invalid or lacks permission.'
              : err instanceof Error
                ? err.message
                : 'Gemini AI request failed.';
        throw new GeminiApiError(friendly, status);
      }
      const delay = 500 * Math.pow(2, attempt) + Math.floor(Math.random() * 250);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}

function safeJsonParse<T>(raw: string | undefined): T {
  const text = (raw ?? '{}').trim();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new GeminiApiError('Gemini returned a malformed response. Please try again.', 502, 'GEMINI_PARSE_ERROR');
  }
}

export async function generateMoodDiscoveryPlan(prompt: string): Promise<AiDiscoveryPlan> {
  const cleanPrompt = prompt.trim().slice(0, 400);
  if (!cleanPrompt) {
    throw new GeminiApiError('Please provide a mood or music request prompt.', 400, 'EMPTY_PROMPT');
  }

  const cacheKey = cleanPrompt.toLowerCase();
  const cached = getCached(planCache, cacheKey);
  if (cached) return cached;

  const existing = inFlightPlans.get(cacheKey);
  if (existing) return existing;

  const job = (async () => {
    const ai = getAiClient();

    const response = await withRetry(() =>
      ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `User music request: "${cleanPrompt}"`,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          systemInstruction:
            'You are VIBRA, an expert music curator specializing in India music discovery across Hindi, Punjabi, Hindi-Urdu Mix, and English hits. ' +
            'Interpret the user mood, artist reference, activity, or viral Reels/Shorts vibe request. ' +
            'Unless the user asks specifically for English or Western music, prioritize Hindi songs, Bollywood tracks, Punjabi rap / Desi hip-hop, Hindi-Urdu mixes, Hindi Lo-Fi, and viral Instagram Reels / YouTube Shorts hits. ' +
            'NEVER recommend phonk music unless explicitly requested. ' +
            'Return a concise editorial playlist title, a 1-2 sentence mood explanation, the best matching category (trending, energetic, sad, or discover), ' +
            '3-4 concise genre/vibe descriptors (plain words, no hashtags), and 8 distinct YouTube Music search queries for different real songs matching the request (avoid repeating the same song). ' +
            'Never invent fake YouTube URLs or video IDs—only generate search queries.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              moodTitle: {
                type: Type.STRING,
                description: 'Short editorial playlist title for the mood, 2-5 words.',
              },
              moodSummary: {
                type: Type.STRING,
                description: 'Concise 1-2 sentence curation note explaining the sonic direction.',
              },
              categoryMatch: {
                type: Type.STRING,
                enum: ['trending', 'energetic', 'sad', 'discover'],
                description: 'Best matching discovery category.',
              },
              vibeTags: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: '3 to 4 short genre or atmosphere labels.',
              },
              searchQueries: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: '8 distinct YouTube search queries for different real songs matching the user prompt.',
              },
            },
            required: ['moodTitle', 'moodSummary', 'categoryMatch', 'vibeTags', 'searchQueries'],
          },
        },
      })
    );

    const parsed = safeJsonParse<Partial<AiDiscoveryPlan>>(response.text);
    const validCategories: CategoryId[] = ['trending', 'energetic', 'sad', 'discover'];
    const categoryMatch: CategoryId = validCategories.includes(parsed.categoryMatch as CategoryId)
      ? (parsed.categoryMatch as CategoryId)
      : 'discover';

    const plan: AiDiscoveryPlan = {
      moodTitle: (parsed.moodTitle || 'Curated Soundscape').slice(0, 80),
      moodSummary: (parsed.moodSummary || 'Tracks curated for your current listening mood.').slice(0, 260),
      categoryMatch,
      vibeTags: Array.isArray(parsed.vibeTags)
        ? parsed.vibeTags.filter((t) => typeof t === 'string' && t.trim()).slice(0, 4)
        : ['Curated', 'Music'],
      searchQueries:
        Array.isArray(parsed.searchQueries) && parsed.searchQueries.length > 0
          ? parsed.searchQueries.filter((q) => typeof q === 'string' && q.trim()).slice(0, 8)
          : [cleanPrompt],
    };

    setCached(planCache, cacheKey, plan);
    return plan;
  })().finally(() => {
    inFlightPlans.delete(cacheKey);
  });

  inFlightPlans.set(cacheKey, job);
  return job;
}

const TRENDING_CACHE_TTL_MS = 30 * 60 * 1000;
const trendingViralCache = new Map<string, CacheEntry<string[]>>();
const inFlightTrending = new Map<string, Promise<string[]>>();

function parseSongListResponse(raw: string | undefined): string[] {
  const text = (raw ?? '').trim();
  if (!text) return [];

  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (jsonMatch) {
    try {
      const arr = JSON.parse(jsonMatch[0]) as unknown;
      if (Array.isArray(arr)) {
        const cleaned = arr
          .filter((item): item is string => typeof item === 'string')
          .map((s) => s.replace(/^[\d.)\-*\s•]+/, '').trim())
          .filter((s) => s.length >= 3 && s.length <= 100);
        if (cleaned.length > 0) return cleaned.slice(0, 12);
      }
    } catch {
      // fall back to line parsing
    }
  }

  return text
    .split('\n')
    .map((line) =>
      line
        .replace(/^[\d.)\-*\s•"`]+/, '')
        .replace(/["`,]+$/, '')
        .trim()
    )
    .filter((line) => line.length >= 4 && line.length <= 100 && !line.startsWith('{') && !line.startsWith('['))
    .slice(0, 12);
}

export async function generateTrendingViralSongs(
  lang: IndiaLanguageFilter = 'all',
  rotationIndex = 0
): Promise<string[]> {
  const batch = Math.abs(rotationIndex) % 3;
  const cacheKey = `trending:${lang}:${batch}`;
  const hit = trendingViralCache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.data;
  }

  const existing = inFlightTrending.get(cacheKey);
  if (existing) return existing;

  const job = (async () => {
    const ai = getAiClient();
    const today = new Date().toISOString().slice(0, 10);

    const langDirective: Record<IndiaLanguageFilter, string> = {
      all:
        'Find the top 10 ultra-viral individual HINDI and HINDI-URDU MIX songs currently blowing up on Instagram Reels India, YouTube Shorts India, and Spotify India Viral 50 (plus 2 viral Punjabi-Hindi crossover hits). ' +
        'Include romantic, soulful, vibey, and catchy Hindi / Urdu-Hindi songs that appear in almost every Indian Instagram Reel right now.',
      hindi:
        'Find the top 10 ultra-viral individual HINDI songs (latest Bollywood hits, Hindi indie hits, and viral Hindi Reels songs) trending across India right now.',
      mix:
        'Find the top 10 ultra-viral individual HINDI-URDU MIX songs (Hindi-Urdu indie crossovers, Coke Studio / Desi soulful hits, romantic & vibey Urdu-Hindi songs) trending across Instagram Reels and Spotify Viral India right now.',
      punjabi:
        'Find the top 10 ultra-viral individual PUNJABI RAP, Punjabi pop, and Desi hip-hop songs trending on Instagram Reels and YouTube India right now.',
      english:
        'Find the top 10 ultra-viral individual ENGLISH pop, R&B, and global Instagram Reels / TikTok songs trending in India and global charts right now.',
    };

    const rotationAngles = [
      'Focus on the #1 biggest viral Instagram Reels India audio trends & Spotify India Top/Viral 50 songs right now.',
      'Focus on YouTube Shorts India viral music hits, Hindi-Urdu soulful indie crossovers, and latest Bollywood chartbusters.',
      'Focus on rapidly rising viral Reels songs, romantic/vibey Hindi-Urdu hits, and current Indian chart favorites gaining huge momentum.',
    ];

    const prompt = [
      `Today is ${today}. Identify the top 10 individual songs that are genuinely viral RIGHT NOW in India.`,
      langDirective[lang],
      rotationAngles[batch],
      'STRICT RULES:',
      '- Return ONLY real, individual official songs in the format "Song Title - Artist Name".',
      '- NO playlists, NO 30-minute mashup jukeboxes, NO slowed+reverb fan uploads, NO phonk, NO devotional aarti/bhajan, NO Bhojpuri songs, NO movie trailers/teasers.',
      '- Respond ONLY with a raw JSON array of 10 strings like ["Song 1 - Artist 1", "Song 2 - Artist 2"].',
    ].join('\n');

    let songs: string[] = [];

    // Try live Google Search grounding first
    try {
      const groundedResponse = await withRetry(
        () =>
          ai.models.generateContent({
            model: 'gemini-4-hydrogen',
            contents: prompt,
            config: {
              tools: [{ googleSearch: {} }],
            },
          }),
        1
      );
      songs = parseSongListResponse(groundedResponse.text);
    } catch (err) {
      console.warn(
        'Gemini googleSearch trending call failed, falling back to structured curation:',
        err instanceof Error ? err.message : err
      );
    }

    // Structured JSON fallback using Gemini 4 Hydrogen if search grounding returned empty or unsupported
    if (songs.length < 6) {
      const structuredResponse = await withRetry(() =>
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: prompt,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                songs: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: '10 real viral individual songs in format "Song Title - Artist Name".',
                },
              },
              required: ['songs'],
            },
          },
        })
      );
      const parsed = safeJsonParse<{ songs?: string[] }>(structuredResponse.text);
      if (Array.isArray(parsed.songs)) {
        const cleaned = parsed.songs
          .filter((s): s is string => typeof s === 'string' && s.trim().length >= 3)
          .map((s) => s.trim())
          .slice(0, 12);
        if (cleaned.length > songs.length) {
          songs = cleaned;
        }
      }
    }

    if (songs.length > 0) {
      trendingViralCache.set(cacheKey, {
        data: songs,
        expiresAt: Date.now() + TRENDING_CACHE_TTL_MS,
      });
    }
    return songs;
  })().finally(() => {
    inFlightTrending.delete(cacheKey);
  });

  inFlightTrending.set(cacheKey, job);
  return job;
}

export async function generateCategoryQueries(
  category: Exclude<CategoryId, 'trending'>,
  lang: IndiaLanguageFilter = 'all'
): Promise<string[]> {
  const cacheKey = `${category}:${lang}`;
  const cached = getCached(catQueryCache, cacheKey);
  if (cached) return cached;

  const ai = getAiClient();
  const langLabel =
    lang === 'all'
      ? 'Hindi, Punjabi Rap, and Hindi-Urdu Mix'
      : lang === 'mix'
        ? 'Hindi-Urdu Mashup, Lo-Fi Mix, and Reels Mix'
        : lang.charAt(0).toUpperCase() + lang.slice(1);

  const moodPrompts: Record<Exclude<CategoryId, 'trending'>, string> = {
    energetic: `Generate 3 fresh YouTube search queries for high-energy ${langLabel} gym workout, party, rap, or upbeat motivation tracks. Strictly NO phonk.`,
    sad: `Generate 3 fresh YouTube search queries for ${langLabel} sad songs, heartbreak ballads, slow acoustic tracks, and emotional melodies.`,
    discover: `Generate 3 fresh YouTube search queries across ${langLabel} romantic chill, relaxing lo-fi mixes, devotional, and instrumental acoustic genres.`,
  };

  const response = await withRetry(() =>
    ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: moodPrompts[category],
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            queries: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
          },
          required: ['queries'],
        },
      },
    })
  );

  const parsed = safeJsonParse<{ queries?: string[] }>(response.text);
  const queries = Array.isArray(parsed.queries)
    ? parsed.queries.filter((q) => typeof q === 'string' && q.trim()).slice(0, 3)
    : [];

  if (queries.length > 0) {
    setCached(catQueryCache, cacheKey, queries);
  }
  return queries;
}
