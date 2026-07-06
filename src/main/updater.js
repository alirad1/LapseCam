'use strict';

const https = require('https');
const { version: currentVersion } = require('../../package.json');

const REPO = 'alirad1/LapseCam';
const TIMEOUT_MS = 5000;

function parseVersion(v) {
  return String(v).replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
}

function isNewer(latest, current) {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}

function fetchLatestRelease() {
  return new Promise((resolve, reject) => {
    const req = https.get(
      {
        hostname: 'api.github.com',
        path: `/repos/${REPO}/releases/latest`,
        headers: { 'User-Agent': 'LapseCam' },
        timeout: TIMEOUT_MS
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
  });
}

async function checkForUpdates(dismissedVersion) {
  try {
    const release = await fetchLatestRelease();
    const latest = String(release.tag_name || '').replace(/^v/i, '');
    if (!latest || !isNewer(latest, currentVersion)) return null;
    if (dismissedVersion && dismissedVersion === latest) return null;
    return {
      version: latest,
      url: release.html_url || `https://github.com/${REPO}/releases/latest`
    };
  } catch {
    return null;
  }
}

module.exports = { checkForUpdates };
