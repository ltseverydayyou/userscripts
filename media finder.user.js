// ==UserScript==
// @name         Media Finder (stable players + top toast + safe)
// @namespace    http://tampermonkey.net/
// @version      0.8
// @description  Finds mp3/mp4/m3u8/etc without breaking sites; stable player detection; top toast; opens list on click
// @match        *://*/*
// @run-at       document-start
// @grant        GM_openInTab
// ==/UserScript==

(function () {
  'use strict';

  const exts = ['mp3','mp4','m4a','m4v','webm','ogg','ogv','oga','wav','flac','mov','mkv','avi','flv','m3u8','mpd'];
  const extRe = new RegExp('\\.(' + exts.join('|') + ')(\\?|#|$)', 'i');

  const found = new Set();

  const pl = new Map();
  const srcSeen = new Set();

  let toastEl = null;
  let msgEl = null;
  let btnEl = null;
  let updT = null;
  let listUrl = null;

  function norm(u) {
    if (!u) return null;
    u = String(u).trim();
    if (!u) return null;
    if (u.startsWith('//')) u = location.protocol + u;
    else if (u.startsWith('/')) u = location.origin + u;
    if (!/^https?:|^blob:|^data:/i.test(u)) {
      try { u = new URL(u, location.href).href; } catch { return null; }
    }
    return u;
  }

  function add(raw) {
    const u = norm(raw);
    if (!u) return;
    if (!extRe.test(u)) return;
    if (found.has(u)) return;
    found.add(u);
    scheduleUpdate();
  }

  function getMediaSrc(el) {
    try {
      return el.currentSrc || el.src || el.getAttribute('src') || '';
    } catch {
      return '';
    }
  }

  function trackPlayer(el, why) {
    const t = el?.tagName?.toLowerCase();
    if (t !== 'video' && t !== 'audio') return;

    const cur = getMediaSrc(el);
    const src = cur ? (norm(cur) || cur) : '';

    let info = pl.get(el);
    if (!info) {
      info = { tag: t, why: new Set(), src: '', last: 0 };
      pl.set(el, info);
    }

    if (why) info.why.add(why);

    if (src && src !== info.src) {
      info.src = src;
      info.last = Date.now();

      if (!srcSeen.has(src)) {
        srcSeen.add(src);
        add(src);
      }
    }

    scheduleUpdate();
  }

  function cleanupPlayers() {
    const now = Date.now();
    for (const [el, info] of pl) {
      if (!el || !el.isConnected) {
        pl.delete(el);
        continue;
      }
      if (info && info.src && now - (info.last || 0) > 300000) info.last = now;
    }
    scheduleUpdate();
  }

  function scanDom() {
    try {
      const nodes = document.querySelectorAll('video,audio,source,[src],[href],[data-src],[data-href]');
      nodes.forEach(n => {
        const t = n.tagName?.toLowerCase();
        if (t === 'video' || t === 'audio') trackPlayer(n, 'dom');

        ['src','href','data-src','data-href'].forEach(a => {
          const v = n.getAttribute && n.getAttribute(a);
          if (v) add(v);
        });
      });
    } catch {}
  }

  function observeResources() {
    const take = (name) => add(name);

    try { performance.getEntriesByType('resource').forEach(e => take(e.name)); } catch {}

    try {
      const po = new PerformanceObserver(list => {
        try { for (const e of list.getEntries()) take(e.name); } catch {}
      });
      po.observe({ type: 'resource', buffered: true });
    } catch {}
  }

  function ensureToast() {
    if (toastEl) return;

    const make = () => {
      if (toastEl) return;

      const wrap = document.createElement('div');
      wrap.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:2147483647;display:flex;justify-content:center;pointer-events:none;';

      const bar = document.createElement('div');
      bar.style.cssText =
        'margin:10px;max-width:980px;width:calc(100% - 20px);' +
        'background:#0b1220;border:1px solid #334155;border-radius:10px;' +
        'box-shadow:0 10px 30px rgba(0,0,0,.35);' +
        'padding:10px 12px;display:flex;gap:10px;align-items:center;' +
        'pointer-events:auto;color:#e5e7eb;font:13px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;';

      const msg = document.createElement('div');
      msg.style.cssText = 'flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
      msg.textContent = 'Media Finder: scanning…';

      const mkBtn = (t) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = t;
        b.style.cssText = 'background:#111827;color:#e5e7eb;border:1px solid #334155;border-radius:8px;padding:6px 10px;cursor:pointer;';
        return b;
      };

      const open = mkBtn('Open list');
      open.onclick = () => openList();

      const copy = mkBtn('Copy all');
      copy.onclick = () => copyAll();

      const x = mkBtn('Dismiss');
      x.onclick = () => wrap.remove();

      bar.appendChild(msg);
      bar.appendChild(open);
      bar.appendChild(copy);
      bar.appendChild(x);
      wrap.appendChild(bar);

      document.documentElement.appendChild(wrap);

      toastEl = wrap;
      msgEl = msg;
    };

    if (document.documentElement) make();
    else document.addEventListener('DOMContentLoaded', make, { once: true });
  }

  function ensureCornerBtn() {
    if (btnEl) return;

    const make = () => {
      if (btnEl) return;
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = 'Media';
      b.style.cssText =
        'position:fixed;right:10px;bottom:10px;z-index:2147483647;' +
        'background:#0b1220;color:#e5e7eb;border:1px solid #334155;border-radius:10px;' +
        'padding:8px 10px;cursor:pointer;font:12px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;opacity:.75;';
      b.onmouseenter = () => b.style.opacity = '1';
      b.onmouseleave = () => b.style.opacity = '.75';
      b.onclick = () => { ensureToast(); openList(); };
      document.documentElement.appendChild(b);
      btnEl = b;
    };

    if (document.documentElement) make();
    else document.addEventListener('DOMContentLoaded', make, { once: true });
  }

  function scheduleUpdate() {
    if (updT) return;
    updT = setTimeout(() => {
      updT = null;

      if (!found.size && !pl.size) return;

      ensureCornerBtn();
      ensureToast();

      if (msgEl) {
        msgEl.textContent = `Media found: ${found.size} link(s) • Players: ${pl.size} (unique)`;
      }

      listUrl = null;
    }, 300);
  }

  function buildListUrl() {
    const urls = Array.from(found);

    const uniqSrc = [];
    for (const [, info] of pl) {
      if (info?.src && extRe.test(info.src)) uniqSrc.push(info.src);
    }

    const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');

    const playerItems = uniqSrc.slice(0, 80).map(u => {
      const e = esc(u);
      return `<li><a href="${e}" target="_blank" rel="noreferrer noopener">${e}</a></li>`;
    }).join('');

    const urlItems = urls.map(u => {
      const e = esc(u);
      return `<li><a href="${e}" target="_blank" rel="noreferrer noopener">${e}</a></li>`;
    }).join('');

    const html =
`<!doctype html><html><head><meta charset="utf-8">
<title>Media Finder Results</title>
<style>
body{background:#020617;color:#e5e7eb;font:13px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:12px;}
a{color:#38bdf8;word-break:break-all;}
code{color:#e5e7eb;background:#111827;padding:2px 4px;border-radius:4px;}
h1{font-size:18px;margin:0 0 10px 0;}
h2{font-size:14px;margin:14px 0 8px 0;}
</style></head><body>
<h1>Found ${urls.length} media URL${urls.length === 1 ? '' : 's'}</h1>
<p>Zoom commonly uses <code>.m3u8</code> (HLS) or <code>.mpd</code> (DASH).</p>
<h2>Unique player sources (${uniqSrc.length})</h2>
<ul>${playerItems || '<li>(none)</li>'}</ul>
<h2>All captured URLs (${urls.length})</h2>
<ul>${urlItems || '<li>(none)</li>'}</ul>
</body></html>`;

    try {
      const blob = new Blob([html], { type: 'text/html' });
      return URL.createObjectURL(blob);
    } catch {
      return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
    }
  }

  function openList() {
    if (!found.size) {
      ensureToast();
      if (msgEl) msgEl.textContent = 'Media Finder: no links yet (press play and wait a second).';
      return;
    }
    if (!listUrl) listUrl = buildListUrl();

    if (typeof GM_openInTab === 'function') {
      GM_openInTab(listUrl, { active: false, insert: true, setParent: true });
    } else {
      window.open(listUrl, '_blank', 'noopener,noreferrer');
    }
  }

  async function copyAll() {
    const txt = Array.from(found).join('\n');
    try {
      await navigator.clipboard.writeText(txt);
      ensureToast();
      if (msgEl) msgEl.textContent = `Copied ${found.size} link(s)`;
    } catch {
      ensureToast();
      if (msgEl) msgEl.textContent = 'Clipboard blocked — use Open list';
    }
  }

  function watchPlayers() {
    const h = (e) => {
      const t = e?.target;
      if (t && (t.tagName === 'VIDEO' || t.tagName === 'AUDIO')) trackPlayer(t, 'event:' + e.type);
    };
    document.addEventListener('play', h, true);
    document.addEventListener('loadedmetadata', h, true);

    let moT = null;
    const mo = new MutationObserver(() => {
      if (moT) return;
      moT = setTimeout(() => {
        moT = null;
        scanDom();
        cleanupPlayers();
      }, 250);
    });

    try { mo.observe(document.documentElement || document, { childList: true, subtree: true }); } catch {}
  }

  function start() {
    observeResources();
    watchPlayers();
    scanDom();
    setInterval(cleanupPlayers, 3000);
    setTimeout(scanDom, 1200);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();