const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto, createCipheriv } = require('node:crypto');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'media finder.user.js'), 'utf8').replace(/\r\n/g, '\n');
const names = ['parseHls', 'ivBytes', 'byteRange', 'rangeData', 'dashUrl', 'durationSecs', 'pickQuality', 'decryptPart', 'requestHeaders', 'rememberReq', 'safeHeaders', 'parseYoutubeCipherUrl', 'norm', 'recordingSource', 'waitRecordMedia', 'waitTracks', 'cleanRecordSource'];
const tail = "  installHooks();\n  if (document.readyState === 'loading')";
assert.ok(source.includes(tail));

function load(fetch, overrides = {}) {
  const window = { fetch };
  window.top = window.self = window;
  const context = vm.createContext({ window, document: {}, navigator: {}, location: new URL('https://lesson.test/watch'), matchMedia: () => ({ matches: false }), globalThis: null, URL, URLSearchParams, TextDecoder, Uint8Array, AbortController, DOMException, crypto: webcrypto, setTimeout, clearTimeout, setInterval, clearInterval, ...overrides });
  context.globalThis = context;
  vm.runInContext(source.slice(0, source.indexOf(tail)) + `globalThis.api = { ${names.join(',')}, seedFound: (url, meta) => found.set(url, meta) };\n})();`, context);
  return context.api;
}

const api = load();
const base = 'https://cdn.test/course/master.m3u8?token=a%2Fb';

test('the userscript and updater use the same metadata', () => {
  const header = source.slice(0, source.indexOf('// ==/UserScript==') + '// ==/UserScript=='.length).trim();
  assert.equal(header, fs.readFileSync(path.join(__dirname, '..', 'media finder.meta.js'), 'utf8').replace(/\r\n/g, '\n').trim());
  assert.match(header, /@connect\s+\*/);
  assert.match(header, /@grant\s+unsafeWindow/);
  assert.doesNotMatch(header, /@noframes/);
});

test('master playlists retain audio groups and signed variant URLs', () => {
  const result = api.parseHls('#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",DEFAULT=YES,URI="audio/list.m3u8?sig=a,b"\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=1280x720,AUDIO="a"\nvideo.m3u8?sig=x%2Fy\n', base);
  assert.equal(result.variants[0].height, 720);
  assert.equal(result.variants[0].url, 'https://cdn.test/course/video.m3u8?sig=x%2Fy');
  assert.equal(result.audio[0].url, 'https://cdn.test/course/audio/list.m3u8?sig=a,b');
});

test('AES keys rotate, sequence numbers keep all 128 bits, and METHOD=NONE clears encryption', () => {
  const result = api.parseHls('#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:9007199254740993\n#EXT-X-KEY:METHOD=AES-128,URI="one.key"\n#EXTINF:1,\none.ts\n#EXT-X-KEY:METHOD=AES-128,URI="two.key",IV=0x1234\ntwo.ts\n#EXT-X-KEY:METHOD=NONE\nthree.ts\n#EXT-X-ENDLIST', base);
  assert.equal(result.parts[0].seq, 9007199254740993n);
  assert.equal(result.parts[1].seq, 9007199254740994n);
  assert.equal(result.parts[1].key.iv, '0x1234');
  assert.equal(result.parts[2].key, null);
  assert.equal(Buffer.from(api.ivBytes('', result.parts[0].seq)).toString('hex'), '00000000000000000020000000000001');
  assert.equal(result.ended, true);
});

test('HLS byte ranges follow the previous range for the same resource', () => {
  const result = api.parseHls('#EXTM3U\n#EXT-X-BYTERANGE:10@5\nall.ts\n#EXT-X-BYTERANGE:20\nall.ts', base);
  assert.equal(result.parts[0].range.start, 5);
  assert.equal(result.parts[1].range.start, 15);
  assert.equal(result.parts[1].range.end, 34);
  assert.throws(() => api.parseHls('#EXTM3U\n#EXT-X-BYTERANGE:10\nall.ts', base), /starting offset/);
});

test('encrypted fMP4 initialization requires its own explicit IV', () => {
  assert.throws(() => api.parseHls('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXT-X-MAP:URI="init.mp4"\na.m4s', base), /explicit IV/);
  const result = api.parseHls('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key",IV=0x01\n#EXT-X-MAP:URI="init.mp4",BYTERANGE="16@0"\na.m4s', base);
  assert.equal(result.parts[0].init.range.end, 15);
  assert.equal(result.parts[0].init.key.iv, '0x01');
});

test('HLS variables resolve declared and query-derived values', () => {
  const result = api.parseHls('#EXTM3U\n#EXT-X-DEFINE:NAME="dir",VALUE="video"\n#EXT-X-DEFINE:QUERYPARAM="token"\n{$dir}/one.ts?auth={$token}', base);
  assert.equal(result.parts[0].url, 'https://cdn.test/course/video/one.ts?auth=a/b');
  assert.throws(() => api.parseHls('#EXTM3U\n{$missing}/one.ts', base), /Missing HLS variable/);
});

test('sample encryption, DRM key formats, missing segments and malformed IVs fail explicitly', () => {
  assert.throws(() => api.parseHls('#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="key"\none.ts', base), /DRM|sample encryption/);
  assert.throws(() => api.parseHls('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,KEYFORMAT="com.apple.streamingkeydelivery",URI="key"', base), /DRM/);
  assert.throws(() => api.parseHls('#EXTM3U\n#EXT-X-GAP\none.ts', base), /missing media/);
  assert.throws(() => api.ivBytes('0xxyz', 1n), /Invalid HLS/);
});

test('byte range responses are checked instead of concatenating wrong data', () => {
  assert.deepEqual(Buffer.from(api.rangeData(Uint8Array.of(1,2,3,4,5), {start:1,end:3}, 200, '')), Buffer.from([2,3,4]));
  assert.deepEqual(Buffer.from(api.rangeData(Uint8Array.of(2,3,4), {start:1,end:3}, 206, 'bytes 1-3/5')), Buffer.from([2,3,4]));
  assert.throws(() => api.rangeData(Uint8Array.of(2,3,4), {start:1,end:3}, 206, 'bytes 0-2/5'), /wrong byte range/);
});

test('Web Crypto decrypts a served AES-128 segment and caches its key', async () => {
  const key = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
  const seq = 9007199254740993n;
  const iv = Buffer.from(api.ivBytes('', seq));
  const plain = Buffer.from('A teaching video segment with PKCS7 padding');
  const cipher = createCipheriv('aes-128-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  let calls = 0;
  const testApi = load(async () => { calls++; return new Response(key, {headers: {'content-type': 'application/octet-stream'}}); });
  const keys = new Map();
  const part = {key:{url:'https://cdn.test/key',base},seq};
  const signal = new AbortController().signal;
  assert.deepEqual(Buffer.from(await testApi.decryptPart(encrypted, part, keys, signal)), plain);
  assert.deepEqual(Buffer.from(await testApi.decryptPart(encrypted, part, keys, signal)), plain);
  assert.equal(calls, 1);
});

test('invalid keys and cancellation do not produce a fake successful download', async () => {
  const testApi = load(async () => new Response(Uint8Array.of(1,2,3)));
  await assert.rejects(testApi.decryptPart(Uint8Array.of(0), {key:{url:'https://cdn.test/key',base},seq:1n}, new Map(), new AbortController().signal), /16-byte/);
  const ctrl = new AbortController();
  ctrl.abort();
  await assert.rejects(testApi.decryptPart(Uint8Array.of(0), {key:{url:'https://cdn.test/key',base},seq:1n}, new Map(), ctrl.signal), {name:'AbortError'});
});

test('DASH templates expand zero padding, time, ID, bandwidth and escaped dollar signs', () => {
  const rep = {getAttribute:name => ({id:'v1',bandwidth:'800000'})[name]};
  assert.equal(api.dashUrl('$$/$RepresentationID$/$Bandwidth$/seg-$Number%05d$-$Time$.m4s',rep,3,2048), '$/v1/800000/seg-00003-2048.m4s');
  assert.equal(api.durationSecs('P1DT2H3M4.5S'), 93784.5);
});

test('credentials are scoped to the observed resource origin and segment ranges replace player ranges', () => {
  api.rememberReq('https://cdn.test/manifest', {Authorization:'Bearer lesson',Range:'bytes=0-1',Cookie:'secret',Accept:'*/*'});
  const same = api.requestHeaders('https://cdn.test/segment','https://cdn.test/manifest',{start:10,end:19},false);
  assert.equal(same.Authorization, 'Bearer lesson');
  assert.equal(same.Range, 'bytes=10-19');
  assert.equal(same.Cookie, undefined);
  const other = api.requestHeaders('https://other.test/segment','https://cdn.test/manifest',null,false);
  assert.equal(other.Authorization, undefined);
});

test('unresolved YouTube ciphers and unsafe schemes are not usable download URLs', () => {
  assert.equal(api.parseYoutubeCipherUrl('url=https%3A%2F%2Fcdn.test%2Fvideo%3Ftoken%3Da%252Fb&s=encrypted'), '');
  assert.equal(api.parseYoutubeCipherUrl('url=https%3A%2F%2Fcdn.test%2Fvideo%3Ftoken%3Da%252Fb&sig=ok'), 'https://cdn.test/video?token=a%2Fb&signature=ok');
  assert.equal(api.norm('javascript:alert(1)'), null);
  assert.equal(api.norm('file:///private/file'), null);
});

test('recording retries use the selected signed file and reject playlists or opaque player sources', () => {
  const file = 'https://cdn.test/lesson/video?token=a%2Fb&expires=123#time';
  assert.equal(api.recordingSource({currentSrc:file,src:'https://other.test/other.mp4'}), file);
  assert.throws(() => api.recordingSource({currentSrc:'blob:https://lesson.test/mse'}), /no directly fetchable/);
  assert.throws(() => api.recordingSource({currentSrc:'javascript:alert(1)'}), /no directly fetchable/);
  assert.throws(() => api.recordingSource({currentSrc:base}), /stream playlist/);
  api.seedFound('https://cdn.test/stream?token=lesson', {mime:'application/dash+xml'});
  assert.throws(() => api.recordingSource({currentSrc:'https://cdn.test/stream?token=lesson'}), /stream playlist/);
});

test('a fetched video waits for both decoded media and seeking to finish', async () => {
  const el = new EventTarget();
  Object.assign(el, {tagName:'VIDEO',readyState:1,videoWidth:0,seeking:true,error:null});
  const ctrl = new AbortController();
  let ready = false;
  const promise = api.waitRecordMedia(el, ctrl.signal).then(() => { ready = true; });
  el.readyState = 2;
  el.dispatchEvent(new Event('loadeddata'));
  await Promise.resolve();
  assert.equal(ready, false);
  el.videoWidth = 320;
  el.dispatchEvent(new Event('loadeddata'));
  await Promise.resolve();
  assert.equal(ready, false);
  el.seeking = false;
  el.dispatchEvent(new Event('seeked'));
  await promise;
  assert.equal(ready, true);
});

test('recording setup can be cancelled during local decoding or waiting for capture tracks', async () => {
  const el = new EventTarget();
  Object.assign(el, {tagName:'VIDEO',readyState:1,videoWidth:0,seeking:false,error:null});
  const ctrl = new AbortController();
  const pending = api.waitRecordMedia(el, ctrl.signal);
  ctrl.abort();
  await assert.rejects(pending, {name:'AbortError'});
  const stream = new EventTarget();
  stream.getTracks = stream.getVideoTracks = () => [];
  const tracks = new AbortController();
  const waiting = api.waitTracks(stream, el, tracks.signal);
  tracks.abort();
  await assert.rejects(waiting, {name:'AbortError'});
  await assert.rejects(api.waitRecordMedia(el, ctrl.signal), {name:'AbortError'});
});

test('recording cleanup releases its temporary source without changing the original player', () => {
  const revoked = [];
  class TestURL extends URL { static revokeObjectURL(url) { revoked.push(url); } }
  const testApi = load(undefined, {URL:TestURL});
  const original = {src:'https://cdn.test/original.mp4',paused:false};
  let stopped = 0;
  let unloaded = false;
  let removed = false;
  const local = new EventTarget();
  local.pause = () => { local.paused = true; };
  local.removeAttribute = name => { unloaded = name === 'src'; };
  local.load = () => {};
  local.remove = () => { removed = true; };
  const track = new EventTarget();
  track.stop = () => { stopped++; };
  const current = {ctrl:new AbortController(),el:original,localEl:local,localURL:'blob:https://lesson.test/copy',stream:{getTracks:()=>[track]},stop:()=>{}};
  testApi.cleanRecordSource(current);
  assert.equal(current.ctrl.signal.aborted, true);
  assert.equal(stopped, 1);
  assert.ok(local.paused && unloaded && removed);
  assert.deepEqual(revoked, ['blob:https://lesson.test/copy']);
  assert.equal(current.localEl, null);
  assert.equal(current.localURL, null);
  assert.deepEqual(original, {src:'https://cdn.test/original.mp4',paused:false});
});
