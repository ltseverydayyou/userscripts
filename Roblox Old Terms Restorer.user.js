// ==UserScript==
// @name         Roblox Old Terms Restorer
// @version      1.0.0
// @description  Restore classic Roblox wording (Friends, Groups, Games, Shop) across all roblox.com variants.
// @author       Aervanix
// @match        *://roblox.com/*
// @match        *://*.roblox.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==
(function(){'use strict';
const CONNECTION_RE=/\b(connections?)\b/gi;
const CONNECTED_RE=/\b(connected)\b/gi;
const CONNECT_RE=/\b(connects?)\b/gi;
const COMMUNITY_RE=/\b(communities|community)\b/gi;
const CHART_RE=/\b(charts?)\b/gi;
const MARKET_RE=/\b(marketplaces?|market\s?places?)\b/gi;
const EXPERIENCE_RE=/\b(experiences?)\b/gi;
const ATTRS=['placeholder','aria-label','title','alt','data-tooltip','data-original-title','value'];
function mimicCase(r,s){if(s.toUpperCase()===s)return r.toUpperCase();if(s.toLowerCase()===s)return r.toLowerCase();if(s[0]===s[0].toUpperCase()&&s.slice(1)===s.slice(1).toLowerCase())return r[0].toUpperCase()+r.slice(1).toLowerCase();let o='';for(let i=0;i<r.length;i++){const c=s[i]||s[s.length-1];o+=(c===c.toUpperCase())?r[i].toUpperCase():r[i].toLowerCase()}return o}
function transform(t){let a=t;a=a.replace(CONNECTION_RE,m=>mimicCase(/s$/i.test(m)?'friends':'friend',m));a=a.replace(CONNECTED_RE,m=>mimicCase('friended',m));a=a.replace(CONNECT_RE,m=>mimicCase('friends',m));a=a.replace(COMMUNITY_RE,m=>mimicCase(/ies$/i.test(m)?'groups':'group',m));a=a.replace(CHART_RE,m=>mimicCase(/s$/i.test(m)?'games':'game',m));a=a.replace(MARKET_RE,m=>mimicCase(/s$/i.test(m.replace(/\s/g,''))?'shops':'shop',m));a=a.replace(EXPERIENCE_RE,m=>mimicCase(/s$/i.test(m)?'games':'game',m));return a}
function shouldSkip(n){return n.isContentEditable||(n.nodeType===1&&(['SCRIPT','STYLE','NOSCRIPT','TEXTAREA','INPUT','IFRAME'].includes(n.tagName)||n.closest?.('script,style,noscript,textarea,input,iframe,[data-no-translate],[aria-hidden="true"]')))}
function processTextNode(n){const b=n.nodeValue;const a=transform(b);if(a!==b)n.nodeValue=a}
function processElementAttr(el,attr){let v=el.getAttribute(attr);if(typeof v!=='string'||!v)return;if(attr==='value'&&el.tagName==='INPUT'&&!['button','submit','reset'].includes((el.type||'').toLowerCase()))return;const nv=transform(v);if(nv!==v){el.setAttribute(attr,nv);if(attr in el&&typeof el[attr]==='string'){try{el[attr]=nv}catch{}}}}
function processAttributesIn(root){if(root.nodeType!==1&&!(root instanceof ShadowRoot))return;const sel=ATTRS.map(a=>'['+a+']').join(',');if(root.nodeType===1&&root.matches?.(sel))for(const a of ATTRS)if(root.hasAttribute(a))processElementAttr(root,a);(root.querySelectorAll?.(sel)||[]).forEach(el=>{for(const a of ATTRS)if(el.hasAttribute(a))processElementAttr(el,a)})}
function walkAndReplace(root){if(!root||shouldSkip(root))return;const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:n=>(n.nodeValue&&/\S/.test(n.nodeValue))?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT});const nodes=[];while(w.nextNode())nodes.push(w.currentNode);for(const n of nodes)processTextNode(n);processAttributesIn(root)}
const mo=new MutationObserver(ms=>{for(const m of ms){if(m.type==='characterData'){processTextNode(m.target)}else if(m.type==='childList'){for(const node of m.addedNodes){if(node.nodeType===3){processTextNode(node)}else if(node.nodeType===1||node.nodeType===11){processAll(node);if(node.shadowRoot)processAll(node.shadowRoot)}}}else if(m.type==='attributes'){processElementAttr(m.target,m.attributeName)}}});
const observed=new WeakSet();
function observeRoot(root){if(!root||observed.has(root))return;mo.observe(root,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:ATTRS});observed.add(root)}
function processAll(root){walkAndReplace(root);if(root.querySelectorAll){root.querySelectorAll('*').forEach(el=>{if(el.shadowRoot){observeRoot(el.shadowRoot);walkAndReplace(el.shadowRoot);processAll(el.shadowRoot)}})}}
const _attach=Element.prototype.attachShadow;Element.prototype.attachShadow=function(init){const sr=_attach.call(this,init);observeRoot(sr);processAll(sr);return sr};
function pass(){processAll(document.documentElement)}
if(document.readyState==='loading'){addEventListener('DOMContentLoaded',pass,{once:true})}else{pass()}
observeRoot(document.documentElement);
const _ps=history.pushState,_rs=history.replaceState;function onNav(){setTimeout(pass,50)}history.pushState=function(){const r=_ps.apply(this,arguments);onNav();return r};history.replaceState=function(){const r=_rs.apply(this,arguments);onNav();return r};addEventListener('popstate',onNav);
})();
