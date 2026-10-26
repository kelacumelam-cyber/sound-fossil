export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

export function formatDurationLong(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  if (minutes === 0) return `${remainder} sec`;
  return `${minutes} min ${String(remainder).padStart(2, '0')} sec`;
}

export function formatDb(value) {
  if (!Number.isFinite(value)) return '—';
  return `${value.toFixed(1)} dB`;
}

export function formatHz(value) {
  if (!Number.isFinite(value) || value <= 0) return '—';
  if (value >= 1000) return `${(value / 1000).toFixed(2)} kHz`;
  return `${Math.round(value)} Hz`;
}

export function formatPercent(value, digits = 0) {
  if (!Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatFileSize(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
