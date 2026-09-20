# LapseCam

Windows app I built to turn study sessions into time-lapses. Record your screen,
webcam, or both, hit stop, and you get a sped-up video. No editing step after.

Website: [lapsecam.alirad.dev](https://lapsecam.alirad.dev)

## Download

Get the installer or portable exe from the
[releases page](https://github.com/alirad1/LapseCam/releases). Works on Windows 10/11.

The exe isn't code signed (those certs are expensive), so SmartScreen will complain
the first time. Click "More info" then "Run anyway", or build from source below.

To confirm your download is intact, compare its SHA-256 against `SHA256SUMS.txt` on the
release:

```
Get-FileHash .\LapseCam-1.2.0-setup.exe
```

## How it works

Instead of recording full video and speeding it up later, LapseCam grabs one photo
every few seconds and writes it to disk. When you stop, ffmpeg stitches the frames
into a video at whatever speed you picked. Only one frame sits in memory at a time,
so long sessions stay lightweight.

Features:

- Screen only, webcam only, or screen with a draggable webcam overlay
- Draggable blur regions to hide sensitive on-screen content
- Speed presets from 30x to 600x, or custom interval + fps
- Elapsed time stamped into the video, optional floating timer (excluded from capture)
- Pause/resume without splitting the session
- Auto-stop after a set number of hours
- Exports MP4, WebM, MOV, or GIF
- Check for updates on launch
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

Output lands in `dist/` (installer, portable exe, and `SHA256SUMS.txt`). Upload all
three to the GitHub release so the checksums on the site and README stay verifiable.

Run `npm run icon` to regenerate `build/icon.ico`. It's a tiny script that draws the
icon pixel by pixel (matching `site/favicon.svg`) so I didn't have to mess with an
image editor.

## Code signing

The download works fine, but SmartScreen warns because the exe is unsigned. Signing is
the only thing that removes the warning. Options, cheapest first:

- **SignPath Foundation** — free code signing for eligible open-source projects.
- **Certum Open Source Code Signing** — around $70/year.
- **Azure Trusted Signing** — around $10/month if you qualify.

Once you have a certificate, add it to `build.win` in `package.json`. For a local
`.pfx` (Certum etc.):

```json
"win": {
  "signtoolOptions": {
    "certificateFile": "path/to/cert.pfx",
    "certificatePassword": "..."
  }
}
```

For Azure Trusted Signing, set `AZURE_*` env vars and add an `azureSignOptions` block
per the electron-builder docs. Keep the certificate and password out of git.

## Layout

```
src/main/       electron main process, IPC, ffmpeg
src/renderer/   UI and capture loop
scripts/        gen-icon.js, set-exe-icon.js, gen-checksums.js (post-build)
site/           landing page
```

## License

MIT
