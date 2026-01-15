// ==UserScript==
// @name         Media Finder (advanced + clean UI + auto language)
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Advanced mp3/mp4/m3u8/mpd finder: fetch/xhr sniffing + player tracking + clean panel + auto language + toggle
// @match        *://*/*
// @run-at       document-start
// @grant        GM_openInTab
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
    scanIntervalMs: 2500,
    toastAutoHideMs: 0,
    allowDataUrls: false,
    allowBlobUrls: true,
    includeQueryExt: true
  };

  const EXT = [
    'mp3', 'mp4', 'm4a', 'm4v', 'webm', 'ogg', 'ogv', 'oga', 'wav', 'flac', 'aac', 'opus',
    'mov', 'mkv', 'avi', 'flv', 'm3u8', 'mpd', 'ts', 'm4s', 'vtt', 'srt', 'mka', '3gp', '3g2'
  ];

  const MIME_OK = [
    /^audio\//i,
    /^video\//i,
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
  const qExtRe = /[?&#](?:file|filename|name|url|src|media|video|audio|download|path)=([^&#]+)/i;
  const qMimeRe = /[?&#](?:mime|mimetype|type)=([^&#]+)/i;
  const STORAGE_KEY = '__mf_state_v1__';
  const PAGE_URL = (() => { try { const u = new URL(location.href); u.hash = ''; return u.href; } catch { return location.href; } })();
  const tsSeen = new Set();

  const found = new Map(); // url -> {ts, from:Set, mime?, size?, note?}
  const players = new Map(); // el -> {tag, src, last, why:Set}
  const srcSeen = new Set();

  let ui = null;
  let uiOpen = false;
  let lastToast = 0;
  let previewState = { url: '', sig: '' };
  let hotkeyHooked = false;

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
      tip: 'Tip: press play on the page; HLS/DASH often shows as .m3u8/.mpd.',
      noneYet: 'No links yet. Press play and wait a second.',
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
      tip: 'Съвет: пусни видео/аудио; HLS/DASH често са .m3u8/.mpd.',
      noneYet: 'Още няма линкове. Пусни медия и изчакай секунда.',
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
    const okFilter = new Set(['all', 'audio', 'video', 'playlist', 'subs', 'other']);
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

  function guessType(u, mime) {
    const lower = String(u || '').toLowerCase();
    let ct = String(mime || '').toLowerCase();

    if (!ct) {
      const qm = lower.match(qMimeRe);
      if (qm && qm[1]) ct = safeDecode(qm[1]).toLowerCase();
    }

    if (ct.includes('mpegurl') || lower.includes('.m3u8')) return 'playlist';
    if (ct.includes('dash+xml') || lower.includes('.mpd')) return 'playlist';
    if (ct.includes('mp2t')) return 'video';

    if (ct.includes('vtt') || lower.includes('.vtt') || lower.includes('.srt')) return 'subs';

    if (ct.startsWith('audio/')) return 'audio';
    if (ct.startsWith('video/')) return 'video';

    const ext = (lower.match(extRe) || [])[2];
    if (!ext) return 'other';

    if (['mp3', 'm4a', 'wav', 'flac', 'aac', 'opus', 'oga', 'ogg'].includes(ext)) return 'audio';
    if (['mp4', 'm4v', 'webm', 'mov', 'mkv', 'avi', 'flv', '3gp', '3g2', 'ogv', 'ts', 'm4s'].includes(ext)) return 'video';
    if (['m3u8', 'mpd'].includes(ext)) return 'playlist';
    if (['vtt', 'srt'].includes(ext)) return 'subs';
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

    if (!looksLikeMedia(u) && !okMime) return;

    const tsSeg = isTsSegment(u);
    if (tsSeg) {
      const key = tsKey(u);
      if (tsSeen.has(key)) return;
      tsSeen.add(key);
    }

    if (!found.has(u)) {
      if (found.size >= CFG.maxItems) return;
      found.set(u, { ts: now(), from: new Set(), mime: mime || '', size: meta?.size || 0, note: meta?.note || (tsSeg ? 'segment' : '') });
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

    scheduleRender();
    maybeToast();
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
      const nodes = document.querySelectorAll('video,audio,source,[src],[href],[data-src],[data-href]');
      nodes.forEach(n => {
        const tg = n.tagName?.toLowerCase();
        if (tg === 'video' || tg === 'audio') trackPlayer(n, 'dom');

        ['src', 'href', 'data-src', 'data-href'].forEach(a => {
          const v = n.getAttribute && n.getAttribute(a);
          if (v) add(v, { from: 'dom:' + a });
        });
      });
    } catch { }
  }

  function observeResources() {
    const take = (name, initiatorType) => add(name, { from: 'perf:' + (initiatorType || 'resource') });

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

      if (/^\s*#EXTM3U/i.test(txt) || /<MPD[\s>]/i.test(txt) || /#EXT-X/i.test(txt)) {
        add(url, { from: 'sniff:playlist', mime: mime, note: 'playlist' });

        const base = new URL(url, location.href);
        const lines = txt.split(/\r?\n/).map(s => s.trim()).filter(Boolean);

        for (const ln of lines) {
          if (!ln || ln.startsWith('#')) continue;
          if (/^data:/i.test(ln)) continue;
          let abs = null;
          try { abs = new URL(ln, base.href).href; } catch { abs = null; }
          if (abs) add(abs, { from: 'playlist:child' });
        }
      }
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

          if (nurl) {
            add(nurl, { from: 'fetch', mime: ct, size: len });
            await sniffMaybePlaylist(nurl, ct, resp);
          }
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
            const u = this.__mf_url || '';
            if (!u) return;

            let ct = '';
            try { ct = this.getResponseHeader('content-type') || ''; } catch { }
            let len = 0;
            try { len = Number(this.getResponseHeader('content-length')) || 0; } catch { }

            add(u, { from: 'xhr', mime: ct, size: len });
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
        if (n === 'src' || n === 'href' || n === 'data-src' || n === 'data-href') {
          add(value, { from: 'attr:' + n });
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
      .mf_preview audio {
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
        top: 0;
        align-self: start;
        background: rgba(2,6,23,.7);
        border: 1px solid rgba(148,163,184,.2);
        border-radius: 14px;
        padding: 10px;
        min-height: 140px;
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
      .mf_preview_player audio {
        width: 100%;
        max-height: 320px;
        border-radius: 10px;
        background: #0b1220;
      }
      .mf_preview_empty { font: 12px system-ui,-apple-system,"Segoe UI",sans-serif; opacity:.72; }
      @media (max-width: 860px) {
        .mf_split { grid-template-columns: 1fr; }
        .mf_previewpanel { position: relative; top: auto; }
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
    ui.clear.onclick = () => { found.clear(); srcSeen.clear(); state.previewUrl = ''; state.previewType = ''; previewState = { url: '', sig: '' }; renderAll(); };
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
      const type = guessType(url, meta.mime);
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
        it.type === 'audio' ? t('filterAudio') :
          it.type === 'video' ? t('filterVideo') :
            it.type === 'playlist' ? t('filterPlaylists') :
              it.type === 'subs' ? t('filterSubs') : t('filterOther');

      const mime = meta.mime ? clip(meta.mime, 70) : t('unknown');
      const size = meta.size ? formatBytes(meta.size) : t('unknown');
      const from = meta.from && meta.from.size ? Array.from(meta.from).join(', ') : '';
      const note = meta.note ? meta.note : t('unknown');
      const canPreview = (it.type === 'audio' || it.type === 'video') && !isTsSegment(it.url);
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
      const type = state.previewType || guessType(url, meta.mime);
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
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = guessFileName(url);
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

  function togglePreview(url, type) {
    try {
      const same = state.previewUrl === url;
      if (same) {
        clearPreviewSelection();
      } else {
        state.previewUrl = url;
        state.previewType = type || guessType(url, found.get(url)?.mime);
      }
      renderList();
    } catch { }
  }

  function buildPreviewEl(type, url) {
    const lower = String(type || '').toLowerCase();
    try {
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
    const cleanup = () => {
      try {
        if (el.__mf_blob) URL.revokeObjectURL(el.__mf_blob);
      } catch {}
      try { el.__mf_blob = null; } catch {}
      try { el.__mf_abort?.abort(); } catch {}
      try { el.__mf_abort = null; } catch {}
    };
    cleanup();

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
      root.querySelectorAll('audio,video').forEach(m => {
        try { m.pause(); } catch { }
        try { m.__mf_cleanup?.(); } catch {}
      });
    } catch { }
  }

  function buildListHtml() {
    const items = listItems();
    const rows = items.map(it => {
      const meta = it.meta || {};
      const type = guessType(it.url, meta.mime);
      const badge =
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

    try { mo.observe(document.documentElement || document, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'href', 'data-src', 'data-href'] }); } catch { }
  }

  function start() {
    patchFetch();
    patchXHR();
    patchMediaSource();
    patchSetSrcAttr();

    observeResources();
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

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
