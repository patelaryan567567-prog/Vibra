export type ArtistSongCategory =
  | 'all'
  | 'trending'
  | 'romantic'
  | 'sad'
  | 'chill'
  | 'energetic'
  | 'classics'
  | 'videos';

export interface ArtistCategoryMeta {
  id: ArtistSongCategory;
  label: string;
  shortLabel: string;
  description: string;
  querySuffix: string;
}

export const ARTIST_SONG_CATEGORIES: ArtistCategoryMeta[] = [
  {
    id: 'all',
    label: 'All Songs',
    shortLabel: 'All',
    description: 'Complete discography of popular, trending, and deep-cut songs',
    querySuffix: 'all hit songs',
  },
  {
    id: 'trending',
    label: 'Trending Hits',
    shortLabel: 'Trending',
    description: 'Biggest chartbusters and viral hits',
    querySuffix: 'top hits popular songs',
  },
  {
    id: 'romantic',
    label: 'Romantic',
    shortLabel: 'Romantic',
    description: 'Love ballads, melodies, and soulful duets',
    querySuffix: 'romantic love songs',
  },
  {
    id: 'sad',
    label: 'Sad & Heartbreak',
    shortLabel: 'Sad',
    description: 'Emotional heartbreak, judai, and late-night feelings',
    querySuffix: 'sad heartbreak emotional songs',
  },
  {
    id: 'chill',
    label: 'Chill & Lo-Fi',
    shortLabel: 'Chill',
    description: 'Unplugged, acoustic, sufi, and laid-back vibes',
    querySuffix: 'chill acoustic unplugged lofi songs',
  },
  {
    id: 'energetic',
    label: 'Party & Beats',
    shortLabel: 'Party',
    description: 'High-energy anthems, club bangers, and upbeat tracks',
    querySuffix: 'party dance upbeat energetic songs',
  },
  {
    id: 'classics',
    label: 'Evergreen Classics',
    shortLabel: 'Classics',
    description: '90s, 2000s, and timeless golden melodies',
    querySuffix: 'evergreen classic best old songs',
  },
  {
    id: 'videos',
    label: 'Music Videos',
    shortLabel: 'Videos',
    description: 'Official full HD music videos',
    querySuffix: 'official music video',
  },
];

export interface FeaturedArtistInfo {
  rank: number;
  name: string;
  tagline: string;
  primaryLanguage: 'Hindi' | 'Punjabi' | 'Urdu / Mix';
  defaultMoods: ArtistSongCategory[];
  avatarGradient: string;
  posterUrl: string;
  seedQueries: string[];
  signatureSongs: string[];
}

export const FEATURED_ARTISTS: FeaturedArtistInfo[] = [
  {
    rank: 1,
    name: 'Arijit Singh',
    tagline: 'King of Modern Romantic & Soulful Melodies',
    primaryLanguage: 'Hindi',
    defaultMoods: ['romantic', 'sad', 'chill', 'trending'],
    avatarGradient: 'from-blue-600/35 via-indigo-600/20 to-slate-900',
    posterUrl: 'https://c.saavncdn.com/artists/Arijit_Singh_004_20241118063717_500x500.jpg',
    seedQueries: [
      'Arijit Singh top hits',
      'Arijit Singh romantic songs',
      'Arijit Singh sad songs',
      'Arijit Singh unplugged chill',
    ],
    signatureSongs: ['Kesariya', 'Channa Mereya', 'Tum Hi Ho', 'Sajni', 'Apna Bana Le', 'Agar Tum Saath Ho'],
  },
  {
    rank: 2,
    name: 'Yo Yo Honey Singh',
    tagline: 'Pioneer of Desi Hip-Hop & Party Anthems',
    primaryLanguage: 'Hindi',
    defaultMoods: ['energetic', 'trending', 'classics', 'chill'],
    avatarGradient: 'from-amber-500/35 via-orange-600/20 to-slate-900',
    posterUrl: 'https://c.saavncdn.com/artists/Yo_Yo_Honey_Singh_004_20260811095253_500x500.jpg',
    seedQueries: [
      'Yo Yo Honey Singh hits',
      'Yo Yo Honey Singh party songs',
      'Yo Yo Honey Singh classic songs',
      'Honey Singh Glory Millionaire',
    ],
    signatureSongs: ['Millionaire', 'Brown Rang', 'Blue Eyes', 'Desi Kalakaar', 'Love Dose', 'Dope Shope'],
  },
  {
    rank: 3,
    name: 'Sidhu Moose Wala',
    tagline: 'Legendary Punjabi Hip-Hop & Folk Icon',
    primaryLanguage: 'Punjabi',
    defaultMoods: ['energetic', 'trending', 'sad', 'classics'],
    avatarGradient: 'from-red-600/35 via-amber-700/20 to-slate-900',
    posterUrl: 'https://c.saavncdn.com/artists/Sidhu_Moose_Wala_004_20250617183705_500x500.jpg',
    seedQueries: [
      'Sidhu Moose Wala all songs',
      'Sidhu Moose Wala top hits',
      'Sidhu Moose Wala emotional sad songs',
      'Sidhu Moose Wala energetic rap',
    ],
    signatureSongs: ['295', 'So High', 'The Last Ride', 'Same Beef', 'Levels', 'Just Listen'],
  },
  {
    rank: 4,
    name: 'Sonu Nigam',
    tagline: 'Timeless Voice of 90s & 2000s Bollywood Classics',
    primaryLanguage: 'Hindi',
    defaultMoods: ['classics', 'romantic', 'sad', 'chill'],
    avatarGradient: 'from-emerald-500/35 via-teal-600/20 to-slate-900',
    posterUrl: 'https://c.saavncdn.com/artists/Sonu_Nigam_003_20260813182013_500x500.jpg',
    seedQueries: [
      'Sonu Nigam best songs',
      'Sonu Nigam romantic hits',
      'Sonu Nigam sad songs',
      'Sonu Nigam 90s evergreen classics',
    ],
    signatureSongs: ['Kal Ho Naa Ho', 'Abhi Mujh Mein Kahin', 'Suraj Hua Maddham', 'Sandese Aate Hain', 'Saathiya'],
  },
  {
    rank: 5,
    name: 'Diljit Dosanjh',
    tagline: 'Global Punjabi Pop Superstar & Soulful Performer',
    primaryLanguage: 'Punjabi',
    defaultMoods: ['energetic', 'romantic', 'trending', 'chill'],
    avatarGradient: 'from-violet-600/35 via-fuchsia-600/20 to-slate-900',
    posterUrl: 'https://c.saavncdn.com/artists/Diljit_Dosanjh_005_20231025073054_500x500.jpg',
    seedQueries: [
      'Diljit Dosanjh top songs',
      'Diljit Dosanjh romantic songs',
      'Diljit Dosanjh party bhangra',
      'Diljit Dosanjh sad songs',
    ],
    signatureSongs: ['Lover', 'G.O.A.T.', 'Born to Shine', 'Hass Hass', 'Do You Know', 'Naina'],
  },
  {
    rank: 6,
    name: 'Armaan Malik',
    tagline: 'Smooth Pop Ballads, Romance & Acoustic Chill',
    primaryLanguage: 'Hindi',
    defaultMoods: ['romantic', 'chill', 'sad', 'trending'],
    avatarGradient: 'from-sky-500/35 via-blue-600/20 to-slate-900',
    posterUrl: 'https://c.saavncdn.com/artists/Armaan_Malik_006_20260813132832_500x500.jpg',
    seedQueries: [
      'Armaan Malik best songs',
      'Armaan Malik romantic hits',
      'Armaan Malik sad songs',
      'Armaan Malik acoustic chill',
    ],
    signatureSongs: ['Bol Do Na Zara', 'Butta Bomma', 'Jab Tak', 'Chale Aana', 'Wajah Tum Ho', 'Main Rahoon Ya Na Rahoon'],
  },
  {
    rank: 7,
    name: 'Jubin Nautiyal',
    tagline: 'Soulful Melodies, Heartbreak & Devotional Grace',
    primaryLanguage: 'Hindi',
    defaultMoods: ['romantic', 'sad', 'chill', 'trending'],
    avatarGradient: 'from-cyan-500/35 via-indigo-600/20 to-slate-900',
    posterUrl: 'https://c.saavncdn.com/artists/Jubin_Nautiyal_003_20231130204020_500x500.jpg',
    seedQueries: [
      'Jubin Nautiyal top songs',
      'Jubin Nautiyal romantic songs',
      'Jubin Nautiyal sad heartbreak songs',
      'Jubin Nautiyal chill unplugged',
    ],
    signatureSongs: ['Raataan Lambiyan', 'Lut Gaye', 'Tum Hi Aana', 'Humnava Mere', 'Tujhe Kitna Chahein Aur'],
  },
  {
    rank: 8,
    name: 'Neha Kakkar',
    tagline: 'Queen of Bollywood Party Anthems & Dance Hits',
    primaryLanguage: 'Hindi',
    defaultMoods: ['energetic', 'trending', 'romantic', 'sad'],
    avatarGradient: 'from-pink-500/35 via-rose-600/20 to-slate-900',
    posterUrl: 'https://c.saavncdn.com/artists/Neha_Kakkar_007_20241212115832_500x500.jpg',
    seedQueries: [
      'Neha Kakkar top songs',
      'Neha Kakkar party dance songs',
      'Neha Kakkar romantic songs',
      'Neha Kakkar sad songs',
    ],
    signatureSongs: ['Dilbar', 'Kala Chashma', 'Kar Gayi Chull', 'Garmi', 'Mile Ho Tum', 'Aankh Marey'],
  },
  {
    rank: 9,
    name: 'Shreya Ghoshal',
    tagline: 'Melody Queen of Classical, Romantic & Film Anthems',
    primaryLanguage: 'Hindi',
    defaultMoods: ['romantic', 'classics', 'chill', 'sad'],
    avatarGradient: 'from-purple-500/35 via-indigo-600/20 to-slate-900',
    posterUrl: 'https://c.saavncdn.com/artists/Shreya_Ghoshal_007_20241101074144_500x500.jpg',
    seedQueries: [
      'Shreya Ghoshal best songs',
      'Shreya Ghoshal romantic hits',
      'Shreya Ghoshal sad songs',
      'Shreya Ghoshal evergreen classics',
    ],
    signatureSongs: ['Teri Ore', 'Sun Raha Hai', 'Agar Tum Mil Jao', 'Deewani Mastani', 'Ve Kamleya', 'Saans'],
  },
  {
    rank: 10,
    name: 'Badshah',
    tagline: 'Chart-Topping Club Bangers, Rap & Urban Pop',
    primaryLanguage: 'Hindi',
    defaultMoods: ['energetic', 'trending', 'chill', 'romantic'],
    avatarGradient: 'from-yellow-500/35 via-amber-600/20 to-slate-900',
    posterUrl: 'https://c.saavncdn.com/artists/Badshah_006_20241118064015_500x500.jpg',
    seedQueries: [
      'Badshah top hits',
      'Badshah party club songs',
      'Badshah chill songs',
      'Badshah latest trending songs',
    ],
    signatureSongs: ['DJ Waley Babu', 'Jugnu', 'Genda Phool', 'Paani Paani', 'Abhi Toh Party Shuru Hui Hai', 'Soulmate'],
  },
  {
    rank: 11,
    name: 'Karan Aujla',
    tagline: 'Geetan Di Machine — Modern Punjabi Pop & Hip-Hop',
    primaryLanguage: 'Punjabi',
    defaultMoods: ['trending', 'energetic', 'chill', 'romantic'],
    avatarGradient: 'from-orange-500/35 via-red-600/20 to-slate-900',
    posterUrl: 'https://c.saavncdn.com/artists/Karan_Aujla_005_20260925061936_500x500.jpg',
    seedQueries: [
      'Karan Aujla top hits',
      'Karan Aujla Tauba Tauba Winning Speech',
      'Karan Aujla romantic chill songs',
      'Karan Aujla energetic punjabi songs',
    ],
    signatureSongs: ['Tauba Tauba', 'Softly', 'Winning Speech', 'White Brown Black', 'Admiring You', 'Mexico'],
  },
  {
    rank: 12,
    name: 'Alka Yagnik',
    tagline: 'Iconic 90s Queen of Evergreen Romantic & Sad Classics',
    primaryLanguage: 'Hindi',
    defaultMoods: ['classics', 'romantic', 'sad', 'trending'],
    avatarGradient: 'from-rose-500/35 via-pink-600/20 to-slate-900',
    posterUrl: 'https://c.saavncdn.com/artists/Alka_Yagnik_002_20220314192930_500x500.jpg',
    seedQueries: [
      'Alka Yagnik best 90s songs',
      'Alka Yagnik romantic hits',
      'Alka Yagnik sad songs',
      'Alka Yagnik Agar Tum Saath Ho classics',
    ],
    signatureSongs: ['Agar Tum Saath Ho', 'Tip Tip Barsa Paani', 'Kuch Kuch Hota Hai', 'Pardesi Pardesi', 'Chura Ke Dil Mera'],
  },
  {
    rank: 13,
    name: 'Atif Aslam',
    tagline: 'Soulful Sufi Rock, Timeless Romance & Heartbreak',
    primaryLanguage: 'Urdu / Mix',
    defaultMoods: ['romantic', 'sad', 'classics', 'chill'],
    avatarGradient: 'from-indigo-500/35 via-blue-700/20 to-slate-900',
    posterUrl: 'https://cdn-images.dzcdn.net/images/artist/0ea90444148fff9c11d77f06a344724e/1000x1000-000000-80-0-0.jpg',
    seedQueries: ['Atif Aslam best songs', 'Atif Aslam romantic hits', 'Atif Aslam sad songs', 'Atif Aslam Coke Studio'],
    signatureSongs: ['Tera Hone Laga Hoon', 'Jeene Laga Hoon', 'Tu Jaane Na', 'Tajdar-e-Haram', 'Woh Lamhe', 'Dil Diyan Gallan'],
  },
  {
    rank: 14,
    name: 'Shubh',
    tagline: 'New-Wave Punjabi Hip-Hop, Street Flows & Chill Beats',
    primaryLanguage: 'Punjabi',
    defaultMoods: ['trending', 'energetic', 'chill', 'sad'],
    avatarGradient: 'from-slate-500/35 via-zinc-700/20 to-slate-900',
    posterUrl: 'https://c.saavncdn.com/artists/Shubh_000_20220921112507_500x500.jpg',
    seedQueries: ['Shubh all songs', 'Shubh Cheques Still Rollin', 'Shubh chill songs', 'Shubh energetic rap'],
    signatureSongs: ['Cheques', 'Still Rollin', 'No Love', 'Elevated', 'One Love', 'King Shit'],
  },
  {
    rank: 15,
    name: 'AP Dhillon',
    tagline: 'Punjabi R&B, Synth-Pop & Late-Night Vibes',
    primaryLanguage: 'Punjabi',
    defaultMoods: ['chill', 'energetic', 'romantic', 'trending'],
    avatarGradient: 'from-amber-600/35 via-stone-700/20 to-slate-900',
    posterUrl: 'https://c.saavncdn.com/artists/AP_Dhillon_004_20251023102150_500x500.jpg',
    seedQueries: ['AP Dhillon all songs', 'AP Dhillon Brown Munde Excuses', 'AP Dhillon romantic chill songs'],
    signatureSongs: ['Excuses', 'Brown Munde', 'With You', 'Insane', 'Summer High', 'Desires'],
  },
  {
    rank: 16,
    name: 'Anuv Jain',
    tagline: 'Indie Acoustic Storyteller & Heartfelt Lo-Fi Ballads',
    primaryLanguage: 'Hindi',
    defaultMoods: ['chill', 'sad', 'romantic', 'trending'],
    avatarGradient: 'from-teal-500/35 via-emerald-700/20 to-slate-900',
    posterUrl: 'https://c.saavncdn.com/artists/Anuv_Jain_001_20231206073013_500x500.jpg',
    seedQueries: ['Anuv Jain all songs', 'Anuv Jain Husn Jo Tum Mere Ho', 'Anuv Jain acoustic chill'],
    signatureSongs: ['Husn', 'Jo Tum Mere Ho', 'Baarishein', 'Gul', 'Alag Aasmaan', 'Riha'],
  },
  {
    rank: 17,
    name: 'KK',
    tagline: 'Forever Voice of Friendship, Nostalgia & Rock Ballads',
    primaryLanguage: 'Hindi',
    defaultMoods: ['classics', 'romantic', 'sad', 'chill'],
    avatarGradient: 'from-blue-500/35 via-cyan-700/20 to-slate-900',
    posterUrl: 'https://c.saavncdn.com/artists/KK_500x500.jpg',
    seedQueries: ['KK best songs', 'KK romantic songs', 'KK sad songs', 'KK evergreen hits'],
    signatureSongs: ['Zara Sa', 'Khuda Jaane', 'Tu Hi Meri Shab Hai', 'Tadap Tadap', 'Yaaron', 'Labon Ko'],
  },
  {
    rank: 18,
    name: 'Kumar Sanu',
    tagline: 'Golden 90s King of Romantic Bollywood Melodies',
    primaryLanguage: 'Hindi',
    defaultMoods: ['classics', 'romantic', 'sad', 'chill'],
    avatarGradient: 'from-red-500/35 via-rose-700/20 to-slate-900',
    posterUrl: 'https://c.saavncdn.com/artists/Kumar_Sanu_500x500.jpg',
    seedQueries: ['Kumar Sanu best 90s songs', 'Kumar Sanu romantic hits', 'Kumar Sanu sad songs'],
    signatureSongs: ['Tujhe Dekha To', 'Mera Dil Bhi Kitna Pagal Hai', 'Dheere Dheere Se', 'Ek Ladki Ko Dekha'],
  },
  {
    rank: 19,
    name: 'Udit Narayan',
    tagline: 'Evergreen Voice of 90s & 2000s Bollywood Romance',
    primaryLanguage: 'Hindi',
    defaultMoods: ['classics', 'romantic', 'energetic', 'sad'],
    avatarGradient: 'from-amber-500/35 via-yellow-700/20 to-slate-900',
    posterUrl: 'https://c.saavncdn.com/artists/Udit_Narayan_004_20241029065120_500x500.jpg',
    seedQueries: ['Udit Narayan best songs', 'Udit Narayan 90s romantic songs', 'Udit Narayan evergreen classics'],
    signatureSongs: ['Pehla Nasha', 'Main Nikla Gaddi Leke', 'Tip Tip Barsa Paani', 'Dil Ne Yeh Kaha Hai Dil Se'],
  },
  {
    rank: 20,
    name: 'B Praak',
    tagline: 'Powerhouse of Deep Heartbreak & Emotional Anthems',
    primaryLanguage: 'Punjabi',
    defaultMoods: ['sad', 'romantic', 'trending', 'chill'],
    avatarGradient: 'from-indigo-600/35 via-slate-700/20 to-slate-900',
    posterUrl: 'https://c.saavncdn.com/artists/B_Praak_001_20191118112005_500x500.jpg',
    seedQueries: ['B Praak all songs', 'B Praak sad heartbreak songs', 'B Praak Teri Mitti Mann Bharryaa'],
    signatureSongs: ['Mann Bharryaa', 'Filhall', 'Teri Mitti', 'Qismat', 'Kya Loge Tum', 'Raanjhan'],
  },
  {
    rank: 21,
    name: 'Vishal Mishra',
    tagline: 'Soul-Stirring Modern Cinema Ballads & Romance',
    primaryLanguage: 'Hindi',
    defaultMoods: ['romantic', 'sad', 'trending', 'chill'],
    avatarGradient: 'from-purple-600/35 via-pink-700/20 to-slate-900',
    posterUrl: 'https://c.saavncdn.com/artists/Vishal_Mishra_005_20251120085316_500x500.jpg',
    seedQueries: ['Vishal Mishra best songs', 'Vishal Mishra Pehle Bhi Main', 'Vishal Mishra sad romantic songs'],
    signatureSongs: ['Pehle Bhi Main', 'Kaise Hua', 'Jaan Ban Gaye', 'Zihaal e Miskin', 'Manjha'],
  },
  {
    rank: 22,
    name: 'Darshan Raval',
    tagline: 'Heartfelt Indie Pop, Monsoon Romance & Sad Melodies',
    primaryLanguage: 'Hindi',
    defaultMoods: ['romantic', 'sad', 'chill', 'energetic'],
    avatarGradient: 'from-sky-500/35 via-indigo-700/20 to-slate-900',
    posterUrl: 'https://c.saavncdn.com/artists/Darshan_Raval_006_20250807060352_500x500.jpg',
    seedQueries: ['Darshan Raval best songs', 'Darshan Raval romantic songs', 'Darshan Raval sad songs'],
    signatureSongs: ['Tera Zikr', 'Chogada', 'Mahiye Jinna Sohna', 'Ek Tarfa', 'Bhula Dunga', 'Asal Mein'],
  },
  {
    rank: 23,
    name: 'Sunidhi Chauhan',
    tagline: 'High-Voltage Dance Anthems & Versatile Vocals',
    primaryLanguage: 'Hindi',
    defaultMoods: ['energetic', 'classics', 'romantic', 'trending'],
    avatarGradient: 'from-fuchsia-500/35 via-rose-700/20 to-slate-900',
    posterUrl: 'https://c.saavncdn.com/artists/Sunidhi_Chauhan_005_20250515061617_500x500.jpg',
    seedQueries: ['Sunidhi Chauhan best songs', 'Sunidhi Chauhan dance party songs', 'Sunidhi Chauhan romantic songs'],
    signatureSongs: ['Sheila Ki Jawani', 'Beedi', 'Kamli', 'Desi Girl', 'Sajna Ve Sajna', 'Dhoom Machale'],
  },
  {
    rank: 24,
    name: 'Rahat Fateh Ali Khan',
    tagline: 'Sufi Maestro of Qawwali, Romance & Heartbreak',
    primaryLanguage: 'Urdu / Mix',
    defaultMoods: ['sad', 'romantic', 'classics', 'chill'],
    avatarGradient: 'from-emerald-600/35 via-cyan-800/20 to-slate-900',
    posterUrl: 'https://cdn-images.dzcdn.net/images/artist/8263c6e6e75baf8387ad258459021f78/1000x1000-000000-80-0-0.jpg',
    seedQueries: ['Rahat Fateh Ali Khan best songs', 'Rahat Fateh Ali Khan romantic sad songs', 'Rahat Sufi hits'],
    signatureSongs: ['Afreen Afreen', 'O Re Piya', 'Zaroori Tha', 'Teri Meri', 'Jag Soona Soona Lage', 'Tumhe Dillagi'],
  },
  {
    rank: 25,
    name: 'King',
    tagline: 'Modern Pop Hooksmith & Viral Romantic Anthems',
    primaryLanguage: 'Hindi',
    defaultMoods: ['trending', 'romantic', 'chill', 'energetic'],
    avatarGradient: 'from-amber-500/35 via-red-700/20 to-slate-900',
    posterUrl: 'https://c.saavncdn.com/artists/King_004_20240819092014_500x500.jpg',
    seedQueries: ['King Rocco all songs', 'King Maan Meri Jaan Tu Aake Dekhle', 'King chill romantic songs'],
    signatureSongs: ['Maan Meri Jaan', 'Tu Aake Dekhle', 'Oops', 'Ilzaam', 'Sinner'],
  },
  {
    rank: 26,
    name: 'Talha Anjum',
    tagline: 'Poetic Urdu Hip-Hop, Melancholic Flows & Lyrical Rap',
    primaryLanguage: 'Urdu / Mix',
    defaultMoods: ['chill', 'sad', 'energetic', 'trending'],
    avatarGradient: 'from-zinc-500/35 via-slate-700/20 to-slate-900',
    posterUrl: 'https://cdn-images.dzcdn.net/images/artist/380e0c7629f94b9c75b7745a8990073a/1000x1000-000000-80-0-0.jpg',
    seedQueries: ['Talha Anjum all songs', 'Talha Anjum Downers At Dusk Gumaan', 'Young Stunners Talha Anjum'],
    signatureSongs: ['Downers At Dusk', 'Gumaan', 'Afsanay', 'Kaun Talha', 'Desperation', 'Why Not Meri Jaan'],
  },
  {
    rank: 27,
    name: 'Mohit Chauhan',
    tagline: 'Breezy Acoustic Romance, Travel & Sufi Indie Classics',
    primaryLanguage: 'Hindi',
    defaultMoods: ['chill', 'romantic', 'classics', 'sad'],
    avatarGradient: 'from-teal-600/35 via-blue-800/20 to-slate-900',
    posterUrl: 'https://c.saavncdn.com/artists/Mohit_Chauhan_500x500.jpg',
    seedQueries: ['Mohit Chauhan best songs', 'Mohit Chauhan Rockstar Kun Faya Kun', 'Mohit Chauhan romantic chill'],
    signatureSongs: ['Tum Se Hi', 'Kun Faya Kun', 'Pee Loon', 'Ilahi', 'Masakali', 'Phir Se Ud Chala'],
  },
  {
    rank: 28,
    name: 'Pritam',
    tagline: 'Hitmaker Composer Behind Bollywood’s Biggest Soundtracks',
    primaryLanguage: 'Hindi',
    defaultMoods: ['trending', 'romantic', 'energetic', 'sad'],
    avatarGradient: 'from-indigo-500/35 via-purple-700/20 to-slate-900',
    posterUrl: 'https://c.saavncdn.com/artists/Pritam_Chakraborty-20170711073326_500x500.jpg',
    seedQueries: ['Pritam best songs', 'Pritam romantic hits', 'Pritam party songs', 'Pritam sad songs'],
    signatureSongs: ['Kesariya', 'Ae Dil Hai Mushkil', 'Shayad', 'Badtameez Dil', 'Subhanallah', 'Kabira'],
  },
];

const SAD_RE =
  /\b(sad|heartbreak|dard|bewafa|judai|tanhai|rona|tears|broken|khoya|alvida|channa\s*mereya|agar\s*tum\s*saath|tum\s*hi\s*aana|lut\s*gaye|pachtaoge|filhall|qismat|mann\s*bharryaa|kya\s*loge\s*tum|tadap\s*tadap|abhi\s*mujh\s*mein|kal\s*ho\s*naa\s*ho|bhula\s*dunga|ek\s*tarfa|zaroori\s*tha|jag\s*soona|tu\s*jaane\s*na|woh\s*lamhe|295|the\s*last\s*ride|no\s*love|gumaan|downers\s*at\s*dusk|husn|baarishein|chale\s*aana|main\s*rahoon|pehle\s*bhi\s*main|raanjhan|bedardeya|hamari\s*adhuri|ae\s*dil\s*hai\s*mushkil|bekhayali|kabira|shayad|phir\s*bhi\s*tumko|khairiyat|tujhe\s*kitna\s*chahein|kalank|muskurane|hawayein|thodi\s*jagah|bandeya|naina|lo\s*maan\s*liya|sanam\s*teri\s*kasam|aayat|laal\s*ishq|fitoor|binte\s*dil|dua|judaai|phir\s*le\s*aya\s*dil| Milne\s*Hai\s*Mujhse\s*Aayi|chahun\s*main\s*ya\s*naa|bulleya)\b/i;

const ENERGETIC_RE =
  /\b(party|dance|club|banger|dj|remix|beat|rap|hip\s*hop|bhangra|workout|millionaire|brown\s*rang|blue\s*eyes|desi\s*kalakaar|dope\s*shope|angrezi\s*beat|lungi\s*dance|so\s*high|same\s*beef|levels|goat|g\.o\.a\.t|born\s*to\s*shine|tauba\s*tauba|winning\s*speech|softly|white\s*brown\s*black|cheques|still\s*rollin|elevated|brown\s*munde|kala\s*chashma|dilbar|garmi|aankh\s*marey|kar\s*gayi\s*chull|jugnu|genda\s*phool|paani\s*paani|dj\s*waley\s*babu|sheila|beedi|kamli|dhoom|badtameez\s*dil|chogada|ghungroo|jhoome\s*jo\s*pathaan|nashe\s*si\s*chadh\s*gayi|sooraj\s*dooba\s*hain|dilliwaali\s*girlfriend|galat\s*baat\s*hai|first\s*class|palat|shanivaar\s*raati|tukur\s*tukur|ullu\s*ka\s*pattha|galti\s*se\s*mistake|chaleya|besharam\s*rang|what\s*jhumka|lenge|balam\s*pichkari)\b/i;

const CHILL_RE =
  /\b(chill|lofi|lo-fi|unplugged|acoustic|slowed|reverb|sufi|indie|coke\s*studio|mtv\s*unplugged|kun\s*faya\s*kun|ilahi|masakali|jo\s*tum\s*mere\s*ho|gul|alag\s*aasmaan|afreen|tajdar|pasoori|jhol|iraaday|waalian|with\s*you|summer\s*high|excuses|one\s*love|soulmate|hass\s*hass|naina|tu\s*aake\s*dekhle|mast\s*magan|kabira|safar|qaafirana|raabta|samjhawan|ilahi|phir\s*se\s*ud\s*chala|mitwa|ikhlaas|khamoshiyan|saware|enat|bairiya|tere\s*hawale|apna\s*bana\s*le|heeriye|satranga|ve\s*kamleya)\b/i;

const CLASSICS_RE =
  /\b(90s|evergreen|classic|old|golden|retro|199\d|200[0-9]|201[0-4]|tip\s*tip\s*barsa|kuch\s*kuch\s*hota\s*hai|pardesi\s*pardesi|chura\s*ke\s*dil|tujhe\s*dekha\s*to|dheere\s*dheere\s*se|mera\s*dil\s*bhi|pehla\s*nasha|suraj\s*hua\s*maddham|sandese\s*aate|kal\s*ho\s*naa\s*ho|saathiya|yaaron|tadap\s*tadap|tu\s*hi\s*meri\s*shab|zara\s*sa|tere\s*naam|agar\s*tum\s*mil\s*jao|teri\s*ore|beedi|tum\s*hi\s*ho|aashiqui\s*2|kabhi\s*jo\s*baadal|suno\s*na\s*sangemarmar|mast\s*magan|raabta|dua|phir\s*mohabbat)\b/i;

const ROMANTIC_RE =
  /\b(love|romantic|ishq|pyar|pyaar|dil|sanam|jaan|mohabbat|aashiqui|sajni|kesariya|tum\s*hi\s*ho|apna\s*bana\s*le|raataan\s*lambiyan|humnava|tujhe\s*kitna\s*chahein|bol\s*do\s*na\s*zara|jab\s*tak|wajah\s*tum\s*ho|lover|do\s*you\s*know|mile\s*ho\s*tum|ve\s*kamleya|teri\s*ore|deewani\s*mastani|saans|admiring\s*you|tera\s*hone\s*laga|jeene\s*laga|dil\s*diyan\s*gallan|khuda\s*jaane|labon\s*ko|tera\s*zikr|mahiye\s*jinna|maan\s*meri\s*jaan|tum\s*se\s*hi|pee\s*loon|subhanallah|o\s*maahi|heeriye|shayad|chaleya|satranga|tere\s*hawale|zaalima|gerua|janam\s*janam|mareez\s*e\s*ishq|pal)\b/i;

export function classifyArtistTrackCategories(
  title: string,
  artist: string,
  indexInList = 0
): ArtistSongCategory[] {
  const hay = `${title} ${artist}`.toLowerCase();
  const categories = new Set<ArtistSongCategory>(['all']);

  if (indexInList < 20) {
    categories.add('trending');
  }
  if (SAD_RE.test(hay)) {
    categories.add('sad');
  }
  if (ENERGETIC_RE.test(hay)) {
    categories.add('energetic');
  }
  if (CHILL_RE.test(hay)) {
    categories.add('chill');
  }
  if (CLASSICS_RE.test(hay)) {
    categories.add('classics');
  }
  if (ROMANTIC_RE.test(hay)) {
    categories.add('romantic');
  }

  // If a track didn't match an explicit mood keyword, distribute intelligently across the singer's signature moods
  if (
    !categories.has('sad') &&
    !categories.has('energetic') &&
    !categories.has('chill') &&
    !categories.has('classics') &&
    !categories.has('romantic')
  ) {
    const artistLower = artist.toLowerCase();
    if (
      /honey\s*singh|badshah|sidhu\s*moose|karan\s*aujla|shubh|neha\s*kakkar|sunidhi/.test(
        artistLower
      )
    ) {
      categories.add('energetic');
      if (indexInList % 3 === 1) categories.add('chill');
      if (indexInList % 4 === 2) categories.add('romantic');
    } else if (/alka\s*yagnik|kumar\s*sanu|udit\s*narayan|sonu\s*nigam|kk\b/.test(artistLower)) {
      categories.add('classics');
      categories.add(indexInList % 3 === 0 ? 'sad' : 'romantic');
    } else if (/anuv\s*jain|talha\s*anjum|ap\s*dhillon|mohit\s*chauhan/.test(artistLower)) {
      categories.add('chill');
      categories.add(indexInList % 2 === 0 ? 'romantic' : 'sad');
    } else if (/b\s*praak/.test(artistLower)) {
      categories.add('sad');
      if (indexInList % 2 === 0) categories.add('romantic');
    } else {
      // Versatile singers (Arijit Singh, Shreya Ghoshal, Jubin Nautiyal, Armaan Malik, Atif Aslam, etc.)
      categories.add('romantic');
      const mod = indexInList % 5;
      if (mod === 1) categories.add('sad');
      else if (mod === 2) categories.add('chill');
      else if (mod === 3) categories.add('classics');
      else if (mod === 4) categories.add('energetic');
    }
  }

  return Array.from(categories);
}

export function findFeaturedArtist(name: string): FeaturedArtistInfo | undefined {
  const clean = name.trim().toLowerCase();
  if (!clean) return undefined;
  return FEATURED_ARTISTS.find(
    (a) =>
      a.name.toLowerCase() === clean ||
      clean.includes(a.name.toLowerCase()) ||
      a.name.toLowerCase().includes(clean)
  );
}
