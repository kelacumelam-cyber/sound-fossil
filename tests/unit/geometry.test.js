import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { analyzeAudio } from '../../src/core/analysis.js';
import { buildSculpture } from '../../src/core/geometry.js';
import { DEFAULT_SETTINGS, normalizeSettings } from '../../src/core/settings.js';
import { fossilName } from '../../src/core/names.js';
import { clickTrackSamples, silenceSamples, sineSamples } from '../helpers/wav-fixture.js';

function analyze(samples = sineSamples({ frequency: 330, seconds: 2, amplitude: 0.4 })) {
  return analyzeAudio(samples, 44100);
}

function crescendoSamples({ seconds = 4, sampleRate = 44100 } = {}) {
  const length = Math.floor(seconds * sampleRate);
  const samples = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const t = i / sampleRate;
    const envelope = Math.min(1, t / 1.2) * Math.min(1, (seconds - t) / 1.2);
    samples[i] = Math.sin(2 * Math.PI * 330 * t) * 0.5 * Math.max(0, envelope);
  }
  return samples;
}

function rampToneSamples(direction, { seconds = 4, sampleRate = 44100 } = {}) {
  const length = Math.floor(seconds * sampleRate);
  const samples = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const t = i / sampleRate;
    const ramp = direction > 0 ? t / seconds : 1 - t / seconds;
    const fade = Math.min(1, t / 0.05, (seconds - t) / 0.05);
    samples[i] = Math.sin(2 * Math.PI * 330 * t) * 0.6 * ramp * Math.max(0, fade);
  }
  return samples;
}

function bodyRadii(data) {
  const { radialSegments: R, rows } = data;
  const radii = [];
  for (let row = 0; row < rows; row += 1) {
    const ring = [];
    let centerX = 0;
    let centerZ = 0;
    for (let segment = 0; segment < R; segment += 1) {
      const offset = ((1 + row) * R + segment) * 3;
      const x = data.positions[offset];
      const z = data.positions[offset + 2];
      centerX += x;
      centerZ += z;
      ring.push({ x, z, radius: Math.hypot(x, z) });
    }
    ring.centerX = centerX / R;
    ring.centerZ = centerZ / R;
    radii.push(ring);
  }
  return radii;
}

/** Measures how lobed/ridged a section is compared with a circle. */
function angularity(data) {
  const { radialSegments: R, rows } = data;
  let total = 0;
  let count = 0;
  for (let row = 10; row < rows - 10; row += 1) {
    const points = [];
    let centerX = 0;
    let centerZ = 0;
    for (let segment = 0; segment < R; segment += 1) {
      const offset = ((1 + row) * R + segment) * 3;
      const x = data.positions[offset];
      const z = data.positions[offset + 2];
      centerX += x;
      centerZ += z;
      points.push({ x, z });
    }
    centerX /= R;
    centerZ /= R;
    const radii = points.map((point) => Math.hypot(point.x - centerX, point.z - centerZ));
    const average = radii.reduce((sum, radius) => sum + radius, 0) / R;
    const variance = radii.reduce((sum, radius) => sum + (radius - average) ** 2, 0) / R;
    total += Math.sqrt(variance) / average;
    count += 1;
  }
  return total / count;
}

test('geometry is deterministic: same audio + same settings = same hash', () => {
  const analysis = analyze();
  const first = buildSculpture(analysis, DEFAULT_SETTINGS);
  const second = buildSculpture(analysis, DEFAULT_SETTINGS);
  assert.equal(first.hash, second.hash);
  assert.deepEqual(Array.from(first.positions.slice(0, 300)), Array.from(second.positions.slice(0, 300)));
  assert.deepEqual(Array.from(first.colors.slice(0, 300)), Array.from(second.colors.slice(0, 300)));
  assert.deepEqual(Array.from(first.indices.slice(0, 300)), Array.from(second.indices.slice(0, 300)));
});

test('a settings change and different audio produce a different fossil', () => {
  const analysis = analyze();
  const base = buildSculpture(analysis, DEFAULT_SETTINGS);
  const ridged = buildSculpture(analysis, { ...DEFAULT_SETTINGS, ridge: 0.95 });
  const taller = buildSculpture(analysis, { ...DEFAULT_SETTINGS, height: 3.4 });
  assert.notEqual(base.hash, ridged.hash);
  assert.notEqual(base.hash, taller.hash);
  assert.notEqual(base.hash, buildSculpture(analyze(clickTrackSamples({ seconds: 2 })), DEFAULT_SETTINGS).hash);
});

test('frequency character changes the lobes and silhouette', () => {
  const dark = buildSculpture(
    analyze(sineSamples({ frequency: 110, seconds: 2, amplitude: 0.4 })),
    DEFAULT_SETTINGS,
  );
  const bright = buildSculpture(
    analyze(sineSamples({ frequency: 5000, seconds: 2, amplitude: 0.4 })),
    DEFAULT_SETTINGS,
  );
  assert.notEqual(dark.hash, bright.hash);
  assert.ok(bright.meta.maxRadius > dark.meta.maxRadius);
  assert.ok(
    angularity(bright) > angularity(dark) * 1.8,
    `brighter timbre should be more ridged: ${angularity(bright)} / ${angularity(dark)}`,
  );
});

test('geometry buffers are valid, bounded, and contain no NaN', () => {
  const analysis = analyze();
  const data = buildSculpture(analysis, DEFAULT_SETTINGS);
  const radialSegments = data.radialSegments;
  const ringTotal = 1 + data.rows + data.meta.topCapRings;
  const expectedVertices = ringTotal * radialSegments + 2;
  assert.equal(data.positions.length, expectedVertices * 3);
  assert.equal(data.colors.length, expectedVertices * 3);
  assert.equal(data.indices.length, (ringTotal - 1) * radialSegments * 6 + radialSegments * 6);
  assert.equal(new Set(data.indices).size <= expectedVertices, true);

  for (let i = 0; i < data.positions.length; i += 1) {
    assert.ok(Number.isFinite(data.positions[i]), `position ${i} is invalid`);
    assert.ok(Math.abs(data.positions[i]) < 3.5, `position ${i} is out of bounds`);
  }
  for (let i = 0; i < data.colors.length; i += 1) {
    assert.ok(Number.isFinite(data.colors[i]), `color ${i} is invalid`);
    assert.ok(data.colors[i] >= 0 && data.colors[i] <= 1, `color ${i} is out of range`);
  }
  for (let i = 0; i < data.indices.length; i += 1) {
    assert.ok(data.indices[i] >= 0 && data.indices[i] < expectedVertices, `index ${i} is out of bounds`);
  }

  const ys = [];
  for (let i = 1; i < data.positions.length; i += 3) ys.push(data.positions[i]);
  assert.ok(Math.min(...ys) >= -0.05);
  assert.ok(Math.max(...ys) <= DEFAULT_SETTINGS.height + 0.06);
});

test('surface normals face outward (triangle winding is correct)', () => {
  const analysis = analyze();
  const data = buildSculpture(analysis, DEFAULT_SETTINGS);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  geometry.computeVertexNormals();
  const normals = geometry.getAttribute('normal');
  const positions = geometry.getAttribute('position');

  let inward = 0;
  let checked = 0;
  for (let row = 5; row < data.rows - 5; row += 7) {
    for (let segment = 0; segment < data.radialSegments; segment += 11) {
      const index = (1 + row) * data.radialSegments + segment;
      const nx = normals.getX(index);
      const nz = normals.getZ(index);
      const px = positions.getX(index);
      const pz = positions.getZ(index);
      const dot = nx * px + nz * pz;
      if (dot < 0) inward += 1;
      checked += 1;
    }
  }
  assert.ok(checked > 50);
  assert.ok(inward / checked < 0.12, `inward-facing normal ratio is too high: ${inward}/${checked}`);
  geometry.dispose();
});

test('body surface is continuous: neighboring sections do not break and the axis does not jump', () => {
  for (const samples of [crescendoSamples(), clickTrackSamples({ seconds: 2 })]) {
    const data = buildSculpture(analyze(samples), DEFAULT_SETTINGS);
    const radii = bodyRadii(data);
    let maxRadialStep = 0;
    let maxCenterShift = 0;
    for (let row = 0; row < radii.length - 1; row += 1) {
      const current = radii[row];
      const next = radii[row + 1];
      maxCenterShift = Math.max(
        maxCenterShift,
        Math.hypot(next.centerX - current.centerX, next.centerZ - current.centerZ),
      );
      for (let segment = 0; segment < data.radialSegments; segment += 1) {
        maxRadialStep = Math.max(
          maxRadialStep,
          Math.abs(current[segment].radius - next[segment].radius),
        );
      }
    }
    assert.ok(
      maxRadialStep / data.meta.maxRadius < 0.08,
      `radial step between sections is too large: ${maxRadialStep.toFixed(3)}`,
    );
    assert.ok(maxCenterShift < 0.03, `body axis is jumping: ${maxCenterShift.toFixed(3)}`);
  }
});

test('mesh is closed and produces an outward-facing volume', () => {
  for (const samples of [
    sineSamples({ frequency: 330, seconds: 2, amplitude: 0.4 }),
    clickTrackSamples({ seconds: 2 }),
    silenceSamples({ seconds: 2 }),
  ]) {
    const data = buildSculpture(analyze(samples), DEFAULT_SETTINGS);
    const edgeCounts = new Map();
    for (let i = 0; i < data.indices.length; i += 3) {
      const triangle = [data.indices[i], data.indices[i + 1], data.indices[i + 2]];
      for (let edge = 0; edge < 3; edge += 1) {
        const a = triangle[edge];
        const b = triangle[(edge + 1) % 3];
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
      }
    }
    const open = [...edgeCounts.values()].filter((count) => count === 1).length;
    const nonManifold = [...edgeCounts.values()].filter((count) => count > 2).length;
    assert.equal(open, 0, `open edge count: ${open}`);
    assert.equal(nonManifold, 0, `non-manifold edge count: ${nonManifold}`);

    let volume = 0;
    for (let i = 0; i < data.indices.length; i += 3) {
      const a = data.indices[i] * 3;
      const b = data.indices[i + 1] * 3;
      const c = data.indices[i + 2] * 3;
      const ax = data.positions[a];
      const ay = data.positions[a + 1];
      const az = data.positions[a + 2];
      const bx = data.positions[b];
      const by = data.positions[b + 1];
      const bz = data.positions[b + 2];
      const cx = data.positions[c];
      const cy = data.positions[c + 1];
      const cz = data.positions[c + 2];
      volume +=
        (ax * (by * cz - bz * cy) -
          ay * (bx * cz - bz * cx) +
          az * (bx * cy - by * cx)) /
        6;
    }
    assert.ok(volume > 0.01, `mesh volume does not face outward: ${volume}`);
  }
});

test('audio amplitude envelope is reflected in the silhouette', () => {
  const profileOf = (data) =>
    bodyRadii(data).map(
      (ring) => ring.reduce((total, point) => total + point.radius, 0) / ring.length,
    );
  const edgeMeans = (profile) => {
    const count = Math.max(1, Math.floor(profile.length * 0.2));
    const average = (values) => values.reduce((total, value) => total + value, 0) / values.length;
    return {
      bottom: average(profile.slice(0, count)),
      top: average(profile.slice(profile.length - count)),
    };
  };

  const rising = buildSculpture(analyze(rampToneSamples(1)), DEFAULT_SETTINGS);
  const falling = buildSculpture(analyze(rampToneSamples(-1)), DEFAULT_SETTINGS);
  assert.notEqual(rising.hash, falling.hash);

  const risingEdges = edgeMeans(profileOf(rising));
  const fallingEdges = edgeMeans(profileOf(falling));
  assert.ok(
    risingEdges.top > risingEdges.bottom * 1.4,
    `rising audio should widen at the top: ${JSON.stringify(risingEdges)}`,
  );
  assert.ok(
    fallingEdges.bottom > fallingEdges.top * 1.4,
    `falling audio should widen at the bottom: ${JSON.stringify(fallingEdges)}`,
  );
});

test('silent audio produces a valid, slender but standing fossil', () => {
  const analysis = analyze(silenceSamples({ seconds: 2.5 }));
  const data = buildSculpture(analysis, DEFAULT_SETTINGS);
  assert.equal(data.meta.isSilent, true);
  assert.ok(data.meta.maxRadius > 0.14, 'a silent fossil must not disappear entirely');
  assert.ok(data.meta.maxRadius < 0.45, 'a silent fossil should stay slender');
  assert.ok(data.meta.minRadius > 0.12, 'a silent fossil must not collapse into the core');
  assert.ok(data.hash.length === 8);
  assert.ok(data.positions.every((value) => Number.isFinite(value)));
  assert.equal(data.ringCount, DEFAULT_SETTINGS.strata);
});

test('extreme settings are normalized and do not break the geometry', () => {
  const analysis = analyze();
  const normalized = normalizeSettings({ strata: 900, ridge: -3, patina: 8, height: 0.2, twist: 99 });
  assert.equal(normalized.strata, 220);
  assert.equal(normalized.ridge, 0);
  assert.equal(normalized.patina, 1);
  assert.equal(normalized.height, 1.8);
  assert.equal(normalized.twist, 1);
  const data = buildSculpture(analysis, normalized);
  assert.equal(data.ringCount, 220);
  assert.ok(data.positions.every((value) => Number.isFinite(value)));

  const invalid = normalizeSettings({ strata: 'abc', ridge: null, height: undefined });
  assert.equal(invalid.strata, DEFAULT_SETTINGS.strata);
  assert.equal(invalid.ridge, DEFAULT_SETTINGS.ridge);
  assert.equal(invalid.height, DEFAULT_SETTINGS.height);
});

test('fossil name is derived deterministically from the audio fingerprint', () => {
  const analysis = analyze();
  const first = fossilName(analysis.fingerprint, analysis.stats);
  const second = fossilName(analysis.fingerprint, analysis.stats);
  assert.deepEqual(first, second);
  assert.match(first.code, /^SF-[0-9A-F]{4}$/);
  assert.ok(first.title.length > 3);
  const different = fossilName('FFFFFFFF', analysis.stats);
  assert.notEqual(first.code, different.code);
});
