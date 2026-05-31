'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlayApi', {
  onUpdate: (cb) => ipcRenderer.on('overlay:update', (_e, payload) => cb(payload))
});
