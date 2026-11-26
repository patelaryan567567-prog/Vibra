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

const GEMINI_RATE_LIMIT_COOLDOWN_MS = 45 * 1000;
const GEMINI_OVERLOAD_COOLDOWN_MS = 12 * 1000;
const GEMINI_INVALID_KEY_COOLDOWN_MS = 60 * 60 * 1000;
const DEFAULT_GEMINI_ATTEMPT_TIMEOUT_MS = 11_000;

interface GeminiSlotDiag {
  lastStatus: number | null;
  reason?: string;
  detail?: string;
}

const exhaustedGeminiKeyUntil = new Map<string, number>();
const geminiSlotDiagnostics = new Map<number, GeminiSlotDiag>();
let activeGeminiKeyIndex = 0;
let roundRobinGeminiCursor = 0;

function isGeminiPlaceholder(raw: string): boolean {
  return !raw || /^MY_GEMINI_API_KEY(?:_?\d+)?$/i.test(raw);
}

export function getGeminiApiKeys(): string[] {
  const numberedEnvKeys = Object.keys(process.env)
    .map((name) => {
      const m = name.match(/^GEMINI_(?:API_)?KEY(?:_?(\d+))?$/i);
      if (!m) return null;
      return {
        name,
        order: m[1] ? parseInt(m[1], 10) : 0,
      };
    })
    .filter((entry): entry is { name: string; order: number } => Boolean(entry))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
    .map((entry) => process.env[entry.name]);

  const candidates = [...numberedEnvKeys, process.env.GEMINI_API_KEYS];
  const unique = new Set<string>();
  for (const raw of candidates) {
    if (!raw) continue;
    for (const part of raw.split(/[\s,;]+/)) {
      const cleaned = part.trim();
      if (!isGeminiPlaceholder(cleaned)) {
        unique.add(cleaned);
      }
    }
  }
  return Array.from(unique);
}

export function hasConfiguredGeminiKeys(): boolean {
  return getGeminiApiKeys().length > 0;
}

export function hasAvailableGeminiKey(): boolean {
  const keys = getGeminiApiKeys();
  if (keys.length === 0) return false;
  const now = Date.now();
  return keys.some((k) => (exhaustedGeminiKeyUntil.get(k) ?? 0) <= now);
}

export function getGeminiKeyStatus(): {
  totalKeys: number;
  activeKeySlot: number;
  exhaustedKeysCount: number;
  slotDiagnostics: Array<{
    slot: number;
    lastStatus: number | null;
    reason?: string;
    detail?: string;
    cooldownRemainingSec: number;
  }>;
} {
  const keys = getGeminiApiKeys();
  const now = Date.now();
  let exhaustedKeysCount = 0;
  const slotDiagnostics = keys.map((key, idx) => {
    const until = exhaustedGeminiKeyUntil.get(key) ?? 0;
    const remainingSec = until > now ? Math.ceil((until - now) / 1000) : 0;
    if (remainingSec > 0) exhaustedKeysCount++;
    const diag = geminiSlotDiagnostics.get(idx + 1);
    return {
      slot: idx + 1,
      lastStatus: diag?.lastStatus ?? null,
      reason: diag?.reason,
      detail: diag?.detail,
      cooldownRemainingSec: remainingSec,
    };
  });
  return {
    totalKeys: keys.length,
    activeKeySlot: keys.length > 0 ? (activeGeminiKeyIndex % keys.length) + 1 : 0,
    exhaustedKeysCount,
    slotDiagnostics,
  };
}

function createAiClient(apiKey: string, timeoutMs = DEFAULT_GEMINI_ATTEMPT_TIMEOUT_MS): GoogleGenAI {
  // Gemini API enforces a minimum server-side deadline of 10s (returns 400 INVALID_ARGUMENT if <10s).
  // Keep httpOptions.timeout >= 12s while local runWithTimeout handles tighter request deadlines.
  const serverDeadlineMs = Math.max(12_000, timeoutMs);
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: serverDeadlineMs,
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function extractStatus(err: unknown): number {
  if (typeof err === 'object' && err !== null) {
    const obj = err as { status?: unknown; code?: unknown; name?: unknown; error?: { code?: unknown } };
    if (obj.name === 'AbortError' || obj.code === 'GEMINI_TIMEOUT') return 504;
    const direct = Number(obj.status ?? obj.error?.code ?? obj.code);
    if (!Number.isNaN(direct) && direct >= 400) return direct;
  }
  const msg = `${err instanceof Error ? err.message : ''} ${typeof err === 'string' ? err : ''}`;
  if (/timed?\s*out|abort/i.test(msg)) return 504;
  if (/\b429\b|RESOURCE_EXHAUSTED|quota|rate[_\s-]*limit|too\s+many\s+requests/i.test(msg)) return 429;
  if (/\b503\b|UNAVAILABLE|overloaded|high\s+demand/i.test(msg)) return 503;
  if (/\b502\b|BAD_GATEWAY/i.test(msg)) return 502;
  if (/\b504\b|DEADLINE_EXCEEDED/i.test(msg)) return 504;
  if (/\b401\b|\b403\b|API_KEY_INVALID|API key not valid|API key expired|PERMISSION_DENIED|UNAUTHENTICATED/i.test(msg)) return 403;
  return 500;
}

function extractShortReason(err: unknown, status: number): string {
  const msg = `${err instanceof Error ? err.message : ''} ${typeof err === 'string' ? err : ''}`;
  if (status === 504) return 'TIMEOUT';
  if (/RESOURCE_EXHAUSTED|quota/i.test(msg)) return 'QUOTA_EXHAUSTED';
  if (status === 429) return 'RATE_LIMIT';
  if (/PERMISSION_DENIED|UNAUTHENTICATED/i.test(msg) || status === 403 || status === 401) {
    if (/API_KEY_INVALID|API key not valid/i.test(msg)) return 'INVALID_KEY';
    if (/API key expired/i.test(msg)) return 'EXPIRED_KEY';
    return 'PERMISSION_DENIED';
  }
  if (/UNAVAILABLE|high\s+demand|overloaded/i.test(msg)) return 'MODEL_OVERLOADED';
  return `HTTP_${status}`;
}

function redactKeyDetail(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  return raw.replace(/AIza[A-Za-z0-9_-]{10,}/g, '[REDACTED]').slice(0, 220);
}

function runWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new GeminiApiError(`Gemini request timed out after ${timeoutMs}ms`, 504, 'GEMINI_TIMEOUT'));
    }, timeoutMs);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

async function executeGeminiWithFailover<T>(
  fn: (ai: GoogleGenAI) => Promise<T>,
  attemptTimeoutMs = DEFAULT_GEMINI_ATTEMPT_TIMEOUT_MS
): Promise<T> {
  const keys = getGeminiApiKeys();
  if (keys.length === 0) {
    throw new GeminiApiError(
      'GEMINI_API_KEY is not configured in the server environment.',
      503,
      'GEMINI_API_KEY_MISSING'
    );
  }

  const now = Date.now();
  // Round-robin across available keys so concurrent requests share rate-limit headroom evenly
  const startIdx = roundRobinGeminiCursor % keys.length;
  roundRobinGeminiCursor = (roundRobinGeminiCursor + 1) % keys.length;

  const readyIndices: number[] = [];
  const transientCooldownIndices: number[] = [];
  const invalidCooldownIndices: number[] = [];

  for (let offset = 0; offset < keys.length; offset++) {
    const idx = (startIdx + offset) % keys.length;
    const until = exhaustedGeminiKeyUntil.get(keys[idx]) ?? 0;
    if (until <= now) {
      readyIndices.push(idx);
    } else {
      const diag = geminiSlotDiagnostics.get(idx + 1);
      if (diag?.lastStatus === 403 || diag?.lastStatus === 401) {
        invalidCooldownIndices.push(idx);
      } else {
        transientCooldownIndices.push(idx);
      }
    }
  }

  let candidateIndices: number[];
  if (readyIndices.length > 0) {
    // Try all ready keys first, plus any transient-cooldown keys sorted by soonest expiry
    const soonestTransient = transientCooldownIndices.sort(
      (a, b) => (exhaustedGeminiKeyUntil.get(keys[a]) ?? 0) - (exhaustedGeminiKeyUntil.get(keys[b]) ?? 0)
    );
    candidateIndices = [...readyIndices, ...soonestTransient];
  } else if (transientCooldownIndices.length > 0) {
    candidateIndices = transientCooldownIndices.sort(
      (a, b) => (exhaustedGeminiKeyUntil.get(keys[a]) ?? 0) - (exhaustedGeminiKeyUntil.get(keys[b]) ?? 0)
    );
  } else {
    candidateIndices = invalidCooldownIndices.sort(
      (a, b) => (exhaustedGeminiKeyUntil.get(keys[a]) ?? 0) - (exhaustedGeminiKeyUntil.get(keys[b]) ?? 0)
    );
  }

  let lastErr: unknown;
  let lastTransientStatus: number | null = null;
  let lastStatus = 500;

  for (let pos = 0; pos < candidateIndices.length; pos++) {
    const keyIdx = candidateIndices[pos];
    const key = keys[keyIdx];
    const ai = createAiClient(key, attemptTimeoutMs);

    try {
      const res = await runWithTimeout(fn(ai), attemptTimeoutMs);
      activeGeminiKeyIndex = keyIdx;
      exhaustedGeminiKeyUntil.delete(key);
      geminiSlotDiagnostics.set(keyIdx + 1, { lastStatus: 200, reason: 'OK' });
      return res;
    } catch (err) {
      lastErr = err;
      let status = extractStatus(err);

      // Single quick retry only if there is 1 key and it hit a transient 429/503
      if ((status === 429 || status === 503) && candidateIndices.length === 1) {
        await new Promise((resolve) => setTimeout(resolve, 900));
        try {
          const retryRes = await runWithTimeout(fn(ai), attemptTimeoutMs);
          activeGeminiKeyIndex = keyIdx;
          exhaustedGeminiKeyUntil.delete(key);
          geminiSlotDiagnostics.set(keyIdx + 1, { lastStatus: 200, reason: 'OK' });
          return retryRes;
        } catch (retryErr) {
          lastErr = retryErr;
          status = extractStatus(retryErr);
        }
      }

      lastStatus = status;
      if (status === 429 || status === 503 || status === 504 || status === 502) {
        lastTransientStatus = status;
      }

      const reason = extractShortReason(lastErr, status);
      geminiSlotDiagnostics.set(keyIdx + 1, {
        lastStatus: status,
        reason,
        detail: redactKeyDetail(lastErr),
      });

      // HTTP 400 is a client/schema error, not an API key failure—do not exhaust keys or retry across all keys
      if (status === 400) {
        break;
      }

      if (status === 429) {
        exhaustedGeminiKeyUntil.set(key, Date.now() + GEMINI_RATE_LIMIT_COOLDOWN_MS);
      } else if (status === 503 || status === 504 || status === 502) {
        exhaustedGeminiKeyUntil.set(key, Date.now() + GEMINI_OVERLOAD_COOLDOWN_MS);
      } else if (status === 403 || status === 401) {
        exhaustedGeminiKeyUntil.set(key, Date.now() + GEMINI_INVALID_KEY_COOLDOWN_MS);
      }

      activeGeminiKeyIndex = (keyIdx + 1) % keys.length;

      if (pos < candidateIndices.length - 1) {
        console.warn(
          `[Gemini] API key #${keyIdx + 1} failed (${reason}); rotating to key #${candidateIndices[pos + 1] + 1}.`
        );
        continue;
      }
    }
  }

  // Prefer reporting transient rate-limit/overload if any key failed transiently instead of masking with a bad fallback key
  const effectiveStatus = lastTransientStatus ?? lastStatus;
  if (lastErr instanceof GeminiApiError && lastErr.status === effectiveStatus) {
    throw lastErr;
  }
  const friendly =
    effectiveStatus === 429
      ? 'Gemini AI is currently busy (rate limit). Please try again in a few seconds.'
      : effectiveStatus === 503 || effectiveStatus === 504
        ? 'Gemini AI is temporarily overloaded. Please try again in a few seconds.'
        : effectiveStatus === 403 || effectiveStatus === 401
          ? 'The configured GEMINI_API_KEY is invalid or lacks permission.'
          : lastErr instanceof Error
            ? lastErr.message
            : 'Gemini AI request failed.';
  throw new GeminiApiError(friendly, effectiveStatus);
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
    const response = await executeGeminiWithFailover((ai) =>
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
    const today = new Date().toISOString().slice(0, 10);

    const langDirective: Record<IndiaLanguageFilter, string> = {
      all:
        'Find the top 10 KHATARNAK ultra-viral individual songs dominating Instagram Reels, YouTube Shorts, and Spotify Viral charts across BOTH India and Pakistan right now. ' +
        'Include: (1) viral Pakistani Urdu-Hindi & Punjabi crossovers blowing up in India (think artists/vibe like Talha Anjum, Talhah Yunus, Hasan Raheem, AUR, Kaifi Khalil, Maanu & Annural Khalid, Afusic, Coke Studio, Umair) AND ' +
        '(2) viral Indian Punjabi rap, Desi hip-hop & Hindi/Indie hits (like Karan Aujla, Shubh, Diljit Dosanjh, AP Dhillon, Sidhu Moose Wala, Hanumankind, Faheem Abdullah, Anuv Jain, King, Talwiinder).',
      hindi:
        'Find the top 10 ultra-viral individual HINDI songs (latest Bollywood chartbusters, Hindi indie viral Reels hits, and soulful Hindi hits) trending across India right now.',
      mix:
        'Find the top 10 KHATARNAK ultra-viral India + Pakistan HINDI-URDU-PUNJABI MIX songs (Coke Studio, Pakistani Urdu/Punjabi viral hits in India, Desi indie crossovers, and romantic/vibey Reels hits) blowing up right now.',
      punjabi:
        'Find the top 10 KHATARNAK ultra-viral individual PUNJABI RAP, Punjabi pop, and Desi hip-hop bangers (from Indian & Pakistani Punjabi artists) trending on Instagram Reels and YouTube right now.',
      english:
        'Find the top 10 ultra-viral individual ENGLISH pop, hip-hop, R&B, and global Instagram Reels / TikTok hits trending right now.',
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
      const groundedResponse = await executeGeminiWithFailover(
        (ai) =>
          ai.models.generateContent({
            model: 'gemini-4-hydrogen',
            contents: prompt,
            config: {
              tools: [{ googleSearch: {} }],
            },
          }),
        11_000
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
      const structuredResponse = await executeGeminiWithFailover((ai) =>
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

const catSongCache = new Map<string, CacheEntry<string[]>>();
const inFlightCatSongs = new Map<string, Promise<string[]>>();

export async function generateCategoryQueries(
  category: Exclude<CategoryId, 'trending'>,
  lang: IndiaLanguageFilter = 'all',
  rotationIndex = 0
): Promise<string[]> {
  const batch = Math.abs(rotationIndex) % 3;
  const cacheKey = `${category}:${lang}:${batch}`;
  const hit = catSongCache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.data;
  }

  const existing = inFlightCatSongs.get(cacheKey);
  if (existing) return existing;

  const job = (async () => {
    const langLabel =
      lang === 'all'
        ? 'Hindi, Punjabi Rap, and Pakistani/Indian Urdu-Hindi Mix'
        : lang === 'mix'
          ? 'Pakistani & Indian Hindi-Urdu-Punjabi Mix crossovers'
          : lang === 'punjabi'
            ? 'Punjabi Rap, Desi Hip-Hop, and Punjabi Pop'
            : lang.charAt(0).toUpperCase() + lang.slice(1);

    const moodPrompts: Record<Exclude<CategoryId, 'trending'>, string> = {
      energetic:
        `List 8 KHATARNAK, ultra-viral high-energy ${langLabel} songs, Punjabi raps, Desi hip-hop bangers, and gym/car/party hits from India & Pakistan that are heavily used in energetic Instagram Reels & workouts (e.g., artists like Karan Aujla, Shubh, Diljit Dosanjh, Sidhu Moose Wala, AP Dhillon, Hanumankind, Divine, KR$NA, Talha Anjum / Young Stunners, Badshah, Yo Yo Honey Singh). Strictly NO phonk, NO 1-hour DJ mashups.`,
      sad:
        `List 8 ultra-viral emotional & heartbreak ${langLabel} songs from India & Pakistan that are EXTREMELY used for sad moments, heartbreak edits, and late-night Instagram Reels (e.g., artists like Faheem Abdullah, Kaifi Khalil, AUR, Anuv Jain, B Praak, Arijit Singh, Talha Anjum, Hasan Raheem, Talwiinder, Vishal Mishra, Atif Aslam). Strictly NO 30-min slowed reverb compilations or 10-second clips.`,
      discover:
        `List 8 ultra-viral romantic, soulful, Sufi, indie chill & acoustic ${langLabel} songs from India & Pakistan (e.g., Coke Studio hits, Ali Sethi & Shae Gill, Abdul Hannan, Jasleen Royal, Mitraz, Arijit Singh, Mohit Chauhan, Zaeden, Hasan Raheem). Strictly individual songs—NO 1-hour jukeboxes or playlists.`,
    };

    const rotationHints = [
      'Pick the biggest, most iconic current viral hits everyone recognizes right now.',
      'Mix fresh recent 2025-2026 viral Reels hits with beloved Pakistani-Indian crossovers.',
      'Focus on high-impact viral favorites and standout collaborations.',
    ];

    const prompt = [
      moodPrompts[category],
      rotationHints[batch],
      'Format EVERY item strictly as "Song Title - Artist Name". Return 8 distinct real individual songs.',
    ].join('\n');

    const response = await executeGeminiWithFailover((ai) =>
      ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              queries: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: '8 real individual viral songs formatted as "Song Title - Artist Name".',
              },
            },
            required: ['queries'],
          },
        },
      })
    );

    const parsed = safeJsonParse<{ queries?: string[] }>(response.text);
    const queries = Array.isArray(parsed.queries)
      ? parsed.queries
          .filter((q): q is string => typeof q === 'string' && q.trim().length >= 3)
          .map((q) => q.trim())
          .slice(0, 8)
      : [];

    if (queries.length > 0) {
      catSongCache.set(cacheKey, {
        data: queries,
        expiresAt: Date.now() + TRENDING_CACHE_TTL_MS,
      });
    }
    return queries;
  })().finally(() => {
    inFlightCatSongs.delete(cacheKey);
  });

  inFlightCatSongs.set(cacheKey, job);
  return job;
}

export interface AiLyricsResult {
  found: boolean;
  plainLyrics: string | null;
  cleanedSyncedTexts?: string[];
  source: string;
}

const aiLyricsCache = new Map<string, CacheEntry<AiLyricsResult>>();
const aiLyricsInFlight = new Map<string, Promise<AiLyricsResult>>();

export async function findAndFormatLyricsWithAi(params: {
  title: string;
  artist?: string;
  rawContext?: string;
  timeoutMs?: number;
}): Promise<AiLyricsResult> {
  const title = params.title.trim().slice(0, 180);
  const artist = (params.artist || '').trim().slice(0, 120);
  const rawContext = (params.rawContext || '').trim().slice(0, 240);
  const timeoutMs = params.timeoutMs ?? 9_000;
  if (!title) return { found: false, plainLyrics: null, source: 'Gemini AI' };

  const cacheKey = `find:v2:${title.toLowerCase()}::${artist.toLowerCase()}::${rawContext.toLowerCase()}`;
  const hit = getCached(aiLyricsCache, cacheKey);
  if (hit) return hit;

  const existing = aiLyricsInFlight.get(cacheKey);
  if (existing) return existing;

  const contextHint =
    rawContext && rawContext.toLowerCase() !== title.toLowerCase()
      ? `\nYouTube/track reference metadata for disambiguation: "${rawContext}". Use this to identify the exact movie/album/singer and avoid picking a different song from the same movie or another artist's song with a similar title.`
      : '';

  const job = (async (): Promise<AiLyricsResult> => {
    // Step 1: Use Google Search grounding to fetch exact lyrics from lyrics websites and format cleanly
    let searchText = '';
    try {
      const searchResp = await executeGeminiWithFailover(
        (ai) =>
          ai.models.generateContent({
            model: 'gemini-4-hydrogen',
            contents:
              `Search live lyrics websites (like Genius, Musixmatch, LyricsMint, AZLyrics, JioSaavn) and retrieve the COMPLETE, authentic lyrics for the exact song "${title}"${artist ? ` by ${artist}` : ''}.${contextHint}\n` +
              `Accuracy & formatting requirements:\n` +
              `- CRITICAL: Verify the retrieved lyrics belong strictly to "${title}"${artist ? ` (${artist})` : ''} and NOT a different song from the same film or another track with a similar name.\n` +
              `- Add clear section headers: [Intro], [Verse 1], [Pre-Chorus], [Chorus], [Verse 2], [Bridge], [Outro].\n` +
              `- Separate every stanza with a blank line.\n` +
              `- Keep lines crisp and singable (roughly 5-10 words per line).\n` +
              `- For Hindi, Punjabi, or Urdu songs, ALWAYS write in clean, natural Romanized Hinglish (Latin alphabet) so anyone can sing along effortlessly—never output raw Devanagari, Gurmukhi, or Perso-Arabic script.\n` +
              `- Output ONLY the lyrics with section headers. Do NOT include explanations, commentary, disclaimers, source links, citation numbers, or intro text.\n` +
              `- If this is purely instrumental or exact lyrics for this specific song cannot be verified, reply ONLY with "LYRICS_NOT_FOUND".`,
            config: {
              tools: [{ googleSearch: {} }],
            },
          }),
        timeoutMs
      );
      searchText = (searchResp.text ?? '').trim();
    } catch {
      searchText = '';
    }

    if (
      searchText &&
      !/LYRICS_NOT_FOUND/i.test(searchText) &&
      searchText.length >= 60 &&
      searchText.split('\n').length >= 4
    ) {
      // Clean any markdown fences, preambles, or grounded citation links/markers
      const cleaned = searchText
        .replace(/^```[a-z]*\n?/i, '')
        .replace(/\n?```$/i, '')
        .replace(/^(Here are the lyrics|Lyrics for|Complete lyrics for)[^\n]*:\s*\n+/i, '')
        .replace(/\[(\d+(?:,\s*\d+)*)\](?=\s|$|[.,!?])/g, '')
        .replace(/\s*\(https?:\/\/[^\s)]+\)/gi, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      const res: AiLyricsResult = {
        found: true,
        plainLyrics: cleaned,
        source: 'Web + Gemini AI',
      };
      aiLyricsCache.set(cacheKey, { data: res, expiresAt: Date.now() + 12 * 60 * 60 * 1000 });
      return res;
    }

    // Never fabricate or guess lyrics from ungrounded model memory (prevents wrong-song hallucinations)
    const empty: AiLyricsResult = { found: false, plainLyrics: null, source: 'Gemini AI' };
    aiLyricsCache.set(cacheKey, { data: empty, expiresAt: Date.now() + 10 * 60 * 1000 });
    return empty;
  })().finally(() => {
    aiLyricsInFlight.delete(cacheKey);
  });

  aiLyricsInFlight.set(cacheKey, job);
  return job;
}

export async function enhanceLyricsWithAi(params: {
  title: string;
  artist?: string;
  rawLyrics?: string | null;
  syncedTexts?: string[];
  mode: 'polish' | 'hinglish' | 'find';
  timeoutMs?: number;
}): Promise<AiLyricsResult> {
  if (params.mode === 'find') {
    return findAndFormatLyricsWithAi({
      title: params.title,
      artist: params.artist,
      timeoutMs: params.timeoutMs,
    });
  }

  const title = params.title.trim().slice(0, 180);
  const artist = (params.artist || '').trim().slice(0, 120);
  const syncedTexts = Array.isArray(params.syncedTexts) ? params.syncedTexts.slice(0, 160) : [];
  const rawLyrics = (params.rawLyrics || '').trim().slice(0, 9000);
  const timeoutMs = params.timeoutMs ?? 8_000;

  if (syncedTexts.length === 0 && !rawLyrics) {
    return findAndFormatLyricsWithAi({ title, artist, timeoutMs });
  }

  const fingerprint =
    syncedTexts.length > 0
      ? `sync:${syncedTexts.length}:${syncedTexts[0] || ''}`
      : `plain:${rawLyrics.slice(0, 80)}:${rawLyrics.length}`;
  const cacheKey = `enh:${params.mode}:${title.toLowerCase()}::${fingerprint}`;

  const hit = getCached(aiLyricsCache, cacheKey);
  if (hit) return hit;

  const existing = aiLyricsInFlight.get(cacheKey);
  if (existing) return existing;

  const job = (async (): Promise<AiLyricsResult> => {
    if (syncedTexts.length > 0) {
      const directive =
        params.mode === 'hinglish'
          ? 'Transliterate / rewrite each line cleanly into natural, easy-to-read Romanized Hinglish (phonetic Latin script for Hindi/Punjabi/Urdu lines, keep English lines crisp and natural). Fix messy punctuation or typos.'
          : 'Clean and polish each lyric line for maximum readability: fix awkward capitalization, remove leftover metadata junk, fix broken spacing or punctuation, and keep the words musical and authentic.';

      const resp = await executeGeminiWithFailover(
        (ai) =>
          ai.models.generateContent({
            model: 'gemini-4-hydrogen',
            contents:
              `Song: "${title}"${artist ? ` by ${artist}` : ''}\n` +
              `${directive}\n` +
              `CRITICAL RULE: Return an array of EXACTLY ${syncedTexts.length} strings matching each input line 1-to-1 in order so timestamps stay perfectly aligned.\n` +
              `Input lines JSON:\n${JSON.stringify(syncedTexts)}`,
            config: {
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  lines: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                    description: `Exact ${syncedTexts.length} formatted lines matching input order.`,
                  },
                },
                required: ['lines'],
              },
            },
          }),
        timeoutMs
      );

      const parsed = safeJsonParse<{ lines?: string[] }>(resp.text);
      const lines = Array.isArray(parsed.lines) ? parsed.lines : [];
      if (lines.length === syncedTexts.length) {
        const res: AiLyricsResult = {
          found: true,
          plainLyrics: lines.join('\n'),
          cleanedSyncedTexts: lines.map((l, idx) => (typeof l === 'string' && l.trim() ? l.trim() : syncedTexts[idx])),
          source: params.mode === 'hinglish' ? 'Hinglish · Gemini AI' : 'AI Polished',
        };
        aiLyricsCache.set(cacheKey, { data: res, expiresAt: Date.now() + 12 * 60 * 60 * 1000 });
        return res;
      }
    }

    // Plain lyrics stanza formatting / Hinglish conversion
    const textInput = rawLyrics || syncedTexts.join('\n');
    const directive =
      params.mode === 'hinglish'
        ? 'Convert/rewrite these lyrics into clean, poetic, easy-to-sing Romanized Hinglish (keep any English lines intact), add section headers like [Verse 1], [Chorus], [Bridge], [Outro], and separate stanzas with a blank line.'
        : 'Format these lyrics so they look super clean and pleasurable to read: add section headers like [Intro], [Verse 1], [Chorus], [Bridge], [Outro], fix capitalization, punctuation, and broken line wraps, and separate stanzas with blank lines. Keep the authentic lyrics intact.';

    const resp = await executeGeminiWithFailover(
      (ai) =>
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: `Song: "${title}"${artist ? ` by ${artist}` : ''}\n${directive}\n\nLyrics:\n${textInput}`,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                formattedLyrics: {
                  type: Type.STRING,
                  description: 'Cleanly formatted lyrics with [Section] headers and stanza spacing.',
                },
              },
              required: ['formattedLyrics'],
            },
          },
        }),
      timeoutMs
    );

    const parsed = safeJsonParse<{ formattedLyrics?: string }>(resp.text);
    const formatted = (parsed.formattedLyrics || '').trim();
    const res: AiLyricsResult = {
      found: Boolean(formatted),
      plainLyrics: formatted || textInput,
      source: params.mode === 'hinglish' ? 'Hinglish · Gemini AI' : 'AI Polished',
    };
    aiLyricsCache.set(cacheKey, { data: res, expiresAt: Date.now() + 12 * 60 * 60 * 1000 });
    return res;
  })().finally(() => {
    aiLyricsInFlight.delete(cacheKey);
  });

  aiLyricsInFlight.set(cacheKey, job);
  return job;
}

