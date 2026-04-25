const fs = require('fs');
const path = require('path');

const combinedPath = path.join(__dirname, '../geojson/combined_locations.geojson');
const outDir = path.join(__dirname, '../geojson');

const data = JSON.parse(fs.readFileSync(combinedPath, 'utf8'));
const features = data.features;

const hospitals = { type: 'FeatureCollection', features: [] };
const fireStations = { type: 'FeatureCollection', features: [] };
const shelters = { type: 'FeatureCollection', features: [] };

let hCount = 1;
let fCount = 1;
let sCount = 1;

features.forEach(f => {
  const type = f.properties.type;
  if (type === 'hospital') {
    f.properties.id = `hospital_${String(hCount++).padStart(4, '0')}`;
    hospitals.features.push(f);
  } else if (type === 'fire_station') {
    f.properties.id = `fire_station_${String(fCount++).padStart(4, '0')}`;
    fireStations.features.push(f);
  } else if (type === 'shelter') {
    f.properties.shelter_id = `S${String(sCount++).padStart(4, '0')}`;
    shelters.features.push(f);
  }
});

fs.writeFileSync(path.join(outDir, 'hospitals.geojson'), JSON.stringify(hospitals, null, 2));
fs.writeFileSync(path.join(outDir, 'fire_stations.geojson'), JSON.stringify(fireStations, null, 2));
fs.writeFileSync(path.join(outDir, 'shelters.geojson'), JSON.stringify(shelters, null, 2));

console.log(`Split complete:
- ${hospitals.features.length} hospitals
- ${fireStations.features.length} fire stations
- ${shelters.features.length} shelters`);
