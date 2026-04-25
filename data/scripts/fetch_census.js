/**
 * fetch_census.js
 *
 * Fetches 2020 Census tract population data and TIGER/Line centroids for
 * Los Angeles County (state=06, county=037) and writes a GeoJSON FeatureCollection
 * of tract centroids with population and density fields.
 *
 * Source: TIGER/Line Tracts_Blocks MapServer (layer 10 = Census 2020 Tracts)
 *   - Provides: GEOID, CENTLAT, CENTLON, AREALAND (sq meters), POP100
 *   No API key required.
 *
 * Output: data/geojson/population_tracts.geojson
 *
 * Usage:
 *   node data/scripts/fetch_census.js
 */

const https = require("https");
const fs = require("fs");
const path = require("path");

// ── Config ────────────────────────────────────────────────────────────────────

const TIGER_URL =
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/10/query" +
  "?where=STATE%3D%2706%27+AND+COUNTY%3D%27037%27" +
  "&outFields=TRACT,CENTLAT,CENTLON,AREALAND,POP100,GEOID" +
  "&f=json" +
  "&returnGeometry=false" +
  "&resultRecordCount=3000";

const OUT_DIR = path.join(__dirname, "..", "geojson");
const OUT_FILE = path.join(OUT_DIR, "population_tracts.geojson");

// ── Helpers ───────────────────────────────────────────────────────────────────

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error("Failed to parse JSON: " + e.message));
          }
        });
      })
      .on("error", reject);
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Fetching LA County tract data from TIGER/Line (Census 2020)…");

  const data = await fetchJSON(TIGER_URL);

  if (data.error) {
    throw new Error(
      `TIGER API error ${data.error.code}: ${data.error.message}`
    );
  }

  const rawFeatures = data.features || [];
  console.log(`Received ${rawFeatures.length} tracts`);

  const features = rawFeatures.map((feat) => {
    const a = feat.attributes;

    const tractId = a.GEOID; // 11-digit FIPS (state+county+tract)
    const population = a.POP100 || 0;
    const lat = parseFloat(a.CENTLAT);
    const lon = parseFloat(a.CENTLON);

    // AREALAND is in square meters; convert to sq km
    const areaSqKm =
      a.AREALAND && a.AREALAND > 0 ? a.AREALAND / 1_000_000 : 2.0;

    const densityPerSqKm = areaSqKm > 0 ? Math.round(population / areaSqKm) : 0;

    return {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [
          Math.round(lon * 1e6) / 1e6,
          Math.round(lat * 1e6) / 1e6,
        ],
      },
      properties: {
        tract_id: tractId,
        population,
        density_per_sqkm: densityPerSqKm,
      },
    };
  });

  const geojson = {
    type: "FeatureCollection",
    features,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(geojson, null, 2));
  console.log(`Wrote ${features.length} features → ${OUT_FILE}`);

  // Quick sanity stats
  const pops = features.map((f) => f.properties.population);
  const total = pops.reduce((s, v) => s + v, 0);
  const maxDensity = Math.max(...features.map((f) => f.properties.density_per_sqkm));
  console.log(`Total population: ${total.toLocaleString()}`);
  console.log(`Max density: ${maxDensity.toLocaleString()} /sqkm`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
