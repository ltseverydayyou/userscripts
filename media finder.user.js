// ==UserScript==
// @name         Откриване на медийни адреси (балон-нотификация)
// @namespace    http://tampermonkey.net/
// @version      0.7bg
// @description  Открива mp3/mp4/m3u8/ts и Zoom /rec/download|play линкове и показва стандартно браузърно уведомление с линковете + бутон "Медии (N)"
// @author       you
// @match        *://*/*
// @run-at       document-start
// @grant        unsafeWindow
// ==/UserScript==

(function() {
    'use strict';

    const DEBUG = true;

    const exts = [
        'mp3','mp4','m4a','m4v','webm','ogg','ogv','oga',
        'wav','flac','mov','avi','mkv','flv','m3u8','ts'
    ];
    const extRe = new RegExp('\\.(' + exts.join('|') + ')(\\?|#|$)', 'i');

    const found = new Set();
    let notifyTimer = null;
    let notified = false;
    let badgeEl = null;

    function log() {
        if (!DEBUG) return;
        try { console.log('[Търсач на медии]', ...arguments); } catch(e) {}
    }

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

    function isZoomMedia(url) {
        try {
            const u = new URL(url);
            if (!u.hostname.includes('zoom.us')) return false;
            if (u.pathname.includes('/rec/download')) return true;
            if (u.pathname.includes('/rec/play')) return true;
            return false;
        } catch(e) {
            return false;
        }
    }

    function tryAddUrl(raw) {
        if (!raw) return;
        const url = normalizeUrl(raw);
        if (!url) return;

        if (!extRe.test(url) && !isZoomMedia(url)) {
            return;
        }

        if (found.has(url)) return;
        found.add(url);
        log('Засечен адрес:', url, 'Общо:', found.size);
        updateBadge();
        scheduleNotification();
    }

    function scanTextForUrls(text) {
        if (!text) return;
        try {
            const re = /(?:https?:)?\/\/[^\s"'<>]+\.(?:mp3|mp4|m4a|m4v|webm|ogg|ogv|oga|wav|flac|mov|avi|mkv|flv|m3u8|ts)(\?[^\s"'<>]*)?/gi;
            let m;
            while ((m = re.exec(text))) {
                let u = m[0];
                if (!/^https?:\/\//i.test(u)) {
                    u = location.protocol + u;
                }
                tryAddUrl(u);
            }

            const zoomRe = /https?:\/\/[^\s"'<>]*zoom\.us\/rec\/(?:download|play)[^\s"'<>]*/gi;
            while ((m = zoomRe.exec(text))) {
                tryAddUrl(m[0]);
            }
        } catch(e) {
            log('Грешка при scanTextForUrls:', e);
        }
    }

    function scheduleNotification() {
        if (notified) return;
        if (notifyTimer) return;
        notifyTimer = setTimeout(function() {
            const arr = Array.from(found);
            if (!arr.length) return;
            showNotification(arr);
        }, 1500);
    }

    function showNotification(urls) {
        notified = true;
        const count = urls.length;

        let body = '';
        if (count === 1) {
            body = 'Намерен медиен адрес:\n' + urls[0];
        } else {
            body = 'Намерени са ' + count + ' медийни адреса.\n';
            const preview = urls.slice(0, 3);
            body += preview.join('\n');
            if (count > 3) {
                body += '\n+ още ' + (count - 3);
            }
        }

        log('Опит за показване на браузърно уведомление:', body);

        if (!('Notification' in window)) {
            alertFallback(urls, count);
            return;
        }

        function showBubble() {
            try {
                const n = new Notification('Търсач на медии', { body });
                n.onclick = function() {
                    try { window.focus(); } catch(e) {}
                    openResultsPage(urls);
                    n.close();
                };
            } catch(e) {
                log('Грешка при показване на Notification:', e);
                alertFallback(urls, count);
            }
        }

        if (Notification.permission === 'granted') {
            showBubble();
        } else if (Notification.permission === 'default') {
            Notification.requestPermission().then(function(p) {
                if (p === 'granted') {
                    showBubble();
                } else {
                    alertFallback(urls, count);
                }
            }).catch(function() {
                alertFallback(urls, count);
            });
        } else {
            alertFallback(urls, count);
        }
    }

    function alertFallback(urls, count) {
        let msg;
        if (count === 1) {
            msg = 'Намерен е 1 медиен адрес.\n\n' + urls[0] + '\n\nДа се отвори ли списъкът в нов раздел?';
        } else {
            msg = 'Намерени са ' + count + ' медийни адреса.\n\nДа се отвори ли списъкът в нов раздел?';
        }
        if (confirm(msg)) {
            openResultsPage(urls);
        }
    }

    function escHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/"/g, '&quot;');
    }

    function openResultsPage(urls) {
        if (!urls || !urls.length) {
            alert('Няма намерени медийни адреси.');
            return;
        }

        const w = window.open('about:blank', '_blank');
        if (!w) {
            alert('Търсач на медии: изскачащият прозорец беше блокиран. Разрешете изскачащи прозорци за този сайт, за да видите списъка.');
            return;
        }

        const items = urls.map(function(u) {
            const e = escHtml(u);
            return '<li><a href="' + e + '" target="_blank" rel="noreferrer noopener">' + e + '</a></li>';
        }).join('');

        const html =
'<!doctype html>' +
'<html><head><meta charset="utf-8">' +
'<title>Медийни адреси</title>' +
'<style>' +
'body{background:#020617;color:#e5e7eb;font:13px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:10px;}' +
'a{color:#38bdf8;word-break:break-all;}' +
'h1{font-size:18px;margin:0 0 8px 0;}' +
'</style></head><body>' +
'<h1>' +
  (urls.length === 1
    ? 'Намерен е 1 медиен адрес'
    : 'Намерени са ' + urls.length + ' медийни адреса') +
'</h1>' +
'<p>Копирайте адрес или го отворете в нов раздел. За плейлисти .m3u8/.ts използвайте съвместим плейър или програма за изтегляне.</p>' +
'<ul>' + items + '</ul>' +
'</body></html>';

        w.document.open();
        w.document.write(html);
        w.document.close();
    }

    function updateBadge() {
        const count = found.size;
        if (!document.body || !count) return;

        if (!badgeEl) {
            badgeEl = document.createElement('button');
            badgeEl.textContent = 'Медии (0)';
            badgeEl.style.cssText = [
                'position:fixed',
                'bottom:10px',
                'right:10px',
                'z-index:999999',
                'padding:4px 8px',
                'font-size:12px',
                'background:#111827',
                'color:#e5e7eb',
                'border:1px solid #4b5563',
                'border-radius:4px',
                'cursor:pointer',
                'opacity:0.7'
            ].join(';');

            badgeEl.addEventListener('mouseenter', function() {
                badgeEl.style.opacity = '1';
            });
            badgeEl.addEventListener('mouseleave', function() {
                badgeEl.style.opacity = '0.7';
            });
            badgeEl.addEventListener('click', function() {
                const arr = Array.from(found);
                if (!arr.length) {
                    alert('Няма намерени медийни адреси.');
                    return;
                }
                openResultsPage(arr);
            });

            document.body.appendChild(badgeEl);
        }

        badgeEl.textContent = 'Медии (' + count + ')';
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
        } catch(e) {
            log('Грешка при collectFromDom:', e);
        }
    }

    function collectFromHtml() {
        try {
            const html = document.documentElement.innerHTML;
            scanTextForUrls(html);
        } catch(e) {
            log('Грешка при collectFromHtml:', e);
        }
    }

    function initialScan() {
        if (!document.documentElement) return;
        log('Начален скен на', location.href);
        collectFromDom();
        collectFromHtml();
    }

    function hookNetwork() {
        const uw = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
        log('Хукване на XHR и fetch...');

        try {
            const XHR = uw.XMLHttpRequest;
            if (XHR && !XHR.__mediaHooked) {
                XHR.__mediaHooked = true;
                const origOpen = XHR.prototype.open;
                XHR.prototype.open = function(method, url) {
                    try {
                        tryAddUrl(url);
                    } catch(e) {
                        log('Грешка в XHR.open tryAddUrl:', e);
                    }

                    this.addEventListener('load', () => {
                        try {
                            if (this.responseURL) {
                                tryAddUrl(this.responseURL);
                            }
                            if ((this.responseType === '' || this.responseType === 'text') && this.responseText) {
                                scanTextForUrls(this.responseText);
                            }
                        } catch(e) {
                            log('Грешка в XHR load обработка:', e);
                        }
                    }, false);

                    return origOpen.apply(this, arguments);
                };
            }
        } catch(e) {
            log('Грешка при hookNetwork/XHR:', e);
        }

        try {
            const origFetch = uw.fetch;
            if (origFetch && !origFetch.__mediaHooked) {
                uw.fetch = function(input, init) {
                    try {
                        let url = input;
                        if (input && typeof input === 'object' && 'url' in input) {
                            url = input.url;
                        }
                        tryAddUrl(url);
                    } catch(e) {
                        log('Грешка при fetch tryAddUrl:', e);
                    }

                    return origFetch.call(this, input, init).then(function(res) {
                        try {
                            if (res && res.url) {
                                tryAddUrl(res.url);
                            }
                            res.clone().text().then(function(t) {
                                scanTextForUrls(t);
                            }).catch(function(){});
                        } catch(e) {
                            log('Грешка в fetch then:', e);
                        }
                        return res;
                    });
                };
                uw.fetch.__mediaHooked = true;
            }
        } catch(e) {
            log('Грешка при hookNetwork/fetch:', e);
        }
    }

    log('Скриптът стартира на', location.href);
    hookNetwork();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            log('DOMContentLoaded');
            initialScan();
            updateBadge();
        });
    } else {
        initialScan();
        updateBadge();
    }
})();