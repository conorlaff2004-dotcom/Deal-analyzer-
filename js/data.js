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
    'Northern Ireland': { rent: 900, room: 480, price: 185000 },
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

  const api = {
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
