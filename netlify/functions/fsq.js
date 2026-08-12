// Netlify serverless function: fetches places from Foursquare Places API.
// The key lives in a Netlify env var (FOURSQUARE_KEY) — never exposed to the browser.
// Called by the app as /api/fsq?lat=..&lon=..&radius=..&query=..
//
// Foursquare Places API docs: https://docs.foursquare.com/developer/reference/place-search

const CAT_MAP = [
  // Foursquare category id prefixes -> our human category + icon
  { re: /^130/, cat: 'ЕДА', ic: 'food' },          // Dining and Drinking > Restaurant
  { re: /^13032|^13034|^13035/, cat: 'КОФЕ', ic: 'coffee' }, // Cafe/Coffee
  { re: /^13003|^13018/, cat: 'БАР', ic: 'drink' }, // Bar / Pub
  { re: /^13006/, cat: 'СЛАДКОЕ', ic: 'ice' },      // Dessert
  { re: /^100/, cat: 'РАЗВЛЕЧЕНИЯ', ic: 'bowl' },   // Arts & Entertainment
  { re: /^10024/, cat: 'МУЗЕЙ', ic: 'art' },        // Museum
  { re: /^10027/, cat: 'ИСКУССТВО', ic: 'art' },    // Art Gallery
  { re: /^10032/, cat: 'КИНО', ic: 'film' },        // Movie Theater
  { re: /^10039/, cat: 'ТЕАТР', ic: 'film' },       // Theater
  { re: /^16/, cat: 'ПРОГУЛКА', ic: 'nature' },     // Landmarks & Outdoors
  { re: /^16032|^16033/, cat: 'ПРОГУЛКА', ic: 'nature' }, // Park
  { re: /^18/, cat: 'СПОРТ', ic: 'spark' },         // Sports & Recreation
  { re: /^18008/, cat: 'БОУЛИНГ', ic: 'bowl' },     // Bowling
  { re: /^17/, cat: 'КНИГИ', ic: 'book' }           // Retail (fallback for bookstores)
];

function mapCategory(cats) {
  const ids = (cats || []).map(c => String(c.id || ''));
  for (const c of ids) {
    for (const m of CAT_MAP) if (m.re.test(c)) return { cat: m.cat, ic: m.ic };
  }
  // Fallback by category name text
  const name = (cats && cats[0] && cats[0].name || '').toLowerCase();
  if (/co(f|ff)ee|caf/.test(name)) return { cat: 'КОФЕ', ic: 'coffee' };
  if (/bar|pub/.test(name)) return { cat: 'БАР', ic: 'drink' };
  if (/restaurant|food|pizz|sushi|burger/.test(name)) return { cat: 'ЕДА', ic: 'food' };
  if (/park|garden|trail/.test(name)) return { cat: 'ПРОГУЛКА', ic: 'nature' };
  if (/museum|gallery|art/.test(name)) return { cat: 'МУЗЕЙ', ic: 'art' };
  if (/cinema|movie|theat/.test(name)) return { cat: 'КИНО', ic: 'film' };
  return { cat: 'МЕСТО', ic: 'pin' };
}

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=1800'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };

  const KEY = process.env.FOURSQUARE_KEY;
  if (!KEY) return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: false, reason: 'no_key', places: [] }) };

  const p = event.queryStringParameters || {};

  // Safe diagnostic: /api/fsq?debug=1 shows key length + edges WITHOUT revealing the key.
  if (p.debug === '1') {
    const k = KEY || '';
    return { statusCode: 200, headers: cors, body: JSON.stringify({
      key_present: !!k,
      key_length: k.length,
      starts_with: k.slice(0, 2),
      ends_with: k.slice(-2),
      has_leading_space: k !== k.trimStart(),
      has_trailing_space: k !== k.trimEnd()
    }) };
  }

  const lat = parseFloat(p.lat), lon = parseFloat(p.lon);
  const radius = Math.min(parseInt(p.radius || '8000', 10), 100000);
  const query = (p.query || '').trim();
  if (!isFinite(lat) || !isFinite(lon)) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ ok: false, reason: 'bad_params', places: [] }) };
  }

  try {
    const params = new URLSearchParams({
      ll: `${lat},${lon}`,
      radius: String(radius),
      limit: '50',
      sort: 'DISTANCE'
    });
    if (query) params.set('query', query);

    // Foursquare changed its API. Try the NEW Places API first
    // (places-api.foursquare.com + Bearer + version header),
    // then fall back to the LEGACY one (api.foursquare.com/v3 + raw key).
    const attempts = [
      {
        url: 'https://places-api.foursquare.com/places/search?' + params.toString(),
        headers: {
          'Authorization': 'Bearer ' + KEY,
          'X-Places-Api-Version': '2025-06-17',
          'Accept': 'application/json'
        }
      },
      {
        url: 'https://api.foursquare.com/v3/places/search?' + params.toString(),
        headers: { 'Authorization': KEY, 'Accept': 'application/json' }
      }
    ];

    let j = null, lastStatus = 0, lastBody = '';
    const debugInfo = [];
    for (const a of attempts) {
      const r = await fetch(a.url, { headers: a.headers });
      if (r.ok) { j = await r.json(); break; }
      lastStatus = r.status;
      lastBody = (await r.text()).slice(0, 160);
      debugInfo.push({ host: a.url.split('/')[2], status: r.status, body: lastBody });
    }
    if (!j) {
      return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: false, reason: 'http_' + lastStatus, attempts: debugInfo, places: [] }) };
    }

    const results = j.results || j.places || [];
    const places = results.map(it => {
      const { cat, ic } = mapCategory(it.categories);
      const loc = it.location || {};
      const address = [loc.address, loc.locality].filter(Boolean).join(', ') || loc.formatted_address || '';
      const photos = (it.photos || []).slice(0, 5).map(ph => `${ph.prefix}800x600${ph.suffix}`);
      const hours = (it.hours && it.hours.display) || '';
      const fid = it.fsq_place_id || it.fsq_id || '';
      const g = it.geocodes && it.geocodes.main;
      return {
        id: 'fsq-' + fid,
        place: it.name || '',
        address,
        cat, ic,
        hours,
        rating: it.rating ? String(it.rating) : '',
        photos,
        website: it.website || '',
        tel: it.tel || '',
        lat: (g && g.latitude) || (loc.lat) || lat,
        lon: (g && g.longitude) || (loc.lon) || lon
      };
    }).filter(x => x.place);

    return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true, places }) };
  } catch (e) {
    return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: false, reason: 'error', detail: String(e).slice(0, 200), places: [] }) };
  }
};
