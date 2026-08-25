// ==UserScript==
// @name         Discord Bulk Message Deleter
// @namespace    http://tampermonkey.net/
// @version      2.1.1
// @description  Reliably delete your own Discord messages from the current channel with retries, rate-limit handling, and a draggable UI.
// @author       You
// @match        https://discord.com/*
// @grant        none
// ==/UserScript==

(() => {
  'use strict';
  if (window.__DBD_V21_LOADED__) return;
  window.__DBD_V21_LOADED__ = true;

  const API = 'https://discord.com/api/v10';
  const STORE = 'dbd:v2:settings';
  const MAX_LOG = 250;
  const RETRIES = 5;
  const MARGIN = 8;
  const state = { running:false, abort:null, deleted:0, failed:0, scanned:0, before:null, token:null, user:null };
  const $ = id => document.getElementById(id);

  const sleep = (ms, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once:true });
  });

  const css = document.createElement('style');
  css.textContent = `
#dbd-panel,#dbd-toggle{font-family:"gg sans","Noto Sans","Segoe UI",sans-serif;-webkit-font-smoothing:antialiased;box-sizing:border-box}
#dbd-panel *,#dbd-toggle *{box-sizing:border-box}
#dbd-panel{position:fixed;left:50%;top:96px;z-index:2147483647;width:min(390px,calc(100vw - 24px));max-height:calc(100vh - 16px);display:none;overflow:hidden;color:#dbdee1;background:linear-gradient(180deg,#232428,#1e1f22);border:1px solid rgba(255,255,255,.08);border-radius:16px;box-shadow:0 18px 48px rgba(0,0,0,.48),0 2px 10px rgba(0,0,0,.28)}
#dbd-dragbar{display:flex;align-items:center;gap:10px;padding:13px 14px;background:rgba(17,18,20,.75);border-bottom:1px solid rgba(255,255,255,.07);cursor:grab;user-select:none;touch-action:none}#dbd-dragbar:active{cursor:grabbing}
.dbd-icon{display:grid;place-items:center;width:34px;height:34px;flex:0 0 34px;border-radius:10px;background:#5865f2;color:#fff;font-size:17px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.1)}
.dbd-titlebox{min-width:0;flex:1}.dbd-title{color:#fff;font-size:14px;font-weight:800;line-height:1.15}.dbd-subtitle{margin-top:3px;color:#949ba4;font-size:10px;line-height:1.25}
#dbd-close{display:grid;place-items:center;width:32px;height:32px;flex:0 0 32px;padding:0;border:0;border-radius:8px;color:#949ba4;background:transparent;cursor:pointer;font-size:18px}#dbd-close:hover{color:#fff;background:rgba(255,255,255,.07)}
.dbd-body{max-height:calc(100vh - 78px);padding:14px;overflow-y:auto}.dbd-body::-webkit-scrollbar,#dbd-log::-webkit-scrollbar{width:8px}.dbd-body::-webkit-scrollbar-thumb,#dbd-log::-webkit-scrollbar-thumb{background:#2b2d31;border-radius:8px}
.dbd-section{padding:12px;margin-bottom:10px;background:rgba(43,45,49,.76);border:1px solid rgba(255,255,255,.055);border-radius:12px}.dbd-section-title{margin:0 0 10px;color:#b5bac1;font-size:10px;font-weight:800;letter-spacing:.7px;text-transform:uppercase}
.dbd-row{margin-bottom:10px}.dbd-row:last-child{margin-bottom:0}.dbd-row label{display:flex;justify-content:space-between;gap:8px;margin-bottom:6px;color:#b5bac1;font-size:11px;font-weight:650}.dbd-hint{color:#6d6f78;font-size:9px;font-weight:500}.dbd-wrap{display:flex;align-items:center;gap:7px}
.dbd-input,.dbd-auto{border:1px solid #3f4147;border-radius:8px;background:#1e1f22;color:#dbdee1}.dbd-input{min-width:0;width:100%;height:36px;padding:0 10px;outline:none;font-size:12px}.dbd-input:focus{border-color:#5865f2;box-shadow:0 0 0 2px rgba(88,101,242,.16)}.dbd-input:disabled,.dbd-auto:disabled{opacity:.55;cursor:not-allowed}.dbd-auto{height:36px;padding:0 11px;cursor:pointer;font-size:10px;font-weight:800}.dbd-auto:hover{background:#35373c}
.dbd-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:10px}.dbd-stat{min-width:0;padding:10px 7px;text-align:center;background:#17181a;border:1px solid rgba(255,255,255,.055);border-radius:10px}.dbd-stat strong{display:block;color:#f2f3f5;font-size:17px;font-weight:800;line-height:1.1;overflow:hidden;text-overflow:ellipsis}.dbd-stat span{display:block;margin-top:3px;color:#80848e;font-size:8px;font-weight:800;letter-spacing:.55px;text-transform:uppercase}
.dbd-actions{display:grid;gap:7px}.dbd-main{width:100%;min-height:40px;padding:9px 12px;border:0;border-radius:9px;color:#fff;font-size:12px;font-weight:800;cursor:pointer}.dbd-main:active{transform:translateY(1px)}#dbd-start{background:#5865f2}#dbd-start:hover{background:#4752c4}#dbd-stop{display:none;background:#da373c}#dbd-stop:hover{background:#b72d32}
.dbd-loghead{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:12px 2px 6px}.dbd-loghead>span:first-child{color:#b5bac1;font-size:10px;font-weight:800;letter-spacing:.65px;text-transform:uppercase}#dbd-status{max-width:65%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#80848e;font-size:9px}
#dbd-log{height:134px;padding:9px 10px;overflow-y:auto;white-space:pre-wrap;word-break:break-word;color:#b5bac1;background:#111214;border:1px solid rgba(255,255,255,.05);border-radius:10px;font:10.5px/1.5 Consolas,"Cascadia Mono",monospace}.dbd-log-error{color:#f23f42}.dbd-log-warn{color:#f0b232}.dbd-log-ok{color:#23a559}.dbd-note{margin-top:6px;color:#80848e;font-size:9px;line-height:1.4}
#dbd-toggle{position:fixed;left:20px;top:120px;z-index:2147483647;display:flex;align-items:center;gap:8px;min-width:48px;height:48px;padding:0 13px;border:1px solid rgba(255,255,255,.1);border-radius:14px;color:#fff;background:#5865f2;box-shadow:0 8px 22px rgba(0,0,0,.38);cursor:grab;user-select:none;touch-action:none;font-size:17px;font-weight:800}#dbd-toggle:active{cursor:grabbing}#dbd-toggle:hover{background:#4752c4}.dbd-toggle-text{font-size:11px;white-space:nowrap}
@media(max-width:520px){#dbd-panel{width:calc(100vw - 16px)}.dbd-body{padding:10px}.dbd-section{padding:10px}#dbd-toggle{min-width:46px;height:46px;padding:0 12px}.dbd-toggle-text{display:none}}
`;
  document.head.appendChild(css);

  const toggle = document.createElement('button');
  toggle.id = 'dbd-toggle';
  toggle.type = 'button';
  toggle.title = 'Drag to move · Click to open';
  toggle.innerHTML = '<span aria-hidden="true">🗑️</span><span class="dbd-toggle-text">Bulk delete</span>';
  document.body.appendChild(toggle);

  const panel = document.createElement('div');
  panel.id = 'dbd-panel';
  panel.innerHTML = `
<div id="dbd-dragbar" title="Drag to move">
  <div class="dbd-icon" aria-hidden="true">🗑️</div>
  <div class="dbd-titlebox"><div class="dbd-title">Bulk Message Deleter</div><div class="dbd-subtitle">Delete your own messages from the current channel</div></div>
  <button id="dbd-close" type="button" aria-label="Close">×</button>
</div>
<div class="dbd-body">
  <div class="dbd-section"><div class="dbd-section-title">Target</div><div class="dbd-row"><label for="dbd-channel"><span>Channel ID</span><span class="dbd-hint">auto-detected</span></label><div class="dbd-wrap"><input class="dbd-input" id="dbd-channel" type="text" inputmode="numeric" placeholder="Open a Discord channel or DM"><button class="dbd-auto" id="dbd-detect" type="button">Detect</button></div></div></div>
  <div class="dbd-section"><div class="dbd-section-title">Timing</div><div class="dbd-row"><label for="dbd-delay"><span>Delay between deletes</span><span class="dbd-hint">milliseconds</span></label><input class="dbd-input" id="dbd-delay" type="number" value="900" min="250" max="60000" step="50"></div><div class="dbd-row"><label for="dbd-floor"><span>Minimum rate-limit wait</span><span class="dbd-hint">seconds</span></label><input class="dbd-input" id="dbd-floor" type="number" value="2" min="1" max="300" step="1"><div class="dbd-note">Discord's retry_after value still takes priority. This only acts as a minimum fallback.</div></div></div>
  <div class="dbd-stats"><div class="dbd-stat"><strong id="dbd-scanned">0</strong><span>Scanned</span></div><div class="dbd-stat"><strong id="dbd-deleted">0</strong><span>Deleted</span></div><div class="dbd-stat"><strong id="dbd-failed">0</strong><span>Failed</span></div></div>
  <div class="dbd-actions"><button id="dbd-start" class="dbd-main" type="button">Start deleting my messages</button><button id="dbd-stop" class="dbd-main" type="button">Stop deletion</button></div>
  <div class="dbd-loghead"><span>Activity</span><span id="dbd-status">Ready</span></div><div id="dbd-log" role="log" aria-live="polite"></div>
</div>`;
  document.body.appendChild(panel);

  const inputs = [$('dbd-channel'), $('dbd-delay'), $('dbd-floor'), $('dbd-detect')];
  const readStore = () => { try { const value = JSON.parse(localStorage.getItem(STORE) || '{}'); return value && typeof value === 'object' ? value : {}; } catch { return {}; } };
  const writeStore = patch => { try { localStorage.setItem(STORE, JSON.stringify({ ...readStore(), ...patch })); } catch {} };

  function log(message, type='') {
    const box = $('dbd-log');
    $('dbd-status').textContent = type === 'error' ? 'Error' : type === 'warn' ? 'Waiting' : type === 'ok' ? 'Active' : 'Working';
    const line = document.createElement('div');
    if (type) line.className = `dbd-log-${type}`;
    line.textContent = message;
    box.appendChild(line);
    while (box.childNodes.length > MAX_LOG) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
  }

  function updateStats() {
    $('dbd-scanned').textContent = String(state.scanned);
    $('dbd-deleted').textContent = String(state.deleted);
    $('dbd-failed').textContent = String(state.failed);
  }

  function setRunning(value) {
    state.running = value;
    $('dbd-status').textContent = value ? 'Running' : 'Ready';
    $('dbd-start').style.display = value ? 'none' : 'block';
    $('dbd-stop').style.display = value ? 'block' : 'none';
    inputs.forEach(input => input.disabled = value);
  }

  function delay() {
    const input = Math.trunc(Number($('dbd-delay').value));
    const value = Number.isFinite(input) ? Math.min(Math.max(input, 250), 60000) : 900;
    $('dbd-delay').value = String(value);
    return value;
  }

  function rateFloor() {
    const input = Number($('dbd-floor').value);
    const value = Number.isFinite(input) ? Math.min(Math.max(input, 1), 300) : 2;
    $('dbd-floor').value = String(value);
    return value * 1000;
  }

  function savePrefs() { writeStore({ delay:delay(), rateFloor:rateFloor() / 1000 }); }
  function channelFromUrl() { return location.pathname.match(/^\/channels\/(?:@me|\d+)\/(\d+)/)?.[1] || null; }
  function snowflake(value) { value = String(value || '').trim(); return /^\d{15,22}$/.test(value) ? value : null; }

  function tokenFromOriginalIframe() {
    let iframe;
    try {
      iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      document.body.appendChild(iframe);
      const raw = iframe.contentWindow.localStorage.token;
      return raw ? String(raw).replace(/"/g, '') : null;
    } catch {
      return null;
    } finally {
      iframe?.remove();
    }
  }

  function tokenFromWebpack() {
    try {
      const chunks = window.webpackChunkdiscord_app;
      if (!Array.isArray(chunks)) return null;
      let req;
      chunks.push([[Symbol('dbd')], {}, runtime => { req = runtime; }]);
      chunks.pop();
      if (!req?.c) return null;
      for (const mod of Object.values(req.c)) {
        const exports = mod?.exports;
        if (!exports) continue;
        for (const candidate of [exports, exports.default, exports.Z, exports.ZP]) {
          if (!candidate || typeof candidate.getToken !== 'function') continue;
          try {
            const token = candidate.getToken();
            if (typeof token === 'string' && token.length > 20) return token;
          } catch {}
        }
      }
    } catch {}
    return null;
  }

  function tokenFromDirectStorage() {
    try {
      const raw = localStorage.getItem('token');
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw);
        return typeof parsed === 'string' ? parsed : null;
      } catch {
        return String(raw).replace(/"/g, '');
      }
    } catch {
      return null;
    }
  }

  const getToken = () => tokenFromOriginalIframe() || tokenFromWebpack() || tokenFromDirectStorage();

  async function responseBody(response) {
    const text = await response.text().catch(() => '');
    if (!text) return null;
    try { return JSON.parse(text); } catch { return text; }
  }

  function retryMs(response, body) {
    let ms = 0;
    if (body && typeof body === 'object' && Number.isFinite(Number(body.retry_after))) {
      const retry = Number(body.retry_after);
      ms = Math.max(ms, retry > 1000 ? retry : retry * 1000);
    }
    const header = Number(response.headers.get('Retry-After'));
    if (Number.isFinite(header)) ms = Math.max(ms, header * 1000);
    const reset = Number(response.headers.get('X-RateLimit-Reset-After'));
    if (Number.isFinite(reset)) ms = Math.max(ms, reset * 1000);
    return Math.max(ms, rateFloor()) + 250;
  }

  async function request(path, options={}) {
    const signal = state.abort?.signal;
    let lastError;
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      try {
        const response = await fetch(API + path, {
          ...options,
          signal,
          headers: { Authorization:state.token, ...(options.headers || {}) }
        });
        const body = await responseBody(response);
        if (response.status === 429) {
          const wait = retryMs(response, body);
          log(`Rate limited. Waiting ${(wait / 1000).toFixed(1)}s...`, 'warn');
          await sleep(wait, signal);
          continue;
        }
        if (response.status >= 500 && response.status <= 599 && attempt < RETRIES) {
          const wait = Math.min(1000 * (2 ** attempt), 15000) + Math.random() * 300;
          log(`Discord returned HTTP ${response.status}. Retrying...`, 'warn');
          await sleep(wait, signal);
          continue;
        }
        return { response, body };
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        lastError = error;
        if (attempt >= RETRIES) break;
        const wait = Math.min(750 * (2 ** attempt), 10000) + Math.random() * 250;
        log('Network error. Retrying...', 'warn');
        await sleep(wait, signal);
      }
    }
    throw lastError || new Error('Request failed after retries');
  }

  async function currentUser() {
    const { response, body } = await request('/users/@me');
    if (response.status === 401) throw new Error('Discord rejected the session token (HTTP 401). Reload Discord and try again.');
    if (!response.ok) throw new Error(`Could not identify the current account (HTTP ${response.status}${body?.message ? `: ${body.message}` : ''}).`);
    return body;
  }

  function preview(message) {
    let content = typeof message?.content === 'string' ? message.content.replace(/\s+/g, ' ').trim() : '';
    if (!content) content = message?.attachments?.length ? '[attachment]' : message?.embeds?.length ? '[embed]' : '[empty message]';
    return content.length > 52 ? content.slice(0, 49) + '...' : content;
  }

  async function removeMessage(channel, message) {
    const { response, body } = await request(`/channels/${channel}/messages/${message.id}`, { method:'DELETE' });
    if (response.status === 204 || response.status === 404) return true;
    if (response.status === 401) throw new Error('Authorization expired while deleting (HTTP 401). Reload Discord and try again.');
    if (response.status === 403) {
      log(`Skipped ${message.id}: Discord refused deletion (HTTP 403).`, 'warn');
      return false;
    }
    log(`Failed ${message.id}: HTTP ${response.status}${body?.message ? ` — ${body.message}` : ''}`, 'error');
    return false;
  }

  async function run() {
    if (state.running) return;
    $('dbd-log').textContent = '';
    Object.assign(state, { deleted:0, failed:0, scanned:0, before:null });
    updateStats();

    const channel = snowflake($('dbd-channel').value) || channelFromUrl();
    if (!channel) return log('No valid channel ID. Open a Discord channel/DM or enter its ID.', 'error');
    $('dbd-channel').value = channel;
    savePrefs();

    state.token = getToken();
    if (!state.token) return log('Could not obtain the active Discord session token. Reload Discord and retry.', 'error');

    state.abort = new AbortController();
    setRunning(true);
    try {
      state.user = await currentUser();
      log(`Account: ${state.user.username} (${state.user.id})`, 'ok');
      log(`Scanning channel ${channel} newest → oldest...`);

      while (state.running) {
        const params = new URLSearchParams({ limit:'100' });
        if (state.before) params.set('before', state.before);
        const { response, body } = await request(`/channels/${channel}/messages?${params}`);
        if (response.status === 401) throw new Error('Authorization expired while scanning (HTTP 401).');
        if (response.status === 403) throw new Error('Discord denied access to this channel (HTTP 403).');
        if (response.status === 404) throw new Error('Channel not found or unavailable (HTTP 404).');
        if (!response.ok) throw new Error(`Scan failed (HTTP ${response.status}${body?.message ? `: ${body.message}` : ''}).`);
        if (!Array.isArray(body)) throw new Error('Discord returned an unexpected message-list response.');
        if (!body.length) {
          log(`Finished. Deleted ${state.deleted}; failed ${state.failed}.`, 'ok');
          break;
        }

        state.before = body.at(-1).id;
        state.scanned += body.length;
        updateStats();

        for (const message of body.filter(item => item?.author?.id === state.user.id)) {
          if (!state.running) break;
          if (await removeMessage(channel, message)) {
            state.deleted++;
            log(`Deleted #${state.deleted}: ${preview(message)}`, 'ok');
          } else {
            state.failed++;
          }
          updateStats();
          if (state.running) await sleep(delay(), state.abort.signal);
        }
      }
    } catch (error) {
      const stopped = error?.name === 'AbortError';
      log(stopped ? 'Stopped.' : (error?.message || String(error)), stopped ? 'warn' : 'error');
    } finally {
      state.running = false;
      state.abort = null;
      setRunning(false);
    }
  }

  function detect(quiet=false) {
    const id = channelFromUrl();
    if (id) {
      $('dbd-channel').value = id;
      if (!quiet) log(`Detected channel ${id}.`, 'ok');
      return true;
    }
    if (!quiet) log('Could not detect a channel from the current URL.', 'error');
    return false;
  }

  function clamp(element, x, y) {
    const rect = element.getBoundingClientRect();
    const maxX = Math.max(MARGIN, innerWidth - rect.width - MARGIN);
    const maxY = Math.max(MARGIN, innerHeight - rect.height - MARGIN);
    return {
      x:Math.min(Math.max(Number.isFinite(x) ? x : MARGIN, MARGIN), maxX),
      y:Math.min(Math.max(Number.isFinite(y) ? y : MARGIN, MARGIN), maxY)
    };
  }

  function position(element, x, y) {
    const point = clamp(element, x, y);
    Object.assign(element.style, {
      left:`${Math.round(point.x)}px`, top:`${Math.round(point.y)}px`, right:'auto', bottom:'auto', transform:'none'
    });
    return point;
  }

  function restore(element, saved, fallback) {
    if (saved && Number.isFinite(Number(saved.x)) && Number.isFinite(Number(saved.y))) return position(element, Number(saved.x), Number(saved.y));
    if (fallback) return position(element, fallback.x, fallback.y);
    requestAnimationFrame(() => {
      const rect = element.getBoundingClientRect();
      position(element, (innerWidth - rect.width) / 2, 96);
    });
  }

  function persist(element, key) {
    const rect = element.getBoundingClientRect();
    writeStore({ [key]:{ x:Math.round(rect.left), y:Math.round(rect.top) } });
  }

  function draggable(element, handle, key, suppressClick=false) {
    let drag = null;
    let moved = false;
    let suppress = false;

    handle.addEventListener('pointerdown', event => {
      if (event.button !== undefined && event.button !== 0) return;
      const interactive = event.target.closest('button,input,select,textarea,a');
      if (interactive && interactive !== handle) return;
      const rect = element.getBoundingClientRect();
      drag = { id:event.pointerId, x:event.clientX, y:event.clientY, left:rect.left, top:rect.top };
      moved = false;
      handle.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });

    handle.addEventListener('pointermove', event => {
      if (!drag || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      moved = true;
      position(element, drag.left + dx, drag.top + dy);
      event.preventDefault();
    });

    const end = event => {
      if (!drag || event.pointerId !== drag.id) return;
      if (moved) {
        persist(element, key);
        if (suppressClick) suppress = true;
      }
      try { handle.releasePointerCapture?.(event.pointerId); } catch {}
      drag = null;
      event.preventDefault();
    };

    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    return () => {
      if (!suppress) return false;
      suppress = false;
      return true;
    };
  }

  const saved = readStore();
  if (saved.delay != null) $('dbd-delay').value = String(saved.delay);
  if (saved.rateFloor != null) $('dbd-floor').value = String(saved.rateFloor);
  restore(toggle, saved.togglePosition, { x:20, y:120 });
  const consumeDrag = draggable(toggle, toggle, 'togglePosition', true);
  draggable(panel, $('dbd-dragbar'), 'panelPosition');

  $('dbd-close').addEventListener('click', () => { panel.style.display = 'none'; toggle.style.display = 'flex'; });
  toggle.addEventListener('click', () => {
    if (consumeDrag()) return;
    panel.style.display = 'block';
    toggle.style.display = 'none';
    restore(panel, readStore().panelPosition, null);
    if (!state.running) detect(true);
  });
  $('dbd-detect').addEventListener('click', () => detect(false));
  $('dbd-start').addEventListener('click', run);
  $('dbd-stop').addEventListener('click', () => {
    if (state.running) {
      state.running = false;
      state.abort?.abort();
    }
  });
  $('dbd-delay').addEventListener('change', savePrefs);
  $('dbd-floor').addEventListener('change', savePrefs);

  addEventListener('resize', () => {
    if (toggle.style.display !== 'none') {
      const rect = toggle.getBoundingClientRect();
      position(toggle, rect.left, rect.top);
      persist(toggle, 'togglePosition');
    }
    if (panel.style.display !== 'none') {
      const rect = panel.getBoundingClientRect();
      position(panel, rect.left, rect.top);
      persist(panel, 'panelPosition');
    }
  });

  let lastPath = location.pathname;
  new MutationObserver(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      if (!state.running) detect(true);
    }
  }).observe(document.documentElement, { childList:true, subtree:true });

  detect(true);
  log('Ready. Drag the launcher anywhere, open it, then press Start deleting my messages.');
})();
