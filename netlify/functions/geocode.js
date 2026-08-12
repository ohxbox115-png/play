// Netlify serverless function: resolves a city name to coordinates, server-side.
// Tries Nominatim first, then Photon. Called by the app as /api/geocode?q=CityName
exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };

  const q = ((event.queryStringParameters || {}).q || '').trim();
  if (q.length < 2) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'q required' }) };
  }

  // 1) Nominatim
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&addressdetails=1&accept-language=ru&q=${encodeURIComponent(q)}`,
      { headers: { 'User-Agent': 'KudaApp/1.0 (contact: kuda-app)', 'Accept': 'application/json' } }
    );
    if (r.ok) {
      const data = await r.json();
      const allowed = ['city', 'town', 'village', 'hamlet', 'municipality', 'locality', 'administrative'];
      const x = data.find(d => allowed.includes(String(d.type || '').toLowerCase()) && d.lat && d.lon) || data.find(d => d.lat && d.lon);
      if (x) {
        const a = x.address || {};
        return {
          statusCode: 200, headers: cors,
          body: JSON.stringify({
            name: a.city || a.town || a.village || a.hamlet || a.municipality || a.locality || q,
            lat: +x.lat, lon: +x.lon, display: x.display_name
          })
        };
      }
    }
  } catch (e) { /* fall through */ }

  // 2) Photon (komoot)
  try {
    const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&lang=ru&limit=8`);
    if (r.ok) {
      const data = await r.json();
      const feats = (data.features || []).filter(f => f.geometry && f.geometry.coordinates);
      const pick = feats.find(f => ['city', 'town', 'village', 'hamlet', 'municipality'].includes((f.properties || {}).osm_value)) || feats[0];
      if (pick) {
        const c = pick.geometry.coordinates, pr = pick.properties || {};
        return {
          statusCode: 200, headers: cors,
          body: JSON.stringify({
            name: pr.name || q, lat: +c[1], lon: +c[0],
            display: [pr.name, pr.state, pr.country].filter(Boolean).join(', ')
          })
        };
      }
    }
  } catch (e) { /* both failed */ }

  return { statusCode: 404, headers: cors, body: JSON.stringify({ error: 'not found' }) };
};
