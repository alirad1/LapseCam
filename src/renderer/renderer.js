'use strict';

const $ = (id) => document.getElementById(id);

const els = {
  modeGroup: $('modeGroup'),
  sourceSelect: $('sourceSelect'),
  sourceLabel: $('sourceLabel'),
  webcamSelect: $('webcamSelect'),
  webcamLabel: $('webcamLabel'),
  refreshSources: $('refreshSources'),
  previewCanvas: $('previewCanvas'),
  previewMsg: $('previewMsg'),
  previewHint: $('previewHint'),
  speedSelect: $('speedSelect'),
  speedSummary: $('speedSummary'),
  recordBtn: $('recordBtn'),
  recordBtnLabel: $('recordBtnLabel'),
  stopBtn: $('stopBtn'),
  openFolder: $('openFolder'),
  stateDot: $('stateDot'),
  statusLine: $('statusLine'),
  resultWrap: $('resultWrap'),
  resultLink: $('resultLink'),
  elapsedStat: $('elapsedStat'),
  framesStat: $('framesStat'),
  videoLenStat: $('videoLenStat'),
  encodeArea: $('encodeArea'),
  encodeFill: $('encodeFill'),
  encodeLabel: $('encodeLabel'),
  settingsBtn: $('settingsBtn'),
  settingsModal: $('settingsModal'),
  settingsX: $('settingsX'),
  themeSelect: $('themeSelect'),
  intervalInput: $('intervalInput'),
  fpsInput: $('fpsInput'),
  folderInput: $('folderInput'),
  browseFolder: $('browseFolder'),
  openFolderSettings: $('openFolderSettings'),
  keepFrames: $('keepFrames'),
  floatingTimer: $('floatingTimer'),
  stampSize: $('stampSize'),
  stampPos: $('stampPos')
};

const getRadio = (name) => document.querySelector(`input[name="${name}"]:checked`).value;
const setRadio = (name, value) => {
  const el = document.querySelector(`input[name="${name}"][value="${value}"]`);
  if (el) el.checked = true;
};

let settings = null;

let screenStream = null;
let webcamStream = null;
const screenVideo = document.createElement('video');
const webcamVideo = document.createElement('video');
screenVideo.muted = webcamVideo.muted = true;

let recState = 'idle';
let sessionDir = null;
let frameIndex = 0;
let captureTimer = null;
let clockTimer = null;
let recordStartMs = 0;
let pausedAccumMs = 0;
let pauseStartMs = 0;
let activeTimings = null;

const captureCanvas = document.createElement('canvas');
const captureCtx = captureCanvas.getContext('2d');

const previewCtx = els.previewCanvas.getContext('2d');

function setStatus(msg, isError = false, italic = false) {
  els.statusLine.textContent = msg || '';
  els.statusLine.classList.toggle('error', isError);
  els.statusLine.classList.toggle('italic', italic);
}

function setStateDot() {
  els.stateDot.className = 'state-dot' +
    (recState === 'recording' ? ' recording'
      : recState === 'paused' ? ' paused'
      : recState === 'encoding' ? ' encoding' : '');
}

function fmtHMS(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

function elapsedMs() {
  if (!recordStartMs) return 0;
  const pausePart = recState === 'paused' ? Date.now() - pauseStartMs : 0;
  return Date.now() - recordStartMs - pausedAccumMs - pausePart;
}

function effectiveTimings() {
  const preset = els.speedSelect.value;
  if (preset === 'custom') {
    return {
      interval: Math.min(3600, Math.max(0.2, Number(els.intervalInput.value) || 5)),
      fps: Math.min(60, Math.max(5, Number(els.fpsInput.value) || 30))
    };
  }
  const speed = Number(preset);
  return { interval: speed / 30, fps: 30 };
}

function drawCover(ctx, video, dx, dy, dw, dh) {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return;
  const scale = Math.max(dw / vw, dh / vh);
  const sw = dw / scale, sh = dh / scale;
  const sx = (vw - sw) / 2, sy = (vh - sh) / 2;
  ctx.drawImage(video, sx, sy, sw, sh, dx, dy, dw, dh);
}

function drawWebcamOverlay(ctx, W, H) {
  const o = settings.overlay;
  const x = o.x * W, y = o.y * H, w = o.w * W, h = o.h * H;
  const r = Math.min(14, w * 0.08);
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.clip();
  drawCover(ctx, webcamVideo, x, y, w, h);
  ctx.restore();
  ctx.beginPath();
  ctx.roundRect(x + 1, y + 1, w - 2, h - 2, r);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.stroke();
}

function drawTimeStamp(ctx, W, H) {
  const sizes = { small: 0.032, medium: 0.05, large: 0.075 };
  const f = Math.max(12, Math.round(H * (sizes[els.stampSize.value] || 0.032)));
  const text = fmtHMS(elapsedMs());
  ctx.save();
  ctx.font = `600 ${f}px "Segoe UI", sans-serif`;
  const padX = f * 0.45, padY = f * 0.28;
  const bw = ctx.measureText(text).width + padX * 2;
  const bh = f + padY * 2;
  const margin = Math.round(H * 0.02);
  const pos = els.stampPos.value;
  const x = pos.includes('right') ? W - margin - bw : margin;
  const y = pos.includes('bottom') ? H - margin - bh : margin;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.roundRect(x, y, bw, bh, f * 0.25);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + padX, y + bh / 2 + f * 0.05);
  ctx.restore();
}

function composeFrame(ctx, W, H) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  const mode = settings.mode;
  if (mode === 'webcam') {
    drawCover(ctx, webcamVideo, 0, 0, W, H);
  } else {
    if (screenVideo.videoWidth) ctx.drawImage(screenVideo, 0, 0, W, H);
    if (mode === 'screen-overlay' && webcamVideo.videoWidth) {
      drawWebcamOverlay(ctx, W, H);
    }
  }
  drawTimeStamp(ctx, W, H);
}

function computeCanvasSize() {
  const cap = Number(getRadio('res')) || 1920;
  const src = settings.mode === 'webcam' ? webcamVideo : screenVideo;
  let w = src.videoWidth || 1280;
  let h = src.videoHeight || 720;
  const scale = Math.min(1, cap / Math.max(w, h));
  w = Math.round(w * scale); h = Math.round(h * scale);
  w -= w % 2; h -= h % 2;
  return { w, h };
}

function stopStream(stream) {
  if (stream) stream.getTracks().forEach((t) => t.stop());
}

async function getScreenStream(sourceId) {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: sourceId,
        maxWidth: 3840,
        maxHeight: 2160,
        maxFrameRate: 10
      }
    }
  });
}

async function getWebcamStream(deviceId) {
  const video = { width: { ideal: 1280 }, height: { ideal: 720 } };
  if (deviceId) video.deviceId = { exact: deviceId };
  return navigator.mediaDevices.getUserMedia({ audio: false, video });
}

async function ensureStreams() {
  const mode = settings.mode;
  const needScreen = mode !== 'webcam';
  const needWebcam = mode !== 'screen';

  els.previewMsg.hidden = false;
  els.previewMsg.textContent = 'Starting preview...';

  try {
    if (needScreen) {
      stopStream(screenStream); screenStream = null;
      let id = els.sourceSelect.value || settings.sourceId;
      if (!id) {
        const sources = await window.lapse.listSources();
        const primary = sources.find((s) => s.isScreen) || sources[0];
        if (!primary) throw new Error('No screens found to capture.');
        id = primary.id;
      }
      screenStream = await getScreenStream(id);
      screenVideo.srcObject = screenStream;
      await screenVideo.play();
    } else {
      stopStream(screenStream); screenStream = null;
      screenVideo.srcObject = null;
    }

    if (needWebcam) {
      stopStream(webcamStream); webcamStream = null;
      webcamStream = await getWebcamStream(els.webcamSelect.value || settings.webcamDeviceId);
      webcamVideo.srcObject = webcamStream;
      await webcamVideo.play();
      await populateWebcams();
    } else {
      stopStream(webcamStream); webcamStream = null;
      webcamVideo.srcObject = null;
    }

    els.previewMsg.hidden = true;
    setStatus('Ready.');
  } catch (err) {
    els.previewMsg.textContent = `Could not start capture: ${err.message}`;
    setStatus(err.message, true);
    throw err;
  }
}

function cleanSourceName(name) {
  const n = name.replace(/\s+/g, ' ').trim();
  return n.length > 42 ? n.slice(0, 40) + '…' : n;
}

async function populateSources() {
  const sources = await window.lapse.listSources();
  const prev = els.sourceSelect.value || settings.sourceId;
  els.sourceSelect.innerHTML = '';
  const screens = sources.filter((s) => s.isScreen);
  const windows = sources.filter((s) => !s.isScreen);
  const addGroup = (label, items, nameFor) => {
    if (!items.length) return;
    const g = document.createElement('optgroup');
    g.label = label;
    items.forEach((s, i) => {
      const o = document.createElement('option');
      o.value = s.id;
      o.textContent = nameFor(s, i);
      g.appendChild(o);
    });
    els.sourceSelect.appendChild(g);
  };
  addGroup('Screens', screens, (s, i) =>
    screens.length === 1 ? 'Entire Screen' : `Screen ${i + 1}`
  );
  addGroup('Windows', windows, (s) => cleanSourceName(s.name));
  if (prev && [...els.sourceSelect.options].some((o) => o.value === prev)) {
    els.sourceSelect.value = prev;
  }
}

async function populateWebcams() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cams = devices.filter((d) => d.kind === 'videoinput');
  const prev = els.webcamSelect.value || settings.webcamDeviceId;
  els.webcamSelect.innerHTML = '';
  cams.forEach((c, i) => {
    const o = document.createElement('option');
    o.value = c.deviceId;
    const label = (c.label || '').replace(/\s*\([0-9a-fA-F]{4}:[0-9a-fA-F]{4}\)\s*$/, '').trim();
    o.textContent = label || `Camera ${i + 1}`;
    els.webcamSelect.appendChild(o);
  });
  if (prev && cams.some((c) => c.deviceId === prev)) els.webcamSelect.value = prev;
}

let dragState = null;

function previewLoop() {
  const mode = settings.mode;
  const src = mode === 'webcam' ? webcamVideo : screenVideo;
  if (src.videoWidth) {
    const targetW = 1280;
    const targetH = Math.round((src.videoHeight / src.videoWidth) * targetW);
    if (els.previewCanvas.width !== targetW || els.previewCanvas.height !== targetH) {
      els.previewCanvas.width = targetW;
      els.previewCanvas.height = targetH;
    }
    composeFrame(previewCtx, els.previewCanvas.width, els.previewCanvas.height);

    if (mode === 'screen-overlay') {
      const W = els.previewCanvas.width, H = els.previewCanvas.height;
      const o = settings.overlay;
      const hx = (o.x + o.w) * W, hy = (o.y + o.h) * H;
      previewCtx.beginPath();
      previewCtx.arc(hx - 4, hy - 4, 7, 0, Math.PI * 2);
      previewCtx.fillStyle = 'rgba(124,92,255,0.95)';
      previewCtx.fill();
      previewCtx.strokeStyle = '#fff';
      previewCtx.lineWidth = 2;
      previewCtx.stroke();
    }
  }
  requestAnimationFrame(previewLoop);
}

function canvasPos(evt) {
  const r = els.previewCanvas.getBoundingClientRect();
  return {
    x: (evt.clientX - r.left) / r.width,
    y: (evt.clientY - r.top) / r.height
  };
}

els.previewCanvas.addEventListener('pointerdown', (evt) => {
  if (settings.mode !== 'screen-overlay') return;
  const p = canvasPos(evt);
  const o = settings.overlay;
  const nearCorner =
    Math.abs(p.x - (o.x + o.w)) < 0.03 && Math.abs(p.y - (o.y + o.h)) < 0.045;
  const inside = p.x >= o.x && p.x <= o.x + o.w && p.y >= o.y && p.y <= o.y + o.h;
  if (!nearCorner && !inside) return;
  dragState = {
    type: nearCorner ? 'resize' : 'move',
    startX: p.x, startY: p.y,
    orig: { ...o }
  };
  els.previewCanvas.setPointerCapture(evt.pointerId);
});

els.previewCanvas.addEventListener('pointermove', (evt) => {
  if (settings.mode !== 'screen-overlay') { els.previewCanvas.style.cursor = 'default'; return; }
  const p = canvasPos(evt);
  const o = settings.overlay;

  if (!dragState) {
    const nearCorner =
      Math.abs(p.x - (o.x + o.w)) < 0.03 && Math.abs(p.y - (o.y + o.h)) < 0.045;
    const inside = p.x >= o.x && p.x <= o.x + o.w && p.y >= o.y && p.y <= o.y + o.h;
    els.previewCanvas.style.cursor = nearCorner ? 'nwse-resize' : inside ? 'grab' : 'default';
    return;
  }

  const dx = p.x - dragState.startX;
  const dy = p.y - dragState.startY;
  const orig = dragState.orig;

  if (dragState.type === 'move') {
    o.x = Math.min(Math.max(orig.x + dx, 0), 1 - o.w);
    o.y = Math.min(Math.max(orig.y + dy, 0), 1 - o.h);
  } else {
    const canvasAR = els.previewCanvas.width / els.previewCanvas.height;
    const camAR = webcamVideo.videoWidth
      ? webcamVideo.videoWidth / webcamVideo.videoHeight
      : 16 / 9;
    o.w = Math.min(Math.max(orig.w + dx, 0.08), 1 - o.x);
    o.h = Math.min(o.w * (canvasAR / camAR), 1 - o.y);
    o.w = o.h * (camAR / canvasAR);
  }
});

els.previewCanvas.addEventListener('pointerup', () => {
  if (dragState) {
    dragState = null;
    saveSettingsDebounced();
  }
});

async function captureFrame() {
  try {
    const idx = frameIndex++;
    composeFrame(captureCtx, captureCanvas.width, captureCanvas.height);
    const blob = await new Promise((res) =>
      captureCanvas.toBlob(res, 'image/jpeg', settings.jpegQuality || 0.9)
    );
    if (!blob) throw new Error('Photo capture failed');
    await window.lapse.writeFrame(sessionDir, idx, await blob.arrayBuffer());
    els.framesStat.textContent = String(frameIndex);
    els.videoLenStat.textContent = `${(frameIndex / activeTimings.fps).toFixed(1)}s`;
  } catch (err) {
    setStatus(`Could not save photo: ${err.message}`, true);
  }
}

function startClock() {
  clockTimer = setInterval(() => {
    const ms = elapsedMs();
    els.elapsedStat.textContent = fmtHMS(ms);
    window.lapse.updateOverlay({ elapsed: fmtHMS(ms), state: recState });
  }, 500);
}

function trimNum(n) {
  if (!Number.isFinite(n)) return '0';
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

async function startRecording() {
  try {
    await ensureStreams();
  } catch {
    return;
  }
  const { w, h } = computeCanvasSize();
  captureCanvas.width = w;
  captureCanvas.height = h;

  activeTimings = effectiveTimings();
  sessionDir = await window.lapse.startSession();
  frameIndex = 0;
  recordStartMs = Date.now();
  pausedAccumMs = 0;
  recState = 'recording';

  const intervalMs = Math.max(150, activeTimings.interval * 1000);
  captureFrame();
  captureTimer = setInterval(captureFrame, intervalMs);
  startClock();

  if (els.floatingTimer.checked) window.lapse.showOverlay();
  els.resultWrap.hidden = true;
  updateControls();
  setRecordingStatus();
}

function setRecordingStatus() {
  setStatus(`Recording (1 photo every ${trimNum(activeTimings.interval)} seconds)`, false, true);
}

function pauseRecording() {
  recState = 'paused';
  clearInterval(captureTimer); captureTimer = null;
  pauseStartMs = Date.now();
  window.lapse.updateOverlay({ elapsed: fmtHMS(elapsedMs()), state: recState });
  updateControls();
  setStatus('Paused.');
}

function resumeRecording() {
  pausedAccumMs += Date.now() - pauseStartMs;
  recState = 'recording';
  const intervalMs = Math.max(200, activeTimings.interval * 1000);
  captureTimer = setInterval(captureFrame, intervalMs);
  updateControls();
  setRecordingStatus();
}

async function stopRecording() {
  clearInterval(captureTimer); captureTimer = null;
  clearInterval(clockTimer); clockTimer = null;
  if (recState === 'paused') pausedAccumMs += Date.now() - pauseStartMs;
  recState = 'encoding';
  window.lapse.hideOverlay();
  updateControls();

  const frameCount = frameIndex;
  els.encodeArea.hidden = false;
  els.encodeFill.style.width = '0%';
  els.encodeLabel.textContent = 'Creating video… 0%';
  setStatus('Creating your video…');

  try {
    const outputPath = await window.lapse.encodeSession({
      sessionDir,
      frameCount,
      outputFps: activeTimings.fps,
      format: getRadio('format'),
      outputFolder: els.folderInput.value,
      keepFrames: els.keepFrames.checked
    });
    els.resultWrap.hidden = false;
    els.resultLink.textContent = outputPath;
    els.resultLink.dataset.path = outputPath;
    setStatus('Video saved.');
  } catch (err) {
    setStatus(`Could not create the video: ${err.message}`, true);
    await window.lapse.discardSession(sessionDir);
  } finally {
    els.encodeArea.hidden = true;
    sessionDir = null;
    recState = 'idle';
    recordStartMs = 0;
    updateControls();
  }
}

function updateControls() {
  const btn = els.recordBtn;
  document.body.classList.toggle('recording', recState === 'recording' || recState === 'paused');
  setStateDot();

  switch (recState) {
    case 'idle':
      els.recordBtnLabel.textContent = 'Start Recording';
      btn.disabled = false;
      els.stopBtn.disabled = true;
      break;
    case 'recording':
      els.recordBtnLabel.textContent = 'Pause';
      btn.disabled = false;
      els.stopBtn.disabled = false;
      break;
    case 'paused':
      els.recordBtnLabel.textContent = 'Resume';
      btn.disabled = false;
      els.stopBtn.disabled = false;
      break;
    case 'encoding':
      els.recordBtnLabel.textContent = 'Creating video…';
      btn.disabled = true;
      els.stopBtn.disabled = true;
      break;
  }
}

els.recordBtn.addEventListener('click', () => {
  if (recState === 'idle') startRecording();
  else if (recState === 'recording') pauseRecording();
  else if (recState === 'paused') resumeRecording();
});
els.stopBtn.addEventListener('click', () => {
  if (recState === 'recording' || recState === 'paused') stopRecording();
});

window.lapse.onEncodeProgress((pct) => {
  els.encodeFill.style.width = `${pct}%`;
  els.encodeLabel.textContent = `Creating video… ${pct}%`;
});

let saveTimer = null;
function saveSettingsDebounced() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    window.lapse.saveSettings({
      theme: els.themeSelect.value,
      mode: settings.mode,
      sourceId: els.sourceSelect.value,
      webcamDeviceId: els.webcamSelect.value,
      speedPreset: els.speedSelect.value,
      intervalSeconds: Number(els.intervalInput.value) || 5,
      outputFps: Number(els.fpsInput.value) || 30,
      format: getRadio('format'),
      maxDimension: Number(getRadio('res')) || 1920,
      overlay: settings.overlay,
      outputFolder: els.folderInput.value,
      keepFrames: els.keepFrames.checked,
      showFloatingTimer: els.floatingTimer.checked,
      stampSize: els.stampSize.value,
      stampPosition: els.stampPos.value
    });
  }, 350);
}

function updateSpeedSummary() {
  const { interval, fps } = effectiveTimings();
  const speedup = interval * fps;
  const perHour = 3600 / speedup;
  els.speedSummary.textContent =
    `1 hour of studying becomes ` +
    `${perHour < 60 ? perHour.toFixed(0) + ' seconds' : (perHour / 60).toFixed(1) + ' minutes'} of video.`;
}

function applyTheme() {
  const t = settings.theme;
  document.body.dataset.theme = t === 'light' || t === 'dark' ? t : 'purple';
}

function applyModeToUI() {
  const mode = settings.mode;
  document.querySelectorAll('.select-item').forEach((b) =>
    b.classList.toggle('active', b.dataset.mode === mode)
  );
  els.sourceLabel.style.display = mode === 'webcam' ? 'none' : '';
  els.webcamLabel.style.display = mode === 'screen' ? 'none' : '';
  els.previewHint.hidden = mode !== 'screen-overlay';
}

els.modeGroup.addEventListener('click', (evt) => {
  const btn = evt.target.closest('.select-item');
  if (!btn || recState !== 'idle') return;
  settings.mode = btn.dataset.mode;
  applyModeToUI();
  saveSettingsDebounced();
  ensureStreams().catch(() => {});
});

els.sourceSelect.addEventListener('change', () => {
  saveSettingsDebounced();
  if (recState === 'idle') ensureStreams().catch(() => {});
});
els.webcamSelect.addEventListener('change', () => {
  saveSettingsDebounced();
  if (recState === 'idle') ensureStreams().catch(() => {});
});
els.refreshSources.addEventListener('click', () => populateSources());

els.speedSelect.addEventListener('change', () => {
  updateSpeedSummary();
  saveSettingsDebounced();
});
for (const el of [els.intervalInput, els.fpsInput]) {
  el.addEventListener('input', () => { updateSpeedSummary(); saveSettingsDebounced(); });
}
document.querySelectorAll('input[name="format"], input[name="res"]').forEach((el) =>
  el.addEventListener('change', saveSettingsDebounced)
);
els.keepFrames.addEventListener('change', saveSettingsDebounced);
for (const el of [els.floatingTimer, els.stampSize, els.stampPos]) {
  el.addEventListener('change', saveSettingsDebounced);
}
els.openFolderSettings.addEventListener('click', () =>
  window.lapse.openPath(els.folderInput.value)
);

els.settingsBtn.addEventListener('click', () => { els.settingsModal.hidden = false; });
els.settingsX.addEventListener('click', () => { els.settingsModal.hidden = true; });
els.settingsModal.addEventListener('click', (evt) => {
  if (evt.target === els.settingsModal) els.settingsModal.hidden = true;
});
document.addEventListener('keydown', (evt) => {
  if (evt.key === 'Escape') els.settingsModal.hidden = true;
});
els.themeSelect.addEventListener('change', () => {
  settings.theme = els.themeSelect.value;
  applyTheme();
  saveSettingsDebounced();
});

els.browseFolder.addEventListener('click', async () => {
  const folder = await window.lapse.chooseFolder();
  if (folder) {
    els.folderInput.value = folder;
    saveSettingsDebounced();
  }
});
els.openFolder.addEventListener('click', () => window.lapse.openPath(els.folderInput.value));
els.resultLink.addEventListener('click', () =>
  window.lapse.showItemInFolder(els.resultLink.dataset.path)
);

(async function init() {
  settings = await window.lapse.getSettings();

  els.themeSelect.value = ['purple', 'dark', 'light'].includes(settings.theme)
    ? settings.theme : 'purple';
  els.speedSelect.value = ['30', '60', '150', '300', '600', 'custom'].includes(String(settings.speedPreset))
    ? String(settings.speedPreset) : '150';
  els.intervalInput.value = settings.intervalSeconds;
  els.fpsInput.value = settings.outputFps;
  setRadio('format', settings.format);
  setRadio('res', String(settings.maxDimension));
  els.keepFrames.checked = settings.keepFrames;
  els.folderInput.value = settings.outputFolder;
  els.floatingTimer.checked = !!settings.showFloatingTimer;
  els.stampSize.value = ['small', 'medium', 'large'].includes(settings.stampSize)
    ? settings.stampSize : 'small';
  els.stampPos.value = ['topleft', 'topright', 'bottomleft', 'bottomright'].includes(settings.stampPosition)
    ? settings.stampPosition : 'topleft';

  applyTheme();
  applyModeToUI();
  updateSpeedSummary();
  updateControls();
  setStatus('Ready.');

  await populateSources();
  if (settings.sourceId) els.sourceSelect.value = settings.sourceId;

  previewLoop();
  ensureStreams().catch(() => {});
})();
