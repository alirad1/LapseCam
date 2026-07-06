'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lapse', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (partial) => ipcRenderer.invoke('settings:save', partial),

  listSources: () => ipcRenderer.invoke('sources:list'),

  startSession: () => ipcRenderer.invoke('session:start'),
  writeFrame: (sessionDir, index, arrayBuffer) =>
    ipcRenderer.invoke('frame:write', sessionDir, index, new Uint8Array(arrayBuffer)),
  encodeSession: (opts) => ipcRenderer.invoke('session:encode', opts),
  discardSession: (sessionDir) => ipcRenderer.invoke('session:discard', sessionDir),
  onEncodeProgress: (cb) => {
    ipcRenderer.removeAllListeners('encode:progress');
    ipcRenderer.on('encode:progress', (_e, pct) => cb(pct));
  },

  showOverlay: () => ipcRenderer.send('overlay:show'),
  hideOverlay: () => ipcRenderer.send('overlay:hide'),
  updateOverlay: (payload) => ipcRenderer.send('overlay:update', payload),

  chooseFolder: () => ipcRenderer.invoke('dialog:chooseFolder'),
  showItemInFolder: (p) => ipcRenderer.invoke('shell:showItem', p),
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

  onUpdateAvailable: (cb) => {
    ipcRenderer.removeAllListeners('update:available');
    ipcRenderer.on('update:available', (_e, info) => cb(info));
  }
});
