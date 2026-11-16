'use strict';
// Downloads the official scrcpy v5.0.1 Windows release, verifies its SHA256 against the
// release's SHA256SUMS.txt and extracts only the files Emule needs into vendor/.
//   node scripts/fetch-vendor.js              → always (re)download
//   node scripts/fetch-vendor.js --if-missing → skip when vendor/ is already complete

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const VERSION = '5.0.1';
const BASE = `https://github.com/Genymobile/scrcpy/releases/download/v${VERSION}/`;
const ZIP_NAME = `scrcpy-win64-v${VERSION}.zip`;
const SUMS_NAME = 'SHA256SUMS.txt';
const WANTED = ['adb.exe', 'AdbWinApi.dll', 'AdbWinUsbApi.dll', 'scrcpy-server'];

const ROOT = path.resolve(__dirname, '..');
const VENDOR = path.join(ROOT, 'vendor');

function vendorComplete() {
  try {
    if (fs.readFileSync(path.join(VENDOR, 'VERSION'), 'utf8').trim() !== VERSION) return false;
    return WANTED.every((f) => fs.statSync(path.join(VENDOR, f)).size > 0);
  } catch {
    return false;
  }
}

async function download(url) {
  const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'emule-fetch-vendor' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ao baixar ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

function extractEntries(zipPath, outDir, names) {
  // Uses .NET ZipFile through PowerShell (no extra npm deps). Paths are passed via env vars
  // to avoid any quoting issues. Only entries whose file name is in `names` are extracted.
  const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$names = $env:EMULE_NAMES -split '\\|'
$zip = [System.IO.Compression.ZipFile]::OpenRead($env:EMULE_ZIP)
try {
  foreach ($e in $zip.Entries) {
    if ($e.Name -and ($names -ccontains $e.Name)) {
      $dest = Join-Path $env:EMULE_OUT $e.Name
      [System.IO.Compression.ZipFileExtensions]::ExtractToFile($e, $dest, $true)
      Write-Output ("extracted " + $e.FullName)
    }
  }
} finally { $zip.Dispose() }
`;
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps], {
    env: { ...process.env, EMULE_ZIP: zipPath, EMULE_OUT: outDir, EMULE_NAMES: names.join('|') },
    encoding: 'utf8',
    windowsHide: true,
  });
  process.stdout.write(out);
}

async function main() {
  const ifMissing = process.argv.includes('--if-missing');
  if (ifMissing && vendorComplete()) {
    console.log(`[fetch-vendor] vendor/ já contém scrcpy ${VERSION}; nada a fazer.`);
    return;
  }
  if (process.platform !== 'win32') {
    console.warn('[fetch-vendor] Aviso: os binários baixados são para Windows (win64).');
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'emule-vendor-'));
  try {
    console.log(`[fetch-vendor] Baixando ${SUMS_NAME}...`);
    const sums = (await download(BASE + SUMS_NAME)).toString('utf8');
    const line = sums.split(/\r?\n/).find((l) => l.trim().endsWith(ZIP_NAME));
    if (!line) throw new Error(`${ZIP_NAME} não encontrado em ${SUMS_NAME}`);
    const expected = line.trim().split(/\s+/)[0].toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(expected)) throw new Error(`Hash inválido em ${SUMS_NAME}: ${expected}`);

    console.log(`[fetch-vendor] Baixando ${ZIP_NAME}...`);
    const zip = await download(BASE + ZIP_NAME);
    const actual = crypto.createHash('sha256').update(zip).digest('hex');
    if (actual !== expected) {
      throw new Error(`SHA256 não confere para ${ZIP_NAME}: esperado ${expected}, obtido ${actual}`);
    }
    console.log(`[fetch-vendor] SHA256 OK (${actual}), ${zip.length} bytes`);

    const zipPath = path.join(tmp, ZIP_NAME);
    fs.writeFileSync(zipPath, zip);
    const outDir = path.join(tmp, 'out');
    fs.mkdirSync(outDir);
    extractEntries(zipPath, outDir, WANTED);

    for (const f of WANTED) {
      if (!fs.existsSync(path.join(outDir, f))) throw new Error(`Arquivo ${f} ausente no zip`);
    }
    fs.mkdirSync(VENDOR, { recursive: true });
    for (const f of WANTED) fs.copyFileSync(path.join(outDir, f), path.join(VENDOR, f));
    fs.writeFileSync(path.join(VENDOR, 'VERSION'), VERSION + '\n');
    console.log(`[fetch-vendor] OK: ${WANTED.join(', ')} → ${VENDOR}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('[fetch-vendor] ERRO:', err.message);
  // Never break `npm install` because of the postinstall step; `npm run fetch-vendor` still fails loudly.
  process.exit(process.argv.includes('--if-missing') ? 0 : 1);
});
