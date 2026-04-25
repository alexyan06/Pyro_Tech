/**
 * weatherFetcher.js
 *
 * Fetches real weather AND air-quality data from Open-Meteo APIs.
 *
 * Routing logic:
 *   - If `date` is more than 24 hours in the past → archive-api (historical).
 *   - Otherwise → api.open-meteo.com (live forecast / recent).
 *
 * Air Quality (PM2.5) is always fetched from the Open-Meteo AQ service
 * (air-quality-api.open-meteo.com), which supports both current and historical.
 *
 * @param {number} lat        Latitude  (default: Los Angeles)
 * @param {number} lng        Longitude (default: Los Angeles)
 * @param {Date|string|null} date  Simulation date/time. Null = now.
 * @returns {Promise<WeatherData>}
 *
 * @typedef {Object} WeatherData
 * @property {number} temperature   °F
 * @property {number} humidity      %
 * @property {number} windU         m/s eastward wind component (positive = blowing east)
 * @property {number} windV         m/s northward wind component (positive = blowing north)
 * @property {number} windGusts     mph
 * @property {number} pm25          µg/m³ (PM2.5 concentration)
 * @property {boolean} isHistorical Whether historical API was used
 */

/**
 * Convert meteorological FROM-degrees + speed (mph) to U/V components (m/s).
 * FROM convention: 0° = wind coming from north, blowing south.
 */
function fromDegToUV(fromDeg, speedMph) {
  const speedMs = speedMph * 0.44704;
  const rad = fromDeg * Math.PI / 180;
  return {
    windU: parseFloat((-speedMs * Math.sin(rad)).toFixed(4)),
    windV: parseFloat((-speedMs * Math.cos(rad)).toFixed(4)),
  };
}

// Default: 40 mph from 45° (NE) → fire spreads SW at ~17.9 m/s each component
const _defUV = fromDegToUV(45, 40);
const DEFAULTS = {
  temperature: 85,
  humidity: 10,
  windU: _defUV.windU,
  windV: _defUV.windV,
  windGusts: 55,
  pm25: 15,
  isHistorical: false,
};

/** 24-hour threshold in milliseconds */
const HISTORICAL_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/**
 * Determine if a given date qualifies as "historical" (> 24 h ago).
 * Open-Meteo archive only carries data up to ~5 days before today.
 */
function isHistoricalDate(date) {
  if (!date) return false;
  const d = date instanceof Date ? date : new Date(date);
  return Date.now() - d.getTime() > HISTORICAL_THRESHOLD_MS;
}

/**
 * Convert a Date to YYYY-MM-DD string (UTC).
 */
function toDateStr(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toISOString().slice(0, 10);
}

/**
 * Extract the UTC hour (0-23) from a Date.
 */
function toHour(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.getUTCHours();
}

/**
 * Fetch historical weather from the Open-Meteo Archive API.
 * Returns hourly data; we pick the record closest to the requested hour.
 */
async function fetchHistoricalWeather(lat, lng, date) {
  const dateStr = toDateStr(date);
  const hour = toHour(date);

  const url =
    `https://archive-api.open-meteo.com/v1/archive` +
    `?latitude=${lat}&longitude=${lng}` +
    `&start_date=${dateStr}&end_date=${dateStr}` +
    `&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=UTC`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo Archive HTTP ${res.status}`);
  const data = await res.json();

  const h = data.hourly;
  // Find index for the requested hour (times are "YYYY-MM-DDTHH:00")
  const idx = h.time.findIndex(t => parseInt(t.slice(11, 13), 10) === hour);
  const i = idx >= 0 ? idx : hour; // fallback: use hour directly as index

  const { windU, windV } = fromDegToUV(h.wind_direction_10m[i], h.wind_speed_10m[i]);
  return {
    temperature: h.temperature_2m[i],
    humidity: h.relative_humidity_2m[i],
    windU,
    windV,
    windGusts: h.wind_gusts_10m[i],
    isHistorical: true,
  };
}

/**
 * Fetch live / near-real-time weather from the Open-Meteo Forecast API.
 */
async function fetchLiveWeather(lat, lng) {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lng}` +
    `&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo Forecast HTTP ${res.status}`);
  const data = await res.json();
  const c = data.current;

  const { windU, windV } = fromDegToUV(c.wind_direction_10m, c.wind_speed_10m);
  return {
    temperature: c.temperature_2m,
    humidity: c.relative_humidity_2m,
    windU,
    windV,
    windGusts: c.wind_gusts_10m,
    isHistorical: false,
  };
}

/**
 * Fetch PM2.5 air quality from Open-Meteo Air Quality API.
 * Supports both current and historical (same archive-style endpoint).
 */
async function fetchPM25(lat, lng, date) {
  let url;

  if (date && isHistoricalDate(date)) {
    const dateStr = toDateStr(date);
    const hour = toHour(date);
    url =
      `https://air-quality-api.open-meteo.com/v1/air-quality` +
      `?latitude=${lat}&longitude=${lng}` +
      `&hourly=pm2_5` +
      `&start_date=${dateStr}&end_date=${dateStr}` +
      `&timezone=UTC`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Open-Meteo AQ Historical HTTP ${res.status}`);
    const data = await res.json();
    const h = data.hourly;
    const idx = h.time.findIndex(t => parseInt(t.slice(11, 13), 10) === hour);
    const i = idx >= 0 ? idx : hour;
    const value = h.pm2_5[i];
    return value != null ? value : DEFAULTS.pm25;
  } else {
    url =
      `https://air-quality-api.open-meteo.com/v1/air-quality` +
      `?latitude=${lat}&longitude=${lng}` +
      `&current=pm2_5`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Open-Meteo AQ Current HTTP ${res.status}`);
    const data = await res.json();
    const value = data.current?.pm2_5;
    return value != null ? value : DEFAULTS.pm25;
  }
}

/**
 * Main export: fetch weather + air quality for a given location and time.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {Date|string|null} date  Simulation timestamp. Null/undefined = now.
 */
async function fetchWeather(lat = 34.05, lng = -118.52, date = null) {
  const parsedDate = date ? new Date(date) : null;
  const historical = isHistoricalDate(parsedDate);

  const label = historical
    ? `historical (${toDateStr(parsedDate)})`
    : 'live';
  console.log(`[Weather] Fetching ${label} data for (${lat}, ${lng})`);

  let weather;
  try {
    weather = historical
      ? await fetchHistoricalWeather(lat, lng, parsedDate)
      : await fetchLiveWeather(lat, lng);
  } catch (err) {
    console.warn('[Weather] Weather fetch failed, using defaults:', err.message);
    weather = { ...DEFAULTS };
  }

  let pm25 = DEFAULTS.pm25;
  try {
    pm25 = await fetchPM25(lat, lng, parsedDate);
  } catch (err) {
    console.warn('[Weather] PM2.5 fetch failed, using default:', err.message);
  }

  const result = { ...weather, pm25 };
  console.log('[Weather] Result:', result);
  return result;
}

module.exports = { fetchWeather, isHistoricalDate };
