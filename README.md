# LapseCam — Free Time Lapse Recorder for Windows

**LapseCam** is a free, open source **time lapse recording tool** for Windows. Record your
screen, webcam, or both, hit stop, and get a sped-up video — no editing step after.

Perfect for **study time lapses**, coding sessions, digital art, and any long screen session
you want to condense into a short clip.

Website: [lapsecam.alirad.dev](https://lapsecam.alirad.dev)

## Download

Get the installer or portable exe from the
[releases page](https://github.com/alirad1/LapseCam/releases). Works on Windows 10/11.

The exe isn't code signed (those certs are expensive), so SmartScreen will complain
the first time. Click "More info" then "Run anyway", or build from source below.

## Features

- **Screen time lapse**, **webcam time lapse**, or screen with draggable webcam overlay
- Draggable blur regions to hide sensitive on-screen content
- Speed presets from 30× to 600×, or custom interval + fps
- Elapsed time stamped into the video, optional floating timer (excluded from capture)
- Pause/resume without splitting the session
- Auto-stop after a set number of hours
- Exports MP4, WebM, MOV, or GIF
- Check for updates on launch
- Everything stays local — offline, private, no upload

## How it works

Instead of recording full video and speeding it up later, LapseCam grabs one photo
every few seconds and writes it to disk. When you stop, ffmpeg stitches the frames
into a video at whatever speed you picked. Only one frame sits in memory at a time,
so long sessions stay lightweight.

## Run from source

Node 24 worked for me.

```
npm install
npm start
```

## Build

```
npm run dist
```

Output lands in `dist/` (installer + portable exe).

Run `npm run icon` to regenerate `build/icon.ico`. It's a tiny script that draws
the icon pixel by pixel so I didn't have to mess with an image editor.

## Layout

```
src/main/       electron main process, IPC, ffmpeg
src/renderer/   UI and capture loop
scripts/        gen-icon.js + set-exe-icon.js (post-build branding)
site/           landing page (lapsecam.alirad.dev)
```

## License

MIT
