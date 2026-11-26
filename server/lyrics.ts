import {
  enhanceLyricsWithAi,
  findAndFormatLyricsWithAi,
  hasAvailableGeminiKey,
  hasConfiguredGeminiKeys,
} from './gemini.ts';
import type { LyricLine, LyricsResponse } from '../src/types/music.ts';

interface LrclibRecord {
  id?: number;
  trackName?: string;
  artistName?: string;
  albumName?: string;
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

interface SearchCandidate {
  title: string;
  artist: string;
  expectedTitle?: string;
  albumHint?: string;
  requireArtistTokenMatch?: boolean;
  allowPrefixWithArtist?: boolean;
  isCanonical?: boolean;
}

interface TrackSearchContext {
  rawTitle: string;
  rawArtist: string;
  primaryTitle: string;
  channelArtist: string;
  pipeArtists: string[];
  allArtistHints: string[];
  albumHints: string[];
  rawContextLower: string;
  hasStrongArtistHint: boolean;
  dur: number;
  candidates: SearchCandidate[];
}

const lyricsCache = new Map<string, { data: LyricsResponse; expiresAt: number }>();
const lyricsInFlight = new Map<string, Promise<LyricsResponse>>();

const PAREN_JUNK_RE =
  /\s*(\(|\[)\s*(official\s*(music\s*)?(video|audio|lyric\s*video|visualizer)|music\s*video|lyric\s*video|lyrical(\s*video)?|video\s*song|audio\s*song|lyrics?|hd|4k|8k|full\s*(video\s*)?(song|video|audio)|slowed(\s*\+?\s*reverb)?|slow\s*version|lofi|lo-fi|reverb|remix|live|audio|video|song|3d\s*audio|title\s*track|full\s*version|hindi|punjabi)\s*(\)|\])/gi;
const TITLE_SPLIT_TAG_RE =
  /\s+(?:\(|\[)?(?:official\s*(?:music\s*)?(?:video|audio|lyric\s*video|visualizer)|music\s*video|lyric\s*video|lyrical\s*(?:video)?|video\s*song|audio\s*song|full\s*video\s*song|full\s*song|full\s*video|best\s*video|song)(?:\)|\])?\s+(?=[A-Za-z0-9])/i;
const FROM_MOVIE_PAREN_RE = /\s*(\(|\[)\s*from\s+["'“]?[^)"'\]]+["'”]?\s*(\)|\])/gi;
const FROM_MOVIE_DASH_RE = /\s*[-–—]\s*from\s+["'“][^"'”]+["'”].*$/gi;
const TITLE_TRACK_SUFFIX_RE = /\s*[-–—:]\s*(title\s*track|full\s*song|full\s*video|theme\s*song)\b.*$/gi;
const TRAILING_LABEL_JUNK_RE =
  /\s*[-–—]?\s*\b(full\s*video\s*song|full\s*song|full\s*video|full\s*audio|best\s*video|video\s*song|lyrical\s*video|lyric\s*video|official\s*(music\s*)?(video|audio|visualizer)|music\s*video|audio\s*song|lyrical|lyrics|8k\s*song|4k\s*song|4k\s*video|hd\s*video|video|song|full)\s*$/gi;
const PIPE_TAIL_RE = /\s*\|.*$/;
const HASHTAG_RE = /#\S+/g;
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;
const BY_ARTIST_TAIL_RE = /\s+\bby\s+([A-Za-z0-9][A-Za-z0-9\s.&'-]{1,40})$/i;
const FEAT_EXTRACT_RE = /[([ ]?(?:feat\.?|ft\.?|featuring)\s+([^|()[\]-]+)/gi;
const FEAT_STRIP_RE = /\s*[([ ]?(?:feat\.?|ft\.?|featuring)\s+[^|()[\]-]+[)\]]?/gi;
const LRC_LINE_RE = /\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?\]/g;
const LRC_META_TAG_RE = /^\[(ti|ar|al|au|by|length|offset|re|ve|la):[^\]]*\]$/i;
const NON_LATIN_SCRIPT_RE = /[\u0900-\u0D7F\u0600-\u06FF]/;
const SECTION_TAG_RE = /^\[(Intro|Verse|Pre-Chorus|Chorus|Post-Chorus|Bridge|Hook|Rap|Outro|Refrain)[^\]]*\]$/im;
const SPECIAL_VARIANT_RE =
  /\b(instrumental|karaoke|flute|ringtone|lofi|lo-fi|slowed|slow\s*version|reverb|remix|sped\s*up|nightcore|dj\s*mix|8d\s*audio|cover|8d|unplugged|reprise|acoustic|mashup)\b/i;

const RECORD_LABEL_RE =
  /\b(t-?series|zee\s*music|sony\s*music(\s*india)?|yrf|yash\s*raj|tips(\s*(official|music))?|saregama|speed\s*records|white\s*hill|coke\s*studio(\s*pakistan)?|desi\s*music(\s*(factory|india))?|warner\s*music|universal\s*music|times\s*music|eros\s*now|venus|junglee\s*music|panorama\s*music|svp\s*music|hombale|geet\s*mp3|jatt\s*records|superhit(\s*music)?|retro|evergreen|old\s*hindi|gaane|classic\s*hits|ur\s*debut|dreamiyata\s*music|play\s*dmf|records|entertainment|films|productions|studios|official\s*channel|music\s*company|vevo|lyrics?|lyrical|jukebox|lofi|slowed|reverb|melodies|vibes|vibezz|hits|playlist|station|bollywood|punjabi|indie\s*music|soundtrack)\b/i;

const PIPE_CREDIT_NOISE_RE =
  /\b(starring|directed\s*by|produced\s*by|releasing|in\s*cinemas|worldwide|subscribe|watch\s*now|full\s*video|full\s*song|official|lyrics?|season\s*\d*|episode\s*\d*|presents|out\s*now|new\s*song|latest\s*song|bollywood|punjabi\s*song|hindi\s*song|retro\s*song|old\s*songs?)\b/i;

const AD_WATERMARK_LINE_RE =
  /^(\d+\s*contributors?|translations?|.*?\blyrics\b\s*$|embed$|you might also like|see .* live|get tickets as low as|lyrics powered by)/i;

const ARTIST_STOPWORDS = new Set([
  'feat',
  'ft',
  'featuring',
  'and',
  'with',
  'the',
  'by',
  'music',
  'official',
  'channel',
  'singer',
  'singers',
]);

function normalizeLatin(text: string): string {
  return (text || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
}

function isRecordLabel(name: string): boolean {
  const n = normalizeLatin(name).trim();
  if (!n) return false;
  return RECORD_LABEL_RE.test(n);
}

function getPrimaryArtist(raw: string): string {
  return (
    raw
      .split(/,|&|\bft\.?\b|\bfeat\.?\b|\bx\b|\bwith\b|\band\b/i)[0]
      ?.trim() || raw.trim()
  );
}

function stripJunkMarkers(text: string): string {
  let prev = '';
  let cur = normalizeLatin(text || '')
    .replace(EMOJI_RE, ' ')
    .replace(HASHTAG_RE, ' ')
    .replace(PIPE_TAIL_RE, '')
    .replace(FROM_MOVIE_PAREN_RE, ' ')
    .replace(FROM_MOVIE_DASH_RE, '')
    .replace(TITLE_TRACK_SUFFIX_RE, '')
    .replace(PAREN_JUNK_RE, ' ')
    .replace(FEAT_STRIP_RE, ' ');

  // Repeat trailing cleanup until stable (e.g. "Chudi Khankayi Re 8K Song" -> "Chudi Khankayi Re")
  for (let i = 0; i < 3 && cur !== prev; i++) {
    prev = cur;
    cur = cur.replace(TRAILING_LABEL_JUNK_RE, '').replace(/\s*[-–—:]\s*$/, '').trim();
  }
  return cur.replace(/\s+/g, ' ').trim();
}

function isShowOrLabelPrefixSegment(seg: string): boolean {
  const n = stripJunkMarkers(seg);
  if (!n) return true;
  // Only treat a pipe prefix as a show/label if the entire stripped segment is a show or label name
  return (
    /^(?:coke\s*studio(?:\s*pakistan)?(?:\s*season\s*\d+)?|mtv\s*unplugged|t-?series(?:\s*mixtape)?|zee\s*music(?:\s*company)?|sony\s*music(?:\s*india)?|yrf|yash\s*raj(?:\s*films)?|saregama(?:\s*music)?|speed\s*records|tips(?:\s*official|\s*music)?|spotify\s*singles|colors\s*show|season\s*\d+|episode\s*\d+)$/i.test(
      n
    )
  );
}

function splitEffectivePipeTitle(rawTitle: string): {
  mainSegment: string;
  trailingPipeParts: string[];
  prefixAlbumHints: string[];
} {
  const parts = normalizeLatin(rawTitle || '')
    .split('|')
    .map((p) => p.trim())
    .filter(Boolean);
  const prefixAlbumHints: string[] = [];
  let idx = 0;
  while (idx < parts.length - 1 && isShowOrLabelPrefixSegment(parts[idx])) {
    prefixAlbumHints.push(stripJunkMarkers(parts[idx]));
    idx++;
  }
  return {
    mainSegment: parts[idx] || normalizeLatin(rawTitle || '').split('|')[0] || '',
    trailingPipeParts: parts.slice(idx + 1),
    prefixAlbumHints: prefixAlbumHints.filter((h) => h.length >= 2),
  };
}

function cleanTitleText(raw: string): string {
  const { mainSegment: prePipe } = splitEffectivePipeTitle(raw);
  const byStripped = prePipe.replace(BY_ARTIST_TAIL_RE, '').trim();
  // If a junk marker like "(Official Video)" or "Full Song" sits in the middle followed by artist/movie text,
  // treat the part BEFORE the tag as the primary title (the trailing part is extracted separately as hints).
  const splitMatch = byStripped.match(TITLE_SPLIT_TAG_RE);
  if (splitMatch && typeof splitMatch.index === 'number' && splitMatch.index >= 2) {
    const beforeTag = byStripped.slice(0, splitMatch.index).trim();
    const cleanedBefore = stripJunkMarkers(beforeTag);
    if (cleanedBefore.length >= 2) return cleanedBefore;
  }
  return stripJunkMarkers(byStripped);
}

function cleanArtistText(raw: string): string {
  const cleaned = normalizeLatin(raw || '')
    .replace(EMOJI_RE, ' ')
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/VEVO$/i, '')
    .replace(/\bOfficial\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || isRecordLabel(cleaned)) return '';
  return getPrimaryArtist(cleaned);
}

function tokenizeWords(text: string): string[] {
  return normalizeLatin(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 1);
}

function tokenizeArtistWords(text: string): string[] {
  return normalizeLatin(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !ARTIST_STOPWORDS.has(w));
}

function cleanTitleForCompare(raw: string | undefined): string {
  if (!raw) return '';
  return normalizeLatin(raw)
    .replace(FROM_MOVIE_PAREN_RE, ' ')
    .replace(FROM_MOVIE_DASH_RE, '')
    .replace(TITLE_TRACK_SUFFIX_RE, '')
    .replace(PAREN_JUNK_RE, ' ')
    .replace(FEAT_STRIP_RE, ' ')
    .replace(/\s*\([^)]*(?:reprise|unplugged|acoustic|version|edit|radio|remaster|mix|live|instrumental)[^)]*\)/gi, ' ')
    .replace(/\s*\[[^\]]*\]/g, ' ')
    .replace(/\s*[-–—]\s*(?:single|ep|version|unplugged|reprise|acoustic|live|radio\s*edit).*$/gi, '')
    .replace(TRAILING_LABEL_JUNK_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isAbbreviatedPersonName(name: string): boolean {
  return /^[A-Za-z]{2,}(?:\s+[A-Za-z]{2,})?\s+[A-Z]\.?$/.test(name.trim());
}

function extractPipeAndFeatArtists(rawTitle: string): {
  pipeArtists: string[];
  featArtists: string[];
  extraContextTokens: string[];
} {
  const pipeArtists: string[] = [];
  const featArtists: string[] = [];
  const extraContextTokens: string[] = [];
  const seen = new Set<string>();

  const pushHint = (target: string[], rawName: string) => {
    const cleaned = normalizeLatin(rawName)
      .replace(EMOJI_RE, ' ')
      .replace(HASHTAG_RE, ' ')
      .replace(PAREN_JUNK_RE, ' ')
      .replace(FEAT_STRIP_RE, ' ')
      .replace(/\bft\.?\b.*$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (
      !cleaned ||
      cleaned.length < 2 ||
      cleaned.length > 42 ||
      /^\d{4}$/.test(cleaned) ||
      isRecordLabel(cleaned) ||
      PIPE_CREDIT_NOISE_RE.test(cleaned)
    ) {
      return;
    }
    const key = cleaned.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      target.push(cleaned);
    }
  };

  const { mainSegment: prePipe, trailingPipeParts, prefixAlbumHints } = splitEffectivePipeTitle(rawTitle);
  for (const h of prefixAlbumHints) {
    extraContextTokens.push(h);
  }
  const byMatch = prePipe.match(BY_ARTIST_TAIL_RE);
  if (byMatch?.[1]) {
    pushHint(featArtists, byMatch[1]);
  }

  // Extract text AFTER inline video tags (e.g., "(Official Video) Anuv Jain" or "Full Song Yeh Jawaani Hai Deewani")
  const splitMatch = prePipe.match(TITLE_SPLIT_TAG_RE);
  if (splitMatch && typeof splitMatch.index === 'number') {
    const afterTag = prePipe.slice(splitMatch.index + splitMatch[0].length).trim();
    const afterCleaned = stripJunkMarkers(afterTag.split(/[:\-–—]/)[0] || afterTag);
    if (afterCleaned.length >= 2) {
      extraContextTokens.push(afterCleaned);
      for (const sub of afterCleaned.split(/,|&|\bx\b|\bft\.?\b|\bfeat\.?\b/i)) {
        pushHint(featArtists, sub);
      }
    }
  }

  for (const m of rawTitle.matchAll(FEAT_EXTRACT_RE)) {
    const part = m[1] || '';
    for (const sub of part.split(/,|&|\bx\b|\band\b/i)) {
      pushHint(featArtists, sub);
    }
  }

  // Process trailing pipe segments in reverse so singer/composer credits at the end come first
  for (const seg of [...trailingPipeParts].reverse()) {
    if (PIPE_CREDIT_NOISE_RE.test(seg) && !seg.includes(',') && !seg.includes('&')) continue;
    for (const sub of seg.split(/,|&|\bx\b|\bft\.?\b|\bfeat\.?\b|\//i)) {
      pushHint(pipeArtists, sub);
    }
  }

  // De-prioritize abbreviated names like "Amitabh B" or "Vicky K" behind full composer/singer names
  pipeArtists.sort((a, b) => Number(isAbbreviatedPersonName(a)) - Number(isAbbreviatedPersonName(b)));

  return { pipeArtists, featArtists, extraContextTokens };
}

function buildTrackContext(
  rawTitle: string,
  rawArtist: string,
  dur: number
): TrackSearchContext {
  const baseTitle = cleanTitleText(rawTitle);
  const channelArtist = cleanArtistText(rawArtist);
  const { pipeArtists, featArtists, extraContextTokens } = extractPipeAndFeatArtists(rawTitle);

  const candidates: SearchCandidate[] = [];
  const seen = new Set<string>();
  const albumHints: string[] = [...extraContextTokens];
  const extraArtistHints: string[] = [];

  const pushCand = (c: SearchCandidate) => {
    const tt = stripJunkMarkers(c.title);
    const aa = c.artist.trim();
    if (!tt) return;
    const key = `${tt.toLowerCase()}::${aa.toLowerCase()}::${c.requireArtistTokenMatch ? '1' : '0'}`;
    if (!seen.has(key)) {
      seen.add(key);
      candidates.push({
        ...c,
        title: tt,
        artist: aa,
        expectedTitle: stripJunkMarkers(c.expectedTitle || tt),
      });
    }
  };

  const fromMatch =
    rawTitle.match(/\bfrom\s+["'“]([^)"'”]+)["'”]?/i) ||
    rawTitle.match(/\(\s*from\s+([^)]+)\)/i);
  if (fromMatch?.[1]) {
    const movie = stripJunkMarkers(fromMatch[1]);
    if (movie.length >= 2) albumHints.push(movie);
  }

  const bestPipeOrFeat = featArtists[0] || pipeArtists[0] || '';
  const preferredArtist = channelArtist || bestPipeOrFeat;

  const colonTitleMatch = baseTitle.match(/^([A-Za-z0-9\s.'&-]{2,28}):\s+(.{2,})$/);
  const effectiveBaseTitle =
    colonTitleMatch && !baseTitle.includes(' - ')
      ? stripJunkMarkers(colonTitleMatch[2])
      : baseTitle;
  if (colonTitleMatch && !baseTitle.includes(' - ')) {
    const colonLeft = stripJunkMarkers(colonTitleMatch[1]);
    if (colonLeft.length >= 2) {
      albumHints.push(colonLeft);
      if (!isRecordLabel(colonLeft) && colonLeft.split(/\s+/).length <= 3) {
        extraArtistHints.push(colonLeft);
      }
    }
  }

  const dashParts = effectiveBaseTitle
    .split(/\s+[-–—]\s+|\s+:\s+/)
    .map((p) => stripJunkMarkers(p))
    .filter((p) => p.length >= 2);

  let primaryTitle = effectiveBaseTitle;

  if (dashParts.length >= 2) {
    const left = dashParts[0];
    const right = dashParts.slice(1).join(' ').trim();
    const leftLower = left.toLowerCase();
    const rightLower = right.toLowerCase();
    const channelLower = channelArtist.toLowerCase();

    const leftMatchesChannel =
      Boolean(channelLower) &&
      (leftLower === channelLower || leftLower.includes(channelLower) || channelLower.includes(leftLower));
    const rightMatchesChannel =
      Boolean(channelLower) &&
      (rightLower === channelLower || rightLower.includes(channelLower) || channelLower.includes(rightLower));

    if (leftMatchesChannel) {
      // Explicit "Artist - Song Title"
      primaryTitle = right;
      pushCand({ title: right, artist: getPrimaryArtist(left) });
      if (channelArtist.toLowerCase() !== leftLower) {
        pushCand({ title: right, artist: channelArtist });
      }
      pushCand({ title: right, artist: '' });
    } else if (rightMatchesChannel) {
      // Explicit "Song Title - Artist"
      primaryTitle = left;
      pushCand({ title: left, artist: getPrimaryArtist(right) });
      if (channelArtist.toLowerCase() !== rightLower) {
        pushCand({ title: left, artist: channelArtist });
      }
      pushCand({ title: left, artist: '' });
    } else if (left.includes(',') && right.split(/\s+/).length <= 5) {
      // Explicit "Artist 1, Artist 2, Artist 3 - Song Title" (e.g. "Arijit Singh, White Noise... - Sitaare")
      primaryTitle = right;
      const primaryLeftArtist = getPrimaryArtist(left);
      extraArtistHints.push(
        ...left
          .split(/,|&|\bft\.?\b|\bfeat\.?\b/i)
          .map((s) => s.trim())
          .filter((s) => s.length >= 2 && !isRecordLabel(s))
      );
      pushCand({ title: right, artist: primaryLeftArtist });
      pushCand({ title: right, artist: '' });
    } else {
      // Ambiguous "Song - Movie/Album" OR "Song - Artist1, Artist2" OR "Artist - Song"
      primaryTitle = left;
      albumHints.push(right);

      // If `right` has commas/featuring artists (e.g. "Tu Hi Hai Aashiqui - Arijit Singh, Palak Muchhal"), add to artist hints
      if (/,|&|\bft\.?\b|\bfeat\.?\b/i.test(right)) {
        const rightPrimary = getPrimaryArtist(right);
        extraArtistHints.push(
          ...right
            .split(/,|&|\bft\.?\b|\bfeat\.?\b/i)
            .map((s) => s.trim())
            .filter((s) => s.length >= 2 && !isRecordLabel(s))
        );
        if (rightPrimary) {
          pushCand({ title: left, artist: rightPrimary });
        }
      }

      if (preferredArtist) {
        pushCand({ title: left, artist: preferredArtist, albumHint: right });
      }
      for (const pa of pipeArtists.slice(0, 3)) {
        pushCand({ title: left, artist: pa, albumHint: right });
      }
      pushCand({ title: left, artist: '', albumHint: right });

      const rightPrimary = getPrimaryArtist(right);
      if (!isRecordLabel(rightPrimary) && rightPrimary.split(/\s+/).length <= 4) {
        pushCand({ title: left, artist: rightPrimary, albumHint: right });
      }

      const leftPrimary = getPrimaryArtist(left);
      if (!isRecordLabel(leftPrimary) && leftPrimary.split(/\s+/).length <= 4) {
        pushCand({
          title: right,
          artist: leftPrimary,
          expectedTitle: right,
          requireArtistTokenMatch: true,
        });
      }
    }
  } else {
    if (preferredArtist) {
      pushCand({ title: effectiveBaseTitle, artist: preferredArtist });
    }
    for (const pa of pipeArtists.slice(0, 3)) {
      pushCand({ title: effectiveBaseTitle, artist: pa });
    }
    pushCand({ title: effectiveBaseTitle, artist: '' });
  }

  if (preferredArtist) {
    pushCand({ title: effectiveBaseTitle, artist: preferredArtist });
  }
  pushCand({ title: effectiveBaseTitle, artist: '' });
  if (effectiveBaseTitle.toLowerCase() !== baseTitle.toLowerCase()) {
    pushCand({ title: baseTitle, artist: preferredArtist });
  }

  // Handle YouTube titles that append lyric hook words after official title (e.g. "Tere Vaaste Falak Se Chand" -> "Tere Vaaste")
  const primaryWords = tokenizeWords(cleanTitleForCompare(primaryTitle));
  const prefixHintArtist = preferredArtist || extraArtistHints[0] || pipeArtists[0] || '';
  if (primaryWords.length >= 4 && prefixHintArtist) {
    const prefix2 = primaryWords.slice(0, 2).join(' ');
    pushCand({
      title: prefix2,
      artist: prefixHintArtist,
      expectedTitle: primaryTitle,
      allowPrefixWithArtist: true,
    });
    if (primaryWords.length >= 5) {
      pushCand({
        title: primaryWords.slice(0, 3).join(' '),
        artist: prefixHintArtist,
        expectedTitle: primaryTitle,
        allowPrefixWithArtist: true,
      });
    }
  }

  const allArtistHints = Array.from(
    new Set(
      [channelArtist, ...featArtists, ...extraArtistHints, ...pipeArtists]
        .map((a) => a.trim())
        .filter((a) => a.length >= 2 && !isRecordLabel(a))
    )
  );

  const hasStrongArtistHint = Boolean(
    channelArtist || featArtists.length > 0 || extraArtistHints.length > 0 || pipeArtists.length > 0
  );
  const rawContextLower = normalizeLatin(`${rawTitle} ${rawArtist}`).toLowerCase();

  return {
    rawTitle,
    rawArtist,
    primaryTitle,
    channelArtist,
    pipeArtists,
    allArtistHints,
    albumHints: Array.from(new Set(albumHints)),
    rawContextLower,
    hasStrongArtistHint,
    dur,
    candidates,
  };
}

export function hasStrictTitleMatch(
  candidateTitle: string | undefined,
  expectedTitle: string
): boolean {
  const cleanedCand = cleanTitleForCompare(candidateTitle);
  const cleanedExp = cleanTitleForCompare(expectedTitle);
  if (!cleanedCand || !cleanedExp) return false;

  const candWords = tokenizeWords(cleanedCand);
  const expWords = tokenizeWords(cleanedExp);
  if (candWords.length === 0 || expWords.length === 0) return false;

  const candJoined = candWords.join(' ');
  const expJoined = expWords.join(' ');
  if (candJoined === expJoined) return true;

  if (
    (candWords.length === 1 && expWords.length >= 2) ||
    (expWords.length === 1 && candWords.length >= 2)
  ) {
    return false;
  }

  const candSet = new Set(candWords);
  const expSet = new Set(expWords);
  let overlap = 0;
  for (const w of expSet) {
    if (candSet.has(w)) overlap++;
  }

  const expCoverage = overlap / expSet.size;
  const candCoverage = overlap / candSet.size;

  return expCoverage >= 0.72 && candCoverage >= 0.65;
}

function hasPrefixTitleMatch(
  candidateTitle: string | undefined,
  longYoutubeTitle: string
): boolean {
  const cleanedCand = cleanTitleForCompare(candidateTitle);
  const cleanedExp = cleanTitleForCompare(longYoutubeTitle);
  if (!cleanedCand || !cleanedExp) return false;

  const candWords = tokenizeWords(cleanedCand);
  const expWords = tokenizeWords(cleanedExp);
  if (candWords.length < 2 || expWords.length < candWords.length + 2) return false;

  const candJoined = candWords.join(' ');
  const expJoined = expWords.join(' ');
  return expJoined.startsWith(`${candJoined} `);
}

function getArtistMatchStrength(
  candidateArtist: string | undefined,
  ctx: TrackSearchContext,
  candidateHintArtist?: string
): { matched: boolean; exact: boolean; scoreBonus: number } {
  const candClean = normalizeLatin(candidateArtist || '').toLowerCase().trim();
  if (!candClean) return { matched: false, exact: false, scoreBonus: 0 };

  const candTokens = tokenizeArtistWords(candClean);
  if (candTokens.length === 0) return { matched: false, exact: false, scoreBonus: 0 };

  const hintStrings = [
    ...(candidateHintArtist ? [candidateHintArtist] : []),
    ...ctx.allArtistHints,
  ].filter(Boolean);

  const candTokenSet = new Set(candTokens);
  let bestMatched = false;
  let bestExact = false;
  let bestBonus = 0;
  let matchedHintCount = 0;

  for (const hint of hintStrings) {
    const hintClean = normalizeLatin(hint).toLowerCase().trim();
    if (!hintClean) continue;
    if (candClean === hintClean) {
      bestMatched = true;
      bestExact = true;
      bestBonus = Math.max(bestBonus, 62);
      matchedHintCount++;
      continue;
    }
    const hintTokens = tokenizeArtistWords(hintClean);
    if (hintTokens.length === 0) continue;

    let tokenOverlap = 0;
    for (const ht of hintTokens) {
      if (candTokenSet.has(ht)) tokenOverlap++;
    }
    const ratio = tokenOverlap / Math.min(candTokens.length, hintTokens.length);
    if (ratio >= 0.5 && tokenOverlap >= 1) {
      bestMatched = true;
      const isExact = tokenOverlap === hintTokens.length;
      if (isExact) bestExact = true;
      bestBonus = Math.max(bestBonus, isExact ? 56 : 42);
      matchedHintCount++;
    }
  }

  if (bestMatched) {
    // Extra bonus when candidate matches multiple singers/composers (e.g. Arijit Singh + Palak Muchhal)
    const multiBonus = Math.min(24, Math.max(0, matchedHintCount - 1) * 14);
    return { matched: true, exact: bestExact, scoreBonus: bestBonus + multiBonus };
  }

  const primaryCand = normalizeLatin(getPrimaryArtist(candClean)).toLowerCase().trim();
  if (primaryCand.length >= 4 && ctx.rawContextLower.includes(primaryCand)) {
    return { matched: true, exact: true, scoreBonus: 48 };
  }

  return { matched: false, exact: false, scoreBonus: 0 };
}

function hasAlbumHintMatch(candidateAlbum: string | undefined, ctx: TrackSearchContext): boolean {
  if (!candidateAlbum) return false;
  // Keep `(From "Laapataa Ladies")` inside albumName (do NOT call cleanTitleForCompare here!)
  const albumWords = new Set(tokenizeWords(normalizeLatin(candidateAlbum)));
  if (albumWords.size === 0) return false;

  // Check both explicit albumHints AND pipe segments (since YouTube often puts movie names in pipes like `| Laapataa Ladies`)
  const combinedHints = [...ctx.albumHints, ...ctx.pipeArtists];
  for (const hint of combinedHints) {
    const hintWords = tokenizeWords(cleanTitleForCompare(hint));
    if (hintWords.length === 0) continue;
    let overlap = 0;
    for (const hw of hintWords) {
      if (albumWords.has(hw)) overlap++;
    }
    if (overlap / hintWords.length >= 0.7) return true;
  }
  return false;
}

function cleanPlainLyricsText(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleanedLines = raw
    .split(/\r?\n/)
    .map((line) => line.replace(LRC_LINE_RE, '').trimEnd())
    .filter((line) => {
      const trimmed = line.trim();
      if (LRC_META_TAG_RE.test(trimmed)) return false;
      if (AD_WATERMARK_LINE_RE.test(trimmed)) return false;
      return true;
    });

  const normalized = cleanedLines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return normalized || null;
}

function polishLinePunctuation(line: string): string {
  const trimmed = line.trim();
  if (!trimmed) return '';
  if (/^\[[^\]]+\]$/.test(trimmed)) return trimmed;
  const fixedI = trimmed.replace(/\bi\b/g, 'I').replace(/\bi'([a-z]+)\b/g, "I'$1");
  return fixedI.charAt(0).toUpperCase() + fixedI.slice(1);
}

/**
 * Deterministic 0ms local stanza & chorus formatter for plain lyrics.
 */
export function formatPlainLyricsLocally(text: string): string {
  const rawLines = text
    .split(/\r?\n/)
    .map((l) => polishLinePunctuation(l))
    .filter((l, idx, arr) => {
      if (l === '' && arr[idx - 1]?.trim() === '') return false;
      return true;
    });

  const nonEmpty = rawLines.filter(Boolean);
  if (nonEmpty.length < 4) return rawLines.join('\n').trim();
  if (SECTION_TAG_RE.test(text)) {
    return rawLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  const hasBlankBreaks = rawLines.filter((l) => l === '').length >= 2;
  const stanzas: string[][] = [];
  if (hasBlankBreaks) {
    let cur: string[] = [];
    for (const l of rawLines) {
      if (l === '') {
        if (cur.length > 0) {
          stanzas.push(cur);
          cur = [];
        }
      } else {
        cur.push(l);
      }
    }
    if (cur.length > 0) stanzas.push(cur);
  } else {
    for (let i = 0; i < nonEmpty.length; i += 4) {
      stanzas.push(nonEmpty.slice(i, i + 4));
    }
  }

  const stanzaFreq = new Map<string, number>();
  for (const st of stanzas) {
    const sig = st.slice(0, 2).join(' ').toLowerCase();
    stanzaFreq.set(sig, (stanzaFreq.get(sig) ?? 0) + 1);
  }

  let verseNum = 1;
  const formattedBlocks = stanzas.map((st, idx) => {
    const sig = st.slice(0, 2).join(' ').toLowerCase();
    const repeats = (stanzaFreq.get(sig) ?? 0) >= 2;
    let header: string;
    if (repeats) {
      header = '[Chorus]';
    } else if (idx === stanzas.length - 1 && stanzas.length >= 4 && st.length <= 3) {
      header = '[Outro]';
    } else {
      header = `[Verse ${verseNum++}]`;
    }
    return `${header}\n${st.join('\n')}`;
  });

  return formattedBlocks.join('\n\n').trim();
}

export function parseLrcSyncedLyrics(lrc: string | null | undefined): LyricLine[] {
  if (!lrc) return [];
  const parsed: LyricLine[] = [];

  for (const rawLine of lrc.split(/\r?\n/)) {
    if (LRC_META_TAG_RE.test(rawLine.trim())) continue;
    const matches = Array.from(rawLine.matchAll(LRC_LINE_RE));
    if (matches.length === 0) continue;
    const text = rawLine.replace(LRC_LINE_RE, '').trim();
    if (!text || /^♪+$/.test(text)) continue;

    for (const m of matches) {
      const mins = Number(m[1]) || 0;
      const secs = Number(m[2]) || 0;
      const fracRaw = m[3] || '0';
      const frac = Number(fracRaw) / Math.pow(10, fracRaw.length);
      const timeSeconds = Number((mins * 60 + secs + frac).toFixed(2));
      parsed.push({ timeSeconds, text });
    }
  }

  parsed.sort((a, b) => a.timeSeconds - b.timeSeconds);
  return parsed;
}

function recordToLyricsResponse(rec: LrclibRecord): LyricsResponse {
  const syncedLines = parseLrcSyncedLyrics(rec.syncedLyrics);
  const rawPlain = cleanPlainLyricsText(rec.plainLyrics);
  const plainLyrics =
    rawPlain && !NON_LATIN_SCRIPT_RE.test(rawPlain)
      ? formatPlainLyricsLocally(rawPlain)
      : rawPlain;
  return {
    found: syncedLines.length >= 2 || Boolean(plainLyrics && plainLyrics.length >= 35),
    trackName: rec.trackName,
    artistName: rec.artistName,
    albumName: rec.albumName,
    syncedLines,
    plainLyrics,
    source: 'LRCLIB',
  };
}

function isSpecialVariantMismatch(rec: LrclibRecord, rawTitle: string): boolean {
  const recMeta = `${rec.trackName || ''} ${rec.albumName || ''}`.toLowerCase();
  const rawLower = rawTitle.toLowerCase();
  const m = recMeta.match(SPECIAL_VARIANT_RE);
  if (!m) return false;
  return !rawLower.includes(m[1].toLowerCase());
}

function isMostlyParenTranslation(lines: string[]): boolean {
  const nonEmpty = lines.map((l) => l.trim()).filter(Boolean);
  if (nonEmpty.length < 4) return false;
  const parenCount = nonEmpty.filter((l) => l.startsWith('(') && l.endsWith(')')).length;
  return parenCount / nonEmpty.length > 0.55;
}

function scoreLrclibRecord(
  rec: LrclibRecord,
  cand: SearchCandidate,
  ctx: TrackSearchContext
): number {
  if (rec.instrumental) return -Infinity;
  if (isSpecialVariantMismatch(rec, ctx.rawTitle)) return -Infinity;

  const syncedLines = parseLrcSyncedLyrics(rec.syncedLyrics);
  const rawPlain = cleanPlainLyricsText(rec.plainLyrics);
  if (syncedLines.length < 2 && (!rawPlain || rawPlain.length < 35)) {
    return -Infinity;
  }

  const artistCheck = getArtistMatchStrength(rec.artistName, ctx, cand.artist);
  const albumMatched = hasAlbumHintMatch(rec.albumName, ctx);

  const expectedTitle = cand.expectedTitle || cand.title;
  const strictTitleMatched = hasStrictTitleMatch(rec.trackName, expectedTitle);
  const prefixTitleMatched =
    !strictTitleMatched &&
    Boolean(cand.allowPrefixWithArtist || tokenizeWords(cleanTitleForCompare(ctx.primaryTitle)).length >= 4) &&
    (artistCheck.matched || albumMatched) &&
    hasPrefixTitleMatch(rec.trackName, expectedTitle);

  if (!strictTitleMatched && !prefixTitleMatched) {
    return -Infinity;
  }

  if (cand.requireArtistTokenMatch) {
    const artistTokens = tokenizeArtistWords(cand.artist);
    const recArtistTokens = new Set(tokenizeArtistWords(rec.artistName || ''));
    const hasLeftArtist =
      artistTokens.length > 0 && artistTokens.some((t) => recArtistTokens.has(t));
    if (!hasLeftArtist) return -Infinity;
  }

  const durDiff =
    ctx.dur > 25 && typeof rec.duration === 'number' && rec.duration > 0
      ? Math.abs(rec.duration - ctx.dur)
      : null;

  if (durDiff !== null && durDiff > (prefixTitleMatched ? 18 : 55)) {
    return -Infinity;
  }

  const cleanRecTitle = cleanTitleForCompare(rec.trackName).toLowerCase();
  const cleanExpTitle = cleanTitleForCompare(expectedTitle).toLowerCase();
  const isExactTitle = cleanRecTitle === cleanExpTitle || prefixTitleMatched;

  // CRITICAL: When track metadata identifies a singer/artist/credit (e.g. "Shubh", "Hasan Raheem"),
  // never substitute a different artist's song with the same title even if duration happens to match.
  if (ctx.hasStrongArtistHint && !artistCheck.matched && !albumMatched) {
    return -Infinity;
  }

  // Compute whether the Latin lyrics actually reference the song title
  const sampleRaw = syncedLines.length > 0
    ? syncedLines.map((l) => l.text).join(' ')
    : (rawPlain || '');
  let hasTitleInLyrics = false;
  let missesTitleCompletely = false;
  if (sampleRaw && !NON_LATIN_SCRIPT_RE.test(sampleRaw)) {
    const expWords = tokenizeWords(cleanExpTitle).filter((w) => w.length >= 2);
    if (expWords.length >= 2) {
      const sampleNormalized = tokenizeWords(sampleRaw).join(' ');
      const titlePhrase = expWords.join(' ');
      const distinctiveWords = expWords.filter((w) => w.length >= 4);
      const hasPhrase = sampleNormalized.includes(titlePhrase);
      const distinctiveHits = distinctiveWords.filter((w) =>
        sampleNormalized.includes(w)
      ).length;
      if (hasPhrase) {
        hasTitleInLyrics = true;
      } else if (distinctiveWords.length > 0 && distinctiveHits === 0) {
        missesTitleCompletely = true;
      }
    }
  }

  // Reject unattributed / ambiguous records unless artist, album, OR tight duration + exact title are verified
  if (!artistCheck.matched && !albumMatched) {
    if (ctx.albumHints.length > 0 && (durDiff === null || durDiff > 6)) {
      return -Infinity;
    }
    if (missesTitleCompletely) {
      return -Infinity;
    }
    const tightDurOk = durDiff !== null && durDiff <= 8 && isExactTitle;
    const multiWordPhraseOk =
      durDiff === null &&
      isExactTitle &&
      tokenizeWords(cleanExpTitle).length >= 3 &&
      hasTitleInLyrics;
    if (!tightDurOk && !multiWordPhraseOk) {
      return -Infinity;
    }
  }

  let score = 0;

  if (isExactTitle) {
    score += 48;
  } else {
    score += 24;
  }

  if (artistCheck.matched) {
    score += artistCheck.scoreBonus;
  } else if (cand.artist) {
    score -= 24;
  }

  if (albumMatched) {
    score += 34;
  }

  if (durDiff !== null) {
    if (durDiff <= 4) score += 36;
    else if (durDiff <= 10) score += 24;
    else if (durDiff <= 20) score += 10;
    else if (durDiff > 32) score -= Math.min(45, (durDiff - 25) * 1.5);
  }

  if (syncedLines.length >= 4) {
    score += 22;
  }

  if (hasTitleInLyrics) {
    score += 38;
  } else if (missesTitleCompletely) {
    score -= syncedLines.length > 0 ? 22 : 34;
  }

  // Prefer actual sung lyrics over full-song parenthetical English translations
  const sampleLines = syncedLines.length >= 4
    ? syncedLines.slice(0, 8).map((l) => l.text)
    : (rawPlain || '').split('\n').slice(0, 8);
  if (isMostlyParenTranslation(sampleLines)) {
    score -= 32;
  }

  return score;
}

async function autoBeautifyLyrics(
  resp: LyricsResponse,
  title: string,
  artist: string
): Promise<LyricsResponse> {
  if (!resp.found) return resp;

  if (
    resp.syncedLines.length === 0 &&
    resp.plainLyrics &&
    !NON_LATIN_SCRIPT_RE.test(resp.plainLyrics)
  ) {
    return {
      ...resp,
      plainLyrics: formatPlainLyricsLocally(resp.plainLyrics),
    };
  }

  if (!hasAvailableGeminiKey()) return resp;

  const AI_BEAUTIFY_TIMEOUT_MS = 8_500;
  const withDeadline = <T>(p: Promise<T>): Promise<T | null> =>
    Promise.race([
      p,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), AI_BEAUTIFY_TIMEOUT_MS)),
    ]);

  try {
    if (resp.syncedLines.length > 0) {
      const hasNonLatin = resp.syncedLines.some((l) => NON_LATIN_SCRIPT_RE.test(l.text));
      if (!hasNonLatin) return resp;

      const enhanced = await withDeadline(
        enhanceLyricsWithAi({
          title,
          artist,
          syncedTexts: resp.syncedLines.map((l) => l.text),
          mode: 'hinglish',
          timeoutMs: 8_000,
        })
      );
      if (
        enhanced?.found &&
        enhanced.cleanedSyncedTexts &&
        enhanced.cleanedSyncedTexts.length === resp.syncedLines.length
      ) {
        return {
          ...resp,
          syncedLines: resp.syncedLines.map((orig, idx) => ({
            timeSeconds: orig.timeSeconds,
            text: enhanced.cleanedSyncedTexts![idx],
          })),
          plainLyrics: enhanced.plainLyrics || resp.plainLyrics,
          source: `${resp.source || 'Web'} · Hinglish AI`,
          aiEnhanced: true,
        };
      }
      return resp;
    }

    if (resp.plainLyrics && NON_LATIN_SCRIPT_RE.test(resp.plainLyrics)) {
      const enhanced = await withDeadline(
        enhanceLyricsWithAi({
          title,
          artist,
          rawLyrics: resp.plainLyrics,
          mode: 'hinglish',
          timeoutMs: 8_000,
        })
      );
      if (enhanced?.found && enhanced.plainLyrics) {
        return {
          ...resp,
          plainLyrics: enhanced.plainLyrics,
          source: `${resp.source || 'Web'} · Hinglish AI`,
          aiEnhanced: true,
        };
      }
    }
  } catch {
    // Fall back safely to original lyrics if AI rate-limited or unavailable
  }

  return resp;
}

async function fetchJsonSafe<T>(url: string, timeoutMs = 5500): Promise<T | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'User-Agent': 'VIBRA-Music-App/1.0',
        Accept: 'application/json',
      },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function queryLrclibCandidates(
  candidates: SearchCandidate[],
  ctx: TrackSearchContext
): Promise<LyricsResponse | null> {
  if (candidates.length === 0) return null;

  const scoredPool: Array<{ score: number; rec: LrclibRecord }> = [];
  const primary = candidates[0];

  // 1. Fast exact /api/get lookup for top candidate (MUST pass strict validation!)
  if (primary?.title && primary.artist && !primary.requireArtistTokenMatch) {
    const sp = new URLSearchParams({
      track_name: primary.title,
      artist_name: primary.artist,
    });
    if (ctx.dur > 0) sp.set('duration', String(ctx.dur));
    const exact = await fetchJsonSafe<LrclibRecord>(
      `https://lrclib.net/api/get?${sp.toString()}`,
      4200
    );
    if (exact && (exact.syncedLyrics || exact.plainLyrics)) {
      const s = scoreLrclibRecord(exact, primary, ctx);
      if (exact.syncedLyrics && s >= 85) {
        const resp = recordToLyricsResponse(exact);
        if (resp.found) return resp;
      } else if (Number.isFinite(s) && s > -Infinity) {
        scoredPool.push({ score: s, rec: exact });
      }
    }
  }

  // 2. Build balanced parallel search URLs ensuring artist, album, AND bare-title queries all run
  const searchEntries: Array<{ url: string; cand: SearchCandidate }> = [];
  const seenUrls = new Set<string>();
  const addSearch = (url: string, cand: SearchCandidate) => {
    if (!seenUrls.has(url)) {
      seenUrls.add(url);
      searchEntries.push({ url, cand });
    }
  };

  if (primary?.artist && !primary.requireArtistTokenMatch) {
    const sp = new URLSearchParams({
      track_name: primary.title,
      artist_name: primary.artist,
    });
    addSearch(`https://lrclib.net/api/search?${sp.toString()}`, primary);
    addSearch(
      `https://lrclib.net/api/search?q=${encodeURIComponent(`${primary.title} ${primary.artist}`)}`,
      primary
    );
  }

  // Try second distinct artist candidate (handles lyricist vs singer/composer in pipes)
  const secondArtistCand = candidates.find(
    (c) => c.artist && c.artist.toLowerCase() !== primary?.artist.toLowerCase()
  );
  if (secondArtistCand) {
    addSearch(
      `https://lrclib.net/api/search?q=${encodeURIComponent(`${secondArtistCand.title} ${secondArtistCand.artist}`)}`,
      secondArtistCand
    );
  }

  // Try explicit song + movie/album hint (critical for "Namo Namo Kedarnath", "Kabira Yeh Jawaani...")
  if (ctx.albumHints[0] && !primary?.requireArtistTokenMatch) {
    addSearch(
      `https://lrclib.net/api/search?q=${encodeURIComponent(`${ctx.primaryTitle} ${ctx.albumHints[0]}`)}`,
      primary
    );
  }

  // Guaranteed bare title search as safety net
  if (!primary?.requireArtistTokenMatch) {
    addSearch(
      `https://lrclib.net/api/search?track_name=${encodeURIComponent(ctx.primaryTitle)}`,
      primary
    );
  }

  for (const cand of candidates.slice(0, 4)) {
    if (searchEntries.length >= 6) break;
    addSearch(
      `https://lrclib.net/api/search?q=${encodeURIComponent(
        cand.artist ? `${cand.title} ${cand.artist}` : cand.title
      )}`,
      cand
    );
  }

  const batchList = searchEntries.slice(0, 6);
  const batches = await Promise.all(
    batchList.map(async (entry) => ({
      ...entry,
      records: await fetchJsonSafe<LrclibRecord[]>(entry.url, 5000),
    }))
  );

  const bestByRecordKey = new Map<string, { score: number; rec: LrclibRecord }>();
  for (const entry of scoredPool) {
    const k = String(entry.rec.id || `${entry.rec.trackName}::${entry.rec.artistName}`);
    bestByRecordKey.set(k, entry);
  }

  for (const batch of batches) {
    if (!Array.isArray(batch.records)) continue;
    for (const rec of batch.records) {
      const s = scoreLrclibRecord(rec, batch.cand, ctx);
      if (!Number.isFinite(s)) continue;
      const k = String(rec.id || `${rec.trackName}::${rec.artistName}::${rec.duration}`);
      const prev = bestByRecordKey.get(k);
      if (!prev || s > prev.score) {
        bestByRecordKey.set(k, { score: s, rec });
      }
    }
  }

  const ranked = Array.from(bestByRecordKey.values()).sort((a, b) => b.score - a.score);
  const top = ranked[0];
  if (top && top.score >= 52) {
    const resp = recordToLyricsResponse(top.rec);
    if (resp.found) return resp;
  }

  return null;
}

async function resolveCanonicalSongMetadata(
  ctx: TrackSearchContext
): Promise<SearchCandidate[]> {
  const hint =
    ctx.allArtistHints.find((a) => !isAbbreviatedPersonName(a)) ||
    ctx.albumHints[0] ||
    ctx.allArtistHints[0] ||
    '';
  const query = stripJunkMarkers(hint ? `${ctx.primaryTitle} ${hint}` : ctx.primaryTitle);
  const fallbackBareQuery = stripJunkMarkers(
    ctx.albumHints[0] ? `${ctx.primaryTitle} ${ctx.albumHints[0]}` : ctx.primaryTitle
  );
  if (!query) return [];

  const [itunesIn, itunesUs, ovhSuggest] = await Promise.all([
    fetchJsonSafe<{
      results?: Array<{
        trackName?: string;
        artistName?: string;
        collectionName?: string;
        trackTimeMillis?: number;
      }>;
    }>(
      `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&country=IN&entity=song&limit=6`,
      4000
    ),
    fallbackBareQuery && fallbackBareQuery.toLowerCase() !== query.toLowerCase()
      ? fetchJsonSafe<{
          results?: Array<{
            trackName?: string;
            artistName?: string;
            collectionName?: string;
            trackTimeMillis?: number;
          }>;
        }>(
          `https://itunes.apple.com/search?term=${encodeURIComponent(fallbackBareQuery)}&entity=song&limit=5`,
          4000
        )
      : Promise.resolve(null),
    fetchJsonSafe<{
      data?: Array<{
        title?: string;
        title_short?: string;
        duration?: number;
        album?: { title?: string };
        artist?: { name?: string };
      }>;
    }>(`https://api.lyrics.ovh/suggest/${encodeURIComponent(query)}`, 4000),
  ]);

  const scored: Array<{ score: number; cand: SearchCandidate }> = [];
  const seen = new Set<string>();

  const consider = (
    rawTrackName?: string,
    rawArtistName?: string,
    albumName?: string,
    itemDurSec?: number
  ) => {
    const title = stripJunkMarkers(rawTrackName || '');
    const artist = getPrimaryArtist((rawArtistName || '').trim());
    if (!title || !artist) return;

    if (
      isSpecialVariantMismatch(
        { trackName: rawTrackName, albumName },
        ctx.rawTitle
      )
    ) {
      return;
    }

    const artistCheck = getArtistMatchStrength(rawArtistName, ctx);
    const albumMatch = hasAlbumHintMatch(albumName, ctx);

    const matchesPrimary =
      hasStrictTitleMatch(title, ctx.primaryTitle) ||
      ((artistCheck.matched || albumMatch) && hasPrefixTitleMatch(title, ctx.primaryTitle));
    const matchesSecondPart =
      ctx.albumHints.length > 0 && hasStrictTitleMatch(title, ctx.albumHints[0]);

    if (!matchesPrimary && !matchesSecondPart) return;

    if (!matchesPrimary && matchesSecondPart) {
      const leftWords = new Set(tokenizeArtistWords(ctx.primaryTitle));
      const itemArtistWords = tokenizeArtistWords(rawArtistName || '');
      if (!itemArtistWords.some((w) => leftWords.has(w))) return;
    }

    if (ctx.dur > 25 && itemDurSec && itemDurSec > 0) {
      if (Math.abs(itemDurSec - ctx.dur) > 55) return;
    }

    if (!artistCheck.matched && !albumMatch) {
      const tightDur = ctx.dur > 25 && itemDurSec && Math.abs(itemDurSec - ctx.dur) <= 6;
      if (ctx.hasStrongArtistHint || ctx.channelArtist || !tightDur) {
        return;
      }
    }

    if (
      !ctx.hasStrongArtistHint &&
      !albumMatch &&
      (!ctx.dur || !itemDurSec) &&
      tokenizeWords(cleanTitleForCompare(title)).length <= 1
    ) {
      return;
    }

    let score = matchesPrimary ? 40 : 25;
    if (artistCheck.matched) score += artistCheck.scoreBonus;
    if (albumMatch) score += 30;
    if (ctx.dur > 20 && itemDurSec && itemDurSec > 0) {
      const diff = Math.abs(itemDurSec - ctx.dur);
      if (diff <= 6) score += 30;
      else if (diff <= 15) score += 16;
    }

    const key = `${title.toLowerCase()}::${artist.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      scored.push({
        score,
        cand: {
          title,
          artist,
          expectedTitle: title,
          albumHint: albumName,
          isCanonical: true,
        },
      });
    }
  };

  for (const r of [...(itunesIn?.results ?? []), ...(itunesUs?.results ?? [])]) {
    const sec = r.trackTimeMillis ? Math.round(r.trackTimeMillis / 1000) : 0;
    consider(r.trackName, r.artistName, r.collectionName, sec);
  }
  for (const item of (ovhSuggest?.data ?? []).slice(0, 5)) {
    consider(
      item.title_short || item.title,
      item.artist?.name,
      item.album?.title,
      item.duration || 0
    );
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 4).map((s) => s.cand);
}

async function fetchFromLyricsOvh(
  candidates: SearchCandidate[],
  ctx: TrackSearchContext
): Promise<LyricsResponse | null> {
  // Strictly allow only canonical (iTunes/Deezer verified) OR confirmed singer/channel candidates
  const valid = candidates
    .filter((c) => {
      if (!c.title || !c.artist) return false;
      if (c.requireArtistTokenMatch) return false;
      if (isAbbreviatedPersonName(c.artist)) return false;
      if (c.isCanonical) return true;
      const artistLower = c.artist.toLowerCase();
      return (
        artistLower === ctx.channelArtist.toLowerCase() ||
        ctx.allArtistHints.some((h) => h.toLowerCase() === artistLower)
      );
    })
    .slice(0, 3);

  if (valid.length === 0) return null;

  for (const cand of valid) {
    const primaryArtist = getPrimaryArtist(cand.artist);
    const artistStrength = getArtistMatchStrength(primaryArtist, ctx);
    const expectedTitle = cand.expectedTitle || ctx.primaryTitle;
    const strictTitleMatched = hasStrictTitleMatch(cand.title, expectedTitle);

    const data = await fetchJsonSafe<{ lyrics?: string; error?: string }>(
      `https://api.lyrics.ovh/v1/${encodeURIComponent(primaryArtist)}/${encodeURIComponent(cand.title)}`,
      5000
    );
    const cleanedOvh = (data?.lyrics || '')
      .replace(/^paroles de la chanson[^\n]*\n+/i, '')
      .trim();
    const plain = cleanPlainLyricsText(cleanedOvh);
    if (!plain || plain.length < 60 || plain.split('\n').length < 4) continue;

    // For fuzzy/weakly matched artist or title candidates, require title words to appear in Latin lyrics.
    // Verified exact artist+title matches (e.g., Punjabi songs with English titles like "Shubh - Never Left")
    // are trusted because their Romanized lyrics don't repeat the English title word.
    const isVerifiedArtistAndTitle =
      (cand.isCanonical || artistStrength.exact) &&
      artistStrength.matched &&
      strictTitleMatched;

    if (!isVerifiedArtistAndTitle && !NON_LATIN_SCRIPT_RE.test(plain)) {
      const expWords = tokenizeWords(cleanTitleForCompare(cand.title)).filter((w) => w.length >= 2);
      if (expWords.length >= 2) {
        const sampleNormalized = tokenizeWords(plain).join(' ');
        const titlePhrase = expWords.join(' ');
        const distinctiveWords = expWords.filter((w) => w.length >= 4);
        const hasPhrase = sampleNormalized.includes(titlePhrase);
        const distinctiveHits = distinctiveWords.filter((w) => sampleNormalized.includes(w)).length;
        if (!hasPhrase && distinctiveWords.length > 0 && distinctiveHits === 0) {
          continue;
        }
      }
    }

    return {
      found: true,
      trackName: cand.title,
      artistName: primaryArtist,
      syncedLines: [],
      plainLyrics: NON_LATIN_SCRIPT_RE.test(plain) ? plain : formatPlainLyricsLocally(plain),
      source: 'Lyrics.ovh',
    };
  }
  return null;
}

export async function fetchTrackLyrics(params: {
  title: string;
  artist?: string;
  durationSeconds?: number;
  forceAi?: boolean;
}): Promise<LyricsResponse> {
  const dur =
    Number.isFinite(params.durationSeconds) && (params.durationSeconds ?? 0) > 0
      ? Math.round(params.durationSeconds!)
      : 0;
  const forceAi = Boolean(params.forceAi);

  const ctx = buildTrackContext(params.title, params.artist || '', dur);
  const searchTitle = ctx.primaryTitle || params.title.trim();
  const searchArtist =
    ctx.allArtistHints.find((a) => !isAbbreviatedPersonName(a)) ||
    ctx.channelArtist ||
    ctx.allArtistHints[0] ||
    '';

  if (!searchTitle) {
    return { found: false, syncedLines: [], plainLyrics: null };
  }

  const rawKey = normalizeLatin(`${params.title.trim()}::${(params.artist || '').trim()}`).toLowerCase();
  const cacheKey = `v5::${forceAi ? 'ai' : 'std'}::${rawKey}::${dur}`;
  const cached = lyricsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const pending = lyricsInFlight.get(cacheKey);
  if (pending) return pending;

  const job = (async (): Promise<LyricsResponse> => {
    if (forceAi && hasConfiguredGeminiKeys()) {
      try {
        const aiResult = await findAndFormatLyricsWithAi({
          title: searchTitle,
          artist: searchArtist,
          rawContext: `${ctx.rawTitle}${ctx.rawArtist ? ` · ${ctx.rawArtist}` : ''}`,
        });
        if (aiResult.found && aiResult.plainLyrics) {
          return {
            found: true,
            trackName: searchTitle,
            artistName: searchArtist || undefined,
            syncedLines: [],
            plainLyrics: aiResult.plainLyrics,
            source: aiResult.source,
            aiEnhanced: true,
          };
        }
      } catch {
        // Fall through to standard sources if AI fails
      }
    }

    // 1. LRCLIB search with strict title + artist + duration validation
    const lrcHit = await queryLrclibCandidates(ctx.candidates, ctx);
    if (lrcHit?.found) {
      return autoBeautifyLyrics(
        lrcHit,
        lrcHit.trackName || searchTitle,
        lrcHit.artistName || searchArtist
      );
    }

    // 2. Canonical catalog lookup (iTunes IN + US + Deezer/Lyrics.ovh Suggest) with validation
    const canonicalCandidates = await resolveCanonicalSongMetadata(ctx);
    const mergedCandidates = [...canonicalCandidates, ...ctx.candidates];

    if (canonicalCandidates.length > 0) {
      const canonicalLrcHit = await queryLrclibCandidates(canonicalCandidates, ctx);
      if (canonicalLrcHit?.found) {
        return autoBeautifyLyrics(
          canonicalLrcHit,
          canonicalLrcHit.trackName || canonicalCandidates[0].title,
          canonicalLrcHit.artistName || canonicalCandidates[0].artist
        );
      }
    }

    // 3. Lyrics.ovh fallback with verified canonical & artist pairs only
    const ovhHit = await fetchFromLyricsOvh(mergedCandidates, ctx);
    if (ovhHit?.found) {
      return autoBeautifyLyrics(
        ovhHit,
        ovhHit.trackName || searchTitle,
        ovhHit.artistName || searchArtist
      );
    }

    // 4. Google Search grounded Gemini AI lookup (never ungrounded memory hallucination)
    if (hasAvailableGeminiKey()) {
      const bestCand = canonicalCandidates[0] || ctx.candidates[0];
      try {
        const aiResult = await findAndFormatLyricsWithAi({
          title: bestCand?.title || searchTitle,
          artist: bestCand?.artist || searchArtist,
          rawContext: `${ctx.rawTitle}${ctx.rawArtist ? ` · ${ctx.rawArtist}` : ''}`,
          timeoutMs: 6_500,
        });
        if (aiResult.found && aiResult.plainLyrics) {
          return {
            found: true,
            trackName: bestCand?.title || searchTitle,
            artistName: bestCand?.artist || searchArtist || undefined,
            syncedLines: [],
            plainLyrics: aiResult.plainLyrics,
            source: aiResult.source,
            aiEnhanced: true,
          };
        }
      } catch {
        // ignore AI fallback error and return not-found cleanly
      }
    }

    return {
      found: false,
      trackName: searchTitle,
      artistName: searchArtist || undefined,
      syncedLines: [],
      plainLyrics: null,
    };
  })()
    .then((result) => {
      if (lyricsCache.size >= 400) {
        const oldest = lyricsCache.keys().next().value;
        if (oldest !== undefined) lyricsCache.delete(oldest);
      }
      const stillNeedsTranslit =
        result.found &&
        !result.aiEnhanced &&
        hasConfiguredGeminiKeys() &&
        ((result.plainLyrics && NON_LATIN_SCRIPT_RE.test(result.plainLyrics)) ||
          result.syncedLines.some((l) => NON_LATIN_SCRIPT_RE.test(l.text)));
      const ttlMs = !result.found
        ? 45 * 1000
        : stillNeedsTranslit
          ? 90 * 1000
          : 24 * 60 * 60 * 1000;
      lyricsCache.set(cacheKey, {
        data: result,
        expiresAt: Date.now() + ttlMs,
      });
      return result;
    })
    .finally(() => {
      lyricsInFlight.delete(cacheKey);
    });

  lyricsInFlight.set(cacheKey, job);
  return job;
}
