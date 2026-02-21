// ==UserScript==
// @name         Media Finder (advanced + clean UI + auto language)
// @namespace    http://tampermonkey.net/
// @version      1.2.0
// @description  Advanced media finder for images/audio/video/m3u8/mpd with deeper DOM/script probing and better preview UX
// @match        *://*/*
// @run-at       document-start
// @grant        GM_openInTab
// @grant        GM_download
// @downloadURL  https://github.com/ltseverydayyou/userscripts/raw/main/media%20finder.user.js
// @updateURL    https://github.com/ltseverydayyou/userscripts/raw/main/media%20finder.meta.js
// ==/UserScript==

(function () {
  'use strict';

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
    includeQueryExt: true
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

  const found = new Map(); // url -> {ts, from:Set, mime?, size?, note?, kind?}
  const players = new Map(); // el -> {tag, src, last, why:Set}
  const srcSeen = new Set();

  let ui = null;
  let uiOpen = false;
  let lastToast = 0;
  let previewState = { url: '', sig: '' };
  let hotkeyHooked = false;
  let hooksInstalled = false;
  let runtimeStarted = false;
  let ytSnapshotSig = '';

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
      clear: 'Clear',
      search: 'Search…',
      filterAll: 'All',
      filterImages: 'Images',
      filterAudio: 'Audio',
      filterVideo: 'Video',
      filterPlaylists: 'Playlists',
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
      tip: 'Tip: scroll/load more and press play. This tracker captures images, audio, video, HLS and DASH links.',
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
      selectPreview: 'Select an item to preview on the right.',
      launcherHide: 'Hide toggle button',
      launcherShow: 'Show toggle button',
      layout: 'Layout'
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
      clear: 'Изчисти',
      search: 'Търсене…',
      filterAll: 'Всички',
      filterImages: 'Images',
      filterAudio: 'Аудио',
      filterVideo: 'Видео',
      filterPlaylists: 'Плейлисти',
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
      tip: 'Tip: scroll/load more and press play. This tracker captures images, audio, video, HLS and DASH links.',
      noneYet: 'No media links yet. Scroll/load content or press play, then wait a second.',
      clipboardBlocked: 'Клипбордът е блокиран — ползвай „Отвори списък“',
      copied: 'Копирани',
      items: 'елемент(а)',
      compact: 'Компактно',
      toast: 'Тост',
      on: 'Вкл',
      off: 'Изкл',
      unknown: 'Unknown',
      viewList: 'List view',
      viewGrid: 'Grid view',
      previewPane: 'Preview',
      selectPreview: 'Select an item to preview on the right.',
      launcherHide: 'Hide toggle button',
      launcherShow: 'Show toggle button',
      layout: 'Layout'
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
    launcherVisible: true,
    previewUrl: '',
    previewType: ''
  };
  loadState();

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') applySavedState(parsed);
    } catch { }
  }

  function applySavedState(saved) {
    if (!saved || typeof saved !== 'object') return;
    const okLang = new Set(['auto', 'en', 'bg']);
    const okFilter = new Set(['all', 'image', 'audio', 'video', 'playlist', 'subs', 'other']);
    const okSort = new Set(['newest', 'oldest', 'unique']);
    const okLayout = new Set(['list', 'grid']);

    if (okLang.has(saved.lang)) state.lang = saved.lang;
    if (okFilter.has(saved.filter)) state.filter = saved.filter;
    if (okSort.has(saved.sort)) state.sort = saved.sort;
    if (typeof saved.query === 'string') state.query = saved.query;
    if (typeof saved.compact === 'boolean') state.compact = saved.compact;
    if (typeof saved.toast === 'boolean') state.toast = saved.toast;
    if (okLayout.has(saved.layout)) state.layout = saved.layout;
    if (typeof saved.launcherVisible === 'boolean') state.launcherVisible = saved.launcherVisible;
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
        launcherVisible: !!state.launcherVisible
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
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
    return u;
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
    if (depth > CFG.maxJsonWalkDepth || node == null) return;

    if (typeof node === 'string') {
      const text = node.trim();
      if (!text) return;
      const hasHint = !!keyHint;
      if (
        /^https?:\/\//i.test(text) ||
        /^\/\//.test(text) ||
        (hasHint && /^\/[^/]/.test(text)) ||
        looksLikeMedia(text)
      ) {
        add(text, { from, hintType: keyHint || '' });
      }
      return;
    }

    if (Array.isArray(node)) {
      for (const it of node) walkObjectForUrls(it, from, keyHint, depth + 1);
      return;
    }

    if (typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        const nextHint = hintFromKey(k) || keyHint || '';
        walkObjectForUrls(v, from, nextHint, depth + 1);
      }
    }
  }

  function parseYoutubeCipherUrl(cipher) {
    try {
      const qs = new URLSearchParams(String(cipher || ''));
      let u = qs.get('url') || '';
      if (!u) return '';
      u = safeDecode(u);
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

    if (!found.has(u)) {
      if (found.size >= CFG.maxItems) return;
      found.set(u, { ts: now(), from: new Set(), mime: mime || '', size: meta?.size || 0, note: meta?.note || (tsSeg ? 'segment' : ''), kind: hint || '' });
    }

    const it = found.get(u);
    if (meta?.from) {
      it.from.add(meta.from);
      if (it.from.size > CFG.maxReasons) {
        const arr = Array.from(it.from).slice(-CFG.maxReasons);
        it.from = new Set(arr);
      }
    }
    if (mime && !it.mime) it.mime = mime;
    if (meta?.size && !it.size) it.size = meta.size;
    if (meta?.note && !it.note) it.note = meta.note;
    if (hint && !it.kind) it.kind = hint;

    scheduleRender();
    maybeToast();
  }

  function scanMetaTags() {
    try {
      const nodes = document.querySelectorAll('meta[property],meta[name],meta[itemprop]');
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
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
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
      const scripts = document.querySelectorAll('script:not([src])');
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
      const a = window.ytInitialPlayerResponse;
      if (a && typeof a === 'object') return a;
    } catch { }
    try {
      const b = window.ytplayer?.config?.args?.player_response;
      if (b) {
        const parsed = typeof b === 'string' ? safeJsonParse(b) : b;
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch { }
    try {
      const c = window.ytcfg?.data_?.PLAYER_RESPONSE;
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

  function runDeepExtractors() {
    scanMetaTags();
    scanJsonLd();
    scanInlineScriptsForMediaUrls();
    extractYouTubeMedia();
  }

  function getMediaSrc(el) {
    try {
      return el.currentSrc || el.src || el.getAttribute('src') || '';
    } catch {
      return '';
    }
  }

  function trackPlayer(el, why) {
    const ttag = el?.tagName?.toLowerCase();
    if (ttag !== 'video' && ttag !== 'audio') return;

    const cur = getMediaSrc(el);
    const src = cur ? (norm(cur) || cur) : '';

    let info = players.get(el);
    if (!info) {
      if (players.size >= CFG.maxPlayers) return;
      info = { tag: ttag, why: new Set(), src: '', last: 0 };
      players.set(el, info);
    }

    if (why) info.why.add(why);
    if (info.why.size > CFG.maxReasons) info.why = new Set(Array.from(info.why).slice(-CFG.maxReasons));

    if (src && src !== info.src) {
      info.src = src;
      info.last = now();

      if (!srcSeen.has(src)) {
        srcSeen.add(src);
        add(src, { from: 'player:' + ttag });
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
      const nodes = document.querySelectorAll('video,audio,img,picture,source,track,link[href],[src],[href],[poster],[srcset],[data-src],[data-href],[data-url],[data-image],[data-img],[data-original],[data-lazy-src],[data-thumb],[data-thumbnail],[data-poster],[data-srcset],style,[style*="url("]');
      nodes.forEach(n => {
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

      add(url, { from: from || 'sniff:playlist', mime: mime, note: 'playlist', hintType: 'playlist' });
      const base = new URL(url, location.href);

      if (hasM3u) {
        const lines = body.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        for (const ln of lines) {
          if (!ln || ln.startsWith('#')) continue;
          if (/^data:/i.test(ln)) continue;
          let abs = null;
          try { abs = new URL(ln, base.href).href; } catch { abs = null; }
          if (abs) add(abs, { from: 'playlist:child', hintType: 'video' });
        }
      }

      if (hasMpd) {
        const re = /\b(?:src|media|initialization|href)\s*=\s*["']([^"']+)["']/gi;
        let m;
        while ((m = re.exec(body))) {
          const raw = m[1];
          if (!raw || /^data:/i.test(raw)) continue;
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

      const txt = await resp.clone().text();
      if (!txt) return;
      sniffPlaylistText(url, mime, txt, 'sniff:playlist');
    } catch { }
  }

  function patchFetch() {
    if (!window.fetch) return;
    const orig = window.fetch;
    window.fetch = function (...args) {
      let url = '';
      try {
        const a0 = args[0];
        url = typeof a0 === 'string' ? a0 : (a0 && a0.url) || '';
      } catch { }
      const nurl = norm(url) || url;

      return orig.apply(this, args).then(async (resp) => {
        try {
          const ct = readHeader(resp.headers, 'content-type');
          const len = Number(readHeader(resp.headers, 'content-length')) || 0;
          const furl = norm(resp?.url) || resp?.url || '';
          const purl = furl || nurl;

          if (nurl) add(nurl, { from: 'fetch', mime: ct, size: len });
          if (furl && furl !== nurl) add(furl, { from: 'fetch:final', mime: ct, size: len });
          if (purl) await sniffMaybePlaylist(purl, ct, resp);
        } catch { }
        return resp;
      });
    };
  }

  function patchXHR() {
    const X = window.XMLHttpRequest;
    if (!X) return;

    const open0 = X.prototype.open;
    const send0 = X.prototype.send;

    X.prototype.open = function (method, url) {
      try { this.__mf_url = norm(url) || url || ''; } catch { }
      try { this.__mf_method = method || ''; } catch { }
      return open0.apply(this, arguments);
    };

    X.prototype.send = function () {
      try {
        const onReady = () => {
          try {
            if (this.readyState !== 4) return;
            this.removeEventListener('readystatechange', onReady);
            const u = this.__mf_url || '';
            const ru = norm(this.responseURL) || this.responseURL || '';
            const target = ru || u;
            if (!target) return;

            let ct = '';
            try { ct = this.getResponseHeader('content-type') || ''; } catch { }
            let len = 0;
            try { len = Number(this.getResponseHeader('content-length')) || 0; } catch { }

            add(target, { from: 'xhr', mime: ct, size: len });
            if (u && u !== target) add(u, { from: 'xhr:open', mime: ct, size: len });

            const rt = String(this.responseType || '');
            if ((rt === '' || rt === 'text') && ct && (ct.includes('mpegurl') || ct.includes('dash+xml') || ct.includes('xml') || ct.includes('text'))) {
              let txt = '';
              try { txt = String(this.responseText || ''); } catch { txt = ''; }
              if (txt && txt.length <= CFG.maxFetchBodyBytesForPlaylist) sniffPlaylistText(target, ct, txt, 'xhr:playlist');
            }
          } catch { }
        };

        this.addEventListener('readystatechange', onReady);
      } catch { }
      return send0.apply(this, arguments);
    };
  }

  function patchMediaSource() {
    const MS = window.MediaSource;
    if (!MS || !MS.prototype) return;

    const addSB0 = MS.prototype.addSourceBuffer;
    MS.prototype.addSourceBuffer = function (mime) {
      try {
        if (mime && (String(mime).includes('audio') || String(mime).includes('video') || String(mime).includes('mp4') || String(mime).includes('webm'))) {
          add(location.href, { from: 'mediasource', mime: String(mime), note: 'MSE stream (segments)' });
        }
      } catch { }
      return addSB0.apply(this, arguments);
    };
  }

  function patchSetSrcAttr() {
    const setAttr0 = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
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
    };
  }

  function ensureUI() {
    if (ui) return;

    const root = document.createElement('div');
    root.id = '__mf_root__';
    root.attachShadow?.({ mode: 'open' });

    const host = root.shadowRoot || root;

    const style = document.createElement('style');
    style.textContent = `
      :host, * { box-sizing: border-box; }
      .mf_btn {
        position: fixed; right: 12px; bottom: 12px; z-index: 2147483647;
        background: rgba(2,6,23,.92); color: #e5e7eb;
        border: 1px solid rgba(148,163,184,.35); border-radius: 14px;
        padding: 10px 12px; cursor: pointer; font: 12px system-ui,-apple-system,"Segoe UI",sans-serif;
        display:flex; align-items:center; gap:10px; box-shadow: 0 12px 34px rgba(0,0,0,.38);
        backdrop-filter: blur(10px);
        transition: transform .24s ease, box-shadow .24s ease, opacity .24s ease;
      }
      .mf_btn:hover { transform: translateY(-2px); box-shadow: 0 14px 38px rgba(0,0,0,.42); }
      .mf_btn.mf_btn_hidden { transform: translateX(85%) translateY(0); opacity:.35; pointer-events:auto; }
      .mf_btn .mf_toggle {
        width: 20px; height: 20px; border-radius: 999px;
        border: 1px solid rgba(148,163,184,.45);
        display:grid; place-items:center;
        font-weight: 700; font-size: 12px; line-height: 1;
        background: rgba(15,23,42,.9);
        transition: background .24s ease, color .24s ease;
      }
      .mf_dot { width: 8px; height: 8px; border-radius: 99px; background: #38bdf8; opacity: .9; }
      .mf_cnt { font-variant-numeric: tabular-nums; opacity: .95; }
      .mf_toast {
        position: fixed; left: 50%; top: 12px; transform: translateX(-50%);
        z-index: 2147483647; pointer-events: none;
        max-width: min(920px, calc(100vw - 24px));
      }
      .mf_toast > div{
        pointer-events: auto;
        background: rgba(2,6,23,.92); color:#e5e7eb;
        border: 1px solid rgba(148,163,184,.35);
        border-radius: 14px; padding: 10px 12px;
        display:flex; gap:10px; align-items:center;
        box-shadow: 0 12px 34px rgba(0,0,0,.38);
        backdrop-filter: blur(10px);
        font: 13px system-ui,-apple-system,"Segoe UI",sans-serif;
      }
      .mf_toast .msg { flex: 1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow: ellipsis; opacity:.95; }
      .mf_toast button {
        background: rgba(15,23,42,.9); color:#e5e7eb;
        border: 1px solid rgba(148,163,184,.35); border-radius: 12px;
        padding: 7px 10px; cursor:pointer; font: 12px system-ui,-apple-system,"Segoe UI",sans-serif;
      }
      .mf_backdrop {
        position: fixed; inset: 0; z-index: 2147483647;
        background: rgba(0,0,0,.45); backdrop-filter: blur(6px);
        display:none; align-items:center; justify-content:center;
        opacity: 0; pointer-events: none; transition: opacity .22s ease;
      }
      .mf_backdrop.mf_visible { opacity: 1; pointer-events: auto; }
      .mf_panel {
        width: min(980px, calc(100vw - 24px));
        height: min(720px, calc(100vh - 24px));
        background: rgba(2,6,23,.96); color:#e5e7eb;
        border: 1px solid rgba(148,163,184,.35);
        border-radius: 18px; box-shadow: 0 22px 70px rgba(0,0,0,.55);
        display:flex; flex-direction:column; overflow:hidden;
        transform: translateY(12px) scale(.98);
        opacity: 0;
        transition: transform .24s ease, opacity .24s ease;
      }
      .mf_backdrop.mf_visible .mf_panel { transform: translateY(0) scale(1); opacity: 1; }
      .mf_hdr {
        padding: 12px 12px 10px 12px;
        display:flex; gap:10px; align-items:center;
        border-bottom: 1px solid rgba(148,163,184,.18);
      }
      .mf_title { font: 600 14px system-ui,-apple-system,"Segoe UI",sans-serif; letter-spacing:.2px; }
      .mf_sub { opacity:.75; font: 12px system-ui,-apple-system,"Segoe UI",sans-serif; }
      .mf_sp { flex:1; }
      .mf_iconbtn {
        background: rgba(15,23,42,.9); color:#e5e7eb;
        border: 1px solid rgba(148,163,184,.35);
        border-radius: 12px; padding: 8px 10px; cursor:pointer;
        font: 12px system-ui,-apple-system,"Segoe UI",sans-serif;
      }
      .mf_row {
        padding: 10px 12px; display:flex; gap:10px; align-items:center; flex-wrap:wrap;
        border-bottom: 1px solid rgba(148,163,184,.12);
      }
      .mf_inp {
        flex: 1; min-width: 220px;
        background: rgba(15,23,42,.65); color:#e5e7eb;
        border: 1px solid rgba(148,163,184,.25); border-radius: 14px;
        padding: 10px 12px; outline: none; font: 12.5px system-ui,-apple-system,"Segoe UI",sans-serif;
      }
      .mf_sel {
        background: rgba(15,23,42,.65); color:#e5e7eb;
        border: 1px solid rgba(148,163,184,.25); border-radius: 14px;
        padding: 10px 10px; outline:none; font: 12.5px system-ui,-apple-system,"Segoe UI",sans-serif;
      }
      .mf_body { flex:1; overflow:auto; padding: 8px 12px 12px 12px; display:flex; flex-direction:column; gap:6px; }
      .mf_tip { opacity:.75; font: 12px system-ui,-apple-system,"Segoe UI",sans-serif; padding: 6px 2px 4px 2px; }
      .mf_item {
        border: 1px solid rgba(148,163,184,.16);
        background: rgba(15,23,42,.35);
        border-radius: 16px;
        padding: 10px 10px;
        display:flex; gap:10px; align-items:flex-start;
        margin: 10px 0;
      }
      .mf_badge {
        padding: 6px 10px; border-radius: 999px;
        border: 1px solid rgba(148,163,184,.25);
        background: rgba(2,6,23,.55);
        font: 600 11px system-ui,-apple-system,"Segoe UI",sans-serif;
        opacity:.9;
        min-width: 78px; text-align:center;
      }
      .mf_main { flex:1; min-width:0; }
      .mf_url {
        color:#7dd3fc; text-decoration:none; word-break: break-all;
        font: 12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      }
      .mf_meta { margin-top: 6px; opacity:.72; font: 12px system-ui,-apple-system,"Segoe UI",sans-serif; }
      .mf_actions { display:flex; gap:8px; align-items:center; flex-wrap: wrap; justify-content:flex-end; }
      .mf_actions button{
        background: rgba(15,23,42,.85); color:#e5e7eb;
        border: 1px solid rgba(148,163,184,.25); border-radius: 12px;
        padding: 7px 10px; cursor:pointer; font: 12px system-ui,-apple-system,"Segoe UI",sans-serif;
      }
      .mf_preview {
        display:none;
        width: 100%;
        margin-top: 8px;
        border: 1px solid rgba(148,163,184,.16);
        background: rgba(2,6,23,.55);
        border-radius: 12px;
        padding: 8px;
      }
      .mf_preview video,
      .mf_preview audio,
      .mf_preview img {
        width: 100%;
        max-height: 240px;
        border-radius: 10px;
        background: #0b1220;
      }
      .mf_preview .mf_note {
        font: 12px system-ui,-apple-system,"Segoe UI",sans-serif;
        opacity: .75;
      }
      .mf_compact .mf_item{ padding: 8px 10px; }
      .mf_compact .mf_meta{ display:none; }
      .mf_split { display:grid; grid-template-columns: minmax(0, 1.45fr) 360px; gap: 12px; align-items:start; min-height:0; transition: grid-template-columns .22s ease; }
      .mf_split.mf_no_preview { grid-template-columns: 1fr; }
      .mf_split.mf_no_preview .mf_previewpanel { display:none; }
      .mf_listwrap { min-height:0; }
      .mf_listwrap .mf_item { margin: 10px 0; }
      .mf_listwrap.mf_grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px; }
      .mf_listwrap.mf_grid .mf_item { margin: 0; flex-direction: column; align-items: stretch; }
      .mf_listwrap.mf_grid .mf_actions { justify-content:flex-start; }
      .mf_item_selected { border-color: rgba(56,189,248,.6); box-shadow: 0 0 0 1px rgba(56,189,248,.2), 0 10px 30px rgba(0,0,0,.25); }
      .mf_item_selected .mf_badge { border-color: rgba(56,189,248,.6); }
      .mf_previewpanel {
        position: sticky;
        top: 8px;
        align-self: start;
        background: rgba(2,6,23,.7);
        border: 1px solid rgba(148,163,184,.2);
        border-radius: 14px;
        padding: 10px;
        min-height: 140px;
        max-height: calc(100vh - 170px);
        overflow: auto;
      }
      .mf_previewpanel.mf_peek {
        box-shadow: 0 0 0 1px rgba(56,189,248,.4), 0 18px 36px rgba(0,0,0,.28);
      }
      .mf_preview_card { display:flex; flex-direction:column; gap:10px; }
      .mf_preview_header { display:flex; gap:8px; align-items:flex-start; justify-content:space-between; }
      .mf_preview_header .mf_label { font: 600 13px system-ui,-apple-system,"Segoe UI",sans-serif; }
      .mf_preview_meta { font: 12px system-ui,-apple-system,"Segoe UI",sans-serif; opacity:.82; display:flex; flex-direction:column; gap:4px; word-break:break-word; }
      .mf_preview_player {
        background: #0b1220;
        border-radius: 12px;
        padding: 8px;
        border: 1px solid rgba(148,163,184,.16);
      }
      .mf_preview_player video,
      .mf_preview_player audio,
      .mf_preview_player img {
        width: 100%;
        max-height: 320px;
        border-radius: 10px;
        background: #0b1220;
      }
      .mf_preview_empty { font: 12px system-ui,-apple-system,"Segoe UI",sans-serif; opacity:.72; }
      @media (max-width: 860px) {
        .mf_split { grid-template-columns: 1fr; }
        .mf_previewpanel {
          position: sticky;
          top: 8px;
          order: -1;
          margin-bottom: 10px;
          max-height: 40vh;
        }
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
      <div class="mf_panel">
        <div class="mf_hdr">
          <div>
            <div class="mf_title">${t('title')}</div>
            <div class="mf_sub" id="__mf_sub__">${t('scanning')}</div>
          </div>
          <div class="mf_sp"></div>
          <button class="mf_iconbtn" id="__mf_openlist__" title="Open the full table in a new tab">${t('openList')}</button>
          <button class="mf_iconbtn" id="__mf_copyall__" title="Copy all found URLs">${t('copyAll')}</button>
          <button class="mf_iconbtn" id="__mf_export__" title="Save all URLs to a .txt file">${t('export')}</button>
          <button class="mf_iconbtn" id="__mf_close__" title="Close the Media Finder panel">${t('close')}</button>
        </div>
        <div class="mf_row">
          <input class="mf_inp" id="__mf_q__" placeholder="${t('search')}" />
          <select class="mf_sel" id="__mf_filter__" title="Filter by media type">
            <option value="all">${t('filterAll')}</option>
            <option value="image">${t('filterImages')}</option>
            <option value="audio">${t('filterAudio')}</option>
            <option value="video">${t('filterVideo')}</option>
            <option value="playlist">${t('filterPlaylists')}</option>
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
          <button class="mf_iconbtn" id="__mf_compact__" title="Toggle compact list density">${t('compact')}</button>
          <button class="mf_iconbtn" id="__mf_layout__" title="Switch between list and grid layouts">${t('viewList')}</button>
          <button class="mf_iconbtn" id="__mf_toasttoggle__" title="Toggle toast notifications">${t('toast')}: ${t('on')}</button>
          <button class="mf_iconbtn" id="__mf_clear__" title="Clear all detected entries">${t('clear')}</button>
        </div>
        <div class="mf_body" id="__mf_body__">
          <div class="mf_tip" id="__mf_tip__">${t('tip')}</div>
          <div class="mf_split mf_no_preview" id="__mf_split__">
            <div class="mf_listwrap" id="__mf_list__"></div>
            <div class="mf_previewpanel" id="__mf_preview__">
            </div>
          </div>
        </div>
      </div>
    `;

    host.appendChild(style);
    host.appendChild(toastWrap);
    host.appendChild(btn);
    host.appendChild(backdrop);

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
      root, host, toastWrap, msgEl, btn, backdrop,
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
      openListBtn: backdrop.querySelector('#__mf_openlist__'),
      closeBtn: backdrop.querySelector('#__mf_close__'),
      split: backdrop.querySelector('#__mf_split__'),
      listWrap: backdrop.querySelector('#__mf_list__'),
      previewPane: backdrop.querySelector('#__mf_preview__'),
      tip: backdrop.querySelector('#__mf_tip__')
    };

    ui.q.addEventListener('input', () => { state.query = ui.q.value || ''; saveStateSoon(); renderList(); });
    ui.filter.addEventListener('change', () => { state.filter = ui.filter.value; saveState(); renderList(); });
    ui.sort.addEventListener('change', () => { state.sort = ui.sort.value; saveState(); renderList(); });
    ui.lang.addEventListener('change', () => { state.lang = ui.lang.value; saveState(); rerenderAllText(); });
    ui.compact.onclick = () => { state.compact = !state.compact; saveState(); renderList(); };
    ui.layout.onclick = () => { state.layout = state.layout === 'list' ? 'grid' : 'list'; saveState(); renderList(); renderHeader(); };
    ui.toastToggle.onclick = () => { state.toast = !state.toast; saveState(); renderToastState(); };
    ui.clear.onclick = () => { found.clear(); srcSeen.clear(); tsSeen.clear(); ytSnapshotSig = ''; state.previewUrl = ''; state.previewType = ''; previewState = { url: '', sig: '' }; renderAll(); };
    ui.copyAllBtn.onclick = () => copyAll();
    ui.exportBtn.onclick = () => exportTxt();
    ui.openListBtn.onclick = () => openList();
    ui.closeBtn.onclick = () => closePanel();

    renderToastState();
    applyLauncherVisibility();

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

    ui.openListBtn.textContent = t('openList');
    ui.copyAllBtn.textContent = t('copyAll');
    ui.exportBtn.textContent = t('export');
    ui.closeBtn.textContent = t('close');

    ui.q.placeholder = t('search');

    ui.filter.querySelector('option[value="all"]').textContent = t('filterAll');
    ui.filter.querySelector('option[value="image"]').textContent = t('filterImages');
    ui.filter.querySelector('option[value="audio"]').textContent = t('filterAudio');
    ui.filter.querySelector('option[value="video"]').textContent = t('filterVideo');
    ui.filter.querySelector('option[value="playlist"]').textContent = t('filterPlaylists');
    ui.filter.querySelector('option[value="subs"]').textContent = t('filterSubs');
    ui.filter.querySelector('option[value="other"]').textContent = t('filterOther');

    ui.sort.querySelector('option[value="newest"]').textContent = t('newest');
    ui.sort.querySelector('option[value="oldest"]').textContent = t('oldest');
    ui.sort.querySelector('option[value="unique"]').textContent = t('uniqueFirst');

    ui.lang.querySelector('option[value="auto"]').textContent = t('auto');

    ui.compact.textContent = t('compact');
    ui.clear.textContent = t('clear');

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
    const items = listItems();
    if (!ui.listWrap) return;

    if (ui.tip) ui.tip.textContent = t('tip');
    if (ui.listWrap) ui.listWrap.classList.toggle('mf_grid', state.layout === 'grid');
    if (state.previewUrl && !found.has(state.previewUrl)) clearPreviewSelection();

    ui.body.classList.toggle('mf_compact', !!state.compact);

    if (!items.length) {
      ui.listWrap.innerHTML = `<div class="mf_item"><div class="mf_badge">${t('found')}</div><div class="mf_main">
        <div class="mf_meta">${t('noneYet')}</div>
      </div></div>`;
      renderPreviewPane(true);
      return;
    }

    const html = [];
    for (const it of items.slice(0, CFG.maxItems)) {
      const meta = it.meta || {};
      const badge =
        it.type === 'image' ? t('filterImages') :
          it.type === 'audio' ? t('filterAudio') :
          it.type === 'video' ? t('filterVideo') :
            it.type === 'playlist' ? t('filterPlaylists') :
              it.type === 'subs' ? t('filterSubs') : t('filterOther');

      const mime = meta.mime ? clip(meta.mime, 70) : t('unknown');
      const size = meta.size ? formatBytes(meta.size) : t('unknown');
      const from = meta.from && meta.from.size ? Array.from(meta.from).join(', ') : '';
      const note = meta.note ? meta.note : t('unknown');
      const canPreview = (it.type === 'audio' || it.type === 'video' || it.type === 'image') && !isTsSegment(it.url);
      const isSelected = state.previewUrl === it.url;
      const previewLabel = isSelected ? t('hidePreview') : t('preview');

      html.push(`
        <div class="mf_item${isSelected ? ' mf_item_selected' : ''}">
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
            <button data-act="open" data-url="${escapeAttr(it.url)}">${t('open')}</button>
            <button data-act="download" data-url="${escapeAttr(it.url)}">${t('download')}</button>
            <button data-act="copy" data-url="${escapeAttr(it.url)}">${t('copy')}</button>
          </div>
        </div>
      `);
    }

    ui.listWrap.innerHTML = html.join('');

    ui.listWrap.querySelectorAll('button[data-act]').forEach(b => {
      b.onclick = () => {
        const act = b.getAttribute('data-act');
        const url = b.getAttribute('data-url') || '';
        const type = b.getAttribute('data-type') || '';
        if (!url) return;
        if (act === 'open') openUrl(url);
        else if (act === 'copy') copyOne(url);
        else if (act === 'download') downloadUrl(url);
        else if (act === 'preview') togglePreview(url, type);
      };
    });

    renderPreviewPane();
  }

  function renderPreviewPane(force) {
    try {
      ensureUI();
      const pane = ui?.previewPane;
      const split = ui?.split;
      if (!pane || !split) return;

      const url = state.previewUrl || '';
      if (!url) {
        stopMedia(pane);
        previewState = { url: '', sig: '' };
        pane.innerHTML = '';
        split.classList.add('mf_no_preview');
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

      split.classList.remove('mf_no_preview');

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
        else slot.innerHTML = `<div class="mf_preview_empty">Preview not available</div>`;
      }

      previewState = { url, sig };
    } catch { }
  }

  function clearPreviewSelection() {
    if (ui?.previewPane) stopMedia(ui.previewPane);
    state.previewUrl = '';
    state.previewType = '';
    previewState = { url: '', sig: '' };
  }

  function renderHeader() {
    ensureUI();

    const cnt = found.size;
    const pCnt = players.size;

    const sub = `${t('found')}: ${cnt} ${t('links')} • ${t('players')}: ${pCnt}`;
    ui.sub.textContent = sub;

    ui.btn.querySelector('.mf_cnt').textContent = `${t('title')} • ${cnt}`;
    if (ui.msgEl) ui.msgEl.textContent = sub;

    ui.filter.value = state.filter;
    ui.sort.value = state.sort;
    ui.lang.value = state.lang;
    ui.q.value = state.query || '';
    if (ui.layout) {
      ui.layout.textContent = `${t('layout')}: ${state.layout === 'grid' ? t('viewGrid') : t('viewList')}`;
      ui.layout.title = 'Switch between list and grid layouts';
    }
    renderToastState();
    applyLauncherVisibility();
    ui.btn.classList.toggle('mf_open', uiOpen);
    const arrow = ui.btn.querySelector('.mf_toggle');
    if (arrow) {
      arrow.textContent = state.launcherVisible ? '>' : '<';
      arrow.title = state.launcherVisible ? t('launcherHide') : t('launcherShow');
    }
  }

  function renderAll() {
    renderHeader();
    renderList();
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function escapeAttr(s) {
    return escapeHtml(s).replace(/`/g, '&#96;');
  }

  function maybeToast() {
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

  function downloadUrl(url) {
    const name = guessFileName(url);
    try {
      if (typeof GM_download === 'function') {
        GM_download({
          url,
          name,
          saveAs: true,
          onerror: () => openUrl(url)
        });
        return;
      }
    } catch { }

    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.rel = 'noreferrer noopener';
      a.style.display = 'none';
      const parent = document.body || document.documentElement || null;
      if (parent) parent.appendChild(a);
      a.click();
      setTimeout(() => { try { a.remove(); } catch { } }, 0);
    } catch {
      openUrl(url);
    }
  }

  function focusPreviewPane() {
    try {
      ensureUI();
      const pane = ui?.previewPane;
      const body = ui?.body;
      if (!pane || !body || !state.previewUrl) return;
      pane.classList.add('mf_peek');
      setTimeout(() => { try { pane.classList.remove('mf_peek'); } catch { } }, 800);
      pane.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });

      const top = pane.offsetTop - 10;
      const cur = body.scrollTop;
      if (top < cur || top > cur + body.clientHeight - 120) {
        body.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
      }
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
        body{background:#020617;color:#e5e7eb;font:13px system-ui,-apple-system,"Segoe UI",sans-serif;padding:12px;}
        a{color:#7dd3fc;word-break:break-all;text-decoration:none;}
        table{width:100%;border-collapse:collapse;margin-top:10px;}
        th,td{border:1px solid rgba(148,163,184,.22);padding:8px;vertical-align:top;}
        th{background:#0b1220;text-align:left;}
        .b{display:inline-block;padding:3px 8px;border-radius:999px;border:1px solid rgba(148,163,184,.3);background:#0b1220;font-weight:600;font-size:12px;}
        .tip{opacity:.75;margin-top:6px;}
      </style>
    </head><body>
      <h1 style="margin:0 0 6px 0;font-size:18px;">${escapeHtml(t('title'))}</h1>
      <div class="tip">${escapeHtml(t('tip'))}</div>
      <div style="opacity:.8;margin-top:8px;">${escapeHtml(t('found'))}: ${found.size} • ${escapeHtml(t('players'))}: ${players.size}</div>
      <table>
        <thead><tr>
          <th>Type</th><th>URL</th><th>MIME</th><th>Size</th><th>Note</th><th>From</th>
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
    if (renderT) return;
    renderT = setTimeout(() => {
      renderT = null;
      if (!ui) ensureUI();
      cleanupPlayers();
      renderAll();
    }, 220);
  }

  function watchPlayers() {
    const h = (e) => {
      const t = e?.target;
      if (t && (t.tagName === 'VIDEO' || t.tagName === 'AUDIO')) trackPlayer(t, 'event:' + e.type);
    };
    document.addEventListener('play', h, true);
    document.addEventListener('loadedmetadata', h, true);
    document.addEventListener('emptied', h, true);
    document.addEventListener('durationchange', h, true);

    let moT = null;
    const mo = new MutationObserver(() => {
      if (moT) return;
      moT = setTimeout(() => {
        moT = null;
        scanDom();
        cleanupPlayers();
      }, 250);
    });

    try {
      mo.observe(document.documentElement || document, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src', 'href', 'srcset', 'poster', 'style', 'data-src', 'data-href', 'data-url', 'data-image', 'data-img', 'data-original', 'data-lazy-src', 'data-thumb', 'data-thumbnail', 'data-poster', 'data-srcset']
      });
    } catch { }
  }

  function installHooks() {
    if (hooksInstalled) return;
    hooksInstalled = true;
    patchFetch();
    patchXHR();
    patchMediaSource();
    patchSetSrcAttr();

    observeResources();
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

    ensureUI();
    renderAll();
  }

  installHooks();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
