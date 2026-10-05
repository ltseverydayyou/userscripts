# Media Finder

Install or update [the userscript](https://github.com/ltseverydayyou/userscripts/raw/main/media%20finder.user.js) in a userscript manager. Version 1.9.0 adds cross-origin request permissions and frame detection, so reinstalling the updated script may be necessary if your manager retains old permissions. Allow the media host when the manager asks.

Version 1.9.1 fixes recording setup stopping immediately on `Cannot capture from element with cross-origin data`. An accessible direct media file now gets a fetch-and-record retry, with cancellable setup and clear instructions when that retry is unavailable.

Version 1.9.2 fixes partial files being accepted as complete downloads and adds recording duration finalization. The default **Beginning — full video** mode records a seekable video from zero at normal speed. Use **Current position** when you want only the remaining portion.

## Download

1. Open the page and press play. Media Finder watches player sources, page requests, JSON player data, open shadow roots, and embedded frames where the script can run.
2. Open Media Finder and select **Download** on the media or playlist. **Stream quality** under **Players & recording** controls HLS/DASH video quality.
3. Follow the progress message. **Cancel** aborts the transfer. **Save again** retries saving a completed file when a mobile browser blocks an automatic download. For separate tracks, choose the video or audio file beside that button.

The downloader handles ordinary files, HLS master/media playlists, served AES-128 keys and key rotation, initialization segments, byte ranges, redirects, and common static DASH SegmentTemplate/SegmentTimeline/SegmentList layouts. Signed URLs are kept intact; relative same-origin stream resources can retry with the parent playlist's query parameters when the server rejects the initial request. Requests reuse observed authentication headers only within the resource's origin.

Ordinary downloads fetch and validate the complete response before saving. HTTP 206 partial responses are assembled by requesting the remaining byte ranges, checking their lengths and file validators. Missing range metadata, changing files, and incomplete responses fail instead of being saved as a completed video. Large files that exceed the browser buffer limit can use the userscript manager's native download. File extensions follow the detected container where possible.

Multiplexed HLS normally saves a `.ts` file; fragmented MP4 saves `.mp4`. HLS/DASH with separate audio saves separate video and audio files. These are not merged in the browser. Recording the playing video is the built-in way to create a single file with both tracks.

A live HLS download saves the currently available playlist window. Use recording for a longer live session. Dynamic DASH, multi-period DASH, changing fMP4 initialization, and missing segments give an explicit error instead of producing an incomplete file labeled as successful.

## Record a player

1. Press play, open **Players & recording**, and choose the player. An embedded player is marked **embedded**.
2. Choose **Beginning — full video** or **Current position**, then tap **Record player**. Beginning is the default and restarts a seekable video at normal speed. Its page-player loop is disabled for that recording and restored afterward. Live or non-seekable players record from their current position. A direct media link is not required for player capture.
3. Use **Pause recording**, **Resume recording**, and **Stop & save**. A small stop bar remains available when the main panel closes. Playback ending also saves the recording.

If direct player capture is blocked by cross-origin security, Media Finder tries fetching that player's exact media URL using browser requests and the userscript manager's cross-origin requests. When the file is accessible and playable, it records a muted local copy from the beginning or the selected current position. The status says **Recording fetched copy**. This copy plays independently of the page's player and continues if the page removes that original player; use Media Finder's recording controls to pause or resume it. The original player's source and cross-origin settings are preserved. The local copy ending also saves the recording.

Recording prefers explicitly supported H.264/AAC MP4 or VP8/Opus WebM, using a bitrate based on video resolution. In-memory recording waits for the recorder's complete final Blob before saving. WebM output receives finite duration metadata, excluding time spent paused. Recordings stopped before the selected video portion ends report how much was saved. Keep the generated extension: a WebM recording is not an MP4 file.

The full source file must be fetched before this retry can start. **Cancel recording setup** aborts that fetch. To reserve memory for recording, source retries are limited to 128 MiB on touch devices and 384 MiB elsewhere, and their size is counted against the recording memory limit. **Record to file** avoids buffering the recording output, but still requires the source fetch. For larger files, use **Download** or the optional native bridge.

Opaque `blob:` player streams have no directly fetchable file for this retry. HLS/DASH playlists should use **Download**. Expired links, inaccessible files, formats the browser cannot play, and DRM give a clear failure with the available alternatives. Tab / screen capture needs a separate tap and browser sharing selection.

**Record tab / screen** is a separate fallback on browsers that offer display capture. The browser asks which tab, window, or screen to record. Share its audio when offered. Some browsers provide only video; the recording status reports a missing audio track. This option is commonly unavailable on mobile, so its button appears only when the API exists.

**Record to file** writes recording chunks to a chosen file on browsers with a file picker and writable file support. WebM duration is patched before the file closes. This is useful for long recordings. Ordinary in-memory downloads have a 256 MiB limit on touch devices and 768 MiB elsewhere. While an in-memory recording buffers inside the browser, its displayed size and memory watchdog use the configured bitrate as an estimate. Approaching that budget stops and saves the recorded portion; **Record to file** avoids this output buffering.

DRM systems such as Widevine, PlayReady, and FairPlay are not decrypted. SAMPLE-AES and protected DASH are reported as unsupported. Browser security rules can also prevent direct capture of cross-origin media. Use the site's own download option for protected videos; tab capture may also be blocked or blank for protected content. Media Finder cannot guarantee a usable download from every site.

## Mobile

Portrait and landscape use the available visual viewport, including browser bars and keyboard changes. Extra toolbar actions move into **Customize** on narrow/touch screens. Media actions use a two-column layout, previews occupy their own overlay, and results scroll within the panel. The top action row scrolls horizontally on very narrow screens, keeping Close available.

The existing optional [yt-dlp bridge](media-finder-bridge/README.md) remains available for supported extractor sites. It is not required for the new stream downloader or player recorder.

## Checks

Run the core regression tests with Node 20 or newer:

```sh
node --test tests/media-finder.test.cjs
```

The update was also tested in a headless browser using local fixtures for encrypted and fragmented HLS, signed queries, ignored byte ranges, redirected playlists, clear DASH audio/video, cancellation, frame/shadow discovery, player and embedded-player recording, and portrait/landscape layout. A real cross-origin video without CORS reproduced the capture error and then recorded through the source retry, including video and audio. Checks cover fetched-copy pause/resume, playback-end saving, source-fetch cancellation, and temporary-source cleanup. Saved media was inspected with FFprobe. These fixtures do not establish compatibility with every browser, userscript manager, or teaching-video site.

The complete-recording regression generates a nine-second video, checks partial-response downloads, records from the beginning and current position, removes a cross-origin player's original element, exercises the writable-file output, and records a player with no media URL. Every saved recording is decoded with FFmpeg, inspected for video/audio and finite duration with FFprobe, then reopened and seeked in the browser.

With FFmpeg/FFprobe on PATH, install the optional browser test dependencies and run:

```sh
npm install --no-save playwright
npx playwright install chromium
node tests/media-finder-recording.cjs
```

`MF_BROWSER` can select an existing Chromium/headless-shell executable. The test uses temporary fixtures and removes them when it finishes.

API references: [HLS encryption and playlist format](https://www.rfc-editor.org/rfc/rfc8216), [HTTP Content-Range](https://www.rfc-editor.org/rfc/rfc9110.html#name-content-range), [WebM container metadata](https://www.webmproject.org/docs/container/), [Tampermonkey requests and permissions](https://www.tampermonkey.net/documentation.php#api:GM_xmlhttpRequest), [media element capture](https://www.w3.org/TR/mediacapture-fromelement/), [MediaRecorder](https://www.w3.org/TR/mediastream-recording/), [display capture](https://www.w3.org/TR/screen-capture/).
