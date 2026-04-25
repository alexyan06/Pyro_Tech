/**
 * scenarioState.js
 * -----------------
 * In-memory store for the active simulation scenario.
 * Holds dynamically fetched GeoJSON and geocoding metadata.
 * The state is reset each time /api/setup-scenario is called.
 */

let _state = null;

/**
 * Save a new scenario state.
 * @param {object} scenario
 */
function setScenarioState(scenario) {
  _state = { ...scenario, savedAt: new Date().toISOString() };
}

/**
 * Retrieve the current scenario state (or null if none).
 * @returns {object|null}
 */
function getScenarioState() {
  return _state;
}

/**
 * Clear the current state.
 */
function clearScenarioState() {
  _state = null;
}

module.exports = { setScenarioState, getScenarioState, clearScenarioState };
