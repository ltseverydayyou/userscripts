// ==UserScript==
// @name         work.ink Full Bypass + Fake Extension + Auto Redirect
// @namespace    https://www.openbash.com/
// @version      1.31
// @description  Auto-complete offers, spoof extension, remove overlays, and force redirect to destination
// @match        *://*.work.ink/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

;(function(){
  'use strict';

  const REQUIRED   = 2;
  let done         = 0;
  let goClicked    = false;
  let lastSweep    = 0;
  const COOLDOWN   = 200;

  let observer, intervalID;

  // === Fake Extension Spoof (no unsafeWindow needed) ===
  if (!window.chrome) window.chrome = {};
  if (!window.chrome.runtime) window.chrome.runtime = {};

  const spoofedExtensionId = 'deaiapbieocoklikiokamcdklicacgdo';
  const detectionValue = 'wk_installed';
  const fakeSuccessResponse = { installed: true, name: "pdfeditor" };

  if (typeof window.chrome.runtime.sendMessage === 'undefined') {
      window.chrome.runtime.sendMessage = function(extensionId, message, options, responseCallback) {
          const callback = [responseCallback, options].find(arg => typeof arg === 'function');
          let isMatch = false;

          if ((typeof message === 'object' && message !== null && message.message === detectionValue) ||
              (typeof message === 'string' && message === detectionValue)) {
              isMatch = true;
          }

          if (extensionId === spoofedExtensionId && isMatch) {
              console.log('[Bypass] Spoofed PDF Editor extension check');
              if (callback) {
                  setTimeout(() => callback(fakeSuccessResponse), 100);
              }
          }
      };
  }
  // ====================================================

  function pruneModals(){
    document.querySelectorAll(
      '#qc-cmp2-container, .qc-cmp2-container,' +
      'div.fixed.top-16.left-0.right-0.bottom-0,' +
      'div.fixed.bottom-0.left-0.right-0,' +
      '.main-modal,' +
      '.modalwrapper .topicon[src*="hand.svg"]'
    ).forEach(el => {
      if (!el.classList.contains('__install_overlay')) {
        el.remove();
      }
    });
  }

  function removeCountdowns(){
    document.querySelectorAll('div, span, button').forEach(el => {
      if (/^\s*Wait\s*\d+\s*seconds?/i.test(el.textContent)) {
        el.remove();
      }
    });
  }

  function updateSubtitle(){
    const sub = document.querySelector('.subtitle');
    if (!sub) return;
    const remain = Math.max(REQUIRED - done, 0);
    sub.textContent =
      `Complete ${remain} more offer${remain===1?'':'s'} to continue (${done}/${REQUIRED})`;
  }

  function triggerGo(){
    if (goClicked) return;
    goClicked = true;
    pruneModals();
    removeCountdowns();

    const btn = document.getElementById('access-offers') || document.querySelector('.accessBtn');
    if (btn) {
      console.log('[Bypass] Triggering "Go To Destination" button');
      btn.click();
    }
  }

  function sweep(){
    const now = Date.now();
    if (now - lastSweep < COOLDOWN) return;
    lastSweep = now;
    pruneModals();
    removeCountdowns();
    updateSubtitle();
    document.getElementById('qc-cmp2-persistent-link')?.click();
  }

  window.addEventListener('DOMContentLoaded', sweep);
  window.addEventListener('load', sweep);
  intervalID = setInterval(sweep, COOLDOWN);
  observer   = new MutationObserver(sweep);
  observer.observe(document.documentElement, { childList:true, subtree:true });

  function showInstallOverlay(){
    if (document.querySelector('.__install_overlay')) return;
    const ov = document.createElement('div');
    ov.className = '__install_overlay';
    ov.innerHTML = `
      <div class="card">
        <h2>Installing…</h2>
        <p>
          Follow your extension/store prompts in the new tab.<br>
          When you’re done, hit Proceed.
        </p>
        <button id="__install_proceed">Proceed</button>
      </div>
    `;
    document.body.appendChild(ov);

    ov.querySelector('#__install_proceed')
      .addEventListener('click', ()=>{
        ov.remove();
        if (done >= REQUIRED) triggerGo();
      });
  }

  function trackOffer(btn){
    if (btn.dataset._accepted) return;
    btn.dataset._accepted = '1';
    done++;
    updateSubtitle();
    showInstallOverlay();
  }

  if (document.querySelector('.offercards')) {
    document.querySelectorAll('.interestedBtn')
      .forEach(b=>b.addEventListener('click', ()=>trackOffer(b)));
  }

  // === Auto complete offers immediately ===
  window.addEventListener('DOMContentLoaded', () => {
    done = REQUIRED;
    updateSubtitle();
    triggerGo();
  });

  // === Redirect Detection ===
  const redirectObserver = new MutationObserver(() => {
    const btn = document.querySelector('.accessBtn');
    if (!btn || btn.classList.contains('button-disabled')) return;

    // Try to extract direct link from inline JS
    const scripts = Array.from(document.scripts);
    let foundLink = null;

    for (const script of scripts) {
      const match = script.innerText.match(/window\.location\.(?:href|replace)\s*=\s*['"]([^'"]+)['"]/);
      if (match) {
        foundLink = match[1];
        break;
      }
    }

    if (foundLink) {
      console.log('[Bypass] Redirecting directly:', foundLink);
      window.location.href = foundLink;
      redirectObserver.disconnect();
    } else {
      console.log('[Bypass] Clicking button instead');
      btn.click();
    }
  });

  window.addEventListener('DOMContentLoaded', () => {
    redirectObserver.observe(document.body, { childList: true, subtree: true });
  });

  const style = document.createElement('style');
  style.textContent = `
    .accessBtn, #access-offers {
      pointer-events: auto !important;
      opacity:        1   !important;
    }
    .__install_overlay {
      position: fixed; top:0; left:0; width:100%; height:100%;
      background: rgba(0,0,0,0.6); display:flex;
      align-items:center; justify-content:center; z-index:99999;
    }
    .__install_overlay .card {
      background: #fff; padding:2rem; border-radius:8px;
      max-width: 320px; text-align:center;
      box-shadow:0 4px 12px rgba(0,0,0,0.2);
    }
    .__install_overlay .card button {
      margin-top:1rem; padding:0.75rem 1.5rem;
      border:none; background:#28a745; color:#fff;
      border-radius:4px; cursor:pointer; font-size:1rem;
    }
  `;
  document.head.appendChild(style);

})();
