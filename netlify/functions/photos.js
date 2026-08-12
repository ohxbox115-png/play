// Netlify serverless function: finds real photos of a place by its name + city.
// Uses open sources (Wikimedia Commons + Russian Wikipedia) — free, no API key.
// Called by the app as /api/photos?name=...&city=...
async function commonsPhotos(query) {
  try {
    const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrnamespace=6&gsrlimit=6&prop=imageinfo&iiprop=url|mime&iiurlwidth=1200&format=json&origin=*`;
    const r = await fetch(url, { headers: { 'User-Agent': 'KudaApp/1.0' } });
    if (!r.ok) return [];
    const j = await r.json();
    const pages = j.query && j.query.pages ? Object.values(j.query.pages) : [];
    return pages
      .map(p => p.imageinfo && p.imageinfo[0])
      .filter(Boolean)
      .filter(ii => /image\/(jpeg|png|webp)/i.test(ii.mime || ''))
      .map(ii => ii.thumburl || ii.url)
      .filter(Boolean);
  } catch (e) { return []; }
}

async function wikipediaPhoto(query) {
  try {
    // Search a Russian Wikipedia article and take its lead image, if any.
    const s = `https://ru.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=1&format=json&origin=*`;
    const rs = await fetch(s, { headers: { 'User-Agent': 'KudaApp/1.0' } });
    if (!rs.ok) return [];
    const js = await rs.json();
    const hit = js.query && js.query.search && js.query.search[0];
    if (!hit) return [];
    const t = `https://ru.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(hit.title)}&prop=pageimages&piprop=original|thumbnail&pithumbsize=1200&format=json&origin=*`;
    const rt = await fetch(t, { headers: { 'User-Agent': 'KudaApp/1.0' } });
    if (!rt.ok) return [];
    const jt = await rt.json();
    const pages = jt.query && jt.query.pages ? Object.values(jt.query.pages) : [];
    const out = [];
    pages.forEach(p => {
      if (p.original && p.original.source) out.push(p.original.source);
      else if (p.thumbnail && p.thumbnail.source) out.push(p.thumbnail.source);
    });
    return out;
  } catch (e) { return []; }
}

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=86400'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };

  const p = event.queryStringParameters || {};
  const name = (p.name || '').trim();
  const city = (p.city || '').trim();
  if (!name) return { statusCode: 400, headers: cors, body: JSON.stringify({ photos: [] }) };

  // Try a few query variants, most specific first.
  const queries = [
    `${name} ${city}`.trim(),
    name,
    `${name} кафе ${city}`.trim()
  ];

  let photos = [];
  for (const q of queries) {
    photos = await commonsPhotos(q);
    if (photos.length) break;
  }
  if (!photos.length) {
    for (const q of queries) {
      photos = await wikipediaPhoto(q);
      if (photos.length) break;
    }
  }

  // De-dup and cap.
  photos = [...new Set(photos)].slice(0, 5);
  return { statusCode: 200, headers: cors, body: JSON.stringify({ photos }) };
};
