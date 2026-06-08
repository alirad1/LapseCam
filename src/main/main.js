'use strict';

const {
  app, BrowserWindow, ipcMain, dialog, desktopCapturer, screen, shell, Menu, session
} = require('electron');
const path = require('path');
const fs = require('fs');

const { getSettings, saveSettings } = require('./store');
const { encode } = require('./encoder');

let mainWin = null;
let overlayWin = null;
let currentSessionDir = null;

function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 980,
    height: 760,
    minWidth: 820,
    minHeight: 630,
    title: 'LapseCam',
    backgroundColor: '#12121a',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  mainWin.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWin.on('closed', () => {
    mainWin = null;
    closeOverlay();
  });
}

function createOverlay() {
  if (overlayWin) return;
  const { workArea } = screen.getPrimaryDisplay();
  const W = 190, H = 56;
  overlayWin = new BrowserWindow({
    width: W,
    height: H,
    x: workArea.x + workArea.width - W - 24,
    y: workArea.y + 24,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'overlay-preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.setContentProtection(true);
  overlayWin.loadFile(path.join(__dirname, '..', 'renderer', 'overlay.html'));
  overlayWin.on('closed', () => { overlayWin = null; });
}

function closeOverlay() {
  if (overlayWin) {
    overlayWin.destroy();
    overlayWin = null;
  }
}

function registerIpc() {
  ipcMain.handle('settings:get', () => getSettings());
  ipcMain.handle('settings:save', (_e, partial) => saveSettings(partial));

  ipcMain.handle('sources:list', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 0, height: 0 },
      fetchWindowIcons: false
    });
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      isScreen: s.id.startsWith('screen:')
    }));
  });

  ipcMain.handle('session:start', () => {
    const base = path.join(app.getPath('temp'), 'LapseCam');
    fs.mkdirSync(base, { recursive: true });
    currentSessionDir = fs.mkdtempSync(path.join(base, 'session-'));
    return currentSessionDir;
  });

  ipcMain.handle('frame:write', async (_e, sessionDir, index, bytes) => {
    const name = `frame_${String(index).padStart(6, '0')}.jpg`;
    await fs.promises.writeFile(path.join(sessionDir, name), Buffer.from(bytes));
    return true;
  });

  ipcMain.handle('session:encode', async (_e, opts) => {
    const outputPath = await encode(opts, (pct) => {
      if (mainWin && !mainWin.isDestroyed()) {
        mainWin.webContents.send('encode:progress', pct);
      }
    });
    if (!opts.keepFrames) {
      fs.rm(opts.sessionDir, { recursive: true, force: true }, () => {});
    }
    currentSessionDir = null;
    return outputPath;
  });

  ipcMain.handle('session:discard', (_e, sessionDir) => {
    if (sessionDir) fs.rm(sessionDir, { recursive: true, force: true }, () => {});
    currentSessionDir = null;
    return true;
  });

  ipcMain.on('overlay:show', () => createOverlay());
  ipcMain.on('overlay:hide', () => closeOverlay());
  ipcMain.on('overlay:update', (_e, payload) => {
    if (overlayWin && !overlayWin.isDestroyed()) {
      overlayWin.webContents.send('overlay:update', payload);
    }
  });

  ipcMain.handle('dialog:chooseFolder', async () => {
    const res = await dialog.showOpenDialog(mainWin, {
      title: 'Choose output folder',
      properties: ['openDirectory', 'createDirectory']
    });
    return res.canceled ? null : res.filePaths[0];
  });

  ipcMain.handle('shell:showItem', (_e, p) => shell.showItemInFolder(p));
  ipcMain.handle('shell:openPath', (_e, p) => shell.openPath(p));
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);

  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(permission === 'media');
  });

  registerIpc();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (currentSessionDir) {
    try { fs.rmSync(currentSessionDir, { recursive: true, force: true }); } catch {}
  }
  app.quit();
});
