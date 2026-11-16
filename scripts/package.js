'use strict';
// Builds dist/Emule-win32-x64/Emule.exe with vendor binaries in resources/vendor.

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');

async function main() {
  const vendor = path.join(ROOT, 'vendor');
  for (const f of ['adb.exe', 'AdbWinApi.dll', 'AdbWinUsbApi.dll', 'scrcpy-server', 'VERSION']) {
    if (!fs.existsSync(path.join(vendor, f))) {
      throw new Error(`vendor/${f} ausente — rode "npm run fetch-vendor" primeiro.`);
    }
  }
  const mod = await import('@electron/packager');
  const packager = mod.packager || mod.default;
  const icon = path.join(ROOT, 'build', 'icon.ico');
  const opts = {
    dir: ROOT,
    out: path.join(ROOT, 'dist'),
    name: 'Emule',
    executableName: 'Emule',
    platform: 'win32',
    arch: 'x64',
    overwrite: true,
    asar: true,
    prune: true,
    extraResource: [vendor],
    ignore: [
      /^\/dist($|\/)/,
      /^\/test($|\/)/,
      /^\/docs($|\/)/,
      /^\/scripts($|\/)/,
      /^\/vendor($|\/)/,
      /^\/node_modules($|\/)/, // no runtime dependencies
      /^\/src\/renderer\/keymap\/README\.md$/,
      /^\/build($|\/)/,
      /^\/\.claude($|\/)/,
      /^\/\.git($|\/)/,
    ],
    win32metadata: {
      CompanyName: 'Emule',
      FileDescription: 'Emule',
      ProductName: 'Emule',
      InternalName: 'Emule',
    },
  };
  if (fs.existsSync(icon)) opts.icon = icon;
  const paths = await packager(opts);
  for (const p of paths) console.log(`[package] gerado: ${p}`);
}

main().catch((err) => {
  console.error('[package] ERRO:', err.message);
  process.exit(1);
});
