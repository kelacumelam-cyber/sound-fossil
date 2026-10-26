// Launches the packaged Windows app for real, loads a WAV, and exports a PNG.
// Usage: npm run smoke:package  (run npm run package first)
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { encodeWav } from '../tests/helpers/wav-fixture.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exePath = path.join(root, 'release', 'Sound Fossil-win32-x64', 'Sound Fossil.exe');
await access(exePath);

const workDir = await mkdtemp(path.join(os.tmpdir(), 'sound-fossil-smoke-'));
const wavPath = path.join(workDir, 'smoke.wav');
const pngPath = path.join(workDir, 'smoke.png');

const sampleRate = 44100;
const seconds = 4;
const samples = new Float32Array(sampleRate * seconds);
for (let i = 0; i < samples.length; i += 1) {
  const t = i / sampleRate;
  const envelope = Math.exp(-(t % 0.5) * 4);
  samples[i] = Math.sin(2 * Math.PI * 330 * t) * 0.45 * envelope;
}
await writeFile(wavPath, encodeWav({ samples, sampleRate, bitsPerSample: 16 }));

let app;
let ok = false;
try {
  app = await electron.launch({
    executablePath: exePath,
    env: {
      ...process.env,
      SOUND_FOSSIL_TEST: '1',
      SOUND_FOSSIL_EXPORT_PATH: pngPath,
    },
    timeout: 60000,
  });
  const page = await app.firstWindow({ timeout: 30000 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('Electron Security Warning')) {
      errors.push(message.text());
    }
  });
  await page.waitForSelector('#empty-state');
  await page.waitForFunction(() => Boolean(window.__soundFossilTest), undefined, { timeout: 30000 });
  assert.match(await page.title(), /Sound Fossil/);

  await page.setInputFiles('#file-input', wavPath);
  await page.waitForFunction(
    () => {
      const snapshot = window.__soundFossilTest?.snapshot();
      return Boolean(snapshot && snapshot.fingerprint && snapshot.geometryHash);
    },
    undefined,
    { timeout: 30000 },
  );
  const snapshot = await page.evaluate(() => window.__soundFossilTest.snapshot());
  assert.equal(snapshot.sourceKind, 'file');
  assert.equal(snapshot.ringCount, 128);
  assert.ok(snapshot.stats.dominantHz > 250 && snapshot.stats.dominantHz < 420);

  await page.locator('#export-button').click();
  await page.waitForFunction(
    () => document.querySelector('#toast-text')?.textContent.includes('PNG saved'),
    undefined,
    { timeout: 30000 },
  );
  const png = await readFile(pngPath);
  assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG');
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  assert.equal(width, 2048);
  assert.equal(height, 2048);
  assert.equal(errors.length, 0, `UI errors: ${errors.join(' | ')}`);
  ok = true;
  console.log(
    `Packaged app verified: ${path.basename(exePath)} · 128 layers · fingerprint ${snapshot.geometryHash} · PNG ${png.length} bytes`,
  );
} finally {
  await app?.close().catch(() => {});
  await rm(workDir, { recursive: true, force: true }).catch(() => {});
}

if (!ok) process.exitCode = 1;
