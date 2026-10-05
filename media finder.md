# Media Finder

Install or update [the userscript](https://github.com/ltseverydayyou/userscripts/raw/main/media%20finder.user.js) in a userscript manager. Version 1.9.0 adds cross-origin request permissions and frame detection, so reinstalling the updated script may be necessary if your manager retains old permissions. Allow the media host when the manager asks.

Version 1.9.1 fixes recording setup stopping immediately on `Cannot capture from element with cross-origin data`. An accessible direct media file now gets a fetch-and-record retry, with cancellable setup and clear instructions when that retry is unavailable.

Version 1.9.2 fixes partial files being accepted as complete downloads and adds recording duration finalization. The default **Beginning — full video** mode records a seekable video from zero at normal speed. Use **Current position** when you want only the remaining portion.

Version 1.9.3 reduces recording startup and memory pressure on mobile: one capture stream per player, timed output chunks, smaller source/output buffers, and a 720p/30fps cap for large or high-frame-rate players. It also releases prior download URLs and pauses the original player while recording a fetched copy.

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

If direct player capture is blocked by cross-origin security, Media Finder tries fetching that player's exact media URL using browser requests and the userscript manager's cross-origin requests. When the file is accessible and playable, it records a muted local copy from the beginning or the selected current position. The status says **Recording fetched copy**. This copy plays independently of the page's player and continues if the page removes that original player; use Media Finder's recording controls to pause or resume it. The original player's source and cross-origin settings are preserved. If it was playing, it is paused during recording and resumed afterward when still present, avoiding two players decoding at once. The local copy ending also saves the recording.

Desktop recording prefers explicitly supported H.264/AAC MP4; mobile prefers VP8/Opus WebM. Unsupported combinations fall back to the available formats. The bitrate follows video resolution and is capped at 3 Mbps on mobile. Output is collected in timed chunks; all chunks, including the final chunk after Stop, are combined before saving. WebM output receives finite duration metadata, excluding time spent paused. Recordings stopped before the selected video portion ends report how much was saved. Keep the generated extension: a WebM recording is not an MP4 file.

The full source file must be fetched before this retry can start. **Cancel recording setup** aborts that fetch. Source retries first request a bounded byte range and reject an oversized total before fetching the remainder. Their limit is 32 MiB on mobile/touch devices and 384 MiB elsewhere. **Record to file** avoids buffering the recording output, but still requires the source fetch. For larger source files, use **Download** or the optional native bridge.

Opaque `blob:` player streams have no directly fetchable file for this retry. HLS/DASH playlists should use **Download**. Expired links, inaccessible files, formats the browser cannot play, and DRM give a clear failure with the available alternatives. Tab / screen capture needs a separate tap and browser sharing selection.

**Record tab / screen** is a separate fallback on browsers that offer display capture. The browser asks which tab, window, or screen to record. Share its audio when offered. Some browsers provide only video; the recording status reports a missing audio track. This option is commonly unavailable on mobile, so its button appears only when the API exists.

**Record to file** writes recording chunks to a chosen file on browsers with a file picker and writable file support. WebM duration is patched before the file closes. This is useful for long recordings. The write queue is bounded; a file that cannot keep up fails explicitly. Ordinary in-memory downloads have a 256 MiB limit on mobile/touch devices and 768 MiB elsewhere. In-memory recordings have a separate 64 MiB budget on mobile and 768 MiB elsewhere, with room reserved for finalization. The watchdog checks delivered chunk sizes and a bitrate estimate between deliveries. Approaching the budget stops and saves the recorded portion; **Record to file** avoids this output buffering. Starting another job releases the previous download URLs, captured tracks, and temporary recording surfaces.

DRM systems such as Widevine, PlayReady, and FairPlay are not decrypted. SAMPLE-AES and protected DASH are reported as unsupported. Browser security rules can also prevent direct capture of cross-origin media. Use the site's own download option for protected videos; tab capture may also be blocked or blank for protected content. Media Finder cannot guarantee a usable download from every site.

## Mobile

Portrait and landscape use the available visual viewport, including browser bars and keyboard changes. Extra toolbar actions move into **Customize** on narrow/touch screens. Media actions use a two-column layout, previews occupy their own overlay, and results scroll within the panel. The top action row scrolls horizontally on very narrow screens, keeping Close available.

Large or high-frame-rate mobile players are recorded through a smaller surface: up to 1280×720 in landscape or 720×1280 in portrait, at 30fps. Audio stays in the same recording. **Download** preserves the source quality. These limits reduce resource use; a native browser/driver crash cannot be caught by the userscript. A screenshot of “Aw, Snap!” alone does not identify the underlying crash.

The existing optional [yt-dlp bridge](media-finder-bridge/README.md) remains available for supported extractor sites. It is not required for the new stream downloader or player recorder.

## Checks

Run the core regression tests with Node 20 or newer:

```sh
node --test tests/media-finder.test.cjs
```

The update was also tested in a headless browser using local fixtures for encrypted and fragmented HLS, signed queries, ignored byte ranges, redirected playlists, clear DASH audio/video, cancellation, frame/shadow discovery, player and embedded-player recording, and portrait/landscape layout. A real cross-origin video without CORS reproduced the capture error and then recorded through the source retry, including video and audio. Checks cover fetched-copy pause/resume, playback-end saving, source-fetch cancellation, and temporary-source cleanup. Saved media was inspected with FFprobe. These fixtures do not establish compatibility with every browser, userscript manager, or teaching-video site.

The complete-recording regression generates a nine-second video, checks partial-response downloads, records from the beginning and current position, removes a cross-origin player's original element, exercises the writable-file output, and records a player with no media URL. It verifies a single startup capture, output chunks arriving during recording, a 1080p/60fps source recorded at 720p/30fps, and clean early saving at a reduced memory budget. Every saved recording is decoded with FFmpeg, checked for audible source audio, inspected for frame counts and finite duration with FFprobe, then reopened and seeked in the browser. These tests use desktop Chromium with touch/portrait emulation; they do not reproduce the reported Android native crash.

With FFmpeg/FFprobe on PATH, install the optional browser test dependencies and run:

```sh
npm install --no-save playwright
npx playwright install chromium
node tests/media-finder-recording.cjs
```

`MF_BROWSER` can select an existing Chromium/headless-shell executable. The test uses temporary fixtures and removes them when it finishes.

API references: [HLS encryption and playlist format](https://www.rfc-editor.org/rfc/rfc8216), [HTTP Content-Range](https://www.rfc-editor.org/rfc/rfc9110.html#name-content-range), [WebM container metadata](https://www.webmproject.org/docs/container/), [Tampermonkey requests and permissions](https://www.tampermonkey.net/documentation.php#api:GM_xmlhttpRequest), [media element capture](https://www.w3.org/TR/mediacapture-fromelement/), [MediaRecorder](https://www.w3.org/TR/mediastream-recording/), [display capture](https://www.w3.org/TR/screen-capture/).
