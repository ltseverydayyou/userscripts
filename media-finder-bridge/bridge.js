#!/usr/bin/env node
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, spawn } = require('child_process');

const HOST = process.env.MEDIA_FINDER_BRIDGE_HOST || '127.0.0.1';
const PORT = Number(process.env.MEDIA_FINDER_BRIDGE_PORT || 38491);
const ROOT_DIR = __dirname;
const BIN_DIR = path.join(ROOT_DIR, 'bin');
const IS_WIN = process.platform === 'win32';
const YTDLP_NAME = IS_WIN ? 'yt-dlp.exe' : 'yt-dlp';
const LOCAL_YTDLP_PATH = path.join(BIN_DIR, YTDLP_NAME);
const YTDLP_DOWNLOAD_URL = IS_WIN
  ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
  : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(body);
}

function ensureBinDir() {
  fs.mkdirSync(BIN_DIR, { recursive: true });
}

function isExecutableFile(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function findYtDlpOnPath() {
  try {
    const cmd = IS_WIN ? 'where.exe' : 'which';
    const args = IS_WIN ? ['yt-dlp', 'yt-dlp.exe'] : ['yt-dlp'];
    const result = spawnSync(cmd, args, { encoding: 'utf8' });
    if (result.status !== 0) return '';
    const first = String(result.stdout || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    return first || '';
  } catch {
    return '';
  }
}

function resolveYtDlpPath() {
  const envPath = process.env.YTDLP_PATH || process.env.MEDIA_FINDER_YTDLP_PATH || '';
  if (envPath && isExecutableFile(envPath)) return envPath;
  if (isExecutableFile(LOCAL_YTDLP_PATH)) return LOCAL_YTDLP_PATH;
  return findYtDlpOnPath();
}

function getHealth() {
  const ytDlpPath = resolveYtDlpPath();
  return {
    ok: true,
    host: HOST,
    port: PORT,
    ytDlpPath: ytDlpPath || '',
    ytDlpAvailable: !!ytDlpPath,
    localYtDlpPath: LOCAL_YTDLP_PATH
  };
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function splitArgs(value) {
  const text = String(value || '').trim();
  if (!text) return [];
  const out = [];
  const re = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|([^\s]+)/g;
  let match;
  while ((match = re.exec(text))) {
    const token = match[1] ?? match[2] ?? match[3] ?? '';
    if (token) out.push(token.replace(/\\(["'])/g, '$1'));
  }
  return out;
}

function downloadFile(url, destination) {
  return new Promise((resolve, reject) => {
    ensureBinDir();
    const tempPath = destination + '.tmp';
    const file = fs.createWriteStream(tempPath);
    https.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        fs.unlink(tempPath, () => {
          downloadFile(response.headers.location, destination).then(resolve, reject);
        });
        return;
      }
      if (response.statusCode !== 200) {
        file.close();
        fs.unlink(tempPath, () => reject(new Error(`Download failed with status ${response.statusCode}`)));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          fs.rename(tempPath, destination, (renameError) => {
            if (renameError) {
              reject(renameError);
              return;
            }
            if (!IS_WIN) {
              fs.chmod(destination, 0o755, (chmodError) => chmodError ? reject(chmodError) : resolve(destination));
              return;
            }
            resolve(destination);
          });
        });
      });
    }).on('error', (error) => {
      file.close();
      fs.unlink(tempPath, () => reject(error));
    });
  });
}

function runYtDlpJson(options) {
  return new Promise((resolve, reject) => {
    const ytDlpPath = resolveYtDlpPath();
    if (!ytDlpPath) {
      reject(new Error('yt-dlp is not installed. Start the bridge and POST /install-yt-dlp, or set YTDLP_PATH.'));
      return;
    }

    const url = String(options.url || '').trim();
    if (!/^https?:\/\//i.test(url)) {
      reject(new Error('A valid absolute URL is required.'));
      return;
    }

    const args = ['-j', '--no-warnings'];
    if (options.noPlaylist !== false) args.push('--no-playlist');
    if (options.cookiesFromBrowser) args.push('--cookies-from-browser', String(options.cookiesFromBrowser));
    if (options.proxy) args.push('--proxy', String(options.proxy));
    args.push(...splitArgs(options.extraArgs));
    args.push(url);

    const child = spawn(ytDlpPath, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `yt-dlp exited with code ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`Failed to parse yt-dlp JSON: ${error.message}`));
      }
    });
  });
}

async function handleInstall(_req, res) {
  try {
    const pathInstalled = await downloadFile(YTDLP_DOWNLOAD_URL, LOCAL_YTDLP_PATH);
    sendJson(res, 200, { ok: true, ytDlpPath: pathInstalled });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message });
  }
}

async function handleExtract(req, res) {
  try {
    const body = await parseBody(req);
    const metadata = await runYtDlpJson(body || {});
    sendJson(res, 200, {
      ok: true,
      extractor: metadata.extractor_key || metadata.extractor || '',
      metadata
    });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message });
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    sendJson(res, 200, getHealth());
    return;
  }

  if (req.method === 'POST' && req.url === '/install-yt-dlp') {
    await handleInstall(req, res);
    return;
  }

  if (req.method === 'POST' && req.url === '/extract') {
    await handleExtract(req, res);
    return;
  }

  sendJson(res, 404, { ok: false, error: 'Not found' });
});

server.listen(PORT, HOST, () => {
  const health = getHealth();
  console.log(`Media Finder bridge listening on http://${HOST}:${PORT}`);
  if (health.ytDlpAvailable) console.log(`Using yt-dlp: ${health.ytDlpPath}`);
  else console.log(`yt-dlp not found. POST /install-yt-dlp or set YTDLP_PATH.`);
});
