/**
 * Dependency-free WAV decoder with strict validation.
 * Supports 8/16/24/32-bit PCM and IEEE float 32/64-bit.
 * Multi-channel files are downmixed to mono, so analysis is independent of channel count.
 */

export class WavError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'WavError';
    this.code = code;
  }
}

const FORMAT_PCM = 1;
const FORMAT_FLOAT = 3;
const FORMAT_EXTENSIBLE = 0xfffe;

function fourCC(view, offset) {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

export function parseWav(arrayBuffer) {
  if (!(arrayBuffer instanceof ArrayBuffer) && !ArrayBuffer.isView(arrayBuffer)) {
    throw new WavError('NOT_WAV', 'The file could not be read.');
  }
  const buffer = arrayBuffer instanceof ArrayBuffer ? arrayBuffer : arrayBuffer.buffer;
  if (buffer.byteLength < 12) {
    throw new WavError('NOT_WAV', 'The file is too short to be a WAV file.');
  }

  const view = new DataView(buffer);
  if (fourCC(view, 0) !== 'RIFF' || fourCC(view, 8) !== 'WAVE') {
    throw new WavError('NOT_WAV', 'This file is not in RIFF/WAVE format.');
  }

  let fmt = null;
  let dataOffset = -1;
  let dataSize = 0;
  let offset = 12;

  while (offset + 8 <= buffer.byteLength) {
    const id = fourCC(view, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (size > buffer.byteLength - body) {
      throw new WavError('CORRUPT', `Corrupt WAV: the "${id}" chunk extends past the end of the file.`);
    }
    if (id === 'fmt ') {
      if (size < 16) throw new WavError('CORRUPT', 'Corrupt WAV: the fmt chunk is incomplete.');
      let formatTag = view.getUint16(body, true);
      if (formatTag === FORMAT_EXTENSIBLE) {
        if (size < 40) throw new WavError('CORRUPT', 'Corrupt WAV: the extended fmt chunk is incomplete.');
        formatTag = view.getUint16(body + 24, true);
      }
      fmt = {
        formatTag,
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        byteRate: view.getUint32(body + 8, true),
        blockAlign: view.getUint16(body + 12, true),
        bitsPerSample: view.getUint16(body + 14, true),
      };
    } else if (id === 'data') {
      dataOffset = body;
      dataSize = size;
      // Some writers get the final chunk size wrong; the first data chunk after fmt is enough.
      if (fmt) break;
    }
    offset = body + size + (size % 2);
  }

  if (!fmt) throw new WavError('CORRUPT', 'Corrupt WAV: the fmt chunk was not found.');
  if (dataOffset < 0) throw new WavError('CORRUPT', 'Corrupt WAV: the audio data chunk was not found.');

  const { formatTag, channels, sampleRate, bitsPerSample } = fmt;
  if (formatTag !== FORMAT_PCM && formatTag !== FORMAT_FLOAT) {
    throw new WavError('UNSUPPORTED', 'Only uncompressed PCM or float WAV is supported.');
  }
  if (!Number.isInteger(channels) || channels < 1 || channels > 8) {
    throw new WavError('UNSUPPORTED', 'Unsupported channel count (must be between 1 and 8).');
  }
  if (!Number.isInteger(sampleRate) || sampleRate < 4000 || sampleRate > 384000) {
    throw new WavError('UNSUPPORTED', 'Unsupported sample rate.');
  }

  const validPcm = [8, 16, 24, 32];
  const validFloat = [32, 64];
  if (formatTag === FORMAT_PCM && !validPcm.includes(bitsPerSample)) {
    throw new WavError('UNSUPPORTED', `${bitsPerSample}-bit PCM is not supported.`);
  }
  if (formatTag === FORMAT_FLOAT && !validFloat.includes(bitsPerSample)) {
    throw new WavError('UNSUPPORTED', `${bitsPerSample}-bit float PCM is not supported.`);
  }

  const bytesPerSample = bitsPerSample / 8;
  const frameBytes = bytesPerSample * channels;
  if (dataSize < frameBytes) {
    throw new WavError('EMPTY', 'The WAV file contains no audio samples.');
  }
  const frameCount = Math.floor(dataSize / frameBytes);
  const samples = new Float32Array(frameCount);
  const scale = formatTag === FORMAT_PCM ? 1 / 2 ** (bitsPerSample - 1) : 1;

  let cursor = dataOffset;
  for (let frame = 0; frame < frameCount; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      let value;
      if (formatTag === FORMAT_FLOAT) {
        value = bitsPerSample === 32 ? view.getFloat32(cursor, true) : view.getFloat64(cursor, true);
        if (!Number.isFinite(value)) value = 0;
      } else if (bitsPerSample === 8) {
        value = (view.getUint8(cursor) - 128) / 128;
      } else if (bitsPerSample === 16) {
        value = view.getInt16(cursor, true) * scale;
      } else if (bitsPerSample === 24) {
        const lo = view.getUint16(cursor, true);
        const hi = view.getInt8(cursor + 2);
        value = ((hi << 16) | lo) * scale;
      } else {
        value = view.getInt32(cursor, true) * scale;
      }
      sum += value;
      cursor += bytesPerSample;
    }
    const mixed = sum / channels;
    samples[frame] = Math.max(-1, Math.min(1, mixed));
  }

  return {
    samples,
    sampleRate,
    channels,
    bitsPerSample,
    format: formatTag === FORMAT_FLOAT ? 'float' : 'pcm',
    frameCount,
    duration: frameCount / sampleRate,
    dataBytes: dataSize,
  };
}
