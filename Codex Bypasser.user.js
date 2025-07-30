// ==UserScript==
// @name         Codex Bypasser v1.2
// @description  Bwypawses Codex key system with toaster notifications UwU
// @match        https://mobile.codex.lol/*
// @connect      linkvertise.com
// @connect      api.codex.lol
// @connect      *
// @version      1.1.3
// @run-at       document-end
// @grant        GM_xmlhttpRequest
// ==/UserScript==

const config = {
    initialWait: 6000,
    stageWait: 6000,
    betweenStageWait: 1500,
    postSuccessWait: 3000,
    toastDurationShort: 3000,
    toastDurationLong: 5000,
    messages: {
        bypassStart: "Pwease do nyot touch anyfing OwO, it'ww wun automaticawwy :3",
        bypassInitiated: "Bwypass stawted, pwease be patient >w<",
        stageCompleted: (current, total) => `Stage ${current}/${total} compweted! UwU`,
        bypassSuccess: "Bwypass compweted succwessfuwwy! :3",
        bypassUnsupported: "Bwypass unsuppowted OwO",
        captchaPrompt: "Pwease to solve da captcha >w<"
    }
};

;(function(){
    const css = ".toaster-container{position:fixed;top:20px;right:20px;z-index:999999}.toaster{background:rgba(0,0,0,0.8);color:#fff;padding:10px 15px;margin-bottom:10px;border-radius:4px;min-width:200px;box-shadow:0 2px 8px rgba(0,0,0,0.3);font-family:sans-serif;opacity:0;transform:translateY(-10px);transition:opacity .3s ease,transform .3s ease}.toaster.show{opacity:1;transform:translateY(0)}";
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    const container = document.createElement("div");
    container.className = "toaster-container";
    document.body.appendChild(container);
    window.showToast = (message, duration = config.toastDurationShort) => {
        const t = document.createElement("div");
        t.className = "toaster";
        t.textContent = message;
        container.appendChild(t);
        requestAnimationFrame(() => t.classList.add("show"));
        setTimeout(() => {
            t.classList.remove("show");
            t.addEventListener("transitionend", () => t.remove());
        }, duration);
    };
    window.alert = msg => showToast(msg, config.toastDurationLong);
})();

fetch("https://raw.githubusercontent.com/1dontgiveaf/hola/main/Check")
  .then(r => r.text())
  .then(data => {
    if (data.toLowerCase().includes("no")) {
      fetch("https://raw.githubusercontent.com/1dontgiveaf/hola/main/Error1.6.6")
        .then(r => r.text())
        .then(err => showToast(err, config.toastDurationLong))
        .catch(() => showToast("Ewwow fetching ewror page", config.toastDurationLong));
      return;
    }
    if (document.title === "Just a moment...") return;
    (async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const handleError = e => showToast("ERROR: " + (e.message || e), config.toastDurationLong);
      const linkvertiseSpoof = link => new Promise((res, rej) =>
        GM.xmlHttpRequest({
          method: "GET",
          url: link,
          headers: { Referer: "https://linkvertise.com/" },
          onload: r => res(r.responseText),
          onerror: rej
        })
      );
      const getTurnstileResponse = async () => {
        const n = setInterval(() => showToast(config.messages.captchaPrompt, config.toastDurationShort), 6000);
        let r = "";
        while (!r) {
          try { r = turnstile.getResponse(); } catch {}
          await sleep(1000);
        }
        clearInterval(n);
        return r;
      };
      const getGrecaptchaResponse = async () => {
        const n = setInterval(() => showToast(config.messages.captchaPrompt, config.toastDurationShort), 6000);
        let r = "";
        while (!r) {
          try { r = grecaptcha.getResponse(); } catch {}
          await sleep(1000);
        }
        clearInterval(n);
        return r;
      };
      const base64decode = str => atob(str.replace(/-/g, "+").replace(/_/g, "/"));
      const notificationMsg = (m, t) => showToast(m, t);
      const codex = async () => {
        let session;
        while (!session) {
          session = localStorage.getItem("android-session");
          await sleep(1000);
        }
        const links = document.getElementsByTagName("a");
        if (links.length && links[0].innerHTML.includes("Get started")) links[0].click();
        const getStages = async () => {
          const r = await fetch("https://api.codex.lol/v1/stage/stages", {
            method: "GET",
            headers: { "Android-Session": session }
          });
          const d = await r.json();
          if (d.success) return d.authenticated ? [] : d.stages;
          throw new Error("Failed to get stages");
        };
        const initiateStage = async id => {
          const r = await fetch("https://api.codex.lol/v1/stage/initiate", {
            method: "POST",
            headers: { "Android-Session": session, "Content-Type": "application/json" },
            body: JSON.stringify({ stageId: id })
          });
          const d = await r.json();
          if (d.success) return d.token;
          throw new Error("Failed to initiate stage");
        };
        const validateStage = async (t, ref) => {
          const r = await fetch("https://api.codex.lol/v1/stage/validate", {
            method: "POST",
            headers: {
              "Android-Session": session,
              "Content-Type": "application/json",
              "Task-Referrer": ref
            },
            body: JSON.stringify({ token: t })
          });
          const d = await r.json();
          if (d.success) return d.token;
          throw new Error("Failed to validate stage");
        };
        const authenticate = async tokens => {
          const r = await fetch("https://api.codex.lol/v1/stage/authenticate", {
            method: "POST",
            headers: { "Android-Session": session, "Content-Type": "application/json" },
            body: JSON.stringify({ tokens })
          });
          const d = await r.json();
          if (d.success) return true;
          throw new Error("Failed to authenticate");
        };
        let stages = await getStages(), i = 0;
        while (localStorage.getItem(stages[i]) && i < stages.length) i++;
        if (i === stages.length) return;
        const validatedTokens = [];
        try {
          while (i < stages.length) {
            const sid = stages[i].uuid, initToken = await initiateStage(sid);
            await sleep(config.stageWait);
            const tokenData = JSON.parse(base64decode(initToken.split(".")[1]));
            const ref = tokenData.link.includes("loot-links")
                        ? "https://loot-links.com/"
                        : tokenData.link.includes("loot-link")
                          ? "https://loot-link.com/"
                          : "https://linkvertise.com/";
            const vToken = await validateStage(initToken, ref);
            validatedTokens.push({ uuid: sid, token: vToken });
            notificationMsg(config.messages.stageCompleted(i+1, stages.length), config.toastDurationShort);
            await sleep(config.betweenStageWait);
            i++;
          }
          if (await authenticate(validatedTokens)) {
            notificationMsg(config.messages.bypassSuccess, config.toastDurationLong);
            await sleep(config.postSuccessWait);
            window.location.reload();
          }
        } catch (e) {
          handleError(e);
        }
      };
      const start = async () => {
        showToast(config.messages.bypassStart, config.toastDurationLong);
        await sleep(config.initialWait);
        showToast(config.messages.bypassInitiated, config.toastDurationShort);
        if (window.location.hostname === "mobile.codex.lol") await codex();
        else notificationMsg(config.messages.bypassUnsupported, config.toastDurationShort);
      };
      start();
    })();
  })
  .catch(e => showToast("ERROR: " + (e.message || e), config.toastDurationLong));
