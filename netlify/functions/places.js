// Netlify serverless function: fetches places from Overpass (OpenStreetMap)
// server-side, so the browser never hits CORS. Called by the app as /api/places
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.osm.ch/api/interpreter'
];

function buildQuery(lat, lon, radius) {
  const A = 'amenity~"cafe|restaurant|bar|pub|fast_food|ice_cream|cinema|theatre|nightclub|arts_centre|community_centre|casino|planetarium|spa|marketplace|food_court|biergarten"';
  const T = 'tourism~"museum|gallery|attraction|zoo|theme_park|aquarium|viewpoint|artwork"';
  const L = 'leisure~"park|garden|sports_centre|bowling_alley|fitness_centre|stadium|water_park|ice_rink|escape_game|amusement_arcade|dance|nature_reserve|marina|beach_resort|miniature_golf"';
  const S = 'shop~"books|music|art|bakery"';
  return `[out:json][timeout:25];(` +
    `nwr(around:${radius},${lat},${lon})[name][${A}];` +
    `nwr(around:${radius},${lat},${lon})[name][${T}];` +
    `nwr(around:${radius},${lat},${lon})[name][${L}];` +
    `nwr(around:${radius},${lat},${lon})[name][${S}];` +
    `);out center tags;`;
}

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };

  const p = event.queryStringParameters || {};
  const lat = parseFloat(p.lat), lon = parseFloat(p.lon), radius = parseInt(p.radius || '8000', 10);
  if (!isFinite(lat) || !isFinite(lon)) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'lat/lon required' }) };
  }

  const query = buildQuery(lat, lon, radius);
  for (const url of OVERPASS_ENDPOINTS) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 25000);
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'KudaApp/1.0' },
        body: 'data=' + encodeURIComponent(query),
        signal: controller.signal
      });
      clearTimeout(timer);
      if (!r.ok) continue;
      const text = await r.text();
      let j;
      try { j = JSON.parse(text); } catch (e) { continue; }
      if (j && Array.isArray(j.elements)) {
        return { statusCode: 200, headers: cors, body: JSON.stringify({ elements: j.elements, source: url }) };
      }
    } catch (e) { /* try next mirror */ }
  }
  return { statusCode: 502, headers: cors, body: JSON.stringify({ error: 'all overpass mirrors failed', elements: [] }) };
};
