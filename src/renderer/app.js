import { analyzeAudio } from '../core/analysis.js';
import { buildSculpture } from '../core/geometry.js';
import { parseWav, WavError } from '../core/wav.js';
import { DEFAULT_SETTINGS, normalizeSettings } from '../core/settings.js';
import { fossilName, sculptureDescription } from '../core/names.js';
import {
  formatDb,
  formatDuration,
  formatDurationLong,
  formatFileSize,
  formatHz,
  formatPercent,
} from '../core/format.js';
import { createViewer } from './scene.js';

const appEl = document.querySelector('.app');
const $ = (id) => document.getElementById(id);

const ui = {
  micButton: $('mic-button'),
  micTitle: $('mic-title'),
  micCard: document.querySelector('.mic-card'),
  recordingPanel: $('recording-panel'),
  recordingPaused: $('recording-paused'),
  recTime: $('rec-time'),
  liveMeter: $('live-meter'),
  stopRecording: $('stop-recording'),
  cancelRecording: $('cancel-recording'),
  dropzone: $('dropzone'),
  fileInput: $('file-input'),
  sourceCard: $('source-card'),
  sourceName: $('source-name'),
  sourceMeta: $('source-meta'),
  clearSource: $('clear-source'),
  sourceNote: $('source-note'),
  sourceNoteText: $('source-note-text'),
  emptyState: $('empty-state'),
  loadingOverlay: $('loading-overlay'),
  loadingTitle: $('loading-title'),
  loadingSubtitle: $('loading-subtitle'),
  silentNote: $('silent-note'),
  silentNoteText: $('silent-note-text'),
  specimenPlate: $('specimen-plate'),
  specimenName: $('specimen-name'),
  specimenCode: $('specimen-code'),
  specimenTone: $('specimen-tone'),
  specimenPrint: $('specimen-print'),
  stageHint: $('stage-hint'),
  stageBadge: $('stage-badge'),
  stageBadgeText: $('stage-badge-text'),
  toggleRotate: $('toggle-rotate'),
  toggleGrid: $('toggle-grid'),
  resetView: $('reset-view'),
  exportButton: $('export-button'),
  stats: $('stats'),
  statDuration: $('stat-duration'),
  statPeak: $('stat-peak'),
  statRms: $('stat-rms'),
  statBpm: $('stat-bpm'),
  statDominant: $('stat-dominant'),
  statSilence: $('stat-silence'),
  meterBrightness: $('meter-brightness'),
  meterDynamic: $('meter-dynamic'),
  meterPulse: $('meter-pulse'),
  valueBrightness: $('value-brightness'),
  valueDynamic: $('value-dynamic'),
  valuePulse: $('value-pulse'),
  diagnosisCopy: $('diagnosis-copy'),
  specimenDescription: $('specimen-description'),
  descriptionText: $('description-text'),
  geometryHash: $('geometry-hash'),
  resetSettings: $('reset-settings'),
  permissionDialog: $('permission-dialog'),
  allowMic: $('allow-mic'),
  statusLeft: $('status-left'),
  engineStatus: $('engine-status'),
  appVersion: $('app-version'),
  toast: $('toast'),
  toastMark: $('toast-mark'),
  toastText: $('toast-text'),
  liveRegion: $('live-region'),
};

const settingInputs = {
  strata: $('setting-strata'),
  ridge: $('setting-ridge'),
  patina: $('setting-patina'),
  height: $('setting-height'),
  twist: $('setting-twist'),
};

const settingValues = {
  strata: $('value-strata'),
  ridge: $('value-ridge'),
  patina: $('value-patina'),
  height: $('value-height'),
  twist: $('value-twist'),
};

const state = {
  settings: normalizeSettings(DEFAULT_SETTINGS),
  analysis: null,
  geometry: null,
  name: null,
  source: null,
  recording: null,
  busy: false,
  lastGeometrySignature: '',
  lastExportPath: '',
  loadId: 0,
  testMode: false,
};

let viewer = null;
let toastTimer = null;
let rebuildTimer = null;
let lastFocusedBeforeDialog = null;

const BARS = 34;
for (let i = 0; i < BARS; i += 1) {
  const bar = document.createElement('span');
  ui.liveMeter.append(bar);
}

function nextPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

function refreshChrome() {
  if (state.recording && !state.recording.stopped) {
    ui.engineStatus.textContent = 'recording · live';
  } else if (state.busy) {
    ui.engineStatus.textContent = 'analyzing specimen';
  } else {
    ui.engineStatus.textContent = 'offline studio';
  }
  appEl.classList.toggle('is-recording', Boolean(state.recording && !state.recording.stopped));
  appEl.classList.toggle('is-busy', state.busy && !state.recording);
}

function setBusy(busy) {
  state.busy = busy;
  refreshChrome();
}

function setStatusLeft(text) {
  ui.statusLeft.textContent = text;
}

function setStageBadge(text, live = false) {
  ui.stageBadgeText.textContent = text;
  ui.stageBadge.classList.toggle('is-live', live);
}

function showToast(message, kind = 'info', duration = 4600) {
  clearTimeout(toastTimer);
  ui.toastText.textContent = message;
  ui.toastMark.textContent = kind === 'error' ? '!' : 'i';
  ui.toast.classList.toggle('error', kind === 'error');
  ui.toast.classList.add('show');
  toastTimer = setTimeout(() => {
    ui.toast.classList.remove('show');
  }, duration);
}

function announce(message) {
  ui.liveRegion.textContent = '';
  window.setTimeout(() => {
    ui.liveRegion.textContent = message;
  }, 40);
}

function describeError(error) {
  if (error instanceof WavError) {
    switch (error.code) {
      case 'NOT_WAV':
        return 'This file is not a valid WAV. No RIFF/WAVE header was found.';
      case 'UNSUPPORTED':
        return error.message || 'This WAV format is not supported.';
      case 'EMPTY':
        return 'The WAV file contains no audio samples. Try another file.';
      case 'CORRUPT':
        return error.message || 'The WAV file appears to be corrupt.';
      default:
        return error.message || 'The WAV file could not be read.';
    }
  }
  switch (error?.code) {
    case 'EMPTY_AUDIO':
      return 'The file contains no audio to analyze.';
    case 'BAD_SAMPLE_RATE':
      return 'The audio sample rate is invalid.';
    case 'CORRUPT_AUDIO':
      return 'The audio data is corrupt; invalid samples were found.';
    default:
      return error?.message || 'An unexpected error occurred.';
  }
}

function describeMicError(error) {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Microphone permission was denied. You can allow it in Windows Settings → Privacy & security → Microphone.';
    case 'NotFoundError':
      return 'No microphone was found. Connect a microphone and try again.';
    case 'NotReadableError':
      return 'The microphone may be in use by another application.';
    case 'NotSupportedError':
      return 'Microphone recording is not supported on this device.';
    default:
      return `Could not open the microphone: ${error?.message || 'unknown error'}`;
  }
}

async function beginLoading(title, subtitle) {
  ui.loadingTitle.textContent = title;
  ui.loadingSubtitle.textContent = subtitle;
  ui.loadingOverlay.hidden = false;
  setBusy(true);
  await nextPaint();
}

function updateLoading(title, subtitle) {
  ui.loadingTitle.textContent = title;
  ui.loadingSubtitle.textContent = subtitle;
}

function endLoading() {
  ui.loadingOverlay.hidden = true;
  setBusy(false);
}

function updateSliderFill(input) {
  const min = Number(input.min);
  const max = Number(input.max);
  const value = Number(input.value);
  const percent = max > min ? ((value - min) / (max - min)) * 100 : 0;
  input.style.setProperty('--fill', `${percent}%`);
}

function syncControlsFromSettings() {
  settingInputs.strata.value = String(state.settings.strata);
  settingInputs.ridge.value = String(Math.round(state.settings.ridge * 100));
  settingInputs.patina.value = String(Math.round(state.settings.patina * 100));
  settingInputs.height.value = String(Math.round(state.settings.height * 100));
  settingInputs.twist.value = String(Math.round(state.settings.twist * 100));

  settingValues.strata.textContent = String(state.settings.strata);
  settingValues.ridge.textContent = formatPercent(state.settings.ridge);
  settingValues.patina.textContent = formatPercent(state.settings.patina);
  settingValues.height.textContent = `${state.settings.height.toFixed(2)}×`;
  settingValues.twist.textContent = formatPercent(state.settings.twist);

  Object.values(settingInputs).forEach(updateSliderFill);

  ui.toggleRotate.setAttribute('aria-pressed', String(state.settings.autoRotate));
  ui.toggleGrid.setAttribute('aria-pressed', String(state.settings.grid));
  viewer?.setViewOptions({ autoRotate: state.settings.autoRotate, grid: state.settings.grid });
}

function readSettingsFromControls() {
  state.settings = normalizeSettings({
    ...state.settings,
    strata: Number(settingInputs.strata.value),
    ridge: Number(settingInputs.ridge.value) / 100,
    patina: Number(settingInputs.patina.value) / 100,
    height: Number(settingInputs.height.value) / 100,
    twist: Number(settingInputs.twist.value) / 100,
  });
  settingValues.strata.textContent = String(state.settings.strata);
  settingValues.ridge.textContent = formatPercent(state.settings.ridge);
  settingValues.patina.textContent = formatPercent(state.settings.patina);
  settingValues.height.textContent = `${state.settings.height.toFixed(2)}×`;
  settingValues.twist.textContent = formatPercent(state.settings.twist);
}

function applyAnalysis(analysis, source) {
  state.analysis = analysis;
  state.source = source;
  state.name = fossilName(analysis.fingerprint, analysis.stats);
  state.loadId += 1;

  ui.emptyState.classList.add('is-hidden');
  ui.specimenPlate.hidden = false;
  ui.stageHint.hidden = false;
  ui.exportButton.disabled = false;
  ui.stats.classList.add('has-data');
  ui.diagnosisCopy.textContent = sculptureDescription(analysis);
  ui.specimenDescription.hidden = false;
  ui.descriptionText.textContent = sculptureDescription(analysis);

  ui.statDuration.textContent = formatDuration(analysis.analyzedDuration);
  ui.statPeak.textContent = formatDb(analysis.stats.peakDb);
  ui.statRms.textContent = formatDb(analysis.stats.rmsDb);
  ui.statBpm.textContent = analysis.stats.bpm ? `~${Math.round(analysis.stats.bpm)} bpm` : 'free';
  ui.statDominant.textContent = formatHz(analysis.stats.dominantHz);
  ui.statSilence.textContent = formatPercent(analysis.stats.silenceRatio);

  const brightness = Math.max(0, Math.min(1, analysis.stats.brightness));
  const dynamic = Math.max(0, Math.min(1, analysis.stats.dynamicRangeDb / 60));
  const pulse = Math.max(0, Math.min(1, analysis.stats.pulseRegularity));
  ui.meterBrightness.style.width = formatPercent(brightness);
  ui.meterDynamic.style.width = formatPercent(dynamic);
  ui.meterPulse.style.width = formatPercent(pulse);
  ui.valueBrightness.textContent = formatPercent(brightness);
  ui.valueDynamic.textContent = `${analysis.stats.dynamicRangeDb.toFixed(0)} dB`;
  ui.valuePulse.textContent = analysis.stats.bpm ? formatPercent(pulse) : '—';

  ui.silentNote.hidden = !analysis.isSilent;
  if (analysis.isSilent) {
    ui.silentNoteText.textContent =
      'This specimen is nearly silent. The sculpture was carved as a slender core with a faint layer of sediment.';
  }

  if (source.kind === 'file') {
    const meta = [
      formatDuration(analysis.analyzedDuration),
      `${source.bitsPerSample}-bit ${String(source.format || 'pcm').toUpperCase()}`,
      source.channels === 1 ? 'mono' : `${source.channels} channels`,
      formatFileSize(source.size),
    ];
    ui.sourceName.textContent = source.name;
    ui.sourceMeta.textContent = meta.join(' · ');
    ui.sourceCard.hidden = false;
  } else {
    ui.sourceName.textContent = 'Microphone recording';
    ui.sourceMeta.textContent = `${formatDuration(analysis.analyzedDuration)} · live recording · processed on device`;
    ui.sourceCard.hidden = false;
  }

  const notes = [];
  if (analysis.truncated) {
    notes.push(
      `The source is ${formatDurationLong(analysis.originalDuration)} long; the first 3 minutes were analyzed. The fossil is a relic of those first three minutes.`,
    );
  }
  if (notes.length) {
    ui.sourceNoteText.textContent = notes.join(' ');
    ui.sourceNote.hidden = false;
  } else {
    ui.sourceNote.hidden = true;
  }

  rebuildGeometry({ resetView: true, announce: false });

  const minute = formatDuration(analysis.analyzedDuration);
  setStatusLeft(`${state.name.title} · ${minute} · ${state.geometry.ringCount} layers`);
  setStageBadge(`fossil ready · ${state.geometry.ringCount} layers`, true);
  announce(`Fossil created: ${state.name.title}. ${analysis.isSilent ? 'The specimen is nearly silent.' : ''}`);

  const message = analysis.isSilent
    ? `Silent specimen carved: ${state.name.title}.`
    : `${state.name.title} carved · ${formatDuration(analysis.analyzedDuration)}`;
  showToast(message, 'info', 4200);
}

function rebuildGeometry({ resetView = false, announce = false } = {}) {
  if (!state.analysis) return;
  const signature = [
    state.settings.strata,
    state.settings.ridge.toFixed(4),
    state.settings.patina.toFixed(4),
    state.settings.height.toFixed(4),
    state.settings.twist.toFixed(4),
  ].join('|');
  if (signature === state.lastGeometrySignature && !resetView) {
    return;
  }

  const geometry = buildSculpture(state.analysis, state.settings);
  state.geometry = geometry;
  state.lastGeometrySignature = signature;

  const plaque = {
    name: state.name.title,
    code: state.name.code,
    tone: state.name.tone,
    duration: formatDuration(state.analysis.analyzedDuration),
    hash: geometry.hash,
    fingerprint: state.analysis.fingerprint,
  };

  viewer.setSculpture(geometry, plaque, {
    resetView,
    autoRotate: state.settings.autoRotate,
    grid: state.settings.grid,
  });

  ui.specimenName.textContent = state.name.title;
  ui.specimenCode.textContent = state.name.code;
  ui.specimenTone.textContent = state.name.tone;
  ui.specimenPrint.textContent = `#${geometry.hash}`;
  ui.geometryHash.textContent = geometry.hash;
  setStageBadge(`fossil ready · ${geometry.ringCount} layers`, true);
  setStatusLeft(`${state.name.title} · ${formatDuration(state.analysis.analyzedDuration)} · ${geometry.ringCount} layers`);

  if (announce) {
    announce(`Sculpture updated. ${geometry.ringCount} layers, signature ${geometry.hash}.`);
  }
}

function scheduleRebuild() {
  if (!state.analysis) return;
  clearTimeout(rebuildTimer);
  ui.geometryHash.textContent = 'carving';
  rebuildTimer = setTimeout(() => {
    try {
      rebuildGeometry({ resetView: false });
    } catch (error) {
      showToast(`Could not build the sculpture: ${error.message}`, 'error');
      ui.geometryHash.textContent = state.geometry?.hash || '--------';
    }
  }, 90);
}

function populateSourceNoteForTruncated(analysis) {
  if (!analysis.truncated) return;
  ui.sourceNoteText.textContent = `The source is ${formatDurationLong(analysis.originalDuration)} long; the first 3 minutes were analyzed.`;
  ui.sourceNote.hidden = false;
}

async function processSamples(samples, sampleRate, source, { loadingActive = false } = {}) {
  if (!loadingActive) {
    await beginLoading('Decoding relic…', 'separating frequency, amplitude, rhythm, and silence');
  } else {
    updateLoading('Decoding relic…', 'separating frequency, amplitude, rhythm, and silence');
    await nextPaint();
  }

  try {
    const analysis = analyzeAudio(samples, sampleRate);
    applyAnalysis(analysis, source);
    populateSourceNoteForTruncated(analysis);
  } catch (error) {
    showToast(describeError(error), 'error', 6500);
    setStatusLeft('specimen could not be processed');
    if (!state.analysis) {
      setStageBadge('empty plinth');
      ui.diagnosisCopy.textContent = 'The specimen could not be read. The label fills in when valid audio arrives.';
    }
  } finally {
    endLoading();
  }
}

async function handleWavFile(file) {
  if (!file) return;
  if (state.busy) {
    showToast('Another specimen is being processed; wait for it to finish.', 'info');
    return;
  }
  if (state.recording) {
    showToast('Finish the current recording first.', 'info');
    return;
  }
  if (!/\.wav$/i.test(file.name)) {
    showToast('Only WAV files can be imported.', 'error');
    return;
  }
  if (file.size === 0) {
    showToast('This file is empty (0 bytes).', 'error');
    return;
  }
  if (file.size > 120 * 1024 * 1024) {
    showToast('The file is too large. WAV files over 120 MB are not supported.', 'error');
    return;
  }

  await beginLoading('Reading specimen…', file.name);
  try {
    const buffer = await file.arrayBuffer();
    const wav = parseWav(buffer);
    await processSamples(
      wav.samples,
      wav.sampleRate,
      {
        kind: 'file',
        name: file.name,
        size: file.size,
        channels: wav.channels,
        bitsPerSample: wav.bitsPerSample,
        format: wav.format,
      },
      { loadingActive: true },
    );
  } catch (error) {
    showToast(describeError(error), 'error', 6500);
    setStatusLeft('specimen could not be read');
    endLoading();
    if (!state.analysis) {
      setStageBadge('empty plinth');
    }
  } finally {
    ui.fileInput.value = '';
  }
}

function resetAnalysisUI() {
  state.analysis = null;
  state.geometry = null;
  state.name = null;
  state.source = null;
  state.lastGeometrySignature = '';
  ui.emptyState.classList.remove('is-hidden');
  ui.specimenPlate.hidden = true;
  ui.stageHint.hidden = true;
  ui.exportButton.disabled = true;
  ui.stats.classList.remove('has-data');
  ui.statDuration.textContent = '—';
  ui.statPeak.textContent = '—';
  ui.statRms.textContent = '—';
  ui.statBpm.textContent = '—';
  ui.statDominant.textContent = '—';
  ui.statSilence.textContent = '—';
  ui.meterBrightness.style.width = '0%';
  ui.meterDynamic.style.width = '0%';
  ui.meterPulse.style.width = '0%';
  ui.valueBrightness.textContent = '—';
  ui.valueDynamic.textContent = '—';
  ui.valuePulse.textContent = '—';
  ui.diagnosisCopy.textContent = 'No specimen yet. The label fills in when sound arrives.';
  ui.specimenDescription.hidden = true;
  ui.descriptionText.textContent = '';
  ui.geometryHash.textContent = '--------';
  ui.silentNote.hidden = true;
  ui.sourceNote.hidden = true;
  ui.sourceCard.hidden = true;
  ui.fileInput.value = '';
  setStageBadge('empty plinth');
  setStatusLeft('ready · awaiting a specimen');
  viewer.clearSculpture();
  viewer.resetView();
}

function cleanupRecording(recording) {
  clearInterval(recording.timer);
  cancelAnimationFrame(recording.raf);
  try {
    recording.stream.getTracks().forEach((track) => track.stop());
  } catch {
    /* ignore */
  }
  recording.audioContext.close().catch(() => {});
}

function resetRecordingUI() {
  ui.micCard.classList.remove('is-recording');
  ui.recordingPanel.hidden = true;
  ui.recordingPaused.hidden = true;
  ui.recTime.textContent = '00:00';
  for (const bar of ui.liveMeter.children) bar.style.height = '3%';
  refreshChrome();
}

function startMeter(recording) {
  const analyser = recording.analyser;
  const data = new Uint8Array(analyser.frequencyBinCount);
  const bars = Array.from(ui.liveMeter.children);

  const draw = () => {
    if (state.recording !== recording || recording.stopped) return;
    analyser.getByteFrequencyData(data);
    for (let i = 0; i < bars.length; i += 1) {
      const start = Math.floor((i / bars.length) ** 1.65 * data.length);
      const end = Math.max(start + 1, Math.floor(((i + 1) / bars.length) ** 1.65 * data.length));
      let sum = 0;
      for (let j = start; j < end; j += 1) sum += data[j];
      const level = sum / (end - start) / 255;
      bars[i].style.height = `${3 + Math.min(1, level * 1.5) * 94}%`;
    }
    recording.raf = requestAnimationFrame(draw);
  };
  draw();
}

async function startRecording() {
  if (state.recording || state.busy) return;
  setStatusLeft('requesting microphone permission…');
  refreshChrome();

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false,
      },
    });

    const audioContext = new AudioContext();
    await audioContext.resume().catch(() => {});
    const sourceNode = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.72;
    sourceNode.connect(analyser);

    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
    ];
    const mimeType = candidates.find((type) => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const recording = {
      stream,
      audioContext,
      sourceNode,
      analyser,
      recorder,
      chunks: [],
      startedAt: performance.now(),
      timer: null,
      raf: 0,
      cancelled: false,
      stopped: false,
    };
    state.recording = recording;

    recorder.addEventListener('dataavailable', (event) => {
      if (event.data && event.data.size > 0) recording.chunks.push(event.data);
    });
    recorder.addEventListener('stop', () => {
      void finishRecording(recording);
    });
    recorder.addEventListener('error', () => {
      showToast('A recording error occurred.', 'error');
      stopRecording(true);
    });

    const track = stream.getAudioTracks()[0];
    track?.addEventListener('ended', () => {
      if (state.recording === recording && !recording.stopped) {
        stopRecording(false);
      }
    });

    recorder.start(250);
    ui.micCard.classList.add('is-recording');
    ui.recordingPanel.hidden = false;
    ui.recordingPaused.hidden = true;
    ui.recTime.textContent = '00:00';
    setStatusLeft('recording in progress · microphone live');
    refreshChrome();
    announce('Microphone recording started.');

    const tick = () => {
      if (state.recording !== recording) return;
      const elapsed = (performance.now() - recording.startedAt) / 1000;
      ui.recTime.textContent = formatDuration(elapsed);
      if (elapsed >= 180) {
        showToast('The 3-minute recording limit was reached.', 'info', 3500);
        stopRecording(false, true);
      }
    };
    recording.timer = setInterval(tick, 200);
    tick();
    startMeter(recording);
  } catch (error) {
    resetRecordingUI();
    setStatusLeft('could not open microphone');
    showToast(describeMicError(error), 'error', 7000);
  }
}

function stopRecording(cancelled = false, auto = false) {
  const recording = state.recording;
  if (!recording || recording.stopped) return;
  recording.stopped = true;
  recording.cancelled = cancelled;
  clearInterval(recording.timer);
  cancelAnimationFrame(recording.raf);
  ui.recordingPanel.hidden = true;
  ui.micCard.classList.remove('is-recording');
  resetRecordingUI();
  ui.recordingPaused.hidden = cancelled;
  setStatusLeft(cancelled ? 'recording cancelled' : auto ? 'recording limit · decoding' : 'decoding recording…');
  try {
    recording.recorder.stop();
  } catch {
    /* ignore */
  }
  cleanupRecording(recording);
  if (cancelled) {
    state.recording = null;
    resetRecordingUI();
    setStatusLeft('ready · awaiting a specimen');
    if (!state.analysis) setStageBadge('empty plinth');
  }
  refreshChrome();
}

async function finishRecording(recording) {
  resetRecordingUI();
  if (recording.cancelled) {
    state.recording = null;
    refreshChrome();
    return;
  }

  ui.recTime.textContent = formatDuration(
    (performance.now() - recording.startedAt) / 1000,
  );

  const blob = new Blob(recording.chunks, { type: recording.recorder.mimeType || 'audio/webm' });
  if (blob.size < 800) {
    state.recording = null;
    ui.recordingPaused.hidden = true;
    showToast('Recording is too short. Record at least one second.', 'error');
    setStatusLeft('recording too short');
    if (!state.analysis) setStageBadge('empty plinth');
    refreshChrome();
    return;
  }

  let decodeContext = null;
  try {
    await beginLoading('Decoding recording…', 'microphone data is being decoded locally');
    const arrayBuffer = await blob.arrayBuffer();
    decodeContext = new AudioContext();
    const audioBuffer = await decodeContext.decodeAudioData(arrayBuffer);
    if (audioBuffer.duration < 0.25) {
      throw new Error('Recording is too short.');
    }

    const mono = new Float32Array(audioBuffer.length);
    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
      const data = audioBuffer.getChannelData(channel);
      for (let i = 0; i < data.length; i += 1) mono[i] += data[i];
    }
    if (audioBuffer.numberOfChannels > 1) {
      for (let i = 0; i < mono.length; i += 1) mono[i] /= audioBuffer.numberOfChannels;
    }

    state.recording = null;
    ui.recordingPaused.hidden = true;
    refreshChrome();

    await processSamples(
      mono,
      audioBuffer.sampleRate,
      {
        kind: 'mic',
        name: 'Microphone recording',
        size: blob.size,
        channels: 1,
        bitsPerSample: 32,
        format: 'float',
      },
      { loadingActive: true },
    );
  } catch (error) {
    state.recording = null;
    ui.recordingPaused.hidden = true;
    resetRecordingUI();
    endLoading();
    showToast(
      `Could not decode recording: ${error?.message || 'unknown error'}. Try recording again.`,
      'error',
      6500,
    );
    setStatusLeft('recording could not be decoded');
  } finally {
    decodeContext?.close().catch(() => {});
    if (!state.analysis) setStageBadge('empty plinth');
    refreshChrome();
  }
}

async function exportPng() {
  if (!state.analysis || !state.geometry) return;
  ui.exportButton.classList.add('is-saving');
  ui.exportButton.disabled = true;
  setStatusLeft('preparing PNG…');
  try {
    await nextPaint();
    const plaque = {
      name: state.name.title,
      code: state.name.code,
      tone: state.name.tone,
      duration: formatDuration(state.analysis.analyzedDuration),
      hash: state.geometry.hash,
      fingerprint: state.analysis.fingerprint,
    };
    const { dataUrl } = viewer.exportPng(2048, plaque);
    const filename = `sound-fossil-${state.name.code.toLowerCase()}-${state.geometry.hash.toLowerCase()}.png`;
    const result = await window.soundFossil.savePng(dataUrl, filename);
    if (result?.canceled) {
      showToast('Export cancelled.', 'info', 3000);
      setStatusLeft('export cancelled');
    } else if (result?.saved) {
      state.lastExportPath = result.path;
      showToast(`PNG saved · ${result.path}`, 'info', 7000);
      setStatusLeft('PNG exported');
      announce('PNG image saved.');
    } else {
      showToast(result?.error || 'The PNG could not be saved.', 'error', 6000);
      setStatusLeft('export failed');
    }
  } catch (error) {
    showToast(`Export error: ${error.message}`, 'error', 6000);
    setStatusLeft('export failed');
  } finally {
    ui.exportButton.classList.remove('is-saving');
    ui.exportButton.disabled = !state.analysis;
    if (state.analysis) {
      setStatusLeft(
        `${state.name.title} · ${formatDuration(state.analysis.analyzedDuration)} · ${state.geometry.ringCount} layers`,
      );
    }
  }
}

function clearSpecimen() {
  if (state.recording) {
    showToast('Finish the recording first.', 'info');
    return;
  }
  resetAnalysisUI();
  showToast('Specimen cleared. You can drop new audio.', 'info', 3000);
}

async function resetSettings() {
  state.settings = normalizeSettings(DEFAULT_SETTINGS);
  syncControlsFromSettings();
  if (state.analysis) {
    state.lastGeometrySignature = '';
    try {
      rebuildGeometry({ resetView: true, announce: true });
      showToast('Sculpture settings reset.', 'info', 2600);
    } catch (error) {
      showToast(`Could not build the sculpture: ${error.message}`, 'error');
    }
  }
}

function wireEvents() {
  ui.micButton.addEventListener('click', () => {
    if (state.busy) {
      showToast('Processing is in progress; wait for it to finish.', 'info');
      return;
    }
    if (!ui.permissionDialog.open) {
      lastFocusedBeforeDialog = document.activeElement;
      ui.permissionDialog.showModal();
    }
  });

  ui.allowMic.addEventListener('click', (event) => {
    event.preventDefault();
    ui.permissionDialog.close('allow');
    lastFocusedBeforeDialog?.focus?.();
    void startRecording();
  });

  ui.permissionDialog.addEventListener('close', () => {
    if (ui.permissionDialog.returnValue !== 'allow') {
      lastFocusedBeforeDialog?.focus?.();
    }
    ui.permissionDialog.returnValue = '';
  });

  ui.stopRecording.addEventListener('click', () => stopRecording(false));
  ui.cancelRecording.addEventListener('click', () => stopRecording(true));

  ui.fileInput.addEventListener('change', () => {
    const file = ui.fileInput.files?.[0];
    if (file) void handleWavFile(file);
  });

  const openPicker = () => {
    if (state.busy || state.recording) {
      showToast(state.recording ? 'Finish the recording first.' : 'Processing in progress.', 'info');
      return;
    }
    ui.fileInput.click();
  };
  ui.dropzone.addEventListener('click', openPicker);
  ui.dropzone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openPicker();
    }
  });

  for (const eventName of ['dragenter', 'dragover']) {
    ui.dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      event.stopPropagation();
      ui.dropzone.classList.add('is-dragging');
    });
  }
  for (const eventName of ['dragleave', 'drop']) {
    ui.dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      event.stopPropagation();
      ui.dropzone.classList.remove('is-dragging');
    });
  }
  ui.dropzone.addEventListener('drop', (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (file) void handleWavFile(file);
  });

  window.addEventListener('dragover', (event) => event.preventDefault());
  window.addEventListener('drop', (event) => event.preventDefault());

  ui.clearSource.addEventListener('click', clearSpecimen);

  for (const [key, input] of Object.entries(settingInputs)) {
    input.addEventListener('input', () => {
      readSettingsFromControls();
      updateSliderFill(input);
      if (key === 'strata') settingValues.strata.textContent = String(state.settings.strata);
      scheduleRebuild();
    });
    input.addEventListener('change', () => {
      readSettingsFromControls();
      updateSliderFill(input);
      scheduleRebuild();
    });
  }

  ui.resetSettings.addEventListener('click', () => {
    void resetSettings();
  });

  ui.toggleRotate.addEventListener('click', () => {
    state.settings.autoRotate = !state.settings.autoRotate;
    ui.toggleRotate.setAttribute('aria-pressed', String(state.settings.autoRotate));
    viewer.setAutoRotate(state.settings.autoRotate);
  });

  ui.toggleGrid.addEventListener('click', () => {
    state.settings.grid = !state.settings.grid;
    ui.toggleGrid.setAttribute('aria-pressed', String(state.settings.grid));
    viewer.setGrid(state.settings.grid);
  });

  ui.resetView.addEventListener('click', () => {
    viewer.resetView();
    ui.toggleRotate.setAttribute('aria-pressed', 'true');
    state.settings.autoRotate = true;
    viewer.setAutoRotate(true);
  });

  ui.exportButton.addEventListener('click', () => {
    void exportPng();
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.recording) {
      stopRecording(true);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'e') {
      event.preventDefault();
      if (state.analysis && !state.busy) void exportPng();
    }
  });

  window.addEventListener('beforeunload', () => {
    if (state.recording) {
      state.recording.cancelled = true;
      try {
        state.recording.recorder.stop();
      } catch {
        /* ignore */
      }
    }
  });
}

async function boot() {
  try {
    viewer = createViewer($('scene'), document.getElementById('stage'));
  } catch (error) {
    showToast(`Could not start the 3D view: ${error.message}`, 'error', 12000);
    setStatusLeft('WebGL could not be initialized');
    return;
  }

  syncControlsFromSettings();
  wireEvents();
  setStageBadge('empty plinth');
  setStatusLeft('ready · awaiting a specimen');

  const info = await window.soundFossil.appInfo().catch(() => null);
  if (info) {
    ui.appVersion.textContent = `Sound Fossil v${info.version}`;
    state.testMode = Boolean(info.testMode);
  }

  if (state.testMode) {
    window.__soundFossilTest = {
      snapshot: () => ({
        loadId: state.loadId,
        fingerprint: state.analysis?.fingerprint ?? null,
        audioHash: state.analysis?.audioHash ?? null,
        geometryHash: state.geometry?.hash ?? null,
        name: state.name?.title ?? null,
        code: state.name?.code ?? null,
        ringCount: state.geometry?.ringCount ?? 0,
        settings: { ...state.settings },
        silent: state.analysis?.isSilent ?? null,
        truncated: state.analysis?.truncated ?? null,
        analyzedDuration: state.analysis?.analyzedDuration ?? null,
        sourceKind: state.source?.kind ?? null,
        stats: state.analysis?.stats ?? null,
        viewer: viewer.getState(),
      }),
      setSettings: (partial) => {
        state.settings = normalizeSettings({ ...state.settings, ...partial });
        syncControlsFromSettings();
        rebuildGeometry({ resetView: false });
        return window.__soundFossilTest.snapshot();
      },
      clear: () => clearSpecimen(),
    };
  }

  const params = new URLSearchParams(window.location.search);
  if (params.get('demo') === '1') {
    setStageBadge('demo · empty plinth');
  }
}

void boot();
