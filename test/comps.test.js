const test = require('node:test');
const assert = require('node:assert/strict');
const { parseListings, summariseComps, toCsv, fromCsv } = require('../js/comps.js');
const { parseJsonStat, matchRtbLocation, estimateNiRents } = require('../js/data.js');
const { propertyTax, analyseDeal } = require('../js/calc.js');

const PASTE = `3 Bed Semi-detached House
12 Malone Avenue, Belfast, BT9 6EN
£1,150 pcm (£265 pw)
Added on 03/09/2025
Deposit £1,150

Apartment to rent
Flat 4, 21 Ormeau Road, Belfast BT7
£850 pcm
2 bedrooms, 1 bathroom
Let agreed

Double room in shared house
Lisburn Road, Belfast BT9
£95 pw`;

test('reads rents, beds, type, dates and rooms from pasted listings', () => {
  const r = parseListings(PASTE, { today: '2025-10-01' });
  assert.equal(r.length, 3);
  assert.deepEqual([r[0].rent, r[0].beds, r[0].type, r[0].date, r[0].kind], [1150, 3, 'semi-detached', '2025-09-03', 'whole']);
  assert.equal(r[0].address, '12 Malone Avenue, Belfast, BT9 6EN');
  assert.deepEqual([r[1].rent, r[1].beds, r[1].status, r[1].kind], [850, 2, 'let agreed', 'whole']);
  assert.deepEqual([r[2].rent, r[2].kind], [412, 'room']); // £95 pw
});

test('search results without blank lines and euro rents', () => {
  const r = parseListings('Ormeau Road, Belfast BT7\n2 Bed Apartment\n£900 pcm\nCastle Street, Lisburn BT27\n3 bed terrace\n£950 pcm', {});
  assert.deepEqual(r.map((x) => [x.rent, x.beds, x.type]), [[900, 2, 'flat'], [950, 3, 'terraced']]);
  const ie = parseListings('Main Street, Naas, Co. Kildare\n3 Bed House\n€2,100 per month', {});
  assert.equal(ie[0].currency, 'EUR');
  assert.equal(ie[0].rent, 2100);
});

test('ignores deposits and sale prices', () => {
  assert.equal(parseListings('Deposit: £1,200\nAsking price £250,000', {}).length, 0);
});

test('summarises last 12 months by bedrooms and rooms', () => {
  const comps = [
    { date: '2025-09-01', beds: 3, kind: 'whole', rent: 1000, currency: 'GBP' },
    { date: '2025-06-01', beds: 3, kind: 'whole', rent: 1100, currency: 'GBP' },
    { date: '2025-03-01', beds: 3, kind: 'whole', rent: 1200, currency: 'GBP' },
    { date: '2023-01-01', beds: 3, kind: 'whole', rent: 700, currency: 'GBP' },
    { date: '2025-09-01', beds: 2, kind: 'whole', rent: 800, currency: 'GBP' },
    { date: '2025-09-01', beds: null, kind: 'room', rent: 450, currency: 'GBP' },
    { date: '2025-09-01', beds: 3, kind: 'whole', rent: 2000, currency: 'EUR' },
  ];
  const s = summariseComps(comps, { beds: 3, today: '2025-10-01', currency: 'GBP' });
  assert.equal(s.sameBeds.count, 3);
  assert.equal(s.sameBeds.median, 1100);
  assert.equal(s.rooms.median, 450);
  assert.equal(s.allWhole.count, 4);
});

test('CSV round trip', () => {
  const comps = [{ date: '2025-09-01', address: '1 Main St, "Upper"', beds: 3, kind: 'whole', type: 'terraced', rent: 950, currency: 'GBP', status: 'listed', source: 'PropertyPal', link: '' }];
  const back = fromCsv(toCsv(comps));
  assert.equal(back[0].address, '1 Main St, "Upper"');
  assert.equal(back[0].rent, 950);
  assert.equal(back[0].beds, 3);
});

test('Irish stamp duty and Rent a Room limit', () => {
  assert.equal(propertyTax(400000, 'additional', 'Ireland').tax, 4000);
  assert.equal(propertyTax(1200000, 'additional', 'Ireland').tax, 14000);
  const r = analyseDeal({ country: 'Ireland', price: 300000, lodgerRooms: 2, lodgerRoomRent: 700 });
  assert.equal(r.lodger.rentARoomLimit, 14000);
  assert.equal(r.lodger.overRentARoom, true); // 16,800 a year
});

test('NI rent estimate: Belfast above the rest of NI', () => {
  const bel = estimateNiRents({ district: 'Belfast', beds: 3, type: 'terraced' });
  const rest = estimateNiRents({ district: 'Newry, Mourne and Down', beds: 3, type: 'terraced' });
  assert.ok(bel.fullLet > rest.fullLet);
});

test('JSON-stat parsing and RTB location matching', () => {
  const js = {
    id: ['STATISTIC', 'TLIST(A1)', 'C1', 'C2', 'C3'],
    size: [1, 2, 2, 1, 3],
    dimension: {
      STATISTIC: { label: 'Statistic', category: { index: ['RIA02'], label: { RIA02: 'RTB Average Monthly Rent' } } },
      'TLIST(A1)': { label: 'Year', category: { index: ['2024', '2025'] } },
      C1: { label: 'Number of Bedrooms', category: { index: ['-', '3'], label: { '-': 'All bedrooms', 3: 'Three bed' } } },
      C2: { label: 'Property Type', category: { index: ['-'], label: { '-': 'All property types' } } },
      C3: { label: 'Location', category: { index: ['IE', 'N', 'D6'], label: { IE: 'Ireland', N: 'Naas, Kildare', D6: 'Dublin 6' } } },
    },
    value: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  };
  const { dims, get } = parseJsonStat(js);
  assert.equal(dims[4].labels[1], 'Naas, Kildare');
  // year 2025 (1), three bed (1), location Naas (1): 6 + 3 + 1 = 10 -> value 11
  assert.equal(get([0, 1, 1, 0, 1]), 11);
  const locs = dims[4].labels;
  assert.equal(matchRtbLocation('Naas', locs), 'Naas, Kildare');
  assert.equal(matchRtbLocation('D06 X2Y3', locs), 'Dublin 6');
});

test('rents are kept apart by postcode district', () => {
  const { summariseComps, summariseByDistrict, extractDistrict, districtOf } = require('../js/comps.js');
  assert.equal(extractDistrict('4 Rockville St, Belfast BT12 5AB'), 'BT12');
  assert.equal(extractDistrict('Ormeau Rd, BT7'), 'BT7');
  assert.equal(extractDistrict('Rathmines, Dublin 6'), 'D06');
  assert.equal(extractDistrict('Main St, Naas W91 X2Y3'), 'W91');
  assert.equal(districtOf('bt12 5ab'), 'BT12');
  const c = (district, rent) => ({ date: '2025-09-01', beds: 3, kind: 'whole', rent, currency: 'GBP', district });
  const comps = [c('BT12', 900), c('BT12', 950), c('BT12', 1000), c('BT7', 1300), c('BT7', 1400), c('BT7', 1500)];
  const opts = { beds: 3, today: '2025-10-01', currency: 'GBP' };
  assert.equal(summariseComps(comps, { ...opts, districts: ['BT12'] }).sameBeds.median, 950);
  assert.equal(summariseComps(comps, { ...opts, districts: ['bt7'] }).sameBeds.median, 1400);
  assert.equal(summariseComps(comps, opts).sameBeds.median, 1150); // every area
  const rows = summariseByDistrict(comps, opts);
  assert.deepEqual(rows.map((r) => [r.district, r.sameBeds.median]), [['BT7', 1400], ['BT12', 950]]);
});

test('parsed listings carry their district', () => {
  const r = parseListings('3 Bed Terrace\n12 Donegall Avenue, Belfast, BT12\n£950 pcm\n\n3 bed terrace\n9 Ormeau Road, Belfast BT7 1AB\n£1,300 pcm', {});
  assert.deepEqual(r.map((x) => x.district), ['BT12', 'BT7']);
});

test('a short listing followed by a room listing stays two listings', () => {
  const r = parseListings('3 bed terrace\n5 Rugby Road, Belfast BT7\n£1,500 pcm\n\nDouble room\nCollege Park, BT7\n£120 pw', {});
  assert.deepEqual(r.map((x) => [x.rent, x.kind]), [[1500, 'whole'], [520, 'room']]);
});

test('reads sold prices, status, dates and areas', () => {
  const { parseSales } = require('../js/comps.js');
  const t = `3 Bed Terrace House
12 Donegall Avenue, Belfast, BT12 6AB
Sold £145,000
Sold on 12/03/2026

Sale agreed
3 bed terrace
4 Rockville Street, Belfast BT12
Asking price £155,000

15/02/2026 | 5 Main Street, Naas, Kildare | €350,000.00 | Second-Hand Dwelling house

3 Bed Semi-detached House, 9 Ormeau Road, Belfast BT7 1AB
£210,000  Sold Mar 2026
Stamp duty £2,000
To let £950 pcm`;
  const r = parseSales(t, { today: '2026-10-01' });
  assert.deepEqual(r.map((x) => [x.price, x.district, x.date, x.status]), [
    [145000, 'BT12', '2026-03-12', 'sold'],
    [155000, 'BT12', '2026-10-01', 'sale agreed'],
    [350000, '', '2026-02-15', 'sold'],
    [210000, 'BT7', '2026-03-01', 'sold'],
  ]);
  assert.equal(r[2].currency, 'EUR');
});

test('sold summaries by bedrooms, type and district', () => {
  const { summariseSales, summariseSalesByDistrict, toCsv, fromCsv, SALE_COLS } = require('../js/comps.js');
  const s = (district, beds, type, price) => ({ date: '2026-05-01', district, beds, type, price, currency: 'GBP' });
  const sales = [s('BT12', 3, 'terraced', 140000), s('BT12', 3, 'terraced', 150000), s('BT12', 3, 'terraced', 160000), s('BT12', 2, 'terraced', 110000), s('BT7', 3, 'terraced', 230000)];
  const o = { beds: 3, type: 'terraced', today: '2026-10-01', currency: 'GBP' };
  const bt12 = summariseSales(sales, { ...o, districts: ['BT12'] });
  assert.equal(bt12.bedsAndType.count, 3);
  assert.equal(bt12.bedsAndType.median, 150000);
  assert.equal(bt12.bedsAndType.upperQuartile, 155000);
  assert.equal(bt12.all.count, 4);
  assert.deepEqual(summariseSalesByDistrict(sales, o).map((r) => [r.district, r.sameBeds.median]), [['BT12', 150000], ['BT7', 230000]]);
  const back = fromCsv(toCsv(sales, SALE_COLS), SALE_COLS);
  assert.equal(back.length, 5);
  assert.equal(back[4].price, 230000);
  assert.equal(back[4].district, 'BT7');
});
