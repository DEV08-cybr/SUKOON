(() => {
  const $ = (id) => document.getElementById(id);
  const resultsBox = $('results');
  const audio = $('audio-player');
  const audioExtensions = /\.(flac|wav|wave|aiff|aif|mp3|m4a|aac|ogg|oga|opus|webm)$/i;
  const playlistStorageKey = 'ambient-player-youtube-playlists-v1';
  const playlistMetadataStorageKey = 'ambient-player-youtube-metadata-v1';
  const playlistMetadataFreshMs = 24 * 60 * 60 * 1000;
  function loadPlaylistMetadataCache() {
    try {
      const parsed = JSON.parse(localStorage.getItem(playlistMetadataStorageKey) || '{}');
      return parsed && parsed.version === 1 && parsed.entries && typeof parsed.entries === 'object' ? parsed.entries : {};
    } catch { return {}; }
  }
  let playlistMetadataCache = loadPlaylistMetadataCache();
  function getCachedPlaylistMetadata(id) {
    const entry = playlistMetadataCache[id];
    if (!entry || !entry.data || !Array.isArray(entry.data.relatedStreams) || !entry.data.relatedStreams.length) return null;
    return entry;
  }
  function cleanPlaylistMetadata(data) {
    const relatedStreams = Array.isArray(data.relatedStreams) ? data.relatedStreams.slice(0, 300).map((item) => {
      const clean = {};
      for (const key of ['url', 'title', 'thumbnail', 'uploaderName', 'uploadedDate']) {
        if (typeof item?.[key] === 'string') clean[key] = item[key].slice(0, 2048);
      }
      for (const key of ['duration', 'views']) {
        if (Number.isFinite(Number(item?.[key]))) clean[key] = Number(item[key]);
      }
      return clean;
    }) : [];
    return {
      name: typeof data.name === 'string' ? data.name.slice(0, 200) : '',
      thumbnailUrl: typeof data.thumbnailUrl === 'string' ? data.thumbnailUrl.slice(0, 2048) : '',
      uploader: typeof data.uploader === 'string' ? data.uploader.slice(0, 200) : '',
      videos: Number.isFinite(Number(data.videos)) ? Number(data.videos) : 0,
      relatedStreams,
      nextpage: typeof data.nextpage === 'string' ? data.nextpage.slice(0, 50000) : ''
    };
  }
  function persistPlaylistMetadataCache() {
    const save = () => localStorage.setItem(playlistMetadataStorageKey, JSON.stringify({ version: 1, entries: playlistMetadataCache }));
    try { save(); return true; } catch {}
    const oldestFirst = Object.entries(playlistMetadataCache)
      .sort((a, b) => (Number(a[1]?.savedAt) || 0) - (Number(b[1]?.savedAt) || 0))
      .map(([id]) => id);
    for (const id of oldestFirst) {
      if (Object.keys(playlistMetadataCache).length <= 1) break;
      delete playlistMetadataCache[id];
      try { save(); return true; } catch {}
    }
    return false;
  }
  function savePlaylistMetadata(id, data) {
    playlistMetadataCache[id] = { savedAt: Date.now(), data: cleanPlaylistMetadata(data) };
    persistPlaylistMetadataCache();
  }
  // Curated YouTube playlists supplied by the site owner. Titles and counts were
  // read from playlist metadata; cards and track lists never request stream URLs.
  const curatedPlaylists = [
    { id: 'PLGaC5uCCCZdV338sFIOVc1duZFjQcgBPG', title: '0LD SON DEE', count: 152, owner: 'DEV KUMAR MISTRY' },
    { id: 'PLGaC5uCCCZdXAEof5sYmpqoA4r9MJ97dW', title: 'Arijit Singh Bengali Songs', count: 60, owner: 'DEV KUMAR MISTRY' },
    { id: 'PLGaC5uCCCZdV4ZTmI2xjLCF3YBTQ-sB3U', title: 'BANGLA', count: 85, owner: 'DEV KUMAR MISTRY' },
    { id: 'PLGaC5uCCCZdX-FuNQUbSHD-wu9Qp31rh7', title: 'DEVOTIONAL', count: 65, owner: 'DEV KUMAR MISTRY' },
    { id: 'PLFuluJkepmnOhbfOdMkLHrEm40OHXWHPo', title: 'Jaya Kishori Ji Hit Bhajans', count: 82, owner: 'Bhajan Vandana' },
    { id: 'PLGaC5uCCCZdUHIfjM2Dc8iXh8j35vS1ty', title: 'LIKED SONGS', count: 110, owner: 'DEV KUMAR MISTRY' },
    { id: 'PLGaC5uCCCZdUdn-vzqHl1j5uE3UG_OBJ_', title: 'MY SUKOON', count: 264, owner: 'DEV KUMAR MISTRY' },
    { id: 'PLGaC5uCCCZdVlgXnKpp8RBAlv3BxnfKmH', title: 'MY-PLAYLIST', count: 80, owner: 'DEV KUMAR MISTRY' },
    { id: 'PLGaC5uCCCZdVZw_XlkM8Mfb4UsPyGkZa2', title: 'MY-TRACK', count: 75, owner: 'DEV KUMAR MISTRY' },
    { id: 'PLGaC5uCCCZdWClFkKAmBHR7BQb_yrKkaH', title: 'PUNJABI HITZZ', count: 43, owner: 'DEV KUMAR MISTRY' },
    { id: 'PLGaC5uCCCZdXF3LhWt06W9xkKpJjs18jY', title: 'SONGS', count: 126, owner: 'DEV KUMAR MISTRY' },
    { id: 'PLGaC5uCCCZdXHvQ5AedvEC1GyTRPPIoU-', title: 'Update', count: 101, owner: 'DEV KUMAR MISTRY' },
    { id: 'PLTu1dSkMBtEwkvddE0OgtBMWyVAZgj7E0', title: 'Ustad Nusrat Fateh Ali Khan Live in Concert', count: 9, owner: 'Oriental Star Agencies Ltd' },
    { id: 'PLGaC5uCCCZdX5HcoFc7pcVeLsbI0g7CCu', title: 'Wishes', count: 55, owner: 'DEV KUMAR MISTRY' }
  ];
  let customPlaylists = loadCustomPlaylists();
  let queue = [];
  let currentIndex = -1;
  let externalSources = [];
  let searchToken = 0;
  let usingYouTube = false;
  let youtubeIsPlaying = false;
  let youtubeDuration = 0;
  let youtubeCurrentTime = 0;
  let youtubeLoadAttempt = 0;
  let activeYouTubePlaylistId = '';
  let activeYouTubePlaylistCount = 0;
  let activeYouTubeTracks = [];
  let activeYouTubeTrackIndex = -1;

  function setupBackdropDrift() {
    const backdrop = document.querySelector('.backdrop');
    if (!backdrop) return;
    const image = new Image();
    const updateDistance = () => {
      if (!image.naturalWidth || !image.naturalHeight) return;
      const tileWidth = Math.min(window.innerWidth, window.innerHeight * 0.8);
      const tileHeight = tileWidth * image.naturalHeight / image.naturalWidth;
      backdrop.style.setProperty('--bg-scroll-distance', `${-tileHeight}px`);
    };
    image.addEventListener('load', updateDistance, { once: true });
    image.src = new URL('assets/background.jpeg', document.baseURI).href;
    if (image.complete && image.naturalWidth) updateDistance();
    window.addEventListener('resize', updateDistance, { passive: true });
  }
  setupBackdropDrift();

  function updateClock() {
    $('clock').textContent = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).format(new Date()) + ' IST';
  }
  updateClock(); setInterval(updateClock, 1000);

  function showMessage(text) {
    resultsBox.replaceChildren();
    const message = document.createElement('div'); message.className = 'message'; message.textContent = text;
    resultsBox.appendChild(message); resultsBox.classList.add('open');
  }
  function formatTime(value) {
    const seconds = Math.max(0, Math.floor(Number(value) || 0));
    const mins = Math.floor(seconds / 60); const secs = String(seconds % 60).padStart(2, '0');
    return mins >= 60 ? `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}:${secs}` : `${mins}:${secs}`;
  }
  function setRangeFill(el) {
    const pct = (Number(el.value) / (Number(el.max) || 100)) * 100;
    el.style.background = `linear-gradient(to right,#ececf0 0%,#ececf0 ${pct}%,rgba(255,255,255,.25) ${pct}%,rgba(255,255,255,.25) 100%)`;
  }
  document.querySelectorAll('input[type="range"]').forEach((el) => {
    setRangeFill(el); el.addEventListener('input', () => setRangeFill(el));
  });

  async function requestJson(url, timeoutMs = 20000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!response.ok) {
        let detail = `Request failed (${response.status})`;
        try { const body = await response.json(); if (body.error) detail = body.error; } catch {}
        throw new Error(detail);
      }
      return await response.json();
    } finally { clearTimeout(timer); }
  }
  function videoIdFromUrl(url) {
    try { return new URL(url, 'https://www.youtube.com').searchParams.get('v') || ''; }
    catch { return ''; }
  }
  $('addButton').addEventListener('click', () => $('addPanel').classList.toggle('open'));
  $('queueToggle').addEventListener('click', () => {
    $('addPanel').classList.add('open'); renderQueue();
    $('queueList').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });

  $('searchForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const query = $('query').value.trim();
    if (!query) { $('query').focus(); return; }
    searchYouTube(query);
  });

  async function searchYouTube(query) {
    const token = ++searchToken;
    showMessage('Searching YouTube music…');
    try {
      const musicParams = new URLSearchParams({ q: query, filter: 'music_songs' });
      const musicData = await requestJson(`/api/youtube/search?${musicParams}`);
      const collected = [...(musicData.items || [])];
      try {
        const videoParams = new URLSearchParams({ q: query, filter: 'videos' });
        const videoData = await requestJson(`/api/youtube/search?${videoParams}`);
        collected.push(...(videoData.items || []));
      } catch { /* music search results remain useful on their own */ }
      const seen = new Set();
      const results = collected.filter((item) => {
        const id = videoIdFromUrl(item.url);
        if (!id || seen.has(id)) return false;
        seen.add(id); item.videoId = id; return true;
      }).slice(0, 40);
      if (token !== searchToken) return;
      if (!results.length) { showMessage('No YouTube results found. Try another search.'); return; }
      renderYouTubeResults(results);
    } catch (error) {
      if (token === searchToken) showMessage(error.message || 'YouTube search is temporarily unavailable. Try again shortly.');
    }
  }

  function renderYouTubeResults(items) {
    resultsBox.replaceChildren();
    const note = document.createElement('div'); note.className = 'message';
    note.textContent = `${items.length} YouTube results · Play Here uses YouTube’s official player; ads may appear.`;
    resultsBox.appendChild(note);
    items.forEach((item) => {
      const id = item.videoId;
      const entry = document.createElement('div'); entry.className = 'result-entry';
      const playButton = document.createElement('button'); playButton.type = 'button'; playButton.className = 'result';
      const img = document.createElement('img'); img.className = 'thumb'; img.alt = ''; img.loading = 'lazy';
      img.src = item.thumbnail || `https://i.ytimg.com/vi/${encodeURIComponent(id)}/mqdefault.jpg`;
      img.onerror = () => { img.style.visibility = 'hidden'; };
      const copy = document.createElement('span'); copy.className = 'result-copy';
      const title = document.createElement('span'); title.className = 'result-title'; title.textContent = item.title || 'YouTube track';
      const channel = document.createElement('span'); channel.className = 'result-channel'; channel.textContent = item.uploaderName || item.uploader || 'YouTube';
      copy.append(title, channel); playButton.append(img, copy);
      playButton.addEventListener('click', () => playSingleYouTubeVideo(id, title.textContent, channel.textContent));
      const actions = document.createElement('span'); actions.className = 'result-actions';
      const play = document.createElement('button'); play.type = 'button'; play.className = 'result-hover-play'; play.textContent = '▶';
      play.setAttribute('aria-label', `Play ${title.textContent}`);
      play.addEventListener('click', () => playSingleYouTubeVideo(id, title.textContent, channel.textContent));
      const open = document.createElement('a'); open.className = 'result-action';
      open.href = `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
      open.target = '_blank'; open.rel = 'noopener noreferrer'; open.textContent = 'OPEN ↗';
      actions.append(play, open); entry.append(playButton, actions); resultsBox.appendChild(entry);
    });
    resultsBox.classList.add('open');
  }

  let playlistDetailToken = 0;
  function youtubePlaylistUrl(id) { return `https://www.youtube.com/playlist?list=${encodeURIComponent(id)}`; }
  function renderPlaylistCards() {
    const grid = $('playlistGrid'); grid.replaceChildren();
    $('curatedPlaylistCount').textContent = `${curatedPlaylists.length} PLAYLISTS`;
    curatedPlaylists.forEach((playlist, index) => {
      const card = document.createElement('article'); card.className = 'playlist-card';
      const top = document.createElement('span'); top.className = 'playlist-card-top';
      const number = document.createElement('span'); number.className = 'playlist-index';
      number.textContent = `${String(index + 1).padStart(2, '0')} / ${String(curatedPlaylists.length).padStart(2, '0')}`;
      const type = document.createElement('span'); type.className = 'playlist-type'; type.textContent = 'YouTube';
      top.append(number, type);
      const title = document.createElement('span'); title.className = 'playlist-card-title'; title.textContent = playlist.title;
      const meta = document.createElement('span'); meta.className = 'playlist-card-meta'; meta.textContent = playlist.owner;
      const footer = document.createElement('span'); footer.className = 'playlist-card-footer';
      const count = document.createElement('span'); count.textContent = `${playlist.count} videos`;
      const action = document.createElement('span'); action.textContent = 'VIEW TRACKS ↗';
      footer.append(count, action);
      const open = document.createElement('button'); open.type = 'button'; open.className = 'playlist-card-open';
      open.setAttribute('aria-label', `View tracks in ${playlist.title}`);
      open.addEventListener('click', () => openPlaylist(playlist));
      const play = document.createElement('button'); play.type = 'button'; play.className = 'playlist-card-play';
      play.textContent = '▶ PLAY'; play.setAttribute('aria-label', `Play playlist ${playlist.title}`);
      play.addEventListener('click', (event) => { event.stopPropagation(); openPlaylist(playlist, false, true); });
      card.append(top, title, meta, footer, open, play); grid.appendChild(card);
    });
  }
  function setPlaylistRoute(playlistId) {
    const hash = playlistId ? `#playlist=${encodeURIComponent(playlistId)}` : '';
    history.pushState(playlistId ? { playlistId } : {}, '', `${location.pathname}${location.search}${hash}`);
  }
  function setVideoRoute(videoId) {
    history.pushState({ videoId }, '', `${location.pathname}${location.search}#video=${encodeURIComponent(videoId)}`);
  }
  const YOUTUBE_PLAYER_ID = 'youtubeFrame';
  let youtubePlayer = null;
  let youtubeApiReady = false;
  let youtubeApiFailed = false;
  let youtubePlayerReady = false;
  let youtubePlayerCreating = false;
  let pendingYouTubeRequest = null;
  let youtubeLastPlayerError = false;
  let youtubeAutoplayBlocked = false;
  let youtubeShouldAutoPlay = false;
  let youtubeAutoSkipInProgress = false;
  let youtubeAutoSkipCount = 0;
  let youtubeLastHandledError = '';
  const MAX_CONSECUTIVE_EMBED_SKIPS = 8;

  function setYouTubeFailure(message) {
    youtubeLastPlayerError = true;
    youtubeShouldAutoPlay = false;
    youtubeAutoSkipInProgress = false;
    youtubeIsPlaying = false;
    setPlaying(false);
    $('detailSubtitle').textContent = `${message} Use OPEN on YouTube if this video cannot play here.`;
    $('trackSub').textContent = 'YouTube playback unavailable · Open on YouTube';
  }
  function validYouTubeVideoId(value) {
    return /^[A-Za-z0-9_-]{6,20}$/.test(value || '');
  }
  function validYouTubePlaylistId(value) {
    return /^[A-Za-z0-9_-]{5,128}$/.test(value || '');
  }
  function loadYouTubeIframeApi() {
    if (window.YT && window.YT.Player) {
      youtubeApiReady = true;
      if (pendingYouTubeRequest) ensureYouTubePlayer();
      return;
    }
    if (document.getElementById('youtube-iframe-api')) return;
    const script = document.createElement('script');
    script.id = 'youtube-iframe-api';
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => {
      youtubeApiFailed = true;
      youtubeApiReady = false;
      if (usingYouTube) setYouTubeFailure('Could not load YouTube’s official player API. Check your connection or content blocker.');
    };
    window.onYouTubeIframeAPIReady = () => {
      youtubeApiReady = Boolean(window.YT && window.YT.Player);
      youtubeApiFailed = !youtubeApiReady;
      if (youtubeApiReady && pendingYouTubeRequest) ensureYouTubePlayer();
      else if (!youtubeApiReady && usingYouTube) setYouTubeFailure('YouTube’s official player API did not initialize.');
    };
    document.head.appendChild(script);
  }
  function ensureYouTubePlayer() {
    if (!youtubeApiReady || !window.YT || !window.YT.Player || youtubePlayer || youtubePlayerCreating) return;
    const request = pendingYouTubeRequest;
    if (!request) return;
    const selection = request.selection;
    const playerVars = {
      autoplay: request.autoplay ? 1 : 0,
      controls: 1,
      playsinline: 1,
      rel: 0,
      enablejsapi: 1,
      origin: location.origin
    };
    const options = {
      width: 640,
      height: 360,
      playerVars,
      events: {
        onReady: onYouTubePlayerReady,
        onStateChange: onYouTubePlayerStateChange,
        onError: onYouTubePlayerError,
        onAutoplayBlocked: onYouTubeAutoplayBlocked
      }
    };
    if (selection.type === 'video' && validYouTubeVideoId(selection.videoId)) {
      options.videoId = selection.videoId;
    } else if (selection.type === 'playlist' && validYouTubePlaylistId(selection.id)) {
      playerVars.listType = 'playlist';
      playerVars.list = selection.id;
    }
    youtubePlayerCreating = true;
    try {
      youtubePlayer = new window.YT.Player(YOUTUBE_PLAYER_ID, options);
    } catch (error) {
      youtubePlayerCreating = false;
      youtubePlayer = null;
      setYouTubeFailure('YouTube’s player could not be created in this browser.');
    }
  }
  function onYouTubePlayerReady(event) {
    youtubePlayer = event.target;
    youtubePlayerCreating = false;
    youtubePlayerReady = true;
    youtubeApiFailed = false;
    try {
      const iframe = youtubePlayer.getIframe();
      iframe.title = 'Official YouTube music player';
      iframe.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; web-share');
      iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
      iframe.setAttribute('allowfullscreen', '');
      youtubePlayer.setVolume(Number($('volume').value));
    } catch {}
    if (pendingYouTubeRequest) applyYouTubeRequest(pendingYouTubeRequest);
    else $('detailSubtitle').textContent = 'YouTube player ready.';
  }
  function applyYouTubeRequest(request) {
    if (!request || request.applied || !youtubePlayerReady || !youtubePlayer) return;
    const selection = request.selection;
    youtubeLastPlayerError = false;
    youtubeAutoplayBlocked = false;
    try {
      if (selection.type === 'playlist') {
        if (!validYouTubePlaylistId(selection.id)) throw new Error('Invalid YouTube playlist ID.');
        const playlist = {
          listType: 'playlist',
          list: selection.id,
          index: Number.isInteger(selection.index) && selection.index >= 0 ? selection.index : 0
        };
        if (request.autoplay) youtubePlayer.loadPlaylist(playlist);
        else youtubePlayer.cuePlaylist(playlist);
      } else {
        if (!validYouTubeVideoId(selection.videoId)) throw new Error('Invalid YouTube video ID.');
        const video = { videoId: selection.videoId };
        if (request.autoplay) youtubePlayer.loadVideoById(video);
        else youtubePlayer.cueVideoById(video);
      }
      request.applied = true;
      if (pendingYouTubeRequest === request) pendingYouTubeRequest = null;
      $('detailSubtitle').textContent = request.autoplay
        ? 'Starting song in YouTube’s official player… If autoplay is blocked, press Play in the player. Ads may appear.'
        : 'Player ready · press Play in the player or use the fixed controls. Ads may appear.';
      const attempt = request.attempt;
      window.setTimeout(() => {
        if (attempt !== youtubeLoadAttempt || !usingYouTube || youtubeLastPlayerError || !youtubePlayerReady) return;
        let state = -1;
        try { state = youtubePlayer.getPlayerState(); } catch {}
        if (state === 1 || state === 3 || state === 5) return;
        $('detailSubtitle').textContent = 'If playback did not start, press ▶ in the YouTube player or fixed player controls. Ads may appear.';
      }, 10000);
    } catch (error) {
      request.applied = true;
      if (pendingYouTubeRequest === request) pendingYouTubeRequest = null;
      setYouTubeFailure(error.message || 'Could not load this YouTube item.');
    }
  }
  function onYouTubePlayerStateChange(event) {
    if (!usingYouTube) return;
    const state = Number(event.data);
    youtubeIsPlaying = state === window.YT.PlayerState.PLAYING;
    if (youtubeIsPlaying) {
      youtubeShouldAutoPlay = true;
      youtubeAutoSkipCount = 0;
      youtubeAutoSkipInProgress = false;
      youtubeAutoplayBlocked = false;
      if (activeYouTubePlaylistId && activeYouTubeTrackIndex < 0) {
        try {
          const nativeIndex = Number(youtubePlayer.getPlaylistIndex());
          if (Number.isInteger(nativeIndex) && nativeIndex >= 0) activeYouTubeTrackIndex = nativeIndex;
        } catch {}
      }
      $('detailSubtitle').textContent = 'Now playing in YouTube’s official player · ads may appear.';
    } else if (state === window.YT.PlayerState.PAUSED && !youtubeAutoSkipInProgress) {
      youtubeShouldAutoPlay = false;
    }
    setPlaying(youtubeIsPlaying);
    updateYouTubeProgress();
    if (state === window.YT.PlayerState.ENDED && activeYouTubeTrackIndex >= 0) {
      window.setTimeout(() => navigateYouTubePlaylist(1), 0);
    }
  }
  function onYouTubePlayerError(event) {
    const code = Number(event.data);
    const messages = {
      2: 'YouTube rejected this video ID.',
      5: 'YouTube could not decode this video in the embedded player.',
      100: 'YouTube says this video is unavailable, private, or removed.',
      101: 'YouTube refused embedded playback (video restriction or sign-in/access check).',
      150: 'YouTube refused embedded playback (video restriction or sign-in/access check).',
      153: 'YouTube could not verify the player’s site origin/referrer.'
    };
    const errorKey = `${youtubeLoadAttempt}:${code}`;
    if (youtubeLastHandledError === errorKey) return;
    youtubeLastHandledError = errorKey;
    const skippable = [2, 5, 100, 101, 150].includes(code);
    if (skippable && youtubeShouldAutoPlay && activeYouTubePlaylistId && youtubeAutoSkipCount < MAX_CONSECUTIVE_EMBED_SKIPS) {
      youtubeAutoSkipCount++;
      youtubeAutoSkipInProgress = true;
      youtubeIsPlaying = false;
      setPlaying(false);
      $('detailSubtitle').textContent = `This track cannot play in the embed. Trying the next playlist track (${youtubeAutoSkipCount}/${MAX_CONSECUTIVE_EMBED_SKIPS})…`;
      const failedAttempt = youtubeLoadAttempt;
      window.setTimeout(() => {
        if (failedAttempt !== youtubeLoadAttempt || !usingYouTube || !youtubeShouldAutoPlay) return;
        if (!navigateYouTubePlaylist(1, true)) {
          youtubeAutoSkipInProgress = false;
          setYouTubeFailure(`${messages[code] || 'YouTube player error.'} (error ${code})`);
        }
      }, 450);
      return;
    }
    youtubeAutoSkipInProgress = false;
    const extra = youtubeAutoSkipCount >= MAX_CONSECUTIVE_EMBED_SKIPS
      ? ` Skipped ${youtubeAutoSkipCount} consecutive restricted/unavailable playlist items; press Next to continue.`
      : '';
    setYouTubeFailure(`${messages[code] || 'YouTube player error.'} (error ${code}).${extra}`);
  }
  function onYouTubeAutoplayBlocked() {
    if (!usingYouTube) return;
    youtubeIsPlaying = false;
    youtubeShouldAutoPlay = false;
    youtubeAutoSkipInProgress = false;
    youtubeAutoplayBlocked = true;
    setPlaying(false);
    $('detailSubtitle').textContent = 'Your browser blocked automatic playback. Press ▶ inside YouTube or use the fixed Play control; ads may appear.';
  }
  function updateYouTubeProgress() {
    if (!youtubePlayerReady || !youtubePlayer) return;
    try {
      const current = Number(youtubePlayer.getCurrentTime());
      const duration = Number(youtubePlayer.getDuration());
      if (Number.isFinite(current)) youtubeCurrentTime = current;
      if (Number.isFinite(duration) && duration > 0) youtubeDuration = duration;
      $('elapsed').textContent = formatTime(youtubeCurrentTime);
      if (youtubeDuration > 0) {
        $('duration').textContent = formatTime(youtubeDuration);
        $('progress').value = Math.round(youtubeCurrentTime / youtubeDuration * 1000);
        setRangeFill($('progress'));
      }
    } catch {}
  }
  function postYouTubeCommand(func, args = []) {
    if (!youtubePlayerReady || !youtubePlayer) return;
    try {
      if (func === 'playVideo') youtubePlayer.playVideo();
      else if (func === 'pauseVideo') youtubePlayer.pauseVideo();
      else if (func === 'nextVideo') youtubePlayer.nextVideo();
      else if (func === 'previousVideo') youtubePlayer.previousVideo();
      else if (func === 'seekTo') youtubePlayer.seekTo(Number(args[0]), Boolean(args[1]));
      else if (func === 'setVolume') youtubePlayer.setVolume(Number(args[0]));
    } catch {}
  }
  function setYouTubeSelection(selection, autoplay = false, automaticSkip = false) {
    usingYouTube = true;
    if (!automaticSkip) { youtubeAutoSkipCount = 0; youtubeAutoSkipInProgress = false; }
    youtubeShouldAutoPlay = autoplay;
    youtubeLastHandledError = '';
    activeYouTubePlaylistId = selection.type === 'playlist' ? selection.id : (selection.playlistId || '');
    activeYouTubeTrackIndex = Number.isInteger(selection.trackIndex) ? selection.trackIndex : -1;
    currentIndex = -1;
    audio.pause(); audio.removeAttribute('src'); audio.load();
    youtubeIsPlaying = false; youtubeDuration = 0; youtubeCurrentTime = 0; youtubeLastPlayerError = false; youtubeAutoplayBlocked = false;
    $('elapsed').textContent = '0:00'; $('duration').textContent = '0:00'; $('progress').value = 0; setRangeFill($('progress'));
    $('trackTitle').textContent = selection.title || (selection.type === 'playlist' ? 'YouTube playlist' : 'YouTube video');
    $('trackSub').textContent = selection.uploader ? `${selection.uploader} · Official YouTube player` : 'Official YouTube player · ads may appear';
    setPlaying(false);
    const attempt = ++youtubeLoadAttempt;
    pendingYouTubeRequest = { selection, autoplay, attempt, applied: false };
    if (youtubeApiFailed) {
      setYouTubeFailure('Could not load YouTube’s official player API. Check your connection/content blocker, then refresh.');
      return;
    }
    $('detailSubtitle').textContent = youtubeApiReady
      ? 'Preparing YouTube’s official player…'
      : 'Connecting to YouTube’s official player…';
    loadYouTubeIframeApi();
    ensureYouTubePlayer();
    if (youtubePlayerReady) applyYouTubeRequest(pendingYouTubeRequest);
    const frame = $('youtubeFrame');
    frame.scrollIntoView({ block: 'center', behavior: 'smooth' });
    window.setTimeout(() => {
      if (attempt !== youtubeLoadAttempt || !usingYouTube || youtubeLastPlayerError) return;
      if (!youtubePlayerReady) $('detailSubtitle').textContent = 'YouTube is taking longer to load. Check your connection or use OPEN on YouTube.';
    }, 15000);
  }
  function pollYouTubePlayer() {
    if (usingYouTube) updateYouTubeProgress();
  }
  loadYouTubeIframeApi();
  function showPlaylistHome(fromHistory = false) {
    playlistDetailToken++;
    if (usingYouTube) postYouTubeCommand('pauseVideo');
    usingYouTube = false;
    youtubeIsPlaying = false;
    activeYouTubePlaylistId = '';
    activeYouTubePlaylistCount = 0;
    activeYouTubeTrackIndex = -1;
    activeYouTubeTracks = [];
    $('playlistDetail').hidden = true;
    $('playlistHome').hidden = false;
    if (!fromHistory && location.hash) setPlaylistRoute('');
    setPlaying(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function openPlaylist(playlist, fromHistory = false, autoplay = false) {
    const token = ++playlistDetailToken;
    if (!fromHistory) setPlaylistRoute(playlist.id);
    $('playlistHome').hidden = true; $('playlistDetail').hidden = false; $('playlistTracks').hidden = false;
    $('detailTitle').textContent = playlist.title;
    $('detailSubtitle').textContent = `${playlist.owner || 'YouTube playlist'} · ${playlist.count ? `${playlist.count} videos · ` : ''}Official YouTube player · ads may appear.`;
    $('detailYoutubeLink').href = youtubePlaylistUrl(playlist.id);
    activeYouTubePlaylistCount = Number(playlist.count) || 0; activeYouTubeTracks = []; activeYouTubeTrackIndex = -1;
    setYouTubeSelection({ type: 'playlist', id: playlist.id, title: playlist.title }, autoplay);
    const list = $('playlistTracks'); list.replaceChildren();
    const loading = document.createElement('div'); loading.className = 'message'; loading.textContent = 'Loading playlist tracks…';
    list.appendChild(loading);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    loadPlaylistPage(playlist, token, '', false);
  }
  function playSingleYouTubeVideo(videoId, title, uploader, fromHistory = false) {
    playlistDetailToken++; resultsBox.classList.remove('open');
    activeYouTubePlaylistCount = 0; activeYouTubeTracks = []; activeYouTubeTrackIndex = -1;
    $('playlistHome').hidden = true; $('playlistDetail').hidden = false; $('playlistTracks').hidden = true;
    $('detailTitle').textContent = title || 'YouTube video';
    $('detailSubtitle').textContent = 'Official YouTube player · ads may appear.';
    $('detailYoutubeLink').href = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
    if (!fromHistory) setVideoRoute(videoId);
    setYouTubeSelection({ type: 'video', videoId, title, uploader }, !fromHistory);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function playYouTubePlaylistIndex(playlist, index, videoId = '', title = '', uploader = '', automaticSkip = false) {
    $('detailTitle').textContent = playlist.title;
    $('detailSubtitle').textContent = 'Official YouTube player · ads may appear.';
    $('detailYoutubeLink').href = videoId
      ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&list=${encodeURIComponent(playlist.id)}&index=${index + 1}`
      : youtubePlaylistUrl(playlist.id);
    if (videoId) {
      setYouTubeSelection({ type: 'video', videoId, title, uploader, playlistId: playlist.id, trackIndex: index }, true, automaticSkip);
    } else {
      setYouTubeSelection({ type: 'playlist', id: playlist.id, index, trackIndex: index, title: playlist.title }, true, automaticSkip);
    }
  }
  function renderPlaylistMetadata(playlist, token, data, append = false, fromCache = false) {
    const list = $('playlistTracks');
    const loadMoreButton = append ? list.querySelector('.load-more') : null;
    const streams = Array.isArray(data.relatedStreams) ? data.relatedStreams : [];
    if (!streams.length) throw new Error('No track metadata returned');
    if (data.name) $('detailTitle').textContent = data.name;
    const total = Number(data.videos) || playlist.count || streams.length;
    if (activeYouTubePlaylistId === playlist.id) activeYouTubePlaylistCount = total;
    const owner = data.uploader || playlist.owner || 'YouTube playlist';
    if (!youtubeLastPlayerError && !youtubeAutoplayBlocked) {
      $('detailSubtitle').textContent = `${owner} · ${total} videos · Play Here uses the official YouTube player; ads may appear.`;
    }
    if (!append) list.replaceChildren();
    else loadMoreButton?.remove();
    if (fromCache) {
      const note = document.createElement('div'); note.className = 'message metadata-cache-note';
      note.textContent = 'Showing this browser’s saved track listing · YouTube audio still plays through the official player and needs internet.';
      list.appendChild(note);
    }
    const firstIndex = list.querySelectorAll('.playlist-track').length;
    streams.forEach((item, offset) => {
      const id = videoIdFromUrl(item.url || '');
      if (activeYouTubePlaylistId === playlist.id) activeYouTubeTracks[firstIndex + offset] = { videoId: id, title: item.title || 'YouTube video', uploader: item.uploaderName || 'YouTube' };
      const row = document.createElement('div'); row.className = 'playlist-track';
      row.addEventListener('click', (event) => {
        if (event.target.closest('a, button')) return;
        playYouTubePlaylistIndex(playlist, firstIndex + offset, id, item.title || 'YouTube video', item.uploaderName || 'YouTube');
      });
      const number = document.createElement('span'); number.className = 'track-number'; number.textContent = String(firstIndex + offset + 1).padStart(2, '0');
      const image = document.createElement('img'); image.className = 'track-thumb'; image.alt = ''; image.loading = 'lazy';
      image.src = item.thumbnail || (id ? `https://i.ytimg.com/vi/${encodeURIComponent(id)}/mqdefault.jpg` : '');
      image.onerror = () => { image.style.visibility = 'hidden'; };
      const copy = document.createElement('div'); copy.className = 'playlist-track-copy';
      const title = document.createElement('button'); title.type = 'button'; title.className = 'playlist-track-title track-title-button'; title.textContent = item.title || 'Untitled video';
      title.addEventListener('click', () => playYouTubePlaylistIndex(playlist, firstIndex + offset, id, item.title || 'YouTube video', item.uploaderName || 'YouTube'));
      const uploader = document.createElement('div'); uploader.className = 'playlist-track-uploader';
      uploader.textContent = [item.uploaderName || 'YouTube', Number(item.duration) > 0 ? formatTime(item.duration) : ''].filter(Boolean).join(' · ');
      copy.append(title, uploader);
      const actions = document.createElement('div'); actions.className = 'track-actions';
      const play = document.createElement('button'); play.type = 'button'; play.className = 'track-play'; play.textContent = '▶ PLAY';
      play.setAttribute('aria-label', `Play ${item.title || 'track'} in YouTube player`);
      play.addEventListener('click', () => playYouTubePlaylistIndex(playlist, firstIndex + offset, id, item.title || 'YouTube video', item.uploaderName || 'YouTube'));
      const link = document.createElement('a'); link.className = 'track-open';
      link.href = id ? `https://www.youtube.com/watch?v=${encodeURIComponent(id)}&list=${encodeURIComponent(playlist.id)}&index=${firstIndex + offset + 1}` : youtubePlaylistUrl(playlist.id);
      link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'OPEN ↗';
      actions.append(play, link); row.append(number, image, copy, actions); list.appendChild(row);
    });
    if (data.nextpage) {
      const more = document.createElement('button'); more.type = 'button'; more.className = 'load-more'; more.textContent = 'Load more tracks';
      more.addEventListener('click', () => loadPlaylistPage(playlist, token, data.nextpage, true));
      list.appendChild(more);
    }
  }
  async function loadPlaylistPage(playlist, token, nextpage = '', append = false) {
    const list = $('playlistTracks');
    const loadMoreButton = append ? list.querySelector('.load-more') : null;
    if (loadMoreButton) { loadMoreButton.disabled = true; loadMoreButton.textContent = 'Loading…'; }
    const isFirstPage = !nextpage && !append;
    const cached = isFirstPage ? getCachedPlaylistMetadata(playlist.id) : null;
    let cacheShown = false;
    if (cached) {
      renderPlaylistMetadata(playlist, token, cached.data, false, true);
      cacheShown = true;
      if (Date.now() - (Number(cached.savedAt) || 0) < playlistMetadataFreshMs) return;
    }
    try {
      const endpoint = nextpage
        ? `/api/youtube/playlists/${encodeURIComponent(playlist.id)}/nextpage?${new URLSearchParams({ nextpage })}`
        : `/api/youtube/playlists/${encodeURIComponent(playlist.id)}`;
      const data = await requestJson(endpoint, 18000);
      if (token !== playlistDetailToken) return;
      const streams = Array.isArray(data.relatedStreams) ? data.relatedStreams : [];
      if (!streams.length) throw new Error('No track metadata returned');
      if (append) {
        const prior = getCachedPlaylistMetadata(playlist.id);
        if (prior) {
          savePlaylistMetadata(playlist.id, {
            ...prior.data,
            ...data,
            relatedStreams: [...prior.data.relatedStreams, ...streams].slice(0, 300)
          });
        }
      } else {
        savePlaylistMetadata(playlist.id, data);
      }
      renderPlaylistMetadata(playlist, token, data, append, false);
    } catch (error) {
      if (token !== playlistDetailToken) return;
      if (append && loadMoreButton) {
        loadMoreButton.disabled = false; loadMoreButton.textContent = 'Could not load more · Retry';
        return;
      }
      if (cacheShown) {
        const note = list.querySelector('.metadata-cache-note');
        if (note) note.textContent = 'Showing the saved track listing. Metadata could not be refreshed; YouTube playback still needs internet.';
        if (!youtubeLastPlayerError && !youtubeAutoplayBlocked) {
          $('detailSubtitle').textContent = 'Showing saved track data · YouTube playback still requires an internet connection.';
        }
        return;
      }
      list.replaceChildren();
      const message = document.createElement('div'); message.className = 'message';
      message.textContent = 'The track list could not be fetched quickly. Retry, or open the full playlist on YouTube.';
      list.appendChild(message);
      const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'load-more';
      retry.textContent = 'Retry loading tracks';
      retry.addEventListener('click', () => loadPlaylistPage(playlist, token, '', false));
      list.appendChild(retry);
    }
  }
  $('backToPlaylists').addEventListener('click', () => {
    history.replaceState({}, '', `${location.pathname}${location.search}`);
    showPlaylistHome(true);
  });
  window.addEventListener('popstate', () => {
    const playlistId = decodeURIComponent(location.hash.startsWith('#playlist=') ? location.hash.slice('#playlist='.length) : '');
    const videoId = decodeURIComponent(location.hash.startsWith('#video=') ? location.hash.slice('#video='.length) : '');
    const playlist = curatedPlaylists.find((item) => item.id === playlistId) || customPlaylists.find((item) => item.id === playlistId);
    if (playlist) openPlaylist(playlist, true);
    else if (videoId) playSingleYouTubeVideo(videoId, 'YouTube video', 'YouTube', true);
    else showPlaylistHome(true);
  });
  renderPlaylistCards();
  const initialPlaylistId = decodeURIComponent(location.hash.startsWith('#playlist=') ? location.hash.slice('#playlist='.length) : '');
  const initialVideoId = decodeURIComponent(location.hash.startsWith('#video=') ? location.hash.slice('#video='.length) : '');
  const initialPlaylist = curatedPlaylists.find((item) => item.id === initialPlaylistId) || customPlaylists.find((item) => item.id === initialPlaylistId);
  if (initialPlaylist) openPlaylist(initialPlaylist, true);
  else if (initialVideoId) playSingleYouTubeVideo(initialVideoId, 'YouTube video', 'YouTube', true);

  function addToQueue(track) {
    if (!track.id) track.id = `item-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const existing = queue.findIndex((item) => item.id === track.id);
    if (existing >= 0) return existing;
    queue.push(track); renderQueue(); return queue.length - 1;
  }
  function enqueueAndPlay(track) {
    const existing = queue.findIndex((item) => item.id === track.id);
    const index = existing >= 0 ? existing : addToQueue(track);
    playIndex(index);
  }
  function setTrackSubtitle(track, tap = false) {
    const sub = $('trackSub'); sub.replaceChildren();
    if (track.channel) sub.append(document.createTextNode(track.channel + ' · '));
    sub.append(document.createTextNode(tap ? 'Tap Play to start' : (track.format || 'Your playlist')));
  }
  function playIndex(index) {
    if (!queue.length) return;
    if (usingYouTube) postYouTubeCommand('pauseVideo');
    usingYouTube = false; youtubeIsPlaying = false; activeYouTubePlaylistId = '';
    currentIndex = (index + queue.length) % queue.length;
    const track = queue[currentIndex];
    audio.pause(); audio.src = track.src; audio.load();
    $('trackTitle').textContent = track.title; setTrackSubtitle(track);
    $('elapsed').textContent = '0:00'; $('duration').textContent = track.duration ? formatTime(track.duration) : '0:00';
    $('progress').value = 0; setRangeFill($('progress'));
    const cover = $('coverImg');
    if (track.thumb) { cover.src = track.thumb; cover.style.display = 'block'; $('coverIcon').style.display = 'none'; }
    else { cover.removeAttribute('src'); cover.style.display = 'none'; $('coverIcon').style.display = 'block'; }
    renderQueue(); setPlaying(false);
    audio.play().catch(() => setTrackSubtitle(track, true));
  }

  function renderQueue() {
    const list = $('queueList'); list.replaceChildren(); $('queueCount').textContent = String(queue.length);
    if (!queue.length) {
      const empty = document.createElement('div'); empty.className = 'queue-row';
      const label = document.createElement('span'); label.className = 'queue-name'; label.textContent = 'Queue is empty';
      empty.appendChild(label); list.appendChild(empty); return;
    }
    const heading = document.createElement('div'); heading.className = 'queue-row';
    const label = document.createElement('span'); label.className = 'queue-name'; label.textContent = `PLAYER QUEUE · ${queue.length}`;
    const clear = document.createElement('button'); clear.type = 'button'; clear.textContent = 'Clear';
    clear.addEventListener('click', () => {
      queue.forEach((item) => { if (item.objectUrl) URL.revokeObjectURL(item.objectUrl); });
      queue = []; currentIndex = -1; audio.pause(); audio.removeAttribute('src'); audio.load();
      $('trackTitle').textContent = 'Nothing playing'; $('trackSub').textContent = 'Local audio uses the bottom player · YouTube uses the official player';
      $('elapsed').textContent = '0:00'; $('duration').textContent = '0:00'; $('progress').value = 0; setRangeFill($('progress')); setPlaying(false); renderQueue();
    });
    heading.append(label, clear); list.appendChild(heading);
    queue.forEach((track, index) => {
      const row = document.createElement('div'); row.className = 'queue-row';
      const name = document.createElement('span'); name.className = 'queue-name'; name.textContent = `${index === currentIndex ? '▶ ' : ''}${track.title}`;
      const play = document.createElement('button'); play.type = 'button'; play.textContent = 'Play'; play.addEventListener('click', () => playIndex(index));
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.setAttribute('aria-label', 'Remove from queue');
      remove.addEventListener('click', () => {
        if (queue[index]?.objectUrl) URL.revokeObjectURL(queue[index].objectUrl);
        queue.splice(index, 1);
        if (index === currentIndex) { audio.pause(); audio.removeAttribute('src'); audio.load(); currentIndex = -1; setPlaying(false); $('trackTitle').textContent = 'Nothing playing'; $('trackSub').textContent = 'Local audio uses the bottom player · YouTube uses the official player'; }
        else if (index < currentIndex) currentIndex--;
        renderQueue();
      });
      row.append(name, play, remove); list.appendChild(row);
    });
  }

  $('audioFiles').addEventListener('change', (event) => {
    const files = [...(event.target.files || [])];
    const firstAddedIndex = queue.length;
    files.forEach((file) => {
      if (!file.type.startsWith('audio/') && !audioExtensions.test(file.name)) return;
      const objectUrl = URL.createObjectURL(file);
      addToQueue({ id: `local-${Date.now()}-${Math.random()}`, title: file.name.replace(/\.[^.]+$/, ''), channel: 'This device', format: file.name.split('.').pop().toUpperCase(), src: objectUrl, objectUrl, type: 'file' });
    });
    $('addPanel').classList.add('open');
    if (queue.length > firstAddedIndex && currentIndex < 0) playIndex(firstAddedIndex);
    event.target.value = '';
  });

  function addExternal(url) {
    if (externalSources.includes(url)) return;
    externalSources.push(url);
    const row = document.createElement('div'); row.className = 'external-row';
    const link = document.createElement('a'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
    let domain = ''; try { domain = new URL(url).hostname.replace(/^www\./, ''); } catch {}
    link.textContent = `Open external playlist/source · ${domain || 'link'} ↗`;
    row.appendChild(link); $('externalSources').appendChild(row);
  }
  function loadCustomPlaylists() {
    try {
      const parsed = JSON.parse(localStorage.getItem(playlistStorageKey) || '[]');
      return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.title === 'string' && typeof item.url === 'string' && typeof item.id === 'string') : [];
    } catch { return []; }
  }
  function saveCustomPlaylists() {
    try { localStorage.setItem(playlistStorageKey, JSON.stringify(customPlaylists)); }
    catch { /* Storage may be disabled; the list still works for this page session. */ }
  }
  function youtubePlaylist(raw) {
    try {
      const url = new URL(raw);
      const host = url.hostname.toLowerCase().replace(/^www\./, '');
      const allowedHosts = ['youtube.com', 'm.youtube.com', 'music.youtube.com'];
      const id = url.searchParams.get('list');
      if (url.protocol !== 'https:' || !allowedHosts.includes(host) || !validYouTubePlaylistId(id)) return null;
      return { id, url: `https://www.youtube.com/playlist?list=${encodeURIComponent(id)}` };
    } catch { return null; }
  }
  function renderPlaylistLibrary() {
    const library = $('playlistLibrary'); library.replaceChildren();
    const addRow = (item, custom) => {
      const row = document.createElement('div'); row.className = 'playlist-row';
      const link = document.createElement('a'); link.href = `#playlist=${encodeURIComponent(item.id)}`;
      link.textContent = `${item.title} · View playlist ↗`;
      link.addEventListener('click', (event) => { event.preventDefault(); openPlaylist(item); });
      row.appendChild(link);
      if (custom) {
        const play = document.createElement('button'); play.type = 'button'; play.className = 'playlist-row-play'; play.textContent = '▶';
        play.setAttribute('aria-label', `Play playlist ${item.title}`);
        play.addEventListener('click', () => openPlaylist(item, false, true));
        row.appendChild(play);
      }
      if (custom) {
        const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove';
        remove.setAttribute('aria-label', `Remove ${item.title}`);
        remove.addEventListener('click', () => {
          customPlaylists = customPlaylists.filter((saved) => saved.id !== item.id);
          saveCustomPlaylists(); renderPlaylistLibrary();
        });
        row.appendChild(remove);
      }
      library.appendChild(row);
    };
    customPlaylists.forEach((item) => addRow(item, true));
    if (!customPlaylists.length) {
      const empty = document.createElement('div'); empty.className = 'message';
      empty.textContent = 'Your browser-saved playlist links will appear here. The curated collection is on the page.';
      library.appendChild(empty);
    }
  }
  $('playlistForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const title = $('playlistTitle').value.trim();
    const parsed = youtubePlaylist($('playlistLink').value.trim());
    if (!parsed) {
      $('playlistLink').setCustomValidity('Paste an https://www.youtube.com playlist URL containing a list ID.');
      $('playlistLink').reportValidity(); return;
    }
    $('playlistLink').setCustomValidity('');
    const existing = customPlaylists.find((item) => item.id === parsed.id);
    if (existing) { existing.title = title; existing.url = parsed.url; }
    else customPlaylists.push({ id: parsed.id, title, url: parsed.url });
    saveCustomPlaylists(); renderPlaylistLibrary();
    $('playlistTitle').value = ''; $('playlistLink').value = '';
  });
  renderPlaylistLibrary();

  $('sourceForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const raw = $('sourceUrl').value.trim(); if (!raw) return;
    let url; try { url = new URL(raw); } catch { $('sourceUrl').setCustomValidity('Enter a complete https:// link.'); $('sourceUrl').reportValidity(); return; }
    $('sourceUrl').setCustomValidity('');
    const allowedProtocols = location.protocol === 'https:' ? ['https:'] : ['https:', 'http:'];
    if (!allowedProtocols.includes(url.protocol)) { showMessage('Use an HTTPS audio link on this secure page.'); return; }
    if (audioExtensions.test(url.pathname)) {
      let filename = url.pathname.split('/').pop();
      try { filename = decodeURIComponent(filename); } catch {}
      const title = filename.replace(/\.[^.]+$/, '') || 'Audio link';
      addToQueue({ title, channel: url.hostname, format: url.pathname.split('.').pop().toUpperCase(), src: url.href, type: 'url' });
      $('sourceUrl').value = ''; if (currentIndex < 0) playIndex(queue.length - 1);
    } else { addExternal(url.href); $('sourceUrl').value = ''; $('addPanel').classList.add('open'); }
  });

  function setPlaying(playing) {
    $('playIcon').style.display = playing ? 'none' : 'block'; $('pauseIcon').style.display = playing ? 'block' : 'none';
    $('togglePlay').setAttribute('aria-label', playing ? 'Pause' : 'Play'); $('togglePlay').title = playing ? 'Pause' : 'Play';
  }
  function navigateYouTubePlaylist(delta, automaticSkip = false) {
    if (!usingYouTube || !activeYouTubePlaylistId) return false;
    const playlist = curatedPlaylists.find((item) => item.id === activeYouTubePlaylistId) || customPlaylists.find((item) => item.id === activeYouTubePlaylistId);
    if (!playlist) return false;
    if (activeYouTubeTrackIndex < 0) {
      try {
        const nativeIndex = Number(youtubePlayer?.getPlaylistIndex());
        if (Number.isInteger(nativeIndex) && nativeIndex >= 0) activeYouTubeTrackIndex = nativeIndex;
      } catch {}
      if (activeYouTubeTrackIndex < 0) {
        if (!automaticSkip) return false;
        activeYouTubeTrackIndex = 0;
      }
    }
    const total = activeYouTubePlaylistCount || activeYouTubeTracks.length;
    const nextIndex = total ? (activeYouTubeTrackIndex + delta + total) % total : Math.max(0, activeYouTubeTrackIndex + delta);
    const track = activeYouTubeTracks[nextIndex];
    playYouTubePlaylistIndex(playlist, nextIndex, track?.videoId || '', track?.title || '', track?.uploader || '', automaticSkip);
    return true;
  }
  $('previous').addEventListener('click', () => {
    if (usingYouTube) { if (!navigateYouTubePlaylist(-1)) postYouTubeCommand('previousVideo'); return; }
    if (queue.length) playIndex(currentIndex <= 0 ? queue.length - 1 : currentIndex - 1);
  });
  $('next').addEventListener('click', () => {
    if (usingYouTube) { if (!navigateYouTubePlaylist(1)) postYouTubeCommand('nextVideo'); return; }
    if (queue.length) playIndex(currentIndex >= queue.length - 1 ? 0 : currentIndex + 1);
  });
  $('togglePlay').addEventListener('click', async () => {
    if (usingYouTube) {
      if (!youtubePlayerReady || !youtubePlayer) {
        if (youtubeApiFailed) {
          $('trackSub').textContent = 'YouTube player failed to load · use OPEN on YouTube';
          return;
        }
        if (pendingYouTubeRequest) {
          pendingYouTubeRequest.autoplay = true;
          pendingYouTubeRequest.applied = false;
          youtubeShouldAutoPlay = true;
          youtubeAutoplayBlocked = false;
          $('trackSub').textContent = 'Play queued · YouTube player is loading';
          $('detailSubtitle').textContent = 'Your Play request is queued and will start when YouTube is ready.';
        } else {
          $('trackSub').textContent = 'Select a YouTube song or playlist first';
        }
        return;
      }
      let state = -1;
      try { state = youtubePlayer.getPlayerState(); } catch {}
      if (state === window.YT.PlayerState.PLAYING || state === window.YT.PlayerState.BUFFERING) {
        youtubeShouldAutoPlay = false;
        youtubeAutoSkipInProgress = false;
        postYouTubeCommand('pauseVideo');
      } else {
        youtubeShouldAutoPlay = true;
        youtubeAutoplayBlocked = false;
        postYouTubeCommand('playVideo');
      }
      return;
    }
    if (currentIndex < 0) {
      if (curatedPlaylists.length) {
        openPlaylist(curatedPlaylists[0], false, true);
      } else {
        $('trackSub').textContent = 'Select a song or playlist first';
      }
      return;
    }
    if (audio.paused) { try { await audio.play(); } catch { setTrackSubtitle(queue[currentIndex], true); } }
    else audio.pause();
  });
  $('progress').addEventListener('input', () => {
    if (usingYouTube) {
      if (youtubeDuration > 0) postYouTubeCommand('seekTo', [(Number($('progress').value) / 1000) * youtubeDuration, true]);
      return;
    }
    if (Number.isFinite(audio.duration) && audio.duration > 0) audio.currentTime = (Number($('progress').value) / 1000) * audio.duration;
  });
  $('volume').addEventListener('input', () => {
    const volume = Number($('volume').value);
    if (usingYouTube) postYouTubeCommand('setVolume', [volume]);
    else audio.volume = volume / 100;
  });
  audio.volume = Number($('volume').value) / 100;
  audio.addEventListener('play', () => { if (!usingYouTube) setPlaying(true); });
  audio.addEventListener('pause', () => { if (!usingYouTube) setPlaying(false); });
  audio.addEventListener('timeupdate', () => {
    if (usingYouTube) return;
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    $('elapsed').textContent = formatTime(audio.currentTime);
    if (duration) { $('duration').textContent = formatTime(duration); $('progress').value = Math.round(audio.currentTime / duration * 1000); setRangeFill($('progress')); }
  });
  audio.addEventListener('loadedmetadata', () => { if (!usingYouTube && Number.isFinite(audio.duration)) $('duration').textContent = formatTime(audio.duration); });
  audio.addEventListener('ended', () => { if (!usingYouTube && queue.length) playIndex(currentIndex >= queue.length - 1 ? 0 : currentIndex + 1); });
  audio.addEventListener('error', () => {
    if (usingYouTube || currentIndex < 0) return;
    const code = audio.error?.code;
    const message = code === 2 ? 'Audio network error' : code === 3 ? 'Audio decode error' : code === 4 ? 'Unsupported audio format or URL' : 'Audio could not be loaded';
    $('trackSub').textContent = `${message} · try a browser-playable audio file or HTTPS link`;
    setPlaying(false);
  });
  setInterval(pollYouTubePlayer, 1000);

  document.addEventListener('click', (event) => {
    if (!$('searchForm').contains(event.target) && !resultsBox.contains(event.target) && !$('addPanel').contains(event.target)) resultsBox.classList.remove('open');
  });
})();
