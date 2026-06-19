'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

function ffmpegPath() {
  const p = require('ffmpeg-static');
  return p.replace('app.asar', 'app.asar.unpacked');
}

function friendlyName(ext) {
  const d = new Date();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  let h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const min = String(d.getMinutes()).padStart(2, '0');
  return `Study Session ${months[d.getMonth()]} ${d.getDate()} ${d.getFullYear()} at ${h}.${min} ${ampm}.${ext}`;
}

function uniqueOutputPath(folder, ext) {
  const base = friendlyName(ext);
  let candidate = path.join(folder, base);
  let n = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(folder, base.replace(`.${ext}`, ` ${n}.${ext}`));
    n++;
  }
  return candidate;
}

function buildArgs({ sessionDir, outputFps, format, outputPath }) {
  const input = [
    '-y',
    '-framerate', String(outputFps),
    '-start_number', '0',
    '-i', path.join(sessionDir, 'frame_%06d.jpg')
  ];
  const evenScale = 'scale=trunc(iw/2)*2:trunc(ih/2)*2';

  switch (format) {
    case 'mp4':
      return [
        ...input,
        '-vf', evenScale,
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '22',
        '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
        '-an', outputPath
      ];
    case 'mov':
      return [
        ...input,
        '-vf', evenScale,
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
        '-pix_fmt', 'yuv420p',
        '-an', outputPath
      ];
    case 'webm':
      return [
        ...input,
        '-vf', evenScale,
        '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '32', '-row-mt', '1',
        '-an', outputPath
      ];
    case 'gif':
      return [
        ...input,
        '-filter_complex',
        "[0:v]scale='min(720,iw)':-2:flags=lanczos,split[a][b];" +
          '[a]palettegen=stats_mode=diff[p];' +
          '[b][p]paletteuse=dither=bayer:bayer_scale=4',
        outputPath
      ];
    default:
      throw new Error(`Unknown format: ${format}`);
  }
}

function encode(opts, onProgress) {
  const { sessionDir, frameCount, outputFps, format, outputFolder } = opts;
  return new Promise((resolve, reject) => {
    if (!frameCount || frameCount < 2) {
      reject(new Error('Not enough frames captured (need at least 2). Record a little longer.'));
      return;
    }
    fs.mkdirSync(outputFolder, { recursive: true });
    if (!fs.existsSync(outputFolder)) throw new Error('Could not create output folder.');
    const outputPath = uniqueOutputPath(outputFolder, format);
    const args = buildArgs({ sessionDir, outputFps, format, outputPath });

    const proc = spawn(ffmpegPath(), args, { windowsHide: true });
    let stderrTail = '';

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderrTail = (stderrTail + text).slice(-6000);
      const m = /frame=\s*(\d+)/.exec(text);
      if (m && onProgress) {
        const pct = Math.min(99, Math.round((parseInt(m[1], 10) / frameCount) * 100));
        onProgress(pct);
      }
    });

    proc.on('error', (err) => reject(new Error(`Could not start ffmpeg: ${err.message}`)));
    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        if (onProgress) onProgress(100);
        resolve(outputPath);
      } else {
        reject(new Error(`ffmpeg exited with code ${code}:\n${stderrTail.slice(-800)}`));
      }
    });
  });
}

module.exports = { encode, ffmpegPath };
