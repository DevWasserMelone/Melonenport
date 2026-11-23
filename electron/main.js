const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, Menu, net } = require('electron');
const path = require('path');
const fs = require('fs');

let autoUpdater = null;
try { autoUpdater = require('electron-updater').autoUpdater; } catch (e) { autoUpdater = null; }

const REPO_DEFAULT = 'DevWasserMelone/Melonenport';
const ROOT = path.join(__dirname, '..');
const ICON = path.join(ROOT, 'build', 'icon.png');
const USER = app.getPath('userData');
const CONTENT = path.join(USER, 'content');
const PUBFILE = path.join(USER, 'publisher.json');

let launcherWin = null, appWin = null, pendingFiles = [];

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
  const headers = Object.assign({ 'User-Agent': 'Melonenport', 'Cache-Control': 'no-cache' }, opts.headers || {});
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
    title: 'Melonenport Launcher', show: false,
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
    title: 'Melonenport', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  appWin.loadFile(c.file);
  appWin.once('ready-to-show', () => appWin.show());
  appWin.webContents.on('did-finish-load', () => {
    if (pendingFiles.length) { appWin.webContents.send('a:open', pendingFiles); pendingFiles = []; }
  });
  appWin.on('closed', () => { appWin = null; });
  if (launcherWin) launcherWin.close();
}

function modArgs(argv) {
  return argv.slice(1).filter(a => /\.(zip|rar|7z|oiv|rpf)$/i.test(a) && fs.existsSync(a));
}

// ---------- Start ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (e, argv) => {
    const files = modArgs(argv);
    if (appWin) {
      if (files.length) appWin.webContents.send('a:open', files);
      if (appWin.isMinimized()) appWin.restore();
      appWin.focus();
    } else if (files.length) { pendingFiles = files; openApp(); }
    else if (launcherWin) launcherWin.focus();
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    const files = modArgs(process.argv);
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
  const title = ((html.toString('utf8', 0, 4000).match(/<title>([^<]*)/i) || [])[1] || '').trim();
  if (!/^Melonenport\b/i.test(title)) throw new Error('Falsche Datei: Das ist „' + (title || 'unbekannt') + '“, hier gehört nur eine Melonenport-Datei rein.');
  if (!/\/Melonenport$/i.test(rp)) throw new Error('Falsches Repository eingestellt („' + rp + '“). Richtig ist DevWasserMelone/Melonenport – mit Strg + Umschalt + P ändern.');
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


// ---------- Programm (Melonenport) ----------
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { session } = require('electron');
const TMP = path.join(os.tmpdir(), 'Melonenport');
const MARKER = '.melonenport';

function fsMsg(err, what) {
  const c = err && err.code;
  if (c === 'ENOENT') return what + ': Datei oder Ordner nicht gefunden.';
  if (c === 'EACCES' || c === 'EPERM') return what + ': Keine Berechtigung. Wähle rechts einen anderen Ausgabeordner.';
  if (c === 'EBUSY') return what + ': Die Datei ist gerade in einem anderen Programm geöffnet (z. B. läuft der Server noch). Schließ es und versuch es nochmal.';
  if (c === 'ENOSPC') return what + ': Die Festplatte ist voll.';
  if (c === 'EROFS') return what + ': Der Ordner ist schreibgeschützt.';
  return what + ': ' + (err && err.message || err);
}
function safeRel(rel) {
  const parts = String(rel).replace(/\\/g, '/').split('/').filter(p => p && p !== '.' && p !== '..');
  if (!parts.length) throw new Error('Ungültiger Dateiname');
  return parts.map(p => p.replace(/[<>:"|?*\x00-\x1f]/g, '_')).join(path.sep);
}
function inside(root, rel) {
  const full = path.resolve(root, safeRel(rel));
  if (!full.startsWith(path.resolve(root) + path.sep)) throw new Error('Ungültiger Pfad');
  return full;
}

app.on('will-quit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {} });

ipcMain.handle('a:version', () => current().version);
ipcMain.handle('a:pickFiles', async () => {
  const r = await dialog.showOpenDialog(appWin, { title: 'Mods wählen', filters: [{ name: 'Mods (ZIP, RAR, 7Z, OIV, RPF)', extensions: ['zip', 'rar', '7z', 'oiv', 'rpf'] }, { name: 'Alle Dateien', extensions: ['*'] }], properties: ['openFile', 'multiSelections'] });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle('a:pickFolder', async (e, title) => {
  const r = await dialog.showOpenDialog(appWin, { title: title || 'Ordner wählen', properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('a:stat', (e, p) => {
  try { const s = fs.statSync(p); return { dir: s.isDirectory(), size: s.size }; } catch (err) { return null; }
});
ipcMain.handle('a:read', (e, p) => {
  try { return new Uint8Array(fs.readFileSync(p)); } catch (err) { throw new Error(fsMsg(err, 'Lesen fehlgeschlagen')); }
});
ipcMain.handle('a:scan', (e, dir) => {
  const out = [];
  (function walk(d, rel, depth) {
    if (depth > 12 || out.length > 20000) return;
    let list; try { list = fs.readdirSync(d, { withFileTypes: true }); } catch (x) { return; }
    for (const it of list) {
      const full = path.join(d, it.name), r = rel ? rel + '/' + it.name : it.name;
      if (it.isDirectory()) { if (!/^(__macosx|\.git)$/i.test(it.name)) walk(full, r, depth + 1); }
      else if (it.isFile()) { let size = 0; try { size = fs.statSync(full).size; } catch (x) {} out.push({ path: full, rel: r, size }); }
    }
  })(dir, '', 0);
  return out;
});

// Archive entpacken (ZIP/7Z/OIV über 7-Zip, RAR über unrar)
function sevenZip() {
  const p = require('7zip-bin').path7za;
  return p.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
}
ipcMain.handle('a:extract', async (e, file) => {
  const id = crypto.createHash('md5').update(file + Date.now() + Math.random()).digest('hex').slice(0, 10);
  const dir = path.join(TMP, 'x_' + id);
  fs.mkdirSync(dir, { recursive: true });
  const head = Buffer.alloc(8); try { const fd = fs.openSync(file, 'r'); fs.readSync(fd, head, 0, 8, 0); fs.closeSync(fd); } catch (err) { throw new Error(fsMsg(err, 'Lesen fehlgeschlagen')); }
  const isRar = head.toString('latin1', 0, 4) === 'Rar!';
  if (isRar) {
    const { createExtractorFromData } = require('node-unrar-js');
    const data = fs.readFileSync(file);
    const ex = await createExtractorFromData({ data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) });
    const { files } = ex.extract();
    for (const f of files) {
      if (f.fileHeader.flags.directory || !f.extraction) continue;
      const full = inside(dir, f.fileHeader.name);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, Buffer.from(f.extraction));
    }
    return dir;
  }
  await new Promise((res, rej) => {
    execFile(sevenZip(), ['x', '-y', '-bd', '-o' + dir, file], { windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (err, so, se) => {
      if (err) rej(new Error('Entpacken fehlgeschlagen. Ist das Archiv beschädigt oder mit Passwort geschützt?'));
      else res();
    });
  });
  return dir;
});

// Ausgabe
ipcMain.handle('a:prepOut', (e, root, name) => {
  try {
    fs.mkdirSync(root, { recursive: true });
    let final = name, n = 2;
    while (fs.existsSync(path.join(root, final))) {
      const dir = path.join(root, final);
      if (fs.existsSync(path.join(dir, MARKER))) { fs.rmSync(dir, { recursive: true, force: true }); break; }
      final = name + '_' + n++;
    }
    const dir = path.join(root, final);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, MARKER), 'Von Melonenport erstellt. Beim nächsten Umwandeln mit gleichem Namen wird dieser Ordner ersetzt.\n');
    return { name: final, dir };
  } catch (err) { throw new Error(fsMsg(err, 'Ausgabeordner')); }
});
ipcMain.handle('a:writeOut', (e, dir, rel, data) => {
  try {
    const full = inside(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, typeof data === 'string' ? data : Buffer.from(data));
    return true;
  } catch (err) { throw new Error(fsMsg(err, 'Speichern fehlgeschlagen')); }
});
ipcMain.handle('a:copyOut', (e, dir, rel, src) => {
  try {
    const full = inside(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.copyFileSync(src, full);
    return true;
  } catch (err) { throw new Error(fsMsg(err, 'Kopieren fehlgeschlagen')); }
});
ipcMain.handle('a:openFolder', (e, dir) => shell.openPath(dir));
ipcMain.handle('a:showItem', (e, p) => shell.showItemInFolder(p));
ipcMain.handle('a:openUrl', (e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });

// ---------- Mods von gta5-mods.com laden ----------
const PART = 'persist:gta5mods';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const FILE_RE = /\.(zip|rar|7z|oiv|rpf)(\?|#|$)/i;
const PAGE_JS = `(()=>{
  const as=[...document.querySelectorAll('a[href]')];
  const links=as.map(a=>a.href);
  const hs=[...document.querySelectorAll('h1')].map(h=>h.textContent.replace(/\\s+/g,' ').trim()).filter(t=>t&&!/welcome to|willkommen bei|bienvenue|bienvenido/i.test(t));
  const au=document.querySelector('.file-author a, .user-name a, a.username, .file-uploader a, a[href*="/users/"]');
  const isFile=x=>/files\\.gta5-mods\\.com\\//i.test(x)||/\\/uploads\\//i.test(x)&&/\\.(zip|rar|7z|oiv|rpf)(\\?|#|$)/i.test(x)||/\\.(zip|rar|7z|oiv|rpf)(\\?|#|$)/i.test(x);
  return { title:hs[0]||document.title, author:au?au.textContent.trim():'', url:location.href,
    dl:links.find(x=>/\\/download\\/\\d+/.test(x))||'', direct:links.find(isFile)||'',
    cf:/just a moment|einen moment|checking your browser|attention required|un instant/i.test(document.title)||!!document.querySelector('#challenge-form,#cf-challenge-running,.cf-turnstile,iframe[src*="challenges.cloudflare"]') };
})()`;

function sendDl(id, d) { if (appWin) appWin.webContents.send('a:dl', Object.assign({ id }, d)); }

ipcMain.handle('a:fetchMod', async (e, id, url) => {
  url = String(url || '').trim();
  if (!/^https?:\/\//i.test(url)) throw new Error('Das ist kein Link.');
  const dlDir = path.join(TMP, 'dl_' + id); fs.mkdirSync(dlDir, { recursive: true });
  const ses = session.fromPartition(PART);
  const win = new BrowserWindow({
    show: false, width: 1150, height: 820, icon: ICON, autoHideMenuBar: true, title: 'Melonenport – gta5-mods',
    webPreferences: { partition: PART, contextIsolation: true, sandbox: true, backgroundThrottling: false }
  });
  win.webContents.setAudioMuted(true);
  let started = false, shown = false, info = { title: '', author: '', page: url };
  function showWin(why) {
    if (shown || win.isDestroyed()) return; shown = true;
    win.setTitle(why); win.show(); win.focus();
    sendDl(id, { state: 'manual', why });
  }
  // Popups (z. B. Download in neuem Tab) im selben Fenster öffnen
  win.webContents.setWindowOpenHandler(({ url: u }) => {
    if (FILE_RE.test(u) || /files\.gta5-mods\.com/i.test(u)) win.webContents.downloadURL(u);
    else if (/gta5-mods\.com/i.test(u)) win.loadURL(u).catch(() => {});
    return { action: 'deny' };
  });
  const done = new Promise((resolve, reject) => {
    const onDl = (ev, item) => {
      if (started) { item.cancel(); return; }
      started = true;
      const file = path.join(dlDir, path.basename(item.getFilename() || 'mod.zip'));
      item.setSavePath(file);
      if (!win.isDestroyed()) win.hide();
      sendDl(id, { state: 'progress', received: 0, total: item.getTotalBytes() });
      item.on('updated', () => sendDl(id, { state: 'progress', received: item.getReceivedBytes(), total: item.getTotalBytes() }));
      item.once('done', (ev2, state) => {
        ses.removeListener('will-download', onDl);
        if (state === 'completed') resolve(file); else reject(new Error('Download abgebrochen.'));
      });
    };
    ses.on('will-download', onDl);
    win.on('closed', () => { if (!started) { ses.removeListener('will-download', onDl); reject(new Error('Fenster geschlossen, Download abgebrochen.')); } });
  });
  done.catch(() => {});
  async function look() { if (win.isDestroyed()) return null; try { return await win.webContents.executeJavaScript(PAGE_JS); } catch (x) { return null; } }
  try {
    const direct = /files\.gta5-mods\.com\//i.test(url) || FILE_RE.test(url);
    if (direct) win.webContents.downloadURL(url);
    else {
      if (!/gta5-mods\.com\//i.test(url)) throw new Error('Nur Links von gta5-mods.com oder direkte Datei-Links gehen.');
      sendDl(id, { state: 'page' });
      win.loadURL(url).catch(() => {});
      const t0 = Date.now(); let stage = 'mod', triedDirect = '', lastUrl = '';
      while (!started) {
        if (win.isDestroyed()) throw new Error('Fenster geschlossen, Download abgebrochen.');
        const el = Date.now() - t0;
        if (el > (shown ? 300000 : 60000)) throw new Error('Der Download ist nicht gestartet. Lade die Datei selbst herunter und zieh sie hier rein.');
        const p = await look();
        if (p) {
          if (p.cf) { if (el > 5000) showWin('Bitte kurz bestätigen, dass du kein Bot bist'); }
          else {
            if (stage === 'mod' && /\/download\/\d+/.test(p.url)) stage = 'dl';
            if (stage === 'mod') {
              if (p.title && !info.title) { info.title = p.title; info.author = p.author; sendDl(id, { state: 'info', title: p.title, author: p.author }); }
              if (p.direct) { if (triedDirect !== p.direct) { triedDirect = p.direct; win.webContents.downloadURL(p.direct); } }
              else if (p.dl) { stage = 'dl'; sendDl(id, { state: 'dlpage' }); win.loadURL(p.dl).catch(() => {}); }
            } else {
              if (p.url !== lastUrl) { lastUrl = p.url; sendDl(id, { state: 'wait' }); }
              if (p.direct && triedDirect !== p.direct) { triedDirect = p.direct; win.webContents.downloadURL(p.direct); }
              // Seite startet den Download nicht von selbst -> Fenster zeigen, Nutzer klickt
              if (el > 20000) showWin('Klick auf den Download-Knopf, Melonenport übernimmt den Rest');
            }
          }
        }
        await sleep(600);
      }
    }
    const t1 = Date.now();
    while (!started && Date.now() - t1 < 60000) await sleep(300);
    if (!started) throw new Error('Der Download ist nicht gestartet.');
    const file = await done;
    return Object.assign({ file }, info);
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
});

// ---------- FiveM-Server (lokal) ----------
const dgram = require('dgram');
ipcMain.handle('a:findCfg', (e, dir) => {
  const queue = [[dir, 0]]; let seen = 0;
  while (queue.length && seen < 4000) {
    const [d, depth] = queue.shift();
    let list; try { list = fs.readdirSync(d, { withFileTypes: true }); } catch (x) { continue; }
    seen += list.length;
    const hit = list.find(it => it.isFile() && it.name.toLowerCase() === 'server.cfg');
    if (hit) return path.join(d, hit.name);
    if (depth < 4) for (const it of list) if (it.isDirectory() && !/^(resources|cache|node_modules|logs|\.git|citizen|crashes)$/i.test(it.name)) queue.push([path.join(d, it.name), depth + 1]);
  }
  return null;
});
ipcMain.handle('a:rcon', (e, port, pass, cmd) => new Promise(resolve => {
  const s = dgram.createSocket('udp4'); let fin = false;
  const end = r => { if (fin) return; fin = true; try { s.close(); } catch (x) {} resolve(r); };
  const t = setTimeout(() => end({ ok: false }), 2500);
  s.on('error', () => { clearTimeout(t); end({ ok: false }); });
  s.on('message', m => { clearTimeout(t); end({ ok: true, text: m.slice(4).toString('utf8').replace(/^print\s?/, '') }); });
  const msg = Buffer.concat([Buffer.from([255, 255, 255, 255]), Buffer.from('rcon ' + pass + ' ' + cmd, 'utf8')]);
  s.send(msg, Number(port) || 30120, '127.0.0.1', err => { if (err) { clearTimeout(t); end({ ok: false }); } });
}));
