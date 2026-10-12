// Fetch property news headlines (Google News RSS searches) into one JSON
// object. Used by the Pages workflow (writes news.json) and by server.js.
//   node scripts/news.js > news.json

const FEEDS = {
  ni: {
    label: 'Northern Ireland',
    url: rss('("Northern Ireland" OR Belfast) (rent OR rents OR landlord OR landlords OR "house prices" OR "property market" OR housing)', 'GB'),
  },
  ie: {
    label: 'Ireland',
    url: rss('Ireland (rent OR rents OR landlord OR landlords OR RTB OR "house prices" OR "property market" OR "rent pressure zone")', 'IE'),
  },
  uk: {
    label: 'UK landlords',
    url: rss('("buy to let" OR landlords OR "mortgage rates" OR "Renters Rights") UK', 'GB'),
  },
};

function rss(q, country) {
  const lang = country === 'IE' ? 'en-IE' : 'en-GB';
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q + ' when:14d')}&hl=${lang}&gl=${country}&ceid=${country}:en`;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decode(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
      if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/<[^>]+>/g, '')
    .trim();
}

function parseRss(xml, limit = 30) {
  const items = [];
  const seen = new Set();
  for (const m of String(xml).matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const tag = (name) => {
      const t = m[1].match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
      return t ? decode(t[1]) : '';
    };
    const source = tag('source');
    let title = tag('title');
    // Google News titles end with " - Source"
    if (source && title.endsWith(' - ' + source)) title = title.slice(0, -(source.length + 3));
    const key = title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!title || seen.has(key)) continue;
    seen.add(key);
    const date = new Date(tag('pubDate'));
    items.push({ title, link: tag('link'), source, date: Number.isNaN(date.getTime()) ? null : date.toISOString() });
  }
  return items.sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, limit);
}

async function fetchNews() {
  const out = { updated: new Date().toISOString(), feeds: {} };
  await Promise.all(Object.entries(FEEDS).map(async ([key, f]) => {
    try {
      const res = await fetch(f.url, { headers: { 'User-Agent': 'Mozilla/5.0 (deal-analyzer news)' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      out.feeds[key] = { label: f.label, items: parseRss(await res.text()) };
    } catch (e) {
      out.feeds[key] = { label: f.label, items: [], error: e.message };
    }
  }));
  return out;
}

module.exports = { fetchNews, parseRss, FEEDS };

if (require.main === module) {
  fetchNews().then((n) => process.stdout.write(JSON.stringify(n, null, 1)));
}
