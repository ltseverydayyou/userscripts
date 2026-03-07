# Media Finder Bridge

Local helper service for `media finder.user.js`. It runs `yt-dlp -j` on your machine and returns the extracted metadata to the userscript over `http://127.0.0.1:38491`.

## Start

```powershell
node .\media-finder-bridge\bridge.js
```

## Install yt-dlp

If `yt-dlp` is not already on PATH, either set `YTDLP_PATH` before starting the bridge, or let the bridge download a local copy:

```powershell
Invoke-RestMethod -Method Post http://127.0.0.1:38491/install-yt-dlp
```

That downloads the binary into `media-finder-bridge\bin\`.

## Health check

```powershell
Invoke-RestMethod http://127.0.0.1:38491/health
```

## Notes

- The userscript calls `POST /extract` and ingests the returned `formats`, `subtitles`, and `thumbnails`.
- This is what makes yt-dlp-style detection possible in a browser userscript: the native extraction still happens locally, outside the browser sandbox.
