// ==UserScript==
// @name         Discord Bulk Message Deleter
// @namespace    http://tampermonkey.net/
// @version      2.1.0
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
    if (signal?.aborted) return reject(new DOMException('Aborted','AbortError'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted','AbortError')); }, { once:true });
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
  const readStore = () => { try { const x = JSON.parse(localStorage.getItem(STORE) || '{}'); return x && typeof x === 'object' ? x : {}; } catch { return {}; } };
  const writeStore = patch => { try { localStorage.setItem(STORE, JSON.stringify({ ...readStore(), ...patch })); } catch {} };

  function log(msg, type='') {
    const box = $('dbd-log');
    $('dbd-status').textContent = type==='error'?'Error':type==='warn'?'Waiting':type==='ok'?'Active':'Working';
    const line = document.createElement('div');
    if (type) line.className = `dbd-log-${type}`;
    line.textContent = msg;
    box.appendChild(line);
    while (box.childNodes.length > MAX_LOG) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
  }

  function stats() {
    $('dbd-scanned').textContent = state.scanned;
    $('dbd-deleted').textContent = state.deleted;
    $('dbd-failed').textContent = state.failed;
  }

  function setRunning(v) {
    state.running = v;
    $('dbd-status').textContent = v ? 'Running' : 'Ready';
    $('dbd-start').style.display = v ? 'none' : 'block';
    $('dbd-stop').style.display = v ? 'block' : 'none';
    inputs.forEach(x => x.disabled = v);
  }

  function delay() {
    const n = Math.trunc(Number($('dbd-delay').value));
    const v = Number.isFinite(n) ? Math.min(Math.max(n,250),60000) : 900;
    $('dbd-delay').value = v;
    return v;
  }
  function floor() {
    const n = Number($('dbd-floor').value);
    const v = Number.isFinite(n) ? Math.min(Math.max(n,1),300) : 2;
    $('dbd-floor').value = v;
    return v * 1000;
  }
  function savePrefs() { writeStore({ delay:delay(), rateFloor:floor()/1000 }); }
  function channelFromUrl() { return location.pathname.match(/^\/channels\/(?:@me|\d+)\/(\d+)/)?.[1] || null; }
  function snowflake(v) { v = String(v || '').trim(); return /^\d{15,22}$/.test(v) ? v : null; }

  function tokenFromStorage() { try { const t = localStorage.getItem('token'); return t ? JSON.parse(t) : null; } catch { return null; } }
  function tokenFromWebpack() {
    try {
      const chunks = window.webpackChunkdiscord_app;
      if (!Array.isArray(chunks)) return null;
      let req;
      chunks.push([[Symbol('dbd')], {}, r => { req = r; }]); chunks.pop();
      if (!req?.c) return null;
      for (const mod of Object.values(req.c)) {
        const e = mod?.exports;
        if (!e) continue;
        for (const c of [e,e.default,e.Z,e.ZP]) {
          if (!c || typeof c.getToken !== 'function') continue;
          try { const t = c.getToken(); if (typeof t === 'string' && t.length > 20) return t; } catch {}
        }
      }
    } catch {}
    return null;
  }
  const getToken = () => tokenFromWebpack() || tokenFromStorage();

  async function body(res) {
    const text = await res.text().catch(()=>'');
    if (!text) return null;
    try { return JSON.parse(text); } catch { return text; }
  }
  function retryMs(res, b) {
    let ms = 0;
    if (b && typeof b === 'object' && Number.isFinite(Number(b.retry_after))) {
      const n = Number(b.retry_after); ms = Math.max(ms, n > 1000 ? n : n * 1000);
    }
    const h = Number(res.headers.get('Retry-After')); if (Number.isFinite(h)) ms = Math.max(ms, h*1000);
    const r = Number(res.headers.get('X-RateLimit-Reset-After')); if (Number.isFinite(r)) ms = Math.max(ms, r*1000);
    return Math.max(ms, floor()) + 250;
  }

  async function request(path, options={}) {
    const signal = state.abort?.signal;
    let last;
    for (let i=0; i<=RETRIES; i++) {
      if (signal?.aborted) throw new DOMException('Aborted','AbortError');
      try {
        const res = await fetch(API+path, { ...options, signal, headers:{ Authorization:state.token, ...(options.headers||{}) } });
        const b = await body(res);
        if (res.status === 429) { const ms=retryMs(res,b); log(`Rate limited. Waiting ${(ms/1000).toFixed(1)}s...`,'warn'); await sleep(ms,signal); continue; }
        if (res.status >= 500 && res.status <= 599 && i < RETRIES) { const ms=Math.min(1000*(2**i),15000)+Math.random()*300; log(`Discord returned HTTP ${res.status}. Retrying...`,'warn'); await sleep(ms,signal); continue; }
        return { res, b };
      } catch (e) {
        if (e?.name === 'AbortError') throw e;
        last = e;
        if (i >= RETRIES) break;
        const ms=Math.min(750*(2**i),10000)+Math.random()*250; log('Network error. Retrying...','warn'); await sleep(ms,signal);
      }
    }
    throw last || new Error('Request failed after retries');
  }

  async function currentUser() {
    const {res,b} = await request('/users/@me');
    if (res.status===401) throw new Error('Discord rejected the session token (HTTP 401). Reload Discord and try again.');
    if (!res.ok) throw new Error(`Could not identify the current account (HTTP ${res.status}${b?.message?`: ${b.message}`:''}).`);
    return b;
  }
  function preview(m) {
    let c = typeof m?.content === 'string' ? m.content.replace(/\s+/g,' ').trim() : '';
    if (!c) c = m?.attachments?.length ? '[attachment]' : m?.embeds?.length ? '[embed]' : '[empty message]';
    return c.length > 52 ? c.slice(0,49)+'...' : c;
  }
  async function removeMessage(channel,m) {
    const {res,b} = await request(`/channels/${channel}/messages/${m.id}`, {method:'DELETE'});
    if (res.status===204 || res.status===404) return true;
    if (res.status===401) throw new Error('Authorization expired while deleting (HTTP 401). Reload Discord and try again.');
    if (res.status===403) { log(`Skipped ${m.id}: Discord refused deletion (HTTP 403).`,'warn'); return false; }
    log(`Failed ${m.id}: HTTP ${res.status}${b?.message?` — ${b.message}`:''}`,'error'); return false;
  }

  async function run() {
    if (state.running) return;
    $('dbd-log').textContent='';
    Object.assign(state,{deleted:0,failed:0,scanned:0,before:null}); stats();
    const channel = snowflake($('dbd-channel').value) || channelFromUrl();
    if (!channel) return log('No valid channel ID. Open a Discord channel/DM or enter its ID.','error');
    $('dbd-channel').value=channel; savePrefs();
    state.token=getToken();
    if (!state.token) return log('Could not obtain the active Discord session token. Reload Discord and retry.','error');
    state.abort=new AbortController(); setRunning(true);
    try {
      state.user=await currentUser();
      log(`Account: ${state.user.username} (${state.user.id})`,'ok');
      log(`Scanning channel ${channel} newest → oldest...`);
      while (state.running) {
        const q=new URLSearchParams({limit:'100'}); if (state.before) q.set('before',state.before);
        const {res,b}=await request(`/channels/${channel}/messages?${q}`);
        if (res.status===401) throw new Error('Authorization expired while scanning (HTTP 401).');
        if (res.status===403) throw new Error('Discord denied access to this channel (HTTP 403).');
        if (res.status===404) throw new Error('Channel not found or unavailable (HTTP 404).');
        if (!res.ok) throw new Error(`Scan failed (HTTP ${res.status}${b?.message?`: ${b.message}`:''}).`);
        if (!Array.isArray(b)) throw new Error('Discord returned an unexpected message-list response.');
        if (!b.length) { log(`Finished. Deleted ${state.deleted}; failed ${state.failed}.`,'ok'); break; }
        state.before=b.at(-1).id; state.scanned+=b.length; stats();
        for (const m of b.filter(x=>x?.author?.id===state.user.id)) {
          if (!state.running) break;
          if (await removeMessage(channel,m)) { state.deleted++; log(`Deleted #${state.deleted}: ${preview(m)}`,'ok'); } else state.failed++;
          stats();
          if (state.running) await sleep(delay(),state.abort.signal);
        }
      }
    } catch (e) { log(e?.name==='AbortError'?'Stopped.':(e?.message||String(e)),e?.name==='AbortError'?'warn':'error'); }
    finally { state.running=false; state.abort=null; setRunning(false); }
  }

  function detect(quiet=false) {
    const id=channelFromUrl();
    if (id) { $('dbd-channel').value=id; if (!quiet) log(`Detected channel ${id}.`,'ok'); return true; }
    if (!quiet) log('Could not detect a channel from the current URL.','error');
    return false;
  }

  function clamp(el,x,y) {
    const r=el.getBoundingClientRect();
    const maxX=Math.max(MARGIN,innerWidth-r.width-MARGIN), maxY=Math.max(MARGIN,innerHeight-r.height-MARGIN);
    return {x:Math.min(Math.max(Number.isFinite(x)?x:MARGIN,MARGIN),maxX),y:Math.min(Math.max(Number.isFinite(y)?y:MARGIN,MARGIN),maxY)};
  }
  function position(el,x,y) {
    const p=clamp(el,x,y); Object.assign(el.style,{left:`${Math.round(p.x)}px`,top:`${Math.round(p.y)}px`,right:'auto',bottom:'auto',transform:'none'}); return p;
  }
  function restore(el,saved,fallback) {
    if (saved && Number.isFinite(Number(saved.x)) && Number.isFinite(Number(saved.y))) return position(el,Number(saved.x),Number(saved.y));
    if (fallback) return position(el,fallback.x,fallback.y);
    requestAnimationFrame(()=>{ const r=el.getBoundingClientRect(); position(el,(innerWidth-r.width)/2,96); });
  }
  function persist(el,key) { const r=el.getBoundingClientRect(); writeStore({[key]:{x:Math.round(r.left),y:Math.round(r.top)}}); }
  function draggable(el,handle,key,suppressClick=false) {
    let d=null,moved=false,suppress=false;
    handle.addEventListener('pointerdown',e=>{
      if (e.button!==undefined && e.button!==0) return;
      const interactive=e.target.closest('button,input,select,textarea,a'); if (interactive && interactive!==handle) return;
      const r=el.getBoundingClientRect(); d={id:e.pointerId,x:e.clientX,y:e.clientY,left:r.left,top:r.top}; moved=false; handle.setPointerCapture?.(e.pointerId); e.preventDefault();
    });
    handle.addEventListener('pointermove',e=>{ if(!d||e.pointerId!==d.id)return; const dx=e.clientX-d.x,dy=e.clientY-d.y; if(!moved&&Math.hypot(dx,dy)<4)return; moved=true; position(el,d.left+dx,d.top+dy); e.preventDefault(); });
    const end=e=>{ if(!d||e.pointerId!==d.id)return; if(moved){persist(el,key); if(suppressClick)suppress=true;} try{handle.releasePointerCapture?.(e.pointerId);}catch{} d=null; e.preventDefault(); };
    handle.addEventListener('pointerup',end); handle.addEventListener('pointercancel',end);
    return ()=>{ if(!suppress)return false; suppress=false; return true; };
  }

  const saved=readStore();
  if(saved.delay!=null)$('dbd-delay').value=saved.delay;
  if(saved.rateFloor!=null)$('dbd-floor').value=saved.rateFloor;
  restore(toggle,saved.togglePosition,{x:20,y:120});
  const consumeDrag=draggable(toggle,toggle,'togglePosition',true);
  draggable(panel,$('dbd-dragbar'),'panelPosition');

  $('dbd-close').addEventListener('click',()=>{panel.style.display='none';toggle.style.display='flex';});
  toggle.addEventListener('click',()=>{if(consumeDrag())return;panel.style.display='block';toggle.style.display='none';restore(panel,readStore().panelPosition,null);if(!state.running)detect(true);});
  $('dbd-detect').addEventListener('click',()=>detect(false));
  $('dbd-start').addEventListener('click',run);
  $('dbd-stop').addEventListener('click',()=>{if(state.running){state.running=false;state.abort?.abort();}});
  $('dbd-delay').addEventListener('change',savePrefs); $('dbd-floor').addEventListener('change',savePrefs);
  addEventListener('resize',()=>{if(toggle.style.display!=='none'){const r=toggle.getBoundingClientRect();position(toggle,r.left,r.top);persist(toggle,'togglePosition');}if(panel.style.display!=='none'){const r=panel.getBoundingClientRect();position(panel,r.left,r.top);persist(panel,'panelPosition');}});

  let lastPath=location.pathname;
  new MutationObserver(()=>{if(location.pathname!==lastPath){lastPath=location.pathname;if(!state.running)detect(true);}}).observe(document.documentElement,{childList:true,subtree:true});
  detect(true); log('Ready. Drag the launcher anywhere, open it, then press Start deleting my messages.');
})();
