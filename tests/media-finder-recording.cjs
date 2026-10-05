const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {execFileSync,spawnSync} = require('node:child_process');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {chromium} = require('playwright');
const os = require('node:os');
const root = fs.mkdtempSync(path.join(os.tmpdir(),'media-finder-'));
execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=30','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','9','-c:v','libvpx','-b:v','550k','-c:a','libopus','-y',path.join(root,'nine.webm')]);
const data = fs.readFileSync(path.join(root,'nine.webm'));
let base,cdn;
const handler=(req,res)=>{
  if(req.url.startsWith('/nine.webm')) {const range=req.headers.range?.match(/bytes=(\d+)-(\d*)/);const start=range?Number(range[1]):0;const end=range&&range[2]?Math.min(Number(range[2]),data.length-1):data.length-1;const body=data.subarray(start,end+1);res.writeHead(range?206:200,{'Content-Type':'video/webm','Content-Length':body.length,'Accept-Ranges':'bytes',...(range?{'Content-Range':`bytes ${start}-${end}/${data.length}`}:{})});return res.end(body);}
  if(req.url.startsWith('/partial.webm')) {const range=req.headers.range?.match(/bytes=(\d+)-(\d+)/);const start=range?Number(range[1]):0;const end=Math.min(range?Number(range[2]):65000,data.length-1);const bytes=data.subarray(start,end+1);res.writeHead(206,{'Content-Type':'video/webm','Content-Range':`bytes ${start}-${end}/${data.length}`,'Content-Length':bytes.length});return res.end(bytes);}
  res.writeHead(200,{'Content-Type':'text/html'});res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><title>Nine-second lesson</title>');
};
const serve=async()=>{const s=http.createServer(handler);await new Promise(r=>s.listen(0,'127.0.0.1',r));return s;};
(async()=>{
  let s1,s2,browser;
  try {
  s1=await serve();s2=await serve();base='http://127.0.0.1:'+s1.address().port;cdn='http://127.0.0.1:'+s2.address().port;
  browser=await chromium.launch({...(process.env.MF_BROWSER?{executablePath:process.env.MF_BROWSER}:{}),args:['--no-sandbox','--autoplay-policy=no-user-gesture-required'],headless:true});
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await context.exposeBinding('gmBridge',async(_,d)=>{const r=await fetch(d.url,{headers:d.headers});return{status:r.status,responseHeaders:Array.from(r.headers).map(([k,v])=>k+': '+v).join('\r\n'),finalUrl:r.url,bytes:Array.from(new Uint8Array(await r.arrayBuffer()))};});
  await context.addInitScript(()=>{window.GM_getValue=()=>'';window.GM_setValue=()=>{};window.GM_download=o=>{queueMicrotask(()=>o.onerror({error:'not_supported'}));return{abort(){}};};window.GM_xmlhttpRequest=o=>{let off=false;window.gmBridge({url:o.url,headers:o.headers}).then(r=>{if(!off)o.onload({...r,response:Uint8Array.from(r.bytes).buffer});},()=>o.onerror());return{abort(){off=true;o.onabort?.();}};};});
  await context.addInitScript(()=>{const capture=HTMLMediaElement.prototype.captureStream;HTMLMediaElement.prototype.captureStream=function(...args){if(this.id==='clip')window.__captures=(window.__captures||0)+1;return capture.apply(this,args);};});
  let src=fs.readFileSync(path.join(__dirname,'..','media finder.user.js'),'utf8').replace(/\r\n/g,'\n');
  const tail="  installHooks();\n  if (document.readyState === 'loading')";
  assert.ok(src.includes(tail));
  src=src.replace(tail,"  window.__mf={startRecord,stopRecord,downloadUrl,requestBytes,getRec:()=>rec,getFiles:()=>savedFiles,getStatus:()=>statusText};\n"+tail);
  await context.addInitScript(src);
  const p=await context.newPage();await p.goto(base);
  console.log('codecs',await p.evaluate(()=>Object.fromEntries(['video/mp4','video/mp4;codecs=avc1.42E01E,mp4a.40.2','video/mp4;codecs=avc1.42001E,mp4a.40.2','video/mp4;codecs=avc1.42E01E','video/webm;codecs=vp8,opus'].map(m=>[m,MediaRecorder.isTypeSupported(m)]))));
  const partial=await p.evaluate(async url=>(await window.__mf.requestBytes(url)).data.length,cdn+'/partial.webm');assert.equal(partial,data.length);console.log('PASS: full download assembles all partial-response bytes');
  await p.evaluate(url=>window.__mf.downloadUrl(url),cdn+'/partial.webm');
  assert.equal(await p.evaluate(()=>window.__mf.getFiles()[0].blob.size),data.length);
  const downloadedHash=await p.evaluate(async()=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await window.__mf.getFiles()[0].blob.arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join(''));
  assert.equal(downloadedHash,createHash('sha256').update(data).digest('hex'));
  for(const [label,url,pos,full,detach,toFile]of[['full-native',base+'/nine.webm',8,true,false,false],['full-cross-detached',cdn+'/nine.webm',8,true,true,false],['from-here',cdn+'/nine.webm',8,false,false,false],['full-writer',base+'/nine.webm',8,true,false,true],['no-link','',0,true,false,false],['mobile-1080p60','',0,true,false,false],['budget-stop',base+'/nine.webm',8,true,false,false]]) {
    await p.evaluate(()=>window.__captures=0);
    if(!url) {
      await p.evaluate(async large=>{
        const canvas=document.createElement('canvas');canvas.width=large?1920:320;canvas.height=large?1080:180;const ctx=canvas.getContext('2d');let n=0;
        window.__draw=setInterval(()=>{ctx.fillStyle=n++%2?'#ff6600':'#3366ff';ctx.fillRect(0,0,canvas.width,canvas.height);},33);
        const ac=new AudioContext();const osc=ac.createOscillator();const gain=ac.createGain();gain.gain.value=0.12;const dest=ac.createMediaStreamDestination();osc.connect(gain);gain.connect(dest);osc.start();await ac.resume();window.__audio=ac;
        const video=document.createElement('video');video.id='clip';video.muted=true;video.srcObject=new MediaStream([...canvas.captureStream(large?60:30).getVideoTracks(),...dest.stream.getAudioTracks()]);document.body.appendChild(video);await video.play();
      },label==='mobile-1080p60');
    } else await p.evaluate(async({url,pos})=>{const el=document.createElement('video');el.id='clip';el.muted=true;el.loop=true;el.preload='auto';el.src=url;document.body.appendChild(el);await el.play();el.pause();el.currentTime=pos;}, {url,pos});
    await p.waitForFunction(()=>{const e=document.querySelector('#clip');return e.readyState>=2&&!e.seeking;});
    if(toFile) await p.evaluate(()=>{window.__file=new Uint8Array();window.showSaveFilePicker=async()=>({createWritable:async()=>({write:async value=>{const cmd=value.type==='write';const bytes=cmd?new Uint8Array(value.data):new Uint8Array(await value.arrayBuffer());const at=cmd?value.position:window.__file.length;const next=new Uint8Array(Math.max(window.__file.length,at+bytes.length));next.set(window.__file);next.set(bytes,at);window.__file=next;},close:async()=>window.__closed=true,abort:async()=>{}})});});
    await p.evaluate(({full,toFile})=>window.__mf.startRecord('player',toFile,document.querySelector('#clip'),undefined,full),{full,toFile});
    if(url) assert.equal(await p.evaluate(()=>window.__captures),1,'Recording must capture the player once');
    assert.ok(await p.evaluate(()=>window.__mf.getRec().memoryLimit<=64*1024*1024));
    if(label==='budget-stop') await p.evaluate(()=>window.__mf.getRec().memoryLimit=8*1024*1024+4096);
    await p.evaluate(()=>{const r=window.__mf.getRec();window.__mime=r.mime;window.__name=r.name;});
    const started=Date.now();console.log(label,'started',await p.evaluate(()=>{const r=window.__mf.getRec();return{mime:r?.mime,pos:(r?.localEl||document.querySelector('#clip')).currentTime};}));
    if(detach) {await p.waitForTimeout(1100);await p.evaluate(()=>document.querySelector('#clip').remove());assert.ok(await p.evaluate(()=>window.__mf.getRec()?.recorder.state==='recording'));}
    if(full&&!toFile&&label!=='budget-stop') {await p.waitForTimeout(2100);assert.ok(await p.evaluate(()=>window.__mf.getRec().chunks.length>0&&window.__mf.getRec().size>0),'Encoded chunks must be delivered while recording');}
    if(!url) {await p.waitForTimeout(Math.max(0,9050-(Date.now()-started)));await p.evaluate(()=>window.__mf.stopRecord());}
    await p.waitForFunction(()=>!window.__mf.getRec(),{}, {timeout:14000});
    if(label==='budget-stop') assert.match(await p.evaluate(()=>window.__mf.getStatus()),/memory limit/);
    const out=await p.evaluate(async toFile=>{const f=toFile?{name:window.__name,blob:new Blob([window.__file],{type:window.__mime})}:window.__mf.getFiles()[0];window.__out=f.blob;const reader=new FileReader();const url=await new Promise((r,j)=>{reader.onload=()=>r(reader.result);reader.onerror=j;reader.readAsDataURL(f.blob);});return{name:f.name,encoded:url.split(',').at(-1)};},toFile);
    const file=path.join(root,label+'.'+out.name.split('.').pop());fs.writeFileSync(file,Buffer.from(out.encoded,'base64'));
    const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-count_frames','-show_entries','format=duration:stream=codec_type,codec_name,nb_read_frames,width,height','-of','json',file],{encoding:'utf8'}));
    const decoded=spawnSync('ffmpeg',['-v','info','-xerror','-i',file,'-map','0','-af','volumedetect','-f','null','-'],{encoding:'utf8'});
    assert.equal(decoded.status,0,decoded.stderr);
    assert.ok(Number(decoded.stderr.match(/max_volume: (-?[\d.]+) dB/)?.[1])>-60,'The recorded audio must contain the source sound');
    const wanted=label==='budget-stop'?1:full?9:1;
    assert.ok(Math.abs(Number(probe.format.duration)-wanted)<0.3,JSON.stringify(probe));
    assert.ok(probe.streams.some(s=>s.codec_type==='video')&&probe.streams.some(s=>s.codec_type==='audio'));
    assert.ok(probe.streams.some(s=>s.codec_type==='video'&&Number(s.nb_read_frames)>=wanted*25),JSON.stringify(probe));
    assert.ok(probe.streams.some(s=>s.codec_type==='audio'&&Number(s.nb_read_frames)>=wanted*10),JSON.stringify(probe));
    if(label==='mobile-1080p60') {const video=probe.streams.find(s=>s.codec_type==='video');assert.equal(video.width,1280);assert.equal(video.height,720);assert.ok(Number(video.nb_read_frames)<=285,JSON.stringify(probe));}
    const playback=await p.evaluate(async wanted=>{const e=document.createElement('video');e.muted=true;const u=URL.createObjectURL(window.__out);e.src=u;document.body.appendChild(e);await new Promise((r,j)=>{e.onloadedmetadata=r;e.onerror=()=>j(Error('Cannot open saved recording'));});const duration=e.duration;e.currentTime=Math.max(0,wanted-0.6);await e.play();await new Promise((r,j)=>{e.onended=r;e.onerror=()=>j(Error('Cannot play saved recording'));setTimeout(()=>j(Error('Saved playback timed out')),3000);});const time=e.currentTime;e.remove();URL.revokeObjectURL(u);return {duration,end:time};},wanted);
    assert.ok(Number.isFinite(playback.duration)&&Math.abs(playback.duration-wanted)<0.3);
    console.log(label,JSON.stringify({recordMs:Date.now()-started,probe,playback}));
    if(!url) {assert.ok(await p.evaluate(()=>document.querySelector('#clip').srcObject.getTracks().every(t=>t.readyState==='live')));await p.evaluate(async()=>{clearInterval(window.__draw);document.querySelector('#clip').srcObject.getTracks().forEach(t=>t.stop());await window.__audio.close();});}
    await p.evaluate(()=>document.querySelector('#clip')?.remove());
  }
  } finally {
    await browser?.close();
    for(const server of [s1,s2]) if(server) {server.closeAllConnections();await new Promise(r=>server.close(r));}
    fs.rmSync(root,{recursive:true,force:true});
  }
})().catch(e=>{console.error(e);process.exit(1);});
