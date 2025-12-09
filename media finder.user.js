// ==UserScript==
// @name         Media URL Finder (auto notify + blank page list)
// @namespace    http://tampermonkey.net/
// @version      0.2
// @description  Auto-detect mp3/mp4/etc on page, notify, and open a tab with the links
// @author       you
// @match        *://*/*
// @run-at       document-end
// @grant        GM_notification
// ==/UserScript==

(function() {
    'use strict';

    const exts = ['mp3','mp4','m4a','m4v','webm','ogg','ogv','oga','wav','flac','mov','avi','mkv','flv'];
    const extRe = new RegExp('\\.(' + exts.join('|') + ')(\\?|#|$)', 'i');

    function normalizeUrl(u) {
        if (!u) return null;
        u = u.trim();
        if (!u) return null;

        if (u.startsWith('//')) {
            u = location.protocol + u;
        } else if (u.startsWith('/')) {
            u = location.origin + u;
        } else if (!/^https?:|^blob:|^data:/i.test(u)) {
            try {
                u = new URL(u, location.href).href;
            } catch(e) {}
        }
        return u;
    }

    function collectFromDom(set) {
        const nodes = document.querySelectorAll('video,audio,source,[src],[href],[data-src],[data-href]');
        nodes.forEach(function(n) {
            ['src','href','data-src','data-href'].forEach(function(attr) {
                if (!n.getAttribute) return;
                const v = n.getAttribute(attr);
                if (!v) return;
                if (!extRe.test(v)) return;
                const u = normalizeUrl(v);
                if (u) set.add(u);
            });
        });
    }

    function collectFromHtml(set) {
        const html = document.documentElement.innerHTML;

        const absRe = /(?:https?:)?\/\/[^\s"'<>]+\.(?:mp3|mp4|m4a|m4v|webm|ogg|ogv|oga|wav|flac|mov|avi|mkv|flv)(\?[^\s"'<>]*)?/gi;
        let m;
        while ((m = absRe.exec(html))) {
            let u = m[0];
            if (!/^https?:\/\//i.test(u)) {
                u = location.protocol + u;
            }
            set.add(u);
        }

        const relRe = /(?:src|href)\s*=\s*["']([^"'<>]+\.(?:mp3|mp4|m4a|m4v|webm|ogg|ogv|oga|wav|flac|mov|avi|mkv|flv)(?:\?[^\s"'<>]*)?)["']/gi;
        while ((m = relRe.exec(html))) {
            const u = normalizeUrl(m[1]);
            if (u) set.add(u);
        }
    }

    function scanForMedia() {
        const set = new Set();
        try { collectFromDom(set); } catch(e) {}
        try { collectFromHtml(set); } catch(e) {}
        const arr = Array.from(set);
        console.log('[MediaFinder] Found media URLs:', arr);
        return arr;
    }

    function notify(count) {
        const text = count === 1 ? 'Found 1 media URL.' : 'Found ' + count + ' media URLs.';
        if (typeof GM_notification === 'function') {
            GM_notification({
                title: 'Media Finder',
                text: text,
                timeout: 4000
            });
        } else if (window.Notification && Notification.permission === 'granted') {
            new Notification('Media Finder', { body: text });
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
        const w = window.open('about:blank', '_blank');
        if (!w) {
            alert('Media Finder: popup blocked, allow popups for this site to see the list.');
            return;
        }

        const items = urls.map(function(u) {
            const e = escHtml(u);
            return '<li><a href="' + e + '" target="_blank" rel="noreferrer noopener">' + e + '</a></li>';
        }).join('');

        const html =
'<!doctype html>' +
'<html><head><meta charset="utf-8">' +
'<title>Media URLs</title>' +
'<style>' +
'body{background:#020617;color:#e5e7eb;font:13px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:10px;}'+
'a{color:#38bdf8;word-break:break-all;}' +
'h1{font-size:18px;margin:0 0 8px 0;}' +
'</style></head><body>' +
'<h1>Found ' + urls.length + ' media URL' + (urls.length === 1 ? '' : 's') + '</h1>' +
'<ul>' + items + '</ul>' +
'</body></html>';

        w.document.open();
        w.document.write(html);
        w.document.close();
    }

    function runScan() {
        const urls = scanForMedia();
        if (urls.length) {
            notify(urls.length);
            openResultsPage(urls);
        } else {
            console.log('[MediaFinder] No media URLs found on this page.');
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', runScan);
    } else {
        runScan();
    }
})();