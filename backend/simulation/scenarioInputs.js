const DEFAULT_INITIAL_ACRES = 10;
const MAX_INITIAL_ACRES = 10000;

function normalizeInitialAcres(value, fallback = DEFAULT_INITIAL_ACRES) {
  const parsed = Number(value);
  const safeValue = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(MAX_INITIAL_ACRES, Math.max(0, safeValue));
}

module.exports = {
  DEFAULT_INITIAL_ACRES,
  MAX_INITIAL_ACRES,
  normalizeInitialAcres,
};
