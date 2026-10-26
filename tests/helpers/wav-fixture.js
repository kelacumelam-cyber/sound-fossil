export function encodeWav({
  samples,
  sampleRate = 44100,
  bitsPerSample = 16,
  channels = 1,
  format = 'pcm',
  extensible = false,
  omitFmt = false,
  omitData = false,
  dataBeforeFmt = false,
  overrideDataSize,
  overrideRiff = 'RIFF',
  overrideWave = 'WAVE',
  formatTag,
  channelCountOverride,
}) {
  const bytesPerSample = bitsPerSample / 8;
  const frameCount = Math.floor(samples.length / channels);
  const dataSize = frameCount * channels * bytesPerSample;
  const data = Buffer.alloc(dataSize);

  let cursor = 0;
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const value = samples[frame * channels + channel];
      if (format === 'float') {
        if (bitsPerSample === 32) data.writeFloatLE(value, cursor);
        else data.writeDoubleLE(value, cursor);
      } else if (bitsPerSample === 8) {
        data.writeUInt8(Math.max(0, Math.min(255, Math.round(value * 127 + 128))), cursor);
      } else if (bitsPerSample === 16) {
        data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(value * 32767))), cursor);
      } else if (bitsPerSample === 24) {
        const int = Math.max(-8388608, Math.min(8388607, Math.round(value * 8388607)));
        data.writeUInt8(int & 0xff, cursor);
        data.writeUInt8((int >> 8) & 0xff, cursor + 1);
        data.writeUInt8((int >> 16) & 0xff, cursor + 2);
      } else if (bitsPerSample === 32) {
        data.writeInt32LE(Math.max(-2147483648, Math.min(2147483647, Math.round(value * 2147483647))), cursor);
      }
      cursor += bytesPerSample;
    }
  }

  const actualFormatTag = formatTag ?? (format === 'float' ? 3 : 1);
  const containerTag = extensible ? 0xfffe : actualFormatTag;
  let fmt;
  if (extensible) {
    fmt = Buffer.alloc(40);
    fmt.writeUInt16LE(containerTag, 0);
    fmt.writeUInt16LE(channelCountOverride ?? channels, 2);
    fmt.writeUInt32LE(sampleRate, 4);
    fmt.writeUInt32LE(sampleRate * channels * bytesPerSample, 8);
    fmt.writeUInt16LE(channels * bytesPerSample, 12);
    fmt.writeUInt16LE(bitsPerSample, 14);
    fmt.writeUInt16LE(22, 16);
    fmt.writeUInt16LE(bitsPerSample, 18);
    fmt.writeUInt32LE(0, 20);
    fmt.writeUInt16LE(actualFormatTag, 24);
    for (let i = 26; i < 40; i += 1) fmt[i] = 0;
  } else {
    fmt = Buffer.alloc(16);
    fmt.writeUInt16LE(containerTag, 0);
    fmt.writeUInt16LE(channelCountOverride ?? channels, 2);
    fmt.writeUInt32LE(sampleRate, 4);
    fmt.writeUInt32LE(sampleRate * channels * bytesPerSample, 8);
    fmt.writeUInt16LE(channels * bytesPerSample, 12);
    fmt.writeUInt16LE(bitsPerSample, 14);
  }

  const dataHeader = Buffer.alloc(8);
  dataHeader.write('data', 0, 'ascii');
  dataHeader.writeUInt32LE(overrideDataSize ?? dataSize, 4);
  const fmtHeader = Buffer.alloc(8);
  fmtHeader.write('fmt ', 0, 'ascii');
  fmtHeader.writeUInt32LE(fmt.length, 4);

  const chunks = [];
  if (!omitFmt && !omitData && dataBeforeFmt) {
    chunks.push(dataHeader, data);
    chunks.push(fmtHeader, fmt);
  } else {
    if (!omitFmt) chunks.push(fmtHeader, fmt);
    if (!omitData) chunks.push(dataHeader, data);
  }

  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write(overrideRiff, 0, 'ascii');
  header.writeUInt32LE(body.length + 4, 4);
  header.write(overrideWave, 8, 'ascii');
  return Buffer.concat([header, body]);
}

export function sineSamples({ frequency = 440, seconds = 2, sampleRate = 44100, amplitude = 0.5, channels = 1 }) {
  const length = Math.floor(seconds * sampleRate);
  const samples = new Float32Array(length * channels);
  for (let i = 0; i < length; i += 1) {
    const value = Math.sin((2 * Math.PI * frequency * i) / sampleRate) * amplitude;
    for (let channel = 0; channel < channels; channel += 1) {
      samples[i * channels + channel] = value;
    }
  }
  return samples;
}

export function clickTrackSamples({ bpm = 120, seconds = 8, sampleRate = 44100 }) {
  const length = Math.floor(seconds * sampleRate);
  const samples = new Float32Array(length);
  const period = 60 / bpm;
  const burst = 0.055;
  for (let beat = 0; beat * period < seconds; beat += 1) {
    const start = Math.floor(beat * period * sampleRate);
    const count = Math.floor(burst * sampleRate);
    for (let i = 0; i < count && start + i < length; i += 1) {
      const envelope = Math.sin((Math.PI * i) / count) ** 2;
      samples[start + i] += Math.sin((2 * Math.PI * 760 * i) / sampleRate) * envelope * 0.85;
    }
  }
  return samples;
}

export function silenceSamples({ seconds = 2, sampleRate = 44100 }) {
  return new Float32Array(Math.floor(seconds * sampleRate));
}

export function wavFromSamples(samples, options = {}) {
  return encodeWav({ samples, ...options });
}
