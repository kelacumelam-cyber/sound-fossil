import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWav, WavError } from '../../src/core/wav.js';
import { encodeWav, sineSamples } from '../helpers/wav-fixture.js';

function toArrayBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

test('16-bit mono WAV is decoded and duration is calculated correctly', () => {
  const samples = sineSamples({ seconds: 0.25, amplitude: 0.5 });
  const wav = encodeWav({ samples, sampleRate: 44100, bitsPerSample: 16 });
  const parsed = parseWav(toArrayBuffer(wav));
  assert.equal(parsed.sampleRate, 44100);
  assert.equal(parsed.channels, 1);
  assert.equal(parsed.bitsPerSample, 16);
  assert.equal(parsed.format, 'pcm');
  assert.equal(parsed.frameCount, samples.length);
  assert.ok(Math.abs(parsed.duration - 0.25) < 1e-9);
  const peak = Math.max(...parsed.samples.slice(0, 2000).map(Math.abs));
  assert.ok(peak > 0.48 && peak <= 0.5001, `expected a peak of ~0.5, got ${peak}`);
});

test('stereo WAV is downmixed to mono', () => {
  const left = new Float32Array([0.5, 0.25, -0.5, 0]);
  const right = new Float32Array([0.5, -0.25, 0.5, 0]);
  const interleaved = new Float32Array(8);
  for (let i = 0; i < 4; i += 1) {
    interleaved[i * 2] = left[i];
    interleaved[i * 2 + 1] = right[i];
  }
  const parsed = parseWav(
    toArrayBuffer(encodeWav({ samples: interleaved, channels: 2, bitsPerSample: 16 })),
  );
  assert.equal(parsed.channels, 2);
  assert.equal(parsed.samples.length, 4);
  assert.ok(Math.abs(parsed.samples[0] - 0.5) < 1e-4);
  assert.ok(Math.abs(parsed.samples[1]) < 1e-4);
  assert.ok(Math.abs(parsed.samples[2]) < 1e-4);
  assert.ok(Math.abs(parsed.samples[3]) < 1e-4);
});

test('24-bit PCM signed samples are decoded correctly', () => {
  const samples = new Float32Array([0.5, -0.25, 0, 0.999]);
  const parsed = parseWav(
    toArrayBuffer(encodeWav({ samples, bitsPerSample: 24, sampleRate: 48000 })),
  );
  assert.equal(parsed.bitsPerSample, 24);
  assert.ok(Math.abs(parsed.samples[0] - 0.5) < 1e-6);
  assert.ok(Math.abs(parsed.samples[1] + 0.25) < 1e-6);
  assert.equal(parsed.samples[2], 0);
  assert.ok(parsed.samples[3] > 0.998);
});

test('8-bit and 32-bit PCM are supported', () => {
  const source = new Float32Array([0, 0.5, -0.5, 0.9]);
  for (const bitsPerSample of [8, 32]) {
    const parsed = parseWav(toArrayBuffer(encodeWav({ samples: source, bitsPerSample })));
    assert.equal(parsed.bitsPerSample, bitsPerSample);
    assert.ok(Math.abs(parsed.samples[0]) < 0.01);
    assert.ok(Math.abs(parsed.samples[1] - 0.5) < 0.02);
    assert.ok(Math.abs(parsed.samples[2] + 0.5) < 0.02);
  }
});

test('IEEE float32 WAV is decoded and NaN samples are zeroed', () => {
  const samples = new Float32Array([0.1, Number.NaN, -0.4]);
  const parsed = parseWav(
    toArrayBuffer(encodeWav({ samples, bitsPerSample: 32, format: 'float' })),
  );
  assert.equal(parsed.format, 'float');
  assert.ok(Math.abs(parsed.samples[0] - 0.1) < 1e-7);
  assert.equal(parsed.samples[1], 0);
  assert.ok(Math.abs(parsed.samples[2] + 0.4) < 1e-7);
});

test('WAVE_FORMAT_EXTENSIBLE PCM is accepted', () => {
  const samples = sineSamples({ seconds: 0.05 });
  const parsed = parseWav(
    toArrayBuffer(encodeWav({ samples, extensible: true, bitsPerSample: 16 })),
  );
  assert.equal(parsed.format, 'pcm');
  assert.equal(parsed.sampleRate, 44100);
});

test('data chunk is decoded even when it comes before fmt', () => {
  const samples = sineSamples({ seconds: 0.05 });
  const parsed = parseWav(
    toArrayBuffer(encodeWav({ samples, dataBeforeFmt: true })),
  );
  assert.equal(parsed.frameCount, samples.length);
});

test('corrupt headers produce clear error codes', () => {
  const samples = sineSamples({ seconds: 0.05 });

  assert.throws(
    () => parseWav(toArrayBuffer(encodeWav({ samples, overrideRiff: 'RIFX' }))),
    (error) => error instanceof WavError && error.code === 'NOT_WAV',
  );

  assert.throws(
    () => parseWav(toArrayBuffer(encodeWav({ samples, omitFmt: true }))),
    (error) => error instanceof WavError && error.code === 'CORRUPT',
  );

  assert.throws(
    () => parseWav(toArrayBuffer(encodeWav({ samples, omitData: true }))),
    (error) => error instanceof WavError && error.code === 'CORRUPT',
  );

  assert.throws(
    () => parseWav(toArrayBuffer(encodeWav({ samples, overrideDataSize: 999999 }))),
    (error) => error instanceof WavError && error.code === 'CORRUPT',
  );
});

test('empty WAV and unsupported formats are rejected', () => {
  assert.throws(
    () => parseWav(toArrayBuffer(encodeWav({ samples: new Float32Array(0) }))),
    (error) => error instanceof WavError && error.code === 'EMPTY',
  );

  assert.throws(
    () => parseWav(toArrayBuffer(encodeWav({ samples: sineSamples({ seconds: 0.05 }), formatTag: 2 }))),
    (error) => error instanceof WavError && error.code === 'UNSUPPORTED',
  );

  assert.throws(
    () =>
      parseWav(
        toArrayBuffer(
          encodeWav({ samples: sineSamples({ seconds: 0.05 }), channelCountOverride: 9 }),
        ),
      ),
    (error) => error instanceof WavError && error.code === 'UNSUPPORTED',
  );

  assert.throws(() => parseWav(new ArrayBuffer(10)), (error) => error instanceof WavError);
});
