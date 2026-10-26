export const DEFAULT_SETTINGS = Object.freeze({
  strata: 128,
  ridge: 0.58,
  patina: 0.38,
  height: 2.7,
  twist: 0.32,
  autoRotate: true,
  grid: false,
});

export const GEOMETRY_KEYS = Object.freeze(['strata', 'ridge', 'patina', 'height', 'twist']);

function clamp(value, min, max, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

export function normalizeSettings(input = {}) {
  return {
    strata: Math.round(clamp(input.strata, 40, 220, DEFAULT_SETTINGS.strata)),
    ridge: clamp(input.ridge, 0, 1, DEFAULT_SETTINGS.ridge),
    patina: clamp(input.patina, 0, 1, DEFAULT_SETTINGS.patina),
    height: clamp(input.height, 1.8, 3.6, DEFAULT_SETTINGS.height),
    twist: clamp(input.twist, 0, 1, DEFAULT_SETTINGS.twist),
    autoRotate: input.autoRotate === undefined ? DEFAULT_SETTINGS.autoRotate : Boolean(input.autoRotate),
    grid: input.grid === undefined ? DEFAULT_SETTINGS.grid : Boolean(input.grid),
  };
}

export function geometrySettingsSignature(settings) {
  const normalized = normalizeSettings(settings);
  return GEOMETRY_KEYS.map((key) => {
    const value = normalized[key];
    return `${key}:${typeof value === 'number' ? value.toFixed(3) : value}`;
  }).join('|');
}
