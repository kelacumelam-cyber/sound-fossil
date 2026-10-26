/**
 * Audio analysis: per-frame RMS, spectral centroid, spectral flux (onset),
 * zero-crossing rate, low-frequency ratio, and tempo estimation.
 *
 * Analysis is entirely local and independent of settings: the same PCM data
 * always produces the same feature series. Visual settings only come into
 * play during the geometry stage.
 */

import { fnv1a, hashFloat32, toHex } from './prng.js';

export const ANALYSIS = Object.freeze({
  frameSize: 2048,
  hop: 1024,
  maxSeconds: 180,
  maxFileSeconds: 180,
  schemaVersion: 1,
});

export class AudioAnalysisError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AudioAnalysisError';
    this.code = code;
  }
}

class FFT {
  constructor(size) {
    this.size = size;
    this.re = new Float64Array(size);
    this.im = new Float64Array(size);
    this.cos = new Float64Array(size / 2);
    this.sin = new Float64Array(size / 2);
    for (let i = 0; i < size / 2; i += 1) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / size);
      this.sin[i] = Math.sin((2 * Math.PI * i) / size);
    }
    this.rev = new Uint32Array(size);
    const bits = Math.log2(size) | 0;
    for (let i = 0; i < size; i += 1) {
      let value = i;
      let reversed = 0;
      for (let b = 0; b < bits; b += 1) {
        reversed = (reversed << 1) | (value & 1);
        value >>>= 1;
      }
      this.rev[i] = reversed;
    }
  }

  forward(input, offset, window) {
    const { size, re, im, rev, cos, sin } = this;
    for (let i = 0; i < size; i += 1) {
      re[i] = input[offset + i] * window[i];
      im[i] = 0;
    }
    for (let i = 0; i < size; i += 1) {
      const j = rev[i];
      if (j > i) {
        const tr = re[i];
        re[i] = re[j];
        re[j] = tr;
        const ti = im[i];
        im[i] = im[j];
        im[j] = ti;
      }
    }
    for (let len = 2; len <= size; len <<= 1) {
      const half = len >> 1;
      const step = size / len;
      for (let start = 0; start < size; start += len) {
        for (let k = 0; k < half; k += 1) {
          const tableIndex = k * step;
          const wr = cos[tableIndex];
          const wi = -sin[tableIndex];
          const a = start + k;
          const b = a + half;
          const tr = re[b] * wr - im[b] * wi;
          const ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
  }
}

function hann(size) {
  const window = new Float64Array(size);
  for (let i = 0; i < size; i += 1) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
  }
  return window;
}

export function percentile(values, ratio) {
  if (!values || values.length === 0) return 0;
  const sorted = Float32Array.from(values).sort();
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * ratio)));
  return sorted[index];
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function mean(values) {
  if (!values.length) return 0;
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) sum += values[i];
  return sum / values.length;
}

function estimateTempo(flux, fps) {
  const n = flux.length;
  if (n < 12) return { bpm: null, regularity: 0 };

  let avg = 0;
  for (let i = 0; i < n; i += 1) avg += flux[i];
  avg /= n;
  const env = new Float32Array(n);
  let energy = 0;
  for (let i = 0; i < n; i += 1) {
    env[i] = flux[i] - avg;
    energy += env[i] * env[i];
  }
  if (energy < 1e-9) return { bpm: null, regularity: 0 };

  const minLag = Math.max(2, Math.round((60 / 200) * fps));
  const maxLag = Math.min(n - 2, Math.round((60 / 55) * fps));
  if (maxLag <= minLag) return { bpm: null, regularity: 0 };

  let bestLag = 0;
  let bestCorr = -1;
  const correlations = new Float32Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let dot = 0;
    let e1 = 0;
    let e2 = 0;
    for (let i = 0; i + lag < n; i += 1) {
      const a = env[i];
      const b = env[i + lag];
      dot += a * b;
      e1 += a * a;
      e2 += b * b;
    }
    const corr = e1 > 0 && e2 > 0 ? dot / Math.sqrt(e1 * e2) : 0;
    correlations[lag] = corr;
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  let bpm = bestLag > 0 ? (60 * fps) / bestLag : null;
  let corr = bestCorr;

  if (bpm && bpm < 82) {
    const doubleLag = Math.round(bestLag / 2);
    if (doubleLag >= minLag && correlations[doubleLag] > corr * 0.62) {
      bpm *= 2;
      bestLag = doubleLag;
      corr = correlations[doubleLag];
    }
  }
  if (bpm && bpm > 190) {
    const halfLag = Math.round(bestLag * 2);
    if (halfLag <= maxLag) {
      bpm /= 2;
      bestLag = halfLag;
      corr = correlations[halfLag];
    }
  }
  if (bpm && (bpm < 50 || bpm > 200)) bpm = null;

  const regularity = bpm ? clamp(corr, 0, 1) : 0;
  if (!bpm || regularity < 0.16) return { bpm: null, regularity: 0 };
  return { bpm: Math.round(bpm * 10) / 10, regularity };
}

/**
 * @param {Float32Array|number[]} inputMonoSamples
 * @param {number} sampleRate
 * @param {{maxSeconds?: number}} [options]
 */
export function analyzeAudio(inputMonoSamples, sampleRate, options = {}) {
  if (!inputMonoSamples || typeof inputMonoSamples.length !== 'number') {
    throw new AudioAnalysisError('EMPTY_AUDIO', 'No audio data to analyze.');
  }
  if (!Number.isFinite(sampleRate) || sampleRate < 4000) {
    throw new AudioAnalysisError('BAD_SAMPLE_RATE', 'Invalid sample rate.');
  }
  if (inputMonoSamples.length === 0) {
    throw new AudioAnalysisError('EMPTY_AUDIO', 'The file contains no audio samples to analyze.');
  }

  const maxSeconds = clamp(options.maxSeconds ?? ANALYSIS.maxSeconds, 1, 600);
  const maxSamples = Math.floor(maxSeconds * sampleRate);
  const truncated = inputMonoSamples.length > maxSamples;
  const source = truncated ? inputMonoSamples.subarray(0, maxSamples) : inputMonoSamples;
  const sampleCount = source.length;

  for (let i = 0; i < sampleCount; i += 1) {
    if (!Number.isFinite(source[i])) {
      throw new AudioAnalysisError('CORRUPT_AUDIO', 'The audio data contains invalid samples.');
    }
  }

  const { frameSize, hop } = ANALYSIS;
  const window = hann(frameSize);
  const fft = new FFT(frameSize);
  const spectrum = new Float32Array(frameSize / 2);
  const previous = new Float32Array(frameSize / 2);
  const frameCount = sampleCount < frameSize ? 1 : Math.floor((sampleCount - frameSize) / hop) + 1;
  const padded = new Float32Array(frameSize);

  const rms = new Float32Array(frameCount);
  const amp = new Float32Array(frameCount);
  const centroid = new Float32Array(frameCount);
  const flux = new Float32Array(frameCount);
  const zcr = new Float32Array(frameCount);
  const lowRatio = new Float32Array(frameCount);
  const spread = new Float32Array(frameCount);
  const silent = new Uint8Array(frameCount);
  const dominantSpectrum = new Float64Array(frameSize / 2);

  const nyquist = sampleRate / 2;
  const binHz = sampleRate / frameSize;
  let peak = 0;
  let sumSquares = 0;
  let zcrFrames = 0;

  for (let frame = 0; frame < frameCount; frame += 1) {
    const start = frame * hop;
    const available = Math.min(frameSize, Math.max(0, sampleCount - start));
    if (available < frameSize) {
      padded.fill(0);
      for (let i = 0; i < available; i += 1) padded[i] = source[start + i];
    }
    const buffer = available < frameSize ? padded : source;
    const offset = available < frameSize ? 0 : start;

    let squares = 0;
    let crossings = 0;
    let previousSample = buffer[offset];
    for (let i = 0; i < frameSize; i += 1) {
      const value = buffer[offset + i];
      squares += value * value;
      if (i > 0 && ((value >= 0 && previousSample < 0) || (value < 0 && previousSample >= 0))) {
        crossings += 1;
      }
      previousSample = value;
      const absolute = Math.abs(value);
      if (absolute > peak) peak = absolute;
    }
    sumSquares += squares;

    const frameRms = Math.sqrt(squares / frameSize);
    rms[frame] = frameRms;
    zcr[frame] = crossings / frameSize;

    fft.forward(buffer, offset, window);
    const half = frameSize / 2;
    let magnitudeSum = 0;
    let weighted = 0;
    let spreadAcc = 0;
    let lowAcc = 0;
    let fluxAcc = 0;
    for (let k = 1; k < half; k += 1) {
      const re = fft.re[k];
      const im = fft.im[k];
      const magnitude = Math.sqrt(re * re + im * im);
      spectrum[k] = magnitude;
      const hz = k * binHz;
      magnitudeSum += magnitude;
      weighted += magnitude * hz;
      lowAcc += hz <= 420 ? magnitude : 0;
      dominantSpectrum[k] += magnitude * magnitude;
      if (frame > 0) {
        const delta = magnitude - previous[k];
        if (delta > 0) fluxAcc += delta;
      }
    }
    const centroidHz = magnitudeSum > 1e-9 ? weighted / magnitudeSum : 0;
    centroid[frame] = centroidHz;
    if (magnitudeSum > 1e-9) {
      let variance = 0;
      for (let k = 1; k < half; k += 1) {
        const hz = k * binHz;
        const d = hz - centroidHz;
        variance += spectrum[k] * d * d;
      }
      spread[frame] = Math.sqrt(variance / magnitudeSum) / nyquist;
    }
    flux[frame] = magnitudeSum > 1e-9 ? fluxAcc / magnitudeSum : 0;
    lowRatio[frame] = magnitudeSum > 1e-9 ? lowAcc / magnitudeSum : 0;
    if (crossings > 0) zcrFrames += 1;
    previous.set(spectrum);
  }

  const rmsP95 = percentile(rms, 0.95);
  const rmsP10 = percentile(rms, 0.1);
  const rmsMedian = percentile(rms, 0.5);
  const rmsMean = mean(rms);
  const overallRms = Math.sqrt(sumSquares / (frameCount * frameSize));
  const overallPeak = peak;
  const isSilent = rmsP95 < 0.0022 || overallPeak < 0.0025;
  const normalization = Math.max(rmsP95, 1e-7);
  const silenceFloor = Math.max(0.0012, rmsP95 * 0.025);
  let silentFrames = 0;

  for (let frame = 0; frame < frameCount; frame += 1) {
    amp[frame] = isSilent ? 0 : clamp(rms[frame] / normalization, 0, 1.35);
    if (isSilent || rms[frame] < silenceFloor) {
      silent[frame] = 1;
      silentFrames += 1;
    }
  }

  const fluxP95 = Math.max(percentile(flux, 0.95), 1e-7);
  const onset = new Float32Array(frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    onset[frame] = clamp(flux[frame] / fluxP95, 0, 2);
  }

  const fps = sampleRate / hop;
  const tempo = estimateTempo(onset, fps);

  let dominantBin = 1;
  for (let k = 2; k < frameSize / 2 - 1; k += 1) {
    if (dominantSpectrum[k] > dominantSpectrum[dominantBin]) dominantBin = k;
  }
  const left = dominantSpectrum[dominantBin - 1] || 0;
  const center = dominantSpectrum[dominantBin] || 0;
  const right = dominantSpectrum[dominantBin + 1] || 0;
  const delta = left + right > 0 ? (0.5 * (left - right)) / (left + 2 * center + right) : 0;
  const dominantHz = Math.max(20, (dominantBin + clamp(delta, -0.5, 0.5)) * binHz);

  const centroidHz = mean(centroid);
  const brightness = clamp(centroidHz / nyquist, 0, 1);
  const spectralSpread = mean(spread);
  const silenceRatio = silentFrames / frameCount;
  const rmsDb = 20 * Math.log10(Math.max(overallRms, 1e-6));
  const peakDb = 20 * Math.log10(Math.max(overallPeak, 1e-6));
  const dynamicRangeDb = clamp(
    20 * Math.log10(Math.max(rmsP95, 1e-6) / Math.max(rmsP10, 1e-6)),
    0,
    90,
  );
  const zcrRatio = zcrFrames / frameCount;
  const lowEnergyRatio = mean(lowRatio);

  const duration = sampleCount / sampleRate;
  const step = Math.max(1, Math.floor(sampleCount / 180000));
  const audioHash = hashFloat32(source, step);
  const fingerprintBase = [
    audioHash,
    sampleRate,
    Math.round(duration * 1000),
    Math.round(centroidHz),
    Math.round((tempo.bpm || 0) * 10),
    Math.round(silenceRatio * 1000),
    Math.round(rmsP95 * 100000),
    Math.round(brightness * 1000),
  ].join(':');
  const fingerprint = toHex(fnv1a(fingerprintBase), 8);

  return {
    schemaVersion: ANALYSIS.schemaVersion,
    sampleRate,
    samplesPerFrame: frameSize,
    hop,
    frameCount,
    fps,
    duration,
    originalDuration: inputMonoSamples.length / sampleRate,
    analyzedDuration: duration,
    truncated,
    isSilent,
    audioHash: toHex(audioHash, 8),
    fingerprint,
    frames: {
      rms,
      amp,
      centroid,
      centroidNorm: Float32Array.from(centroid, (value) => clamp(value / nyquist, 0, 1)),
      flux,
      onset,
      zcr,
      lowRatio,
      spread,
      silent,
    },
    stats: {
      peak,
      peakDb,
      rms: overallRms,
      rmsDb,
      rmsP95,
      rmsMedian,
      rmsP10,
      dynamicRangeDb,
      silenceRatio,
      dominantHz,
      centroidHz,
      brightness,
      spectralSpread,
      zcrRatio,
      lowEnergyRatio,
      bpm: tempo.bpm,
      pulseRegularity: tempo.regularity,
      loudnessScore: clamp(rmsP95 / 0.28, 0, 1),
    },
  };
}

export function featureSeries(analysis, count) {
  const { frames } = analysis;
  const total = frames.amp.length;
  const n = Math.max(2, Math.floor(count));
  const output = {
    amp: new Float32Array(n),
    centroid: new Float32Array(n),
    flux: new Float32Array(n),
    onset: new Float32Array(n),
    silent: new Float32Array(n),
    lowRatio: new Float32Array(n),
    spread: new Float32Array(n),
  };
  for (let i = 0; i < n; i += 1) {
    const start = Math.floor((i * total) / n);
    const end = Math.max(start + 1, Math.floor(((i + 1) * total) / n));
    let amp = 0;
    let centroid = 0;
    let flux = 0;
    let onset = 0;
    let silent = 0;
    let low = 0;
    let spread = 0;
    const weight = end - start;
    for (let j = start; j < end; j += 1) {
      amp += frames.amp[j];
      centroid += frames.centroidNorm[j];
      flux += frames.flux[j];
      onset += frames.onset[j];
      silent += frames.silent[j];
      low += frames.lowRatio[j];
      spread += frames.spread[j];
    }
    output.amp[i] = amp / weight;
    output.centroid[i] = centroid / weight;
    output.flux[i] = flux / weight;
    output.onset[i] = onset / weight;
    output.silent[i] = silent / weight;
    output.lowRatio[i] = low / weight;
    output.spread[i] = spread / weight;
  }
  return output;
}
