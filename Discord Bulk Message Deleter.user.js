// ==UserScript==
// @name         Discord Bulk Message Deleter
// @namespace    http://tampermonkey.net/
// @version      2.0.0
// @description  Reliably delete your own Discord messages from the current channel with cancellation, retries, and rate-limit handling.
// @author       You
// @match        https://discord.com/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  if (window.__DBD_V2_LOADED__) return;
  window.__DBD_V2_LOADED__ = true;

  const API = 'https://discord.com/api/v10';
  const STORAGE_KEY = 'dbd:v2:settings';
  const MAX_LOG_LINES = 250;
  const MAX_REQUEST_RETRIES = 5;

  const state = {
    running: false,
    abortController: null,
    deleted: 0,
    failed: 0,
    scanned: 0,
    lastMessageId: null,
    token: null,
    currentUser: null,
  };

  const sleep = (ms, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });

  const style = document.createElement('style');
  style.textContent = `
    #dbd-panel, #dbd-toggle { font-family: "gg sans", "Noto Sans", sans-serif; }
    #dbd-panel {
      position: fixed;
      right: 24px;
      bottom: 24px;
      z-index: 2147483647;
      width: 320px;
      box-sizing: border-box;
      padding: 16px;
      color: #dbdee1;
      background: #1e1f22;
      border: 1px solid #3f4147;
      border-radius: 12px;
      box-shadow: 0 8px 28px rgba(0,0,0,.45);
      display: none;
    }
    #dbd-panel * { box-sizing: border-box; }
    #dbd-panel h3 {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin: 0 0 14px;
      color: #fff;
      font-size: 14px;
    }
    .dbd-row { margin-bottom: 10px; }
    .dbd-row label {
      display: block;
      margin-bottom: 5px;
      color: #949ba4;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: .45px;
      text-transform: uppercase;
    }
    .dbd-input-wrap { display: flex; align-items: center; gap: 6px; }
    .dbd-input, .dbd-auto-btn {
      border: 1px solid #3f4147;
      border-radius: 6px;
      background: #2b2d31;
      color: #dbdee1;
    }
    .dbd-input {
      min-width: 0;
      width: 100%;
      padding: 7px 8px;
      outline: none;
      font-size: 12px;
    }
    .dbd-input:focus { border-color: #5865f2; }
    .dbd-input:disabled { opacity: .6; cursor: not-allowed; }
    .dbd-auto-btn {
      flex: 0 0 auto;
      padding: 7px 9px;
      cursor: pointer;
      font-size: 10px;
    }
    .dbd-auto-btn:hover { background: #35373c; }
    .dbd-stats {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 6px;
      margin: 12px 0;
    }
    .dbd-stat {
      padding: 8px 6px;
      text-align: center;
      background: #2b2d31;
      border-radius: 6px;
    }
    .dbd-stat strong { display: block; color: #fff; font-size: 14px; }
    .dbd-stat span { color: #949ba4; font-size: 9px; text-transform: uppercase; }
    .dbd-divider { border: 0; border-top: 1px solid #3f4147; margin: 12px 0; }
    .dbd-main {
      width: 100%;
      padding: 9px;
      margin-bottom: 6px;
      border: 0;
      border-radius: 6px;
      color: #fff;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
    }
    #dbd-start { background: #5865f2; }
    #dbd-start:hover { background: #4752c4; }
    #dbd-stop { display: none; background: #da373c; }
    #dbd-stop:hover { background: #a1282d; }
    #dbd-log {
      height: 126px;
      margin-top: 8px;
      padding: 8px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-word;
      color: #b5bac1;
      background: #111214;
      border-radius: 6px;
      font: 11px/1.45 Consolas, monospace;
    }
    .dbd-log-error { color: #f23f42; }
    .dbd-log-warn { color: #f0b232; }
    .dbd-log-ok { color: #23a559; }
    #dbd-toggle {
      position: fixed;
      right: 24px;
      bottom: 24px;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 48px;
      height: 48px;
      border: 0;
      border-radius: 50%;
      color: #fff;
      background: #5865f2;
      box-shadow: 0 4px 14px rgba(0,0,0,.4);
      cursor: pointer;
      font-size: 20px;
    }
    #dbd-toggle:hover { background: #4752c4; }
    #dbd-close {
      padding: 0;
      border: 0;
      color: #949ba4;
      background: transparent;
      cursor: pointer;
      font-size: 20px;
    }
    #dbd-close:hover { color: #fff; }
    .dbd-note { color: #949ba4; font-size: 10px; line-height: 1.35; margin-top: 5px; }
  `;
  document.head.appendChild(style);

  const toggleBtn = document.createElement('button');
  toggleBtn.id = 'dbd-toggle';
  toggleBtn.type = 'button';
  toggleBtn.title = 'Discord Bulk Message Deleter';
  toggleBtn.textContent = '🗑️';
  document.body.appendChild(toggleBtn);

  const panel = document.createElement('div');
  panel.id = 'dbd-panel';
  panel.innerHTML = `
    <h3>
      <span>🗑️ Bulk Message Deleter</span>
      <button id="dbd-close" type="button" aria-label="Close">✕</button>
    </h3>

    <div class="dbd-row">
      <label for="dbd-channel">Channel ID</label>
      <div class="dbd-input-wrap">
        <input class="dbd-input" id="dbd-channel" type="text" inputmode="numeric" placeholder="Auto-detected from URL">
        <button class="dbd-auto-btn" id="dbd-detect-channel" type="button">Auto</button>
      </div>
    </div>

    <div class="dbd-row">
      <label for="dbd-delay">Delay between deletes (ms)</label>
      <input class="dbd-input" id="dbd-delay" type="number" value="900" min="250" max="60000" step="50">
    </div>

    <div class="dbd-row">
      <label for="dbd-rate-floor">Minimum 429 wait (seconds)</label>
      <input class="dbd-input" id="dbd-rate-floor" type="number" value="2" min="1" max="300" step="1">
      <div class="dbd-note">Discord's retry_after value is always respected; this is only a minimum fallback.</div>
    </div>

    <div class="dbd-stats">
      <div class="dbd-stat"><strong id="dbd-scanned">0</strong><span>Scanned</span></div>
      <div class="dbd-stat"><strong id="dbd-deleted">0</strong><span>Deleted</span></div>
      <div class="dbd-stat"><strong id="dbd-failed">0</strong><span>Failed</span></div>
    </div>

    <hr class="dbd-divider">
    <button id="dbd-start" class="dbd-main" type="button">▶ Start deleting mine</button>
    <button id="dbd-stop" class="dbd-main" type="button">⏹ Stop</button>
    <div id="dbd-log" role="log" aria-live="polite"></div>
  `;
  document.body.appendChild(panel);

  const $ = (id) => document.getElementById(id);
  const inputs = [$('dbd-channel'), $('dbd-delay'), $('dbd-rate-floor'), $('dbd-detect-channel')];

  function appendLog(message, type = '') {
    const logBox = $('dbd-log');
    const line = document.createElement('div');
    if (type) line.className = `dbd-log-${type}`;
    line.textContent = message;
    logBox.appendChild(line);

    while (logBox.childNodes.length > MAX_LOG_LINES) {
      logBox.removeChild(logBox.firstChild);
    }

    logBox.scrollTop = logBox.scrollHeight;
  }

  function updateStats() {
    $('dbd-scanned').textContent = String(state.scanned);
    $('dbd-deleted').textContent = String(state.deleted);
    $('dbd-failed').textContent = String(state.failed);
  }

  function setRunning(running) {
    state.running = running;
    $('dbd-start').style.display = running ? 'none' : 'block';
    $('dbd-stop').style.display = running ? 'block' : 'none';
    for (const input of inputs) input.disabled = running;
  }

  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      if (saved.delay != null) $('dbd-delay').value = String(saved.delay);
      if (saved.rateFloor != null) $('dbd-rate-floor').value = String(saved.rateFloor);
    } catch {}
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        delay: normalizeDelay(),
        rateFloor: normalizeRateFloor() / 1000,
      }));
    } catch {}
  }

  function detectChannelId() {
    const match = location.pathname.match(/^\/channels\/(?:@me|\d+)\/(\d+)/);
    return match?.[1] || null;
  }

  function normalizeSnowflake(value) {
    const result = String(value || '').trim();
    return /^\d{15,22}$/.test(result) ? result : null;
  }

  function normalizeDelay() {
    const value = Math.trunc(Number($('dbd-delay').value));
    const fixed = Number.isFinite(value) ? Math.min(Math.max(value, 250), 60000) : 900;
    $('dbd-delay').value = String(fixed);
    return fixed;
  }

  function normalizeRateFloor() {
    const value = Number($('dbd-rate-floor').value);
    const fixed = Number.isFinite(value) ? Math.min(Math.max(value, 1), 300) : 2;
    $('dbd-rate-floor').value = String(fixed);
    return fixed * 1000;
  }

  function getTokenFromLocalStorage() {
    try {
      const token = localStorage.getItem('token');
      return token ? JSON.parse(token) : null;
    } catch {
      return null;
    }
  }

  function getTokenFromWebpack() {
    try {
      const chunk = window.webpackChunkdiscord_app;
      if (!Array.isArray(chunk)) return null;

      let requireFn;
      chunk.push([[Symbol('dbd')], {}, (req) => { requireFn = req; }]);
      chunk.pop();
      if (!requireFn?.c) return null;

      for (const module of Object.values(requireFn.c)) {
        const exports = module?.exports;
        if (!exports) continue;

        const candidates = [exports, exports.default, exports.Z, exports.ZP];
        for (const candidate of candidates) {
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

  function getToken() {
    return getTokenFromWebpack() || getTokenFromLocalStorage();
  }

  async function parseBody(response) {
    const text = await response.text().catch(() => '');
    if (!text) return null;
    try { return JSON.parse(text); } catch { return text; }
  }

  function retryAfterMs(response, body) {
    let ms = 0;

    if (body && typeof body === 'object' && Number.isFinite(Number(body.retry_after))) {
      const retry = Number(body.retry_after);
      ms = Math.max(ms, retry > 1000 ? retry : retry * 1000);
    }

    const retryAfter = Number(response.headers.get('Retry-After'));
    if (Number.isFinite(retryAfter)) ms = Math.max(ms, retryAfter * 1000);

    const resetAfter = Number(response.headers.get('X-RateLimit-Reset-After'));
    if (Number.isFinite(resetAfter)) ms = Math.max(ms, resetAfter * 1000);

    return Math.max(ms, normalizeRateFloor()) + 250;
  }

  async function apiRequest(path, options = {}) {
    const signal = state.abortController?.signal;
    let lastError = null;

    for (let attempt = 0; attempt <= MAX_REQUEST_RETRIES; attempt++) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

      try {
        const response = await fetch(`${API}${path}`, {
          ...options,
          signal,
          headers: {
            Authorization: state.token,
            ...(options.headers || {}),
          },
        });

        const body = await parseBody(response);

        if (response.status === 429) {
          const wait = retryAfterMs(response, body);
          appendLog(`Rate limited. Waiting ${(wait / 1000).toFixed(1)}s...`, 'warn');
          await sleep(wait, signal);
          continue;
        }

        if (response.status >= 500 && response.status <= 599 && attempt < MAX_REQUEST_RETRIES) {
          const wait = Math.min(1000 * (2 ** attempt), 15000) + Math.floor(Math.random() * 300);
          appendLog(`Discord returned HTTP ${response.status}. Retrying in ${(wait / 1000).toFixed(1)}s...`, 'warn');
          await sleep(wait, signal);
          continue;
        }

        return { response, body };
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        lastError = error;

        if (attempt >= MAX_REQUEST_RETRIES) break;
        const wait = Math.min(750 * (2 ** attempt), 10000) + Math.floor(Math.random() * 250);
        appendLog(`Network error. Retrying in ${(wait / 1000).toFixed(1)}s...`, 'warn');
        await sleep(wait, signal);
      }
    }

    throw lastError || new Error('Request failed after retries');
  }

  async function getCurrentUser() {
    const { response, body } = await apiRequest('/users/@me');
    if (response.status === 401) throw new Error('Discord rejected the session token (HTTP 401). Reload Discord and try again.');
    if (!response.ok) throw new Error(`Could not identify the current account (HTTP ${response.status}${body?.message ? `: ${body.message}` : ''}).`);
    return body;
  }

  function messagePreview(message) {
    let content = typeof message?.content === 'string' ? message.content.replace(/\s+/g, ' ').trim() : '';
    if (!content) {
      if (message?.attachments?.length) content = '[attachment]';
      else if (message?.embeds?.length) content = '[embed]';
      else content = '[empty message]';
    }
    return content.length > 52 ? `${content.slice(0, 49)}...` : content;
  }

  async function deleteMessage(channelId, message) {
    const { response, body } = await apiRequest(`/channels/${channelId}/messages/${message.id}`, { method: 'DELETE' });

    if (response.status === 204 || response.status === 404) return true;

    if (response.status === 401) {
      throw new Error('Authorization expired while deleting (HTTP 401). Reload Discord and try again.');
    }

    if (response.status === 403) {
      appendLog(`Skipped ${message.id}: Discord refused deletion (HTTP 403).`, 'warn');
      return false;
    }

    appendLog(`Failed ${message.id}: HTTP ${response.status}${body?.message ? ` — ${body.message}` : ''}`, 'error');
    return false;
  }

  async function runDeletion() {
    if (state.running) return;

    $('dbd-log').textContent = '';
    state.deleted = 0;
    state.failed = 0;
    state.scanned = 0;
    state.lastMessageId = null;
    updateStats();

    const detected = detectChannelId();
    const channelId = normalizeSnowflake($('dbd-channel').value) || detected;
    if (!channelId) {
      appendLog('No valid channel ID. Open a Discord channel/DM or enter its ID.', 'error');
      return;
    }

    $('dbd-channel').value = channelId;
    normalizeDelay();
    normalizeRateFloor();
    saveSettings();

    state.token = getToken();
    if (!state.token) {
      appendLog('Could not obtain the active Discord session token. Reload Discord and retry.', 'error');
      return;
    }

    state.abortController = new AbortController();
    setRunning(true);

    try {
      state.currentUser = await getCurrentUser();
      appendLog(`Account: ${state.currentUser.username} (${state.currentUser.id})`, 'ok');
      appendLog(`Scanning channel ${channelId} newest → oldest...`);

      while (state.running) {
        const params = new URLSearchParams({ limit: '100' });
        if (state.lastMessageId) params.set('before', state.lastMessageId);

        const { response, body } = await apiRequest(`/channels/${channelId}/messages?${params}`);

        if (response.status === 401) throw new Error('Authorization expired while scanning (HTTP 401).');
        if (response.status === 403) throw new Error('Discord denied access to this channel (HTTP 403).');
        if (response.status === 404) throw new Error('Channel not found or unavailable (HTTP 404).');
        if (!response.ok) throw new Error(`Scan failed (HTTP ${response.status}${body?.message ? `: ${body.message}` : ''}).`);
        if (!Array.isArray(body)) throw new Error('Discord returned an unexpected message-list response.');

        if (body.length === 0) {
          appendLog(`Finished. Deleted ${state.deleted}; failed ${state.failed}.`, 'ok');
          break;
        }

        state.lastMessageId = body[body.length - 1].id;
        state.scanned += body.length;
        updateStats();

        const mine = body.filter((message) => message?.author?.id === state.currentUser.id);

        for (const message of mine) {
          if (!state.running) break;

          const ok = await deleteMessage(channelId, message);
          if (ok) {
            state.deleted++;
            appendLog(`Deleted #${state.deleted}: ${messagePreview(message)}`, 'ok');
          } else {
            state.failed++;
          }
          updateStats();

          if (state.running) await sleep(normalizeDelay(), state.abortController.signal);
        }
      }
    } catch (error) {
      if (error?.name === 'AbortError') {
        appendLog('Stopped.', 'warn');
      } else {
        appendLog(error?.message || String(error), 'error');
      }
    } finally {
      state.running = false;
      state.abortController = null;
      setRunning(false);
    }
  }

  function stopDeletion() {
    if (!state.running) return;
    state.running = false;
    state.abortController?.abort();
  }

  function fillDetectedChannel(quiet = false) {
    const id = detectChannelId();
    if (id) {
      $('dbd-channel').value = id;
      if (!quiet) appendLog(`Detected channel ${id}.`, 'ok');
      return true;
    }
    if (!quiet) appendLog('Could not detect a channel from the current URL.', 'error');
    return false;
  }

  $('dbd-close').addEventListener('click', () => {
    panel.style.display = 'none';
    toggleBtn.style.display = 'flex';
  });

  toggleBtn.addEventListener('click', () => {
    panel.style.display = 'block';
    toggleBtn.style.display = 'none';
    if (!state.running) fillDetectedChannel(true);
  });

  $('dbd-detect-channel').addEventListener('click', () => fillDetectedChannel(false));
  $('dbd-start').addEventListener('click', runDeletion);
  $('dbd-stop').addEventListener('click', stopDeletion);
  $('dbd-delay').addEventListener('change', saveSettings);
  $('dbd-rate-floor').addEventListener('change', saveSettings);

  let lastPath = location.pathname;
  const observer = new MutationObserver(() => {
    if (location.pathname === lastPath) return;
    lastPath = location.pathname;
    if (!state.running) fillDetectedChannel(true);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  loadSettings();
  fillDetectedChannel(true);
  appendLog('Ready. Open a channel/DM and press Start deleting mine.');
})();
