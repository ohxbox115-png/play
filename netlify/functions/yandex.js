// Netlify serverless function: enriches a place using Yandex Places (Search) API.
// The Yandex API key lives in a Netlify environment variable (YANDEX_PLACES_KEY),
// so it is never exposed in the browser.
// Called by the app as /api/yandex?name=...&lat=...&lon=...
//
// Yandex Search API for Organizations docs:
// https://yandex.ru/dev/geosearch/doc/ru/

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=86400'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };

  const KEY = process.env.YANDEX_PLACES_KEY;
  if (!KEY) {
    return { statusCode: 200, headers: cors, body: JSON.stringify({ enriched: false, reason: 'no_key' }) };
  }

  const p = event.queryStringParameters || {};
  const name = (p.name || '').trim();
  const lat = parseFloat(p.lat), lon = parseFloat(p.lon);
  if (!name || !isFinite(lat) || !isFinite(lon)) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ enriched: false, reason: 'bad_params' }) };
  }

  try {
    // Bias the search around the place coordinates with a small bounding span.
    const span = '0.02,0.02';
    const ll = `${lon},${lat}`;
    const url = `https://search-maps.yandex.ru/v1/?text=${encodeURIComponent(name)}&ll=${ll}&spn=${span}&type=biz&lang=ru_RU&results=1&apikey=${KEY}`;
    const r = await fetch(url);
    if (!r.ok) {
      return { statusCode: 200, headers: cors, body: JSON.stringify({ enriched: false, reason: 'http_' + r.status }) };
    }
    const j = await r.json();
    const feat = j && j.features && j.features[0];
    if (!feat) {
      return { statusCode: 200, headers: cors, body: JSON.stringify({ enriched: false, reason: 'not_found' }) };
    }
    const meta = (feat.properties && feat.properties.CompanyMetaData) || {};
    const hours = meta.Hours && meta.Hours.text ? meta.Hours.text : '';
    const categories = (meta.Categories || []).map(c => c.name).filter(Boolean);
    const coords = feat.geometry && feat.geometry.coordinates; // [lon, lat]
    const out = {
      enriched: true,
      name: meta.name || name,
      address: meta.address || '',
      hours: hours || '',
      categories,
      phone: (meta.Phones && meta.Phones[0] && meta.Phones[0].formatted) || '',
      url: meta.url || '',
      lat: coords ? coords[1] : lat,
      lon: coords ? coords[0] : lon
    };
    return { statusCode: 200, headers: cors, body: JSON.stringify(out) };
  } catch (e) {
    return { statusCode: 200, headers: cors, body: JSON.stringify({ enriched: false, reason: 'error' }) };
  }
};
