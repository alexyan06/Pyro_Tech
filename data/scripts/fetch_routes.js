#!/usr/bin/env node
/**
 * fetch_routes.js
 * ---------------
 * Fetches major road geometries for LA County from the Overpass API
 * (OpenStreetMap data, ODbL license) and converts them into an
 * evacuation-route GeoJSON FeatureCollection.
 *
 * Usage:
 *   node fetch_routes.js
 *
 * Output:
 *   ../geojson/evacuation_routes.geojson
 *
 * Data source:
 *   Overpass API  https://overpass-api.de/api/interpreter
 *   OSM copyright https://www.openstreetmap.org/copyright
 *   License       Open Database Licence (ODbL) v1.0
 *
 * Query:
 *   [out:json][timeout:30];
 *   (
 *     way["highway"~"^(motorway|trunk|primary)$"](33.7,-118.95,34.35,-117.65);
 *   );
 *   out geom;
 *
 * LA County bounding box:
 *   south=33.7, north=34.35, west=-118.95, east=-117.65
 */

const https = require("https");
const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const BBOX = { south: 33.7, north: 34.35, west: -118.95, east: -117.65 };
const OUT_PATH = path.join(__dirname, "../geojson/evacuation_routes.geojson");

const OVERPASS_QUERY = `[out:json][timeout:30];
(
  way["highway"~"^(motorway|trunk|primary)$"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
);
out geom;`;

// Mapping from OSM highway tag → priority tier used in the output schema
const PRIORITY_MAP = {
  motorway: "primary",
  trunk: "primary",
  primary: "secondary",
};

// Approximate capacities (vehicles per hour, single direction)
const CAPACITY_MAP = {
  motorway: 4800,
  trunk: 3200,
  primary: 2400,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** POST body to Overpass and return parsed JSON */
function fetchOverpass(query) {
  return new Promise((resolve, reject) => {
    const body = `data=${encodeURIComponent(query)}`;
    const options = {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
        "User-Agent": "Ember/1.0 LAHacks2026 (wildfire evacuation app)",
      },
    };

    const req = https.request(OVERPASS_URL, options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error("Failed to parse Overpass response: " + e.message));
        }
      });
    });

    req.on("error", reject);
    req.setTimeout(35000, () => {
      req.destroy();
      reject(new Error("Overpass request timed out"));
    });

    req.write(body);
    req.end();
  });
}

/**
 * Convert an OSM way element (with `geometry` array of {lat,lon}) into a
 * GeoJSON Feature with LineString geometry.
 *
 * Ways with fewer than 2 geometry nodes are skipped.
 */
function wayToFeature(way, index) {
  const geom = way.geometry || [];
  if (geom.length < 2) return null;

  // Ensure at least 3 coordinate pairs (pad by repeating the last point if
  // the way only has exactly 2 nodes — extremely rare for real roads).
  const coords = geom.map(({ lon, lat }) => [lon, lat]);
  if (coords.length === 2) coords.push([...coords[coords.length - 1]]);

  const tags = way.tags || {};
  const hwType = tags.highway || "primary";
  const name = tags.name || tags["name:en"] || `Unnamed ${hwType}`;
  const ref = tags.ref || "";

  const routeId = `R${String(index + 1).padStart(3, "0")}`;

  // Infer evacuation direction from the road name / ref (heuristic)
  const direction = "evacuation_out";

  return {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: coords,
    },
    properties: {
      route_id: routeId,
      osm_id: way.id,
      name: ref ? `${name} (${ref})` : name,
      highway: hwType,
      status: "open",
      capacity_vph: CAPACITY_MAP[hwType] || 2400,
      direction,
      priority: PRIORITY_MAP[hwType] || "secondary",
    },
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("Fetching road data from Overpass API …");
  console.log(`Query bbox: ${JSON.stringify(BBOX)}`);

  let osmData;
  try {
    osmData = await fetchOverpass(OVERPASS_QUERY);
  } catch (err) {
    console.error("Overpass fetch failed:", err.message);
    process.exit(1);
  }

  const ways = (osmData.elements || []).filter((el) => el.type === "way");
  console.log(`Received ${ways.length} ways from Overpass.`);

  const features = ways
    .map((way, i) => wayToFeature(way, i))
    .filter(Boolean);

  console.log(`Converted ${features.length} ways to GeoJSON features.`);

  const geojson = {
    type: "FeatureCollection",
    metadata: {
      generated: new Date().toISOString(),
      source: "OpenStreetMap via Overpass API",
      license: "ODbL 1.0 — https://opendatacommons.org/licenses/odbl/",
      bbox: BBOX,
      description:
        "LA County evacuation routes — motorway, trunk, and primary roads",
    },
    features,
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(geojson, null, 2));
  console.log(`Written to ${OUT_PATH}`);
  console.log(`Total features: ${features.length}`);
}

main();
