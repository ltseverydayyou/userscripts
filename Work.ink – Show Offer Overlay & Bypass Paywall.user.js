// ==UserScript==
// @name         Work.ink – Show Offer Overlay & Bypass Paywall
// @match        https://work.ink/*
// @run-at       document-start
// ==/UserScript==

(function() {
  const css = `
    /* hide only the GDPR banner and the Google Safe‑Browsing modals */
    #qc-cmp2-container,
    .qc-cmp2-container,
    .main-modal,
    .fixed.inset-0.bg-black\\/50,
    .fixed.top-16.left-0.right-0.bottom-0.bg-white.z-40,
    .fixed.bottom-0.left-0.right-0.bg-white.border-t {
      display: none !important;
    }

    /* restore normal page centering & cards */
    .defwidth, .linkui, .linkview {
      max-width: 1176px !important;
      margin: 0 auto !important;
      padding: initial !important;
    }
    .linkcard, .offercard {
      border-radius: 0.75rem !important;
      overflow: visible !important;
    }
  `;
  const s = document.createElement('style');
  s.textContent = css;
  document.head.appendChild(s);

  window.addEventListener('load', () => {
    // 1) Remove any leftover Safe‑Browsing modals
    [
      '#qc-cmp2-container', '.main-modal',
      '.fixed.inset-0.bg-black\\/50',
      '.fixed.top-16.left-0.right-0.bottom-0.bg-white.z-40',
      '.fixed.bottom-0.left-0.right-0.bg-white.border-t'
    ].forEach(sel => {
      document.querySelectorAll(sel).forEach(el => el.remove());
    });

    // 2) Auto‑click the "Accept" on the OFFER card (to show the .modalwrapper)
    const acceptOffer = () => {
      const btn = document.querySelector('.interestedBtn.button, .actionrow .button');
      if (btn) {
        btn.click();
      } else {
        // Try again in a moment if it hasn't rendered yet
        setTimeout(acceptOffer, 200);
      }
    };
    acceptOffer();
  });
})();