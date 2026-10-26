const ADJECTIVES = [
  'Amber', 'Ancient', 'Deep', 'Copper', 'Silent', 'Bronze', 'Sand', 'Night', 'Ash',
  'Coral', 'Olive', 'Shadow', 'Frost', 'Ember', 'Moss', 'Honey', 'Iron', 'Salt',
  'Cedar', 'Glaze', 'Distant', 'First', 'Last', 'Damp', 'Dusty', 'Bright',
];

const FORMS = [
  'Fold', 'Column', 'Vein', 'Shell', 'Spine', 'Ring', 'Layer',
  'Whisper', 'Core', 'Echo', 'Shore', 'Knot', 'Trace', 'Bone',
  'Breath', 'Fracture', 'Silt', 'Sheath',
];

const TONES = [
  'low', 'bright', 'dark', 'quivering', 'round', 'sharp', 'warm', 'cold',
  'dry', 'damp', 'still', 'rippling',
];

export function fossilName(fingerprint, stats) {
  const seed = Number.parseInt(String(fingerprint).slice(0, 8), 16) || 0;
  const adjective = ADJECTIVES[seed % ADJECTIVES.length];
  const form = FORMS[(seed >>> 8) % FORMS.length];
  const tone = TONES[(seed >>> 16) % TONES.length];
  return {
    title: `${adjective} ${form}`,
    tone,
    code: `SF-${String(fingerprint).slice(0, 4).toUpperCase()}`,
  };
}

export function sculptureDescription(analysis) {
  const stats = analysis.stats;
  if (analysis.isSilent) {
    return 'An almost completely silent specimen. The body was carved as a slender core with a faint layer of sediment.';
  }
  const parts = [];
  if (stats.bpm) {
    parts.push(`A pulse of about ${Math.round(stats.bpm)} beats per minute`);
  } else {
    parts.push('A free-flowing pulse');
  }
  if (stats.brightness > 0.42) {
    parts.push('a bright, grainy texture');
  } else if (stats.brightness < 0.14) {
    parts.push('a dark, full-bodied texture');
  } else {
    parts.push('a balanced timbre');
  }
  if (stats.silenceRatio > 0.35) {
    parts.push('marked knots of silence');
  }
  return `${parts.join(', ')}.`;
}
