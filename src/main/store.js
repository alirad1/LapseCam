'use strict';

const path = require('path');
const os = require('os');
const Store = require('electron-store');

const defaultOutputFolder = path.join(os.homedir(), 'Videos', 'LapseCam');

const defaults = {
  theme: 'purple',
  mode: 'screen-overlay',
  sourceId: '',
  webcamDeviceId: '',
  showFloatingTimer: false,
  stampSize: 'small',
  stampPosition: 'topleft',
  speedPreset: '150',
  intervalSeconds: 5,
  outputFps: 30,
  format: 'mp4',
  jpegQuality: 0.9,
  maxDimension: 1920,
  overlay: { x: 0.73, y: 0.7, w: 0.24, h: 0.27 },
  outputFolder: defaultOutputFolder,
  keepFrames: false
};

const store = new Store({
  name: 'lapsecam-settings',
  defaults
});

function getSettings() {
  return { ...defaults, ...store.store };
}

function saveSettings(partial) {
  const merged = { ...getSettings(), ...(partial || {}) };
  store.set(merged);
  return merged;
}

module.exports = { getSettings, saveSettings, defaults, defaultOutputFolder };
