/**
 * Turns features into a meaningful, continuous 3D fossil.
 *
 * Mapping:
 *  - Height / vertical axis ........... time (bottom to top)
 *  - Radius and body volume ........... RMS amplitude
 *  - Surface lobes and ridges ......... spectral centroid (timbre brightness)
 *  - Outward knots .................... spectral flux (onset / accent)
 *  - Narrow waist / dark bands ........ silence
 *  - Axis bend ........................ timbre balance (bass vs. bright)
 *  - Surface ridge rhythm ............. tempo and pulse regularity
 *  - Color / patina ................... density, timbre, and user patina setting
 *
 * Instead of stacking individual rings, the geometry is built as a dense,
 * continuous surface: analysis bands are subdivided with Catmull-Rom,
 * features are smoothed vertically, and the body axis is gently bent by the
 * timbre balance. This avoids breaks between neighboring sections.
 * All noise is generated from a fixed seed derived from the audio fingerprint.
 */

import { featureSeries } from './analysis.js';
import { createNoise2D, fnv1a, hashGeometryData, mulberry32, toHex } from './prng.js';
import { normalizeSettings } from './settings.js';

const RADIAL_SEGMENTS = 112;
const ROW_SUBDIVISIONS = 4;
const TOP_CAP_RINGS = 5;

const PALETTE = Object.freeze({
  void: [0.052, 0.045, 0.038],
  umber: [0.235, 0.165, 0.12],
  copper: [0.58, 0.34, 0.18],
  amber: [0.88, 0.62, 0.34],
  bone: [0.93, 0.855, 0.7],
  verdigris: [0.3, 0.49, 0.43],
  patinaDark: [0.16, 0.25, 0.225],
});

function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function mean(values) {
  if (!values.length) return 0;
  let total = 0;
  for (let i = 0; i < values.length; i += 1) total += values[i];
  return total / values.length;
}

/** Maps analysis bands to dense body rows with Catmull-Rom interpolation. */
function sampleSeries(values, u) {
  const n = values.length;
  if (n === 0) return 0;
  if (n === 1) return values[0];
  const x = clamp(u, 0, 1) * (n - 1);
  const i = Math.floor(x);
  const f = x - i;
  const p0 = values[Math.max(0, i - 1)];
  const p1 = values[i];
  const p2 = values[Math.min(n - 1, i + 1)];
  const p3 = values[Math.min(n - 1, i + 2)];
  const value =
    0.5 *
    (2 * p1 +
      (-p0 + p2) * f +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f +
      (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f);
  return value;
}

/** Short-range Gaussian smoothing along the vertical axis: avoids harsh jumps between sections. */
function smoothSeries(values, radius, passes = 2) {
  let current = values;
  const sigma = Math.max(0.8, radius / 2.6);
  const weights = [];
  let weightSum = 0;
  for (let offset = -radius; offset <= radius; offset += 1) {
    const weight = Math.exp(-(offset * offset) / (2 * sigma * sigma));
    weights.push(weight);
    weightSum += weight;
  }
  for (let pass = 0; pass < passes; pass += 1) {
    const next = new Float32Array(current.length);
    for (let i = 0; i < current.length; i += 1) {
      let total = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const index = Math.min(current.length - 1, Math.max(0, i + offset));
        total += current[index] * weights[offset + radius];
      }
      next[i] = total / weightSum;
    }
    current = next;
  }
  return current;
}

function buildFeatureRows(series, rows) {
  const sample = (name) => {
    const raw = new Float32Array(rows);
    for (let i = 0; i < rows; i += 1) {
      raw[i] = sampleSeries(series[name], rows === 1 ? 0 : i / (rows - 1));
    }
    return raw;
  };

  const amp = sample('amp');
  const centroid = sample('centroid');
  const onset = sample('onset');
  const silent = sample('silent');
  const low = sample('lowRatio');
  const spread = sample('spread');

  // Very short smoothing on dense rows: preserves accents in the audio
  // while preventing clumping or gaps between neighboring sections.
  const smoothAmp = smoothSeries(amp, 10, 2);
  const smoothCentroid = smoothSeries(centroid, 8, 2);
  const smoothOnset = smoothSeries(onset, 10, 2);
  const smoothSilent = smoothSeries(silent, 8, 2);
  const smoothLow = smoothSeries(low, 8, 2);
  const smoothSpread = smoothSeries(spread, 8, 2);

  const centroidMin = Math.min(...smoothCentroid);
  const centroidMax = Math.max(...smoothCentroid);
  const centroidSpan = centroidMax - centroidMin;
  const spreadMin = Math.min(...smoothSpread);
  const spreadMax = Math.max(...smoothSpread);
  const spreadSpan = spreadMax - spreadMin;

  return {
    amp: smoothAmp,
    centroid: smoothCentroid,
    onset: smoothOnset,
    silent: smoothSilent,
    low: smoothLow,
    spread: smoothSpread,
    // Timbre brightness is measured relative to the piece: lobes stay stable
    // for constant timbre, while changing timbre changes the character of the ridges.
    centroidRel: Float32Array.from(smoothCentroid, (value) =>
      centroidSpan > 1e-5 ? clamp01((value - centroidMin) / centroidSpan) : 0.5,
    ),
    spreadRel: Float32Array.from(smoothSpread, (value) =>
      spreadSpan > 1e-5 ? clamp01((value - spreadMin) / spreadSpan) : 0.5,
    ),
    lowMean: mean(smoothLow),
    centroidMean: mean(smoothCentroid),
  };
}

export function buildSculpture(analysis, rawSettings = {}) {
  if (!analysis || !analysis.frames) {
    throw new Error('No analysis data was provided for the sculpture.');
  }
  const settings = normalizeSettings(rawSettings);
  const bandCount = settings.strata;
  const series = featureSeries(analysis, bandCount);
  const stats = analysis.stats;
  const silentPiece = analysis.isSilent;

  const bodyRows = (bandCount - 1) * ROW_SUBDIVISIONS + 1;
  const features = buildFeatureRows(series, bodyRows);

  const seedBase = fnv1a(
    `${analysis.fingerprint}|${settings.strata}|${settings.ridge.toFixed(4)}|${settings.patina.toFixed(4)}|${settings.height.toFixed(4)}|${settings.twist.toFixed(4)}`,
  );
  const random = mulberry32(seedBase);
  const noise = createNoise2D(seedBase ^ 0x9e3779b9);
  const phase = random() * Math.PI * 2;
  const secondaryPhase = random() * Math.PI * 2;

  const bpm = stats.bpm ?? 0;
  const duration = Math.max(0.2, analysis.analyzedDuration);
  const totalBeats = bpm > 0 ? (bpm / 60) * duration : 0;
  const pulse = clamp01(stats.pulseRegularity);
  const brightnessBase = clamp01((stats.brightness ?? 0) * 4);
  const height = settings.height;

  const bodyBottom = 0.022;
  const lastAmp = Math.pow(clamp01(features.amp[bodyRows - 1] / 1.08), 0.62);
  const lastSilence = clamp01(features.silent[bodyRows - 1]);
  const lastBase = Math.max(0.16, (0.27 + 0.77 * lastAmp) * (1 - 0.28 * lastSilence));
  const domeHeight = clamp(0.06 * height + 0.42 * lastBase, 0.16, 0.42);
  const bodyTop = height - domeHeight;

  const ringTotal = 1 + bodyRows + TOP_CAP_RINGS;
  const vertexCount = ringTotal * RADIAL_SEGMENTS + 2;
  const topPoleIndex = ringTotal * RADIAL_SEGMENTS;
  const bottomCenterIndex = topPoleIndex + 1;

  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(
    (ringTotal - 1) * RADIAL_SEGMENTS * 6 + RADIAL_SEGMENTS * 6,
  );

  let maxRadius = 0;
  let minRadius = Number.POSITIVE_INFINITY;
  let silentRows = 0;
  let finalTwist = 0;
  let firstAxis = { x: 0, z: 0 };
  let lastAxis = { x: 0, z: 0 };

  // Body rows: ring 0 is the lower bevel, 1..bodyRows is the body.
  for (let row = 0; row < bodyRows; row += 1) {
    const t = bodyRows === 1 ? 0 : row / (bodyRows - 1);
    const y = bodyBottom + t * (bodyTop - bodyBottom);
    const amplitude = silentPiece ? 0 : clamp(features.amp[row], 0, 1.35);
    const silence = silentPiece ? 1 : clamp01(features.silent[row]);
    const centroidRel = silentPiece ? 0.5 : clamp01(features.centroidRel[row]);
    const spreadRel = silentPiece ? 0.5 : clamp01(features.spreadRel[row]);
    const low = silentPiece ? 0 : clamp01(features.low[row]);
    const onset = silentPiece ? 0 : clamp(features.onset[row], 0, 2);

    if (silence > 0.6) silentRows += 1;

    // Audio intensity determines the body volume; silence narrows it but
    // never erases it. The base radius keeps the sculpture standing on its own.
    const ampShape = Math.pow(clamp01(amplitude / 1.08), 0.62);
    let baseRadius = 0.27 + 0.72 * ampShape;
    baseRadius *= 1 - 0.28 * silence;
    baseRadius *= 1 + (low - 0.45) * 0.1;
    baseRadius = Math.max(0.16, baseRadius);

    const bendX = clamp(0.14 * (centroidRel - 0.5), -0.11, 0.11);
    const bendZ = clamp(0.18 * (low - features.lowMean), -0.11, 0.11);
    const axisX = bendX;
    const axisZ = bendZ;
    if (row === 0) firstAxis = { x: axisX, z: axisZ };
    lastAxis = { x: axisX, z: axisZ };

    const twistAngle =
      t * settings.twist * Math.PI * 1.9 + 0.22 * noise(t * 2.3, 12.1) + phase * 0.15;
    finalTwist = twistAngle;

    const phi2 = phase + 0.8 * noise(t * 1.1, 3.7);
    const phi3 = phase * 1.7 + 0.7 * noise(t * 0.9, 8.2);
    const phi5 = secondaryPhase + 0.5 * noise(t * 1.4, 5.1);
    const lobe2 = 0.09 + 0.06 * (1 - low);
    const lobe3 = 0.035 + 0.055 * brightnessBase + 0.04 * centroidRel;
    const lobe5 = 0.012 + 0.05 * brightnessBase + 0.03 * centroidRel;
    const axisAngle =
      phase * 0.6 + 0.85 * noise(t * 0.7, 21.4) + t * settings.twist * Math.PI * 0.9;
    const anisotropy =
      0.03 + 0.06 * spreadRel + 0.05 * brightnessBase + 0.02 * (1 - low);

    const rhythm = totalBeats > 0 ? 0.5 - 0.5 * Math.cos(2 * Math.PI * t * totalBeats) : 0;
    const pulseGain = 1 + pulse * (rhythm - 0.5) * 0.34;
    const onsetLift = clamp01(onset / 1.15);

    for (let segment = 0; segment < RADIAL_SEGMENTS; segment += 1) {
      const angle = (segment / RADIAL_SEGMENTS) * Math.PI * 2;
      const theta = angle + twistAngle;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);

      const angular =
        lobe2 * Math.cos(2 * theta + phi2) +
        lobe3 * Math.cos(3 * theta + phi3) +
        lobe5 * Math.cos(5 * theta + phi5);

      const grain = noise(cos * 1.45 + 4.7, sin * 1.45 + t * 4.2 + 1.3);
      const fine = noise(cos * 5.8 - 2.1, sin * 5.8 + t * 9.5 + 6.4);

      let radius = baseRadius;
      radius *= 1 + settings.ridge * angular * pulseGain;
      radius *= 1 + anisotropy * Math.cos(2 * (theta - axisAngle));
      radius *= 1 + 0.11 * onsetLift;
      radius *= 1 + (grain - 0.5) * 0.05 + (fine - 0.5) * 0.014;
      radius *= 1 + pulse * (rhythm - 0.5) * 0.014;
      radius = Math.max(0.14, radius);

      const x = axisX + cos * radius;
      const z = axisZ + sin * radius;
      const radialDistance = Math.hypot(x, z);
      maxRadius = Math.max(maxRadius, radialDistance);
      minRadius = Math.min(minRadius, radius);

      const index = (1 + row) * RADIAL_SEGMENTS + segment;
      const offset = index * 3;
      positions[offset] = x;
      positions[offset + 1] = y;
      positions[offset + 2] = z;

      // Color: amplitude -> copper/amber; ridge -> bone; patina -> green oxide.
      let color = mix(PALETTE.umber, PALETTE.copper, Math.pow(clamp01(amplitude), 0.8));
      color = mix(color, PALETTE.amber, clamp01(amplitude) ** 2.2 * 0.72);
      color = mix(
        color,
        PALETTE.bone,
        clamp01((angular + 0.08) * 2.2) * settings.ridge * 0.2,
      );

      const patinaField = clamp01(
        settings.patina * (0.38 + 0.62 * grain) * (0.72 + 0.5 * (1 - centroidRel)) +
          (1 - clamp01(amplitude)) * 0.13,
      );
      color = mix(color, PALETTE.verdigris, patinaField * 0.5);
      color = mix(color, PALETTE.patinaDark, clamp01((silence - 0.35) * 1.4) * 0.84);
      color = mix(color, PALETTE.void, clamp01(silence - 0.76) * 0.32);

      const heightLight = 0.92 + t * 0.14;
      const grainShade = 0.93 + fine * 0.14;
      colors[offset] = clamp01(color[0] * heightLight * grainShade);
      colors[offset + 1] = clamp01(color[1] * heightLight * grainShade);
      colors[offset + 2] = clamp01(color[2] * heightLight * grainShade);
    }
  }

  // Lower bevel: a soft chamfer that seats the body on the plinth.
  {
    const rowOffset = 1 * RADIAL_SEGMENTS;
    const bevelIndex = 0;
    for (let segment = 0; segment < RADIAL_SEGMENTS; segment += 1) {
      const source = (rowOffset + segment) * 3;
      const target = (bevelIndex * RADIAL_SEGMENTS + segment) * 3;
      positions[target] = firstAxis.x + (positions[source] - firstAxis.x) * 0.7;
      positions[target + 1] = 0;
      positions[target + 2] = firstAxis.z + (positions[source + 2] - firstAxis.z) * 0.7;
      colors[target] = clamp01(colors[source] * 0.82);
      colors[target + 1] = clamp01(colors[source + 1] * 0.78);
      colors[target + 2] = clamp01(colors[source + 2] * 0.75);
    }
  }

  // Upper dome: an organic top that closes gently from the last body section.
  {
    const lastRowOffset = (1 + bodyRows - 1) * RADIAL_SEGMENTS;
    for (let cap = 1; cap <= TOP_CAP_RINGS; cap += 1) {
      const phi = (cap / (TOP_CAP_RINGS + 1)) * (Math.PI / 2);
      const scale = Math.cos(phi);
      const y = bodyTop + domeHeight * Math.sin(phi);
      const ring = 1 + bodyRows + (cap - 1);
      for (let segment = 0; segment < RADIAL_SEGMENTS; segment += 1) {
        const source = (lastRowOffset + segment) * 3;
        const target = (ring * RADIAL_SEGMENTS + segment) * 3;
        positions[target] = lastAxis.x + (positions[source] - lastAxis.x) * scale;
        positions[target + 1] = y;
        positions[target + 2] = lastAxis.z + (positions[source + 2] - lastAxis.z) * scale;

        const capLight = 1.03 + 0.05 * scale;
        colors[target] = clamp01(colors[source] * capLight + 0.045);
        colors[target + 1] = clamp01(colors[source + 1] * capLight + 0.035);
        colors[target + 2] = clamp01(colors[source + 2] * capLight + 0.02);
      }
    }
  }

  // Poles.
  const topPoleOffset = topPoleIndex * 3;
  positions[topPoleOffset] = lastAxis.x;
  positions[topPoleOffset + 1] = height;
  positions[topPoleOffset + 2] = lastAxis.z;
  colors[topPoleOffset] = 0.84;
  colors[topPoleOffset + 1] = 0.73;
  colors[topPoleOffset + 2] = 0.56;

  const bottomCenterOffset = bottomCenterIndex * 3;
  positions[bottomCenterOffset] = firstAxis.x;
  positions[bottomCenterOffset + 1] = 0;
  positions[bottomCenterOffset + 2] = firstAxis.z;
  colors[bottomCenterOffset] = 0.13;
  colors[bottomCenterOffset + 1] = 0.1;
  colors[bottomCenterOffset + 2] = 0.08;

  let indexCursor = 0;
  for (let ring = 0; ring < ringTotal - 1; ring += 1) {
    for (let segment = 0; segment < RADIAL_SEGMENTS; segment += 1) {
      const next = (segment + 1) % RADIAL_SEGMENTS;
      const a = ring * RADIAL_SEGMENTS + segment;
      const b = ring * RADIAL_SEGMENTS + next;
      const c = (ring + 1) * RADIAL_SEGMENTS + segment;
      const d = (ring + 1) * RADIAL_SEGMENTS + next;
      indices[indexCursor] = a;
      indices[indexCursor + 1] = c;
      indices[indexCursor + 2] = b;
      indices[indexCursor + 3] = b;
      indices[indexCursor + 4] = c;
      indices[indexCursor + 5] = d;
      indexCursor += 6;
    }
  }

  // Top cap: an outward-facing (upward) fan.
  const lastRing = (ringTotal - 1) * RADIAL_SEGMENTS;
  for (let segment = 0; segment < RADIAL_SEGMENTS; segment += 1) {
    const next = (segment + 1) % RADIAL_SEGMENTS;
    indices[indexCursor] = topPoleIndex;
    indices[indexCursor + 1] = lastRing + next;
    indices[indexCursor + 2] = lastRing + segment;
    indexCursor += 3;
  }

  // Bottom cap: a downward-facing fan (the base that rests on the plinth).
  for (let segment = 0; segment < RADIAL_SEGMENTS; segment += 1) {
    const next = (segment + 1) % RADIAL_SEGMENTS;
    indices[indexCursor] = bottomCenterIndex;
    indices[indexCursor + 1] = segment;
    indices[indexCursor + 2] = next;
    indexCursor += 3;
  }

  const geometryHash = hashGeometryData(positions, colors, indices, seedBase);

  return {
    positions,
    colors,
    indices,
    ringCount: bandCount,
    rows: bodyRows,
    radialSegments: RADIAL_SEGMENTS,
    settings,
    seed: seedBase,
    hash: toHex(geometryHash, 8),
    meta: {
      height,
      maxRadius,
      minRadius,
      rows: bodyRows,
      topCapRings: TOP_CAP_RINGS,
      domeHeight,
      silentRows,
      silentRatio: silentRows / bodyRows,
      isSilent: silentPiece,
      beatRings: totalBeats,
      phase,
      secondaryPhase,
      ringTwist: finalTwist,
      fingerprint: analysis.fingerprint,
    },
  };
}
