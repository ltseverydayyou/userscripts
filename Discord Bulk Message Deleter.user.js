// ==UserScript==
// @name         Discord Bulk Message Deleter
// @namespace    http://tampermonkey.net/
// @version      1.5
// @description  Bulk delete your own messages (fixed auto-detect + rate-limit + close button + better errors)
// @author       You
// @match        https://discord.com/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const style = document.createElement('style');
  style.textContent = `
    #dbd-panel {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 99999;
      background: #1e1f22;
      border: 1px solid #3f4147;
      border-radius: 12px;
      padding: 16px;
      width: 280px;
      font-family: 'gg sans', sans-serif;
      color: #dbdee1;
      box-shadow: 0 8px 24px rgba(0,0,0,0.4);
    }
    #dbd-panel h3 {
      margin: 0 0 14px;
      font-size: 14px;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .dbd-row {
      display: flex;
      flex-direction: column;
      margin-bottom: 10px;
    }
    .dbd-row label {
      font-size: 11px;
      color: #949ba4;
      margin-bottom: 4px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .dbd-input-wrap {
      display: flex;
      gap: 6px;
      align-items: center;
    }
    .dbd-row input {
      flex: 1;
      background: #2b2d31;
      border: 1px solid #3f4147;
      border-radius: 6px;
      color: #dbdee1;
      font-size: 12px;
      padding: 6px 8px;
      box-sizing: border-box;
      outline: none;
    }
    .dbd-row input:focus {
      border-color: #5865f2;
    }
    .dbd-row input::placeholder {
      color: #4e5058;
    }
    .dbd-auto-btn {
      background: #2b2d31;
      border: 1px solid #3f4147;
      border-radius: 6px;
      color: #949ba4;
      font-size: 10px;
      padding: 6px 8px;
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .dbd-auto-btn:hover {
      background: #313338;
      color: #dbdee1;
    }
    .dbd-divider {
      border: none;
      border-top: 1px solid #3f4147;
      margin: 12px 0;
    }
    #dbd-panel button.dbd-main {
      width: 100%;
      padding: 9px;
      border: none;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      margin-bottom: 6px;
    }
    #dbd-start  { background: #5865f2; color: #fff; }
    #dbd-start:hover { background: #4752c4; }
    #dbd-stop   { background: #ed4245; color: #fff; display: none; }
    #dbd-stop:hover { background: #c03537; }
    #dbd-log {
      margin-top: 10px;
      background: #2b2d31;
      border-radius: 6px;
      padding: 8px;
      font-size: 11px;
      color: #949ba4;
      height: 90px;
      overflow-y: auto;
      line-height: 1.6;
    }
    #dbd-toggle {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 99999;
      background: #5865f2;
      color: #fff;
      border: none;
      border-radius: 50%;
      width: 48px;
      height: 48px;
      font-size: 20px;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    #dbd-toggle:hover { background: #4752c4; }
    #dbd-close {
      background: none;
      border: none;
      color: #949ba4;
      font-size: 20px;
      cursor: pointer;
      padding: 0;
      margin: 0;
    }
    #dbd-close:hover { color: #dbdee1; }
  `;
  document.head.appendChild(style);

  // Toggle button
  const toggleBtn = document.createElement('button');
  toggleBtn.id = 'dbd-toggle';
  toggleBtn.title = 'Discord Bulk Deleter';
  toggleBtn.textContent = '🗑️';
  document.body.appendChild(toggleBtn);

  // Panel
  const panel = document.createElement('div');
  panel.id = 'dbd-panel';
  panel.style.display = 'none';
  panel.innerHTML = `
    <h3>
      <span>🗑️ Bulk Message Deleter</span>
      <button id="dbd-close">✕</button>
    </h3>

    <div class="dbd-row">
      <label>Channel ID</label>
      <div class="dbd-input-wrap">
        <input id="dbd-channel" type="text" placeholder="Auto-detected from URL" />
        <button class="dbd-auto-btn" id="dbd-detect-channel">Auto</button>
      </div>
    </div>

    <div class="dbd-row">
      <label>User ID</label>
      <div class="dbd-input-wrap">
        <input id="dbd-user" type="text" placeholder="Auto-detected from session" />
        <button class="dbd-auto-btn" id="dbd-detect-user">Auto</button>
      </div>
    </div>

    <div class="dbd-row">
      <label>Delay between deletions (ms)</label>
      <div class="dbd-input-wrap">
        <input id="dbd-delay" type="number" value="1000" min="500" />
      </div>
    </div>

    <hr class="dbd-divider" />

    <button id="dbd-start" class="dbd-main">▶ Start Deleting</button>
    <button id="dbd-stop"  class="dbd-main">⏹ Stop</button>
    <div id="dbd-log">Fill in fields above or hit Auto, then press Start.</div>
  `;
  document.body.appendChild(panel);

  // Close button
  document.getElementById('dbd-close').addEventListener('click', () => {
    panel.style.display = 'none';
    toggleBtn.style.display = 'flex';
  });

  toggleBtn.addEventListener('click', () => {
    const visible = panel.style.display !== 'none';
    panel.style.display = visible ? 'none' : 'block';
    toggleBtn.style.display = visible ? 'flex' : 'none';
  });

  const log = (msg) => {
    const el = document.getElementById('dbd-log');
    el.innerHTML += msg + '<br>';
    el.scrollTop = el.scrollHeight;
  };

  const getToken = () => {
    try {
      const iframe = document.createElement('iframe');
      document.body.appendChild(iframe);
      const token = iframe.contentWindow.localStorage.token;
      document.body.removeChild(iframe);
      return token ? token.replace(/"/g, '') : null;
    } catch { return null; }
  };

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const detectChannel = () => {
    const match = window.location.href.match(/channels\/(?:\d+|@me)\/(\d+)/);
    return match ? match[1] : null;
  };

  document.getElementById('dbd-detect-channel').addEventListener('click', () => {
    const channelId = detectChannel();
    if (channelId) {
      document.getElementById('dbd-channel').value = channelId;
    } else {
      alert('❌ Could not detect channel. Make sure you are inside a channel or DM.');
    }
  });

  document.getElementById('dbd-detect-user').addEventListener('click', async () => {
    const token = getToken();
    if (!token) return alert('❌ Could not get token. Make sure you are logged in.');
    const res = await fetch('https://discord.com/api/v9/users/@me', { headers: { Authorization: token } });
    const me = await res.json();
    document.getElementById('dbd-user').value = me.id;
  });

  let running = false;

  const startDeleting = async () => {
    const delay     = parseInt(document.getElementById('dbd-delay').value) || 1000;
    let   channelId = document.getElementById('dbd-channel').value.trim() || detectChannel();
    let   userId    = document.getElementById('dbd-user').value.trim();

    document.getElementById('dbd-log').innerHTML = '';
    document.getElementById('dbd-start').style.display = 'none';
    document.getElementById('dbd-stop').style.display = 'block';
    running = true;

    if (!channelId) {
      log('❌ No channel ID. Enter one or click Auto.');
      return stop();
    }

    const token = getToken();
    if (!token) {
      log('❌ Could not get token. Make sure you are logged in.');
      return stop();
    }

    if (!userId) {
      const meRes = await fetch('https://discord.com/api/v9/users/@me', { headers: { Authorization: token } });
      const me = await meRes.json();
      userId = me.id;
      document.getElementById('dbd-user').value = userId;
      log(`✅ Logged in as ${me.username}`);
    } else {
      log(`✅ Using User ID: ${userId}`);
    }

    log(`📡 Scanning channel ${channelId}...`);

    let lastId = null;
    let totalDeleted = 0;

    while (running) {
      const url = new URL(`https://discord.com/api/v9/channels/${channelId}/messages`);
      url.searchParams.set('limit', '100');
      if (lastId) url.searchParams.set('before', lastId);

      const res = await fetch(url, { headers: { Authorization: token } });

      if (res.status === 429) {
        const retryAfter = (await res.json()).retry_after * 1000;
        log(`⏳ Rate limited (fetch). Waiting ${retryAfter}ms...`);
        await sleep(retryAfter);
        continue;
      }

      const messages = await res.json();
      if (!Array.isArray(messages) || messages.length === 0) {
        log(`✅ Done! Deleted ${totalDeleted} messages.`);
        break;
      }

      const mine = messages.filter(m => m.author.id === userId);
      lastId = messages[messages.length - 1].id;

      if (mine.length === 0) continue;

      for (const msg of mine) {
        if (!running) break;

        let deleted = false;
        while (!deleted && running) {
          // FIX: restored proper template literal syntax for the delete URL
          const delRes = await fetch(
            `https://discord.com/api/v9/channels/${channelId}/messages/${msg.id}`,
            { method: 'DELETE', headers: { Authorization: token } }
          );

          if (delRes.status === 204) {
            totalDeleted++;
            // FIX: restored proper template literal syntax for the log line
            log(`🗑️ [${totalDeleted}] "${(msg.content || '[attachment]').slice(0, 35)}"`);
            deleted = true;
          } else if (delRes.status === 429) {
            let retryAfter = 5000;
            try {
              const data = await delRes.json();
              retryAfter = (data.retry_after || 1) * 1000;
            } catch {}
            log(`⏳ Rate limited on delete. Waiting ${retryAfter}ms... (retrying same message)`);
            await sleep(retryAfter);
          } else {
            let errorMsg = `HTTP ${delRes.status}`;
            try {
              const errData = await delRes.json();
              if (errData.message) errorMsg += ` — ${errData.message}`;
            } catch {}
            log(`⚠️ Failed: ${errorMsg} for message ${msg.id}`);
            deleted = true;
          }
        }

        if (!running) break;
        await sleep(delay);
      }
    }

    stop();
  };

  const stop = () => {
    running = false;
    document.getElementById('dbd-start').style.display = 'block';
    document.getElementById('dbd-stop').style.display = 'none';
  };

  document.getElementById('dbd-start').addEventListener('click', startDeleting);
  document.getElementById('dbd-stop').addEventListener('click', () => {
    running = false;
    log('🛑 Stopped.');
  });
})();
