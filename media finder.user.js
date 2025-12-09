// ==UserScript==
// @name         Търсач на медийни линкове (мрежови hook + Zoom)
// @namespace    http://tampermonkey.net/
// @version      0.4
// @description  Открива mp3/mp4/m3u8 и др. чрез DOM + мрежови hook, показва известие и отваря отделен таб със списък
// @author       you
// @match        *://*/*
// @run-at       document-start
// @grant        GM_notification
// @grant        unsafeWindow
// ==/UserScript==

(function() {
    'use strict';

    const exts = [
        'mp3','mp4','m4a','m4v','webm','ogg','ogv','oga',
        'wav','flac','mov','avi','mkv','flv','m3u8'
    ];
    const extRe = new RegExp('\\.(' + exts.join('|') + ')(\\?|#|$)', 'i');

    const found = new Set();
    let openTimer = null;
    let opened = false;

    function normalizeUrl(u) {
        if (!u) return null;
        u = String(u).trim();
        if (!u) return null;

        if (u.startsWith('//')) {
            u = location.protocol + u;
        } else if (u.startsWith('/')) {
            u = location.origin + u;
        } else if (!/^https?:|^blob:|^data:/i.test(u)) {
            try {
                u = new URL(u, location.href).href;
            } catch(e) {
                return null;
            }
        }
        return u;
    }

    function tryAddUrl(raw) {
        const url = normalizeUrl(raw);
        if (!url) return;
        if (!extRe.test(url)) return;
        if (found.has(url)) return;
        found.add(url);
        console.log('[MediaFinder] captured:', url);
        scheduleOpen();
    }

    function scheduleOpen() {
        if (opened) return;
        if (openTimer) return;
        openTimer = setTimeout(function() {
            const arr = Array.from(found);
            if (!arr.length) return;
            opened = true;
            notify(arr.length);
            openResultsPage(arr);
        }, 2000);
    }

    function collectFromDom() {
        try {
            const nodes = document.querySelectorAll('video,audio,source,[src],[href],[data-src],[data-href]');
            nodes.forEach(function(n) {
                ['src','href','data-src','data-href'].forEach(function(attr) {
                    if (!n.getAttribute) return;
                    const v = n.getAttribute(attr);
                    if (!v) return;
                    tryAddUrl(v);
                });
            });
        } catch(e) {}
    }

    function collectFromHtml() {
        try {
            const html = document.documentElement.innerHTML;

            const absRe = /(?:https?:)?\/\/[^\s"'<>]+\.(?:mp3|mp4|m4a|m4v|webm|ogg|ogv|oga|wav|flac|mov|avi|mkv|flv|m3u8)(\?[^\s"'<>]*)?/gi;
            let m;
            while ((m = absRe.exec(html))) {
                let u = m[0];
                if (!/^https?:\/\//i.test(u)) {
                    u = location.protocol + u;
                }
                tryAddUrl(u);
            }

            const relRe = /(?:src|href)\s*=\s*["']([^"'<>]+\.(?:mp3|mp4|m4a|m4v|webm|ogg|ogv|oga|wav|flac|mov|avi|mkv|flv|m3u8)(?:\?[^\s"'<>]*)?)["']/gi;
            while ((m = relRe.exec(html))) {
                tryAddUrl(m[1]);
            }
        } catch(e) {}
    }

    function initialScan() {
        if (!document.documentElement) return;
        collectFromDom();
        collectFromHtml();
    }

    function notify(count) {
        let text;
        if (count === 1) {
            text = 'Открит е 1 медиен линк.';
        } else {
            text = 'Открити са ' + count + ' медийни линка.';
        }

        if (typeof GM_notification === 'function') {
            GM_notification({
                title: 'Търсач на медия',
                text: text,
                timeout: 4000
            });
        } else if (window.Notification && Notification.permission === 'granted') {
            new Notification('Търсач на медия', { body: text });
        } else {
            alert(text);
        }
    }

    function escHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/"/g, '&quot;');
    }

    function openResultsPage(urls) {
        const current = window;
        const w = current.open('about:blank', '_blank', 'noopener');
        if (!w) {
            alert('Търсач на медия: блокиран е изскачащ прозорец. Разрешете попъпите за сайта, за да видите списъка.');
            return;
        }

        const items = urls.map(function(u) {
            const e = escHtml(u);
            return '<li><a href="' + e + '" target="_blank" rel="noreferrer noopener">' + e + '</a></li>';
        }).join('');

        const html =
'<!doctype html>' +
'<html><head><meta charset="utf-8">' +
'<title>Медийни линкове</title>' +
'<style>' +
'body{background:#020617;color:#e5e7eb;font:13px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:10px;}' +
'a{color:#38bdf8;word-break:break-all;}' +
'h1{font-size:18px;margin:0 0 8px 0;}' +
'</style></head><body>' +
'<h1>Открити са ' + urls.length + ' медийни URL адреса</h1>' +
'<p>Може да копирате линк или да го отворите в нов таб. За .m3u8 плейлисти използвайте подходящ плейър или downloader.</p>' +
'<ul>' + items + '</ul>' +
'</body></html>';

        w.document.open();
        w.document.write(html);
        w.document.close();

        try {
            w.blur();
            current.focus();
        } catch(e) {}
    }

    function hookNetwork() {
        const uw = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

        try {
            const XHR = uw.XMLHttpRequest;
            if (XHR && !XHR.__mediaHooked) {
                XHR.__mediaHooked = true;
                const origOpen = XHR.prototype.open;
                XHR.prototype.open = function(method, url) {
                    tryAddUrl(url);
                    this.addEventListener('load', () => {
                        tryAddUrl(this.responseURL);
                    }, false);
                    return origOpen.apply(this, arguments);
                };
            }
        } catch(e) {}

        try {
            const origFetch = uw.fetch;
            if (origFetch && !origFetch.__mediaHooked) {
                uw.fetch = function(input, init) {
                    let url = input;
                    if (input && typeof input === 'object' && 'url' in input) {
                        url = input.url;
                    }
                    tryAddUrl(url);
                    return origFetch.call(this, input, init).then(function(res) {
                        try {
                            tryAddUrl(res.url);
                        } catch(e) {}
                        return res;
                    });
                };
                uw.fetch.__mediaHooked = true;
            }
        } catch(e) {}
    }

    hookNetwork();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialScan);
    } else {
        initialScan();
    }
})();