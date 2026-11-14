import type { CategoryId, IndiaLanguageFilter } from '../types/music';
import heroStudioImg from '../assets/images/hero_vibra_studio_1794628543170.jpg';
import moodTrendingImg from '../assets/images/mood_trending_now_1794628541996.jpg';
import moodEnergeticImg from '../assets/images/mood_energetic_vibes_1794628542257.jpg';
import moodSadImg from '../assets/images/mood_sad_emotional_1794628542169.jpg';
import moodDiscoverImg from '../assets/images/mood_discover_more_1794628543262.jpg';

export interface CategoryMeta {
  id: CategoryId;
  title: string;
  subtitle: string;
  coverImage: string;
  accentClass: string;
  subFilters?: string[];
}

export const HERO_BANNER_IMAGE = heroStudioImg;

export const INDIA_LANGUAGE_OPTIONS: Array<{
  id: IndiaLanguageFilter;
  label: string;
  description: string;
}> = [
  { id: 'all', label: 'All India', description: 'Hindi, Punjabi, Urdu Mix & English' },
  { id: 'hindi', label: 'Hindi', description: 'Bollywood, Indie & Hindi Acoustic' },
  { id: 'punjabi', label: 'Punjabi', description: 'Punjabi Rap, Pop & Viral Beats' },
  { id: 'mix', label: 'Mix', description: 'Hindi-Urdu Mashups, Lo-Fi & Reels Mix' },
  { id: 'english', label: 'English', description: 'Global Pop, R&B & Top Charts' },
];

export const DISCOVERY_CATEGORIES: CategoryMeta[] = [
  {
    id: 'trending',
    title: 'Trending Now 🔥',
    subtitle: 'Viral Hindi & Hindi-Urdu hits blowing up on Instagram Reels, Shorts, and India charts right now.',
    coverImage: moodTrendingImg,
    accentClass: 'from-amber-500/20 via-violet-500/10 to-transparent',
  },
  {
    id: 'energetic',
    title: 'Energetic Vibes ⚡',
    subtitle: 'High-energy Punjabi rap, Desi hip-hop, Hindi gym & party mixes, and upbeat beats.',
    coverImage: moodEnergeticImg,
    accentClass: 'from-[#4F6BFF]/20 via-indigo-500/10 to-transparent',
  },
  {
    id: 'sad',
    title: 'Sad & Emotional 💔',
    subtitle: 'Heartbreak ballads, slow acoustic sessions, and deep emotional melodies.',
    coverImage: moodSadImg,
    accentClass: 'from-slate-400/15 via-violet-500/10 to-transparent',
  },
  {
    id: 'discover',
    title: 'Discover More 🎧',
    subtitle: 'Romantic, chill lo-fi mixes, relaxing acoustic, devotional, and instrumental worlds.',
    coverImage: moodDiscoverImg,
    accentClass: 'from-emerald-500/15 via-sky-500/10 to-transparent',
    subFilters: ['All', 'Romantic', 'Chill Lo-Fi', 'Relaxing', 'Devotional', 'Instrumental'],
  },
];

export const REGION_OPTIONS = [
  { code: 'IN', label: 'India (Hindi, Punjabi, Mix & English)' },
  { code: 'US', label: 'Global / US' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'JP', label: 'Japan' },
  { code: 'KR', label: 'South Korea' },
  { code: 'BR', label: 'Brazil' },
];

export const AI_STARTER_PROMPTS = [
  'Play trending Punjabi rap & Hindi Reels songs.',
  'Suggest Hindi-Urdu lo-fi songs for studying.',
  'I want emotional Hindi & Urdu heartbreak songs.',
  'Give me songs like Arijit Singh & Shubh.',
  'Suggest powerful Punjabi rap & Bollywood gym music.',
  'Find viral English & Hindi mashup hits in India.',
];

export const TRENDING_SEARCH_KEYWORDS = [
  'Viral Reels Punjabi rap songs',
  'Hindi Urdu mix trending Shorts',
  'Arijit Singh unplugged mix',
  'Karan Aujla Shubh Punjabi rap',
  'Hindi lofi chill study beats',
  'Bollywood party mashup 2026',
  'Trending English pop hits India',
  'Urdu acoustic soulful ghazal mix',
];
