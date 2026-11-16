// Renders build/icon.png (512x512) from an inline SVG using Electron. Run: npx electron scripts/make-icon.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#22c55e"/><stop offset="1" stop-color="#0e7a3a"/></linearGradient></defs>
<rect x="16" y="16" width="480" height="480" rx="112" fill="#0b0d10"/>
<rect x="16" y="16" width="480" height="480" rx="112" fill="none" stroke="url(#g)" stroke-width="16"/>
<rect x="150" y="96" width="150" height="260" rx="26" fill="none" stroke="#e5e7eb" stroke-width="18"/>
<rect x="232" y="196" width="190" height="130" rx="18" fill="url(#g)"/>
<path d="M300 226 l40 35 -40 35z" fill="#0b0d10"/>
<rect x="190" y="372" width="160" height="44" rx="22" fill="#22c55e"/>
<circle cx="225" cy="394" r="9" fill="#0b0d10"/><circle cx="315" cy="394" r="9" fill="#0b0d10"/>
</svg>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 512, height: 512, show: false, frame: false, transparent: true, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,' + encodeURIComponent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`));
  await new Promise((r) => setTimeout(r, 400));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  const out = path.join(__dirname, '..', 'build');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'icon.png'), img.resize({ width: 512, height: 512 }).toPNG());
  console.log('icon written');
  app.quit();
});
