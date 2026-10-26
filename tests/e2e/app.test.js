import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { mkdir, readFile, writeFile, access, rm } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeWav } from '../helpers/wav-fixture.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const artifacts = path.join(root, 'artifacts');
const exportPath = path.join(artifacts, 'e2e-export.png');
const samplePath = path.join(artifacts, 'e2e-sample.wav');
const silentPath = path.join(artifacts, 'e2e-silent.wav');
const corruptPath = path.join(artifacts, 'e2e-corrupt.wav');
const screenshotPath = path.join(root, 'docs', 'screenshots', 'sound-fossil-interface.png');
const sampleShotPath = path.join(root, 'docs', 'screenshots', 'sample-fossil.png');

let app;
let page;
const consoleErrors = [];

function makeShowcaseSamples({ sampleRate = 44100, seconds = 12 } = {}) {
  const length = Math.floor(sampleRate * seconds);
  const samples = new Float32Array(length);
  const notes = [220, 277.18, 329.63, 440, 329.63, 277.18];
  const noteLength = 0.7;
  for (let i = 0; i < length; i += 1) {
    const t = i / sampleRate;
    const noteIndex = Math.floor(t / noteLength) % notes.length;
    const frequency = notes[noteIndex];
    const inNote = t % noteLength;
    const envelope = Math.min(1, inNote / 0.04) * Math.exp(-inNote * 0.9);
    let value = Math.sin(2 * Math.PI * frequency * t) * 0.32 * envelope;
    value += Math.sin(2 * Math.PI * frequency * 2.01 * t) * 0.09 * envelope;
    // A low beat every two seconds, with silence in between.
    const beatPhase = t % 2;
    if (beatPhase < 0.09) {
      const beatEnv = Math.sin((Math.PI * beatPhase) / 0.09) ** 2;
      value += Math.sin(2 * Math.PI * 62 * t) * 0.5 * beatEnv;
    }
    if (t > 9.2 && t < 10.4) value *= 0.03;
    samples[i] = Math.max(-1, Math.min(1, value));
  }
  return samples;
}

async function loadWav(filePath) {
  const previous = await page.evaluate(() => window.__soundFossilTest.snapshot().loadId);
  await page.setInputFiles('#file-input', filePath);
  await page.waitForFunction(
    (oldId) => {
      const testApi = window.__soundFossilTest;
      const snapshot = testApi && testApi.snapshot();
      return Boolean(snapshot && snapshot.fingerprint && snapshot.loadId > oldId);
    },
    previous,
    { timeout: 30000 },
  );
  return page.evaluate(() => window.__soundFossilTest.snapshot());
}

async function waitForGeometryHash(previous) {
  await page.waitForFunction(
    (old) => {
      const testApi = window.__soundFossilTest;
      const snapshot = testApi?.snapshot();
      return snapshot && snapshot.geometryHash && snapshot.geometryHash !== old && snapshot.viewer.hasSculpture;
    },
    previous,
    { timeout: 15000 },
  );
  return page.evaluate(() => window.__soundFossilTest.snapshot());
}

/** Fixes the camera at the default angle for visual comparisons. */
async function fixCamera() {
  await page.locator('#reset-view').click();
  if ((await page.locator('#toggle-rotate').getAttribute('aria-pressed')) === 'true') {
    await page.locator('#toggle-rotate').click();
  }
  await page.waitForTimeout(250);
}

function decodePng(buffer) {
  assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  assert.equal(bitDepth, 8);
  assert.equal(colorType, 6);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const pixels = Buffer.alloc(stride * height);
  let cursor = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[cursor];
    cursor += 1;
    const row = raw.subarray(cursor, cursor + stride);
    cursor += stride;
    const output = pixels.subarray(y * stride, (y + 1) * stride);
    const previous = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= 4 ? output[x - 4] : 0;
      const up = previous ? previous[x] : 0;
      const upperLeft = previous && x >= 4 ? previous[x - 4] : 0;
      let value = row[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += Math.floor((left + up) / 2);
      else if (filter === 4) {
        const p = left + up - upperLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upperLeft);
        const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upperLeft;
        value += predictor;
      }
      output[x] = value & 0xff;
    }
  }
  return { width, height, pixels, stride };
}

before(async () => {
  await mkdir(artifacts, { recursive: true });
  await mkdir(path.dirname(screenshotPath), { recursive: true });
  await rm(exportPath, { force: true });

  const showcase = makeShowcaseSamples();
  await writeFile(samplePath, encodeWav({ samples: showcase, sampleRate: 44100, bitsPerSample: 16 }));
  await writeFile(
    silentPath,
    encodeWav({ samples: new Float32Array(44100 * 2), sampleRate: 44100, bitsPerSample: 16 }),
  );
  const corrupt = encodeWav({ samples: new Float32Array(4410) });
  corrupt.write('NOPE', 0, 'ascii');
  await writeFile(corruptPath, corrupt);

  app = await electron.launch({
    args: [root],
    cwd: root,
    env: {
      ...process.env,
      SOUND_FOSSIL_TEST: '1',
      SOUND_FOSSIL_FAKE_MIC: '1',
      SOUND_FOSSIL_EXPORT_PATH: exportPath,
    },
    timeout: 60000,
  });
  page = await app.firstWindow({ timeout: 30000 });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      const text = message.text();
      if (!text.includes('Electron Security Warning')) consoleErrors.push(text);
    }
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  await page.waitForSelector('#empty-state');
  await page.waitForFunction(() => Boolean(window.__soundFossilTest), undefined, { timeout: 30000 });
});

after(async () => {
  await app?.close();
});

test('app opens with an empty plinth and export disabled', async () => {
  assert.equal(await page.locator('#empty-state').isVisible(), true);
  assert.equal(await page.locator('#export-button').isDisabled(), true);
  assert.equal(await page.locator('#stats').getAttribute('class'), 'stats');
  const title = await page.title();
  assert.match(title, /Sound Fossil/);
});

test('a real WAV is loaded, analyzed, and turned into a sculpture', async () => {
  const snapshot = await loadWav(samplePath);
  assert.ok(snapshot.fingerprint);
  assert.ok(snapshot.geometryHash);
  assert.equal(snapshot.ringCount, 128);
  assert.equal(snapshot.sourceKind, 'file');
  assert.equal(snapshot.silent, false);
  assert.ok(snapshot.stats.dominantHz > 100);
  assert.ok(snapshot.name.length > 3);

  await page.locator('#empty-state').waitFor({ state: 'hidden', timeout: 5000 });
  assert.equal(await page.locator('#empty-state').isVisible(), false);
  assert.equal(await page.locator('#specimen-plate').isVisible(), true);
  assert.equal(await page.locator('#export-button').isEnabled(), true);
  assert.match(await page.locator('#stat-duration').innerText(), /00:12/);
  assert.match(await page.locator('#specimen-name').innerText(), /\S+/);

  await fixCamera();
  await page.screenshot({ path: screenshotPath });
});

test('the same audio and settings produce the same fossil', async () => {
  const first = await page.evaluate(() => window.__soundFossilTest.snapshot());
  const second = await loadWav(samplePath);
  assert.equal(second.fingerprint, first.fingerprint);
  assert.equal(second.geometryHash, first.geometryHash);
  assert.equal(second.name, first.name);

  await page.evaluate(() => {
    const input = document.querySelector('#setting-strata');
    input.value = '180';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const changed = await waitForGeometryHash(first.geometryHash);
  assert.equal(changed.ringCount, 180);
  assert.notEqual(changed.geometryHash, first.geometryHash);

  await page.evaluate(() => {
    const input = document.querySelector('#setting-strata');
    input.value = '128';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const restored = await waitForGeometryHash(changed.geometryHash);
  assert.equal(restored.geometryHash, first.geometryHash);
});

test('the sculpture is exported as a 2048×2048 PNG', async () => {
  await fixCamera();
  await page.locator('#export-button').click();
  await page.waitForFunction(
    () => {
      const toast = document.querySelector('#toast-text');
      return toast && toast.textContent.includes('PNG saved');
    },
    undefined,
    { timeout: 30000 },
  );
  await access(exportPath);
  const buffer = await readFile(exportPath);
  assert.ok(buffer.length > 100000, `PNG is too small: ${buffer.length} bytes`);
  const decoded = decodePng(buffer);
  assert.equal(decoded.width, 2048);
  assert.equal(decoded.height, 2048);
  await writeFile(sampleShotPath, buffer);

  // Verify that the image is not monochrome.
  const seen = new Set();
  for (let i = 0; i < decoded.pixels.length; i += 4 * 97) {
    seen.add(decoded.pixels.readUInt32BE(i));
    if (seen.size > 50) break;
  }
  assert.ok(seen.size > 50, 'PNG is nearly monochrome');
});

test('a silent WAV becomes a valid core fossil', async () => {
  const snapshot = await loadWav(silentPath);
  assert.equal(snapshot.silent, true);
  assert.ok(snapshot.geometryHash);
  assert.equal(await page.locator('#silent-note').isVisible(), true);
  assert.equal(await page.locator('#specimen-plate').isVisible(), true);
});

test('a corrupt WAV gives a clear error and the existing fossil is preserved', async () => {
  const before = await page.evaluate(() => window.__soundFossilTest.snapshot());
  await page.setInputFiles('#file-input', corruptPath);
  await page.waitForFunction(
    () => {
      const toast = document.querySelector('#toast-text');
      return toast && /WAV|RIFF/i.test(toast.textContent) && document.querySelector('#toast').classList.contains('show');
    },
    undefined,
    { timeout: 15000 },
  );
  const toast = await page.locator('#toast-text').innerText();
  assert.match(toast, /WAV|RIFF/i);
  const after = await page.evaluate(() => window.__soundFossilTest.snapshot());
  assert.equal(after.geometryHash, before.geometryHash);
  assert.equal(await page.locator('#specimen-plate').isVisible(), true);
});

test('microphone permission is requested explicitly and recording works', async () => {
  await page.locator('#mic-button').click();
  const dialog = page.locator('#permission-dialog');
  await dialog.waitFor({ state: 'visible' });
  assert.match(await dialog.innerText(), /Allow microphone access\?/);
  await page.locator('#allow-mic').click();
  await page.waitForFunction(() => document.querySelector('#recording-panel').hidden === false, undefined, {
    timeout: 15000,
  });
  await page.waitForTimeout(1800);
  await page.locator('#stop-recording').click();
  await page.waitForFunction(
    () => {
      const testApi = window.__soundFossilTest;
      const snapshot = testApi?.snapshot();
      return snapshot && snapshot.sourceKind === 'mic' && snapshot.fingerprint;
    },
    undefined,
    { timeout: 30000 },
  );
  const snapshot = await page.evaluate(() => window.__soundFossilTest.snapshot());
  assert.equal(snapshot.sourceKind, 'mic');
  assert.ok(snapshot.analyzedDuration > 1);
  assert.equal(await page.locator('#source-name').innerText(), 'Microphone recording');
});

test('no critical UI errors occurred', async () => {
  assert.deepEqual(consoleErrors, []);
});
