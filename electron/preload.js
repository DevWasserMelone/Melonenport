const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('launcher', {
  info: () => ipcRenderer.invoke('l:info'),
  check: () => ipcRenderer.invoke('l:check'),
  update: () => ipcRenderer.invoke('l:update'),
  start: () => ipcRenderer.invoke('l:start'),
  progCheck: () => ipcRenderer.invoke('l:progCheck'),
  progDownload: () => ipcRenderer.invoke('l:progDownload'),
  progInstall: () => ipcRenderer.invoke('l:progInstall'),
  onProg: (cb) => ipcRenderer.on('l:prog', (e, d) => cb(d)),
  pubGet: () => ipcRenderer.invoke('l:pubGet'),
  pubSave: (d) => ipcRenderer.invoke('l:pubSave', d),
  pubPick: () => ipcRenderer.invoke('l:pubPick'),
  publish: (d) => ipcRenderer.invoke('l:publish', d)
});

contextBridge.exposeInMainWorld('mk', {
  version: () => ipcRenderer.invoke('a:version'),
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch (e) { return ''; } },
  pickFiles: () => ipcRenderer.invoke('a:pickFiles'),
  pickFolder: (title) => ipcRenderer.invoke('a:pickFolder', title),
  stat: (p) => ipcRenderer.invoke('a:stat', p),
  readFile: (p) => ipcRenderer.invoke('a:read', p),
  scan: (dir) => ipcRenderer.invoke('a:scan', dir),
  extract: (file) => ipcRenderer.invoke('a:extract', file),
  prepOut: (root, name) => ipcRenderer.invoke('a:prepOut', root, name),
  writeOut: (dir, rel, data) => ipcRenderer.invoke('a:writeOut', dir, rel, data),
  copyOut: (dir, rel, src) => ipcRenderer.invoke('a:copyOut', dir, rel, src),
  openFolder: (dir) => ipcRenderer.invoke('a:openFolder', dir),
  showItem: (p) => ipcRenderer.invoke('a:showItem', p),
  openUrl: (u) => ipcRenderer.invoke('a:openUrl', u),
  fetchMod: (id, url) => ipcRenderer.invoke('a:fetchMod', id, url),
  onDl: (cb) => ipcRenderer.on('a:dl', (e, d) => cb(d)),
  onOpenFiles: (cb) => ipcRenderer.on('a:open', (e, ps) => cb(ps))
});
