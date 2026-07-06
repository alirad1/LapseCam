'use strict';

const fs = require('fs');
const path = require('path');
const { rcedit } = require('rcedit');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const icon = path.join(root, 'build', 'icon.ico');
const productName = pkg.productName || 'LapseCam';
const winVersion = pkg.version.split('.').length >= 4 ? pkg.version : `${pkg.version}.0`;

const targets = [
  path.join(root, 'dist', 'win-unpacked', `${productName}.exe`)
];

function exeMetadata() {
  const year = new Date().getFullYear();
  const author = typeof pkg.author === 'string' ? pkg.author : '';
  return {
    icon,
    'file-version': winVersion,
    'product-version': winVersion,
    'version-string': {
      FileDescription: productName,
      ProductName: productName,
      InternalName: productName,
      OriginalFilename: `${productName}.exe`,
      CompanyName: author,
      LegalCopyright: author ? `Copyright © ${year} ${author}` : `Copyright © ${year}`,
      Comments: pkg.description || productName
    }
  };
}

async function main() {
  if (!fs.existsSync(icon)) {
    console.error('Missing build/icon.ico — run npm run icon first.');
    process.exit(1);
  }

  const metadata = exeMetadata();
  let failed = false;
  for (const exe of targets) {
    if (!fs.existsSync(exe)) continue;
    try {
      await rcedit(exe, metadata);
      console.log('Branded:', path.relative(root, exe));
    } catch (err) {
      failed = true;
      console.warn('Could not brand', path.relative(root, exe) + ':', err.message || err);
    }
  }

  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
