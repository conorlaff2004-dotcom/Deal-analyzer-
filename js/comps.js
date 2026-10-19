/*
 * Rent comparables: read rents out of text copied from listing sites
 * (PropertyPal, Daft, Rightmove, SpareRoom, ...) and summarise the ones you
 * keep. Pure functions only, so they can be tested in Node.
 */
(function (root) {
  'use strict';

  const PERIOD_MONTH = /^(pcm|per\s*(?:calendar\s*)?month|\/\s*(?:month|mth|mo)|a\s*month|p\/?m|pm|monthly|per\s*mth)$/i;
  const PERIOD_WEEK = /^(pw|per\s*week|\/\s*(?:week|wk)|a\s*week|p\/?w|weekly)$/i;
  const PRICE_RE = /([£€])\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?\s*(pcm|per\s*(?:calendar\s*)?month|\/\s*(?:month|mth|mo)\b|a\s*month|p\/?m\b|pm\b|monthly|per\s*mth|pw\b|per\s*week|\/\s*(?:week|wk)\b|a\s*week|p\/?w\b|weekly)?/gi;
  const NOT_RENT = /(deposit|holding|fee|bond|asking price|offers? (?:over|around)|guide price|sale|sold|council tax|rates|per annum|p\.?a\.?|reduced from|was)\s*[:\-]?\s*$/i;

  const ROOM_RE = /\b(double room|single room|en-?suite room|room to rent|room in|rooms? available|house ?share|flat ?share|sharing|lodger|digs)\b/i;
  const BEDS_RE = /(\d+)\s*(?:-|\s)?(?:bed(?:room)?s?|br)\b/i;
  const STUDIO_RE = /\b(studio|bedsit)\b/i;
  const TYPE_RES = [
    ['semi-detached', /\bsemi[-\s]?detached\b/i],
    ['detached', /\bdetached\b/i],
    ['terraced', /\b(?:end[-\s]of[-\s])?terrace(?:d)?\b|\btownhouse\b/i],
    ['flat', /\b(apartment|flat|maisonette|duplex|penthouse)\b/i],
  ];
  const UK_PC = /\b(BT|[A-Z]{1,2})\d{1,2}[A-Z]?(?:\s*\d[A-Z]{2})?\b/;
  const EIRCODE = /\b(?:[AC-FHKNPRTV-Y]\d{2}|D6W)(?:\s?[0-9AC-FHKNPRTV-Y]{4})?\b/;
  const DATE_RE = /(?:added|listed|posted|reduced|available|let agreed|sold(?: on)?|sale agreed|completed)[^\d\n]{0,12}(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/i;

  // ---------------------------------------------------------------------------
  // Areas: rents are grouped by postcode district (BT12, M14) or, in Ireland,
  // Eircode routing key (D06, W91).
  // ---------------------------------------------------------------------------

  const FULL_UK_PC = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*\d[A-Z]{2}\b/i;
  const BT_DISTRICT = /\bBT\s?(\d{1,2})\b/i;
  const EIR_KEY = /\b([AC-FHKNPRTV-Y]\d{2}|D6W)(?:\s?[0-9AC-FHKNPRTV-Y]{4})\b/i;
  const DUBLIN_N = /\bDublin\s*(\d{1,2}w?)\b/i;

  function normaliseDistrict(d) {
    let s = String(d || '').toUpperCase().replace(/\s+/g, '');
    const dub = s.match(/^D(\d)(W?)$/);
    if (dub) s = `D0${dub[1]}${dub[2]}`;
    if (s === 'D06W') s = 'D6W';
    return s;
  }

  /** Postcode district / Eircode routing key mentioned in some text, or ''. */
  function extractDistrict(text) {
    const t = String(text || '');
    let m = t.match(FULL_UK_PC);
    if (m && !EIR_KEY.test(m[0])) return normaliseDistrict(m[1]);
    m = t.match(BT_DISTRICT);
    if (m) return 'BT' + Number(m[1]);
    m = t.match(EIR_KEY);
    if (m) return normaliseDistrict(m[1]);
    m = t.match(DUBLIN_N);
    if (m) return normaliseDistrict('D' + m[1]);
    return '';
  }

  /** District for what the user typed in the postcode box (full or partial). */
  function districtOf(input) {
    const t = String(input || '').trim().toUpperCase();
    const full = t.match(/^([A-Z]{1,2}\d[A-Z\d]?)\s*\d[A-Z]{2}$/);
    if (full) return full[1];
    const eir = t.match(/^([AC-FHKNPRTV-Y]\d{2}|D6W)(\s*[0-9AC-FHKNPRTV-Y]{4})?$/);
    if (eir) return normaliseDistrict(eir[1]);
    const part = t.match(/^([A-Z]{1,2}\d[A-Z\d]?)$/);
    if (part) return part[1];
    return extractDistrict(t);
  }

  function toMonthly(amount, period) {
    if (period && PERIOD_WEEK.test(period.trim())) return Math.round((amount * 52) / 12);
    return amount;
  }

  /**
   * Find rents in pasted text. Returns one entry per listing-looking price:
   * { rent (per month), currency, beds, kind ('whole'|'room'), type, address, date, status }
   */
  function parseListings(text, opts) {
    opts = opts || {};
    const today = opts.today || new Date().toISOString().slice(0, 10);
    text = String(text || '').replace(/ /g, ' ');
    const matches = [];
    let m;
    PRICE_RE.lastIndex = 0;
    while ((m = PRICE_RE.exec(text))) {
      const before = text.slice(Math.max(0, m.index - 30), m.index);
      const amount = Number(m[2].replace(/,/g, ''));
      const rent = toMonthly(amount, m[3]);
      if (NOT_RENT.test(before)) continue;
      if (rent < 150 || rent > 15000) continue; // not a monthly residential rent
      // "£950 pcm (£219 pw)": the second price restates the first
      const prev = matches[matches.length - 1];
      if (prev && m.index - prev.end < 40 && !/\n/.test(text.slice(prev.end, m.index))) continue;
      matches.push({ start: m.index, end: m.index + m[0].length, rent, currency: m[1] === '€' ? 'EUR' : 'GBP' });
    }

    const wins = splitWindows(text, matches);
    const out = [];
    const seen = new Set();
    matches.forEach((p, i) => {
      const win = wins[i];
      const kind = ROOM_RE.test(win) ? 'room' : 'whole';
      let beds = null;
      const b = win.match(BEDS_RE);
      if (b) beds = Number(b[1]);
      else if (STUDIO_RE.test(win)) beds = 0;
      if (beds !== null && beds > 12) beds = null;
      const type = (TYPE_RES.find(([, re]) => re.test(win)) || [''])[0];
      const status = /let agreed/i.test(win) ? 'let agreed' : 'listed';

      const date = readDate(win, today);

      const address = guessAddress(win);
      const key = `${p.rent}|${beds}|${kind}|${address}`;
      if (seen.has(key)) return; // same listing pasted twice / price repeated on a detail page
      seen.add(key);
      const district = extractDistrict(address) || extractDistrict(win);
      out.push({ rent: p.rent, currency: p.currency, beds, kind, type, address, district, date, status });
    });
    return out;
  }

  // Split text into one window per price: the text between consecutive prices
  // is divided at the first blank line if there is one, otherwise halfway
  // through the lines.
  function splitWindows(text, matches) {
    const cuts = [];
    for (let i = 1; i < matches.length; i++) {
      const a = matches[i - 1].end;
      const gap = text.slice(a, matches[i].start);
      const blank = gap.search(/\n[ \t]*\n/);
      if (blank >= 0) cuts.push(a + blank + 1);
      else {
        const nl = [...gap.matchAll(/\n/g)].map((x) => x.index);
        cuts.push(nl.length ? a + nl[Math.floor((nl.length - 1) / 2)] : a + Math.floor(gap.length / 2));
      }
    }
    return matches.map((p, i) => text.slice(
      i > 0 ? cuts[i - 1] : Math.max(0, p.start - 400),
      i < matches.length - 1 ? cuts[i] : Math.min(text.length, p.end + 400)));
  }

  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const NAMED_DATE = /\b(?:(\d{1,2})(?:st|nd|rd|th)?\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+(\d{4})\b/i;
  const PLAIN_DATE = /\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})\b/;

  // A date in the window: one next to added/listed/sold etc. first, then any
  // dd/mm/yyyy or "12 Mar 2025" / "March 2025".
  function readDate(win, fallback) {
    const iso = (y, m, d) => {
      y = Number(y); if (y < 100) y += 2000;
      const s = `${y}-${String(m).padStart(2, '0')}-${String(d || 1).padStart(2, '0')}`;
      return Number.isNaN(new Date(s).getTime()) || Number(m) > 12 ? null : s;
    };
    let d = win.match(DATE_RE);
    if (d) { const r = iso(d[3], d[2], d[1]); if (r) return r; }
    d = win.match(NAMED_DATE);
    if (d) { const r = iso(d[3], MONTHS.indexOf(d[2].toLowerCase().slice(0, 3)) + 1, d[1]); if (r) return r; }
    d = win.match(PLAIN_DATE);
    if (d) { const r = iso(d[3], d[2], d[1]); if (r) return r; }
    return fallback;
  }

  function describe(win) {
    let beds = null;
    const b = win.match(BEDS_RE);
    if (b) beds = Number(b[1]);
    else if (STUDIO_RE.test(win)) beds = 0;
    if (beds !== null && beds > 12) beds = null;
    const type = (TYPE_RES.find(([, re]) => re.test(win)) || [''])[0];
    const address = guessAddress(win);
    const district = extractDistrict(address) || extractDistrict(win);
    return { beds, type, address, district };
  }

  // ---------------------------------------------------------------------------
  // Sold prices: read sale prices out of text copied from sold listings
  // (PropertyPal / PropertyNews sold, Daft, Property Price Register, Rightmove).
  // ---------------------------------------------------------------------------

  const SALE_RE = /([£€])\s?(\d{1,3}(?:,\d{3})+|\d{5,7})(?:\.\d{2})?(\s*(?:pcm|per\s*month|pw|per\s*week|p\/?m\b|\/\s*month|\/\s*week|monthly|weekly))?/gi;
  const NOT_SALE = /(deposit|rent|stamp duty|fees?|saving|reduced by|budget)\s*[:\-]?\s*(?:of\s*)?$/i;

  function parseSales(text, opts) {
    opts = opts || {};
    const today = opts.today || new Date().toISOString().slice(0, 10);
    text = String(text || '').replace(/\u00a0/g, ' ');
    const matches = [];
    let m;
    SALE_RE.lastIndex = 0;
    while ((m = SALE_RE.exec(text))) {
      if (m[3]) continue; // a rent
      const price = Number(m[2].replace(/,/g, ''));
      if (price < 15000 || price > 10000000) continue;
      if (NOT_SALE.test(text.slice(Math.max(0, m.index - 30), m.index))) continue;
      const prev = matches[matches.length - 1];
      // "Sold £150,000 (asking £155,000)": keep the first price on the line
      if (prev && m.index - prev.end < 60 && !/\n/.test(text.slice(prev.end, m.index))) continue;
      matches.push({ start: m.index, end: m.index + m[0].length, price, currency: m[1] === '€' ? 'EUR' : 'GBP' });
    }
    const wins = splitWindows(text, matches);
    const out = [];
    const seen = new Set();
    matches.forEach((p, i) => {
      const win = wins[i];
      const info = describe(win);
      const status = /sale agreed|under offer|sstc|subject to contract/i.test(win) ? 'sale agreed'
        : /\bsold\b/i.test(win) ? 'sold' : opts.defaultStatus || 'sold';
      const key = `${p.price}|${info.address}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ price: p.price, currency: p.currency, ...info, date: readDate(win, today), status });
    });
    return out;
  }

  /**
   * Sold prices for the subject property, narrowest match first:
   * same bedrooms and type, same bedrooms, same type, everything.
   */
  function summariseSales(sales, { beds, type, months = 24, today, currency, districts = null } = {}) {
    const want = districts ? new Set(districts.map(normaliseDistrict)) : null;
    const recent = sales.filter((c) =>
      withinMonths(c.date, months, today) &&
      (!currency || !c.currency || c.currency === currency) &&
      (!want || want.has(normaliseDistrict(c.district))));
    const sameBeds = (c) => Number(c.beds) === Number(beds);
    const sameType = (c) => c.type === type;
    return {
      recentCount: recent.length,
      bedsAndType: priceStats(recent.filter((c) => sameBeds(c) && sameType(c))),
      sameBeds: priceStats(recent.filter(sameBeds)),
      sameType: priceStats(recent.filter(sameType)),
      all: priceStats(recent),
    };
  }

  function summariseSalesByDistrict(sales, opts = {}) {
    const names = Array.from(new Set(sales.map((c) => normaliseDistrict(c.district))));
    return names
      .map((d) => ({ district: d, ...summariseSales(sales, { ...opts, districts: [d] }) }))
      .filter((r) => r.recentCount > 0)
      .sort((a, b) => b.sameBeds.count - a.sameBeds.count || b.recentCount - a.recentCount || a.district.localeCompare(b.district, 'en', { numeric: true }));
  }

  function quantile(sorted, q) {
    if (!sorted.length) return NaN;
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }

  function priceStats(list) {
    const v = list.map((c) => Number(c.price)).filter((x) => x > 0).sort((a, b) => a - b);
    return { count: v.length, median: quantile(v, 0.5), lowerQuartile: quantile(v, 0.25), upperQuartile: quantile(v, 0.75), min: v[0], max: v[v.length - 1] };
  }

  function guessAddress(win) {
    const lines = win.split(/\n|\s{3,}|\|/).map((l) => l.trim()).filter(Boolean);
    const clean = (l) => l.replace(/[£€]\s?[\d,]+.*$/, '').trim();
    const looksLikeAddress = (l) =>
      l.length >= 6 && l.length <= 110 && !/[£€]/.test(l) && /[a-z]/i.test(l) &&
      (UK_PC.test(l) || EIRCODE.test(l) || /,/.test(l) || /\b(road|rd|street|st|avenue|ave|park|drive|gardens|close|lane|way|crescent|terrace|place|court|square|hill|grove|view|manor)\b/i.test(l)) &&
      (UK_PC.test(l) || EIRCODE.test(l) || !/\b(bed|bath|reception|added|listed|deposit|available|epc|furnished)\b/i.test(l));
    const hit = lines.find(looksLikeAddress);
    return hit ? clean(hit).replace(/^\d+\s*bed(room)?s?\s+[a-z -]*?,\s*/i, '').slice(0, 100) : '';
  }

  // ---------------------------------------------------------------------------
  // Summaries
  // ---------------------------------------------------------------------------

  function median(values) {
    const s = values.slice().sort((a, b) => a - b);
    if (!s.length) return NaN;
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  function withinMonths(dateIso, months, today) {
    const d = new Date(dateIso);
    const cutoff = new Date(today || Date.now());
    cutoff.setMonth(cutoff.getMonth() - months);
    return !Number.isNaN(d.getTime()) && d >= cutoff;
  }

  /**
   * Summarise saved comparables for the subject property.
   * Whole-property rents for the same bedroom count; rooms separately.
   * `districts`: only rents tagged with one of these areas (null = every area).
   */
  function summariseComps(comps, { beds, months = 12, today, currency, districts = null } = {}) {
    const want = districts ? new Set(districts.map(normaliseDistrict)) : null;
    const recent = comps.filter((c) =>
      withinMonths(c.date, months, today) &&
      (!currency || !c.currency || c.currency === currency) &&
      (!want || want.has(normaliseDistrict(c.district))));
    const whole = recent.filter((c) => c.kind !== 'room');
    const sameBeds = whole.filter((c) => Number(c.beds) === Number(beds));
    const rooms = recent.filter((c) => c.kind === 'room');
    const stats = (list) => {
      const v = list.map((c) => Number(c.rent)).filter((x) => x > 0);
      return { count: v.length, median: median(v), min: Math.min(...v), max: Math.max(...v) };
    };
    return { recentCount: recent.length, sameBeds: stats(sameBeds), allWhole: stats(whole), rooms: stats(rooms) };
  }

  /** One summary per area, busiest first. Untagged rents are grouped under ''. */
  function summariseByDistrict(comps, opts = {}) {
    const names = Array.from(new Set(comps.map((c) => normaliseDistrict(c.district))));
    return names
      .map((d) => ({ district: d, ...summariseComps(comps, { ...opts, districts: [d] }) }))
      .filter((r) => r.recentCount > 0)
      .sort((a, b) => b.sameBeds.count - a.sameBeds.count || b.recentCount - a.recentCount || a.district.localeCompare(b.district, 'en', { numeric: true }));
  }

  // ---------------------------------------------------------------------------
  // CSV in / out
  // ---------------------------------------------------------------------------

  const CSV_COLS = ['date', 'address', 'district', 'beds', 'kind', 'type', 'rent', 'currency', 'status', 'source', 'link'];
  const SALE_COLS = ['date', 'address', 'district', 'beds', 'type', 'price', 'currency', 'status', 'source', 'link'];

  function toCsv(comps, cols = CSV_COLS) {
    const esc = (v) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [cols.join(','), ...comps.map((c) => cols.map((k) => esc(c[k])).join(','))].join('\n');
  }

  function fromCsv(text, cols = CSV_COLS) {
    const rows = [];
    let row = [];
    let field = '';
    let q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') q = false;
        else field += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field); rows.push(row); row = []; field = '';
      } else field += ch;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    const [head, ...body] = rows.filter((r) => r.some((x) => x.trim()));
    if (!head) return [];
    const idx = head.map((h) => h.trim().toLowerCase());
    return body.map((r) => {
      const o = {};
      idx.forEach((k, j) => { if (cols.includes(k)) o[k] = r[j]; });
      if (cols === SALE_COLS) {
        o.price = Number(o.price);
        o.beds = o.beds === '' || o.beds === undefined ? null : Number(o.beds);
        o.district = normaliseDistrict(o.district) || extractDistrict(o.address);
        return o;
      }
      o.rent = Number(o.rent);
      o.beds = o.beds === '' || o.beds === undefined ? null : Number(o.beds);
      o.kind = o.kind === 'room' ? 'room' : 'whole';
      o.district = normaliseDistrict(o.district) || extractDistrict(o.address);
      return o;
    }).filter((o) => (cols === SALE_COLS ? o.price : o.rent) > 0);
  }

  // ---------------------------------------------------------------------------
  // Built-in let-agreed rents (js/rent-data.js): averages by area and size,
  // grouped the same way as the source spreadsheet.
  // ---------------------------------------------------------------------------

  const RENT_GROUPS = ['1', '2', '3', '4', '5', '6+', 'room'];

  function rentGroup(beds) {
    if (beds === 'room') return 'room';
    const b = Math.max(1, Math.round(Number(beds) || 0)); // studios sit with 1-beds
    return b >= 6 ? '6+' : String(b);
  }

  function summariseRentData(listings, district) {
    const d = normaliseDistrict(district);
    const mine = listings.filter((l) => normaliseDistrict(l.district) === d);
    const groups = {};
    for (const g of RENT_GROUPS) {
      const v = mine.filter((l) => rentGroup(l.beds) === g).map((l) => Number(l.rent));
      groups[g] = v.length
        ? { count: v.length, average: v.reduce((a, b) => a + b, 0) / v.length, min: Math.min(...v), max: Math.max(...v), median: median(v) }
        : { count: 0 };
    }
    return { district: d, count: mine.length, groups };
  }

  const api = { rentGroup, summariseRentData, RENT_GROUPS, parseListings, parseSales, summariseSales, summariseSalesByDistrict, SALE_COLS, summariseComps, summariseByDistrict, extractDistrict, districtOf, normaliseDistrict, median, toCsv, fromCsv, withinMonths };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DealComps = api;
})(typeof window !== 'undefined' ? window : globalThis);
