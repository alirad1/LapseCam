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
  previewHintText: $('previewHintText'),
  previewHintClose: $('previewHintClose'),
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
  stampPos: $('stampPos'),
  autoStopHours: $('autoStopHours'),
  checkForUpdates: $('checkForUpdates'),
  blurDock: $('blurDock'),
  blurDrawBtn: $('blurDrawBtn'),
  blurFullScreenBtn: $('blurFullScreenBtn'),
  blurRemoveSelectedBtn: $('blurRemoveSelectedBtn'),
  updateBanner: $('updateBanner'),
  updateBannerText: $('updateBannerText'),
  updateDownload: $('updateDownload'),
  updateDismiss: $('updateDismiss')
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
let autoStopTimer = null;
let blurModeActive = false;
let selectedBlurIndex = -1;
let pendingUpdate = null;
let cameraHintTimer = null;
let cameraHintDismissedSession = false;
const CAMERA_HINT_MS = 10000;

const MIN_BLUR = 0.05;
const BLUR_PX = 24;
const blurScratch = document.createElement('canvas');
const blurCtx = blurScratch.getContext('2d');

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
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.stroke();
}

function applyBlurRegions(ctx, W, H) {
  const regions = settings.blurRegions;
  if (!regions.length) return;
  for (const r of regions) {
    const x = Math.round(r.x * W);
    const y = Math.round(r.y * H);
    const w = Math.max(1, Math.round(r.w * W));
    const h = Math.max(1, Math.round(r.h * H));
    if (blurScratch.width !== w || blurScratch.height !== h) {
      blurScratch.width = w;
      blurScratch.height = h;
    }
    blurCtx.filter = 'none';
    blurCtx.drawImage(ctx.canvas, x, y, w, h, 0, 0, w, h);
    ctx.save();
    ctx.filter = `blur(${BLUR_PX}px)`;
    ctx.drawImage(blurScratch, 0, 0, w, h, x, y, w, h);
    ctx.restore();
  }
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
    if (settings.blurRegions.length) applyBlurRegions(ctx, W, H);
    if (mode === 'screen-overlay' && webcamVideo.videoWidth) {
      drawWebcamOverlay(ctx, W, H);
    }
  }
  if (recState === 'recording' || recState === 'paused') {
    drawTimeStamp(ctx, W, H);
  }
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
  els.previewMsg.textContent = 'Starting preview…';

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

function isFullScreenRegion(r) {
  return r.x === 0 && r.y === 0 && r.w === 1 && r.h === 1;
}

function hitTestBlurRegions(p) {
  const regions = settings.blurRegions;
  for (let i = regions.length - 1; i >= 0; i--) {
    const r = regions[i];
    if (isFullScreenRegion(r)) continue;
    const nearCorner =
      Math.abs(p.x - (r.x + r.w)) < 0.03 && Math.abs(p.y - (r.y + r.h)) < 0.045;
    const inside = p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
    if (nearCorner) return { index: i, type: 'resize' };
    if (inside) return { index: i, type: 'move' };
  }
  return null;
}

function hitTestWebcam(p) {
  if (settings.mode !== 'screen-overlay') return null;
  const o = settings.overlay;
  const nearCorner =
    Math.abs(p.x - (o.x + o.w)) < 0.03 && Math.abs(p.y - (o.y + o.h)) < 0.045;
  const inside = p.x >= o.x && p.x <= o.x + o.w && p.y >= o.y && p.y <= o.y + o.h;
  if (nearCorner) return { type: 'resize' };
  if (inside) return { type: 'move' };
  return null;
}

function drawBlurPreviewOverlays(ctx, W, H) {
  settings.blurRegions.forEach((r, i) => {
    if (isFullScreenRegion(r)) return;
    const x = r.x * W, y = r.y * H, w = r.w * W, h = r.h * H;
    const selected = i === selectedBlurIndex;
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = selected ? 'rgba(255, 180, 50, 0.95)' : 'rgba(255, 180, 50, 0.7)';
    ctx.lineWidth = selected ? 2.5 : 1.5;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.setLineDash([]);
    if (selected) {
      ctx.beginPath();
      ctx.arc(x + w - 4, y + h - 4, 7, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 180, 50, 0.95)';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();
  });
}

function isFullScreenBlur() {
  const r = settings.blurRegions;
  return r.length === 1 && isFullScreenRegion(r[0]);
}

function clearCameraHintTimer() {
  if (cameraHintTimer) {
    clearTimeout(cameraHintTimer);
    cameraHintTimer = null;
  }
}

function dismissCameraHint() {
  cameraHintDismissedSession = true;
  clearCameraHintTimer();
  els.previewHint.hidden = true;
  els.previewHintClose.hidden = true;
}

function showCameraHintTimed() {
  if (cameraHintDismissedSession) return;
  clearCameraHintTimer();
  els.previewHintText.textContent =
    'Drag the camera box to move it. Drag the corner handle to resize.';
  els.previewHintClose.hidden = false;
  els.previewHint.hidden = false;
  cameraHintTimer = setTimeout(dismissCameraHint, CAMERA_HINT_MS);
}

function updateBlurUI() {
  const show = settings.mode !== 'webcam';
  const fullScreen = isFullScreenBlur();
  if (fullScreen) blurModeActive = false;

  els.blurDock.hidden = !show;
  els.blurDrawBtn.disabled = fullScreen;
  els.blurDrawBtn.classList.toggle('outline-active', blurModeActive);
  els.blurFullScreenBtn.classList.toggle('outline-active', fullScreen);
  const hasSelection = selectedBlurIndex >= 0;
  els.blurRemoveSelectedBtn.disabled = !hasSelection;
  els.blurRemoveSelectedBtn.classList.toggle('primary', hasSelection);
  updatePreviewHint();
}

function updatePreviewHint() {
  if (recState === 'recording' || recState === 'paused' || recState === 'encoding') {
    clearCameraHintTimer();
    els.previewHint.hidden = true;
    return;
  }
  if (blurModeActive && settings.mode !== 'webcam') {
    clearCameraHintTimer();
    els.previewHintText.textContent = 'Click and drag on the preview to draw a blur area.';
    els.previewHintClose.hidden = true;
    els.previewHint.hidden = false;
    return;
  }
  if (settings.mode === 'screen-overlay' && !cameraHintDismissedSession) {
    showCameraHintTimed();
    return;
  }
  clearCameraHintTimer();
  els.previewHint.hidden = true;
  els.previewHintClose.hidden = true;
}

function deleteSelectedBlur() {
  if (selectedBlurIndex < 0) return;
  settings.blurRegions.splice(selectedBlurIndex, 1);
  selectedBlurIndex = -1;
  updateBlurUI();
  saveSettingsDebounced();
}

function blurEntireScreen() {
  if (isFullScreenBlur()) {
    settings.blurRegions = [];
    selectedBlurIndex = -1;
  } else {
    settings.blurRegions = [{ x: 0, y: 0, w: 1, h: 1 }];
    selectedBlurIndex = 0;
  }
  blurModeActive = false;
  updateBlurUI();
  saveSettingsDebounced();
}

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

    const W = els.previewCanvas.width, H = els.previewCanvas.height;
    if (mode !== 'webcam') drawBlurPreviewOverlays(previewCtx, W, H);

    if (dragState && dragState.kind === 'blur-create') {
      const x1 = Math.min(dragState.startX, dragState.curX) * W;
      const y1 = Math.min(dragState.startY, dragState.curY) * H;
      const rw = Math.abs(dragState.curX - dragState.startX) * W;
      const rh = Math.abs(dragState.curY - dragState.startY) * H;
      previewCtx.save();
      previewCtx.setLineDash([6, 4]);
      previewCtx.strokeStyle = 'rgba(255, 180, 50, 0.9)';
      previewCtx.lineWidth = 2;
      previewCtx.strokeRect(x1 + 0.5, y1 + 0.5, rw - 1, rh - 1);
      previewCtx.restore();
    }

    if (mode === 'screen-overlay') {
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
  const mode = settings.mode;
  const p = canvasPos(evt);

  const webcamHit = hitTestWebcam(p);
  if (webcamHit) {
    dragState = {
      kind: 'webcam',
      type: webcamHit.type,
      startX: p.x, startY: p.y,
      orig: { ...settings.overlay }
    };
    els.previewCanvas.setPointerCapture(evt.pointerId);
    return;
  }

  if (mode !== 'webcam') {
    const blurHit = hitTestBlurRegions(p);
    if (blurHit) {
      selectedBlurIndex = blurHit.index;
      updateBlurUI();
      const r = settings.blurRegions[blurHit.index];
      dragState = {
        kind: 'blur',
        type: blurHit.type,
        index: blurHit.index,
        startX: p.x, startY: p.y,
        orig: { ...r }
      };
      els.previewCanvas.setPointerCapture(evt.pointerId);
      return;
    }
    if (blurModeActive) {
      selectedBlurIndex = -1;
      updateBlurUI();
      dragState = { kind: 'blur-create', startX: p.x, startY: p.y, curX: p.x, curY: p.y };
      els.previewCanvas.setPointerCapture(evt.pointerId);
      return;
    }
    selectedBlurIndex = -1;
    updateBlurUI();
  }
});

els.previewCanvas.addEventListener('pointermove', (evt) => {
  const mode = settings.mode;
  const p = canvasPos(evt);

  if (!dragState) {
    let cursor = 'default';
    const webcamHit = hitTestWebcam(p);
    if (webcamHit) {
      cursor = webcamHit.type === 'resize' ? 'nwse-resize' : 'grab';
    } else if (mode !== 'webcam') {
      const blurHit = hitTestBlurRegions(p);
      if (blurHit) {
        cursor = blurHit.type === 'resize' ? 'nwse-resize' : 'grab';
      } else if (blurModeActive) {
        cursor = 'crosshair';
      }
    }
    els.previewCanvas.style.cursor = cursor;
    return;
  }

  const dx = p.x - dragState.startX;
  const dy = p.y - dragState.startY;

  if (dragState.kind === 'blur-create') {
    dragState.curX = p.x;
    dragState.curY = p.y;
    const x1 = Math.min(dragState.startX, p.x);
    const y1 = Math.min(dragState.startY, p.y);
    const w = Math.abs(p.x - dragState.startX);
    const h = Math.abs(p.y - dragState.startY);
    if (w >= MIN_BLUR && h >= MIN_BLUR) {
      const temp = { x: x1, y: y1, w, h };
      if (!dragState.preview) {
        dragState.preview = true;
        settings.blurRegions.push(temp);
        selectedBlurIndex = settings.blurRegions.length - 1;
      } else {
        Object.assign(settings.blurRegions[selectedBlurIndex], temp);
      }
      updateBlurUI();
    }
    return;
  }

  if (dragState.kind === 'blur') {
    const r = settings.blurRegions[dragState.index];
    const orig = dragState.orig;
    if (dragState.type === 'move') {
      r.x = Math.min(Math.max(orig.x + dx, 0), 1 - r.w);
      r.y = Math.min(Math.max(orig.y + dy, 0), 1 - r.h);
    } else {
      r.w = Math.min(Math.max(orig.w + dx, MIN_BLUR), 1 - r.x);
      r.h = Math.min(Math.max(orig.h + dy, MIN_BLUR), 1 - r.y);
    }
    return;
  }

  if (dragState.kind === 'webcam') {
    const o = settings.overlay;
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
  }
});

els.previewCanvas.addEventListener('pointerup', () => {
  if (!dragState) return;
  if (dragState.kind === 'blur-create') {
    if (!dragState.preview) {
      selectedBlurIndex = -1;
    } else {
      const r = settings.blurRegions[selectedBlurIndex];
      if (r.w < MIN_BLUR || r.h < MIN_BLUR) {
        settings.blurRegions.splice(selectedBlurIndex, 1);
        selectedBlurIndex = -1;
      } else {
        blurModeActive = false;
        dismissCameraHint();
      }
    }
    updateBlurUI();
  }
  dragState = null;
  saveSettingsDebounced();
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
    if (recState === 'recording' && autoStopLimitMs() > 0) setRecordingStatus();
  }, 500);
}

function autoStopLimitMs() {
  const h = Number(els.autoStopHours.value) || 0;
  return h > 0 ? h * 3600 * 1000 : 0;
}

function clearAutoStop() {
  if (autoStopTimer) {
    clearTimeout(autoStopTimer);
    autoStopTimer = null;
  }
}

function scheduleAutoStop() {
  clearAutoStop();
  const limit = autoStopLimitMs();
  if (!limit || recState !== 'recording') return;
  const remaining = limit - elapsedMs();
  if (remaining <= 0) {
    onAutoStopFired();
    return;
  }
  autoStopTimer = setTimeout(onAutoStopFired, remaining);
}

async function onAutoStopFired() {
  autoStopTimer = null;
  if (recState === 'recording' || recState === 'paused') {
    setStatus('Auto-stop limit reached — saving video…');
    await stopRecording();
  }
}

function trimNum(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
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

  const intervalMs = Math.max(200, activeTimings.interval * 1000);
  captureFrame();
  captureTimer = setInterval(captureFrame, intervalMs);
  startClock();
  scheduleAutoStop();

  if (els.floatingTimer.checked) window.lapse.showOverlay();
  els.resultWrap.hidden = true;
  updateControls();
  setRecordingStatus();
}

function setRecordingStatus() {
  let msg = `Recording (1 photo every ${trimNum(activeTimings.interval)} seconds)`;
  const limit = autoStopLimitMs();
  if (limit > 0) {
    const rem = limit - elapsedMs();
    if (rem > 0) msg += ` · Auto-stopping in ${fmtHMS(rem)}`;
  }
  setStatus(msg, false, true);
}

function pauseRecording() {
  recState = 'paused';
  clearInterval(captureTimer); captureTimer = null;
  clearAutoStop();
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
  scheduleAutoStop();
  updateControls();
  setRecordingStatus();
}

async function stopRecording() {
  clearAutoStop();
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
  updatePreviewHint();

  switch (recState) {
    case 'idle':
      els.recordBtnLabel.textContent = 'Start Recording';
      btn.disabled = false;
      els.stopBtn.disabled = true;
      break;
    case 'recording':
      els.recordBtnLabel.textContent = 'Pause Recording';
      btn.disabled = false;
      els.stopBtn.disabled = false;
      break;
    case 'paused':
      els.recordBtnLabel.textContent = 'Resume Recording';
      btn.disabled = false;
      els.stopBtn.disabled = false;
      break;
    case 'encoding':
      els.recordBtnLabel.textContent = 'Building video…';
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
      blurRegions: settings.blurRegions,
      outputFolder: els.folderInput.value,
      keepFrames: els.keepFrames.checked,
      showFloatingTimer: els.floatingTimer.checked,
      stampSize: els.stampSize.value,
      stampPosition: els.stampPos.value,
      autoStopHours: Number(els.autoStopHours.value) || 0,
      checkForUpdates: els.checkForUpdates.checked,
      dismissedVersion: settings.dismissedVersion || ''
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
  updateBlurUI();
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
for (const el of [els.floatingTimer, els.stampSize, els.stampPos, els.autoStopHours, els.checkForUpdates]) {
  el.addEventListener('change', saveSettingsDebounced);
}
els.autoStopHours.addEventListener('input', saveSettingsDebounced);

els.blurDrawBtn.addEventListener('click', () => {
  if (isFullScreenBlur()) return;
  blurModeActive = !blurModeActive;
  if (blurModeActive) dismissCameraHint();
  if (!blurModeActive) selectedBlurIndex = -1;
  updateBlurUI();
});
els.previewHintClose.addEventListener('click', dismissCameraHint);
els.blurFullScreenBtn.addEventListener('click', () => {
  blurEntireScreen();
});
els.blurRemoveSelectedBtn.addEventListener('click', () => {
  deleteSelectedBlur();
});
els.openFolderSettings.addEventListener('click', () =>
  window.lapse.openPath(els.folderInput.value)
);

els.settingsBtn.addEventListener('click', () => { els.settingsModal.hidden = false; });
els.settingsX.addEventListener('click', () => { els.settingsModal.hidden = true; });
els.settingsModal.addEventListener('click', (evt) => {
  if (evt.target === els.settingsModal) els.settingsModal.hidden = true;
});
document.addEventListener('keydown', (evt) => {
  if (evt.key === 'Escape') {
    els.settingsModal.hidden = true;
    if (blurModeActive) {
      blurModeActive = false;
      updateBlurUI();
    }
  }
  if ((evt.key === 'Delete' || evt.key === 'Backspace') && selectedBlurIndex >= 0) {
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    evt.preventDefault();
    deleteSelectedBlur();
  }
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

function showUpdateBanner(info) {
  pendingUpdate = info;
  els.updateBannerText.textContent = `LapseCam ${info.version} is available.`;
  els.updateBanner.hidden = false;
}

window.lapse.onUpdateAvailable((info) => showUpdateBanner(info));

els.updateDownload.addEventListener('click', () => {
  if (pendingUpdate) window.lapse.openExternal(pendingUpdate.url);
});
els.updateDismiss.addEventListener('click', () => {
  if (pendingUpdate) {
    settings.dismissedVersion = pendingUpdate.version;
    window.lapse.saveSettings({ dismissedVersion: pendingUpdate.version });
  }
  els.updateBanner.hidden = true;
});

(async function init() {
  settings = await window.lapse.getSettings();
  if (!Array.isArray(settings.blurRegions)) settings.blurRegions = [];

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
  els.autoStopHours.value = settings.autoStopHours || 0;
  els.checkForUpdates.checked = settings.checkForUpdates !== false;

  applyTheme();
  applyModeToUI();
  updateBlurUI();
  updateSpeedSummary();
  updateControls();
  setStatus('Ready.');

  await populateSources();
  if (settings.sourceId) els.sourceSelect.value = settings.sourceId;

  previewLoop();
  ensureStreams().catch(() => {});
})();
