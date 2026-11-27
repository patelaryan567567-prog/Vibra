/* VIBRA 4G — Native ES5 Engine for JioPhone F220B (KaiOS 2.5 / Gecko 48 / QVGA 240x320) */
(function () {
  if (window.__VIBRA_JIO_F220B_ACTIVE__) return;
  window.__VIBRA_JIO_F220B_ACTIVE__ = true;

  var FAV_KEY = 'vibra_favourites_v1';
  var RECENT_KEY = 'vibra_recent_v1';

  var SINGERS = [
    { rank: 1, name: 'Arijit Singh', lang: 'Hindi', tag: 'Romantic & Soulful', poster: 'https://c.saavncdn.com/artists/Arijit_Singh_004_20241118063717_500x500.jpg' },
    { rank: 2, name: 'Yo Yo Honey Singh', lang: 'Punjabi/Hindi', tag: 'Party & Desi Hip-Hop', poster: 'https://c.saavncdn.com/artists/Yo_Yo_Honey_Singh_002_20221216102650_500x500.jpg' },
    { rank: 3, name: 'Sidhu Moose Wala', lang: 'Punjabi', tag: 'Punjabi Hip-Hop Legend', poster: 'https://c.saavncdn.com/artists/Sidhu_Moose_Wala_20190627113342_500x500.jpg' },
    { rank: 4, name: 'Sonu Nigam', lang: 'Hindi', tag: 'Evergreen Melodies', poster: 'https://c.saavncdn.com/artists/Sonu_Nigam_500x500.jpg' },
    { rank: 5, name: 'Diljit Dosanjh', lang: 'Punjabi/Hindi', tag: 'Punjabi Pop & Vibe', poster: 'https://c.saavncdn.com/artists/Diljit_Dosanjh_005_20231025073054_500x500.jpg' },
    { rank: 6, name: 'Armaan Malik', lang: 'Hindi', tag: 'Soft Pop & Love', poster: 'https://c.saavncdn.com/artists/Armaan_Malik_004_20231026182653_500x500.jpg' },
    { rank: 7, name: 'Jubin Nautiyal', lang: 'Hindi', tag: 'Soulful Ballads', poster: 'https://c.saavncdn.com/artists/Jubin_Nautiyal_002_20180507091834_500x500.jpg' },
    { rank: 8, name: 'Neha Kakkar', lang: 'Hindi', tag: 'Dance & Chartbusters', poster: 'https://c.saavncdn.com/artists/Neha_Kakkar_006_20200822042626_500x500.jpg' },
    { rank: 9, name: 'Shreya Ghoshal', lang: 'Hindi', tag: 'Queen of Melody', poster: 'https://c.saavncdn.com/artists/Shreya_Ghoshal_007_20241101074144_500x500.jpg' },
    { rank: 10, name: 'Badshah', lang: 'Hindi/Punjabi', tag: 'Club Anthems & Rap', poster: 'https://c.saavncdn.com/artists/Badshah_005_20230608084021_500x500.jpg' },
    { rank: 11, name: 'Karan Aujla', lang: 'Punjabi', tag: 'Trending Punjabi Hits', poster: 'https://c.saavncdn.com/artists/Karan_Aujla_001_20240118064106_500x500.jpg' },
    { rank: 12, name: 'Alka Yagnik', lang: 'Hindi', tag: '90s Golden Classics', poster: 'https://c.saavncdn.com/artists/Alka_Yagnik_002_20220314092630_500x500.jpg' },
    { rank: 13, name: 'Atif Aslam', lang: 'Hindi', tag: 'Romantic & Sufi', poster: 'https://c.saavncdn.com/artists/Atif_Aslam_500x500.jpg' },
    { rank: 14, name: 'Kumar Sanu', lang: 'Hindi', tag: '90s King of Romance', poster: 'https://c.saavncdn.com/artists/Kumar_Sanu_500x500.jpg' },
    { rank: 15, name: 'Udit Narayan', lang: 'Hindi', tag: '90s Evergreen Voice', poster: 'https://c.saavncdn.com/artists/Udit_Narayan_500x500.jpg' },
    { rank: 16, name: 'Kishore Kumar', lang: 'Hindi', tag: 'Golden Era Legend', poster: 'https://c.saavncdn.com/artists/Kishore_Kumar_500x500.jpg' },
    { rank: 17, name: 'Lata Mangeshkar', lang: 'Hindi', tag: 'Nightingale of India', poster: 'https://c.saavncdn.com/artists/Lata_Mangeshkar_004_20230623105323_500x500.jpg' },
    { rank: 18, name: 'Rahat Fateh Ali Khan', lang: 'Hindi', tag: 'Sufi & Qawwali', poster: 'https://c.saavncdn.com/artists/Rahat_Fateh_Ali_Khan_500x500.jpg' },
    { rank: 19, name: 'KK', lang: 'Hindi', tag: 'Pop & Soul Legend', poster: 'https://c.saavncdn.com/artists/KK_500x500.jpg' },
    { rank: 20, name: 'Mohit Chauhan', lang: 'Hindi', tag: 'Indie & Acoustic', poster: 'https://c.saavncdn.com/artists/Mohit_Chauhan_500x500.jpg' },
    { rank: 21, name: 'Vishal Mishra', lang: 'Hindi', tag: 'Modern Emotional Hits', poster: 'https://c.saavncdn.com/artists/Vishal_Mishra_004_20230804115745_500x500.jpg' },
    { rank: 22, name: 'B Praak', lang: 'Punjabi/Hindi', tag: 'Heartbreak Anthems', poster: 'https://c.saavncdn.com/artists/B_Praak_002_20200302122645_500x500.jpg' },
    { rank: 23, name: 'Guru Randhawa', lang: 'Punjabi/Hindi', tag: 'Dance & Pop', poster: 'https://c.saavncdn.com/artists/Guru_Randhawa_002_20200618113142_500x500.jpg' },
    { rank: 24, name: 'AP Dhillon', lang: 'Punjabi', tag: 'Synth Pop & Trap', poster: 'https://c.saavncdn.com/artists/AP_Dhillon_002_20230818071055_500x500.jpg' },
    { rank: 25, name: 'Sunidhi Chauhan', lang: 'Hindi', tag: 'Powerhouse Vocals', poster: 'https://c.saavncdn.com/artists/Sunidhi_Chauhan_004_20240415080909_500x500.jpg' },
    { rank: 26, name: 'Darshan Raval', lang: 'Hindi', tag: 'Love & Monsoon Hits', poster: 'https://c.saavncdn.com/artists/Darshan_Raval_005_20201029161434_500x500.jpg' },
    { rank: 27, name: 'Javed Ali', lang: 'Hindi', tag: 'Sufi & Melodic', poster: 'https://c.saavncdn.com/artists/Javed_Ali_002_20230515083910_500x500.jpg' },
    { rank: 28, name: 'Shaan', lang: 'Hindi', tag: '2000s Pop & Melodies', poster: 'https://c.saavncdn.com/artists/Shaan_003_20240229064234_500x500.jpg' }
  ];

  var ARTIST_CATS = [
    { id: 'all', label: 'All Hits' },
    { id: 'trending', label: 'Trending' },
    { id: 'romantic', label: 'Romantic' },
    { id: 'sad', label: 'Sad' },
    { id: 'chill', label: 'Chill' },
    { id: 'energetic', label: 'Party/Beats' },
    { id: 'classics', label: 'Classics' }
  ];

  var HOME_CATS = [
    { id: 'trending', label: 'Trending' },
    { id: 'energetic', label: 'Energetic' },
    { id: 'sad', label: 'Sad' },
    { id: 'discover', label: 'Chill' }
  ];

  var HOME_LANGS = [
    { id: 'all', label: 'All' },
    { id: 'hindi', label: 'Hindi' },
    { id: 'punjabi', label: 'Punjabi' },
    { id: 'mix', label: 'Mix' },
    { id: 'english', label: 'English' }
  ];

  var state = {
    tab: 'home', // 'home' | 'singers' | 'search' | 'ai' | 'player' | 'saved'
    homeCat: 'trending',
    homeLang: 'all',
    homeTracks: [],
    homeLoading: false,
    homeError: '',

    selectedSinger: null, // object from SINGERS
    singerCat: 'all',
    singerTracksByCat: {}, // { all: [], trending: [], romantic: [], ... }
    singerPageByCat: {},   // { all: 1, trending: 1, ... }
    singerMoreByCat: {},   // { all: true, ... }
    singerLoading: false,
    singerLoadingMore: false,
    singerError: '',

    searchQuery: '',
    searchTracks: [],
    searchLoading: false,
    searchError: '',

    aiPrompt: '',
    aiHeadline: '',
    aiTracks: [],
    aiLoading: false,
    aiError: '',

    queue: [],
    currentIndex: -1,
    isPlaying: false,
    isBuffering: false,
    currentTime: 0,
    duration: 0,
    volume: 1,
    isMuted: false,
    repeatOne: false,
    shuffle: false,
    showLyrics: false,
    lyricsText: '',
    lyricsLoading: false,
    playedIds: [],

    favourites: readStorage(FAV_KEY, []),
    recent: readStorage(RECENT_KEY, []),
    toastMsg: ''
  };

  var audio = null;
  var toastTimer = null;
  var fetchingRelated = false;

  function readStorage(key, fallback) {
    try {
      var raw = window.localStorage ? window.localStorage.getItem(key) : null;
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      return parsed || fallback;
    } catch (e) {
      return fallback;
    }
  }

  function writeStorage(key, val) {
    try {
      if (window.localStorage) {
        window.localStorage.setItem(key, JSON.stringify(val));
      }
    } catch (e) {}
  }

  function showToast(msg) {
    state.toastMsg = msg;
    renderToastOnly();
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      state.toastMsg = '';
      renderToastOnly();
    }, 2600);
  }

  function escHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatTime(sec) {
    var s = Math.max(0, Math.floor(Number(sec) || 0));
    var m = Math.floor(s / 60);
    var r = s % 60;
    return (m < 10 ? '0' + m : String(m)) + ':' + (r < 10 ? '0' + r : String(r));
  }

  function parseDuration(label, durSec) {
    if (durSec && Number(durSec) > 0) return Number(durSec);
    if (!label) return 0;
    var parts = String(label).split(':');
    if (parts.length === 2) {
      return (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0);
    }
    if (parts.length === 3) {
      return (parseInt(parts[0], 10) || 0) * 3600 + (parseInt(parts[1], 10) || 0) * 60 + (parseInt(parts[2], 10) || 0);
    }
    return 0;
  }

  function normalizeTitleKey(title) {
    return String(title || '')
      .toLowerCase()
      .replace(/\(.*?\)|\[.*?\]/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function classifySongCategory(track) {
    var text = (String(track.title || '') + ' ' + String(track.artist || '')).toLowerCase();
    var matched = [];
    if (/romantic|love|pyaar|pyar|ishq|dil|mohabbat|sanam|jaan|tum hi ho|kesariya|raabta|shayad|mast magan|hawayein|zaalima|sajni|apna bana le|ve kamleya|pehle bhi main|tera hone laga|subhanallah/i.test(text)) {
      matched.push('romantic');
    }
    if (/sad|heartbreak|dard|judai|bewafa|rona|tanhai|alvida|channa mereya|agar tum saath ho|hamari adhuri|bekhayali|tujhe bhula diya|pachtaoge|khairiyat|kalank|bedardeya|phir bhi tumko/i.test(text)) {
      matched.push('sad');
    }
    if (/chill|lofi|lo-fi|unplugged|acoustic|reprise|slowed|reverb|sukoon|shaam|raat|ilahi|kabira|safar|kasoor/i.test(text)) {
      matched.push('chill');
    }
    if (/party|dance|club|dj|remix|beat|bhangra|workout|rap|hip hop|295|goat|brown rang|blue eyes|kala chashma|kar gayi chull|tauba|ghungroo|nashe si|badtameez/i.test(text)) {
      matched.push('energetic');
    }
    if (/90s|old|classic|evergreen|golden|retro|unforgettable|aashiqui|dilwale|raja hindustani|dhadkan|veer zaara/i.test(text)) {
      matched.push('classics');
    }
    if (matched.length === 0) {
      matched.push('romantic');
      matched.push('trending');
    }
    return matched;
  }

  function xhrJson(method, url, bodyObj, cb) {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open(method, url, true);
      xhr.setRequestHeader('Accept', 'application/json');
      if (bodyObj) {
        xhr.setRequestHeader('Content-Type', 'application/json');
      }
      xhr.timeout = 22000;
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            var data = JSON.parse(xhr.responseText || '{}');
            cb(null, data);
          } catch (err) {
            cb('Invalid server response', null);
          }
        } else {
          var msg = 'Request failed (' + xhr.status + ')';
          try {
            var errJson = JSON.parse(xhr.responseText || '{}');
            if (errJson && errJson.message) msg = errJson.message;
          } catch (e) {}
          cb(msg, null);
        }
      };
      xhr.ontimeout = function () {
        cb('Network timeout. Please check 4G signal.', null);
      };
      xhr.onerror = function () {
        cb('Network error. Please retry.', null);
      };
      xhr.send(bodyObj ? JSON.stringify(bodyObj) : null);
    } catch (e) {
      cb('Connection error', null);
    }
  }

  function buildStreamUrl(track, isDownload) {
    if (!track) return '';
    var dur = parseDuration(track.duration, track.durationSeconds);
    var url =
      '/api/audio/stream?videoId=' +
      encodeURIComponent(track.id || '') +
      '&title=' +
      encodeURIComponent(track.title || '') +
      '&artist=' +
      encodeURIComponent(track.artist || '') +
      '&duration=' +
      encodeURIComponent(String(dur));
    if (isDownload) {
      url += '&download=1';
    }
    return url;
  }

  function ensureAudio() {
    if (audio) return audio;
    audio = document.createElement('audio');
    audio.setAttribute('preload', 'auto');
    audio.setAttribute('playsinline', 'true');
    audio.style.display = 'none';
    document.body.appendChild(audio);

    audio.addEventListener('timeupdate', function () {
      state.currentTime = audio.currentTime || 0;
      if (audio.duration && isFinite(audio.duration) && audio.duration > 0) {
        state.duration = audio.duration;
      }
      updatePlayerTimeDom();
    });

    audio.addEventListener('loadedmetadata', function () {
      if (audio.duration && isFinite(audio.duration) && audio.duration > 0) {
        state.duration = audio.duration;
      }
      state.isBuffering = false;
      updatePlayerTimeDom();
    });

    audio.addEventListener('playing', function () {
      state.isPlaying = true;
      state.isBuffering = false;
      render();
    });

    audio.addEventListener('pause', function () {
      state.isPlaying = false;
      render();
    });

    audio.addEventListener('waiting', function () {
      state.isBuffering = true;
      updatePlayerTimeDom();
    });

    audio.addEventListener('ended', function () {
      if (state.repeatOne) {
        audio.currentTime = 0;
        var p = audio.play();
        if (p && p.catch) p.catch(function () {});
        return;
      }
      playNextTrack();
    });

    audio.addEventListener('error', function () {
      state.isBuffering = false;
      state.isPlaying = false;
      showToast('Skipping unavailable stream...');
      setTimeout(function () {
        if (state.queue.length > 1) {
          playNextTrack();
        }
      }, 900);
    });

    return audio;
  }

  function getCurrentTrack() {
    if (state.currentIndex >= 0 && state.currentIndex < state.queue.length) {
      return state.queue[state.currentIndex];
    }
    return null;
  }

  function addRecent(track) {
    if (!track || !track.id) return;
    var list = [];
    for (var i = 0; i < state.recent.length; i++) {
      var item = state.recent[i];
      var t = item && item.track ? item.track : item;
      if (t && t.id && t.id !== track.id) {
        list.push(t);
      }
    }
    list.unshift(track);
    if (list.length > 25) list = list.slice(0, 25);
    state.recent = list;
    writeStorage(RECENT_KEY, list);
  }

  function isFav(trackId) {
    for (var i = 0; i < state.favourites.length; i++) {
      if (state.favourites[i] && state.favourites[i].id === trackId) return true;
    }
    return false;
  }

  function toggleFav(track) {
    if (!track || !track.id) return;
    var exists = isFav(track.id);
    var next = [];
    if (exists) {
      for (var i = 0; i < state.favourites.length; i++) {
        if (state.favourites[i] && state.favourites[i].id !== track.id) {
          next.push(state.favourites[i]);
        }
      }
      showToast('Removed from Saved');
    } else {
      next.push(track);
      for (var j = 0; j < state.favourites.length; j++) {
        if (state.favourites[j]) next.push(state.favourites[j]);
      }
      showToast('Saved to Favourites ♥');
    }
    state.favourites = next;
    writeStorage(FAV_KEY, next);
    render();
  }

  function playTrackFromList(track, list) {
    if (!track) return;
    var q = list && list.length ? list.slice(0) : [track];
    var idx = -1;
    for (var i = 0; i < q.length; i++) {
      if (q[i] && q[i].id === track.id) {
        idx = i;
        break;
      }
    }
    if (idx === -1) {
      q.unshift(track);
      idx = 0;
    }
    state.queue = q;
    state.currentIndex = idx;
    startCurrentTrack();
  }

  function startCurrentTrack() {
    var track = getCurrentTrack();
    if (!track) return;
    var el = ensureAudio();
    state.isBuffering = true;
    state.currentTime = 0;
    state.duration = parseDuration(track.duration, track.durationSeconds) || 0;
    state.lyricsText = '';
    if (state.playedIds.indexOf(track.id) === -1) {
      state.playedIds.push(track.id);
      if (state.playedIds.length > 120) state.playedIds.shift();
    }
    addRecent(track);

    try {
      el.pause();
      el.src = buildStreamUrl(track, false);
      el.currentTime = 0;
      el.volume = state.isMuted ? 0 : state.volume;
      var playPromise = el.play();
      if (playPromise && playPromise.then) {
        playPromise
          .then(function () {
            state.isPlaying = true;
            state.isBuffering = false;
            render();
          })
          .catch(function () {
            state.isBuffering = false;
            render();
          });
      } else {
        state.isPlaying = true;
        state.isBuffering = false;
      }
    } catch (e) {
      state.isBuffering = false;
    }

    if (state.showLyrics) {
      loadLyricsForCurrent();
    }

    // Pre-fetch related songs if near end of queue so playback never stops after 10 songs
    if (state.queue.length - state.currentIndex <= 3) {
      fetchMoreQueueTracks(track);
    }

    render();
  }

  function fetchMoreQueueTracks(seedTrack) {
    if (fetchingRelated || !seedTrack) return;
    fetchingRelated = true;
    var exclude = state.playedIds.slice(-60).join(',');
    var url =
      '/api/youtube/related?videoId=' +
      encodeURIComponent(seedTrack.id) +
      '&title=' +
      encodeURIComponent(seedTrack.title || '') +
      '&artist=' +
      encodeURIComponent(seedTrack.artist || '') +
      '&excludeIds=' +
      encodeURIComponent(exclude);

    xhrJson('GET', url, null, function (err, data) {
      fetchingRelated = false;
      if (err || !data || !data.tracks || !data.tracks.length) return;
      var existingIds = {};
      var existingTitles = {};
      for (var i = 0; i < state.queue.length; i++) {
        existingIds[state.queue[i].id] = true;
        existingTitles[normalizeTitleKey(state.queue[i].title)] = true;
      }
      var added = 0;
      for (var j = 0; j < data.tracks.length; j++) {
        var t = data.tracks[j];
        var tKey = normalizeTitleKey(t.title);
        if (t && t.id && !existingIds[t.id] && (!tKey || !existingTitles[tKey])) {
          existingIds[t.id] = true;
          if (tKey) existingTitles[tKey] = true;
          state.queue.push(t);
          added++;
        }
      }
      if (added > 0 && state.tab === 'player') {
        render();
      }
    });
  }

  function togglePlayPause() {
    var track = getCurrentTrack();
    if (!track) {
      if (state.homeTracks.length > 0) {
        playTrackFromList(state.homeTracks[0], state.homeTracks);
      }
      return;
    }
    var el = ensureAudio();
    if (state.isPlaying) {
      el.pause();
      state.isPlaying = false;
    } else {
      var p = el.play();
      if (p && p.catch) p.catch(function () {});
      state.isPlaying = true;
    }
    render();
  }

  function playNextTrack() {
    if (!state.queue.length) return;
    if (state.shuffle && state.queue.length > 1) {
      var nextIdx = Math.floor(Math.random() * state.queue.length);
      if (nextIdx === state.currentIndex) {
        nextIdx = (nextIdx + 1) % state.queue.length;
      }
      state.currentIndex = nextIdx;
      startCurrentTrack();
      return;
    }
    if (state.currentIndex + 1 < state.queue.length) {
      state.currentIndex++;
      startCurrentTrack();
    } else {
      var curr = getCurrentTrack();
      state.currentIndex = 0;
      startCurrentTrack();
      if (curr) fetchMoreQueueTracks(curr);
    }
  }

  function playPrevTrack() {
    if (!state.queue.length) return;
    var el = ensureAudio();
    if (el.currentTime > 4) {
      el.currentTime = 0;
      return;
    }
    state.currentIndex = state.currentIndex > 0 ? state.currentIndex - 1 : state.queue.length - 1;
    startCurrentTrack();
  }

  function seekBySeconds(delta) {
    var el = ensureAudio();
    if (!getCurrentTrack()) return;
    var target = Math.max(0, (el.currentTime || 0) + delta);
    if (state.duration > 0) target = Math.min(state.duration, target);
    el.currentTime = target;
    state.currentTime = target;
    updatePlayerTimeDom();
  }

  function adjustVolume(delta) {
    var el = ensureAudio();
    state.isMuted = false;
    var next = Math.max(0, Math.min(1, Math.round((state.volume + delta) * 10) / 10));
    state.volume = next;
    el.volume = next;
    showToast('Volume: ' + Math.round(next * 100) + '%');
  }

  function loadLyricsForCurrent() {
    var track = getCurrentTrack();
    if (!track) return;
    state.lyricsLoading = true;
    state.lyricsText = '';
    render();
    var dur = parseDuration(track.duration, track.durationSeconds);
    var url =
      '/api/lyrics?videoId=' +
      encodeURIComponent(track.id) +
      '&title=' +
      encodeURIComponent(track.title || '') +
      '&artist=' +
      encodeURIComponent(track.artist || '') +
      '&duration=' +
      encodeURIComponent(String(dur));

    xhrJson('GET', url, null, function (err, data) {
      state.lyricsLoading = false;
      if (err || !data) {
        state.lyricsText = 'Lyrics not available for this song.';
      } else if (data.plainLyrics) {
        state.lyricsText = data.plainLyrics;
      } else if (data.lines && data.lines.length) {
        var out = [];
        for (var i = 0; i < data.lines.length; i++) {
          if (data.lines[i] && data.lines[i].text) out.push(data.lines[i].text);
        }
        state.lyricsText = out.join('\n') || 'Lyrics not available for this song.';
      } else {
        state.lyricsText = 'Lyrics not available for this song.';
      }
      render();
    });
  }

  function loadHomeTracks(append) {
    state.homeLoading = true;
    state.homeError = '';
    render();
    var url =
      '/api/youtube/category?category=' +
      encodeURIComponent(state.homeCat) +
      '&lang=' +
      encodeURIComponent(state.homeLang) +
      (append ? '&refresh=1' : '');

    xhrJson('GET', url, null, function (err, data) {
      state.homeLoading = false;
      if (err || !data || !data.tracks) {
        state.homeError = err || 'Failed to load songs.';
        render();
        return;
      }
      if (!append) {
        state.homeTracks = data.tracks;
      } else {
        var seen = {};
        for (var i = 0; i < state.homeTracks.length; i++) {
          seen[state.homeTracks[i].id] = true;
        }
        var added = 0;
        for (var j = 0; j < data.tracks.length; j++) {
          var t = data.tracks[j];
          if (t && t.id && !seen[t.id]) {
            seen[t.id] = true;
            state.homeTracks.push(t);
            added++;
          }
        }
        showToast(added > 0 ? 'Loaded +' + added + ' songs' : 'All top songs loaded');
      }
      render();
    });
  }

  function openSinger(singer) {
    state.selectedSinger = singer;
    state.singerCat = 'all';
    state.singerTracksByCat = {
      all: [],
      trending: [],
      romantic: [],
      sad: [],
      chill: [],
      energetic: [],
      classics: []
    };
    state.singerPageByCat = {
      all: 0,
      trending: 0,
      romantic: 0,
      sad: 0,
      chill: 0,
      energetic: 0,
      classics: 0
    };
    state.singerMoreByCat = {
      all: true,
      trending: true,
      romantic: true,
      sad: true,
      chill: true,
      energetic: true,
      classics: true
    };
    state.singerLoading = true;
    state.singerError = '';
    render();

    var url = '/api/youtube/artist?artist=' + encodeURIComponent(singer.name);
    xhrJson('GET', url, null, function (err, data) {
      state.singerLoading = false;
      if (err || !data) {
        state.singerError = err || 'Could not load singer profile.';
        render();
        return;
      }
      var top = data.topTracks || [];
      state.singerTracksByCat.all = top.slice(0);
      state.singerTracksByCat.trending = top.slice(0, 10);
      for (var i = 0; i < top.length; i++) {
        var cats = classifySongCategory(top[i]);
        for (var c = 0; c < cats.length; c++) {
          var catId = cats[c];
          if (state.singerTracksByCat[catId]) {
            state.singerTracksByCat[catId].push(top[i]);
          }
        }
      }
      render();
    });
  }

  function loadMoreSingerCategorySongs(catId) {
    if (!state.selectedSinger || state.singerLoadingMore) return;
    state.singerLoadingMore = true;
    render();

    var nextPage = (state.singerPageByCat[catId] || 0) + 1;
    var excludeIds = [];
    var excludeTitles = [];
    var seenIdMap = {};

    var keys = ['all', 'trending', 'romantic', 'sad', 'chill', 'energetic', 'classics'];
    var activeList = state.singerTracksByCat[catId] || [];
    for (var i = 0; i < activeList.length; i++) {
      var t = activeList[i];
      if (t && t.id && !seenIdMap[t.id]) {
        seenIdMap[t.id] = true;
        excludeIds.push(t.id);
        excludeTitles.push(t.title || '');
      }
    }
    for (var k = 0; k < keys.length; k++) {
      var list = state.singerTracksByCat[keys[k]] || [];
      for (var j = 0; j < list.length; j++) {
        var tr = list[j];
        if (tr && tr.id && !seenIdMap[tr.id]) {
          seenIdMap[tr.id] = true;
          excludeIds.push(tr.id);
          excludeTitles.push(tr.title || '');
        }
      }
    }

    xhrJson(
      'POST',
      '/api/youtube/artist/songs',
      {
        artist: state.selectedSinger.name,
        category: catId,
        page: nextPage,
        excludeIds: excludeIds.slice(0, 500),
        excludeTitles: excludeTitles.slice(0, 500)
      },
      function (err, data) {
        state.singerLoadingMore = false;
        if (err || !data || !data.tracks) {
          showToast(err || 'Could not load more songs');
          render();
          return;
        }
        state.singerPageByCat[catId] = nextPage;
        var currentCatList = state.singerTracksByCat[catId] || [];
        var catIds = {};
        var catTitles = {};
        for (var m = 0; m < currentCatList.length; m++) {
          catIds[currentCatList[m].id] = true;
          catTitles[normalizeTitleKey(currentCatList[m].title)] = true;
        }

        var added = 0;
        for (var n = 0; n < data.tracks.length; n++) {
          var item = data.tracks[n];
          var norm = normalizeTitleKey(item.title);
          if (item && item.id && !catIds[item.id] && (!norm || !catTitles[norm])) {
            catIds[item.id] = true;
            if (norm) catTitles[norm] = true;
            currentCatList.push(item);
            added++;
            if (catId !== 'all') {
              state.singerTracksByCat.all.push(item);
            }
          }
        }
        state.singerTracksByCat[catId] = currentCatList;
        state.singerMoreByCat[catId] = data.hasMore !== false && added > 0;
        showToast(added > 0 ? 'Loaded +' + added + ' new ' + state.selectedSinger.name + ' songs!' : 'No more new songs in this category');
        render();
      }
    );
  }

  function runSearch(queryText) {
    var q = String(queryText != null ? queryText : state.searchQuery).trim();
    if (!q) return;
    state.searchQuery = q;
    state.searchLoading = true;
    state.searchError = '';
    render();

    var url = '/api/youtube/search?q=' + encodeURIComponent(q) + '&type=songs';
    xhrJson('GET', url, null, function (err, data) {
      state.searchLoading = false;
      if (err || !data || !data.tracks) {
        state.searchError = err || 'Search failed.';
      } else {
        state.searchTracks = data.tracks;
      }
      render();
    });
  }

  function runAiDiscovery(promptText) {
    var p = String(promptText != null ? promptText : state.aiPrompt).trim();
    if (!p) return;
    state.aiPrompt = p;
    state.aiLoading = true;
    state.aiError = '';
    render();

    xhrJson('POST', '/api/ai/discover', { prompt: p }, function (err, data) {
      state.aiLoading = false;
      if (err || !data) {
        state.aiError = err || 'AI Discovery failed.';
      } else {
        state.aiHeadline = (data.plan && data.plan.headline) || 'AI Curated Mix';
        state.aiTracks = data.tracks || [];
      }
      render();
    });
  }

  function injectStyles() {
    if (document.getElementById('vibra-jio-f220b-css')) return;
    var style = document.createElement('style');
    style.id = 'vibra-jio-f220b-css';
    style.type = 'text/css';
    style.innerHTML =
      'html, body { background-color: #090A0F !important; color: #F4F5F8 !important; margin: 0 !important; padding: 0 !important; font-family: sans-serif !important; font-size: 12px !important; line-height: 1.35 !important; -webkit-text-size-adjust: 100%; }' +
      '* { box-sizing: border-box; }' +
      '#jio-app { width: 100%; max-width: 100%; min-height: 100vh; background: #090A0F; color: #F4F5F8; padding-bottom: 72px; overflow-x: hidden; }' +
      '.j-hdr { background: #10131E; border-bottom: 1px solid #23283B; padding: 5px 6px; display: block; }' +
      '.j-hdr-top { overflow: hidden; }' +
      '.j-logo { float: left; font-weight: bold; font-size: 13px; color: #FFFFFF; }' +
      '.j-logo span { background: #4F6BFF; color: #FFF; padding: 1px 4px; border-radius: 3px; font-size: 10px; margin-left: 3px; }' +
      '.j-badge { float: right; font-size: 10px; color: #7A90FF; padding-top: 2px; }' +
      '.j-nav { display: table; width: 100%; background: #121522; border-bottom: 1px solid #23283B; table-layout: fixed; }' +
      '.j-nav-btn { display: table-cell; text-align: center; padding: 6px 1px; font-size: 10px; font-weight: bold; color: #94A3B8; background: transparent; border: none; border-bottom: 2px solid transparent; cursor: pointer; }' +
      '.j-nav-btn.act { color: #FFFFFF; border-bottom: 2px solid #4F6BFF; background: #1A1F33; }' +
      '.j-pills { padding: 5px 4px; border-bottom: 1px solid #1C2030; white-space: nowrap; overflow-x: auto; }' +
      '.j-pill { display: inline-block; padding: 4px 7px; margin: 1px 2px; font-size: 10px; font-weight: bold; color: #CBD5E1; background: #151926; border: 1px solid #262C40; border-radius: 4px; cursor: pointer; }' +
      '.j-pill.act { background: #4F6BFF; color: #FFFFFF; border-color: #7A90FF; }' +
      '.j-sec-title { padding: 6px 6px 3px 6px; font-size: 11px; font-weight: bold; color: #94A3B8; }' +
      '.j-card { background: #121521; border: 1px solid #1E2336; border-radius: 5px; margin: 4px 5px; padding: 5px; overflow: hidden; cursor: pointer; }' +
      '.j-card.playing { border-color: #4F6BFF; background: #171D33; }' +
      '.j-thumb { float: left; width: 38px; height: 38px; border-radius: 4px; object-fit: cover; background: #1E2336; margin-right: 6px; }' +
      '.j-info { overflow: hidden; }' +
      '.j-title { font-size: 11px; font-weight: bold; color: #FFFFFF; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }' +
      '.j-sub { font-size: 10px; color: #94A3B8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; }' +
      '.j-actions { margin-top: 4px; clear: both; }' +
      '.j-btn { display: inline-block; padding: 4px 7px; font-size: 10px; font-weight: bold; color: #FFFFFF; background: #4F6BFF; border: 1px solid #637BFF; border-radius: 4px; cursor: pointer; text-decoration: none; margin-right: 3px; }' +
      '.j-btn-sec { background: #1A1F30; border-color: #2D354F; color: #E2E8F0; }' +
      '.j-btn-full { display: block; width: 95%; margin: 7px auto; text-align: center; padding: 7px 6px; font-size: 11px; }' +
      '.j-input-wrap { padding: 6px; }' +
      '.j-input { width: 100%; padding: 6px; font-size: 12px; background: #141826; color: #FFFFFF; border: 1px solid #2E3650; border-radius: 4px; margin-bottom: 5px; }' +
      '.j-mini { position: fixed; left: 0; right: 0; bottom: 22px; background: #151A2E; border-top: 2px solid #4F6BFF; padding: 4px 6px; z-index: 90; overflow: hidden; }' +
      '.j-softbar { position: fixed; left: 0; right: 0; bottom: 0; height: 22px; line-height: 22px; background: #06070B; border-top: 1px solid #23283B; font-size: 10px; color: #94A3B8; padding: 0 6px; z-index: 100; overflow: hidden; }' +
      '[data-jio-focus="1"]:focus { outline: 2px solid #7A90FF !important; background-color: #1E2540 !important; }' +
      '#jio-toast { position: fixed; top: 6px; left: 6px; right: 6px; background: #1E293B; color: #FFFFFF; border: 1px solid #4F6BFF; padding: 5px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; text-align: center; z-index: 200; display: none; }';
    document.head.appendChild(style);
  }

  function renderToastOnly() {
    var el = document.getElementById('jio-toast');
    if (!el) return;
    if (state.toastMsg) {
      el.innerHTML = escHtml(state.toastMsg);
      el.style.display = 'block';
    } else {
      el.style.display = 'none';
    }
  }

  function updatePlayerTimeDom() {
    var timeEl = document.getElementById('jio-player-time');
    if (timeEl) {
      timeEl.innerHTML =
        (state.isBuffering ? 'Buffering... ' : '') +
        formatTime(state.currentTime) +
        ' / ' +
        formatTime(state.duration);
    }
    var barEl = document.getElementById('jio-player-bar');
    if (barEl) {
      var pct = state.duration > 0 ? Math.min(100, Math.round((state.currentTime / state.duration) * 100)) : 0;
      barEl.style.width = pct + '%';
    }
  }

  function renderTrackListHtml(tracks, listName) {
    if (!tracks || !tracks.length) {
      return '<div style="padding:14px 8px;text-align:center;color:#94A3B8;">No songs found.</div>';
    }
    var curr = getCurrentTrack();
    var html = '';
    for (var i = 0; i < tracks.length; i++) {
      var t = tracks[i];
      if (!t) continue;
      var isCurr = curr && curr.id === t.id;
      var fav = isFav(t.id);
      var thumb = t.thumbnail || t.thumbnailHigh || '/pwa-192x192.png';
      html +=
        '<div class="j-card' +
        (isCurr ? ' playing' : '') +
        '" tabindex="0" data-jio-focus="1" data-act="play-track" data-list="' +
        escHtml(listName) +
        '" data-idx="' +
        i +
        '">' +
        '<img class="j-thumb" src="' +
        escHtml(thumb) +
        '" alt="" onerror="this.src=\'/pwa-192x192.png\'" />' +
        '<div class="j-info">' +
        '<div class="j-title">' +
        (isCurr ? '&#9654; ' : i + 1 + '. ') +
        escHtml(t.title) +
        '</div>' +
        '<div class="j-sub">' +
        escHtml(t.artist || '') +
        (t.duration ? ' • ' + escHtml(t.duration) : '') +
        '</div>' +
        '</div>' +
        '<div class="j-actions">' +
        '<button type="button" class="j-btn" tabindex="0" data-jio-focus="1" data-act="play-track" data-list="' +
        escHtml(listName) +
        '" data-idx="' +
        i +
        '">' +
        (isCurr && state.isPlaying ? 'Pause' : 'Play') +
        '</button>' +
        '<button type="button" class="j-btn j-btn-sec" tabindex="0" data-jio-focus="1" data-act="fav-track" data-list="' +
        escHtml(listName) +
        '" data-idx="' +
        i +
        '">' +
        (fav ? '&#9829; Saved' : '&#9825; Save') +
        '</button>' +
        '<a class="j-btn j-btn-sec" tabindex="0" data-jio-focus="1" href="' +
        escHtml(buildStreamUrl(t, true)) +
        '" download>Download</a>' +
        '</div>' +
        '</div>';
    }
    return html;
  }

  function renderHomeTab() {
    var html = '<div class="j-pills">';
    for (var i = 0; i < HOME_CATS.length; i++) {
      var c = HOME_CATS[i];
      html +=
        '<button type="button" tabindex="0" data-jio-focus="1" class="j-pill' +
        (state.homeCat === c.id ? ' act' : '') +
        '" data-act="home-cat" data-val="' +
        c.id +
        '">' +
        escHtml(c.label) +
        '</button>';
    }
    html += '</div><div class="j-pills">';
    for (var j = 0; j < HOME_LANGS.length; j++) {
      var l = HOME_LANGS[j];
      html +=
        '<button type="button" tabindex="0" data-jio-focus="1" class="j-pill' +
        (state.homeLang === l.id ? ' act' : '') +
        '" data-act="home-lang" data-val="' +
        l.id +
        '">' +
        escHtml(l.label) +
        '</button>';
    }
    html += '</div>';

    // Quick Popular Singers strip on Home
    html +=
      '<div class="j-sec-title">TOP SINGERS (PRESS [0] FOR ALL 28 SINGERS)</div>' +
      '<div class="j-pills">';
    for (var s = 0; s < 12; s++) {
      var sg = SINGERS[s];
      html +=
        '<button type="button" tabindex="0" data-jio-focus="1" class="j-pill" data-act="open-singer" data-idx="' +
        s +
        '">#' +
        sg.rank +
        ' ' +
        escHtml(sg.name) +
        '</button>';
    }
    html += '</div>';

    html += '<div class="j-sec-title">SONGS (' + state.homeTracks.length + ')</div>';
    if (state.homeError) {
      html +=
        '<div style="padding:10px;color:#FCA5A5;">' +
        escHtml(state.homeError) +
        ' <button type="button" class="j-btn" data-jio-focus="1" data-act="home-retry">Retry</button></div>';
    }
    html += renderTrackListHtml(state.homeTracks, 'home');
    if (state.homeLoading) {
      html += '<div style="padding:10px;text-align:center;color:#7A90FF;">Loading songs...</div>';
    } else {
      html +=
        '<button type="button" tabindex="0" data-jio-focus="1" class="j-btn j-btn-full" data-act="home-more">+ Load More Songs (+New)</button>';
    }
    return html;
  }

  function renderSingersTab() {
    if (!state.selectedSinger) {
      var html = '<div class="j-sec-title">POPULAR SINGERS HUB (SELECT SINGER)</div>';
      for (var i = 0; i < SINGERS.length; i++) {
        var sg = SINGERS[i];
        html +=
          '<div class="j-card" tabindex="0" data-jio-focus="1" data-act="open-singer" data-idx="' +
          i +
          '">' +
          '<img class="j-thumb" src="' +
          escHtml(sg.poster) +
          '" alt="' +
          escHtml(sg.name) +
          '" onerror="this.src=\'/pwa-192x192.png\'" />' +
          '<div class="j-info">' +
          '<div class="j-title">#' +
          sg.rank +
          ' ' +
          escHtml(sg.name) +
          '</div>' +
          '<div class="j-sub">' +
          escHtml(sg.lang) +
          ' • ' +
          escHtml(sg.tag) +
          '</div>' +
          '</div>' +
          '</div>';
      }
      return html;
    }

    var singer = state.selectedSinger;
    var activeList = state.singerTracksByCat[state.singerCat] || [];
    var html2 =
      '<div class="j-card" style="background:#161B2E;border-color:#4F6BFF;">' +
      '<img class="j-thumb" style="width:46px;height:46px;" src="' +
      escHtml(singer.poster) +
      '" alt="' +
      escHtml(singer.name) +
      '" onerror="this.src=\'/pwa-192x192.png\'" />' +
      '<div class="j-info">' +
      '<div class="j-title" style="font-size:13px;">#' +
      singer.rank +
      ' ' +
      escHtml(singer.name) +
      '</div>' +
      '<div class="j-sub">' +
      escHtml(singer.tag) +
      '</div>' +
      '</div>' +
      '<div class="j-actions">' +
      '<button type="button" tabindex="0" data-jio-focus="1" class="j-btn j-btn-sec" data-act="back-singers">&larr; All Singers</button>' +
      '<button type="button" tabindex="0" data-jio-focus="1" class="j-btn" data-act="play-singer-cat">Play All (' +
      activeList.length +
      ')</button>' +
      '</div>' +
      '</div>';

    // Category tabs for this singer
    html2 += '<div class="j-pills">';
    for (var c = 0; c < ARTIST_CATS.length; c++) {
      var cat = ARTIST_CATS[c];
      var count = (state.singerTracksByCat[cat.id] || []).length;
      html2 +=
        '<button type="button" tabindex="0" data-jio-focus="1" class="j-pill' +
        (state.singerCat === cat.id ? ' act' : '') +
        '" data-act="singer-cat" data-val="' +
        cat.id +
        '">' +
        escHtml(cat.label) +
        ' (' +
        count +
        ')</button>';
    }
    html2 += '</div>';

    if (state.singerLoading) {
      html2 += '<div style="padding:14px;text-align:center;color:#7A90FF;">Loading ' + escHtml(singer.name) + ' songs...</div>';
      return html2;
    }

    if (state.singerError) {
      html2 += '<div style="padding:10px;color:#FCA5A5;">' + escHtml(state.singerError) + '</div>';
    }

    html2 += renderTrackListHtml(activeList, 'singer');

    if (state.singerLoadingMore) {
      html2 += '<div style="padding:10px;text-align:center;color:#7A90FF;">Loading new ' + escHtml(singer.name) + ' songs...</div>';
    } else {
      html2 +=
        '<button type="button" tabindex="0" data-jio-focus="1" class="j-btn j-btn-full" data-act="singer-load-more">' +
        '+ Load More ' +
        escHtml(singer.name) +
        ' Songs (+New)</button>';
    }
    return html2;
  }

  function renderSearchTab() {
    var html =
      '<div class="j-input-wrap">' +
      '<input id="jio-search-input" type="text" class="j-input" tabindex="0" data-jio-focus="1" placeholder="Search songs or singers..." value="' +
      escHtml(state.searchQuery) +
      '" />' +
      '<button type="button" tabindex="0" data-jio-focus="1" class="j-btn j-btn-full" style="margin:2px 0;" data-act="run-search">Search Songs</button>' +
      '</div>' +
      '<div class="j-pills">' +
      '<button type="button" tabindex="0" data-jio-focus="1" class="j-pill" data-act="quick-search" data-val="Arijit Singh Romantic Songs">Arijit Singh</button>' +
      '<button type="button" tabindex="0" data-jio-focus="1" class="j-pill" data-act="quick-search" data-val="Yo Yo Honey Singh Hits">Honey Singh</button>' +
      '<button type="button" tabindex="0" data-jio-focus="1" class="j-pill" data-act="quick-search" data-val="Sidhu Moose Wala Songs">Sidhu Moose Wala</button>' +
      '<button type="button" tabindex="0" data-jio-focus="1" class="j-pill" data-act="quick-search" data-val="90s Evergreen Hindi Songs">90s Classics</button>' +
      '<button type="button" tabindex="0" data-jio-focus="1" class="j-pill" data-act="quick-search" data-val="Karan Aujla Diljit Dosanjh">Punjabi Hits</button>' +
      '</div>';

    if (state.searchLoading) {
      html += '<div style="padding:12px;text-align:center;color:#7A90FF;">Searching...</div>';
    } else if (state.searchError) {
      html += '<div style="padding:10px;color:#FCA5A5;">' + escHtml(state.searchError) + '</div>';
    } else {
      html += renderTrackListHtml(state.searchTracks, 'search');
    }
    return html;
  }

  function renderAiTab() {
    var html =
      '<div class="j-input-wrap">' +
      '<div style="font-size:11px;color:#7A90FF;font-weight:bold;margin-bottom:4px;">VIBRA AI MOOD DISCOVERY</div>' +
      '<input id="jio-ai-input" type="text" class="j-input" tabindex="0" data-jio-focus="1" placeholder="Describe mood (e.g. Emotional Hindi)..." value="' +
      escHtml(state.aiPrompt) +
      '" />' +
      '<button type="button" tabindex="0" data-jio-focus="1" class="j-btn j-btn-full" style="margin:2px 0;" data-act="run-ai">AI Discover Music</button>' +
      '</div>' +
      '<div class="j-pills">' +
      '<button type="button" tabindex="0" data-jio-focus="1" class="j-pill" data-act="quick-ai" data-val="Emotional Hindi love and heartbreak songs">Emotional Hindi</button>' +
      '<button type="button" tabindex="0" data-jio-focus="1" class="j-pill" data-act="quick-ai" data-val="High energy Punjabi party and workout beats">Punjabi Party</button>' +
      '<button type="button" tabindex="0" data-jio-focus="1" class="j-pill" data-act="quick-ai" data-val="90s Bollywood evergreen romantic melodies">90s Romance</button>' +
      '<button type="button" tabindex="0" data-jio-focus="1" class="j-pill" data-act="quick-ai" data-val="Late night chill acoustic Hindi unplugged songs">Late Night Chill</button>' +
      '</div>';

    if (state.aiLoading) {
      html += '<div style="padding:12px;text-align:center;color:#7A90FF;">Vibra AI is curating songs...</div>';
    } else if (state.aiError) {
      html += '<div style="padding:10px;color:#FCA5A5;">' + escHtml(state.aiError) + '</div>';
    } else if (state.aiTracks.length > 0) {
      html += '<div class="j-sec-title">' + escHtml(state.aiHeadline || 'AI MIX') + '</div>';
      html += renderTrackListHtml(state.aiTracks, 'ai');
    }
    return html;
  }

  function renderPlayerTab() {
    var curr = getCurrentTrack();
    if (!curr) {
      return (
        '<div style="padding:20px 10px;text-align:center;">' +
        '<div style="color:#94A3B8;margin-bottom:10px;">No song is currently playing.</div>' +
        '<button type="button" tabindex="0" data-jio-focus="1" class="j-btn" data-act="nav" data-val="home">Browse Songs</button>' +
        '</div>'
      );
    }

    var pct = state.duration > 0 ? Math.min(100, Math.round((state.currentTime / state.duration) * 100)) : 0;
    var thumb = curr.thumbnailHigh || curr.thumbnail || '/pwa-192x192.png';
    var fav = isFav(curr.id);

    var html =
      '<div class="j-card" style="text-align:center;padding:8px;">' +
      '<img src="' +
      escHtml(thumb) +
      '" alt="" style="width:96px;height:96px;border-radius:6px;object-fit:cover;margin:0 auto 6px auto;display:block;" onerror="this.src=\'/pwa-192x192.png\'" />' +
      '<div style="font-size:12px;font-weight:bold;color:#FFF;">' +
      escHtml(curr.title) +
      '</div>' +
      '<div style="font-size:10px;color:#94A3B8;margin-top:2px;">' +
      escHtml(curr.artist) +
      '</div>' +
      '<div id="jio-player-time" style="font-size:11px;color:#7A90FF;margin-top:5px;font-weight:bold;">' +
      (state.isBuffering ? 'Buffering... ' : '') +
      formatTime(state.currentTime) +
      ' / ' +
      formatTime(state.duration) +
      '</div>' +
      '<div style="width:100%;height:6px;background:#1E2438;border-radius:3px;margin:5px 0;overflow:hidden;">' +
      '<div id="jio-player-bar" style="height:100%;background:#4F6BFF;width:' +
      pct +
      '%;"></div>' +
      '</div>' +
      '<div style="margin-top:6px;">' +
      '<button type="button" tabindex="0" data-jio-focus="1" class="j-btn j-btn-sec" data-act="prev">[4] Prev</button>' +
      '<button type="button" tabindex="0" data-jio-focus="1" class="j-btn j-btn-sec" data-act="seek-back">[7] -10s</button>' +
      '<button type="button" tabindex="0" data-jio-focus="1" class="j-btn" data-act="toggle-play">[5] ' +
      (state.isPlaying ? 'Pause' : 'Play') +
      '</button>' +
      '<button type="button" tabindex="0" data-jio-focus="1" class="j-btn j-btn-sec" data-act="seek-fwd">[9] +10s</button>' +
      '<button type="button" tabindex="0" data-jio-focus="1" class="j-btn j-btn-sec" data-act="next">[6] Next</button>' +
      '</div>' +
      '<div style="margin-top:5px;">' +
      '<button type="button" tabindex="0" data-jio-focus="1" class="j-btn j-btn-sec" data-act="vol-down">[*] Vol-</button>' +
      '<button type="button" tabindex="0" data-jio-focus="1" class="j-btn j-btn-sec" data-act="vol-up">[#] Vol+</button>' +
      '<button type="button" tabindex="0" data-jio-focus="1" class="j-btn j-btn-sec" data-act="toggle-repeat">' +
      (state.repeatOne ? 'Repeat: ONE' : 'Repeat: ALL') +
      '</button>' +
      '<button type="button" tabindex="0" data-jio-focus="1" class="j-btn j-btn-sec" data-act="toggle-shuffle">' +
      (state.shuffle ? 'Shuffle: ON' : 'Shuffle: OFF') +
      '</button>' +
      '</div>' +
      '<div style="margin-top:5px;">' +
      '<button type="button" tabindex="0" data-jio-focus="1" class="j-btn j-btn-sec" data-act="fav-current">' +
      (fav ? '&#9829; Saved' : '&#9825; Save') +
      '</button>' +
      '<button type="button" tabindex="0" data-jio-focus="1" class="j-btn j-btn-sec" data-act="toggle-lyrics">' +
      (state.showLyrics ? 'Hide Lyrics' : 'Lyrics') +
      '</button>' +
      '<a tabindex="0" data-jio-focus="1" class="j-btn j-btn-sec" href="' +
      escHtml(buildStreamUrl(curr, true)) +
      '" download>Download MP3</a>' +
      '</div>' +
      '</div>';

    if (state.showLyrics) {
      html +=
        '<div class="j-card" style="white-space:pre-wrap;font-size:11px;line-height:1.45;color:#E2E8F0;max-height:180px;overflow-y:auto;">' +
        '<div style="font-weight:bold;color:#7A90FF;margin-bottom:4px;">SONG LYRICS</div>' +
        (state.lyricsLoading ? 'Loading matched lyrics...' : escHtml(state.lyricsText || 'Press Lyrics to load')) +
        '</div>';
    }

    html += '<div class="j-sec-title">UP NEXT IN QUEUE (' + state.queue.length + ' SONGS)</div>';
    html += renderTrackListHtml(state.queue, 'queue');
    return html;
  }

  function renderSavedTab() {
    var html = '<div class="j-sec-title">SAVED FAVOURITES (' + state.favourites.length + ')</div>';
    if (state.favourites.length > 0) {
      html += renderTrackListHtml(state.favourites, 'fav');
    } else {
      html += '<div style="padding:10px;color:#94A3B8;">No saved songs yet. Press Save on any song.</div>';
    }
    html += '<div class="j-sec-title">RECENTLY PLAYED (' + state.recent.length + ')</div>';
    if (state.recent.length > 0) {
      html += renderTrackListHtml(state.recent, 'recent');
    } else {
      html += '<div style="padding:10px;color:#94A3B8;">No recent history yet.</div>';
    }
    return html;
  }

  function render() {
    injectStyles();
    var root = document.getElementById('root');
    if (!root) return;

    var curr = getCurrentTrack();
    var html =
      '<div id="jio-app">' +
      '<div id="jio-toast" style="display:' +
      (state.toastMsg ? 'block' : 'none') +
      ';">' +
      escHtml(state.toastMsg) +
      '</div>' +
      '<div class="j-hdr">' +
      '<div class="j-hdr-top">' +
      '<div class="j-logo">VIBRA<span>4G</span></div>' +
      '<div class="j-badge">' +
      (curr ? (state.isPlaying ? '&#9654; PLAYING' : 'PAUSED') : 'JIO F220B') +
      '</div>' +
      '</div>' +
      '</div>' +
      '<div class="j-nav">' +
      '<button type="button" tabindex="0" data-jio-focus="1" class="j-nav-btn' +
      (state.tab === 'home' ? ' act' : '') +
      '" data-act="nav" data-val="home">[1]Home</button>' +
      '<button type="button" tabindex="0" data-jio-focus="1" class="j-nav-btn' +
      (state.tab === 'singers' ? ' act' : '') +
      '" data-act="nav" data-val="singers">[0]Singers</button>' +
      '<button type="button" tabindex="0" data-jio-focus="1" class="j-nav-btn' +
      (state.tab === 'search' ? ' act' : '') +
      '" data-act="nav" data-val="search">[3]Search</button>' +
      '<button type="button" tabindex="0" data-jio-focus="1" class="j-nav-btn' +
      (state.tab === 'ai' ? ' act' : '') +
      '" data-act="nav" data-val="ai">AI</button>' +
      '<button type="button" tabindex="0" data-jio-focus="1" class="j-nav-btn' +
      (state.tab === 'player' ? ' act' : '') +
      '" data-act="nav" data-val="player">Play</button>' +
      '<button type="button" tabindex="0" data-jio-focus="1" class="j-nav-btn' +
      (state.tab === 'saved' ? ' act' : '') +
      '" data-act="nav" data-val="saved">Saved</button>' +
      '</div>';

    if (state.tab === 'home') html += renderHomeTab();
    else if (state.tab === 'singers') html += renderSingersTab();
    else if (state.tab === 'search') html += renderSearchTab();
    else if (state.tab === 'ai') html += renderAiTab();
    else if (state.tab === 'player') html += renderPlayerTab();
    else if (state.tab === 'saved') html += renderSavedTab();

    if (curr && state.tab !== 'player') {
      html +=
        '<div class="j-mini">' +
        '<div style="float:left;width:62%;overflow:hidden;">' +
        '<div class="j-title" style="font-size:10px;">' +
        escHtml(curr.title) +
        '</div>' +
        '<div class="j-sub" style="font-size:9px;">' +
        escHtml(curr.artist) +
        '</div>' +
        '</div>' +
        '<div style="float:right;">' +
        '<button type="button" tabindex="0" data-jio-focus="1" class="j-btn" style="padding:3px 6px;" data-act="toggle-play">' +
        (state.isPlaying ? 'Pause' : 'Play') +
        '</button>' +
        '<button type="button" tabindex="0" data-jio-focus="1" class="j-btn j-btn-sec" style="padding:3px 5px;" data-act="next">&raquo;</button>' +
        '<button type="button" tabindex="0" data-jio-focus="1" class="j-btn j-btn-sec" style="padding:3px 5px;" data-act="nav" data-val="player">Open</button>' +
        '</div>' +
        '</div>';
    }

    html +=
      '<div class="j-softbar">' +
      '<span style="float:left;">[2/8]Scroll [4/6]Prev/Next</span>' +
      '<span style="display:inline-block;width:28%;text-align:center;color:#FFF;font-weight:bold;">[5]Play</span>' +
      '<span style="float:right;">[*/#]Vol</span>' +
      '</div>' +
      '</div>';

    root.innerHTML = html;
  }

  function resolveListByName(name) {
    if (name === 'home') return state.homeTracks;
    if (name === 'singer') return state.singerTracksByCat[state.singerCat] || [];
    if (name === 'search') return state.searchTracks;
    if (name === 'ai') return state.aiTracks;
    if (name === 'queue') return state.queue;
    if (name === 'fav') return state.favourites;
    if (name === 'recent') return state.recent;
    return [];
  }

  function handleActionElement(el) {
    if (!el) return false;
    var act = el.getAttribute('data-act');
    if (!act) return false;

    if (act === 'nav') {
      state.tab = el.getAttribute('data-val') || 'home';
      render();
      return true;
    }
    if (act === 'home-cat') {
      state.homeCat = el.getAttribute('data-val') || 'trending';
      loadHomeTracks(false);
      return true;
    }
    if (act === 'home-lang') {
      state.homeLang = el.getAttribute('data-val') || 'all';
      loadHomeTracks(false);
      return true;
    }
    if (act === 'home-more') {
      loadHomeTracks(true);
      return true;
    }
    if (act === 'home-retry') {
      loadHomeTracks(false);
      return true;
    }
    if (act === 'open-singer') {
      var sIdx = parseInt(el.getAttribute('data-idx') || '0', 10);
      if (SINGERS[sIdx]) {
        state.tab = 'singers';
        openSinger(SINGERS[sIdx]);
      }
      return true;
    }
    if (act === 'back-singers') {
      state.selectedSinger = null;
      render();
      return true;
    }
    if (act === 'singer-cat') {
      state.singerCat = el.getAttribute('data-val') || 'all';
      var list = state.singerTracksByCat[state.singerCat] || [];
      render();
      if (list.length < 5) {
        loadMoreSingerCategorySongs(state.singerCat);
      }
      return true;
    }
    if (act === 'singer-load-more') {
      loadMoreSingerCategorySongs(state.singerCat);
      return true;
    }
    if (act === 'play-singer-cat') {
      var sList = state.singerTracksByCat[state.singerCat] || [];
      if (sList.length > 0) {
        playTrackFromList(sList[0], sList);
      }
      return true;
    }
    if (act === 'play-track') {
      var listName = el.getAttribute('data-list') || 'home';
      var idx = parseInt(el.getAttribute('data-idx') || '0', 10);
      var tracks = resolveListByName(listName);
      var target = tracks[idx];
      if (target) {
        var curr = getCurrentTrack();
        if (curr && curr.id === target.id) {
          togglePlayPause();
        } else {
          playTrackFromList(target, tracks);
        }
      }
      return true;
    }
    if (act === 'fav-track') {
      var fListName = el.getAttribute('data-list') || 'home';
      var fIdx = parseInt(el.getAttribute('data-idx') || '0', 10);
      var fTracks = resolveListByName(fListName);
      if (fTracks[fIdx]) {
        toggleFav(fTracks[fIdx]);
      }
      return true;
    }
    if (act === 'fav-current') {
      var cTrack = getCurrentTrack();
      if (cTrack) toggleFav(cTrack);
      return true;
    }
    if (act === 'run-search') {
      var inp = document.getElementById('jio-search-input');
      if (inp) state.searchQuery = inp.value;
      runSearch(state.searchQuery);
      return true;
    }
    if (act === 'quick-search') {
      var qVal = el.getAttribute('data-val') || '';
      runSearch(qVal);
      return true;
    }
    if (act === 'run-ai') {
      var aiInp = document.getElementById('jio-ai-input');
      if (aiInp) state.aiPrompt = aiInp.value;
      runAiDiscovery(state.aiPrompt);
      return true;
    }
    if (act === 'quick-ai') {
      var aiVal = el.getAttribute('data-val') || '';
      runAiDiscovery(aiVal);
      return true;
    }
    if (act === 'toggle-play') {
      togglePlayPause();
      return true;
    }
    if (act === 'next') {
      playNextTrack();
      return true;
    }
    if (act === 'prev') {
      playPrevTrack();
      return true;
    }
    if (act === 'seek-back') {
      seekBySeconds(-10);
      return true;
    }
    if (act === 'seek-fwd') {
      seekBySeconds(10);
      return true;
    }
    if (act === 'vol-down') {
      adjustVolume(-0.1);
      return true;
    }
    if (act === 'vol-up') {
      adjustVolume(0.1);
      return true;
    }
    if (act === 'toggle-repeat') {
      state.repeatOne = !state.repeatOne;
      showToast(state.repeatOne ? 'Repeat One Song ON' : 'Repeat Queue ON');
      render();
      return true;
    }
    if (act === 'toggle-shuffle') {
      state.shuffle = !state.shuffle;
      showToast(state.shuffle ? 'Shuffle ON' : 'Shuffle OFF');
      render();
      return true;
    }
    if (act === 'toggle-lyrics') {
      state.showLyrics = !state.showLyrics;
      if (state.showLyrics && !state.lyricsText) {
        loadLyricsForCurrent();
      } else {
        render();
      }
      return true;
    }
    return false;
  }

  function findActionParent(node) {
    var curr = node;
    while (curr && curr !== document.body) {
      if (curr.tagName && curr.tagName.toUpperCase() === 'A' && curr.getAttribute('href')) {
        return null;
      }
      if (curr.getAttribute && curr.getAttribute('data-act')) {
        return curr;
      }
      curr = curr.parentNode;
    }
    return null;
  }

  document.addEventListener(
    'click',
    function (e) {
      var target = e.target || e.srcElement;
      var actNode = findActionParent(target);
      if (actNode) {
        e.preventDefault();
        e.stopPropagation();
        handleActionElement(actNode);
      }
    },
    false
  );

  document.addEventListener(
    'keydown',
    function (e) {
      var active = document.activeElement;
      var tag = active && active.tagName ? active.tagName.toUpperCase() : '';
      var isInput = tag === 'INPUT' || tag === 'TEXTAREA';
      var key = e.key || '';
      var code = e.keyCode || e.which || 0;

      if (isInput) {
        if (key === 'Enter' || code === 13) {
          if (active.id === 'jio-search-input') {
            e.preventDefault();
            state.searchQuery = active.value;
            runSearch(state.searchQuery);
            return;
          }
          if (active.id === 'jio-ai-input') {
            e.preventDefault();
            state.aiPrompt = active.value;
            runAiDiscovery(state.aiPrompt);
            return;
          }
        }
        return;
      }

      // Note: Do NOT intercept D-Pad arrows, Enter (OK button), or Menu/Softkeys
      // so the JioPhone browser virtual mouse cursor, OK click, and browser menu work natively.

      // JioPhone Hardware Number Keys
      if (key === '1' || code === 49) {
        e.preventDefault();
        state.tab = 'home';
        render();
      } else if (key === '2' || code === 50) {
        e.preventDefault();
        window.scrollBy(0, -140);
      } else if (key === '3' || code === 51) {
        e.preventDefault();
        state.tab = 'search';
        render();
      } else if (key === '4' || code === 52) {
        e.preventDefault();
        playPrevTrack();
        showToast('Previous Song');
      } else if (key === '5' || code === 53) {
        e.preventDefault();
        togglePlayPause();
      } else if (key === '6' || code === 54) {
        e.preventDefault();
        playNextTrack();
        showToast('Next Song');
      } else if (key === '7' || code === 55) {
        e.preventDefault();
        seekBySeconds(-10);
        showToast('Rewind -10s');
      } else if (key === '8' || code === 56) {
        e.preventDefault();
        window.scrollBy(0, 140);
      } else if (key === '9' || code === 57) {
        e.preventDefault();
        seekBySeconds(10);
        showToast('Forward +10s');
      } else if (key === '0' || code === 48) {
        e.preventDefault();
        state.tab = 'singers';
        render();
      } else if (key === '*') {
        e.preventDefault();
        adjustVolume(-0.1);
      } else if (key === '#') {
        e.preventDefault();
        adjustVolume(0.1);
      }
    },
    false
  );

  // Boot UI immediately
  render();
  loadHomeTracks(false);
})();
