'use strict';

// Writes dist/SHA256SUMS.txt with a SHA-256 for each built .exe. Upload this
// file alongside the installers on the GitHub release so people can verify
// their download matches (see the "Is it safe to install?" section on the site).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const distDir = path.join(__dirname, '..', 'dist');

function sha256(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

function main() {
  if (!fs.existsSync(distDir)) {
    console.error('No dist/ folder — run npm run dist first.');
    process.exit(1);
  }
  const exes = fs.readdirSync(distDir).filter((f) => f.toLowerCase().endsWith('.exe'));
  if (!exes.length) {
    console.error('No .exe files in dist/.');
    process.exit(1);
  }
  const lines = exes.sort().map((f) => `${sha256(path.join(distDir, f))} *${f}`);
  const outPath = path.join(distDir, 'SHA256SUMS.txt');
  fs.writeFileSync(outPath, lines.join('\n') + '\n');
  console.log(`Wrote ${path.relative(path.join(__dirname, '..'), outPath)}:`);
  for (const line of lines) console.log('  ' + line);
}

main();
