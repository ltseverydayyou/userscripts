// ==UserScript==
// @name         Media Finder
// @namespace    http://tampermonkey.net/
// @version      1.9.1
// @description  Find and download media, HLS with served AES-128 keys, clear DASH, and record players with mobile-friendly controls
// @match        *://*/*
// @run-at       document-start
// @grant        GM_openInTab
// @grant        GM_download
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      127.0.0.1
// @connect      localhost
// @connect      *
// @downloadURL  https://github.com/ltseverydayyou/userscripts/raw/main/media%20finder.user.js
// @updateURL    https://github.com/ltseverydayyou/userscripts/raw/main/media%20finder.meta.js
// ==/UserScript==

(function () {
  'use strict';

  const inFrame = window.top !== window.self;
  const page = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const rawFetch = window.fetch?.bind(window);

  const INSTANCE_KEY = '__media_finder_singleton__';
  if (globalThis[INSTANCE_KEY]) return;
  globalThis[INSTANCE_KEY] = true;

  const GITHUB_URL = 'https://github.com/ltseverydayyou';
  const GITHUB_HANDLE = '@ltseverydayyou';
  const GITHUB_ICON_SVG = `
    <svg class="mf_brandicon" viewBox="0 0 32 32" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">
      <path fill-rule="evenodd" clip-rule="evenodd" d="M16 0C7.16 0 0 7.16 0 16C0 23.08 4.58 29.06 10.94 31.18C11.74 31.32 12.04 30.84 12.04 30.42C12.04 30.04 12.02 28.78 12.02 27.44C8 28.18 6.96 26.46 6.64 25.56C6.46 25.1 5.68 23.68 5 23.3C4.44 23 3.64 22.26 4.98 22.24C6.24 22.22 7.14 23.4 7.44 23.88C8.88 26.3 11.18 25.62 12.1 25.2C12.24 24.16 12.66 23.46 13.12 23.06C9.56 22.66 5.84 21.28 5.84 15.16C5.84 13.42 6.46 11.98 7.48 10.86C7.32 10.46 6.76 8.82 7.64 6.62C7.64 6.62 8.98 6.2 12.04 8.26C13.32 7.9 14.68 7.72 16.04 7.72C17.4 7.72 18.76 7.9 20.04 8.26C23.1 6.18 24.44 6.62 24.44 6.62C25.32 8.82 24.76 10.46 24.6 10.86C25.62 11.98 26.24 13.4 26.24 15.16C26.24 21.3 22.5 22.66 18.94 23.06C19.52 23.56 20.02 24.52 20.02 26.02C20.02 28.16 20 29.88 20 30.42C20 30.84 20.3 31.34 21.1 31.18C27.42 29.06 32 23.06 32 16C32 7.16 24.84 0 16 0V0Z" fill="currentColor"/>
    </svg>
  `;

  const CFG = {
    maxItems: 2500,
    maxPlayers: 200,
    maxReasons: 6,
    maxFetchBodyBytesForPlaylist: 512 * 1024,
    maxScriptScanBytes: 400 * 1024,
    maxScriptTagsPerScan: 150,
    maxScriptHitsPerTag: 150,
    maxJsonWalkDepth: 10,
    scanIntervalMs: 2500,
    toastAutoHideMs: 0,
    allowDataUrls: false,
    allowBlobUrls: true,
    includeQueryExt: true,
    bridgeUrl: 'http://127.0.0.1:38491',
    bridgeTimeoutMs: 30000,
    bridgeRetryMs: 30000,
    maxParts: 20000,
    maxMemoryBytes: matchMedia('(pointer: coarse)').matches ? 256 * 1024 * 1024 : 768 * 1024 * 1024
  };

  const EXT = [
    'mp3', 'mp4', 'm4a', 'm4v', 'webm', 'ogg', 'ogv', 'oga', 'wav', 'flac', 'aac', 'opus',
    'mov', 'mkv', 'avi', 'flv', 'm3u8', 'mpd', 'ts', 'm4s', 'vtt', 'srt', 'mka', '3gp', '3g2',
    'jpg', 'jpeg', 'jpe', 'png', 'gif', 'webp', 'avif', 'apng', 'bmp', 'svg', 'ico', 'tif', 'tiff', 'jfif', 'pjpeg', 'pjp', 'heic', 'heif'
  ];
  const AUDIO_EXT = new Set(['mp3', 'm4a', 'wav', 'flac', 'aac', 'opus', 'oga', 'ogg', 'mka']);
  const VIDEO_EXT = new Set(['mp4', 'm4v', 'webm', 'mov', 'mkv', 'avi', 'flv', '3gp', '3g2', 'ogv', 'ts', 'm4s']);
  const PLAYLIST_EXT = new Set(['m3u8', 'mpd']);
  const SUB_EXT = new Set(['vtt', 'srt']);
  const IMAGE_EXT = new Set(['jpg', 'jpeg', 'jpe', 'png', 'gif', 'webp', 'avif', 'apng', 'bmp', 'svg', 'ico', 'tif', 'tiff', 'jfif', 'pjpeg', 'pjp', 'heic', 'heif']);

  const MIME_OK = [
    /^audio\//i,
    /^video\//i,
    /^image\//i,
    /^application\/(vnd\.apple\.mpegurl|x-mpegurl|dash\+xml|octet-stream)/i,
    /^text\/(vtt|plain)/i
  ];

  const PLAYLIST_MIME = [
    /^application\/(vnd\.apple\.mpegurl|x-mpegurl)/i,
    /^audio\/(mpegurl|x-mpegurl)/i,
    /^video\/(mpegurl|x-mpegurl)/i,
    /^text\/(plain|vtt)/i
  ];

  const EXTRACTOR_RULES = [
    { id: 'youtube', label: 'YouTube', hosts: ['youtube.com', 'youtu.be'] },
    { id: 'instagram', label: 'Instagram', hosts: ['instagram.com'] },
    { id: 'facebook', label: 'Facebook', hosts: ['facebook.com', 'fb.watch'] },
    { id: 'tiktok', label: 'TikTok', hosts: ['tiktok.com'] },
    { id: 'twitter', label: 'X', hosts: ['x.com', 'twitter.com'] },
    { id: 'reddit', label: 'Reddit', hosts: ['reddit.com', 'redd.it', 'v.redd.it'] },
    { id: 'vimeo', label: 'Vimeo', hosts: ['vimeo.com', 'player.vimeo.com'] },
    { id: 'dailymotion', label: 'Dailymotion', hosts: ['dailymotion.com', 'dai.ly'] },
    { id: 'twitch', label: 'Twitch', hosts: ['twitch.tv', 'clips.twitch.tv'] },
    { id: 'soundcloud', label: 'SoundCloud', hosts: ['soundcloud.com'] },
    { id: 'bandcamp', label: 'Bandcamp', hosts: ['bandcamp.com'] },
    { id: 'bilibili', label: 'Bilibili', hosts: ['bilibili.com', 'b23.tv'] }
  ];
  const EXTRACTOR_PATH_RE = /\/(?:watch|shorts|live|embed|reel|reels|video|videos|clip|clips|status|stories|story|post|posts|p\/|tv\/|playlist|album|track|sets|episode|show|stream|broadcast|music|channel|v\/|media)\b/i;
  const EXTRACTOR_QUERY_RE = /(?:^|[?&])(v|list|clip|video_id|story_fbid|fbid|media_id)=/i;

  const extRe = new RegExp('(\\.|%2E)(' + EXT.join('|') + ')(?=($|[?#&/]))', 'i');
  const scriptUrlCandidateRe = new RegExp('\\.(?:' + EXT.join('|') + ')(?:\\b|[?#])', 'i');
  const qExtRe = /[?&#](?:file|filename|name|url|src|media|video|audio|image|img|poster|thumb|thumbnail|download|path)=([^&#]+)/i;
  const qMimeRe = /[?&#](?:mime|mimetype|type|content[-_]?type|format)=([^&#]+)/i;
  const STORAGE_KEY = '__mf_state_v1__';
  const PAGE_URL = (() => { try { const u = new URL(location.href); u.hash = ''; return u.href; } catch { return location.href; } })();
  const tsSeen = new Set();
  const styleSigSeen = new WeakMap();
  const scriptSigSeen = new WeakMap();
  const jsonLdSigSeen = new WeakMap();
  const clearedBaselineUrls = new Set();

  const found = new Map(); // url -> {ts, from:Set, mime?, size?, note?, kind?}
  const pendingItemAnimations = new Set(); // URLs newly detected since the last list render
  const players = new Map(); // el -> {tag, src, last, why:Set}
  const recordingPlayers = new WeakSet();
  const recordingBlobs = new WeakSet();
  const srcSeen = new Set();
  const reqInfo = new Map();
  const manifests = new Map();
  const frameInfo = new Map();
  const roots = new Set([document]);
  const watched = new WeakSet();
  const CHANNEL = 'media-finder-v190';
  let playerSeq = 0;
  let relayTimer = null;
  let job = null;
  let rec = null;
  let savedBlob = null;
  let savedFiles = [];
  let foundRev = 0;
  let listSig = '';
  let statusText = '';
  let quality = 0;

  let ui = null;
  let uiOpen = false;
  let lastToast = 0;
  let previewState = { url: '', sig: '' };
  let hotkeyHooked = false;
  let hooksInstalled = false;
  let runtimeStarted = false;
  let ytSnapshotSig = '';
  let bridgeAvailable = null;
  let bridgeLastErrorAt = 0;
  const bridgeProbeSeen = new Set();
  const bridgeProbeInflight = new Set();

  const LANGS = {
    en: {
      title: 'Media Finder',
      scanning: 'Scanning…',
      found: 'Found',
      links: 'link(s)',
      players: 'Players',
      open: 'Open',
      close: 'Close',
      copy: 'Copy',
      copyAll: 'Copy all',
      preview: 'Preview',
      hidePreview: 'Hide preview',
      previewUnavailable: 'Preview not available',
      clear: 'Clear',
      customize: 'Customize',
      customizeHide: 'Hide controls',
      search: 'Search…',
      filterAll: 'All',
      filterImages: 'Images',
      filterAudio: 'Audio',
      filterVideo: 'Video',
      filterPlaylists: 'Playlists',
      filterExtractors: 'Pages',
      filterSubs: 'Subs',
      filterOther: 'Other',
      settings: 'Settings',
      lang: 'Language',
      auto: 'Auto',
      newest: 'Newest',
      oldest: 'Oldest',
      uniqueFirst: 'Unique first',
      export: 'Export .txt',
      openList: 'Open list',
      tip: 'Press play or scroll to find media. Use recording if there is no usable link.',
      noneYet: 'No media links yet. Scroll/load content or press play, then wait a second.',
      clipboardBlocked: 'Clipboard blocked — use Open list',
      copied: 'Copied',
      items: 'item(s)',
      compact: 'Compact',
      toast: 'Toast',
      on: 'On',
      off: 'Off',
      download: 'Download',
      unknown: 'Unknown',
      viewList: 'List view',
      viewGrid: 'Grid view',
      previewPane: 'Preview',
      selectPreview: 'Select an item to preview in the side window.',
      launcherHide: 'Hide toggle button',
      launcherShow: 'Show toggle button',
      layout: 'Layout',
      ytDlpOptions: 'yt-dlp',
      ytDlpModeVideo: 'Video cmd',
      ytDlpModeAudio: 'Audio cmd',
      ytDlpModeExtract: 'MP3 cmd',
      ytDlpSubs: 'Subs',
      ytDlpThumbs: 'Thumbs',
      ytDlpCustomArgs: 'yt-dlp args...',
      copyCommand: 'Copy cmd',
      commandCopied: 'Command copied',
      extractorPage: 'Extractor page',
      openPage: 'Open page',
      probe: 'Probe',
      probing: 'Probing',
      bridgeDown: 'Bridge offline',
      followGithub: 'Open GitHub profile',
      theme: 'Theme',
      themeMidnight: 'Midnight',
      themeNeon: 'Neon dusk',
      themeAurora: 'Aurora',
      motion: 'Motion',
      motionOff: 'Off',
      motionCalm: 'Calm',
      motionFull: 'Full',
      dockSide: 'Dock',
      dockRight: 'Right',
      dockLeft: 'Left',
      launcherPosition: 'Toggle position',
      positionTopLeft: 'Top left',
      positionTop: 'Top',
      positionTopRight: 'Top right',
      positionCenterLeft: 'Center left',
      positionCenter: 'Center',
      positionCenterRight: 'Center right',
      positionBottomLeft: 'Bottom left',
      positionBottom: 'Bottom',
      positionBottomRight: 'Bottom right',
      panelWidth: 'Width',
      widthNarrow: 'Narrow',
      widthNormal: 'Normal',
      widthWide: 'Wide',
      widthUltra: 'Ultra',
      panelHeight: 'Height',
      heightCompact: 'Compact',
      heightNormal: 'Normal',
      heightTall: 'Tall',
      heightFull: 'Full',
      listType: 'Type',
      listUrl: 'URL',
      listMime: 'MIME',
      listSize: 'Size',
      listNote: 'Note',
      listFrom: 'From'
    },
    bg: {
      title: 'Търсач на медия',
      scanning: 'Сканиране…',
      found: 'Намерени',
      links: 'линк(а)',
      players: 'Плейъри',
      open: 'Отвори',
      close: 'Затвори',
      copy: 'Копирай',
      copyAll: 'Копирай всички',
      preview: 'Преглед',
      hidePreview: 'Скрий прегледа',
      previewUnavailable: 'Прегледът не е наличен',
      clear: 'Изчисти',
      customize: 'Персонализирай',
      customizeHide: 'Скрий контролите',
      search: 'Търсене…',
      filterAll: 'Всички',
      filterImages: 'Изображения',
      filterAudio: 'Аудио',
      filterVideo: 'Видео',
      filterPlaylists: 'Плейлисти',
      filterExtractors: 'Страници',
      filterSubs: 'Субтитри',
      filterOther: 'Други',
      settings: 'Настройки',
      lang: 'Език',
      auto: 'Авто',
      newest: 'Най-нови',
      oldest: 'Най-стари',
      uniqueFirst: 'Първо уникални',
      export: 'Експорт .txt',
      openList: 'Отвори списък',
      tip: 'Съвет: скролни или зареди още и пусни нещо. Този тракер хваща изображения, аудио, видео, HLS и DASH връзки.',
      noneYet: 'Още няма намерени медийни връзки. Скролни, зареди съдържание или пусни нещо и изчакай секунда.',
      clipboardBlocked: 'Клипбордът е блокиран — ползвай „Отвори списък“',
      copied: 'Копирани',
      items: 'елемент(а)',
      compact: 'Компактно',
      toast: 'Тост',
      on: 'Вкл',
      off: 'Изкл',
      download: 'Свали',
      unknown: 'Неизвестно',
      viewList: 'Списък',
      viewGrid: 'Мрежа',
      previewPane: 'Преглед',
      selectPreview: 'Избери елемент за преглед в отделния панел.',
      launcherHide: 'Скрий бутона',
      launcherShow: 'Покажи бутона',
      layout: 'Изглед',
      ytDlpOptions: 'yt-dlp',
      ytDlpModeVideo: 'Video cmd',
      ytDlpModeAudio: 'Audio cmd',
      ytDlpModeExtract: 'MP3 cmd',
      ytDlpSubs: 'Subs',
      ytDlpThumbs: 'Thumbs',
      ytDlpCustomArgs: 'yt-dlp args...',
      copyCommand: 'Копирай команда',
      commandCopied: 'Командата е копирана',
      extractorPage: 'Страница за извличане',
      openPage: 'Отвори страницата',
      probe: 'Провери',
      probing: 'Проверяване',
      bridgeDown: 'Локалният bridge е офлайн',
      followGithub: 'Отвори GitHub профила',
      theme: 'Тема',
      themeMidnight: 'Полунощ',
      themeNeon: 'Неонов здрач',
      themeAurora: 'Аврора',
      motion: 'Анимация',
      motionOff: 'Изкл',
      motionCalm: 'Спокойна',
      motionFull: 'Пълна',
      dockSide: 'Панел',
      dockRight: 'Вдясно',
      dockLeft: 'Вляво',
      launcherPosition: 'Позиция на бутона',
      positionTopLeft: 'Горе вляво',
      positionTop: 'Горе',
      positionTopRight: 'Горе вдясно',
      positionCenterLeft: 'Център вляво',
      positionCenter: 'Център',
      positionCenterRight: 'Център вдясно',
      positionBottomLeft: 'Долу вляво',
      positionBottom: 'Долу',
      positionBottomRight: 'Долу вдясно',
      panelWidth: 'Ширина',
      widthNarrow: 'Тясна',
      widthNormal: 'Нормална',
      widthWide: 'Широка',
      widthUltra: 'Много широка',
      panelHeight: 'Височина',
      heightCompact: 'Компактна',
      heightNormal: 'Нормална',
      heightTall: 'Висока',
      heightFull: 'Макс',
      listType: 'Тип',
      listUrl: 'URL',
      listMime: 'MIME',
      listSize: 'Размер',
      listNote: 'Бележка',
      listFrom: 'Източник'
    }
  };

  const state = {
    lang: 'auto',
    filter: 'all',
    sort: 'newest',
    query: '',
    compact: false,
    toast: false,
    layout: 'list',
    ytDlpVisible: false,
    ytDlpMode: 'video',
    ytDlpSubs: false,
    ytDlpThumbs: false,
    ytDlpCustomArgs: '',
    launcherVisible: true,
    customizerOpen: false,
    theme: 'midnight',
    motion: 'full',
    dockSide: 'right',
    launcherPosition: 'bottom-right',
    panelWidth: 'normal',
    panelHeight: 'normal',
    previewUrl: '',
    previewType: ''
  };
  loadState();

  function readStoredState() {
    try {
      if (typeof GM_getValue === 'function') return GM_getValue(STORAGE_KEY, '');
    } catch { }
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch { }
    return '';
  }

  function writeStoredState(raw) {
    try {
      if (typeof GM_setValue === 'function') {
        GM_setValue(STORAGE_KEY, raw);
        return true;
      }
    } catch { }
    try {
      localStorage.setItem(STORAGE_KEY, raw);
      return true;
    } catch { }
    return false;
  }

  function loadState() {
    try {
      const raw = readStoredState();
      if (!raw) return;
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (parsed && typeof parsed === 'object') applySavedState(parsed);
    } catch { }
  }

  function applySavedState(saved) {
    if (!saved || typeof saved !== 'object') return;
    const okLang = new Set(['auto', 'en', 'bg']);
    const okFilter = new Set(['all', 'image', 'audio', 'video', 'playlist', 'extractor', 'subs', 'other']);
    const okSort = new Set(['newest', 'oldest', 'unique']);
    const okLayout = new Set(['list', 'grid']);
    const okYtMode = new Set(['video', 'audio', 'extract']);
    const okTheme = new Set(['midnight', 'neon', 'aurora']);
    const okMotion = new Set(['off', 'calm', 'full']);
    const okDockSide = new Set(['right', 'left']);
    const okLauncherPosition = new Set(['top-left', 'top', 'top-right', 'center-left', 'center', 'center-right', 'bottom-left', 'bottom', 'bottom-right']);
    const okPanelWidth = new Set(['narrow', 'normal', 'wide', 'ultra']);
    const okPanelHeight = new Set(['compact', 'normal', 'tall', 'full']);

    if (okLang.has(saved.lang)) state.lang = saved.lang;
    if (okFilter.has(saved.filter)) state.filter = saved.filter;
    if (okSort.has(saved.sort)) state.sort = saved.sort;
    if (typeof saved.query === 'string') state.query = saved.query;
    if (typeof saved.compact === 'boolean') state.compact = saved.compact;
    if (typeof saved.toast === 'boolean') state.toast = saved.toast;
    if (okLayout.has(saved.layout)) state.layout = saved.layout;
    if (typeof saved.ytDlpVisible === 'boolean') state.ytDlpVisible = saved.ytDlpVisible;
    if (okYtMode.has(saved.ytDlpMode)) state.ytDlpMode = saved.ytDlpMode;
    if (typeof saved.ytDlpSubs === 'boolean') state.ytDlpSubs = saved.ytDlpSubs;
    if (typeof saved.ytDlpThumbs === 'boolean') state.ytDlpThumbs = saved.ytDlpThumbs;
    if (typeof saved.ytDlpCustomArgs === 'string') state.ytDlpCustomArgs = saved.ytDlpCustomArgs;
    if (typeof saved.launcherVisible === 'boolean') state.launcherVisible = saved.launcherVisible;
    if (typeof saved.customizerOpen === 'boolean') state.customizerOpen = saved.customizerOpen;
    if (okTheme.has(saved.theme)) state.theme = saved.theme;
    if (okMotion.has(saved.motion)) state.motion = saved.motion;
    if (okDockSide.has(saved.dockSide)) state.dockSide = saved.dockSide;
    if (okLauncherPosition.has(saved.launcherPosition)) state.launcherPosition = saved.launcherPosition;
    if (okPanelWidth.has(saved.panelWidth)) state.panelWidth = saved.panelWidth;
    if (okPanelHeight.has(saved.panelHeight)) state.panelHeight = saved.panelHeight;
  }

  function saveState() {
    try {
      const payload = {
        lang: state.lang,
        filter: state.filter,
        sort: state.sort,
        query: state.query || '',
        compact: !!state.compact,
        toast: !!state.toast,
        layout: state.layout,
        ytDlpVisible: !!state.ytDlpVisible,
        ytDlpMode: state.ytDlpMode,
        ytDlpSubs: !!state.ytDlpSubs,
        ytDlpThumbs: !!state.ytDlpThumbs,
        ytDlpCustomArgs: state.ytDlpCustomArgs || '',
        launcherVisible: !!state.launcherVisible,
        customizerOpen: !!state.customizerOpen,
        theme: state.theme,
        motion: state.motion,
        dockSide: state.dockSide,
        launcherPosition: state.launcherPosition,
        panelWidth: state.panelWidth,
        panelHeight: state.panelHeight
      };
      writeStoredState(JSON.stringify(payload));
    } catch { }
  }

  let saveStateTimer = null;
  function saveStateSoon() {
    if (saveStateTimer) return;
    saveStateTimer = setTimeout(() => {
      saveStateTimer = null;
      saveState();
    }, 120);
  }

  function pickLang() {
    if (state.lang && state.lang !== 'auto') return state.lang;
    const nav = (navigator.languages && navigator.languages[0]) || navigator.language || 'en';
    const base = String(nav).toLowerCase().split('-')[0];
    return LANGS[base] ? base : 'en';
  }

  function t(key) {
    const L = pickLang();
    return (LANGS[L] && LANGS[L][key]) || (LANGS.en && LANGS.en[key]) || key;
  }

  function now() { return Date.now(); }

  function rememberClearedUrl(raw) {
    const u = norm(raw);
    if (u) clearedBaselineUrls.add(u);
  }

  function rememberClearedUrls(values) {
    try {
      for (const value of values || []) rememberClearedUrl(value);
    } catch { }
  }

  function buildClearBaseline() {
    clearedBaselineUrls.clear();
    rememberClearedUrl(location.href);

    try {
      rememberClearedUrl(document.querySelector('link[rel="canonical"]')?.getAttribute('href') || '');
      rememberClearedUrl(document.querySelector('meta[property="og:url"],meta[name="og:url"]')?.getAttribute('content') || '');
    } catch { }

    try {
      rememberClearedUrls(found.keys());
    } catch { }

    try {
      for (const info of players.values()) {
        if (info?.src) rememberClearedUrl(info.src);
      }
    } catch { }

    try {
      performance.getEntriesByType('resource').forEach((entry) => {
        if (entry?.name) rememberClearedUrl(entry.name);
      });
    } catch { }

    try {
      const nodes = domAll('video,audio,img,picture,source,track,link[href],[src],[href],[poster],[srcset],[data-src],[data-href],[data-url],[data-image],[data-img],[data-original],[data-lazy-src],[data-thumb],[data-thumbnail],[data-poster],[data-srcset],style,[style*="url("]');
      nodes.forEach(n => {
        const tg = n.tagName?.toLowerCase?.() || '';
        if (tg === 'video' || tg === 'audio' || tg === 'img') {
          rememberClearedUrl(getMediaSrc(n));
        }

        [
          'src', 'href', 'poster', 'data-src', 'data-href', 'data-url',
          'data-image', 'data-img', 'data-original', 'data-lazy-src',
          'data-thumb', 'data-thumbnail', 'data-poster'
        ].forEach(attr => {
          const val = n.getAttribute && n.getAttribute(attr);
          if (val) rememberClearedUrl(val);
        });

        ['srcset', 'data-srcset'].forEach(attr => {
          const val = n.getAttribute && n.getAttribute(attr);
          if (!val) return;
          rememberClearedUrls(parseSrcset(val));
        });

        if (n.hasAttribute && n.hasAttribute('style')) {
          rememberClearedUrls(extractCssUrls(n.getAttribute('style') || ''));
        }

        if (tg === 'style') {
          rememberClearedUrls(extractCssUrls(n.textContent || ''));
        }
      });
    } catch { }
  }

  function norm(u) {
    if (!u) return null;
    u = String(u).trim();
    if (!u) return null;

    if (!CFG.allowDataUrls && /^data:/i.test(u)) return null;
    if (!CFG.allowBlobUrls && /^blob:/i.test(u)) return null;

    if (u.startsWith('//')) u = location.protocol + u;
    else if (u.startsWith('/')) u = location.origin + u;

    if (!/^https?:|^blob:|^data:/i.test(u)) {
      try { u = new URL(u, location.href).href; } catch { return null; }
    }
    try {
      const parsed = new URL(u, location.href);
      if (!['http:', 'https:', 'blob:', 'data:'].includes(parsed.protocol)) return null;
      return parsed.href;
    } catch { return null; }
  }

  function looksLikeMedia(u) {
    if (!u) return false;
    if (extRe.test(u)) return true;
    if (CFG.includeQueryExt) {
      const m = u.match(qExtRe);
      if (m && m[1]) {
        const dec = safeDecode(m[1]);
        if (dec && extRe.test(dec)) return true;
      }
      const qm = u.match(qMimeRe);
      if (qm && qm[1]) {
        const dec = safeDecode(qm[1]);
        if (dec && MIME_OK.some(re => re.test(dec))) return true;
      }
    }
    return false;
  }

  function safeDecode(s) {
    try { return decodeURIComponent(s); } catch { return s; }
  }

  function normalizeType(v) {
    const s = String(v || '').toLowerCase().trim();
    if (s === 'image' || s === 'img' || s === 'poster' || s === 'thumbnail') return 'image';
    if (s === 'audio') return 'audio';
    if (s === 'video') return 'video';
    if (s === 'playlist' || s === 'm3u8' || s === 'mpd') return 'playlist';
    if (s === 'extractor' || s === 'page' || s === 'site') return 'extractor';
    if (s === 'subs' || s === 'subtitle' || s === 'subtitles' || s === 'track') return 'subs';
    return '';
  }

  function parseSrcset(s) {
    const out = [];
    if (!s) return out;
    const parts = String(s).split(',');
    for (const part of parts) {
      const piece = part.trim();
      if (!piece) continue;
      const url = piece.split(/\s+/)[0]?.trim();
      if (!url) continue;
      out.push(url.replace(/^['"]|['"]$/g, ''));
    }
    return out;
  }

  function extractCssUrls(cssText) {
    const out = [];
    if (!cssText) return out;
    const re = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
    let m;
    while ((m = re.exec(String(cssText)))) {
      const u = (m[2] || '').trim();
      if (!u || /^data:/i.test(u) || /^about:/i.test(u) || /^javascript:/i.test(u)) continue;
      out.push(u);
    }
    return out;
  }

  function tagHint(tag) {
    if (tag === 'img' || tag === 'image' || tag === 'picture') return 'image';
    if (tag === 'audio') return 'audio';
    if (tag === 'video') return 'video';
    if (tag === 'track') return 'subs';
    return '';
  }

  function hintFromKey(key) {
    const k = String(key || '').toLowerCase();
    if (!k) return '';
    if (k.includes('image') || k.includes('thumb') || k.includes('poster') || k === 'icon') return 'image';
    if (k.includes('audio')) return 'audio';
    if (k.includes('video')) return 'video';
    if (k.includes('caption') || k.includes('subtitle') || k.includes('track')) return 'subs';
    if (k.includes('manifest') || k.includes('playlist')) return 'playlist';
    return '';
  }

  function safeJsonParse(s) {
    if (!s) return null;
    try { return JSON.parse(s); } catch { return null; }
  }

  function walkObjectForUrls(node, from, keyHint, depth) {
    const stack = [{ node, hint: keyHint || '', depth: depth || 0 }];
    const seen = new WeakSet();
    let visits = 0;
    while (stack.length && visits++ < 10000) {
      const item = stack.pop();
      const value = item.node;
      if (item.depth > CFG.maxJsonWalkDepth || value == null) continue;
      if (typeof value === 'string') {
        const text = value.trim().replace(/\\u0026/gi, '&').replace(/\\u003d/gi, '=').replace(/\\\//g, '/');
        if (text.length > 16000) continue;
        if (/^https?:\/\/|^\/\//i.test(text) || item.hint && /^\/[^/]/.test(text) || looksLikeMedia(text)) add(text, { from, hintType: item.hint });
      } else if (typeof value === 'object' && !seen.has(value)) {
        seen.add(value);
        try {
          for (const key of Object.keys(value).slice(0, 2000)) {
            if (stack.length >= 10000) break;
            stack.push({ node: value[key], hint: hintFromKey(key) || item.hint, depth: item.depth + 1 });
          }
        } catch {}
      }
    }
  }

  function parseYoutubeCipherUrl(cipher) {
    try {
      const qs = new URLSearchParams(String(cipher || ''));
      let u = qs.get('url') || '';
      if (!u) return '';
      if (qs.get('s') && !qs.get('sig') && !qs.get('signature')) return '';
      const sp = qs.get('sp') || 'signature';
      const sig = qs.get('sig') || qs.get('signature') || '';
      if (sig) {
        const x = new URL(u, location.href);
        if (!x.searchParams.get(sp)) x.searchParams.set(sp, sig);
        u = x.href;
      }
      return u;
    } catch {
      return '';
    }
  }

  function isYouTubeHost() {
    const h = String(location.hostname || '').toLowerCase();
    return h === 'youtube.com' || h.endsWith('.youtube.com') || h === 'youtu.be' || h.endsWith('.youtu.be');
  }

  function hostMatches(host, ruleHost) {
    const h = String(host || '').toLowerCase();
    const r = String(ruleHost || '').toLowerCase();
    return h === r || h.endsWith('.' + r);
  }

  function getExtractorRule(raw) {
    try {
      const u = new URL(raw, location.href);
      const host = String(u.hostname || '').toLowerCase();
      return EXTRACTOR_RULES.find(rule => rule.hosts.some(ruleHost => hostMatches(host, ruleHost))) || null;
    } catch {
      return null;
    }
  }

  function pageLooksExtractable(raw) {
    try {
      const u = new URL(raw, location.href);
      const path = String(u.pathname || '');
      return EXTRACTOR_PATH_RE.test(path) || EXTRACTOR_QUERY_RE.test(u.search || '');
    } catch {
      return false;
    }
  }

  function hasLikelyContentPath(raw) {
    try {
      const u = new URL(raw, location.href);
      const segs = String(u.pathname || '').split('/').filter(Boolean);
      if (!segs.length) return false;
      const joined = segs.join('/').toLowerCase();
      if (/^(home|feed|explore|search|discover|login|signup|about|privacy|terms|settings|download)s?$/.test(joined)) return false;
      return true;
    } catch {
      return false;
    }
  }

  function hasExtractorDomHints() {
    try {
      return !!document.querySelector(
        'meta[property="og:video"],meta[property="og:video:url"],meta[name="twitter:player"],meta[itemprop="contentUrl"],meta[itemprop="embedUrl"],video,audio'
      );
    } catch {
      return false;
    }
  }

  function addExtractorCandidate(raw, from, label) {
    const u = norm(raw);
    if (!u || looksLikeMedia(u)) return;
    const rule = getExtractorRule(u);
    if (!rule) return;
    const hinted = pageLooksExtractable(u) || hasExtractorDomHints() || hasLikelyContentPath(u) || isYouTubeHost();
    if (!hinted) return;
    add(u, {
      from: from || ('page:' + rule.id),
      hintType: 'extractor',
      note: `${label || rule.label} ${t('extractorPage')}`
    });
  }

  function gmRequest(details) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== 'function') {
        reject(new Error('GM_xmlhttpRequest unavailable'));
        return;
      }
      GM_xmlhttpRequest({
        ...details,
        onload: (resp) => resolve(resp),
        onerror: (err) => reject(new Error(err?.error || 'request_failed')),
        ontimeout: () => reject(new Error('request_timeout'))
      });
    });
  }

  async function bridgeRequest(path, payload) {
    const resp = await gmRequest({
      method: 'POST',
      url: CFG.bridgeUrl + path,
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify(payload || {}),
      timeout: CFG.bridgeTimeoutMs
    });
    const parsed = safeJsonParse(resp?.responseText || '{}');
    if (!resp || resp.status < 200 || resp.status >= 300 || !parsed || parsed.ok === false) {
      throw new Error(parsed?.error || `bridge_http_${resp?.status || 0}`);
    }
    bridgeAvailable = true;
    return parsed;
  }

  function ytTypeFromFormat(fmt) {
    if (!fmt || typeof fmt !== 'object') return '';
    const protocol = String(fmt.protocol || '').toLowerCase();
    const ext = String(fmt.ext || '').toLowerCase();
    if (protocol.includes('m3u8') || protocol.includes('dash') || protocol.includes('mhtml') || ext === 'm3u8' || ext === 'mpd') return 'playlist';
    const hasVideo = fmt.vcodec && fmt.vcodec !== 'none';
    const hasAudio = fmt.acodec && fmt.acodec !== 'none';
    if (hasVideo) return 'video';
    if (hasAudio) return 'audio';
    if (SUB_EXT.has(ext)) return 'subs';
    if (IMAGE_EXT.has(ext)) return 'image';
    return '';
  }

  function makeYtNote(extractor, parts) {
    const out = ['yt-dlp'];
    if (extractor) out.push(extractor);
    for (const part of parts || []) {
      const x = String(part || '').trim();
      if (x) out.push(x);
    }
    return out.join(' | ');
  }

  function ingestSubtitleTracks(trackMap, extractor, flavor) {
    if (!trackMap || typeof trackMap !== 'object') return;
    for (const [lang, tracks] of Object.entries(trackMap)) {
      if (!Array.isArray(tracks)) continue;
      for (const tr of tracks) {
        if (!tr?.url) continue;
        const note = makeYtNote(extractor, [flavor, lang, tr.ext || tr.name || '']);
        add(tr.url, {
          from: 'yt-dlp:subs',
          mime: tr.ext === 'vtt' ? 'text/vtt' : '',
          note,
          hintType: 'subs'
        });
      }
    }
  }

  function ingestYtDlpMetadata(metadata, sourceUrl) {
    if (!metadata || typeof metadata !== 'object') return;
    const extractor = String(metadata.extractor_key || metadata.extractor || '').trim();
    const pageUrl = norm(metadata.webpage_url || sourceUrl || '') || '';

    if (pageUrl) {
      add(pageUrl, {
        from: 'yt-dlp:page',
        hintType: 'extractor',
        note: makeYtNote(extractor, [t('extractorPage')])
      });
    }

    if (metadata.url) {
      add(metadata.url, {
        from: 'yt-dlp:root',
        note: makeYtNote(extractor, [metadata.format_id || '', metadata.ext || '']),
        hintType: ytTypeFromFormat(metadata)
      });
    }
    if (metadata.manifest_url) {
      add(metadata.manifest_url, {
        from: 'yt-dlp:manifest',
        note: makeYtNote(extractor, ['manifest']),
        hintType: 'playlist'
      });
    }
    if (metadata.hls_aes?.uri) {
      add(metadata.hls_aes.uri, {
        from: 'yt-dlp:key',
        note: makeYtNote(extractor, ['hls-key']),
        hintType: 'other'
      });
    }

    const formats = Array.isArray(metadata.formats) ? metadata.formats : [];
    for (const fmt of formats) {
      if (!fmt || typeof fmt !== 'object') continue;
      const type = ytTypeFromFormat(fmt);
      const fmtUrl = norm(fmt.url || '') || '';
      const manifestUrl = norm(fmt.manifest_url || '') || '';
      const size = Number(fmt.filesize) || Number(fmt.filesize_approx) || 0;
      const note = makeYtNote(extractor, [
        fmt.format_id || '',
        fmt.format_note || '',
        fmt.ext || '',
        fmt.height ? `${fmt.height}p` : ''
      ]);

      if (fmtUrl) {
        add(fmtUrl, {
          from: 'yt-dlp:format',
          size,
          note,
          headers: fmt.http_headers || metadata.http_headers,
          referrer: pageUrl || location.href,
          hintType: type || ''
        });
      }
      if (manifestUrl && manifestUrl !== fmtUrl) {
        add(manifestUrl, {
          from: 'yt-dlp:manifest',
          size,
          note,
          headers: fmt.http_headers || metadata.http_headers,
          referrer: pageUrl || location.href,
          hintType: 'playlist'
        });
      }
    }

    ingestSubtitleTracks(metadata.subtitles, extractor, 'subs');
    ingestSubtitleTracks(metadata.automatic_captions, extractor, 'auto-subs');

    const thumbs = Array.isArray(metadata.thumbnails) ? metadata.thumbnails : [];
    for (const th of thumbs) {
      if (!th?.url) continue;
      add(th.url, {
        from: 'yt-dlp:thumbnail',
        note: makeYtNote(extractor, ['thumbnail', th.id || '', th.ext || '']),
        hintType: 'image'
      });
    }

    scheduleRender();
  }

  async function probeBridgeForUrl(raw, force) {
    const u = norm(raw);
    if (!u || !getExtractorRule(u)) return;
    if (bridgeProbeInflight.has(u)) return;
    if (!force && bridgeProbeSeen.has(u)) return;
    if (!force && bridgeAvailable === false && now() - bridgeLastErrorAt < CFG.bridgeRetryMs) return;

    bridgeProbeInflight.add(u);
    try {
      if (ui?.msgEl && force) ui.msgEl.textContent = `${t('probing')} ${clip(u, 96)}`;
      const payload = await bridgeRequest('/extract', {
        url: u,
        noPlaylist: true,
        extraArgs: state.ytDlpCustomArgs || ''
      });
      bridgeProbeSeen.add(u);
      ingestYtDlpMetadata(payload?.metadata || null, u);
      if (ui?.msgEl && force) ui.msgEl.textContent = `${t('found')}: ${found.size} ${t('links')}`;
    } catch (error) {
      bridgeAvailable = false;
      bridgeLastErrorAt = now();
      if (ui?.msgEl && force) ui.msgEl.textContent = `${t('bridgeDown')}: ${error.message}`;
    } finally {
      bridgeProbeInflight.delete(u);
    }
  }

  function guessType(u, mime, hint) {
    const lower = String(u || '').toLowerCase();
    let ct = String(mime || '').toLowerCase();
    const h = normalizeType(hint);
    if (h) return h;

    if (!ct) {
      const qm = lower.match(qMimeRe);
      if (qm && qm[1]) ct = safeDecode(qm[1]).toLowerCase();
    }

    if (ct.includes('mpegurl') || lower.includes('.m3u8')) return 'playlist';
    if (ct.includes('dash+xml') || lower.includes('.mpd')) return 'playlist';
    if (ct.includes('mp2t')) return 'video';

    if (ct.includes('vtt') || lower.includes('.vtt') || lower.includes('.srt')) return 'subs';
    if (h === 'extractor') return 'extractor';

    if (ct.startsWith('image/')) return 'image';
    if (ct.startsWith('audio/')) return 'audio';
    if (ct.startsWith('video/')) return 'video';

    const ext = ((lower.match(extRe) || [])[2] || '').toLowerCase();
    if (!ext) return 'other';

    if (IMAGE_EXT.has(ext)) return 'image';
    if (AUDIO_EXT.has(ext)) return 'audio';
    if (VIDEO_EXT.has(ext)) return 'video';
    if (PLAYLIST_EXT.has(ext)) return 'playlist';
    if (SUB_EXT.has(ext)) return 'subs';
    return 'other';
  }

  function isTsSegment(u) {
    return /\.ts(\b|[?#])/i.test(String(u || ''));
  }

  function tsKey(u) {
    try {
      const url = new URL(u);
      const name = url.pathname.split('/').pop() || '';
      const base = name.replace(/\d+(?=\.ts\b)/i, '*');
      const path = url.pathname.replace(/[^/]+$/, base);
      const sid = url.searchParams.get('session_id') || '';
      return `${url.origin}${path}?sid=${sid}`;
    } catch {
      return String(u || '');
    }
  }

  function add(raw, meta) {
    const u = norm(raw);
    if (!u) return;
    if (clearedBaselineUrls.has(u)) return;
    try {
      if (u === PAGE_URL) return; // skip current page URL masquerading as media (e.g., MSE notifications)
    } catch {}

    const mime = meta && meta.mime ? String(meta.mime) : '';
    const okMime = mime ? MIME_OK.some(re => re.test(mime)) : false;
    const hint = normalizeType(meta?.hintType || meta?.kind || '');

    if (!looksLikeMedia(u) && !okMime && !hint) return;

    const tsSeg = isTsSegment(u);
    if (tsSeg) {
      const key = tsKey(u);
      if (tsSeen.has(key)) return;
      tsSeen.add(key);
    }

    let changed = false;
    if (!found.has(u)) {
      changed = true;
      if (found.size >= CFG.maxItems) return;
      found.set(u, { ts: now(), from: new Set(), mime: mime || '', size: meta?.size || 0, note: meta?.note || (tsSeg ? 'segment' : ''), kind: hint || '' });
      pendingItemAnimations.add(u);
    }

    const it = found.get(u);
    if (meta?.from) {
      if (!it.from.has(meta.from)) changed = true;
      it.from.add(meta.from);
      if (it.from.size > CFG.maxReasons) {
        const arr = Array.from(it.from).slice(-CFG.maxReasons);
        it.from = new Set(arr);
      }
    }
    if (mime && !it.mime) { it.mime = mime; changed = true; }
    if (meta?.size && !it.size) { it.size = meta.size; changed = true; }
    if (meta?.note && !it.note) { it.note = meta.note; changed = true; }
    if (hint && !it.kind) { it.kind = hint; changed = true; }

    if (meta?.referrer) it.referrer = meta.referrer;
    if (meta?.headers) it.headers = safeHeaders(meta.headers);
    if (meta?.frame) it.frame = meta.frame;
    if (meta?.mse && !it.mse) { it.mse = true; it.note = 'Player stream — use recording'; changed = true; }
    if (!changed) return;
    foundRev++;
    scheduleRender();
    maybeToast();
  }

  function scanMetaTags() {
    try {
      const nodes = domAll('meta[property],meta[name],meta[itemprop]');
      nodes.forEach(m => {
        const content = m.getAttribute('content') || '';
        if (!content) return;
        const key = (m.getAttribute('property') || m.getAttribute('name') || m.getAttribute('itemprop') || '').toLowerCase();
        const maybeMediaKey = /(url|image|video|audio|src|stream|file|thumb|poster|icon|manifest|playlist|contenturl)/i.test(key);
        if (!maybeMediaKey && !looksLikeMedia(content)) return;
        add(content, { from: 'meta:' + (key || 'content'), hintType: hintFromKey(key) });
      });
    } catch { }
  }

  function scanJsonLd() {
    try {
      const scripts = domAll('script[type="application/ld+json"]');
      scripts.forEach(s => {
        const txt = s.textContent || '';
        if (!txt) return;
        const sig = `${txt.length}:${txt.slice(0, 180)}:${txt.slice(-120)}`;
        if (jsonLdSigSeen.get(s) === sig) return;
        jsonLdSigSeen.set(s, sig);
        const parsed = safeJsonParse(txt);
        if (!parsed) return;
        walkObjectForUrls(parsed, 'json-ld', '', 0);
      });
    } catch { }
  }

  function scanInlineScriptsForMediaUrls() {
    try {
      const scripts = domAll('script:not([src])');
      let scanned = 0;
      for (const s of scripts) {
        if (scanned >= CFG.maxScriptTagsPerScan) break;
        const txt = s.textContent || '';
        if (!txt || txt.length > CFG.maxScriptScanBytes) continue;
        const sig = `${txt.length}:${txt.slice(0, 120)}:${txt.slice(-80)}`;
        if (scriptSigSeen.get(s) === sig) continue;
        scriptSigSeen.set(s, sig);
        scanned++;

        let hits = 0;
        const addHit = (u, from, hint) => {
          if (!u || hits >= CFG.maxScriptHitsPerTag) return;
          const cand = String(u).trim().replace(/[),.;]+$/, '');
          if (!cand) return;
          if (!looksLikeMedia(cand) && !scriptUrlCandidateRe.test(cand)) return;
          hits++;
          add(cand, { from, hintType: hint || '' });
        };

        const absRe = /https?:\/\/[^\s"'`<>\\]+/gi;
        let m;
        while ((m = absRe.exec(txt))) addHit(m[0], 'script:url', '');

        const escRe = /https?:\\\/\\\/[^\s"'`<>\\]+/gi;
        while ((m = escRe.exec(txt))) {
          const un = m[0].replace(/\\\//g, '/').replace(/\\u0026/gi, '&').replace(/\\u003d/gi, '=');
          addHit(un, 'script:escaped-url', '');
        }

        const relRe = /(?:^|["'`])((?:\/|\.\.?\/)[^"'`\s<>]+?\.(?:m3u8|mpd|mp4|webm|mp3|m4a|jpg|jpeg|png|gif|webp|avif|vtt|srt)(?:[?#][^"'`\s<>]*)?)/gi;
        while ((m = relRe.exec(txt))) addHit(m[1], 'script:relative', '');
      }
    } catch { }
  }

  function getYoutubePlayerResponse() {
    try {
      const a = page.ytInitialPlayerResponse;
      if (a && typeof a === 'object') return a;
    } catch { }
    try {
      const b = page.ytplayer?.config?.args?.player_response;
      if (b) {
        const parsed = typeof b === 'string' ? safeJsonParse(b) : b;
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch { }
    try {
      const c = page.ytcfg?.data_?.PLAYER_RESPONSE;
      if (c && typeof c === 'object') return c;
    } catch { }
    return null;
  }

  function extractYouTubeMedia() {
    if (!isYouTubeHost()) return;
    const pr = getYoutubePlayerResponse();
    if (!pr || typeof pr !== 'object') return;

    const vid = pr.videoDetails?.videoId || '';
    const sd = pr.streamingData || {};
    const sig = [
      vid,
      sd.hlsManifestUrl || '',
      sd.dashManifestUrl || '',
      (sd.formats && sd.formats.length) || 0,
      (sd.adaptiveFormats && sd.adaptiveFormats.length) || 0
    ].join('|');
    if (sig && sig === ytSnapshotSig) return;
    ytSnapshotSig = sig || ytSnapshotSig;

    if (sd.hlsManifestUrl) add(sd.hlsManifestUrl, { from: 'youtube:hls', hintType: 'playlist', note: 'YouTube HLS manifest' });
    if (sd.dashManifestUrl) add(sd.dashManifestUrl, { from: 'youtube:dash', hintType: 'playlist', note: 'YouTube DASH manifest' });

    const fmts = [];
    if (Array.isArray(sd.formats)) fmts.push(...sd.formats);
    if (Array.isArray(sd.adaptiveFormats)) fmts.push(...sd.adaptiveFormats);
    for (const f of fmts) {
      const mime = String(f?.mimeType || '');
      const h = mime.includes('audio/') ? 'audio' : (mime.includes('video/') ? 'video' : '');
      const note = f?.itag ? `YouTube itag ${f.itag}` : 'YouTube format';
      const size = Number(f?.contentLength) || 0;
      const directUrl = f?.url || parseYoutubeCipherUrl(f?.signatureCipher || f?.cipher || '');
      if (directUrl) add(directUrl, { from: 'youtube:format', mime, size, note, hintType: h });
      else if (f?.signatureCipher || f?.cipher) {
        const base = parseYoutubeCipherUrl(f?.signatureCipher || f?.cipher || '');
        if (base) add(base, { from: 'youtube:cipher-base', mime, note: note + ' (signature may expire)', hintType: h });
      }
    }

    try {
      const tracks = pr.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
      for (const tr of tracks) {
        const u = tr?.baseUrl || '';
        if (!u) continue;
        add(u, { from: 'youtube:captions', mime: tr?.mimeType || 'text/vtt', note: tr?.name?.simpleText || 'caption', hintType: 'subs' });
      }
    } catch { }

    try {
      const thumbs = pr.videoDetails?.thumbnail?.thumbnails || [];
      for (const th of thumbs) {
        if (th?.url) add(th.url, { from: 'youtube:thumbnail', hintType: 'image', note: 'YouTube thumbnail' });
      }
    } catch { }
  }

  function scanExtractorPages() {
    addExtractorCandidate(location.href, 'page:location');
    probeBridgeForUrl(location.href, false);

    try {
      const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href') || '';
      if (canonical) {
        addExtractorCandidate(canonical, 'page:canonical');
        probeBridgeForUrl(canonical, false);
      }
    } catch { }

    try {
      const og = document.querySelector('meta[property="og:url"],meta[name="og:url"]')?.getAttribute('content') || '';
      if (og) {
        addExtractorCandidate(og, 'page:og-url');
        probeBridgeForUrl(og, false);
      }
    } catch { }
  }

  function runDeepExtractors() {
    scanMetaTags();
    scanJsonLd();
    scanInlineScriptsForMediaUrls();
    extractYouTubeMedia();
    scanExtractorPages();
  }

  function getMediaSrc(el) {
    try {
      return el.currentSrc || el.src || el.getAttribute('src') || '';
    } catch {
      return '';
    }
  }

  function trackPlayer(el, why) {
    if (recordingPlayers.has(el)) return;
    const ttag = el?.tagName?.toLowerCase();
    if (ttag !== 'video' && ttag !== 'audio') return;

    const cur = getMediaSrc(el);
    const src = cur ? (norm(cur) || cur) : '';

    let info = players.get(el);
    if (!info) {
      if (players.size >= CFG.maxPlayers) return;
      info = { id: 'p' + (++playerSeq), tag: ttag, why: new Set(), src: '', last: 0, protected: !!el.mediaKeys };
      el.addEventListener('encrypted', () => {
        info.protected = true;
        if (rec?.el === el) stopRecord('The player uses DRM. Recording was stopped.');
        scheduleRender();
      });
      players.set(el, info);
    }

    info.protected = info.protected || !!el.mediaKeys;
    if (why) info.why.add(why);
    if (info.why.size > CFG.maxReasons) info.why = new Set(Array.from(info.why).slice(-CFG.maxReasons));

    if (src && src !== info.src) {
      info.src = src;
      info.last = now();

      if (!srcSeen.has(src)) {
        srcSeen.add(src);
        add(src, { from: 'player:' + ttag, hintType: ttag });
      }
    }

    scheduleRender();
  }

  function cleanupPlayers() {
    const n = now();
    for (const [el, info] of players) {
      if (!el || !el.isConnected) {
        players.delete(el);
        continue;
      }
      if (info && info.src && n - (info.last || 0) > 10 * 60 * 1000) info.last = n;
    }
  }

  function scanDom() {
    try {
      const nodes = domAll('video,audio,img,picture,source,track,link[href],[src],[href],[poster],[srcset],[data-src],[data-href],[data-url],[data-image],[data-img],[data-original],[data-lazy-src],[data-thumb],[data-thumbnail],[data-poster],[data-srcset],style,[style*="url("]');
      nodes.forEach(n => {
        if (recordingPlayers.has(n)) return;
        const tg = n.tagName?.toLowerCase();
        const baseHint = tagHint(tg);
        if (tg === 'video' || tg === 'audio') trackPlayer(n, 'dom');
        if (tg === 'img') {
          const cur = getMediaSrc(n);
          if (cur) add(cur, { from: 'dom:img', hintType: 'image' });
        }
        if (tg === 'source') {
          const parentTag = n.parentElement?.tagName?.toLowerCase() || '';
          const src = n.getAttribute && n.getAttribute('src');
          const srcHint = parentTag === 'picture' ? 'image' : (baseHint || tagHint(parentTag));
          if (src) add(src, { from: 'dom:source', hintType: srcHint });
        }
        if (tg === 'link') {
          const rel = String(n.getAttribute('rel') || '').toLowerCase();
          const as = String(n.getAttribute('as') || '').toLowerCase();
          const href = n.getAttribute('href');
          const hint = normalizeType(as) || (rel.includes('icon') ? 'image' : '');
          if (href) add(href, { from: 'dom:link', hintType: hint });
        }

        ['src', 'href', 'poster', 'data-src', 'data-href', 'data-url', 'data-image', 'data-img', 'data-original', 'data-lazy-src', 'data-thumb', 'data-thumbnail', 'data-poster'].forEach(a => {
          const v = n.getAttribute && n.getAttribute(a);
          if (v) {
            const hint = (a === 'poster' || a.includes('image') || a.includes('thumb') || a.includes('poster') || a === 'data-img') ? 'image' : baseHint;
            add(v, { from: 'dom:' + a, hintType: hint });
          }
        });

        ['srcset', 'data-srcset'].forEach(a => {
          const v = n.getAttribute && n.getAttribute(a);
          if (!v) return;
          const parsed = parseSrcset(v);
          parsed.forEach(u => add(u, { from: 'dom:' + a, hintType: 'image' }));
        });

        if (n.hasAttribute && n.hasAttribute('style')) {
          const inlineCss = n.getAttribute('style') || '';
          extractCssUrls(inlineCss).forEach(u => add(u, { from: 'dom:style', hintType: 'image' }));
        }

        if (tg === 'style') {
          const cssText = n.textContent || '';
          const sig = `${cssText.length}:${cssText.slice(0, 160)}`;
          if (styleSigSeen.get(n) !== sig) {
            styleSigSeen.set(n, sig);
            extractCssUrls(cssText).forEach(u => add(u, { from: 'dom:style-tag', hintType: 'image' }));
          }
        }
      });
    } catch { }

    scanPlayerApis();
    runDeepExtractors();
  }

  function observeResources() {
    const take = (name, initiatorType) => {
      const init = String(initiatorType || '').toLowerCase();
      const hint = init === 'img' ? 'image' : (init === 'audio' ? 'audio' : (init === 'video' ? 'video' : (init === 'track' ? 'subs' : '')));
      add(name, { from: 'perf:' + (initiatorType || 'resource'), hintType: hint });
    };

    try {
      performance.getEntriesByType('resource').forEach(e => take(e.name, e.initiatorType));
    } catch { }

    try {
      const po = new PerformanceObserver(list => {
        try {
          for (const e of list.getEntries()) take(e.name, e.initiatorType);
        } catch { }
      });
      po.observe({ type: 'resource', buffered: true });
    } catch { }
  }

  function readHeader(headers, key) {
    try {
      if (!headers) return '';
      if (typeof headers.get === 'function') return headers.get(key) || '';
      return '';
    } catch { return ''; }
  }

  function sniffPlaylistText(url, mime, txt, from) {
    try {
      const body = String(txt || '');
      if (!url || !body) return;

      const hasM3u = /^\s*#EXTM3U/i.test(body) || /#EXT-X/i.test(body);
      const hasMpd = /<MPD[\s>]/i.test(body);
      if (!hasM3u && !hasMpd) return;

      cacheManifest(url, body);
      add(url, { from: from || 'sniff:playlist', mime: mime, note: 'playlist', hintType: 'playlist' });
      const base = new URL(url, location.href);

      if (hasM3u) {
        const lines = body.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        for (const ln of lines) {
          if (!ln || ln.startsWith('#')) continue;
          if (/^data:/i.test(ln)) continue;
          let abs = null;
          try { abs = new URL(ln, base.href).href; } catch { abs = null; }
          if (abs) add(abs, { from: 'playlist:child', hintType: /\.m3u8(?:$|[?#])/i.test(abs) ? 'playlist' : 'video' });
        }
      }

      if (hasMpd) {
        const re = /\b(?:src|media|initialization|href)\s*=\s*["']([^"']+)["']/gi;
        let m;
        while ((m = re.exec(body))) {
          const raw = m[1];
          if (!raw || /^data:/i.test(raw) || /\$[^$]+\$/.test(raw)) continue;
          let abs = null;
          try { abs = new URL(raw, base.href).href; } catch { abs = null; }
          if (abs) add(abs, { from: 'playlist:child', hintType: 'video' });
        }
      }
    } catch { }
  }

  async function sniffMaybePlaylist(url, mime, resp) {
    try {
      if (!resp || !resp.ok) return;
      const ct = (mime || '').toLowerCase();
      const isPlaylist = ct.includes('mpegurl') || ct.includes('dash+xml') || /\.m3u8(\b|[?#&/])/i.test(url) || /\.mpd(\b|[?#&/])/i.test(url);
      const looksText = PLAYLIST_MIME.some(re => re.test(ct)) || isPlaylist;

      const len = Number(readHeader(resp.headers, 'content-length')) || 0;
      if (len && len > CFG.maxFetchBodyBytesForPlaylist) return;
      if (!looksText) return;

      const txt = await smallText(resp);
      if (!txt) return;
      sniffPlaylistText(url, mime, txt, 'sniff:playlist');
    } catch { }
  }

  function pageFn(fn) {
    try { return typeof exportFunction === 'function' ? exportFunction(fn, page) : fn; }
    catch { return fn; }
  }

  function safeHeaders(headers) {
    const out = {};
    try {
      const pairs = typeof headers?.entries === 'function' ? Array.from(headers.entries()) : Array.isArray(headers) ? headers : Object.entries(headers || {});
      for (const [key, value] of pairs) {
        if (/^(accept|authorization|range|x-[\w-]+)$/i.test(key) && !/[\r\n]/.test(String(value))) out[key] = String(value);
      }
    } catch {}
    return out;
  }

  function rememberReq(url, headers) {
    const u = norm(url);
    if (!u || !/^https?:/i.test(u)) return;
    reqInfo.delete(u);
    reqInfo.set(u, { headers: safeHeaders(headers), referrer: location.href });
    if (reqInfo.size > 500) reqInfo.delete(reqInfo.keys().next().value);
  }

  function cacheManifest(url, text) {
    manifests.delete(url);
    manifests.set(url, { text, time: now() });
    if (manifests.size > 24) manifests.delete(manifests.keys().next().value);
  }

  async function smallText(resp) {
    const copy = resp.clone();
    const limit = CFG.maxFetchBodyBytesForPlaylist;
    if (!copy.body?.getReader) {
      const text = await copy.text();
      return text.length <= limit ? text : '';
    }
    const reader = copy.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > limit) { reader.cancel().catch(() => {}); return ''; }
        chunks.push(part.value);
      }
      const bytes = new Uint8Array(size);
      let at = 0;
      for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
      return new TextDecoder().decode(bytes);
    } catch { return ''; }
    finally { reader.releaseLock(); }
  }

  async function sniffResponse(url, mime, resp) {
    if (!resp.ok) return;
    const textLike = /json|xml|mpegurl|text\/plain/i.test(mime) || /\.(m3u8|mpd)(?:$|[?#])/i.test(url);
    if (!textLike) return;
    if (Number(readHeader(resp.headers, 'content-length')) > CFG.maxFetchBodyBytesForPlaylist) return;
    const text = await smallText(resp);
    if (!text) return;
    if (/^\s*#EXTM3U|<MPD[\s>]/i.test(text)) sniffPlaylistText(url, mime, text, 'network:manifest');
    else if (/^\s*[\[{]/.test(text)) walkObjectForUrls(safeJsonParse(text), 'network:json', '', 0);
  }

  function patchFetch() {
    const orig = page.fetch;
    if (!orig) return;
    page.fetch = pageFn(function (...args) {
      let url = '';
      try {
        url = norm(typeof args[0] === 'string' || args[0] instanceof URL ? String(args[0]) : args[0]?.url) || '';
        rememberReq(url, args[1]?.headers || args[0]?.headers);
      } catch {}
      const result = orig.apply(this, args);
      result.then(resp => {
        try {
          const ct = readHeader(resp.headers, 'content-type');
          const len = Number(readHeader(resp.headers, 'content-length')) || 0;
          const target = resp.url || url;
          if (url) add(url, { from: 'fetch', mime: ct, size: len });
          if (target !== url) {
            rememberReq(target, new URL(target).origin === new URL(url).origin ? reqInfo.get(url)?.headers : {});
            add(target, { from: 'fetch:final', mime: ct, size: len });
          }
          sniffResponse(target, ct, resp).catch(() => {});
        } catch {}
      }, () => {});
      return result;
    });
  }

  function patchXHR() {
    const proto = page.XMLHttpRequest?.prototype;
    if (!proto) return;
    const open0 = proto.open;
    const send0 = proto.send;
    const set0 = proto.setRequestHeader;
    const data = new WeakMap();
    proto.open = pageFn(function (method, url) {
      const old = data.get(this);
      if (old?.done) this.removeEventListener('loadend', old.done);
      data.set(this, { url: norm(url), headers: {}, method: String(method || '') });
      return open0.apply(this, arguments);
    });
    proto.setRequestHeader = pageFn(function (key, value) {
      const info = data.get(this);
      if (info) Object.assign(info.headers, safeHeaders({ [key]: value }));
      return set0.apply(this, arguments);
    });
    proto.send = pageFn(function () {
      const info = data.get(this);
      if (info) {
        rememberReq(info.url, info.headers);
        info.done = () => {
          try {
            const target = this.responseURL || info.url;
            const ct = this.getResponseHeader('content-type') || '';
            rememberReq(target, info.headers);
            add(target, { from: 'xhr', mime: ct, size: Number(this.getResponseHeader('content-length')) || 0 });
            if (this.responseType === 'json') walkObjectForUrls(this.response, 'xhr:json', '', 0);
            else if ((!this.responseType || this.responseType === 'text') && /json|xml|mpegurl|text\/plain/i.test(ct)) {
              const text = this.responseText || '';
              if (text.length <= CFG.maxFetchBodyBytesForPlaylist) {
                sniffPlaylistText(target, ct, text, 'xhr:manifest');
                if (/^\s*[\[{]/.test(text)) walkObjectForUrls(safeJsonParse(text), 'xhr:json', '', 0);
              }
            } else if (this.responseType === 'arraybuffer' && /mpegurl|dash\+xml/i.test(ct) && this.response?.byteLength <= CFG.maxFetchBodyBytesForPlaylist) {
              sniffPlaylistText(target, ct, new TextDecoder().decode(this.response), 'xhr:manifest');
            }
          } catch {}
          info.done = null;
        };
        this.addEventListener('loadend', info.done, { once: true });
      }
      return send0.apply(this, arguments);
    });
  }

  function patchMediaSource() {
    const orig = page.URL?.createObjectURL;
    if (!orig) return;
    page.URL.createObjectURL = pageFn(function (value) {
      const url = orig.apply(this, arguments);
      if (recordingBlobs.has(value)) return url;
      try {
        if (page.MediaSource && value instanceof page.MediaSource || page.ManagedMediaSource && value instanceof page.ManagedMediaSource) {
          add(url, { from: 'mediasource', hintType: 'video', mse: true });
        } else if (value?.size && /^(video|audio|image)\//i.test(value.type || '')) {
          add(url, { from: 'blob', hintType: value.type.split('/')[0], mime: value.type, size: value.size });
        }
      } catch {}
      return url;
    });
  }

  function scanPlayerApis() {
    try {
      const vars = ['__NEXT_DATA__', '__INITIAL_STATE__', '__PLAYER_CONFIG__', 'playerConfig'];
      for (const key of vars) {
        const val = page[key];
        if (val && typeof val === 'object') walkObjectForUrls(val, 'player:config', '', 0);
      }
      if (typeof page.jwplayer === 'function') {
        const list = page.jwplayer()?.getPlaylist?.();
        if (list) walkObjectForUrls(list, 'player:jwplayer', 'video', 0);
      }
      for (const item of page.videojs?.getAllPlayers?.() || []) {
        for (const src of item.currentSources?.() || []) add(src.src, { from: 'player:videojs', mime: src.type, hintType: 'video' });
      }
    } catch {}
  }

  function patchSetSrcAttr() {
    const proto = page.Element.prototype;
    const setAttr0 = proto.setAttribute;
    proto.setAttribute = pageFn(function (name, value) {
      try {
        const n = String(name || '').toLowerCase();
        const tag = this?.tagName?.toLowerCase?.() || '';
        if (n === 'srcset' || n === 'data-srcset') {
          parseSrcset(String(value || '')).forEach(u => add(u, { from: 'attr:' + n, hintType: 'image' }));
        } else if (n === 'style') {
          extractCssUrls(String(value || '')).forEach(u => add(u, { from: 'attr:style', hintType: 'image' }));
        } else if (
          n === 'src' || n === 'href' || n === 'poster' ||
          n === 'data-src' || n === 'data-href' || n === 'data-url' ||
          n === 'data-image' || n === 'data-img' || n === 'data-original' ||
          n === 'data-lazy-src' || n === 'data-thumb' || n === 'data-thumbnail' || n === 'data-poster'
        ) {
          const hint = (n === 'poster' || n.includes('image') || n.includes('thumb') || n.includes('poster') || n === 'data-img') ? 'image' : tagHint(tag);
          add(value, { from: 'attr:' + n, hintType: hint });
        }
      } catch { }
      return setAttr0.apply(this, arguments);
    });
  }

  function ensureUI() {
    if (inFrame || ui) return;

    const root = document.createElement('div');
    root.id = '__mf_root__';
    root.style.webkitUserSelect = 'none';
    root.style.userSelect = 'none';
    root.attachShadow?.({ mode: 'open' });

    const host = root.shadowRoot || root;

    const style = document.createElement('style');
    style.textContent = `
      :host {
        --mf-bg: rgba(12, 6, 24, .96);
        --mf-bg-strong: rgba(22, 10, 39, .98);
        --mf-surface: rgba(50, 20, 78, .38);
        --mf-surface-strong: rgba(35, 13, 61, .82);
        --mf-surface-soft: rgba(91, 33, 182, .18);
        --mf-border: rgba(196, 181, 253, .22);
        --mf-border-strong: rgba(216, 180, 254, .48);
        --mf-text: #f5ebff;
        --mf-text-soft: rgba(245, 235, 255, .76);
        --mf-accent: #c084fc;
        --mf-accent-strong: #8b5cf6;
        --mf-link: #e9d5ff;
        --mf-shadow: 0 26px 80px rgba(5, 2, 13, .6);
        --mf-dur-fast: 160ms;
        --mf-dur-med: 260ms;
        --mf-dur-slow: 420ms;
        --mf-stagger-step: 26ms;
        --mf-ease: cubic-bezier(.2,.8,.2,1);
        --mf-float-y: 12px;
        --mf-stage-max: 1420px;
        --mf-panel-max: 980px;
        --mf-panel-height: min(720px, calc(100dvh - 24px));
        --mf-preview-height: min(720px, calc(100dvh - 24px));
        --mf-glow: 0 0 0 1px rgba(192,132,252,.18), 0 22px 52px rgba(8,3,19,.42);
        --mf-backdrop: rgba(3,1,8,.58);
        --mf-launcher-grad-a: rgba(192,132,252,.22);
        --mf-launcher-top: rgba(25,12,43,.96);
        --mf-launcher-bottom: rgba(10,6,21,.98);
        --mf-panel-glow-a: rgba(192,132,252,.16);
        --mf-panel-glow-b: rgba(124,58,237,.12);
        --mf-panel-top: rgba(28,11,47,.98);
        --mf-panel-bottom: rgba(10,6,21,.98);
        --mf-dock-glow: rgba(216,180,254,.16);
        --mf-dock-top: rgba(30,12,50,.98);
        --mf-dock-bottom: rgba(9,6,20,.98);
        --mf-card-top: rgba(34, 13, 57, .72);
        --mf-card-bottom: rgba(18, 8, 33, .76);
        --mf-control-bg: rgba(53, 19, 86, .82);
        --mf-control-bg-soft: rgba(38, 15, 63, .72);
        --mf-brand-bg: rgba(59, 26, 96, .72);
        --mf-badge-bg: rgba(69, 28, 112, .55);
        --mf-preview-player-top: rgba(18, 9, 32, .98);
        --mf-preview-player-bottom: rgba(8, 5, 18, 1);
      }
      :host([data-theme="neon"]) {
        --mf-bg: rgba(22, 5, 28, .96);
        --mf-bg-strong: rgba(32, 8, 38, .98);
        --mf-surface: rgba(121, 24, 72, .34);
        --mf-surface-strong: rgba(73, 14, 73, .84);
        --mf-surface-soft: rgba(244, 114, 182, .18);
        --mf-border: rgba(251, 207, 232, .2);
        --mf-border-strong: rgba(244, 114, 182, .44);
        --mf-text: #fff1f7;
        --mf-text-soft: rgba(255, 241, 247, .76);
        --mf-accent: #fb7185;
        --mf-accent-strong: #ec4899;
        --mf-link: #fecdd3;
        --mf-backdrop: rgba(18, 2, 14, .64);
        --mf-launcher-grad-a: rgba(244,114,182,.28);
        --mf-launcher-top: rgba(63, 12, 38, .96);
        --mf-launcher-bottom: rgba(24, 5, 22, .98);
        --mf-panel-glow-a: rgba(244,114,182,.22);
        --mf-panel-glow-b: rgba(190,24,93,.14);
        --mf-panel-top: rgba(61,10,42,.98);
        --mf-panel-bottom: rgba(20,4,20,.98);
        --mf-dock-glow: rgba(251,207,232,.18);
        --mf-dock-top: rgba(69,12,47,.98);
        --mf-dock-bottom: rgba(23,4,20,.98);
        --mf-card-top: rgba(87, 15, 55, .74);
        --mf-card-bottom: rgba(35, 7, 26, .8);
        --mf-control-bg: rgba(118, 21, 75, .82);
        --mf-control-bg-soft: rgba(77, 13, 53, .74);
        --mf-brand-bg: rgba(122, 20, 73, .74);
        --mf-badge-bg: rgba(136, 24, 84, .55);
        --mf-preview-player-top: rgba(42, 8, 28, .98);
        --mf-preview-player-bottom: rgba(18, 4, 16, 1);
        --mf-glow: 0 0 0 1px rgba(251,113,133,.18), 0 22px 52px rgba(24,4,20,.42);
      }
      :host([data-theme="aurora"]) {
        --mf-bg: rgba(7, 14, 24, .96);
        --mf-bg-strong: rgba(10, 22, 33, .98);
        --mf-surface: rgba(14, 116, 144, .28);
        --mf-surface-strong: rgba(12, 74, 110, .82);
        --mf-surface-soft: rgba(45, 212, 191, .16);
        --mf-border: rgba(153, 246, 228, .18);
        --mf-border-strong: rgba(34, 211, 238, .4);
        --mf-text: #ebfffe;
        --mf-text-soft: rgba(235, 255, 254, .74);
        --mf-accent: #2dd4bf;
        --mf-accent-strong: #06b6d4;
        --mf-link: #99f6e4;
        --mf-backdrop: rgba(2, 10, 14, .62);
        --mf-launcher-grad-a: rgba(45,212,191,.22);
        --mf-launcher-top: rgba(9, 40, 50, .96);
        --mf-launcher-bottom: rgba(5, 18, 28, .98);
        --mf-panel-glow-a: rgba(45,212,191,.18);
        --mf-panel-glow-b: rgba(6,182,212,.12);
        --mf-panel-top: rgba(10, 44, 58, .98);
        --mf-panel-bottom: rgba(5, 20, 30, .98);
        --mf-dock-glow: rgba(153,246,228,.16);
        --mf-dock-top: rgba(9, 51, 61, .98);
        --mf-dock-bottom: rgba(4, 18, 25, .98);
        --mf-card-top: rgba(12, 77, 88, .58);
        --mf-card-bottom: rgba(8, 34, 41, .78);
        --mf-control-bg: rgba(14, 96, 107, .72);
        --mf-control-bg-soft: rgba(9, 63, 72, .72);
        --mf-brand-bg: rgba(11, 95, 105, .74);
        --mf-badge-bg: rgba(10, 115, 122, .52);
        --mf-preview-player-top: rgba(7, 31, 39, .98);
        --mf-preview-player-bottom: rgba(4, 16, 24, 1);
        --mf-glow: 0 0 0 1px rgba(45,212,191,.16), 0 22px 52px rgba(4,16,24,.4);
      }
      :host([data-motion="calm"]) {
        --mf-dur-fast: 120ms;
        --mf-dur-med: 180ms;
        --mf-dur-slow: 260ms;
        --mf-stagger-step: 10ms;
        --mf-float-y: 6px;
      }
      :host([data-motion="off"]) {
        --mf-dur-fast: 1ms;
        --mf-dur-med: 1ms;
        --mf-dur-slow: 1ms;
        --mf-stagger-step: 0ms;
        --mf-float-y: 0px;
      }
      :host([data-dock-side="left"]) .mf_stage {
        flex-direction: row-reverse;
      }
      :host([data-panel-width="wide"]) {
        --mf-stage-max: 1540px;
        --mf-panel-max: 1100px;
      }
      :host([data-panel-width="narrow"]) {
        --mf-stage-max: 1280px;
        --mf-panel-max: 860px;
      }
      :host([data-panel-width="ultra"]) {
        --mf-stage-max: 1680px;
        --mf-panel-max: 1240px;
      }
      :host([data-panel-height="compact"]) {
        --mf-panel-height: min(620px, calc(100dvh - 24px));
        --mf-preview-height: min(620px, calc(100dvh - 24px));
      }
      :host([data-panel-height="tall"]) {
        --mf-panel-height: min(820px, calc(100dvh - 24px));
        --mf-preview-height: min(820px, calc(100dvh - 24px));
      }
      :host([data-panel-height="full"]) {
        --mf-panel-height: calc(100dvh - 24px);
        --mf-preview-height: calc(100dvh - 24px);
      }
      :host, * { box-sizing: border-box; }
      :host, :host * { -webkit-user-select: none !important; user-select: none !important; }
      input, textarea, [contenteditable="true"] { -webkit-user-select: text !important; user-select: text !important; }
      @keyframes mfRise {
        from { opacity: 0; transform: translateY(var(--mf-float-y)) scale(.985); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes mfGlowSweep {
        0% { box-shadow: 0 0 0 rgba(0,0,0,0); }
        50% { box-shadow: 0 0 0 1px rgba(255,255,255,.04), 0 16px 44px rgba(8,3,19,.42); }
        100% { box-shadow: 0 0 0 rgba(0,0,0,0); }
      }
      @keyframes mfPulseDot {
        0%, 100% { transform: scale(1); opacity: .95; }
        50% { transform: scale(1.28); opacity: .7; }
      }
      @keyframes mfNameShift {
        0% { background-position: 0% 50%; }
        100% { background-position: 200% 50%; }
      }
      .mf_btn {
        position: fixed; right: 12px; bottom: 12px; z-index: 2147483647;
        background:
          radial-gradient(circle at top left, var(--mf-launcher-grad-a), transparent 48%),
          linear-gradient(180deg, var(--mf-launcher-top), var(--mf-launcher-bottom));
        color: var(--mf-text);
        border: 1px solid var(--mf-border-strong); border-radius: 16px;
        padding: 10px 14px; cursor: pointer; font: 12px system-ui,-apple-system,"Segoe UI",sans-serif;
        display:flex; align-items:center; gap:10px; box-shadow: 0 18px 44px rgba(6,2,14,.48);
        backdrop-filter: blur(14px);
        transition: transform var(--mf-dur-med) var(--mf-ease), box-shadow var(--mf-dur-med) var(--mf-ease), opacity var(--mf-dur-fast) linear;
      }
      :host([data-launcher-position="top-left"]) .mf_btn { left: 12px; right: auto; top: 12px; bottom: auto; }
      :host([data-launcher-position="top"]) .mf_btn { left: 50%; right: auto; top: 12px; bottom: auto; transform: translateX(-50%); }
      :host([data-launcher-position="top-right"]) .mf_btn { left: auto; right: 12px; top: 12px; bottom: auto; }
      :host([data-launcher-position="center-left"]) .mf_btn { left: 12px; right: auto; top: 50%; bottom: auto; transform: translateY(-50%); }
      :host([data-launcher-position="center"]) .mf_btn { left: 50%; right: auto; top: 50%; bottom: auto; transform: translate(-50%, -50%); }
      :host([data-launcher-position="center-right"]) .mf_btn { left: auto; right: 12px; top: 50%; bottom: auto; transform: translateY(-50%); }
      :host([data-launcher-position="bottom-left"]) .mf_btn { left: 12px; right: auto; top: auto; bottom: 12px; }
      :host([data-launcher-position="bottom"]) .mf_btn { left: 50%; right: auto; top: auto; bottom: 12px; transform: translateX(-50%); }
      :host([data-launcher-position="bottom-right"]) .mf_btn { left: auto; right: 12px; top: auto; bottom: 12px; }
      .mf_btn:hover { transform: translateY(-2px); box-shadow: 0 22px 52px rgba(6,2,14,.56); }
      :host([data-launcher-position="top"]) .mf_btn:hover,
      :host([data-launcher-position="bottom"]) .mf_btn:hover { transform: translateX(-50%) translateY(-2px); }
      :host([data-launcher-position="center-left"]) .mf_btn:hover,
      :host([data-launcher-position="center-right"]) .mf_btn:hover { transform: translateY(calc(-50% - 2px)); }
      :host([data-launcher-position="center"]) .mf_btn:hover { transform: translate(-50%, calc(-50% - 2px)); }
      .mf_btn.mf_btn_hidden { opacity:.35; pointer-events:auto; }
      :host([data-launcher-position$="-left"]) .mf_btn.mf_btn_hidden,
      :host([data-launcher-position="center-left"]) .mf_btn.mf_btn_hidden { transform: translateX(-85%); }
      :host([data-launcher-position$="-right"]) .mf_btn.mf_btn_hidden,
      :host([data-launcher-position="center-right"]) .mf_btn.mf_btn_hidden { transform: translateX(85%); }
      :host([data-launcher-position="top"]) .mf_btn.mf_btn_hidden { transform: translate(-50%, -85%); }
      :host([data-launcher-position="bottom"]) .mf_btn.mf_btn_hidden { transform: translate(-50%, 85%); }
      :host([data-launcher-position="center"]) .mf_btn.mf_btn_hidden { transform: translate(-50%, -50%) scale(.92); }
      .mf_btn .mf_toggle {
        width: 20px; height: 20px; border-radius: 999px;
        border: 1px solid var(--mf-border-strong);
        display:grid; place-items:center;
        font-weight: 700; font-size: 12px; line-height: 1;
        background: var(--mf-control-bg);
        transition: background var(--mf-dur-fast) var(--mf-ease), color var(--mf-dur-fast) var(--mf-ease), transform var(--mf-dur-fast) var(--mf-ease);
      }
      .mf_btn:hover .mf_toggle { transform: rotate(8deg) scale(1.06); }
      .mf_dot { width: 8px; height: 8px; border-radius: 99px; background: var(--mf-accent); opacity: .95; box-shadow: 0 0 18px var(--mf-accent); animation: mfPulseDot 1.8s ease-in-out infinite; }
      .mf_cnt { font-variant-numeric: tabular-nums; opacity: .95; }
      .mf_toast {
        position: fixed; left: 50%; top: 12px; transform: translateX(-50%);
        z-index: 2147483647; pointer-events: none;
        max-width: min(920px, calc(100vw - 24px));
      }
      .mf_toast > div{
        pointer-events: auto;
        background:
          radial-gradient(circle at top left, var(--mf-launcher-grad-a), transparent 50%),
          linear-gradient(180deg, var(--mf-launcher-top), var(--mf-launcher-bottom));
        color: var(--mf-text);
        border: 1px solid var(--mf-border-strong);
        border-radius: 14px; padding: 10px 12px;
        display:flex; gap:10px; align-items:center;
        box-shadow: 0 18px 44px rgba(6,2,14,.44);
        backdrop-filter: blur(14px);
        font: 13px system-ui,-apple-system,"Segoe UI",sans-serif;
      }
      .mf_toast .msg { flex: 1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow: ellipsis; color: var(--mf-text-soft); }
      .mf_toast button {
        background: var(--mf-control-bg); color: var(--mf-text);
        border: 1px solid var(--mf-border); border-radius: 12px;
        padding: 7px 10px; cursor:pointer; font: 12px system-ui,-apple-system,"Segoe UI",sans-serif;
      }
      .mf_backdrop {
        position: fixed; inset: 0; z-index: 2147483647;
        background: var(--mf-backdrop); backdrop-filter: blur(10px);
        display:none; align-items:center; justify-content:center;
        padding: 12px;
        opacity: 0; pointer-events: none; transition: opacity .22s ease;
        overflow: auto;
      }
      .mf_backdrop.mf_visible { opacity: 1; pointer-events: auto; }
      .mf_stage {
        width: min(var(--mf-stage-max), calc(100vw - 24px));
        display:flex;
        align-items:stretch;
        justify-content:center;
        gap: 16px;
        margin: auto;
      }
      .mf_panel {
        flex: 1 1 auto;
        width: min(980px, calc(100vw - 24px));
        max-width: var(--mf-panel-max);
        height: var(--mf-panel-height);
        background:
          radial-gradient(circle at top left, var(--mf-panel-glow-a), transparent 32%),
          radial-gradient(circle at bottom right, var(--mf-panel-glow-b), transparent 34%),
          linear-gradient(180deg, var(--mf-panel-top), var(--mf-panel-bottom));
        color: var(--mf-text);
        border: 1px solid var(--mf-border-strong);
        border-radius: 22px; box-shadow: var(--mf-shadow);
        display:flex; flex-direction:column; overflow:hidden;
        transform: translateY(12px) scale(.98);
        opacity: 0;
        transition: transform var(--mf-dur-med) var(--mf-ease), opacity var(--mf-dur-med) var(--mf-ease), box-shadow var(--mf-dur-med) var(--mf-ease);
      }
      .mf_backdrop.mf_visible .mf_panel { transform: translateY(0) scale(1); opacity: 1; }
      .mf_previewdock {
        flex: 0 0 min(400px, 31vw);
        width: min(400px, 31vw);
        max-height: var(--mf-preview-height);
        min-height: 240px;
        background:
          radial-gradient(circle at top, var(--mf-dock-glow), transparent 34%),
          linear-gradient(180deg, var(--mf-dock-top), var(--mf-dock-bottom));
        color: var(--mf-text);
        border: 1px solid var(--mf-border);
        border-radius: 22px;
        box-shadow: var(--mf-shadow);
        display:none;
        flex-direction:column;
        overflow:hidden;
        transform: translateY(12px) scale(.98);
        opacity: 0;
        transition: transform var(--mf-dur-med) var(--mf-ease), opacity var(--mf-dur-med) var(--mf-ease), box-shadow var(--mf-dur-med) var(--mf-ease);
      }
      .mf_previewdock.mf_open { display:flex; }
      .mf_backdrop.mf_visible .mf_previewdock.mf_open { transform: translateY(0) scale(1); opacity: 1; }
      .mf_hdr {
        padding: 14px 14px 12px 14px;
        display:flex; gap:10px; align-items:center;
        border-bottom: 1px solid rgba(216,180,254,.16);
      }
      .mf_hdrmain {
        display:flex;
        align-items:center;
        gap: 12px;
        min-width: 0;
      }
      .mf_brandlink {
        flex: 0 0 auto;
        display:flex;
        align-items:center;
        justify-content:center;
        width: 38px;
        height: 38px;
        border-radius: 14px;
        border: 1px solid rgba(216,180,254,.28);
        background: var(--mf-brand-bg);
        overflow:hidden;
        box-shadow: inset 0 1px 0 rgba(255,255,255,.05);
      }
      .mf_brandicon {
        width: 22px;
        height: 22px;
        color: #fff;
      }
      .mf_titlegroup {
        min-width: 0;
        display:flex;
        flex-direction:column;
        gap: 3px;
      }
      .mf_titlebar {
        display:flex;
        align-items:center;
        gap: 10px;
        min-width: 0;
      }
      .mf_title { font: 600 14px system-ui,-apple-system,"Segoe UI",sans-serif; letter-spacing:.2px; }
      .mf_owner {
        color: rgba(233,213,255,.86);
        text-decoration:none;
        font: 12px system-ui,-apple-system,"Segoe UI",sans-serif;
        white-space: nowrap;
        background-image: linear-gradient(90deg, #3b1d78 0%, #7c3aed 38%, #a855f7 64%, #ec4899 100%);
        background-size: 200% 100%;
        background-clip: text;
        -webkit-background-clip: text;
        color: transparent;
        -webkit-text-fill-color: transparent;
        animation: mfNameShift 6.2s linear infinite;
      }
      :host([data-motion="off"]) .mf_owner { animation: none; background-position: 40% 50%; }
      .mf_sub { color: var(--mf-text-soft); font: 12px system-ui,-apple-system,"Segoe UI",sans-serif; }
      .mf_sp { flex:1; }
      .mf_iconbtn {
        background: var(--mf-control-bg); color: var(--mf-text);
        border: 1px solid var(--mf-border);
        border-radius: 14px; padding: 9px 11px; cursor:pointer;
        font: 12px system-ui,-apple-system,"Segoe UI",sans-serif;
        transition: transform var(--mf-dur-fast) var(--mf-ease), background var(--mf-dur-fast) var(--mf-ease), border-color var(--mf-dur-fast) var(--mf-ease), box-shadow var(--mf-dur-fast) var(--mf-ease);
      }
      .mf_iconbtn:hover { transform: translateY(-1px); border-color: var(--mf-border-strong); box-shadow: 0 8px 22px rgba(8,3,19,.28); }
      .mf_row {
        padding: 10px 12px; display:flex; gap:10px; align-items:center; flex-wrap:wrap;
        border-bottom: 1px solid rgba(216,180,254,.12);
      }
      .mf_customizer {
        margin: 10px 12px 0 12px;
        padding: 12px;
        border: 1px solid rgba(216,180,254,.12);
        border-radius: 18px;
        background:
          radial-gradient(circle at top right, rgba(255,255,255,.05), transparent 36%),
          linear-gradient(180deg, var(--mf-card-top), var(--mf-card-bottom));
        display:none;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 10px;
        animation: mfRise var(--mf-dur-slow) var(--mf-ease);
      }
      .mf_customizer.mf_open { display:grid; }
      .mf_field {
        min-width: 0;
        display:flex;
        flex-direction:column;
        gap: 6px;
      }
      .mf_field label {
        color: var(--mf-text-soft);
        font: 11px system-ui,-apple-system,"Segoe UI",sans-serif;
        text-transform: uppercase;
        letter-spacing: .08em;
      }
      .mf_inp {
        flex: 1; min-width: 220px;
        background: var(--mf-control-bg-soft); color: var(--mf-text);
        border: 1px solid rgba(216,180,254,.18); border-radius: 14px;
        padding: 10px 12px; outline: none; font: 12.5px system-ui,-apple-system,"Segoe UI",sans-serif;
      }
      .mf_sel {
        background: var(--mf-control-bg-soft); color: var(--mf-text);
        border: 1px solid rgba(216,180,254,.18); border-radius: 14px;
        padding: 10px 10px; outline:none; font: 12.5px system-ui,-apple-system,"Segoe UI",sans-serif;
        transition: border-color var(--mf-dur-fast) var(--mf-ease), box-shadow var(--mf-dur-fast) var(--mf-ease), transform var(--mf-dur-fast) var(--mf-ease);
      }
      .mf_inp:focus,
      .mf_sel:focus { border-color: var(--mf-border-strong); box-shadow: 0 0 0 4px rgba(192,132,252,.12); }
      .mf_body { flex:1; overflow:auto; padding: 8px 12px 12px 12px; display:flex; flex-direction:column; gap:6px; }
      .mf_tip { color: var(--mf-text-soft); font: 12px system-ui,-apple-system,"Segoe UI",sans-serif; padding: 6px 2px 4px 2px; }
      .mf_item {
        border: 1px solid rgba(216,180,254,.12);
        background:
          linear-gradient(180deg, var(--mf-card-top), var(--mf-card-bottom));
        border-radius: 16px;
        padding: 10px 10px;
        display:flex; gap:10px; align-items:flex-start;
        margin: 10px 0;
        box-shadow: 0 1px 0 rgba(255,255,255,.02);
        transition: transform var(--mf-dur-fast) var(--mf-ease), border-color var(--mf-dur-fast) var(--mf-ease), box-shadow var(--mf-dur-fast) var(--mf-ease), background var(--mf-dur-fast) var(--mf-ease);
      }
      .mf_item:hover { transform: translateY(-2px); box-shadow: var(--mf-glow); border-color: rgba(216,180,254,.24); }
      .mf_badge {
        padding: 6px 10px; border-radius: 999px;
        border: 1px solid rgba(216,180,254,.22);
        background: var(--mf-badge-bg);
        font: 600 11px system-ui,-apple-system,"Segoe UI",sans-serif;
        opacity:.9;
        min-width: 78px; text-align:center;
      }
      .mf_main { flex:1; min-width:0; }
      .mf_url {
        color: var(--mf-link); text-decoration:none; word-break: break-all;
        font: 12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      }
      .mf_meta { margin-top: 6px; color: var(--mf-text-soft); font: 12px system-ui,-apple-system,"Segoe UI",sans-serif; }
      .mf_actions { display:flex; gap:8px; align-items:center; flex-wrap: wrap; justify-content:flex-end; }
      .mf_actions button{
        background: var(--mf-control-bg); color: var(--mf-text);
        border: 1px solid rgba(216,180,254,.2); border-radius: 12px;
        padding: 7px 10px; cursor:pointer; font: 12px system-ui,-apple-system,"Segoe UI",sans-serif;
        transition: transform var(--mf-dur-fast) var(--mf-ease), background var(--mf-dur-fast) var(--mf-ease), border-color var(--mf-dur-fast) var(--mf-ease), box-shadow var(--mf-dur-fast) var(--mf-ease);
      }
      .mf_actions button:hover { transform: translateY(-1px); border-color: var(--mf-border-strong); box-shadow: 0 10px 20px rgba(8,3,19,.25); }
      .mf_compact .mf_item{ padding: 8px 10px; }
      .mf_compact .mf_meta{ display:none; }
      .mf_listwrap { min-height:0; }
      .mf_listwrap .mf_item { margin: 10px 0; }
      .mf_listwrap.mf_grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px; }
      .mf_listwrap.mf_grid .mf_item { margin: 0; flex-direction: column; align-items: stretch; }
      .mf_listwrap.mf_grid .mf_actions { justify-content:flex-start; }
      .mf_item_selected { border-color: rgba(216,180,254,.56); box-shadow: 0 0 0 1px rgba(192,132,252,.22), 0 14px 36px rgba(5,2,13,.34); }
      .mf_item_selected .mf_badge { border-color: rgba(216,180,254,.56); }
      .mf_previewdock.mf_peek {
        box-shadow: 0 0 0 1px rgba(216,180,254,.4), 0 24px 48px rgba(5,2,13,.38);
        animation: mfGlowSweep var(--mf-dur-slow) var(--mf-ease);
      }
      .mf_previewdock_hdr {
        padding: 14px;
        display:flex;
        gap: 10px;
        align-items:flex-start;
        justify-content:space-between;
        border-bottom: 1px solid rgba(216,180,254,.12);
      }
      .mf_previewdock_copy {
        min-width: 0;
        display:flex;
        flex-direction:column;
        gap: 4px;
      }
      .mf_previewdock_title {
        font: 600 13px system-ui,-apple-system,"Segoe UI",sans-serif;
      }
      .mf_previewdock_sub {
        color: var(--mf-text-soft);
        font: 12px system-ui,-apple-system,"Segoe UI",sans-serif;
        word-break: break-word;
      }
      .mf_previewdock_body {
        flex:1;
        overflow:auto;
        padding: 14px;
      }
      .mf_preview_card { display:flex; flex-direction:column; gap:10px; }
      .mf_preview_header { display:flex; gap:8px; align-items:flex-start; justify-content:space-between; }
      .mf_preview_header .mf_label { font: 600 13px system-ui,-apple-system,"Segoe UI",sans-serif; color: var(--mf-accent); }
      .mf_preview_meta { font: 12px system-ui,-apple-system,"Segoe UI",sans-serif; color: var(--mf-text-soft); display:flex; flex-direction:column; gap:4px; word-break:break-word; }
      .mf_preview_player {
        background: linear-gradient(180deg, var(--mf-preview-player-top), var(--mf-preview-player-bottom));
        border-radius: 16px;
        padding: 10px;
        border: 1px solid rgba(216,180,254,.12);
      }
      .mf_preview_player video,
      .mf_preview_player audio,
      .mf_preview_player img {
        width: 100%;
        max-height: 420px;
        border-radius: 12px;
        background: #0e0917;
      }
      .mf_preview_empty { font: 12px system-ui,-apple-system,"Segoe UI",sans-serif; color: var(--mf-text-soft); }

      /* v1.8.0 midnight-purple rounded-rectangle UI */
      :host {
        --mf-bg: rgba(8, 5, 15, .98);
        --mf-bg-strong: rgba(13, 8, 24, .99);
        --mf-surface: rgba(35, 20, 59, .48);
        --mf-surface-strong: rgba(28, 16, 48, .94);
        --mf-surface-soft: rgba(112, 72, 173, .14);
        --mf-border: rgba(173, 146, 224, .20);
        --mf-border-strong: rgba(180, 145, 255, .44);
        --mf-text: #f4efff;
        --mf-text-soft: rgba(226, 216, 245, .72);
        --mf-accent: #b58cff;
        --mf-accent-strong: #8f5cff;
        --mf-link: #d8c2ff;
        --mf-shadow: 0 24px 64px rgba(2, 1, 8, .66);
        --mf-glow: 0 0 0 1px rgba(181,140,255,.16), 0 18px 42px rgba(4,2,12,.46);
        --mf-backdrop: rgba(4, 2, 9, .70);
        --mf-launcher-grad-a: rgba(143,92,255,.12);
        --mf-launcher-top: rgba(24,14,42,.985);
        --mf-launcher-bottom: rgba(11,7,20,.995);
        --mf-panel-top: rgba(18,11,32,.995);
        --mf-panel-bottom: rgba(9,6,17,.995);
        --mf-dock-top: rgba(20,12,35,.99);
        --mf-dock-bottom: rgba(9,6,17,.995);
        --mf-card-top: rgba(27,16,46,.90);
        --mf-card-bottom: rgba(16,10,29,.94);
        --mf-control-bg: rgba(38,22,64,.88);
        --mf-control-bg-soft: rgba(24,15,41,.92);
        --mf-brand-bg: rgba(45,26,75,.92);
        --mf-badge-bg: rgba(52,30,86,.88);
        --mf-preview-player-top: rgba(14,9,25,.99);
        --mf-preview-player-bottom: rgba(7,5,13,1);
        --mf-radius-panel: 10px;
        --mf-radius-control: 7px;
        --mf-radius-small: 5px;
      }
      .mf_panel,
      .mf_previewdock {
        border-radius: var(--mf-radius-panel) !important;
        border-color: var(--mf-border-strong);
        background: linear-gradient(180deg, var(--mf-panel-top), var(--mf-panel-bottom));
      }
      .mf_previewdock {
        background: linear-gradient(180deg, var(--mf-dock-top), var(--mf-dock-bottom));
      }
      .mf_hdr {
        padding: 12px;
        gap: 8px;
        flex-wrap: wrap;
        border-bottom: 1px solid var(--mf-border);
        background: rgba(12,8,22,.72);
      }
      .mf_hdrmain { margin-right: 4px; }
      .mf_sp { min-width: 12px; }
      .mf_brandlink,
      .mf_iconbtn,
      .mf_inp,
      .mf_sel,
      .mf_toast > div,
      .mf_toast button,
      .mf_item,
      .mf_preview_player,
      .mf_preview_player video,
      .mf_preview_player audio,
      .mf_preview_player img {
        border-radius: var(--mf-radius-control) !important;
      }
      .mf_btn {
        border-radius: var(--mf-radius-control) !important;
        background: linear-gradient(180deg, var(--mf-launcher-top), var(--mf-launcher-bottom));
        box-shadow: 0 16px 36px rgba(3,1,9,.52);
      }
      .mf_btn .mf_toggle {
        border-radius: var(--mf-radius-small) !important;
        background: rgba(48,28,80,.92);
      }
      .mf_dot {
        border-radius: 2px !important;
      }
      .mf_row {
        padding: 9px 12px;
        gap: 8px;
        border-bottom: 1px solid var(--mf-border);
        background: rgba(8,5,15,.54);
      }
      .mf_iconbtn {
        min-height: 34px;
        padding: 8px 10px;
        background: var(--mf-control-bg);
      }
      .mf_iconbtn:hover {
        background: rgba(55,31,91,.96);
        border-color: var(--mf-border-strong);
        box-shadow: 0 8px 20px rgba(4,2,12,.28);
      }
      .mf_customizer {
        margin: 10px 12px 0;
        padding: 10px;
        border-radius: var(--mf-radius-panel) !important;
        border: 1px solid var(--mf-border);
        background: rgba(13,8,24,.90);
        grid-template-columns: repeat(auto-fit,minmax(160px,1fr));
        gap: 8px;
      }
      .mf_field {
        padding: 8px;
        border: 1px solid rgba(173,146,224,.12);
        border-radius: var(--mf-radius-control);
        background: rgba(31,18,52,.44);
      }
      .mf_body {
        gap: 4px;
        scrollbar-color: rgba(181,140,255,.42) transparent;
      }
      .mf_item {
        margin: 7px 0;
        border-color: rgba(173,146,224,.16);
        background: linear-gradient(180deg,var(--mf-card-top),var(--mf-card-bottom));
      }
      .mf_item:hover {
        transform: translateY(-1px);
        border-color: var(--mf-border-strong);
        box-shadow: var(--mf-glow);
      }
      .mf_badge,
      .mf_actions button {
        border-radius: var(--mf-radius-small) !important;
      }
      .mf_badge {
        background: var(--mf-badge-bg);
        border-color: rgba(173,146,224,.22);
      }
      .mf_actions button {
        background: var(--mf-control-bg);
        border-color: var(--mf-border);
      }
      .mf_inp:focus,
      .mf_sel:focus {
        box-shadow: 0 0 0 3px rgba(181,140,255,.13);
      }
      .mf_preview_player { border-color: var(--mf-border); }
      .mf_preview_player video,
      .mf_preview_player audio,
      .mf_preview_player img { background: #08050f; }

      @media (max-width: 1180px) {
        .mf_stage { gap: 12px; }
        .mf_panel { max-width: none; }
        .mf_previewdock { flex-basis: min(360px, 36vw); width: min(360px, 36vw); }
      }
      @media (max-width: 900px) {
        .mf_backdrop { align-items:flex-start; padding: 8px; }
        .mf_stage { width: 100%; flex-direction:column; }
        :host([data-dock-side="left"]) .mf_stage { flex-direction:column; }
        .mf_panel { width: 100%; height: min(var(--mf-panel-height), min(74dvh, 760px)); }
        .mf_previewdock { width: 100%; flex-basis: auto; max-height: min(var(--mf-preview-height), min(44dvh, 420px)); }
        .mf_row {
          display:grid;
          grid-template-columns: 1fr 1fr;
          align-items:stretch;
        }
        .mf_customizer { grid-template-columns: 1fr 1fr; }
        .mf_inp { min-width: 0; grid-column: 1 / -1; }
        .mf_iconbtn, .mf_sel { min-height: 42px; }
      }
      @media (max-width: 640px) {
        .mf_btn { max-width: calc(100vw - 20px); justify-content:center; }
        .mf_toast { top: 8px; max-width: calc(100vw - 12px); }
        .mf_toast > div { flex-wrap: wrap; }
        .mf_backdrop { padding: 6px; }
        .mf_panel { height: min(var(--mf-panel-height), calc(100dvh - 12px)); border-radius: 18px; }
        .mf_previewdock { max-height: min(var(--mf-preview-height), calc(100dvh - 12px)); border-radius: 18px; }
        .mf_hdr { flex-wrap: wrap; align-items:flex-start; }
        .mf_hdrmain { width: 100%; }
        .mf_titlebar { flex-wrap: wrap; }
        .mf_row { grid-template-columns: 1fr; }
        .mf_customizer { grid-template-columns: 1fr; }
        .mf_item { flex-direction: column; }
        .mf_badge { min-width: 0; width: fit-content; }
        .mf_actions { width: 100%; justify-content:stretch; }
        .mf_actions button { flex: 1 1 100%; min-height: 42px; }
      }

      /* v1.8.x UI polish */
      @keyframes mfItemIn {
        from { opacity: 0; transform: translateY(10px) scale(.992); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes mfPreviewIn {
        from { opacity: 0; transform: translateY(8px) scale(.99); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes mfToastIn {
        from { opacity: 0; transform: translateY(-8px) scale(.985); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }

      .mf_stage {
        gap: 0;
        transition: gap var(--mf-dur-med) var(--mf-ease);
      }
      .mf_stage:has(.mf_previewdock.mf_open) { gap: 16px; }
      .mf_panel {
        box-shadow:
          0 1px 0 rgba(255,255,255,.035) inset,
          0 28px 80px rgba(2,1,8,.68),
          0 0 0 1px rgba(181,140,255,.05);
      }
      .mf_backdrop {
        background:
          radial-gradient(circle at 50% 20%, rgba(120,78,190,.09), transparent 36%),
          var(--mf-backdrop);
        transition: opacity var(--mf-dur-med) var(--mf-ease), backdrop-filter var(--mf-dur-med) var(--mf-ease);
      }
      .mf_backdrop:not(.mf_visible) { backdrop-filter: blur(2px); }
      .mf_backdrop.mf_visible { backdrop-filter: blur(12px); }

      .mf_hdr {
        position: relative;
        flex-wrap: nowrap;
        min-height: 62px;
        background:
          linear-gradient(180deg, rgba(25,15,43,.92), rgba(12,8,22,.72));
        box-shadow: 0 10px 30px rgba(3,1,9,.18);
      }
      .mf_hdr::after {
        content: "";
        position: absolute;
        left: 12px;
        right: 12px;
        bottom: -1px;
        height: 1px;
        background: linear-gradient(90deg, transparent, rgba(181,140,255,.34), transparent);
        pointer-events: none;
      }
      .mf_headeractions {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 6px;
        flex-wrap: wrap;
      }
      .mf_brandlink {
        transition: transform var(--mf-dur-med) var(--mf-ease), border-color var(--mf-dur-fast) var(--mf-ease), box-shadow var(--mf-dur-med) var(--mf-ease);
      }
      .mf_brandlink:hover {
        transform: translateY(-1px) rotate(-3deg) scale(1.04);
        border-color: var(--mf-border-strong);
        box-shadow: 0 9px 24px rgba(8,3,19,.34), 0 0 0 3px rgba(181,140,255,.08);
      }
      .mf_title {
        font-size: 14px;
        font-weight: 700;
        letter-spacing: .015em;
      }
      .mf_sub { font-size: 11.5px; }

      .mf_row {
        display: grid;
        grid-template-columns: minmax(240px, 1.7fr) repeat(3, minmax(112px, .55fr)) repeat(4, auto);
        align-items: center;
        background: rgba(8,5,15,.76);
        box-shadow: 0 10px 26px rgba(3,1,9,.10);
      }
      .mf_inp,
      .mf_sel,
      .mf_iconbtn,
      .mf_actions button {
        transition:
          transform var(--mf-dur-fast) var(--mf-ease),
          background var(--mf-dur-fast) var(--mf-ease),
          border-color var(--mf-dur-fast) var(--mf-ease),
          box-shadow var(--mf-dur-fast) var(--mf-ease),
          opacity var(--mf-dur-fast) linear;
      }
      .mf_inp,
      .mf_sel {
        min-height: 36px;
      }
      .mf_inp:hover,
      .mf_sel:hover {
        border-color: rgba(181,140,255,.30);
        background: rgba(30,18,51,.96);
      }
      .mf_iconbtn:active,
      .mf_actions button:active {
        transform: translateY(1px) scale(.975);
        transition-duration: 70ms;
      }
      .mf_closebtn {
        background: rgba(82,31,62,.70);
        border-color: rgba(255,145,181,.20);
      }
      .mf_closebtn:hover {
        background: rgba(111,39,77,.84);
        border-color: rgba(255,145,181,.34);
      }

      .mf_customizer {
        display: grid;
        margin: 0 12px;
        padding: 0 10px;
        max-height: 0;
        opacity: 0;
        visibility: hidden;
        overflow: hidden;
        transform: translateY(-6px) scale(.995);
        border-width: 0;
        transition:
          max-height var(--mf-dur-slow) var(--mf-ease),
          opacity var(--mf-dur-med) var(--mf-ease),
          transform var(--mf-dur-med) var(--mf-ease),
          margin var(--mf-dur-med) var(--mf-ease),
          padding var(--mf-dur-med) var(--mf-ease),
          border-width var(--mf-dur-fast) linear;
        animation: none;
      }
      .mf_customizer.mf_open {
        display: grid;
        margin: 10px 12px 0;
        padding: 10px;
        max-height: 460px;
        opacity: 1;
        visibility: visible;
        transform: translateY(0) scale(1);
        border-width: 1px;
      }
      .mf_field {
        transition: transform var(--mf-dur-fast) var(--mf-ease), border-color var(--mf-dur-fast) var(--mf-ease), background var(--mf-dur-fast) var(--mf-ease);
      }
      .mf_field:hover {
        transform: translateY(-1px);
        border-color: rgba(181,140,255,.24);
        background: rgba(38,22,63,.52);
      }

      .mf_body {
        padding-top: 10px;
        scrollbar-width: thin;
        scrollbar-color: rgba(181,140,255,.42) transparent;
      }
      .mf_body::-webkit-scrollbar,
      .mf_previewdock_body::-webkit-scrollbar { width: 9px; height: 9px; }
      .mf_body::-webkit-scrollbar-thumb,
      .mf_previewdock_body::-webkit-scrollbar-thumb {
        background: rgba(181,140,255,.30);
        border: 2px solid transparent;
        background-clip: padding-box;
        border-radius: 999px;
      }
      .mf_body::-webkit-scrollbar-thumb:hover,
      .mf_previewdock_body::-webkit-scrollbar-thumb:hover { background-color: rgba(181,140,255,.50); }

      .mf_item {
        position: relative;
        overflow: hidden;
      }
      .mf_item_new {
        animation: mfItemIn var(--mf-dur-slow) var(--mf-ease) backwards;
        animation-delay: min(calc(var(--mf-item-index, 0) * var(--mf-stagger-step)), 260ms);
      }
      .mf_item::before {
        content: "";
        position: absolute;
        left: 0;
        top: 10px;
        bottom: 10px;
        width: 2px;
        border-radius: 999px;
        background: linear-gradient(180deg, transparent, var(--mf-accent), transparent);
        opacity: 0;
        transform: scaleY(.35);
        transition: opacity var(--mf-dur-fast) var(--mf-ease), transform var(--mf-dur-med) var(--mf-ease);
      }
      .mf_item:hover::before,
      .mf_item_selected::before { opacity: .9; transform: scaleY(1); }
      .mf_item:hover { transform: translateY(-2px) scale(1.002); }
      .mf_item_selected {
        background:
          linear-gradient(90deg, rgba(181,140,255,.075), transparent 32%),
          linear-gradient(180deg,var(--mf-card-top),var(--mf-card-bottom));
      }
      .mf_badge {
        letter-spacing: .035em;
        box-shadow: inset 0 1px 0 rgba(255,255,255,.035);
      }
      .mf_url {
        text-decoration: none;
        transition: color var(--mf-dur-fast) var(--mf-ease), text-shadow var(--mf-dur-fast) var(--mf-ease);
      }
      .mf_url:hover {
        color: #eee4ff;
        text-shadow: 0 0 14px rgba(181,140,255,.25);
      }

      .mf_previewdock {
        display: flex;
        flex-basis: 0;
        width: 0;
        max-width: 0;
        min-width: 0;
        min-height: 0;
        opacity: 0;
        pointer-events: none;
        border-width: 0;
        transform: translateX(18px) scale(.985);
        transition:
          flex-basis var(--mf-dur-slow) var(--mf-ease),
          width var(--mf-dur-slow) var(--mf-ease),
          max-width var(--mf-dur-slow) var(--mf-ease),
          opacity var(--mf-dur-med) var(--mf-ease),
          transform var(--mf-dur-slow) var(--mf-ease),
          border-width var(--mf-dur-fast) linear;
      }
      :host([data-dock-side="left"]) .mf_previewdock { transform: translateX(-18px) scale(.985); }
      .mf_previewdock.mf_open {
        display: flex;
        flex-basis: min(400px, 31vw);
        width: min(400px, 31vw);
        max-width: min(400px, 31vw);
        min-height: 240px;
        opacity: 1;
        pointer-events: auto;
        border-width: 1px;
        transform: translateX(0) scale(1);
      }
      .mf_preview_card { animation: mfPreviewIn var(--mf-dur-slow) var(--mf-ease) both; }
      .mf_preview_player {
        overflow: hidden;
        box-shadow: inset 0 1px 0 rgba(255,255,255,.025), 0 14px 30px rgba(3,1,9,.20);
      }

      .mf_toast > div { animation: mfToastIn var(--mf-dur-med) var(--mf-ease) both; }
      .mf_btn {
        overflow: hidden;
        isolation: isolate;
      }
      .mf_btn::before {
        content: "";
        position: absolute;
        inset: -80% -35%;
        z-index: 0;
        pointer-events: none;
        background: linear-gradient(115deg, transparent 38%, rgba(255,255,255,.10) 50%, transparent 62%);
        transform: translateX(-55%) rotate(8deg);
        transition: transform 560ms var(--mf-ease);
      }
      .mf_btn > * { position: relative; z-index: 1; }
      .mf_btn:hover::before { transform: translateX(55%) rotate(8deg); }

      :host([data-motion="off"]) *,
      :host([data-motion="off"]) *::before,
      :host([data-motion="off"]) *::after {
        animation: none !important;
        scroll-behavior: auto !important;
      }

      @media (max-width: 1180px) {
        .mf_stage:has(.mf_previewdock.mf_open) { gap: 12px; }
        .mf_row {
          grid-template-columns: minmax(220px, 1fr) repeat(3, minmax(106px, .52fr));
        }
        .mf_previewdock.mf_open {
          flex-basis: min(360px, 36vw);
          width: min(360px, 36vw);
          max-width: min(360px, 36vw);
        }
      }
      @media (max-width: 900px) {
        .mf_hdr { flex-wrap: wrap; }
        .mf_headeractions { width: 100%; justify-content: stretch; }
        .mf_headeractions .mf_iconbtn { flex: 1 1 auto; }
        .mf_row { grid-template-columns: 1fr 1fr; }
        .mf_previewdock {
          flex-basis: 0;
          width: 100%;
          max-width: 100%;
          max-height: 0;
          transform: translateY(12px) scale(.99);
        }
        :host([data-dock-side="left"]) .mf_previewdock { transform: translateY(12px) scale(.99); }
        .mf_previewdock.mf_open {
          flex-basis: auto;
          width: 100%;
          max-width: 100%;
          max-height: min(var(--mf-preview-height), min(44dvh, 420px));
          min-height: 220px;
          transform: translateY(0) scale(1);
        }
      }
      @media (max-width: 640px) {
        .mf_hdr { min-height: 0; }
        .mf_headeractions { display: grid; grid-template-columns: 1fr 1fr; }
        .mf_headeractions .mf_closebtn { grid-column: 1 / -1; }
        .mf_row { grid-template-columns: 1fr; }
        .mf_customizer.mf_open { max-height: 860px; }
      }
      [hidden] { display: none !important; }
      .mf_panel, .mf_main, .mf_body, .mf_listwrap { min-width: 0; min-height: 0; }
      .mf_body { overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }
      .mf_status {
        flex: 0 0 auto; display: flex; align-items: center; gap: 8px;
        padding: 10px 12px; max-height: 130px; overflow-y: auto;
        color: var(--mf-text); background: var(--mf-surface-strong);
        border-bottom: 1px solid var(--mf-border); font: 13px system-ui, sans-serif;
      }
      .mf_status span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
      .mf_status button { flex-shrink: 0; }
      .mf_status select { max-width: min(260px, 100%); min-width: 0; }
      .mf_capture, .mf_tip, .mf_listwrap { flex-shrink: 0; }
      .mf_capture { border: 1px solid var(--mf-border); border-radius: 8px; padding: 10px; margin-bottom: 10px; background: var(--mf-surface); font: 13px system-ui, sans-serif; }
      .mf_capture summary { cursor: pointer; min-height: 28px; }
      .mf_capturecontrols { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; padding-top: 8px; }
      .mf_capturecontrols select { max-width: 100%; min-width: 0; }
      .mf_capturecontrols > select { flex: 1 1 100%; width: 100%; }
      .mf_capturecontrols label { display: flex; align-items: center; gap: 8px; }
      .mf_capture p { color: var(--mf-text-soft); line-height: 1.5; margin-bottom: 0; }
      .mf_recbar {
        position: fixed; bottom: max(12px, env(safe-area-inset-bottom)); left: 50%; transform: translateX(-50%);
        z-index: 2147483647; width: max-content; max-width: calc(100vw - 16px); border: 1px solid var(--mf-border-strong);
        border-radius: 8px; background: var(--mf-bg-strong); color: var(--mf-text); padding: 8px;
        display: flex; gap: 10px; align-items: center; box-shadow: var(--mf-shadow); font: 13px system-ui, sans-serif;
      }
      .mf_recbar span { min-width: 0; overflow-wrap: anywhere; }
      .mf_url, .mf_meta { overflow-wrap: anywhere; }
      @media (max-width: 950px), (pointer: coarse) {
        .mf_backdrop {
          inset: auto; top: var(--mf-view-top, 0px); left: var(--mf-view-left, 0px);
          width: var(--mf-view-width, 100vw); height: var(--mf-view-height, 100dvh);
          padding: max(6px, env(safe-area-inset-top)) max(6px, env(safe-area-inset-right)) max(6px, env(safe-area-inset-bottom)) max(6px, env(safe-area-inset-left));
          overflow: hidden; align-items: stretch;
        }
        .mf_stage, :host([data-dock-side="left"]) .mf_stage { position: relative; flex-direction: column; width: 100%; height: 100%; gap: 0; margin: 0; }
        .mf_panel { width: 100%; max-width: none; height: 100%; flex: 1; border-radius: 10px; }
        .mf_hdr { padding: 8px; gap: 6px; flex-shrink: 0; }
        .mf_hdrmain { width: 100%; flex: 1; gap: 8px; }
        .mf_sp { display: none; }
        .mf_headeractions #__mf_customize__ { order: -1; }
        .mf_brandlink { width: 32px; height: 32px; border-radius: 6px; }
        .mf_titlebar { gap: 4px; flex-wrap: wrap; }
        .mf_title { font-size: 14px; }
        .mf_owner { font-size: 11px; }
        .mf_headeractions { display: flex; flex-wrap: nowrap; width: 100%; overflow-x: auto; gap: 6px; justify-content: flex-start; scrollbar-width: thin; }
        .mf_headeractions .mf_iconbtn { flex: 0 0 auto; white-space: nowrap; }
        .mf_headeractions .mf_closebtn { position: sticky; right: 0; margin-left: auto; background: var(--mf-bg-strong); }
        .mf_row { flex-shrink: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); padding: 8px; gap: 6px; }
        .mf_row .mf_inp { grid-column: 1 / -1; width: 100%; min-width: 0; }
        .mf_row .mf_iconbtn { min-width: 0; font-size: 11px; padding: 6px; }
        .mf_row .mf_sel { width: 100%; min-width: 0; }
        .mf_iconbtn, .mf_sel, .mf_inp, .mf_actions button { min-height: 44px; border-radius: 6px; touch-action: manipulation; }
        .mf_inp { font-size: 16px; }
        .mf_body { flex: 1; padding: 8px; }
        .mf_item { flex-direction: column; gap: 8px; padding: 10px; border-radius: 8px; }
        .mf_listwrap.mf_grid { grid-template-columns: minmax(0, 1fr); }
        .mf_main { width: 100%; }
        .mf_actions { width: 100%; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
        .mf_actions button { width: 100%; min-width: 0; flex: none; padding: 6px; }
        .mf_url { font-size: 12px; white-space: normal; word-break: break-word; }
        .mf_customizer.mf_open { max-height: min(30dvh, 260px); overflow-y: auto; flex-shrink: 0; grid-template-columns: repeat(2, minmax(0, 1fr)); margin: 6px 8px; padding: 8px; }
        .mf_customizer .mf_sel { width: 100%; min-width: 0; }
        .mf_previewdock.mf_open {
          position: absolute; inset: 0; z-index: 5; width: 100%; max-width: 100%; min-height: 0;
          height: 100%; max-height: 100%; flex-basis: auto; border-radius: 10px; transform: none;
        }
        .mf_stage:has(.mf_previewdock.mf_open) .mf_panel { visibility: hidden; }
        .mf_previewdock_body { min-height: 0; overflow-y: auto; }
        .mf_preview_player video, .mf_preview_player img { max-height: min(48dvh, 400px); }
        .mf_capturecontrols { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .mf_capturecontrols > select, .mf_capturecontrols label { grid-column: 1 / -1; }
        .mf_capturecontrols button { padding: 6px; min-width: 0; }
        .mf_capturecontrols label select { flex: 1; }
        .mf_status { flex-wrap: wrap; padding: 8px; max-height: 140px; }
        .mf_status span { flex-basis: 100%; }
        .mf_btn { right: max(8px, env(safe-area-inset-right)); bottom: max(8px, env(safe-area-inset-bottom)); border-radius: 8px; min-height: 44px; }
      }
      @media (max-width: 950px) and (max-height: 500px) and (orientation: landscape) {
        .mf_hdr { flex-wrap: nowrap; }
        .mf_hdrmain { flex: 0 0 220px; }
        .mf_headeractions { flex: 1; width: 0; }
        .mf_row { display: flex; flex-wrap: nowrap; overflow-x: auto; }
        .mf_row .mf_inp { width: 180px; flex: 0 0 180px; }
        .mf_row .mf_sel, .mf_row .mf_iconbtn { width: auto; flex: 0 0 auto; }
        .mf_row .mf_sel { max-width: 120px; }
        .mf_status { max-height: 90px; }
        .mf_status span { flex-basis: 50%; }
        .mf_item { display: grid; grid-template-columns: auto minmax(0, 1fr) 190px; align-items: start; }
      }

    `;

    const toastWrap = document.createElement('div');
    toastWrap.className = 'mf_toast';
    toastWrap.innerHTML = `<div><div class="msg">${t('scanning')}</div>
      <button class="open">${t('open')}</button>
      <button class="copy">${t('copyAll')}</button>
      <button class="x">${t('close')}</button>
    </div>`;

    const btn = document.createElement('button');
    btn.className = 'mf_btn';
    btn.innerHTML = `<span class="mf_toggle" aria-hidden="true"><</span><span class="mf_dot"></span><span class="mf_cnt">${t('title')}</span>`;

    const backdrop = document.createElement('div');
    backdrop.className = 'mf_backdrop';
    backdrop.innerHTML = `
      <div class="mf_stage">
        <div class="mf_panel">
          <div class="mf_hdr">
            <div class="mf_hdrmain">
              <a class="mf_brandlink" href="${escapeAttr(GITHUB_URL)}" target="_blank" rel="noreferrer noopener" title="${escapeAttr(t('followGithub'))}">
                ${GITHUB_ICON_SVG}
              </a>
              <div class="mf_titlegroup">
                <div class="mf_titlebar">
                  <div class="mf_title" id="__mf_title__">${t('title')}</div>
                  <a class="mf_owner" id="__mf_owner__" href="${escapeAttr(GITHUB_URL)}" target="_blank" rel="noreferrer noopener">${escapeHtml(GITHUB_HANDLE)}</a>
                </div>
                <div class="mf_sub" id="__mf_sub__">${t('scanning')}</div>
              </div>
            </div>
            <div class="mf_sp"></div>
            <div class="mf_headeractions">
              <button class="mf_iconbtn" id="__mf_openlist__">${t('openList')}</button>
              <button class="mf_iconbtn" id="__mf_copyall__">${t('copyAll')}</button>
              <button class="mf_iconbtn" id="__mf_export__">${t('export')}</button>
              <button class="mf_iconbtn" id="__mf_customize__">${t('customize')}</button>
              <button class="mf_iconbtn mf_closebtn" id="__mf_close__">${t('close')}</button>
            </div>
          </div>
          <div class="mf_row">
            <input class="mf_inp" id="__mf_q__" placeholder="${t('search')}" />
            <select class="mf_sel" id="__mf_filter__" title="Filter by media type">
              <option value="all">${t('filterAll')}</option>
              <option value="image">${t('filterImages')}</option>
              <option value="audio">${t('filterAudio')}</option>
              <option value="video">${t('filterVideo')}</option>
              <option value="playlist">${t('filterPlaylists')}</option>
              <option value="extractor">${t('filterExtractors')}</option>
              <option value="subs">${t('filterSubs')}</option>
              <option value="other">${t('filterOther')}</option>
            </select>
            <select class="mf_sel" id="__mf_sort__" title="Sort the list">
              <option value="newest">${t('newest')}</option>
              <option value="oldest">${t('oldest')}</option>
              <option value="unique">${t('uniqueFirst')}</option>
            </select>
            <select class="mf_sel" id="__mf_lang__" title="UI language">
              <option value="auto">${t('auto')}</option>
              <option value="en">English</option>
              <option value="bg">Български</option>
            </select>
            <button class="mf_iconbtn" id="__mf_compact__">${t('compact')}</button>
            <button class="mf_iconbtn" id="__mf_layout__">${t('viewList')}</button>
            <button class="mf_iconbtn" id="__mf_toasttoggle__">${t('toast')}: ${t('on')}</button>
            <button class="mf_iconbtn" id="__mf_clear__">${t('clear')}</button>
          </div>
          <div class="mf_customizer" id="__mf_customizer__">
            <div class="mf_field">
              <label for="__mf_theme__">${t('theme')}</label>
              <select class="mf_sel" id="__mf_theme__">
                <option value="midnight">${t('themeMidnight')}</option>
                <option value="neon">${t('themeNeon')}</option>
                <option value="aurora">${t('themeAurora')}</option>
              </select>
            </div>
            <div class="mf_field">
              <label for="__mf_motion__">${t('motion')}</label>
              <select class="mf_sel" id="__mf_motion__">
                <option value="off">${t('motionOff')}</option>
                <option value="calm">${t('motionCalm')}</option>
                <option value="full">${t('motionFull')}</option>
              </select>
            </div>
            <div class="mf_field">
              <label for="__mf_dockside__">${t('dockSide')}</label>
              <select class="mf_sel" id="__mf_dockside__">
                <option value="right">${t('dockRight')}</option>
                <option value="left">${t('dockLeft')}</option>
              </select>
            </div>
            <div class="mf_field">
              <label for="__mf_launcherposition__">${t('launcherPosition')}</label>
              <select class="mf_sel" id="__mf_launcherposition__">
                <option value="top-left">${t('positionTopLeft')}</option>
                <option value="top">${t('positionTop')}</option>
                <option value="top-right">${t('positionTopRight')}</option>
                <option value="center-left">${t('positionCenterLeft')}</option>
                <option value="center">${t('positionCenter')}</option>
                <option value="center-right">${t('positionCenterRight')}</option>
                <option value="bottom-left">${t('positionBottomLeft')}</option>
                <option value="bottom">${t('positionBottom')}</option>
                <option value="bottom-right">${t('positionBottomRight')}</option>
              </select>
            </div>
            <div class="mf_field">
              <label for="__mf_panelwidth__">${t('panelWidth')}</label>
              <select class="mf_sel" id="__mf_panelwidth__">
                <option value="narrow">${t('widthNarrow')}</option>
                <option value="normal">${t('widthNormal')}</option>
                <option value="wide">${t('widthWide')}</option>
                <option value="ultra">${t('widthUltra')}</option>
              </select>
            </div>
            <div class="mf_field">
              <label for="__mf_panelheight__">${t('panelHeight')}</label>
              <select class="mf_sel" id="__mf_panelheight__">
                <option value="compact">${t('heightCompact')}</option>
                <option value="normal">${t('heightNormal')}</option>
                <option value="tall">${t('heightTall')}</option>
                <option value="full">${t('heightFull')}</option>
              </select>
            </div>
          </div>
          <div class="mf_status" id="__mf_status__" hidden>
            <span role="status" aria-live="polite"></span>
            <button class="mf_iconbtn" id="__mf_cancel__" hidden>Cancel</button>
            <select class="mf_sel" id="__mf_files__" aria-label="Choose a downloaded file" hidden></select>
            <button class="mf_iconbtn" id="__mf_save__" hidden>Save again</button>
          </div>
          <div class="mf_body" id="__mf_body__">
            <details class="mf_capture" id="__mf_capture__">
              <summary>Players &amp; recording</summary>
              <div class="mf_capturecontrols">
                <select class="mf_sel" id="__mf_player__" aria-label="Select a detected player"></select>
                <button class="mf_iconbtn" id="__mf_record__">Record player</button>
                <button class="mf_iconbtn" id="__mf_tabrecord__">Record tab / screen</button>
                <button class="mf_iconbtn" id="__mf_recordfile__" hidden>Record to file</button>
                <button class="mf_iconbtn" id="__mf_pause__" hidden>Pause recording</button>
                <button class="mf_iconbtn" id="__mf_stop__" hidden>Stop &amp; save</button>
                <label>Stream quality <select class="mf_sel" id="__mf_quality__"><option value="0">Best available</option><option value="1080">Up to 1080p</option><option value="720">Up to 720p</option><option value="480">Up to 480p</option></select></label>
              </div>
              <p>Press play first. Recording saves from the current position. Downloads with separate audio save two files; recording makes one file.</p>
            </details>
            <div class="mf_tip" id="__mf_tip__">${t('tip')}</div>
            <div class="mf_listwrap" id="__mf_list__"></div>
          </div>
        </div>
        <aside class="mf_previewdock" id="__mf_previewdock__">
          <div class="mf_previewdock_hdr">
            <div class="mf_previewdock_copy">
              <div class="mf_previewdock_title" id="__mf_previewtitle__">${t('previewPane')}</div>
              <div class="mf_previewdock_sub" id="__mf_previewsubtitle__">${t('selectPreview')}</div>
            </div>
            <button class="mf_iconbtn" id="__mf_previewclose__">${t('close')}</button>
          </div>
          <div class="mf_previewdock_body" id="__mf_preview__">
            <div class="mf_preview_empty">${t('selectPreview')}</div>
          </div>
        </aside>
      </div>
    `;

    host.appendChild(style);
    host.appendChild(toastWrap);
    host.appendChild(btn);
    host.appendChild(backdrop);
    const recbar = document.createElement('div');
    recbar.className = 'mf_recbar';
    recbar.hidden = true;
    recbar.innerHTML = '<span></span><button class="mf_iconbtn">Stop &amp; save</button>';
    host.appendChild(recbar);

    const msgEl = toastWrap.querySelector('.msg');
    const openBtn = toastWrap.querySelector('.open');
    const copyBtn = toastWrap.querySelector('.copy');
    const xBtn = toastWrap.querySelector('.x');

    openBtn.onclick = () => openPanel();
    copyBtn.onclick = () => copyAll();
    xBtn.onclick = () => { state.toast = false; saveStateSoon(); renderToastState(); };

    const arrow = btn.querySelector('.mf_toggle');
    if (arrow) {
      arrow.addEventListener('click', (e) => {
        e.stopPropagation();
        state.launcherVisible = !state.launcherVisible;
        saveState();
        applyLauncherVisibility();
        renderHeader();
      });
    }

    btn.onclick = (e) => {
      if (!state.launcherVisible) {
        state.launcherVisible = true;
        saveState();
        applyLauncherVisibility();
        renderHeader();
        return;
      }
      if (e?.target && e.target.classList && e.target.classList.contains('mf_toggle')) return;
      uiOpen ? closePanel() : openPanel();
    };

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closePanel();
    });

    ui = {
      root, host, toastWrap, msgEl, btn, backdrop, recbar,
      status: backdrop.querySelector('#__mf_status__'),
      cancel: backdrop.querySelector('#__mf_cancel__'),
      save: backdrop.querySelector('#__mf_save__'),
      files: backdrop.querySelector('#__mf_files__'),
      capture: backdrop.querySelector('#__mf_capture__'),
      player: backdrop.querySelector('#__mf_player__'),
      record: backdrop.querySelector('#__mf_record__'),
      tabrecord: backdrop.querySelector('#__mf_tabrecord__'),
      recordfile: backdrop.querySelector('#__mf_recordfile__'),
      pause: backdrop.querySelector('#__mf_pause__'),
      stop: backdrop.querySelector('#__mf_stop__'),
      quality: backdrop.querySelector('#__mf_quality__'),
      title: backdrop.querySelector('#__mf_title__'),
      owner: backdrop.querySelector('#__mf_owner__'),
      sub: backdrop.querySelector('#__mf_sub__'),
      body: backdrop.querySelector('#__mf_body__'),
      q: backdrop.querySelector('#__mf_q__'),
      filter: backdrop.querySelector('#__mf_filter__'),
      sort: backdrop.querySelector('#__mf_sort__'),
      lang: backdrop.querySelector('#__mf_lang__'),
      compact: backdrop.querySelector('#__mf_compact__'),
      layout: backdrop.querySelector('#__mf_layout__'),
      toastToggle: backdrop.querySelector('#__mf_toasttoggle__'),
      clear: backdrop.querySelector('#__mf_clear__'),
      copyAllBtn: backdrop.querySelector('#__mf_copyall__'),
      exportBtn: backdrop.querySelector('#__mf_export__'),
      customizeBtn: backdrop.querySelector('#__mf_customize__'),
      customizer: backdrop.querySelector('#__mf_customizer__'),
      theme: backdrop.querySelector('#__mf_theme__'),
      motion: backdrop.querySelector('#__mf_motion__'),
      dockSide: backdrop.querySelector('#__mf_dockside__'),
      launcherPosition: backdrop.querySelector('#__mf_launcherposition__'),
      panelWidth: backdrop.querySelector('#__mf_panelwidth__'),
      panelHeight: backdrop.querySelector('#__mf_panelheight__'),
      openListBtn: backdrop.querySelector('#__mf_openlist__'),
      closeBtn: backdrop.querySelector('#__mf_close__'),
      listWrap: backdrop.querySelector('#__mf_list__'),
      previewDock: backdrop.querySelector('#__mf_previewdock__'),
      previewPane: backdrop.querySelector('#__mf_preview__'),
      previewTitle: backdrop.querySelector('#__mf_previewtitle__'),
      previewSubtitle: backdrop.querySelector('#__mf_previewsubtitle__'),
      previewCloseBtn: backdrop.querySelector('#__mf_previewclose__'),
      tip: backdrop.querySelector('#__mf_tip__')
    };

    bindCapture();
    ui.q.addEventListener('input', () => { state.query = ui.q.value || ''; saveStateSoon(); renderList(); });
    ui.filter.addEventListener('change', () => { state.filter = ui.filter.value; saveState(); renderList(); });
    ui.sort.addEventListener('change', () => { state.sort = ui.sort.value; saveState(); renderList(); });
    ui.lang.addEventListener('change', () => { state.lang = ui.lang.value; saveState(); rerenderAllText(); });
    ui.compact.onclick = () => { state.compact = !state.compact; saveState(); renderList(); };
    ui.layout.onclick = () => { state.layout = state.layout === 'list' ? 'grid' : 'list'; saveState(); renderList(); renderHeader(); };
    ui.toastToggle.onclick = () => { state.toast = !state.toast; saveState(); renderToastState(); };
    ui.clear.onclick = () => {
      buildClearBaseline();
      found.clear();
      foundRev++;
      ytSnapshotSig = '';
      state.previewUrl = '';
      state.previewType = '';
      previewState = { url: '', sig: '' };
      clearPreviewSelection();
      renderAll();
    };
    ui.copyAllBtn.onclick = () => copyAll();
    ui.exportBtn.onclick = () => exportTxt();
    ui.customizeBtn.onclick = () => { state.customizerOpen = !state.customizerOpen; saveState(); renderCustomizerState(); };
    ui.theme.onchange = () => { state.theme = ui.theme.value || 'midnight'; saveState(); applyAppearance(); };
    ui.motion.onchange = () => { state.motion = ui.motion.value || 'full'; saveState(); applyAppearance(); };
    ui.dockSide.onchange = () => { state.dockSide = ui.dockSide.value || 'right'; saveState(); applyAppearance(); };
    ui.launcherPosition.onchange = () => { state.launcherPosition = ui.launcherPosition.value || 'bottom-right'; saveState(); applyAppearance(); };
    ui.panelWidth.onchange = () => { state.panelWidth = ui.panelWidth.value || 'normal'; saveState(); applyAppearance(); };
    ui.panelHeight.onchange = () => { state.panelHeight = ui.panelHeight.value || 'normal'; saveState(); applyAppearance(); };
    ui.openListBtn.onclick = () => openList();
    ui.closeBtn.onclick = () => closePanel();
    ui.previewCloseBtn.onclick = () => { clearPreviewSelection(); renderList(); };

    renderToastState();
    applyLauncherVisibility();
    applyAppearance();
    renderCustomizerState();

    if (!hotkeyHooked) {
      hotkeyHooked = true;
      document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.shiftKey && (e.key === 'm' || e.key === 'M')) {
          e.preventDefault();
          uiOpen ? closePanel() : openPanel();
        }
      });
    }

    const mount = () => {
      if (!document.documentElement) return;
      document.documentElement.appendChild(root);
      renderAll();
    };

    if (document.documentElement) mount();
    else document.addEventListener('DOMContentLoaded', mount, { once: true });
  }

  function renderToastState() {
    ensureUI();
    ui.toastWrap.style.display = state.toast ? '' : 'none';
    ui.toastToggle.textContent = `${t('toast')}: ${state.toast ? t('on') : t('off')}`;
  }

  function applyLauncherVisibility() {
    ensureUI();
    if (!ui?.btn) return;
    ui.btn.classList.toggle('mf_btn_hidden', !state.launcherVisible);
  }

  function applyAppearance() {
    ensureUI();
    if (!ui?.root) return;
    ui.root.setAttribute('data-theme', state.theme || 'midnight');
    ui.root.setAttribute('data-motion', state.motion || 'full');
    ui.root.setAttribute('data-dock-side', state.dockSide || 'right');
    ui.root.setAttribute('data-launcher-position', state.launcherPosition || 'bottom-right');
    ui.root.setAttribute('data-panel-width', state.panelWidth || 'normal');
    ui.root.setAttribute('data-panel-height', state.panelHeight || 'normal');
  }

  function renderCustomizerState() {
    ensureUI();
    if (!ui?.customizer) return;
    ui.customizer.classList.toggle('mf_open', !!state.customizerOpen);
    ui.customizeBtn.textContent = state.customizerOpen ? t('customizeHide') : t('customize');
    ui.theme.value = state.theme || 'midnight';
    ui.motion.value = state.motion || 'full';
    ui.dockSide.value = state.dockSide || 'right';
    ui.launcherPosition.value = state.launcherPosition || 'bottom-right';
    ui.panelWidth.value = state.panelWidth || 'normal';
    ui.panelHeight.value = state.panelHeight || 'normal';
  }

  function openPanel() {
    ensureUI();
    uiOpen = true;
    ui.backdrop.style.display = 'flex';
    requestAnimationFrame(() => { try { ui.backdrop.classList.add('mf_visible'); } catch { } });
    ui.btn.classList.add('mf_open');
    renderAll();
  }

  function closePanel() {
    if (!ui) return;
    uiOpen = false;
    ui.btn.classList.remove('mf_open');
    if (ui.previewPane) stopMedia(ui.previewPane);
    const arrow = ui.btn.querySelector('.mf_toggle');
    if (arrow) {
      arrow.textContent = state.launcherVisible ? '>' : '<';
      arrow.title = state.launcherVisible ? t('launcherHide') : t('launcherShow');
    }
    ui.backdrop.classList.remove('mf_visible');
    setTimeout(() => {
      if (!uiOpen && ui?.backdrop) ui.backdrop.style.display = 'none';
    }, 240);
  }

  function rerenderAllText() {
    if (!ui) return;

    ui.toastWrap.querySelector('.open').textContent = t('open');
    ui.toastWrap.querySelector('.copy').textContent = t('copyAll');
    ui.toastWrap.querySelector('.x').textContent = t('close');

    ui.title.textContent = t('title');
    ui.owner.title = t('followGithub');
    ui.openListBtn.textContent = t('openList');
    ui.copyAllBtn.textContent = t('copyAll');
    ui.exportBtn.textContent = t('export');
    ui.customizeBtn.textContent = state.customizerOpen ? t('customizeHide') : t('customize');
    ui.closeBtn.textContent = t('close');
    ui.previewCloseBtn.textContent = t('close');

    ui.q.placeholder = t('search');

    ui.filter.querySelector('option[value="all"]').textContent = t('filterAll');
    ui.filter.querySelector('option[value="image"]').textContent = t('filterImages');
    ui.filter.querySelector('option[value="audio"]').textContent = t('filterAudio');
    ui.filter.querySelector('option[value="video"]').textContent = t('filterVideo');
    ui.filter.querySelector('option[value="playlist"]').textContent = t('filterPlaylists');
    ui.filter.querySelector('option[value="extractor"]').textContent = t('filterExtractors');
    ui.filter.querySelector('option[value="subs"]').textContent = t('filterSubs');
    ui.filter.querySelector('option[value="other"]').textContent = t('filterOther');

    ui.sort.querySelector('option[value="newest"]').textContent = t('newest');
    ui.sort.querySelector('option[value="oldest"]').textContent = t('oldest');
    ui.sort.querySelector('option[value="unique"]').textContent = t('uniqueFirst');

    ui.lang.querySelector('option[value="auto"]').textContent = t('auto');

    ui.compact.textContent = t('compact');
    ui.clear.textContent = t('clear');
    ui.customizer.querySelector('label[for="__mf_theme__"]').textContent = t('theme');
    ui.customizer.querySelector('label[for="__mf_motion__"]').textContent = t('motion');
    ui.customizer.querySelector('label[for="__mf_dockside__"]').textContent = t('dockSide');
    ui.customizer.querySelector('label[for="__mf_launcherposition__"]').textContent = t('launcherPosition');
    ui.customizer.querySelector('label[for="__mf_panelwidth__"]').textContent = t('panelWidth');
    ui.customizer.querySelector('label[for="__mf_panelheight__"]').textContent = t('panelHeight');
    ui.theme.querySelector('option[value="midnight"]').textContent = t('themeMidnight');
    ui.theme.querySelector('option[value="neon"]').textContent = t('themeNeon');
    ui.theme.querySelector('option[value="aurora"]').textContent = t('themeAurora');
    ui.motion.querySelector('option[value="off"]').textContent = t('motionOff');
    ui.motion.querySelector('option[value="calm"]').textContent = t('motionCalm');
    ui.motion.querySelector('option[value="full"]').textContent = t('motionFull');
    ui.dockSide.querySelector('option[value="right"]').textContent = t('dockRight');
    ui.dockSide.querySelector('option[value="left"]').textContent = t('dockLeft');
    ui.launcherPosition.querySelector('option[value="top-left"]').textContent = t('positionTopLeft');
    ui.launcherPosition.querySelector('option[value="top"]').textContent = t('positionTop');
    ui.launcherPosition.querySelector('option[value="top-right"]').textContent = t('positionTopRight');
    ui.launcherPosition.querySelector('option[value="center-left"]').textContent = t('positionCenterLeft');
    ui.launcherPosition.querySelector('option[value="center"]').textContent = t('positionCenter');
    ui.launcherPosition.querySelector('option[value="center-right"]').textContent = t('positionCenterRight');
    ui.launcherPosition.querySelector('option[value="bottom-left"]').textContent = t('positionBottomLeft');
    ui.launcherPosition.querySelector('option[value="bottom"]').textContent = t('positionBottom');
    ui.launcherPosition.querySelector('option[value="bottom-right"]').textContent = t('positionBottomRight');
    ui.panelWidth.querySelector('option[value="narrow"]').textContent = t('widthNarrow');
    ui.panelWidth.querySelector('option[value="normal"]').textContent = t('widthNormal');
    ui.panelWidth.querySelector('option[value="wide"]').textContent = t('widthWide');
    ui.panelWidth.querySelector('option[value="ultra"]').textContent = t('widthUltra');
    ui.panelHeight.querySelector('option[value="compact"]').textContent = t('heightCompact');
    ui.panelHeight.querySelector('option[value="normal"]').textContent = t('heightNormal');
    ui.panelHeight.querySelector('option[value="tall"]').textContent = t('heightTall');
    ui.panelHeight.querySelector('option[value="full"]').textContent = t('heightFull');
    ui.previewTitle.textContent = t('previewPane');
    ui.previewSubtitle.textContent = state.previewUrl ? clip(state.previewUrl, 96) : t('selectPreview');

    applyAppearance();
    renderCustomizerState();
    renderToastState();
    renderAll();
  }

  function formatBytes(n) {
    n = Number(n) || 0;
    if (!n) return '';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return (i === 0 ? String(Math.round(n)) : String(Math.round(n * 10) / 10)) + ' ' + u[i];
  }

  function clip(s, n) {
    s = String(s || '');
    if (s.length <= n) return s;
    return s.slice(0, n - 1) + '…';
  }

  function listItems() {
    const q = String(state.query || '').toLowerCase().trim();

    const items = [];
    for (const [url, meta] of found) {
      const type = guessType(url, meta.mime, meta.kind);
      if (state.filter !== 'all' && type !== state.filter) continue;

      if (q) {
        const hay = (url + ' ' + (meta.mime || '') + ' ' + (meta.note || '') + ' ' + Array.from(meta.from || []).join(' ')).toLowerCase();
        if (!hay.includes(q)) continue;
      }

      items.push({ url, meta, type });
    }

    if (state.sort === 'newest') items.sort((a, b) => (b.meta.ts || 0) - (a.meta.ts || 0));
    else if (state.sort === 'oldest') items.sort((a, b) => (a.meta.ts || 0) - (b.meta.ts || 0));
    else if (state.sort === 'unique') {
      items.sort((a, b) => {
        const af = (a.meta.from && a.meta.from.size) || 0;
        const bf = (b.meta.from && b.meta.from.size) || 0;
        if (bf !== af) return bf - af;
        return (b.meta.ts || 0) - (a.meta.ts || 0);
      });
    }

    return items;
  }

  function renderList() {
    ensureUI();
    const sig = [foundRev, state.filter, state.sort, state.query, state.compact, state.layout, pickLang(), state.previewUrl].join('|');
    if (!ui.listWrap || sig === listSig) return;
    listSig = sig;
    const items = listItems();

    if (ui.tip) ui.tip.textContent = t('tip');
    if (ui.listWrap) ui.listWrap.classList.toggle('mf_grid', state.layout === 'grid');
    if (state.previewUrl && !found.has(state.previewUrl)) clearPreviewSelection();

    ui.body.classList.toggle('mf_compact', !!state.compact);

    if (!items.length) {
      ui.listWrap.innerHTML = `<div class="mf_item"><div class="mf_badge">${t('found')}</div><div class="mf_main">
        <div class="mf_meta">${t('noneYet')}</div>
      </div></div>`;
      pendingItemAnimations.clear();
      renderPreviewPane(true);
      return;
    }

    const html = [];
    items.slice(0, CFG.maxItems).forEach((it, index) => {
      const meta = it.meta || {};
      const badge =
        it.type === 'image' ? t('filterImages') :
          it.type === 'audio' ? t('filterAudio') :
          it.type === 'video' ? t('filterVideo') :
            it.type === 'playlist' ? t('filterPlaylists') :
              it.type === 'extractor' ? t('filterExtractors') :
              it.type === 'subs' ? t('filterSubs') : t('filterOther');

      const mime = meta.mime ? clip(meta.mime, 70) : t('unknown');
      const size = meta.size ? formatBytes(meta.size) : t('unknown');
      const from = meta.from && meta.from.size ? Array.from(meta.from).join(', ') : '';
      const note = meta.note ? meta.note : t('unknown');
      const mse = meta.mse || /^blob:/i.test(it.url) && Array.from(players).some(([el, info]) => info.src === it.url && el.srcObject);
      const canPreview = !mse && (it.type === 'audio' || it.type === 'video' || it.type === 'image') && !isTsSegment(it.url);
      const isExtractor = it.type === 'extractor';
      const isSelected = state.previewUrl === it.url;
      const previewLabel = isSelected ? t('hidePreview') : t('preview');

      html.push(`
        <div class="mf_item${isSelected ? ' mf_item_selected' : ''}${pendingItemAnimations.has(it.url) ? ' mf_item_new' : ''}" style="--mf-item-index:${index}">
          <div class="mf_badge">${badge}</div>
          <div class="mf_main">
            <a class="mf_url" href="${escapeAttr(it.url)}" target="_blank" rel="noreferrer noopener">${escapeHtml(it.url)}</a>
            <div class="mf_meta">
              <span>${escapeHtml(mime)}</span>
              <span> | ${escapeHtml(size)}</span>
              <span> | ${escapeHtml(note)}</span>
              ${from ? `<div style="margin-top:6px;opacity:.75;">${escapeHtml(from)}</div>` : ''}
            </div>
          </div>
          <div class="mf_actions">
            ${canPreview ? `<button data-act="preview" data-type="${escapeAttr(it.type)}" data-url="${escapeAttr(it.url)}">${previewLabel}</button>` : ''}
            <button data-act="open" data-url="${escapeAttr(it.url)}">${isExtractor ? t('openPage') : t('open')}</button>
            ${isExtractor ? `<button data-act="probe" data-url="${escapeAttr(it.url)}">${t('probe')}</button><button data-act="copycmd" data-url="${escapeAttr(it.url)}">${t('copyCommand')}</button>` : `<button data-act="download" data-url="${escapeAttr(it.url)}">${mse ? 'Record player' : t('download')}</button>`}
            <button data-act="copy" data-url="${escapeAttr(it.url)}">${t('copy')}</button>
          </div>
        </div>
      `);
    });

    ui.listWrap.innerHTML = html.join('');
    pendingItemAnimations.clear();

    ui.listWrap.querySelectorAll('button[data-act]').forEach(b => {
      b.onclick = () => {
        const act = b.getAttribute('data-act');
        const url = b.getAttribute('data-url') || '';
        const type = b.getAttribute('data-type') || '';
        if (!url) return;
        if (act === 'open') openUrl(url);
        else if (act === 'copy') copyOne(url);
        else if (act === 'download') { if (found.get(url)?.mse) recordForUrl(url); else downloadUrl(url); }
        else if (act === 'probe') probeBridgeForUrl(url, true);
        else if (act === 'copycmd') copyCommand(url);
        else if (act === 'preview') togglePreview(url, type);
      };
    });

    renderPreviewPane();
  }

  function renderPreviewPane(force) {
    try {
      ensureUI();
      const pane = ui?.previewPane;
      const dock = ui?.previewDock;
      if (!pane || !dock) return;

      const url = state.previewUrl || '';
      if (!url) {
        stopMedia(pane);
        previewState = { url: '', sig: '' };
        pane.innerHTML = `<div class="mf_preview_empty">${escapeHtml(t('selectPreview'))}</div>`;
        dock.classList.remove('mf_open');
        if (ui.previewTitle) ui.previewTitle.textContent = t('previewPane');
        if (ui.previewSubtitle) ui.previewSubtitle.textContent = t('selectPreview');
        return;
      }

      const meta = found.get(url) || {};
      const type = state.previewType || guessType(url, meta.mime, meta.kind);
      const sig = `${url}|${meta.mime || ''}|${meta.size || 0}|${meta.note || ''}|${type}`;
      if (!force && previewState.url === url && previewState.sig === sig) return;

      stopMedia(pane);

      const mime = meta.mime || t('unknown');
      const size = meta.size ? formatBytes(meta.size) : t('unknown');
      const note = meta.note || t('unknown');
      const from = meta.from && meta.from.size ? Array.from(meta.from).join(', ') : '';

      dock.classList.add('mf_open');
      if (ui.previewTitle) ui.previewTitle.textContent = t('previewPane');
      if (ui.previewSubtitle) ui.previewSubtitle.textContent = clip(url, 96);

      pane.innerHTML = `
        <div class="mf_preview_card">
          <div class="mf_preview_header">
            <div class="mf_label">${escapeHtml(t('previewPane'))}</div>
            <div class="mf_preview_meta">
              <div>${escapeHtml(mime)}</div>
              <div>${escapeHtml(size)}</div>
              <div>${escapeHtml(note)}</div>
              ${from ? `<div>${escapeHtml(from)}</div>` : ''}
            </div>
          </div>
          <div class="mf_preview_player"></div>
          <div class="mf_meta" style="opacity:.8;word-break:break-all;">${escapeHtml(url)}</div>
        </div>
      `;

      const slot = pane.querySelector('.mf_preview_player');
      const media = buildPreviewEl(type, url);
      if (slot) {
        if (media) {
          slot.appendChild(media);
          primeMediaForPreview(media, url);
        }
        else slot.innerHTML = `<div class="mf_preview_empty">${escapeHtml(t('previewUnavailable'))}</div>`;
      }

      previewState = { url, sig };
    } catch { }
  }

  function clearPreviewSelection() {
    if (ui?.previewPane) stopMedia(ui.previewPane);
    state.previewUrl = '';
    state.previewType = '';
    previewState = { url: '', sig: '' };
    if (ui?.previewDock) ui.previewDock.classList.remove('mf_open');
    if (ui?.previewPane) ui.previewPane.innerHTML = `<div class="mf_preview_empty">${escapeHtml(t('selectPreview'))}</div>`;
    if (ui?.previewTitle) ui.previewTitle.textContent = t('previewPane');
    if (ui?.previewSubtitle) ui.previewSubtitle.textContent = t('selectPreview');
  }

  function renderHeader() {
    ensureUI();

    const cnt = found.size;
    const pCnt = playerEntries().length;

    const sub = `${t('found')}: ${cnt} ${t('links')} • ${t('players')}: ${pCnt}`;
    ui.title.textContent = t('title');
    ui.sub.textContent = sub;
    if (ui.owner) ui.owner.title = t('followGithub');

    ui.btn.querySelector('.mf_cnt').textContent = `${t('title')} • ${cnt}`;
    if (ui.msgEl) ui.msgEl.textContent = sub;

    ui.filter.value = state.filter;
    ui.sort.value = state.sort;
    ui.lang.value = state.lang;
    ui.q.value = state.query || '';
    ui.theme.value = state.theme || 'midnight';
    ui.motion.value = state.motion || 'full';
    ui.dockSide.value = state.dockSide || 'right';
    ui.panelWidth.value = state.panelWidth || 'normal';
    ui.panelHeight.value = state.panelHeight || 'normal';
    if (ui.layout) {
      ui.layout.textContent = `${t('layout')}: ${state.layout === 'grid' ? t('viewGrid') : t('viewList')}`;
      ui.layout.title = 'Switch between list and grid layouts';
    }
    renderCustomizerState();
    renderToastState();
    applyLauncherVisibility();
    applyAppearance();
    ui.btn.classList.toggle('mf_open', uiOpen);
    const arrow = ui.btn.querySelector('.mf_toggle');
    if (arrow) {
      arrow.textContent = state.launcherVisible ? '>' : '<';
      arrow.title = state.launcherVisible ? t('launcherHide') : t('launcherShow');
    }
    if (!state.previewUrl && ui.previewSubtitle) ui.previewSubtitle.textContent = t('selectPreview');
  }

  function renderAll() {
    renderHeader();
    renderList();
    renderCapture();
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function escapeAttr(s) {
    return escapeHtml(s).replace(/`/g, '&#96;');
  }

  function maybeToast() {
    if (inFrame) return;
    if (!state.toast) return;
    const n = now();
    if (n - lastToast < 250) return;
    lastToast = n;

    ensureUI();
    ui.toastWrap.style.display = state.toast ? '' : 'none';

    if (CFG.toastAutoHideMs > 0) {
      ui.toastWrap.style.opacity = '1';
      setTimeout(() => { try { ui.toastWrap.style.opacity = '0'; } catch { } }, CFG.toastAutoHideMs);
    }
  }

  async function copyOne(url) {
    try {
      await navigator.clipboard.writeText(url);
      if (ui?.msgEl) ui.msgEl.textContent = `${t('copied')} 1 ${t('items')}`;
    } catch {
      if (ui?.msgEl) ui.msgEl.textContent = t('clipboardBlocked');
    }
  }

  async function copyAll() {
    const txt = Array.from(found.keys()).join('\n');
    try {
      await navigator.clipboard.writeText(txt);
      ensureUI();
      if (ui.msgEl) ui.msgEl.textContent = `${t('copied')} ${found.size} ${t('items')}`;
    } catch {
      ensureUI();
      if (ui.msgEl) ui.msgEl.textContent = t('clipboardBlocked');
    }
  }

  function openUrl(url) {
    try {
      if (typeof GM_openInTab === 'function') GM_openInTab(url, { active: true, insert: true, setParent: true });
      else window.open(url, '_blank', 'noopener,noreferrer');
    } catch { }
  }

  function guessFileName(url) {
    try {
      const u = new URL(url);
      const tail = (u.pathname || '').split('/').filter(Boolean).pop() || '';
      const decoded = safeDecode(tail);
      if (decoded) return decoded;
    } catch { }
    const plain = safeDecode((url || '').split('/').pop() || '');
    return plain || 'download';
  }

  function shellQuote(s) {
    return `"${String(s || '').replace(/(["\\`$])/g, '\\$1')}"`;
  }

  function buildYtDlpCommand(url) {
    const args = ['yt-dlp'];
    if (state.ytDlpMode === 'audio') {
      args.push('-f', 'bestaudio/best');
    } else if (state.ytDlpMode === 'extract') {
      args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
    } else {
      args.push('-f', 'bv*+ba/b');
    }

    if (state.ytDlpSubs) args.push('--write-subs', '--sub-langs', 'all');
    if (state.ytDlpThumbs) args.push('--write-thumbnail');

    const custom = String(state.ytDlpCustomArgs || '').trim();
    if (custom) args.push(custom);

    args.push(shellQuote(url));
    return args.join(' ');
  }

  async function copyCommand(url) {
    const cmd = buildYtDlpCommand(url);
    try {
      await navigator.clipboard.writeText(cmd);
      ensureUI();
      if (ui?.msgEl) ui.msgEl.textContent = t('commandCopied');
    } catch {
      ensureUI();
      if (ui?.msgEl) ui.msgEl.textContent = t('clipboardBlocked');
    }
  }

  function setStatus(text) {
    statusText = String(text || '');
    if (inFrame) { relayFrame(); return; }
    ensureUI();
    if (!ui?.status) return;
    ui.status.hidden = !statusText;
    ui.status.querySelector('span').textContent = statusText;
    ui.cancel.hidden = !job;
    ui.save.hidden = !savedBlob;
    renderSavedFiles();
  }

  function abortError() { return new DOMException('Cancelled', 'AbortError'); }

  function checkAbort(signal) { if (signal?.aborted) throw abortError(); }

  function waitRetry(ms, signal) {
    return new Promise((resolve, reject) => {
      checkAbort(signal);
      const cancel = () => { clearTimeout(timer); reject(abortError()); };
      const timer = setTimeout(() => { signal?.removeEventListener('abort', cancel); resolve(); }, ms);
      signal?.addEventListener('abort', cancel, { once: true });
    });
  }

  function requestHeaders(url, base, range, gm) {
    const exact = reqInfo.get(url) || found.get(url) || {};
    const parent = reqInfo.get(base) || found.get(base) || {};
    const same = base && new URL(url).origin === new URL(base).origin;
    const headers = safeHeaders(exact.headers || (same ? parent.headers : {}));
    for (const key of Object.keys(headers)) if (key.toLowerCase() === 'range') delete headers[key];
    if (range) headers.Range = `bytes=${range.start}-${range.end}`;
    if (gm) headers.Referer = exact.referrer || parent.referrer || location.href;
    return headers;
  }

  function rangeData(data, range, status, header) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (!range) return bytes;
    const size = range.end - range.start + 1;
    if (status === 206) {
      const match = String(header || '').match(/^bytes\s+(\d+)-(\d+)\/(?:\d+|\*)$/i);
      if (!match || Number(match[1]) !== range.start || Number(match[2]) !== range.end || bytes.byteLength !== size) throw new Error('The server returned the wrong byte range.');
      return bytes;
    }
    if (status === 200 && bytes.byteLength > range.end) return bytes.slice(range.start, range.end + 1);
    throw new Error('The server did not return the requested byte range.');
  }

  function httpError(status, url) {
    const error = new Error(`HTTP ${status} from ${new URL(url).hostname}${status === 401 || status === 403 ? '. Press play and rescan to refresh the media link.' : ''}`);
    error.status = status;
    return error;
  }

  async function fetchBytes(url, opts) {
    if (!rawFetch) throw new Error('Browser fetch is unavailable.');
    const ctrl = new AbortController();
    const cancel = () => ctrl.abort();
    opts.signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(cancel, 30000);
    try {
      checkAbort(opts.signal);
      const resp = await rawFetch(url, { credentials: 'include', headers: requestHeaders(url, opts.base, opts.range, false), signal: ctrl.signal });
      if (!resp.ok) throw httpError(resp.status, url);
      const limit = opts.limit || CFG.maxMemoryBytes;
      if (Number(resp.headers.get('content-length')) > limit) {
        ctrl.abort();
        throw new Error('This response exceeds the memory limit. Use a native downloader or Record to file.');
      }
      const chunks = [];
      let total = 0;
      if (resp.body?.getReader) {
        const reader = resp.body.getReader();
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            total += part.value.byteLength;
            if (total > limit) { reader.cancel().catch(() => {}); throw new Error('The response exceeds the memory limit.'); }
            chunks.push(part.value);
            opts.progress?.(total, Number(resp.headers.get('content-length')) || 0);
          }
        } finally { reader.releaseLock(); }
      } else {
        const bytes = new Uint8Array(await resp.arrayBuffer());
        total = bytes.byteLength;
        if (total > limit) throw new Error('The response exceeds the memory limit.');
        chunks.push(bytes);
      }
      checkAbort(opts.signal);
      const all = new Uint8Array(total);
      let at = 0;
      for (const bytes of chunks) { all.set(bytes, at); at += bytes.byteLength; }
      return { data: rangeData(all, opts.range, resp.status, resp.headers.get('content-range')), mime: resp.headers.get('content-type') || '', url: resp.url || url };
    } finally { clearTimeout(timer); opts.signal?.removeEventListener('abort', cancel); }
  }

  function gmBytes(url, opts) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== 'function') { reject(new Error('Cross-origin requests are unavailable in this userscript manager.')); return; }
      checkAbort(opts.signal);
      let handle;
      let settled = false;
      const finish = (err, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', cancel);
        err ? reject(err) : resolve(value);
      };
      const cancel = () => { handle?.abort?.(); finish(abortError()); };
      const timer = setTimeout(() => { handle?.abort?.(); finish(new Error('Cross-origin request timed out.')); }, 35000);
      opts.signal?.addEventListener('abort', cancel, { once: true });
      try {
        handle = GM_xmlhttpRequest({
          method: 'GET', url, responseType: 'arraybuffer', timeout: 30000,
          headers: requestHeaders(url, opts.base, opts.range, true),
          onprogress: value => {
            if (value.loaded > (opts.limit || CFG.maxMemoryBytes)) {
              handle?.abort?.();
              finish(new Error('The response exceeds the memory limit.'));
            } else opts.progress?.(value.loaded || 0, value.total || 0);
          },
          onload: resp => {
            try {
              if (resp.status < 200 || resp.status >= 300) throw httpError(resp.status, url);
              if (!resp.response || resp.response.byteLength > (opts.limit || CFG.maxMemoryBytes)) throw new Error('The response is empty or exceeds the memory limit.');
              const headers = String(resp.responseHeaders || '');
              const mime = headers.match(/^content-type:\s*([^\r\n]+)/im)?.[1] || '';
              const range = headers.match(/^content-range:\s*([^\r\n]+)/im)?.[1] || '';
              finish(null, { data: rangeData(resp.response, opts.range, resp.status, range), mime, url: resp.finalUrl || url });
            } catch (error) { finish(error); }
          },
          onerror: () => finish(new Error('Cross-origin request failed. Check the userscript manager’s connection permission.')),
          ontimeout: () => finish(new Error('Cross-origin request timed out.')),
          onabort: () => finish(opts.signal?.aborted ? abortError() : new Error('Request aborted.'))
        });
      } catch (error) { finish(error); }
    });
  }

  async function requestBytes(url, opts = {}) {
    checkAbort(opts.signal);
    let last;
    let target = url;
    for (let attempt = 0; attempt < 3; attempt++) {
      for (const request of [fetchBytes, gmBytes]) {
        try { return await request(target, opts); }
        catch (error) { checkAbort(opts.signal); last = error; }
      }
      if ((last?.status === 401 || last?.status === 403 || last?.status === 404) && opts.base && target === url) {
        const parent = new URL(opts.base);
        const child = new URL(url);
        if (child.origin === parent.origin && parent.search) {
          for (const [key, value] of parent.searchParams) if (!child.searchParams.has(key)) child.searchParams.append(key, value);
          if (child.href !== url) { target = child.href; continue; }
        }
      }
      if (last?.status && last.status < 500 && last.status !== 408 && last.status !== 429) break;
      if (/memory limit|byte range|empty|unavailable/i.test(last?.message || '')) break;
      if (attempt < 2) await waitRetry(500 * (attempt + 1), opts.signal);
    }
    throw last || new Error('The media could not be fetched.');
  }

  function cleanName(name) { return String(name || 'media').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 180) || 'media'; }

  function outputName(url, suffix) {
    const name = cleanName(document.title || guessFileName(url) || 'media').replace(/\.(mp4|webm|m3u8|mpd|ts|aac|m4a)$/i, '');
    return `${name}.${suffix}`;
  }

  function saveBlob(blob, name) {
    savedBlob = { blob, name: cleanName(name) };
    if (!savedFiles.some(item => item.blob === blob)) savedFiles.push(savedBlob);
    if (inFrame) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = savedBlob.name;
    a.style.display = 'none';
    (document.body || document.documentElement).appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 120000);
    setStatus(statusText);
  }

  function attrs(text) {
    const out = {};
    const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi;
    let match;
    while ((match = re.exec(text))) out[match[1].toUpperCase()] = match[2].replace(/^"|"$/g, '');
    return out;
  }

  function byteRange(value, prior, url) {
    if (!value) return null;
    const match = String(value).match(/^(\d+)(?:@(\d+))?$/);
    if (!match || !Number(match[1])) throw new Error('Invalid HLS byte range.');
    const start = match[2] !== undefined ? Number(match[2]) : prior?.url === url ? prior.end + 1 : NaN;
    const end = start + Number(match[1]) - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) throw new Error('The HLS byte range has no valid starting offset.');
    return { start, end, url };
  }

  function parseHls(text, base, inherited = {}) {
    if (!/^\s*#EXTM3U/.test(text)) throw new Error('The response is not an HLS playlist.');
    const out = { variants: [], audio: [], parts: [], ended: false, duration: 0, vars: { ...inherited } };
    let variant = null;
    let key = null;
    let init = null;
    let range = '';
    let prior = null;
    let priorMap = null;
    let seq = 0n;
    let secs = 0;
    let gap = false;
    const resolve = uri => new URL(uri.replace(/\{\$([^}]+)\}/g, (_, name) => {
      if (!(name in out.vars)) throw new Error(`Missing HLS variable: ${name}`);
      return out.vars[name];
    }), base).href;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith('#EXT-X-DEFINE:')) {
        const a = attrs(line.slice(14));
        if (a.NAME && a.VALUE !== undefined) out.vars[a.NAME] = a.VALUE;
        if (a.QUERYPARAM) out.vars[a.QUERYPARAM] = new URL(base).searchParams.get(a.QUERYPARAM) || '';
      } else if (line.startsWith('#EXT-X-STREAM-INF:')) variant = attrs(line.slice(18));
      else if (line.startsWith('#EXT-X-MEDIA:')) {
        const a = attrs(line.slice(13));
        if (a.TYPE === 'AUDIO' && a.URI) out.audio.push({ ...a, url: resolve(a.URI) });
      } else if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
        const value = line.slice(22).trim();
        if (!/^\d+$/.test(value)) throw new Error('Invalid HLS media sequence.');
        seq = BigInt(value);
      } else if (line.startsWith('#EXT-X-KEY:')) {
        const a = attrs(line.slice(11));
        if (a.METHOD === 'NONE') key = null;
        else if (a.METHOD !== 'AES-128' || a.KEYFORMAT && a.KEYFORMAT !== 'identity') throw new Error('This HLS stream uses DRM or sample encryption. Use the site’s download option.');
        else {
          if (!a.URI) throw new Error('The HLS AES-128 key URL is missing.');
          key = { url: resolve(a.URI), iv: a.IV || '', base };
        }
      } else if (line.startsWith('#EXT-X-MAP:')) {
        const a = attrs(line.slice(11));
        if (!a.URI) throw new Error('The HLS initialization URL is missing.');
        const url = resolve(a.URI);
        const bytes = byteRange(a.BYTERANGE, priorMap, url);
        if (bytes) priorMap = bytes;
        if (key && !key.iv) throw new Error('Encrypted HLS initialization requires an explicit IV.');
        init = { url, range: bytes, key: key && { ...key }, seq, base };
      } else if (line.startsWith('#EXT-X-BYTERANGE:')) range = line.slice(17);
      else if (line.startsWith('#EXTINF:')) secs = Number(line.slice(8).split(',')[0]) || 0;
      else if (line === '#EXT-X-GAP') gap = true;
      else if (line === '#EXT-X-ENDLIST') out.ended = true;
      else if (!line.startsWith('#')) {
        const url = resolve(line);
        if (variant) {
          out.variants.push({ ...variant, url, height: Number(variant.RESOLUTION?.split('x')[1]) || 0, rate: Number(variant['AVERAGE-BANDWIDTH'] || variant.BANDWIDTH) || 0 });
          variant = null;
        } else {
          if (gap) throw new Error('The playlist contains missing media segments. Recording may work while the player is playing.');
          const bytes = byteRange(range, prior, url);
          prior = bytes;
          out.parts.push({ url, range: bytes, key: key && { ...key }, init, seq, base });
          out.duration += secs;
          seq++;
          range = '';
          secs = 0;
          gap = false;
          if (out.parts.length > CFG.maxParts) throw new Error('The playlist has too many segments for an in-browser download.');
        }
      }
    }
    return out;
  }

  function pickQuality(list) {
    const sorted = list.slice().sort((a, b) => (b.height || 0) - (a.height || 0) || (b.rate || 0) - (a.rate || 0));
    return sorted.find(item => !quality || !item.height || item.height <= quality) || sorted[sorted.length - 1];
  }

  async function loadManifest(url, signal, base) {
    try {
      const result = await requestBytes(url, { signal, base, limit: 2 * 1024 * 1024 });
      const text = new TextDecoder().decode(result.data);
      if (!/^\s*#EXTM3U|<MPD[\s>]/i.test(text)) throw new Error('The server returned a page instead of a media manifest.');
      cacheManifest(result.url, text);
      return { text, url: result.url };
    } catch (error) {
      checkAbort(signal);
      const old = manifests.get(url);
      if (old && now() - old.time < 60000) return { text: old.text, url };
      throw error;
    }
  }

  async function hlsTracks(text, url, signal, depth = 0, vars = {}) {
    if (depth > 5) throw new Error('The HLS playlist nesting is too deep.');
    const parsed = parseHls(text, url, vars);
    if (!parsed.variants.length) {
      if (!parsed.parts.length) throw new Error('No media segments were found in the playlist.');
      const maps = new Set(parsed.parts.filter(p => p.init).map(p => p.init.url + ':' + (p.init.range?.start || 0)));
      if (maps.size > 1) throw new Error('This stream changes its initialization data. Record the player to keep a single playable file.');
      const isMp4 = maps.size > 0;
      const isAac = /\.aac(?:$|[?#])/i.test(parsed.parts[0].url);
      return [{ parts: parsed.parts, ext: isMp4 ? 'mp4' : isAac ? 'aac' : 'ts', mime: isMp4 ? 'video/mp4' : isAac ? 'audio/aac' : 'video/mp2t', live: !parsed.ended, duration: parsed.duration }];
    }
    const best = pickQuality(parsed.variants);
    const media = await loadManifest(best.url, signal, url);
    const tracks = await hlsTracks(media.text, media.url, signal, depth + 1, parsed.vars);
    const group = best.AUDIO;
    const audio = parsed.audio.filter(item => item['GROUP-ID'] === group);
    const selected = audio.find(item => item.DEFAULT === 'YES') || audio.find(item => item.AUTOSELECT === 'YES') || audio[0];
    if (selected && selected.url !== best.url) {
      const manifest = await loadManifest(selected.url, signal, url);
      const extra = await hlsTracks(manifest.text, manifest.url, signal, depth + 1, parsed.vars);
      for (const track of extra) { track.audio = true; if (track.ext === 'mp4') { track.ext = 'm4a'; track.mime = 'audio/mp4'; } }
      tracks.push(...extra);
    }
    return tracks;
  }

  function ivBytes(value, seq) {
    let hex;
    if (value) {
      hex = String(value).replace(/^0x/i, '');
      if (!/^[\da-f]{1,32}$/i.test(hex)) throw new Error('Invalid HLS AES initialization vector.');
    } else hex = BigInt(seq).toString(16);
    if (hex.length > 32) throw new Error('The HLS media sequence exceeds 128 bits.');
    hex = hex.padStart(32, '0');
    return Uint8Array.from(hex.match(/../g), byte => parseInt(byte, 16));
  }

  async function decryptPart(bytes, part, keys, signal) {
    if (!part.key) return bytes;
    if (!crypto.subtle) throw new Error('AES-128 downloads need Web Crypto on an HTTPS page.');
    const url = part.key.url;
    if (!keys.has(url)) keys.set(url, (async () => {
      const result = await requestBytes(url, { base: part.key.base, signal, limit: 1024 });
      if (result.data.byteLength !== 16) throw new Error('The stream did not provide a valid 16-byte AES-128 key.');
      return crypto.subtle.importKey('raw', result.data, { name: 'AES-CBC' }, false, ['decrypt']);
    })());
    const key = await keys.get(url);
    try { return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv: ivBytes(part.key.iv, part.seq) }, key, bytes)); }
    catch { throw new Error('AES-128 decryption failed. The key or media link may have expired.'); }
  }

  function xmlChildren(el, name) { return Array.from(el?.children || []).filter(child => child.localName === name); }
  function xmlChild(el, name) { return xmlChildren(el, name)[0] || null; }

  function durationSecs(value) {
    const match = String(value || '').match(/^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/);
    return match ? Number(match[1] || 0) * 86400 + Number(match[2] || 0) * 3600 + Number(match[3] || 0) * 60 + Number(match[4] || 0) : 0;
  }

  function dashUrl(template, rep, number, time) {
    const mark = '\u0001';
    return String(template || '').replace(/\$\$/g, mark).replace(/\$(RepresentationID|Bandwidth|Number|Time)(?:%0(\d+)d)?\$/g, (_, key, width) => {
      const value = key === 'RepresentationID' ? rep.getAttribute('id') || '' : key === 'Bandwidth' ? rep.getAttribute('bandwidth') || '0' : key === 'Number' ? number : time;
      return width ? String(value).padStart(Math.min(Number(width), 20), '0') : String(value);
    }).replaceAll(mark, '$');
  }

  function parseDash(text, url) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const mpd = doc.documentElement;
    if (mpd.localName !== 'MPD' || doc.querySelector('parsererror')) throw new Error('Invalid DASH manifest.');
    if (mpd.getAttribute('type') === 'dynamic') throw new Error('Live DASH needs player recording. Use Record player while the video plays.');
    if (Array.from(doc.getElementsByTagNameNS('*', 'ContentProtection')).length) throw new Error('This DASH stream is DRM protected. Use the site’s download option.');
    const periods = xmlChildren(mpd, 'Period');
    if (periods.length !== 1) throw new Error('This DASH stream has multiple periods. Record the player for a single continuous file.');
    const period = periods[0];
    const duration = durationSecs(period.getAttribute('duration')) || durationSecs(mpd.getAttribute('mediaPresentationDuration')) - durationSecs(period.getAttribute('start'));
    const candidates = [];
    for (const group of xmlChildren(period, 'AdaptationSet')) {
      for (const rep of xmlChildren(group, 'Representation')) {
        const chain = [mpd, period, group, rep];
        let base = url;
        let temp = {};
        let timeline = null;
        let segList = null;
        let hasBase = false;
        for (const node of chain) {
          const value = xmlChild(node, 'BaseURL')?.textContent?.trim();
          if (value) { base = new URL(value, base).href; hasBase = true; }
          const tpl = xmlChild(node, 'SegmentTemplate');
          if (tpl) {
            for (const attr of tpl.attributes) temp[attr.name] = attr.value;
            timeline = xmlChild(tpl, 'SegmentTimeline') || timeline;
          }
          segList = xmlChild(node, 'SegmentList') || segList;
        }
        const mime = rep.getAttribute('mimeType') || group.getAttribute('mimeType') || '';
        const type = rep.getAttribute('contentType') || group.getAttribute('contentType') || mime.split('/')[0] || (rep.hasAttribute('height') ? 'video' : '');
        if (type !== 'video' && type !== 'audio') continue;
        const parts = [];
        const resolve = value => new URL(value, base).href;
        const range = value => {
          if (!value) return null;
          const match = value.match(/^(\d+)-(\d+)$/);
          if (!match || Number(match[2]) < Number(match[1])) throw new Error('Invalid DASH byte range.');
          return { start: Number(match[1]), end: Number(match[2]) };
        };
        if (segList) {
          const init = xmlChild(segList, 'Initialization');
          if (init) parts.push({ url: resolve(init.getAttribute('sourceURL') || ''), range: range(init.getAttribute('range')), base: url });
          for (const segment of xmlChildren(segList, 'SegmentURL')) parts.push({ url: resolve(segment.getAttribute('media') || ''), range: range(segment.getAttribute('mediaRange')), base: url });
        } else if (temp.media) {
          if (temp.initialization) parts.push({ url: resolve(dashUrl(temp.initialization, rep, 0, 0)), base: url });
          const scale = Number(temp.timescale || 1);
          let number = Number(temp.startNumber || 1);
          const pto = Number(temp.presentationTimeOffset || 0);
          if (!(scale > 0) || !Number.isSafeInteger(number)) throw new Error('Invalid DASH template timing.');
          const append = time => {
            parts.push({ url: resolve(dashUrl(temp.media, rep, number++, time)), base: url });
            if (parts.length > CFG.maxParts) throw new Error('The DASH stream has too many segments for an in-browser download.');
          };
          if (timeline) {
            const entries = xmlChildren(timeline, 'S');
            let time = 0;
            for (let i = 0; i < entries.length; i++) {
              const item = entries[i];
              if (item.hasAttribute('t')) time = Number(item.getAttribute('t'));
              const d = Number(item.getAttribute('d'));
              let count = Number(item.getAttribute('r') || 0) + 1;
              if (!(d > 0) || !Number.isFinite(time) || !Number.isInteger(count)) throw new Error('Invalid DASH segment timeline.');
              if (count === 0) {
                const end = entries[i + 1]?.hasAttribute('t') ? Number(entries[i + 1].getAttribute('t')) : duration * scale + pto;
                if (!(end > time)) throw new Error('The DASH timeline has no bounded end.');
                count = Math.ceil((end - time) / d);
              }
              if (count < 1 || count > CFG.maxParts) throw new Error('The DASH timeline is too large.');
              for (let j = 0; j < count; j++) { append(time); time += d; }
            }
          } else {
            const d = Number(temp.duration);
            if (!(duration > 0) || !(d > 0)) throw new Error('The DASH stream has no bounded segment duration.');
            const count = Math.ceil(duration * scale / d);
            if (count > CFG.maxParts) throw new Error('The DASH stream is too large.');
            for (let i = 0; i < count; i++) append(pto + i * d);
          }
        } else if (hasBase && new URL(base).pathname !== new URL(url).pathname) parts.push({ url: base, base: url });
        else throw new Error('This DASH segment layout is unsupported. Record the player instead.');
        if (!parts.length) throw new Error('The DASH representation has no media segments.');
        candidates.push({ parts, height: Number(rep.getAttribute('height')) || 0, rate: Number(rep.getAttribute('bandwidth')) || 0, audio: type === 'audio', mime: mime || `${type}/mp4`, ext: /webm/i.test(mime) ? 'webm' : type === 'audio' ? 'm4a' : 'mp4' });
      }
    }
    const tracks = [];
    for (const audio of [false, true]) {
      const list = candidates.filter(item => item.audio === audio);
      if (list.length) tracks.push(pickQuality(list));
    }
    if (!tracks.length) throw new Error('No clear DASH audio or video tracks were found.');
    return tracks;
  }

  async function downloadTracks(tracks, url, task) {
    const signal = task.ctrl.signal;
    const keys = new Map();
    let total = 0;
    const blobs = [];
    for (let index = 0; index < tracks.length; index++) {
      const track = tracks[index];
      const parts = [];
      let initSig = '';
      for (const part of track.parts) {
        if (part.init) {
          const sig = part.init.url + ':' + JSON.stringify(part.init.range);
          if (sig !== initSig) { parts.push(part.init); initSig = sig; }
        }
        parts.push(part);
      }
      const chunks = [];
      const concurrency = matchMedia('(pointer: coarse)').matches ? 2 : 3;
      for (let at = 0; at < parts.length; at += concurrency) {
        checkAbort(signal);
        const batch = await Promise.allSettled(parts.slice(at, at + concurrency).map(async part => {
          const result = await requestBytes(part.url, { signal, base: part.base, range: part.range, limit: Math.min(128 * 1024 * 1024, CFG.maxMemoryBytes - total) });
          if (/text\/html|application\/json/i.test(result.mime)) throw new Error('A media segment returned an error page. Refresh the player and try again.');
          return decryptPart(result.data, part, keys, signal);
        }));
        const failure = batch.find(item => item.status === 'rejected');
        if (failure) throw failure.reason;
        for (const item of batch) {
          total += item.value.byteLength;
          if (total > CFG.maxMemoryBytes) throw new Error('This download exceeds the browser memory limit. Use Record to file or a native downloader.');
          chunks.push(item.value);
        }
        setStatus(`Downloading ${track.audio ? 'audio' : 'video'} ${index + 1}/${tracks.length}: ${Math.min(at + concurrency, parts.length)}/${parts.length} segments · ${formatBytes(total)}${track.live ? ' · current live window only' : ''}`);
      }
      checkAbort(signal);
      const blob = new Blob(chunks, { type: track.mime });
      const suffix = tracks.length > 1 ? `${track.audio ? 'audio' : 'video'}.${track.ext}` : track.ext;
      blobs.push({ blob, name: outputName(url, suffix) });
    }
    checkAbort(signal);
    for (const item of blobs) saveBlob(item.blob, item.name);
    setStatus(`${tracks.length > 1 ? 'Video and audio downloaded as separate files. Use recording for one file.' : 'Download ready.'}${tracks.some(track => track.live) ? ' Only the available live window was saved.' : ''} If your mobile browser did not save it, tap Save again.`);
  }

  function nativeDownload(url, task) {
    return new Promise((resolve, reject) => {
      if (typeof GM_download !== 'function') { reject(new Error('Native download is unavailable.')); return; }
      let handle;
      let done = false;
      const signal = task.ctrl.signal;
      const finish = error => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
        error ? reject(error) : resolve();
      };
      const cancel = () => { handle?.abort?.(); finish(abortError()); };
      let timer;
      const reset = () => { clearTimeout(timer); timer = setTimeout(() => { handle?.abort?.(); finish(new Error('Native download stalled.')); }, 45000); };
      signal.addEventListener('abort', cancel, { once: true });
      reset();
      try {
        handle = GM_download({
          url, name: cleanName(guessFileName(url)), saveAs: true, headers: requestHeaders(url, url, null, true),
          onload: () => finish(), onerror: value => finish(new Error(value?.error || 'Native download failed.')),
          ontimeout: () => finish(new Error('Native download timed out.')),
          onprogress: value => { reset(); setStatus(`Downloading · ${formatBytes(value.loaded || 0)}${value.total ? ' / ' + formatBytes(value.total) : ''}`); }
        });
      } catch (error) { finish(error); }
    });
  }

  async function downloadUrl(url) {
    if (rec) { setStatus('Stop and save the recording before starting a download.'); return; }
    if (job) { setStatus('A download is already running. Cancel it before starting another.'); return; }
    const meta = found.get(url) || {};
    if (meta.mse) { recordForUrl(url); return; }
    const task = { ctrl: new AbortController() };
    job = task;
    savedBlob = null;
    savedFiles = [];
    setStatus('Fetching media…');
    try {
      const type = guessType(url, meta.mime, meta.kind);
      if (type === 'playlist') {
        const manifest = await loadManifest(url, task.ctrl.signal);
        const tracks = /^\s*#EXTM3U/.test(manifest.text) ? await hlsTracks(manifest.text, manifest.url, task.ctrl.signal) : parseDash(manifest.text, manifest.url);
        await downloadTracks(tracks, url, task);
      } else {
        let native = false;
        if (/^https?:/i.test(url)) {
          try { await nativeDownload(url, task); native = true; setStatus('Download finished.'); }
          catch { checkAbort(task.ctrl.signal); setStatus('Trying a cross-origin media fetch…'); }
        }
        if (!native) {
          const result = await requestBytes(url, { signal: task.ctrl.signal, progress: loaded => setStatus(`Fetching media · ${formatBytes(loaded)}`) });
          if (/text\/html/i.test(result.mime)) throw new Error('The link returned a web page. Press play, rescan, or record the detected player.');
          const isText = /mpegurl|dash\+xml/i.test(result.mime) || result.data.length < 2 * 1024 * 1024 && /^\s*#EXTM3U|<MPD[\s>]/i.test(new TextDecoder().decode(result.data.subarray(0, 200)));
          if (isText) {
            const text = new TextDecoder().decode(result.data);
            const tracks = /^\s*#EXTM3U/.test(text) ? await hlsTracks(text, result.url, task.ctrl.signal) : parseDash(text, result.url);
            await downloadTracks(tracks, url, task);
          } else {
            const suffix = /video\/mp4/i.test(result.mime) ? 'mp4' : /video\/webm/i.test(result.mime) ? 'webm' : /audio\/mp4/i.test(result.mime) ? 'm4a' : '';
            saveBlob(new Blob([result.data], { type: result.mime || 'application/octet-stream' }), suffix ? outputName(url, suffix) : guessFileName(url));
            setStatus('Download ready. If your mobile browser did not save it, tap Save again.');
          }
        }
      }
    } catch (error) {
      setStatus(error.name === 'AbortError' ? 'Download cancelled.' : `Download failed: ${error.message} Select a player under Players & recording to try recording.`);
    } finally { task.ctrl.abort(); if (job === task) job = null; setStatus(statusText); renderCapture(); }
  }

  function playerEntries() {
    const list = Array.from(players).filter(([el]) => el.isConnected).map(([el, info]) => ({ id: info.id, el, info }));
    for (const [source, frame] of frameInfo) {
      if (!isFrameSource(source) || now() - frame.last > 60000) { frameInfo.delete(source); continue; }
      for (const info of frame.players) list.push({ id: frame.id + ':' + info.id, info, frame });
    }
    return list;
  }

  function recordForUrl(url) {
    const entry = playerEntries().find(item => item.info.src === url);
    if (entry) { if (ui?.player) ui.player.value = entry.id; startRecord('player', false, entry.el, entry); }
    else { if (ui?.capture) ui.capture.open = true; setStatus('Select the player under Players & recording, press play, then tap Record player.'); }
  }

  function recordMime(stream) {
    const video = stream.getVideoTracks().length > 0;
    const choices = video ? ['video/mp4', 'video/webm;codecs=vp8,opus', 'video/webm'] : ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'];
    return choices.find(value => MediaRecorder.isTypeSupported(value)) || '';
  }

  async function waitTracks(stream, el, signal) {
    checkAbort(signal);
    const ready = () => stream.getTracks().some(track => track.readyState === 'live') && (el?.tagName !== 'VIDEO' || stream.getVideoTracks().length > 0);
    if (ready()) return;
    await new Promise((resolve, reject) => {
      const check = () => { if (ready()) { clean(); resolve(); } };
      const clean = () => { clearTimeout(timer); stream.removeEventListener('addtrack', check); signal?.removeEventListener('abort', cancel); };
      const cancel = () => { clean(); reject(abortError()); };
      const timer = setTimeout(() => { clean(); reject(new Error('The player has no capturable media tracks. Press play first, or use Record tab / screen.')); }, 5000);
      stream.addEventListener('addtrack', check);
      signal?.addEventListener('abort', cancel, { once: true });
    });
  }

  function recordingFallbackHint() {
    return typeof navigator.mediaDevices?.getDisplayMedia === 'function' ? 'Try Record tab / screen and share the tab’s audio, or Download a detected media link.' : 'Use Download on a detected media or playlist. This browser does not offer tab / screen recording.';
  }

  function recordingSource(el) {
    const url = norm(getMediaSrc(el));
    if (!url || !/^https?:/i.test(url) || found.get(url)?.mse) throw new Error('The player has no directly fetchable media file.');
    const meta = found.get(url) || {};
    if (guessType(url, meta.mime, meta.kind) === 'playlist') throw new Error('The player uses a stream playlist. Download its HLS / DASH link instead.');
    return url;
  }

  function waitRecordMedia(el, signal) {
    return new Promise((resolve, reject) => {
      checkAbort(signal);
      const events = ['loadedmetadata', 'loadeddata', 'canplay', 'seeked', 'error'];
      const clean = () => {
        clearTimeout(timer);
        for (const type of events) el.removeEventListener(type, check);
        signal.removeEventListener('abort', cancel);
      };
      const finish = error => { clean(); error ? reject(error) : resolve(); };
      const cancel = () => finish(abortError());
      const check = () => {
        if (el.error) finish(new Error('The fetched media cannot be played in this browser.'));
        else if (el.readyState >= 2 && !el.seeking && (el.tagName !== 'VIDEO' || el.videoWidth > 0)) finish();
      };
      const timer = setTimeout(() => finish(new Error('The fetched media did not become ready for recording.')), 15000);
      for (const type of events) el.addEventListener(type, check);
      signal.addEventListener('abort', cancel, { once: true });
      check();
    });
  }

  async function localRecordingStream(el, current) {
    const url = recordingSource(el);
    const position = Math.max(0, Number(el.currentTime) || 0);
    const rate = Number(el.playbackRate) || 1;
    const signal = current.ctrl.signal;
    current.setupStatus = 'Player capture blocked. Fetching an accessible recording source…';
    renderRecordStatus(current);
    const result = await requestBytes(url, {
      signal, base: url, limit: Math.floor(CFG.maxMemoryBytes / 2),
      progress: (loaded, total) => {
        if (rec !== current) return;
        current.setupStatus = `Fetching recording source · ${formatBytes(loaded)}${total ? ' / ' + formatBytes(total) : ''}`;
        renderRecordStatus(current);
      }
    });
    checkAbort(signal);
    if (el.mediaKeys || players.get(el)?.protected) throw new Error('The player is DRM protected.');
    const head = new TextDecoder().decode(result.data.subarray(0, 256));
    if (/mpegurl|dash\+xml/i.test(result.mime) || /^\s*#EXTM3U|<MPD[\s>]/i.test(head)) {
      add(url, { from: 'recording:manifest', hintType: 'playlist', mime: result.mime });
      throw new Error('The media link returned a stream playlist. Download its HLS / DASH link instead.');
    }
    if (!result.data.length || /text\/|json|xml/i.test(result.mime) || /^\s*(?:<!doctype|<html|[\[{])/i.test(head)) throw new Error('The media link returned an empty file or a web page.');
    const blob = new Blob([result.data], { type: /^(video|audio)\//i.test(result.mime) ? result.mime : '' });
    recordingBlobs.add(blob);
    current.memoryLimit = CFG.maxMemoryBytes - blob.size;
    const local = document.createElement(el.tagName.toLowerCase());
    recordingPlayers.add(local);
    current.localEl = local;
    current.localURL = URL.createObjectURL(blob);
    local.muted = true;
    local.playsInline = true;
    local.preload = 'auto';
    local.style.display = 'none';
    local.setAttribute('aria-hidden', 'true');
    local.src = current.localURL;
    (document.body || document.documentElement).appendChild(local);
    current.setupStatus = 'Preparing the fetched media for recording…';
    renderRecordStatus(current);
    await waitRecordMedia(local, signal);
    if (position > 0) {
      local.currentTime = Number.isFinite(local.duration) ? Math.min(position, Math.max(0, local.duration - 0.1)) : position;
      await waitRecordMedia(local, signal);
    }
    if (rate > 0) local.playbackRate = rate;
    checkAbort(signal);
    const capture = local.captureStream || local.mozCaptureStream;
    if (typeof capture !== 'function') throw new Error('This browser cannot capture a locally fetched player.');
    const stream = capture.call(local);
    current.stream = stream;
    await local.play();
    checkAbort(signal);
    return stream;
  }

  function cleanRecordSource(current) {
    current.ctrl?.abort();
    clearInterval(current.timer);
    (current.localEl || current.el)?.removeEventListener('ended', current.stop);
    for (const track of current.stream?.getTracks?.() || []) { track.removeEventListener('ended', current.stop); track.stop(); }
    if (current.localEl) {
      current.localEl.pause();
      current.localEl.removeAttribute('src');
      current.localEl.load();
      current.localEl.remove();
      current.localEl = null;
    }
    if (current.localURL) { URL.revokeObjectURL(current.localURL); current.localURL = null; }
  }

  async function startRecord(mode, toFile = false, forcedEl, forcedEntry) {
    if (rec) { setStatus('A recording is already running. Use Stop & save first.'); return; }
    if (job) { setStatus('Finish or cancel the download before recording.'); return; }
    if (typeof MediaRecorder !== 'function') { setStatus('This browser does not support MediaRecorder. Try a browser with recording support.'); return; }
    const entry = forcedEntry || (!inFrame ? playerEntries().find(item => item.id === ui?.player?.value) : null);
    const el = forcedEl || entry?.el;
    if (mode === 'player' && entry?.frame) {
      if (entry.info.protected) { setStatus('The embedded player is DRM protected. Use the site’s download option.'); return; }
      const frame = entry.frame;
      rec = { remote: frame.source, origin: frame.origin, time: now(), pending: true, paused: false };
      savedBlob = null;
      savedFiles = [];
      const current = rec;
      current.timer = setTimeout(() => {
        if (rec === current && !current.started) { sendFrame(current.remote, current.origin, 'stop'); rec = null; setStatus('The embedded player did not start recording. Press play inside it and try again.'); renderCapture(); }
      }, 15000);
      sendFrame(frame.source, frame.origin, 'record', { id: entry.info.id });
      setStatus('Starting embedded player recording…');
      renderCapture();
      return;
    }
    if (mode === 'player' && !el) { if (ui?.capture) ui.capture.open = true; setStatus('No player selected. Press play on the page and select its player.'); return; }
    if (el && (el.mediaKeys || players.get(el)?.protected)) { setStatus('The player is DRM protected. Use the site’s download option.'); return; }
    let stream;
    let writer;
    let handle;
    const current = { time: now(), ctrl: new AbortController(), chunks: [], size: 0, el: mode === 'player' ? el : null, paused: false, pending: true, setupStatus: 'Starting recording…', writes: Promise.resolve(), finishing: false, reason: '' };
    rec = current;
    savedBlob = null;
    savedFiles = [];
    renderRecordStatus(current);
    renderCapture();
    try {
      if (mode === 'tab') {
        if (typeof navigator.mediaDevices?.getDisplayMedia !== 'function') throw new Error('Tab / screen recording is unavailable in this browser. On mobile, try Record player.');
        stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
      } else {
        if (el.readyState < 2 || el.tagName === 'VIDEO' && !el.videoWidth) throw new Error('Press play on the video first, then tap Record player.');
        if (toFile) {
          if (typeof page.showSaveFilePicker !== 'function') throw new Error('Direct file recording is unavailable in this browser.');
          const mime = recordMime({ getVideoTracks: () => el.tagName === 'VIDEO' ? [true] : [] });
          const ext = /mp4/i.test(mime) ? el.tagName === 'AUDIO' ? 'm4a' : 'mp4' : /ogg/i.test(mime) ? 'ogg' : 'webm';
          handle = await page.showSaveFilePicker({ suggestedName: outputName(location.href, ext) });
          checkAbort(current.ctrl.signal);
        }
        const capture = el.captureStream || el.mozCaptureStream;
        if (el.srcObject?.getTracks) stream = new MediaStream(el.srcObject.getTracks().map(track => track.clone()));
        else if (typeof capture === 'function') {
          try { stream = capture.call(el); }
          catch (error) {
            if (error.name !== 'SecurityError' && !/cross.origin|insecure|not allowed/i.test(error.message)) throw error;
            current.captureBlocked = true;
            stream = await localRecordingStream(el, current);
          }
        }
        else throw new Error('This browser cannot capture this player directly. ' + recordingFallbackHint());
        current.stream = stream;
        if (!current.localEl && el.paused) await el.play();
      }
      current.stream = stream;
      if (rec !== current || current.cancelled) throw abortError();
      await waitTracks(stream, mode === 'player' ? current.localEl || el : null, current.ctrl.signal);
      if (rec !== current || current.cancelled) throw abortError();
      if (handle) { writer = await handle.createWritable(); current.writer = writer; }
      checkAbort(current.ctrl.signal);
      const mime = recordMime(stream);
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      current.recorder = recorder;
      current.ext = /mp4/i.test(recorder.mimeType) ? stream.getVideoTracks().length ? 'mp4' : 'm4a' : /ogg/i.test(recorder.mimeType) ? 'ogg' : 'webm';
      current.mime = recorder.mimeType || mime || 'video/webm';
      current.pending = false;
      current.time = now();
      current.name = outputName(location.href, 'recording.' + current.ext);
      current.stop = () => stopRecord();
      (current.localEl || current.el)?.addEventListener('ended', current.stop, { once: true });
      for (const track of stream.getTracks()) track.addEventListener('ended', current.stop, { once: true });
      recorder.ondataavailable = event => {
        if (!event.data?.size) return;
        current.size += event.data.size;
        if (writer) {
          current.writes = current.writes.then(() => writer.write(event.data)).catch(error => {
            current.writeError = error;
            current.reason = 'The output file could not be written: ' + error.message;
            stopRecord(current.reason);
          });
        } else {
          current.chunks.push(event.data);
          if (current.size > (current.memoryLimit || CFG.maxMemoryBytes) - 8 * 1024 * 1024) stopRecord('The recording reached the memory limit. The recorded part was saved. Use Record to file for longer videos.');
        }
      };
      recorder.onerror = event => stopRecord('The recorder failed: ' + (event.error?.message || 'unknown error'));
      recorder.onstop = () => finishRecord(current);
      recorder.start(1000);
      current.timer = setInterval(() => {
        if (current.el && !current.el.isConnected) stopRecord('The player was removed. The recorded part was saved.');
        else if (current.el?.mediaKeys || players.get(current.el)?.protected) stopRecord('DRM was detected. Recording stopped.');
        else renderRecordStatus(current);
      }, 1000);
      if (ui?.capture) ui.capture.open = true;
      renderRecordStatus(current);
      renderCapture();
    } catch (error) {
      current.stream ||= stream;
      cleanRecordSource(current);
      if (writer) await writer.abort().catch(() => {});
      if (rec === current) rec = null;
      const text = error.name === 'AbortError' ? 'Recording cancelled.' : current.captureBlocked ? `Player capture is blocked by cross-origin security. The local-source retry failed: ${error.message} ${recordingFallbackHint()}` : `Recording could not start: ${error.message}`;
      if (!rec && !current.reported) {
        setStatus(text);
        if (inFrame) window.top.postMessage({ channel: CHANNEL, type: 'record-result', status: text }, '*');
      }
      renderCapture();
    }
  }

  function renderRecordStatus(current) {
    const secs = Math.floor((now() - current.time) / 1000);
    const label = current.pending ? current.setupStatus || 'Starting recording…' : current.remote && current.remoteStatus ? current.remoteStatus : `${current.paused ? 'Recording paused' : current.localEl ? 'Recording fetched copy' : 'Recording'} · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')} · ${formatBytes(current.size || 0)}${current.stream && !current.stream.getAudioTracks().length ? ' · no audio track' : ''}${current.writer ? ' · saving to file' : ''}`;
    setStatus(label);
    if (ui?.recbar) { ui.recbar.hidden = false; ui.recbar.querySelector('span').textContent = label; }
  }

  function stopRecord(reason = '') {
    const current = rec;
    if (!current) return;
    if (current.remote) { sendFrame(current.remote, current.origin, 'stop'); setStatus(current.pending ? 'Cancelling embedded recording setup…' : 'Saving embedded player recording…'); return; }
    if (reason) current.reason = reason;
    if (current.pending) {
      current.cancelled = true;
      cleanRecordSource(current);
      rec = null;
      current.reported = true;
      const text = current.reason || 'Recording cancelled.';
      setStatus(text);
      if (inFrame) window.top.postMessage({ channel: CHANNEL, type: 'record-result', status: text }, '*');
      renderCapture();
      return;
    }
    if (current.recorder?.state !== 'inactive') current.recorder.stop();
  }

  function pauseRecord() {
    if (!rec || rec.pending) return;
    if (rec.remote) { sendFrame(rec.remote, rec.origin, 'pause'); rec.paused = !rec.paused; }
    else if (rec.recorder.state === 'recording') { rec.recorder.pause(); rec.localEl?.pause(); rec.paused = true; }
    else if (rec.recorder.state === 'paused') {
      const current = rec;
      current.recorder.resume();
      current.paused = false;
      current.localEl?.play().catch(error => { if (rec === current) stopRecord('The fetched media could not resume: ' + error.message); });
    }
    if (!rec.remote) renderRecordStatus(rec);
    renderCapture();
  }

  async function finishRecord(current) {
    if (current.finishing) return;
    current.finishing = true;
    cleanRecordSource(current);
    let blob = null;
    let text;
    try {
      await current.writes;
      if (current.writeError) throw current.writeError;
      if (current.writer) { await current.writer.close(); text = current.reason || 'Recording saved to the selected file.'; }
      else {
        blob = new Blob(current.chunks, { type: current.mime });
        text = blob.size ? current.reason || 'Recording ready. If your mobile browser did not save it, tap Save again.' : current.reason || 'The player produced no recording data. Try Record tab / screen.';
      }
    } catch (error) { await current.writer?.abort().catch(() => {}); text = 'The recording file could not be saved: ' + error.message; }
    current.chunks.length = 0;
    if (rec === current) rec = null;
    if (inFrame) window.top.postMessage({ channel: CHANNEL, type: 'record-result', blob, name: current.name, status: text }, '*');
    else if (blob?.size) saveBlob(blob, current.name);
    setStatus(text);
    renderCapture();
  }

  function focusPreviewPane() {
    try {
      ensureUI();
      const dock = ui?.previewDock;
      if (!dock || !state.previewUrl) return;
      dock.classList.add('mf_peek');
      setTimeout(() => { try { dock.classList.remove('mf_peek'); } catch { } }, 800);
      dock.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    } catch { }
  }

  function togglePreview(url, type) {
    try {
      const same = state.previewUrl === url;
      if (same) {
        clearPreviewSelection();
      } else {
        state.previewUrl = url;
        state.previewType = type || guessType(url, found.get(url)?.mime, found.get(url)?.kind);
      }
      renderList();
      if (!same) focusPreviewPane();
    } catch { }
  }

  function buildPreviewEl(type, url) {
    const lower = String(type || '').toLowerCase();
    try {
      if (lower === 'image') {
        const img = document.createElement('img');
        img.alt = 'preview';
        img.loading = 'eager';
        img.decoding = 'async';
        img.referrerPolicy = 'origin-when-cross-origin';
        return img;
      }
      if (lower === 'audio') {
        const a = document.createElement('audio');
        a.controls = true;
        a.preload = 'metadata';
        return a;
      }
      if (lower === 'video') {
        const v = document.createElement('video');
        v.controls = true;
        v.preload = 'metadata';
        v.muted = true;
        v.playsInline = true;
        return v;
      }
    } catch { }
    return null;
  }

  function primeMediaForPreview(el, url) {
    if (!el || !url) return;
    const tag = String(el.tagName || '').toLowerCase();
    const cleanup = () => {
      try {
        if (el.__mf_blob) URL.revokeObjectURL(el.__mf_blob);
      } catch {}
      try { el.__mf_blob = null; } catch {}
      try { el.__mf_abort?.abort(); } catch {}
      try { el.__mf_abort = null; } catch {}
    };
    cleanup();

    if (tag === 'img') {
      try { el.src = url; } catch {}
      el.__mf_cleanup = cleanup;
      return;
    }

    try {
      const controller = new AbortController();
      el.__mf_abort = controller;
      fetch(url, { credentials: 'include', mode: 'cors', signal: controller.signal }).then(async (resp) => {
        if (!resp.ok) throw new Error('fetch_failed');
        const blob = await resp.blob();
        const obj = URL.createObjectURL(blob);
        el.__mf_blob = obj;
        el.src = obj;
        el.load?.();
      }).catch(() => {
        el.src = url;
        el.load?.();
      });
    } catch {
      try { el.src = url; el.load?.(); } catch {}
    }

    el.crossOrigin = 'use-credentials';
    el.referrerPolicy = 'origin-when-cross-origin';
    el.__mf_cleanup = cleanup;
  }

  function stopMedia(root) {
    try {
      root.querySelectorAll('audio,video,img').forEach(m => {
        try { m.pause(); } catch { }
        try { m.__mf_cleanup?.(); } catch {}
      });
    } catch { }
  }

  function buildListHtml() {
    const items = listItems();
    const rows = items.map(it => {
      const meta = it.meta || {};
      const type = guessType(it.url, meta.mime, meta.kind);
      const badge =
        type === 'image' ? t('filterImages') :
          type === 'audio' ? t('filterAudio') :
          type === 'video' ? t('filterVideo') :
            type === 'playlist' ? t('filterPlaylists') :
              type === 'extractor' ? t('filterExtractors') :
              type === 'subs' ? t('filterSubs') : t('filterOther');

      const from = meta.from && meta.from.size ? Array.from(meta.from).join(', ') : '';
      const mime = meta.mime || t('unknown');
      const size = meta.size ? formatBytes(meta.size) : t('unknown');
      const note = meta.note || t('unknown');

      return `<tr>
        <td><span class="b">${escapeHtml(badge)}</span></td>
        <td><a href="${escapeAttr(it.url)}" target="_blank" rel="noreferrer noopener">${escapeHtml(it.url)}</a></td>
        <td>${escapeHtml(mime)}</td>
        <td>${escapeHtml(size)}</td>
        <td>${escapeHtml(note)}</td>
        <td>${escapeHtml(from)}</td>
      </tr>`;
    }).join('');

    return `<!doctype html><html><head><meta charset="utf-8">
      <title>${escapeHtml(t('title'))}</title>
      <style>
        body{background:linear-gradient(180deg,#14091f,#090612);color:#f5ebff;font:13px system-ui,-apple-system,"Segoe UI",sans-serif;padding:12px;}
        a{color:#e9d5ff;word-break:break-all;text-decoration:none;}
        table{width:100%;border-collapse:collapse;margin-top:10px;}
        th,td{border:1px solid rgba(216,180,254,.2);padding:8px;vertical-align:top;}
        th{background:#241037;text-align:left;}
        .b{display:inline-block;padding:3px 8px;border-radius:999px;border:1px solid rgba(216,180,254,.26);background:#341455;font-weight:600;font-size:12px;}
        .tip{opacity:.78;margin-top:6px;}
      </style>
    </head><body>
      <h1 style="margin:0 0 6px 0;font-size:18px;">${escapeHtml(t('title'))}</h1>
      <div class="tip">${escapeHtml(t('tip'))}</div>
      <div style="opacity:.8;margin-top:8px;">${escapeHtml(t('found'))}: ${found.size} • ${escapeHtml(t('players'))}: ${players.size}</div>
      <table>
        <thead><tr>
          <th>${escapeHtml(t('listType'))}</th><th>${escapeHtml(t('listUrl'))}</th><th>${escapeHtml(t('listMime'))}</th><th>${escapeHtml(t('listSize'))}</th><th>${escapeHtml(t('listNote'))}</th><th>${escapeHtml(t('listFrom'))}</th>
        </tr></thead>
        <tbody>${rows || `<tr><td colspan="6">${escapeHtml(t('noneYet'))}</td></tr>`}</tbody>
      </table>
    </body></html>`;
  }

  function openList() {
    ensureUI();
    if (!found.size) {
      if (ui.msgEl) ui.msgEl.textContent = t('noneYet');
      return;
    }

    const html = buildListHtml();
    let url = '';
    try {
      const blob = new Blob([html], { type: 'text/html' });
      url = URL.createObjectURL(blob);
    } catch {
      url = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
    }

    openUrl(url);
  }

  function exportTxt() {
    if (!found.size) return;

    const txt = Array.from(found.keys()).join('\n');
    const name = 'media_finder_' + new Date().toISOString().replace(/[:.]/g, '-') + '.txt';
    try {
      const blob = new Blob([txt], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.rel = 'noreferrer noopener';
      a.click();
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch { } }, 2000);
    } catch { }
  }

  let renderT = null;
  function scheduleRender() {
    if (inFrame) { relayFrame(); return; }
    if (renderT) return;
    renderT = setTimeout(() => {
      renderT = null;
      if (!ui) ensureUI();
      cleanupPlayers();
      renderAll();
      renderCapture();
    }, 220);
  }

  function domAll(selector) {
    const nodes = [];
    for (const root of roots) {
      if (root !== document && !root.host?.isConnected) { roots.delete(root); continue; }
      try { nodes.push(...root.querySelectorAll(selector)); } catch {}
    }
    return nodes;
  }

  function watchRoot(root) {
    if (watched.has(root)) return;
    watched.add(root);
    roots.add(root);
    let timer = null;
    const changed = list => {
      if (list.every(item => item.target === ui?.root || item.target?.getRootNode?.() === ui?.host || item.target === document.documentElement && Array.from(item.addedNodes || []).every(node => node === ui?.root))) return;
      if (timer) return;
      timer = setTimeout(() => { timer = null; scanDom(); cleanupPlayers(); }, 350);
    };
    const mo = new MutationObserver(changed);
    try { mo.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'href', 'srcset', 'poster', 'style', 'data-src', 'data-href', 'data-url', 'data-image', 'data-img', 'data-original', 'data-lazy-src', 'data-thumb', 'data-thumbnail', 'data-poster', 'data-srcset'] }); } catch {}
    const handler = event => {
      if (/^(VIDEO|AUDIO)$/.test(event.target?.tagName || '')) trackPlayer(event.target, 'event:' + event.type);
    };
    for (const event of ['play', 'loadedmetadata', 'emptied', 'durationchange']) root.addEventListener(event, handler, true);
  }

  function watchPlayers() {
    watchRoot(document);
    try {
      const proto = page.Element.prototype;
      const orig = proto.attachShadow;
      if (orig) proto.attachShadow = pageFn(function () {
        const root = orig.apply(this, arguments);
        if (arguments[0]?.mode === 'open' && this.id !== '__mf_root__' && roots.size < 100) watchRoot(root);
        return root;
      });
      for (const el of Array.from(document.querySelectorAll('*')).slice(0, 10000)) if (el.shadowRoot && el.id !== '__mf_root__') watchRoot(el.shadowRoot);
    } catch {}
  }

  function relayFrame() {
    if (!inFrame || relayTimer) return;
    relayTimer = setTimeout(() => {
      relayTimer = null;
      try {
        const items = Array.from(found).slice(-500).map(([url, meta]) => ({ url, mime: meta.mime, size: meta.size, note: meta.note, kind: meta.kind, mse: !!meta.mse }));
        const list = Array.from(players).filter(([el]) => el.isConnected).map(([el, info]) => ({ id: info.id, tag: info.tag, src: info.src, protected: info.protected, paused: el.paused }));
        window.top.postMessage({ channel: CHANNEL, type: 'snapshot', page: location.href, items, players: list, recording: !!rec, pending: !!rec?.pending, paused: !!rec?.paused, status: statusText }, '*');
      } catch {}
    }, 500);
  }

  function isFrameSource(source) {
    const scan = (doc, depth) => {
      if (depth > 5) return false;
      const frames = doc === document ? domAll('iframe,frame') : Array.from(doc.querySelectorAll('iframe,frame'));
      for (const frame of frames) {
        if (frame.contentWindow === source) return true;
        try { if (frame.contentDocument && scan(frame.contentDocument, depth + 1)) return true; } catch {}
      }
      return false;
    };
    try { return scan(document, 0); } catch { return false; }
  }

  function sendFrame(source, origin, type, extra = {}) {
    try { source.postMessage({ channel: CHANNEL, type, ...extra }, origin === 'null' ? '*' : origin); } catch {}
  }

  function installFrameRelay() {
    window.addEventListener('message', event => {
      const msg = event.data;
      if (!msg || msg.channel !== CHANNEL) return;
      if (inFrame) {
        if (event.source !== window.top) return;
        if (msg.type === 'record') {
          const entry = Array.from(players).find(([, info]) => info.id === msg.id);
          if (entry) startRecord('player', false, entry[0]);
          else setStatus('The embedded player was removed. Rescan and select its current player.');
        } else if (msg.type === 'stop') stopRecord();
        else if (msg.type === 'pause') pauseRecord();
        else if (msg.type === 'scan') scanDom();
        return;
      }
      if (!isFrameSource(event.source)) return;
      if (msg.type === 'snapshot') {
        const old = frameInfo.get(event.source);
        if (frameInfo.size >= 50 && !old) return;
        const list = Array.isArray(msg.players) ? msg.players.slice(0, 100).filter(item => /^(video|audio)$/.test(item?.tag) && typeof item.id === 'string') : [];
        const info = { id: old?.id || 'f' + (++playerSeq), source: event.source, origin: event.origin, page: String(msg.page || '').slice(0, 2048), players: list, last: now() };
        frameInfo.set(event.source, info);
        for (const item of (Array.isArray(msg.items) ? msg.items : []).slice(0, 500)) {
          if (!item || typeof item.url !== 'string' || item.url.length > 16000) continue;
          const url = norm(item.url);
          if (!url || !/^https?:|^blob:/i.test(url)) continue;
          add(url, { from: 'frame:' + event.origin, mime: String(item.mime || '').slice(0, 200), hintType: normalizeType(item.kind), note: String(item.note || '').slice(0, 200), size: Math.max(0, Number(item.size) || 0), referrer: info.page, frame: info.id, mse: !!item.mse });
        }
        if (rec?.remote === event.source) {
          if (msg.recording) {
            clearTimeout(rec.timer);
            if (msg.pending !== true && !rec.started) { rec.started = true; rec.time = now(); }
            rec.pending = msg.pending === true;
            rec.paused = msg.paused === true;
            rec.setupStatus = String(msg.status || 'Starting embedded recording…').slice(0, 500);
            rec.remoteStatus = rec.setupStatus;
          }
          else if (rec.pending && now() - rec.time > 2000 && msg.status) { rec = null; setStatus(String(msg.status).slice(0, 500)); }
          else if (msg.status && rec.started) setStatus(String(msg.status).slice(0, 500));
        }
        scheduleRender();
      } else if (msg.type === 'record-result' && rec?.remote === event.source) {
        const current = rec;
        clearTimeout(current.timer);
        rec = null;
        if (msg.blob instanceof Blob && msg.blob.size > 0 && msg.blob.size <= CFG.maxMemoryBytes) {
          saveBlob(msg.blob, String(msg.name || 'recording.webm'));
          setStatus(String(msg.status || 'Recording saved.').slice(0, 500));
        } else setStatus(String(msg.status || 'The embedded player produced no recording.').slice(0, 500));
        renderCapture();
      }
    });
  }

  function installHooks() {
    if (hooksInstalled) return;
    hooksInstalled = true;
    patchFetch();
    patchXHR();
    patchMediaSource();
    patchSetSrcAttr();
    installFrameRelay();

    observeResources();
  }

  function renderSavedFiles() {
    if (!ui?.files) return;
    const prior = ui.files.value;
    ui.files.hidden = savedFiles.length < 2;
    ui.files.replaceChildren();
    for (let i = 0; i < savedFiles.length; i++) ui.files.add(new Option(savedFiles[i].name, String(i)));
    ui.files.value = prior && savedFiles[Number(prior)] ? prior : String(Math.max(0, savedFiles.length - 1));
  }

  function renderCapture() {
    if (inFrame) { relayFrame(); return; }
    if (!ui?.player) return;
    if (rec?.remote && !isFrameSource(rec.remote)) { clearTimeout(rec.timer); rec = null; setStatus('The embedded player was removed. Its recording connection ended.'); }
    const list = playerEntries();
    const prior = ui.player.value;
    const sig = list.map(entry => [entry.id, entry.info.src, entry.info.protected].join('|')).join('\n');
    if (ui.player.dataset.sig !== sig) {
      ui.player.dataset.sig = sig;
      ui.player.replaceChildren();
      if (!list.length) ui.player.add(new Option('No player found — press play', ''));
      for (const entry of list) {
        let label = `${entry.info.tag === 'audio' ? 'Audio' : 'Video'} ${entry.id}`;
        try { if (entry.info.src && !entry.info.src.startsWith('blob:')) label += ' · ' + new URL(entry.info.src).hostname; }
        catch {}
        if (entry.frame) label += ' · embedded';
        if (entry.info.protected) label += ' · DRM';
        else if (!entry.info.src || entry.info.src.startsWith('blob:')) label += ' · player stream';
        ui.player.add(new Option(label, entry.id));
      }
      if (list.some(entry => entry.id === prior)) ui.player.value = prior;
      else {
        const playing = list.find(entry => entry.el ? !entry.el.paused : !entry.info.paused);
        if (playing) ui.player.value = playing.id;
      }
    }
    ui.capture.querySelector('summary').textContent = `Players & recording (${list.length})`;
    const selected = list.find(entry => entry.id === ui.player.value);
    ui.record.disabled = !!rec || !!job || !selected || !!selected.info.protected;
    ui.player.disabled = !!rec;
    ui.tabrecord.disabled = !!rec || !!job || !!selected?.info.protected;
    ui.tabrecord.hidden = typeof navigator.mediaDevices?.getDisplayMedia !== 'function';
    ui.recordfile.hidden = typeof page.showSaveFilePicker !== 'function' || !!selected?.frame;
    ui.recordfile.disabled = ui.record.disabled;
    ui.stop.hidden = !rec;
    ui.stop.textContent = rec?.pending ? 'Cancel recording setup' : 'Stop & save';
    ui.pause.hidden = !rec || !!rec.pending;
    ui.pause.textContent = rec?.paused ? 'Resume recording' : 'Pause recording';
    ui.recbar.hidden = !rec;
    ui.recbar.querySelector('button').textContent = rec?.pending ? 'Cancel' : 'Stop & save';
    if (rec?.remote) renderRecordStatus(rec);
    if (ui.cancel) ui.cancel.hidden = !job;
    if (ui.save) ui.save.hidden = !savedBlob;
  }

  function bindCapture() {
    ui.record.onclick = () => startRecord('player');
    ui.recordfile.onclick = () => startRecord('player', true);
    ui.tabrecord.onclick = () => startRecord('tab');
    ui.stop.onclick = () => stopRecord();
    ui.pause.onclick = () => pauseRecord();
    ui.recbar.querySelector('button').onclick = () => stopRecord();
    ui.cancel.onclick = () => job?.ctrl.abort();
    ui.save.onclick = () => { const file = savedFiles[Number(ui.files.value)] || savedBlob; if (file) saveBlob(file.blob, file.name); };
    ui.player.onchange = () => renderCapture();
    ui.quality.onchange = () => { quality = Number(ui.quality.value) || 0; };
    const row = ui.q.parentElement;
    const options = [ui.compact, ui.layout, ui.toastToggle, ui.clear];
    const update = () => {
      const mobile = matchMedia('(max-width: 950px), (pointer: coarse)').matches;
      if (ui.mobileOpts !== mobile) {
        ui.mobileOpts = mobile;
        for (const option of options) (mobile ? ui.customizer : row).appendChild(option);
      }
      const view = window.visualViewport;
      ui.root.style.setProperty('--mf-view-height', (view?.height || innerHeight) + 'px');
      ui.root.style.setProperty('--mf-view-width', (view?.width || innerWidth) + 'px');
      ui.root.style.setProperty('--mf-view-top', (view?.offsetTop || 0) + 'px');
      ui.root.style.setProperty('--mf-view-left', (view?.offsetLeft || 0) + 'px');
    };
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    update();
    renderCapture();
  }

  function start() {
    if (runtimeStarted) return;
    runtimeStarted = true;

    installHooks();
    watchPlayers();
    scanDom();

    setInterval(() => {
      cleanupPlayers();
      scanDom();
      scheduleRender();
    }, CFG.scanIntervalMs);

    if (!inFrame) { ensureUI(); renderAll(); }
  }

  installHooks();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
