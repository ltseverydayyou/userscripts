// ==UserScript==
// @name         work.ink Offers Bypass + Countdown Skip (v1.13)
// @namespace    https://www.openbash.com/
// @version      1.13
// @description  Hide “Access Options” + skip wait overlay + auto‑click “Go To Destination” on offer pages
// @match        *://*.work.ink/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function(){
  'use strict';

  // ─── 0. only run where offers exist ────────────────────────────
  if (
    !document.documentElement.innerHTML.includes('offercards') &&
    !document.querySelector('.interestedBtn')
  ) return;

  // ─── 1. inject CSS to kill the legacy modal + loader ───────────
  const css = `
    /* hide the old “Access Options” overlay */
    .linkview + .main-modal,
    .main-modal.svelte-9kfsb0 {
      display: none !important;
    }
    /* kill spinner icons inside buttons */
    .loader-btn { display: none !important; }
    /* always make our final button visible/clickable */
    .accessBtn, #access-offers {
      pointer-events: auto !important;
      opacity:        1   !important;
    }
  `;
  const st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);

  // ─── 2. offer counter + final‑button logic ─────────────────────
  const REQUIRED = 2;
  let done = 0;

  function updateSubtitle() {
    const sub = document.querySelector('.subtitle');
    if (!sub) return;
    const rem = Math.max(REQUIRED - done, 0);
    sub.textContent =
      `Complete ${rem} more offer${rem === 1 ? '' : 's'} to continue (${done}/${REQUIRED})`;
  }

  function clickGo(defer = false) {
    const btn = document.getElementById('access-offers')
              || document.querySelector('.accessBtn');
    if (!btn) return;
    // remove any leftover disabled overlay
    removeWaits();
    if (defer) setTimeout(() => btn.click(), 50);
    else      btn.click();
  }

  function onAccept(e) {
    if (e.currentTarget.dataset._accepted) return;
    e.currentTarget.dataset._accepted = '1';
    done++;
    updateSubtitle();
    if (done >= REQUIRED) clickGo(true);
  }

  function initTracking() {
    document.querySelectorAll('.interestedBtn').forEach(b=>{
      b.addEventListener('click', onAccept);
    });
    // already done?
    if (done >= REQUIRED) clickGo(true);
  }

  // ─── 3. rip out any “Wait X seconds…” overlays ─────────────────
  function removeWaits() {
    document.querySelectorAll('div, button, span').forEach(el=>{
      if (/^\s*Wait\s*\d+\s*seconds?/i.test(el.textContent)) {
        el.remove();
      }
    });
  }

  // ─── 4. observe & sweep ────────────────────────────────────────
  function sweep() {
    updateSubtitle();
    removeWaits();
    // if you already hit 2, force‑click immediately
    if (done >= REQUIRED) clickGo(false);
  }

  window.addEventListener('DOMContentLoaded', sweep);
  window.addEventListener('load',           sweep);
  setInterval(sweep,  500);
  new MutationObserver(sweep).observe(document.documentElement, {
    childList: true, subtree: true
  });

  initTracking();
})();