import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeAudio, AudioAnalysisError, featureSeries } from '../../src/core/analysis.js';
import { clickTrackSamples, silenceSamples, sineSamples } from '../helpers/wav-fixture.js';

function assertNoNaN(array, label) {
  for (let i = 0; i < array.length; i += 1) {
    assert.ok(Number.isFinite(array[i]), `${label}[${i}] NaN/Infinity`);
  }
}

test('440 Hz sine wave is analyzed correctly', () => {
  const samples = sineSamples({ frequency: 440, seconds: 2, amplitude: 0.5 });
  const analysis = analyzeAudio(samples, 44100);
  assert.equal(analysis.isSilent, false);
  assert.equal(analysis.truncated, false);
  assert.ok(Math.abs(analysis.duration - 2) < 1e-6);
  assert.ok(analysis.stats.dominantHz > 425 && analysis.stats.dominantHz < 455, `dominant ${analysis.stats.dominantHz}`);
  assert.ok(analysis.stats.centroidHz > 300 && analysis.stats.centroidHz < 700, `centroid ${analysis.stats.centroidHz}`);
  assert.ok(analysis.stats.rmsDb > -10.5 && analysis.stats.rmsDb < -8.5, `rmsDb ${analysis.stats.rmsDb}`);
  assert.ok(Math.abs(analysis.stats.peak - 0.5) < 0.002);
  assert.ok(analysis.stats.silenceRatio < 0.02);
  assert.ok(analysis.stats.brightness < 0.1);
  assert.equal(analysis.frames.amp.length, analysis.frameCount);
  assert.equal(analysis.frames.silent.length, analysis.frameCount);
  assertNoNaN(analysis.frames.amp, 'amp');
  assertNoNaN(analysis.frames.centroid, 'centroid');
});

test('the same audio always produces the same fingerprint and features', () => {
  const samples = sineSamples({ frequency: 523.25, seconds: 1.4, amplitude: 0.3 });
  const first = analyzeAudio(samples, 44100);
  const second = analyzeAudio(samples, 44100);
  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(first.audioHash, second.audioHash);
  assert.deepEqual(Array.from(first.frames.amp), Array.from(second.frames.amp));
  assert.deepEqual(Array.from(first.frames.onset), Array.from(second.frames.onset));

  const different = analyzeAudio(sineSamples({ frequency: 880, seconds: 1.4, amplitude: 0.3 }), 44100);
  assert.notEqual(first.fingerprint, different.fingerprint);
});

test('tempo is estimated from a 120 BPM click track', () => {
  const samples = clickTrackSamples({ bpm: 120, seconds: 8 });
  const analysis = analyzeAudio(samples, 44100);
  assert.ok(analysis.stats.bpm, 'tempo was not found');
  assert.ok(
    Math.abs(analysis.stats.bpm - 120) <= 3,
    `expected ~120 BPM, got ${analysis.stats.bpm}`,
  );
  assert.ok(analysis.stats.pulseRegularity > 0.2);
  assert.ok(analysis.stats.silenceRatio > 0.4);
});

test('completely silent audio is marked silent without crashing', () => {
  const samples = silenceSamples({ seconds: 2 });
  const analysis = analyzeAudio(samples, 44100);
  assert.equal(analysis.isSilent, true);
  assert.equal(analysis.stats.silenceRatio, 1);
  assert.equal(analysis.stats.bpm, null);
  assert.equal(analysis.stats.peak, 0);
  assert.ok(analysis.frames.amp.every((value) => value === 0));
  assertNoNaN(analysis.frames.amp, 'silent amp');
  assertNoNaN(analysis.frames.centroid, 'silent centroid');
});

test('empty audio data and invalid inputs are rejected', () => {
  assert.throws(() => analyzeAudio(new Float32Array(0), 44100), (error) => {
    return error instanceof AudioAnalysisError && error.code === 'EMPTY_AUDIO';
  });
  assert.throws(() => analyzeAudio(null, 44100), AudioAnalysisError);
  assert.throws(() => analyzeAudio(new Float32Array(100), 0), (error) => {
    return error instanceof AudioAnalysisError && error.code === 'BAD_SAMPLE_RATE';
  });
  const corrupt = new Float32Array([0, Number.NaN, 0]);
  assert.throws(() => analyzeAudio(corrupt, 44100), (error) => {
    return error instanceof AudioAnalysisError && error.code === 'CORRUPT_AUDIO';
  });
});

test('very short audio is analyzed as a single frame', () => {
  const analysis = analyzeAudio(new Float32Array(100), 44100);
  assert.equal(analysis.frameCount, 1);
  assert.ok(Number.isFinite(analysis.stats.centroidHz));
  assert.equal(analysis.isSilent, true);
});

test('audio longer than three minutes is truncated and reported', () => {
  const samples = sineSamples({ frequency: 220, seconds: 181, sampleRate: 8000, amplitude: 0.2 });
  const analysis = analyzeAudio(samples, 8000);
  assert.equal(analysis.truncated, true);
  assert.ok(Math.abs(analysis.originalDuration - 181) < 0.01);
  assert.ok(Math.abs(analysis.analyzedDuration - 180) < 0.01);
  assert.ok(analysis.frames.amp.length > 1000);
});

test('featureSeries deterministically reduces to the requested ring count', () => {
  const analysis = analyzeAudio(clickTrackSamples({ bpm: 100, seconds: 5 }), 44100);
  const first = featureSeries(analysis, 64);
  const second = featureSeries(analysis, 64);
  assert.equal(first.amp.length, 64);
  assert.equal(first.silent.length, 64);
  assert.deepEqual(Array.from(first.amp), Array.from(second.amp));
  assert.ok(first.amp.every((value) => value >= 0 && value <= 1.35));
});
