/*
 * Area data: postcode lookup (postcodes.io), sold prices (HM Land Registry
 * Price Paid Data via SPARQL), optional live rents (PropertyData API) and
 * benchmark-based rent estimates when no rent API key is set.
 */
(function (root) {
  'use strict';

  const POSTCODES_API = 'https://api.postcodes.io';
  const LR_SPARQL = 'https://landregistry.data.gov.uk/landregistry/query';
  const PROPERTYDATA_API = 'https://api.propertydata.co.uk';

  // Fetch JSON directly; if the browser blocks it (CORS) and we're being served
  // by server.js, retry through its same-origin proxy.
  async function fetchJson(url, opts) {
    try {
      const res = await fetch(url, opts);
      if (!res.ok) throw httpError(res);
      return await res.json();
    } catch (err) {
      if (err.status || location.protocol === 'file:') throw err;
      const res = await fetch('/proxy?url=' + encodeURIComponent(url), opts);
      if (!res.ok) throw httpError(res);
      return await res.json();
    }
  }

  function httpError(res) {
    const e = new Error(`${res.status} ${res.statusText} from ${new URL(res.url, location.href).host}`);
    e.status = res.status;
    return e;
  }

  // ---------------------------------------------------------------------------
  // Postcodes
  // ---------------------------------------------------------------------------

  function normalisePostcode(pc) {
    const s = String(pc || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (s.length < 5) return s;
    return s.slice(0, -3) + ' ' + s.slice(-3);
  }

  async function lookupPostcode(pc) {
    const data = await fetchJson(`${POSTCODES_API}/postcodes/${encodeURIComponent(normalisePostcode(pc))}`);
    if (!data || !data.result) throw new Error('Postcode not found');
    return data.result;
  }

  async function nearbyPostcodes(lat, lon, radius) {
    const url = `${POSTCODES_API}/postcodes?lon=${lon}&lat=${lat}&radius=${radius}&limit=100`;
    const data = await fetchJson(url);
    return (data && data.result) || [];
  }

  // ---------------------------------------------------------------------------
  // Land Registry Price Paid Data (England & Wales)
  // ---------------------------------------------------------------------------

  const LR_TYPES = {
    detached: 'detached',
    'semi-detached': 'semi-detached',
    terraced: 'terraced',
    'flat-maisonette': 'flat',
    otherPropertyType: 'other',
  };

  function soldPricesQuery(postcodes, sinceIso) {
    const values = postcodes.map((p) => `"${p.replace(/"/g, '')}"^^xsd:string`).join(' ');
    return `PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
PREFIX lrppi: <http://landregistry.data.gov.uk/def/ppi/>
PREFIX lrcommon: <http://landregistry.data.gov.uk/def/common/>
SELECT ?pc ?paon ?saon ?street ?amount ?date ?type ?newBuild ?category WHERE {
  VALUES ?pc { ${values} }
  ?addr lrcommon:postcode ?pc .
  ?tx lrppi:propertyAddress ?addr ;
      lrppi:pricePaid ?amount ;
      lrppi:transactionDate ?date ;
      lrppi:propertyType ?type .
  OPTIONAL { ?tx lrppi:newBuild ?newBuild }
  OPTIONAL { ?tx lrppi:transactionCategory ?category }
  OPTIONAL { ?addr lrcommon:paon ?paon }
  OPTIONAL { ?addr lrcommon:saon ?saon }
  OPTIONAL { ?addr lrcommon:street ?street }
  FILTER (?date >= "${sinceIso}"^^xsd:date)
}
ORDER BY DESC(?date)
LIMIT 1000`;
  }

  async function soldPrices(postcodes, sinceIso) {
    const url = `${LR_SPARQL}?query=${encodeURIComponent(soldPricesQuery(postcodes, sinceIso))}`;
    const data = await fetchJson(url, { headers: { Accept: 'application/sparql-results+json' } });
    const rows = (data && data.results && data.results.bindings) || [];
    return rows
      .map((b) => {
        const v = (k) => (b[k] ? b[k].value : '');
        const typeKey = v('type').split('/').pop();
        return {
          postcode: v('pc'),
          address: [v('saon'), v('paon'), v('street')].filter(Boolean).join(' ').replace(/\s+/g, ' '),
          price: Number(v('amount')),
          date: v('date').slice(0, 10),
          type: LR_TYPES[typeKey] || 'other',
          newBuild: v('newBuild') === 'true',
          // Category B = repossessions, company / power-of-sale transfers etc.
          standard: !/additional/i.test(v('category')),
        };
      })
      .filter((r) => r.price > 0);
  }

  // ---------------------------------------------------------------------------
  // PropertyData (optional, needs the user's own API key)
  // ---------------------------------------------------------------------------

  function toMonthly(value, unit) {
    const v = Number(value);
    if (!Number.isFinite(v)) return NaN;
    return /week/i.test(unit || 'week') ? (v * 52) / 12 : v;
  }

  async function propertyDataRent(key, postcode, beds) {
    const url = `${PROPERTYDATA_API}/rents?key=${encodeURIComponent(key)}&postcode=${encodeURIComponent(postcode)}&bedrooms=${beds}`;
    const data = await fetchJson(url);
    if (data.status && data.status !== 'success') throw new Error(data.message || 'PropertyData error');
    const ll = (data.data && (data.data.long_let || data.data)) || {};
    return {
      monthly: toMonthly(ll.average, ll.unit),
      range: Array.isArray(ll['70pc_range']) ? ll['70pc_range'].map((x) => toMonthly(x, ll.unit)) : null,
      points: ll.points_analysed,
      radius: ll.radius,
    };
  }

  async function propertyDataRoomRent(key, postcode) {
    const url = `${PROPERTYDATA_API}/rents-hmo?key=${encodeURIComponent(key)}&postcode=${encodeURIComponent(postcode)}`;
    const data = await fetchJson(url);
    if (data.status && data.status !== 'success') throw new Error(data.message || 'PropertyData error');
    const avgs = Object.entries(data.data || {})
      .filter(([k, v]) => /double/i.test(k) && v && v.average)
      .map(([, v]) => toMonthly(v.average, v.unit));
    if (!avgs.length) throw new Error('No room rent data');
    return { monthly: avgs.reduce((a, b) => a + b, 0) / avgs.length };
  }

  // ---------------------------------------------------------------------------
  // Benchmark estimates (used when no rent API is configured)
  // ---------------------------------------------------------------------------

  // Approximate 2025/26 regional figures (ONS Price Index of Private Rents,
  // UK HPI, SpareRoom room-rent reports). Rounded; they only seed an estimate
  // that is then scaled by local sold prices.
  const REGIONS = {
    London: { rent: 2250, room: 1000, price: 525000 },
    'South East': { rent: 1450, room: 760, price: 385000 },
    'East of England': { rent: 1350, room: 700, price: 340000 },
    'South West': { rent: 1300, room: 680, price: 315000 },
    'West Midlands': { rent: 1050, room: 600, price: 250000 },
    'East Midlands': { rent: 1000, room: 580, price: 245000 },
    'North West': { rent: 1050, room: 600, price: 225000 },
    'Yorkshire and The Humber': { rent: 950, room: 560, price: 215000 },
    'North East': { rent: 750, room: 500, price: 165000 },
    Wales: { rent: 850, room: 540, price: 210000 },
    Scotland: { rent: 1050, room: 650, price: 190000 },
    'Northern Ireland': { rent: 974, room: 450, price: 185000 },
    Ireland: { rent: 1750, room: 800, price: 360000 },
  };

  // Regional average rent sits roughly at a 2-bed; scale by bedrooms.
  const BED_FACTOR = { 0: 0.62, 1: 0.78, 2: 0.95, 3: 1.1, 4: 1.4, 5: 1.7, 6: 2.0 };
  const TYPE_FACTOR = { flat: 0.97, terraced: 1.0, 'semi-detached': 1.06, detached: 1.15, other: 1.0 };

  function regionOf(pcInfo) {
    if (pcInfo.region && REGIONS[pcInfo.region]) return pcInfo.region;
    if (pcInfo.country && REGIONS[pcInfo.country]) return pcInfo.country;
    return null;
  }

  /**
   * Local adjustment: compare this area's median sold price to the regional
   * median. Rents move far less than prices between neighbourhoods, so the
   * ratio is damped (elasticity ~0.5 for whole units, ~0.35 for rooms).
   */
  function estimateRents({ region, localMedianPrice, beds, type }) {
    const r = REGIONS[region];
    if (!r) return null;
    const ratio = localMedianPrice > 0 ? Math.min(2.5, Math.max(0.4, localMedianPrice / r.price)) : 1;
    const b = BED_FACTOR[Math.min(6, Math.max(0, Math.round(beds)))];
    const fullLet = r.rent * b * (TYPE_FACTOR[type] || 1) * Math.pow(ratio, 0.5);
    const room = r.room * Math.pow(ratio, 0.35);
    return {
      fullLet: Math.round(fullLet / 25) * 25,
      room: Math.round(room / 10) * 10,
      localPriceRatio: ratio,
    };
  }

  // ---------------------------------------------------------------------------
  // Northern Ireland: NI Housing Executive private rent figures
  // ---------------------------------------------------------------------------

  // Average monthly rent, all property types, Jan–Jun 2025 (NIHE / Ulster
  // University "Performance of the Private Rental Market in Northern Ireland").
  // Room rents are a rough guide only: add listings to replace them.
  const NI_RENTS = {
    source: 'NIHE private rental report, Jan–Jun 2025',
    Belfast: { rent: 1130, room: 520 },
    other: { rent: 850, room: 430 },
  };

  function estimateNiRents({ district, beds, type }) {
    const r = /belfast/i.test(district || '') ? NI_RENTS.Belfast : NI_RENTS.other;
    // The all-property average sits around a 2–3 bed.
    const b = BED_FACTOR[Math.min(6, Math.max(0, Math.round(beds)))] / 1.02;
    return {
      fullLet: Math.round((r.rent * b * (TYPE_FACTOR[type] || 1)) / 25) * 25,
      room: Math.round(r.room / 10) * 10,
      area: /belfast/i.test(district || '') ? 'Belfast' : 'NI outside Belfast',
      source: NI_RENTS.source,
    };
  }

  // ---------------------------------------------------------------------------
  // Ireland: RTB Rent Index (rents on new tenancies registered with the
  // Residential Tenancies Board), published by the CSO as table RIA02.
  // ---------------------------------------------------------------------------

  const CSO_RIA02 = [
    'https://ws.cso.ie/public/api.restful/PxStat.Data.Cube_API.ReadDataset/RIA02/JSON-stat/2.0/en',
    'https://ws.cso.ie/public/api.restful/PxStat.Data.Cube_API.ReadDataset/RIA02/JSON-stat/1.0/en',
  ];
  let rtbCache = null;

  // Parse JSON-stat 1.0 or 2.0 into dimensions plus a value accessor.
  function parseJsonStat(json) {
    const ds = json.dataset || json;
    const dimObj = ds.dimension || {};
    const ids = ds.id || dimObj.id;
    const size = ds.size || dimObj.size;
    if (!ids || !size) throw new Error('Unexpected CSO response');
    const dims = ids.map((id) => {
      const cat = dimObj[id].category || {};
      const codes = Array.isArray(cat.index)
        ? cat.index
        : cat.index
          ? Object.keys(cat.index).sort((a, b) => cat.index[a] - cat.index[b])
          : Object.keys(cat.label || {});
      return { id, label: dimObj[id].label || id, codes, labels: codes.map((c) => (cat.label && cat.label[c]) || c) };
    });
    const strides = [];
    let acc = 1;
    for (let k = size.length - 1; k >= 0; k--) { strides[k] = acc; acc *= size[k]; }
    const values = ds.value;
    const get = (positions) => {
      let idx = 0;
      positions.forEach((p, k) => { idx += p * strides[k]; });
      const v = values[idx];
      return v === null || v === undefined || v === '' ? null : Number(v);
    };
    return { dims, get };
  }

  function bedKey(label) {
    const l = label.toLowerCase();
    if (/all|total/.test(l)) return 'all';
    if (/studio|bedsit/.test(l)) return 0;
    if (/four|\b4/.test(l)) return 4;
    if (/three|\b3/.test(l)) return 3;
    if (/two|\b2/.test(l)) return 2;
    if (/one|\b1/.test(l)) return 1;
    return null;
  }
  function typeKey(label) {
    const l = label.toLowerCase();
    if (/all|total/.test(l)) return 'all';
    if (/semi/.test(l)) return 'semi-detached';
    if (/detached/.test(l)) return 'detached';
    if (/terrace/.test(l)) return 'terraced';
    if (/flat|apartment/.test(l)) return 'flat';
    return 'other';
  }

  async function loadRtb() {
    if (rtbCache) return rtbCache;
    let json = null;
    let lastErr = null;
    for (const url of CSO_RIA02) {
      try { json = await fetchJson(url); break; } catch (e) { lastErr = e; }
    }
    if (!json) throw lastErr || new Error('CSO rent data unavailable');
    const { dims, get } = parseJsonStat(json);
    const find = (re) => dims.findIndex((d) => re.test(d.label) || re.test(d.id));
    const di = {
      stat: find(/statistic/i),
      time: find(/year|quarter|half|TLIST/i),
      beds: find(/bed/i),
      type: find(/property type/i),
      loc: find(/location|area|county/i),
    };
    if (di.time < 0 || di.loc < 0) throw new Error('CSO table layout not recognised');

    const pos = (overrides) => dims.map((d, k) => (k in overrides ? overrides[k] : 0));
    const locAll = dims[di.loc].labels;
    const bedsPos = (key) => (di.beds < 0 ? 0 : dims[di.beds].labels.findIndex((l) => bedKey(l) === key));
    const typePos = (key) => (di.type < 0 ? 0 : dims[di.type].labels.findIndex((l) => typeKey(l) === key));
    const allBeds = bedsPos('all');
    const allTypes = typePos('all');

    // Latest period with a national (or first location) figure.
    const nat = Math.max(0, locAll.findIndex((l) => /ireland|state|national/i.test(l)));
    let t = dims[di.time].codes.length - 1;
    const base = {};
    if (di.stat >= 0) base[di.stat] = 0;
    if (di.beds >= 0) base[di.beds] = Math.max(0, allBeds);
    if (di.type >= 0) base[di.type] = Math.max(0, allTypes);
    while (t > 0 && get(pos({ ...base, [di.time]: t, [di.loc]: nat })) === null) t--;

    function lookup(locLabel, beds, type) {
      const l = locAll.indexOf(locLabel);
      if (l < 0) return null;
      const b = Math.min(4, Math.max(0, Math.round(beds)));
      const tries = [
        [bedsPos(b), typePos(type), 'this size and type'],
        [bedsPos(b), allTypes, 'this size, all types'],
        [allBeds, typePos(type), 'all sizes of this type', true],
        [allBeds, allTypes, 'all sizes and types', true],
      ];
      for (const [bp, tp, basis, scale] of tries) {
        if ((di.beds >= 0 && bp < 0) || (di.type >= 0 && tp < 0)) continue;
        const o = { ...base, [di.time]: t, [di.loc]: l };
        if (di.beds >= 0) o[di.beds] = bp;
        if (di.type >= 0) o[di.type] = tp;
        const v = get(pos(o));
        if (v) {
          const factor = scale ? BED_FACTOR[Math.min(6, Math.max(0, Math.round(beds)))] / 1.02 : beds > 4 ? BED_FACTOR[Math.min(6, beds)] / BED_FACTOR[4] : 1;
          return { monthly: Math.round(v * factor), raw: v, basis };
        }
      }
      return null;
    }

    rtbCache = { period: dims[di.time].labels[t], locations: locAll, lookup };
    return rtbCache;
  }

  // Pick the RTB location that best matches what the user typed
  // (town, area, county or a Dublin Eircode like D06).
  function matchRtbLocation(input, locations) {
    let q = String(input || '').toLowerCase();
    const dub = q.match(/\bd(\d{2}|6w)\b/);
    if (dub) q += ' dublin ' + (dub[1] === '6w' ? '6w' : String(Number(dub[1])));
    const words = (s) => s.toLowerCase().replace(/co\.?\s/g, '').split(/[^a-z0-9]+/).filter(Boolean);
    const qWords = new Set(words(q));
    let best = null;
    let bestScore = 0;
    for (const loc of locations) {
      const w = words(loc);
      if (!w.length || /ireland|state|national/i.test(loc)) continue;
      const hits = w.filter((x) => qWords.has(x)).length;
      if (hits < w.length && !(hits && w[0] && qWords.has(w[0]))) continue;
      const score = hits * 10 + (hits === w.length ? 5 : 0) - w.length;
      if (score > bestScore) { bestScore = score; best = loc; }
    }
    return best;
  }

  // ---------------------------------------------------------------------------
  // Listing-site searches (opened in a new tab; the user copies results back)
  // ---------------------------------------------------------------------------

  function listingSearches({ area, beds, country }) {
    const q = (site, words) => `https://www.google.com/search?q=${encodeURIComponent(`${words} site:${site}`)}`;
    const bedWords = beds ? `${beds} bed` : '';
    const ie = country === 'Ireland';
    const list = ie
      ? [
          ['Daft.ie', q('daft.ie', `${bedWords} to rent ${area}`)],
          ['PropertyPal', q('propertypal.com', `${bedWords} to rent ${area}`)],
          ['MyHome.ie', q('myhome.ie', `${bedWords} to rent ${area}`)],
          ['Rent.ie', q('rent.ie', `${bedWords} ${area}`)],
          ['Rooms: Daft sharing', q('daft.ie/sharing', `room ${area}`)],
        ]
      : [
          ['PropertyPal', q('propertypal.com', `${bedWords} property to rent ${area}`)],
          ['Rightmove', q('rightmove.co.uk', `${bedWords} to rent ${area}`)],
          ['Zoopla', q('zoopla.co.uk', `${bedWords} to rent ${area}`)],
          ['Rooms: SpareRoom', q('spareroom.co.uk', `room to rent ${area}`)],
        ];
    return list.map(([label, url]) => ({ label, url }));
  }

  const api = {
    estimateNiRents,
    loadRtb,
    parseJsonStat,
    matchRtbLocation,
    listingSearches,
    normalisePostcode,
    lookupPostcode,
    nearbyPostcodes,
    soldPrices,
    soldPricesQuery,
    propertyDataRent,
    propertyDataRoomRent,
    estimateRents,
    regionOf,
    REGIONS,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DealData = api;
})(typeof window !== 'undefined' ? window : globalThis);
