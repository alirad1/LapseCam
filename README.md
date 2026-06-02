# LapseCam

Windows app I built to turn study sessions into time-lapses. Record your screen,
webcam, or both, hit stop, and you get a sped-up video. No editing step after.

Website: [lapsecam.alirad.dev](https://lapsecam.alirad.dev)

## Download

Get the installer or portable exe from the
[releases page](https://github.com/alirad1/LapseCam/releases). Works on Windows 10/11.

The exe isn't code signed (those certs are expensive), so SmartScreen will complain
the first time. Click "More info" then "Run anyway", or build from source below.

## How it works

Instead of recording full video and speeding it up later, LapseCam grabs one photo
every few seconds and writes it to disk. When you stop, ffmpeg stitches the frames
into a video at whatever speed you picked. Only one frame sits in memory at a time,
so long sessions stay lightweight.

Features:

- Screen only, webcam only, or screen with a draggable webcam overlay
- Speed presets from 30x to 600x, or custom interval + fps
- Elapsed time stamped into the video, optional floating timer (excluded from capture)
- Pause/resume without splitting the session
- Exports MP4, WebM, MOV, or GIF
- Everything stays local

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
scripts/        icon generator
site/           landing page
```

## Status

Beta build — things might break.

## License

MIT
