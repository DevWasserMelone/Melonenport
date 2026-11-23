const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, Menu, net } = require('electron');
const path = require('path');
const fs = require('fs');

let autoUpdater = null;
try { autoUpdater = require('electron-updater').autoUpdater; } catch (e) { autoUpdater = null; }

const REPO_DEFAULT = 'DevWasserMelone/Melonenkonverter';
const ROOT = path.join(__dirname, '..');
const ICON = path.join(ROOT, 'build', 'icon.png');
const USER = app.getPath('userData');
const CONTENT = path.join(USER, 'content');
const PUBFILE = path.join(USER, 'publisher.json');

let launcherWin = null, appWin = null, watcher = null, pendingFiles = [];

// ---------- Versionen ----------
function cmp(a, b) {
  const pa = String(a || '0').split('.').map(Number), pb = String(b || '0').split('.').map(Number);
  for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d > 0 ? 1 : -1; }
  return 0;
}
function readJson(p, def) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return def; } }
function bundled() { return readJson(path.join(ROOT, 'app', 'version.json'), { version: '1.0.0' }); }
function downloaded() { return readJson(path.join(CONTENT, 'version.json'), null); }
function current() {
  const b = bundled(), d = downloaded();
  if (d && fs.existsSync(path.join(CONTENT, 'index.html')) && cmp(d.version, b.version) >= 0) return { ...d, file: path.join(CONTENT, 'index.html') };
  return { ...b, file: path.join(ROOT, 'app', 'index.html') };
}

// ---------- GitHub ----------
function pub() {
  const d = readJson(PUBFILE, {});
  let token = '';
  try {
    if (d.token && d.enc && safeStorage.isEncryptionAvailable()) token = safeStorage.decryptString(Buffer.from(d.token, 'base64'));
    else if (d.token) token = Buffer.from(d.token, 'base64').toString('utf8');
  } catch (e) { token = ''; }
  return { repo: d.repo || REPO_DEFAULT, token };
}
function repo() { return pub().repo; }

async function gh(url, opts = {}) {
  const headers = Object.assign({ 'User-Agent': 'Melonenkonverter', 'Cache-Control': 'no-cache' }, opts.headers || {});
  const res = await net.fetch(url, Object.assign({}, opts, { headers, cache: 'no-store' }));
  return res;
}
async function getRemoteFile(file, raw) {
  const res = await gh(`https://api.github.com/repos/${repo()}/contents/${file}?ref=main&t=${Date.now()}`, {
    headers: { Accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json' }
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('GitHub antwortet mit Fehler ' + res.status);
  return raw ? Buffer.from(await res.arrayBuffer()) : await res.json();
}

// ---------- Fenster ----------
function openLauncher() {
  launcherWin = new BrowserWindow({
    width: 460, height: 600, resizable: false, maximizable: false, backgroundColor: '#141619', icon: ICON,
    title: 'Melonenkonverter Launcher', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  launcherWin.loadFile(path.join(ROOT, 'launcher', 'index.html'));
  launcherWin.once('ready-to-show', () => launcherWin.show());
  launcherWin.on('closed', () => { launcherWin = null; });
}

function openApp() {
  const c = current();
  appWin = new BrowserWindow({
    width: 1280, height: 800, minWidth: 980, minHeight: 600, backgroundColor: '#141619', icon: ICON,
    title: 'Melonenkonverter', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  appWin.loadFile(c.file);
  appWin.once('ready-to-show', () => appWin.show());
  appWin.webContents.on('did-finish-load', () => {
    if (pendingFiles.length) { appWin.webContents.send('a:open', pendingFiles); pendingFiles = []; }
  });
  appWin.on('closed', () => { appWin = null; stopWatch(); });
  if (launcherWin) launcherWin.close();
}

function p3dArgs(argv) {
  return argv.slice(1).filter(a => /\.p3d$/i.test(a) && fs.existsSync(a));
}

// ---------- Start ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (e, argv) => {
    const files = p3dArgs(argv);
    if (appWin) {
      if (files.length) appWin.webContents.send('a:open', files);
      if (appWin.isMinimized()) appWin.restore();
      appWin.focus();
    } else if (files.length) { pendingFiles = files; openApp(); }
    else if (launcherWin) launcherWin.focus();
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    const files = p3dArgs(process.argv);
    if (files.length) { pendingFiles = files; openApp(); } else openLauncher();
    setupUpdater();
  });
  app.on('window-all-closed', () => app.quit());
}

// ---------- Programm-Updates (neue .exe) ----------
function setupUpdater() {
  if (!autoUpdater || !app.isPackaged) return;
  autoUpdater.autoDownload = false;
  const send = (ch, d) => { if (launcherWin) launcherWin.webContents.send(ch, d); };
  autoUpdater.on('update-available', i => send('l:prog', { state: 'available', version: i.version }));
  autoUpdater.on('download-progress', p => send('l:prog', { state: 'progress', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', () => send('l:prog', { state: 'ready' }));
  autoUpdater.on('error', err => send('l:prog', { state: 'error', message: String(err && err.message || err) }));
}
ipcMain.handle('l:progCheck', async () => {
  if (!autoUpdater || !app.isPackaged) return false;
  try { await autoUpdater.checkForUpdates(); return true; } catch (e) { return false; }
});
ipcMain.handle('l:progDownload', async () => { if (autoUpdater) await autoUpdater.downloadUpdate(); });
ipcMain.handle('l:progInstall', () => { if (autoUpdater) autoUpdater.quitAndInstall(false, true); });

// ---------- Launcher ----------
ipcMain.handle('l:info', () => {
  const p = pub();
  return { program: app.getVersion(), content: current().version, publisher: !!p.token, repo: p.repo };
});
ipcMain.handle('l:check', async () => {
  const buf = await getRemoteFile('content/version.json', true);
  if (!buf) return { remote: null, update: false };
  const remote = JSON.parse(buf.toString('utf8'));
  return { remote, update: cmp(remote.version, current().version) > 0 };
});
ipcMain.handle('l:update', async () => {
  const v = await getRemoteFile('content/version.json', true);
  const html = await getRemoteFile('content/index.html', true);
  if (!v || !html) throw new Error('Auf GitHub wurde keine Version gefunden.');
  fs.mkdirSync(CONTENT, { recursive: true });
  fs.writeFileSync(path.join(CONTENT, 'index.html.tmp'), html);
  fs.renameSync(path.join(CONTENT, 'index.html.tmp'), path.join(CONTENT, 'index.html'));
  fs.writeFileSync(path.join(CONTENT, 'version.json'), v);
  return JSON.parse(v.toString('utf8')).version;
});
ipcMain.handle('l:start', () => openApp());

// ---------- Veröffentlichen (nur mit Token sichtbar) ----------
ipcMain.handle('l:pubGet', () => { const p = pub(); return { repo: p.repo, hasToken: !!p.token }; });
ipcMain.handle('l:pubSave', (e, d) => {
  const out = { repo: (d.repo || REPO_DEFAULT).trim() };
  const old = pub();
  const token = d.token === undefined ? old.token : String(d.token || '').trim();
  if (token) {
    if (safeStorage.isEncryptionAvailable()) { out.token = safeStorage.encryptString(token).toString('base64'); out.enc = true; }
    else out.token = Buffer.from(token, 'utf8').toString('base64');
  }
  fs.mkdirSync(USER, { recursive: true });
  fs.writeFileSync(PUBFILE, JSON.stringify(out));
  return { repo: out.repo, hasToken: !!token };
});
ipcMain.handle('l:pubPick', async () => {
  const r = await dialog.showOpenDialog(launcherWin, { title: 'Neue Programmdatei wählen', filters: [{ name: 'HTML', extensions: ['html'] }], properties: ['openFile'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('l:publish', async (e, d) => {
  const { token, repo: rp } = pub();
  if (!token) throw new Error('Kein Token gespeichert.');
  const html = fs.readFileSync(d.file);
  if (!/<html/i.test(html.toString('utf8', 0, 4000))) throw new Error('Das ist keine gültige index.html.');
  const version = String(d.version || '').trim();
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Version bitte im Format 1.0.1 angeben.');
  const auth = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' };
  async function put(file, buf, msg) {
    let sha;
    const r0 = await gh(`https://api.github.com/repos/${rp}/contents/${file}?ref=main&t=${Date.now()}`, { headers: auth });
    if (r0.ok) sha = (await r0.json()).sha;
    else if (r0.status === 401) throw new Error('Der Token ist ungültig oder abgelaufen.');
    else if (r0.status !== 404) throw new Error('GitHub-Fehler ' + r0.status);
    const r = await gh(`https://api.github.com/repos/${rp}/contents/${file}`, {
      method: 'PUT', headers: auth,
      body: JSON.stringify({ message: msg, content: buf.toString('base64'), sha, branch: 'main' })
    });
    if (!r.ok) {
      let m = ''; try { m = (await r.json()).message; } catch (x) {}
      if (r.status === 403 || r.status === 404) throw new Error('Keine Schreibrechte. Prüfe beim Token „Contents: Read and write“ und das Repository.');
      throw new Error('GitHub-Fehler ' + r.status + (m ? ': ' + m : ''));
    }
  }
  await put('content/index.html', html, 'Inhalt ' + version);
  const vj = Buffer.from(JSON.stringify({ version, date: new Date().toISOString().slice(0, 10), changelog: d.changelog || '' }, null, 2));
  await put('content/version.json', vj, 'Version ' + version);
  // eigene Kopie direkt aktualisieren
  fs.mkdirSync(CONTENT, { recursive: true });
  fs.writeFileSync(path.join(CONTENT, 'index.html'), html);
  fs.writeFileSync(path.join(CONTENT, 'version.json'), vj);
  return version;
});

// ---------- Programm (Konverter) ----------
ipcMain.handle('a:version', () => current().version);
ipcMain.handle('a:pickFiles', async () => {
  const r = await dialog.showOpenDialog(appWin, { title: 'Dateien wählen', filters: [{ name: 'Modelle, Texturen und Archive', extensions: ['p3d', 'xob', 'obj', 'mtl', 'paa', 'pac', 'edds', 'emat', 'png', 'jpg', 'pbo', 'pak', 'zip'] }], properties: ['openFile', 'multiSelections'] });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle('a:pickFolder', async () => {
  const r = await dialog.showOpenDialog(appWin, { title: 'Ordner wählen', properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
function fsMsg(err, what) {
  const c = err && err.code;
  if (c === 'ENOENT') return what + ': Datei oder Ordner nicht gefunden.';
  if (c === 'EACCES' || c === 'EPERM') return what + ': Keine Berechtigung. Wähle rechts einen anderen Speicherort (z. B. „Eigener Ordner“).';
  if (c === 'EBUSY') return what + ': Die Datei ist gerade in einem anderen Programm geöffnet (z. B. Blender). Schließ sie dort und versuch es nochmal.';
  if (c === 'ENOSPC') return what + ': Die Festplatte ist voll.';
  if (c === 'EROFS') return what + ': Der Ordner ist schreibgeschützt.';
  return what + ': ' + (err && err.message || err);
}
// große Dateien stückweise lesen (kein Größenlimit)
ipcMain.handle('a:fileSize', (e, p) => { try { return fs.statSync(p).size; } catch (err) { throw new Error(fsMsg(err, 'Lesen fehlgeschlagen')); } });
ipcMain.handle('a:readRange', (e, p, off, len) => {
  let fd;
  try {
    fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(len);
    const n = fs.readSync(fd, buf, 0, len, off);
    return new Uint8Array(buf.buffer, buf.byteOffset, n);
  } catch (err) { throw new Error(fsMsg(err, 'Lesen fehlgeschlagen')); }
  finally { if (fd !== undefined) try { fs.closeSync(fd); } catch (x) {} }
});
ipcMain.handle('a:read', (e, p) => {
  try { return new Uint8Array(fs.readFileSync(p)); } catch (err) { throw new Error(fsMsg(err, 'Lesen fehlgeschlagen')); }
});
ipcMain.handle('a:write', (e, dir, files) => {
  try {
    fs.mkdirSync(dir, { recursive: true });
    for (const f of files) {
      const name = path.basename(f.name);
      fs.writeFileSync(path.join(dir, name), typeof f.data === 'string' ? f.data : Buffer.from(f.data));
    }
  } catch (err) { throw new Error(fsMsg(err, 'Speichern fehlgeschlagen')); }
  return true;
});
ipcMain.handle('a:openFolder', (e, dir) => shell.openPath(dir));
ipcMain.handle('a:bridgeDir', () => {
  const d = path.join(app.getPath('home'), 'Melonenkonverter-Blender');
  try { fs.mkdirSync(d, { recursive: true }); } catch (e) {}
  return d;
});
ipcMain.handle('a:showItem', (e, p) => shell.showItemInFolder(p));
// KI-Anfrage über das Programm schicken (kein Browser-CORS, Proxy-Einstellungen von Windows)
// kostenlose Online-Bild-KI (ohne Konto)
ipcMain.handle('a:httpGetImage', async (e, url) => {
  if (!/^https:\/\/(image|gen)\.pollinations\.ai\//.test(url)) throw new Error('Ungültige Adresse');
  const res = await net.fetch(url, { headers: { 'User-Agent': 'Melonenkonverter' } });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, ok: res.ok, type: res.headers.get('content-type') || '', data: buf.toString('base64') };
});
// lokale Bild-KI (Stable Diffusion WebUI / Forge mit --api) auf diesem PC
ipcMain.handle('a:localSD', async (e, base, body) => {
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base)) throw new Error('Nur lokale Adressen erlaubt');
  let res;
  try { res = await net.fetch(base + '/sdapi/v1/txt2img', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }); }
  catch (x) { return { status: 0, ok: false, json: null }; }
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch (x) {}
  return { status: res.status, ok: res.ok, json };
});
ipcMain.handle('a:aiRequest', async (e, url, key, body) => {
  if (!/^https:\/\/generativelanguage\.googleapis\.com\//.test(url)) throw new Error('Ungültige Adresse');
  const res = await net.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch (x) {}
  return { status: res.status, ok: res.ok, json };
});

function searchByName(dir, name, depth, budget) {
  if (depth < 0 || budget.n <= 0) return null;
  let list;
  try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return null; }
  for (const d of list) { budget.n--; if (d.isFile() && d.name.toLowerCase() === name) return path.join(dir, d.name); }
  for (const d of list) {
    if (d.isDirectory() && !d.name.startsWith('.') && !/^(node_modules|\$recycle\.bin|windows)$/i.test(d.name)) {
      const r = searchByName(path.join(dir, d.name), name, depth - 1, budget); if (r) return r;
    }
  }
  return null;
}
ipcMain.handle('a:findTex', (e, p3d, tex) => {
  const rel = String(tex).replace(/\\/g, '/').replace(/^\/+/, '');
  const name = path.basename(rel).toLowerCase();
  let dir = path.dirname(p3d);
  const tries = [];
  for (let i = 0; i < 8; i++) {
    tries.push(path.join(dir, rel));
    const up = path.dirname(dir); if (up === dir) break; dir = up;
  }
  if (process.platform === 'win32') tries.push(path.join('P:\\', rel));
  for (const t of tries) { try { if (fs.statSync(t).isFile()) return t; } catch (x) {} }
  const here = path.dirname(p3d);
  return searchByName(here, name, 3, { n: 20000 }) || searchByName(path.dirname(here), name, 3, { n: 20000 });
});

// Texturen rund um ein Modell auflisten (für automatische Suche und Textur-Browser)
ipcMain.handle('a:listTex', (e, file, levels) => {
  const exts = /\.(paa|pac|png|jpe?g|bmp|webp)$/i, out = [], seen = new Set();
  let dir = path.dirname(file), budget = { n: 30000 };
  const roots = [];
  for (let i = 0; i <= (levels == null ? 2 : levels); i++) { roots.push(dir); const up = path.dirname(dir); if (up === dir) break; dir = up; }
  function walk(d, depth) {
    if (depth < 0 || budget.n <= 0 || out.length >= 4000) return;
    let list; try { list = fs.readdirSync(d, { withFileTypes: true }); } catch (x) { return; }
    for (const it of list) {
      budget.n--;
      const full = path.join(d, it.name);
      if (it.isFile() && exts.test(it.name) && !seen.has(full.toLowerCase())) { seen.add(full.toLowerCase()); out.push(full); }
    }
    for (const it of list) if (it.isDirectory() && !it.name.startsWith('.') && !/^(node_modules|\$recycle\.bin|windows|program files.*|appdata)$/i.test(it.name)) walk(path.join(d, it.name), depth - 1);
  }
  // erst nah am Modell, dann weiter oben (flacher)
  roots.forEach((r, i) => walk(r, 4 - i));
  return out;
});

// ---------- Ordner überwachen ----------
function stopWatch() { if (watcher) { try { watcher.close(); } catch (e) {} watcher = null; } }
ipcMain.handle('a:watch', (e, dir) => {
  stopWatch();
  if (!dir || !fs.existsSync(dir)) return false;
  const timers = new Map(), last = new Map();
  try {
    watcher = fs.watch(dir, { recursive: true }, (ev, fn) => {
      if (!fn || !/\.(p3d|paa|pac)$/i.test(fn)) return;
      const full = path.join(dir, fn);
      clearTimeout(timers.get(full));
      timers.set(full, setTimeout(function check(prevSize) {
        let st; try { st = fs.statSync(full); } catch (x) { return; }
        if (prevSize !== st.size) { timers.set(full, setTimeout(() => check(st.size), 700)); return; }
        if (last.get(full) === st.mtimeMs) return;
        last.set(full, st.mtimeMs);
        if (appWin) appWin.webContents.send('a:watched', full);
      }, 700));
    });
  } catch (err) { return false; }
  return true;
});
ipcMain.handle('a:unwatch', () => { stopWatch(); return true; });
