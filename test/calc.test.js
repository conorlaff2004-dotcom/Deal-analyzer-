const test = require('node:test');
const assert = require('node:assert/strict');
const { propertyTax, monthlyPayment, analyseDeal, summarise } = require('../js/calc.js');
const { estimateRents, normalisePostcode } = require('../js/data.js');

test('SDLT: investor buying at £185k pays standard rates plus 5%', () => {
  // 125k @ 5% + 60k @ 7% = 6,250 + 4,200
  assert.equal(propertyTax(185000, 'additional', 'England').tax, 10450);
});

test('SDLT: home mover at £300k', () => {
  // 0 + 125k @ 2% + 50k @ 5% = 2,500 + 2,500
  assert.equal(propertyTax(300000, 'mover', 'England').tax, 5000);
});

test('SDLT: first-time buyer relief up to £500k, none above', () => {
  assert.equal(propertyTax(300000, 'ftb', 'England').tax, 0);
  assert.equal(propertyTax(400000, 'ftb', 'England').tax, 5000);
  assert.equal(propertyTax(510000, 'ftb', 'England').tax, propertyTax(510000, 'mover', 'England').tax);
});

test('SDLT: surcharge not charged under £40k; non-resident adds 2%', () => {
  assert.equal(propertyTax(39000, 'additional', 'England').tax, 0);
  assert.equal(propertyTax(100000, 'mover', 'England', true).tax, 2000);
});

test('Wales LTT higher rates and Scotland ADS', () => {
  // 180k @ 5% + 20k @ 8.5% = 9,000 + 1,700
  assert.equal(propertyTax(200000, 'additional', 'Wales').tax, 10700);
  // LBTT 200k: 55k @ 2% = 1,100, plus ADS 8% = 16,000
  assert.equal(propertyTax(200000, 'additional', 'Scotland').tax, 17100);
});

test('mortgage payments', () => {
  assert.equal(monthlyPayment(100000, 6, 25, true), 500);
  assert.ok(Math.abs(monthlyPayment(100000, 6, 25, false) - 644.30) < 0.01);
  assert.equal(monthlyPayment(0, 6, 25, false), 0);
});

const base = {
  price: 100000, buyerType: 'additional', country: 'England',
  legalFees: 1000, surveyFees: 0, brokerFee: 0, sourcingFee: 0, otherPurchaseCosts: 0,
  financeMethod: 'mortgage', purchaseLtv: 75, purchaseRate: 6, purchaseTerm: 25, purchaseInterestOnly: true, purchaseLenderFee: 0,
  refurbBudget: 20000, refurbContingencyPct: 10, refurbMonths: 3, holdingCostsMonthly: 100,
  refinance: true, gdv: 150000, refiLtv: 75, refiRate: 6, refiTerm: 25, refiInterestOnly: true, refiFees: 1000,
  fullLetRent: 1000, managementPct: 10, maintenancePct: 5, voidsPct: 5, insuranceMonthly: 20, serviceChargeMonthly: 0, otherMonthly: 0,
  stressRate: 5.5, icrTarget: 125,
  lodgerRooms: 2, lodgerRoomRent: 500, lodgerBillsMonthly: 100,
};

test('BRRR deal: cash in, refinance and money left in', () => {
  const r = analyseDeal(base);
  // SDLT on £100k investor: 100k @ 5% = 5,000
  assert.equal(r.tax.tax, 5000);
  assert.equal(r.deposit, 25000);
  // interest during works: 75k * 0.5% * 3 = 1,125; holding 300
  assert.equal(r.holding.total, 1425);
  // 25,000 + 6,000 + 22,000 + 1,425
  assert.equal(r.totalCashIn, 54425);
  // new loan 112,500 - 75,000 - 1,000 = 36,500 released
  assert.equal(r.refinance.cashReleased, 36500);
  assert.equal(r.cashLeftIn, 17925);
  assert.equal(r.ongoingMortgage, 562.5);
  // 1000 - 100 - 50 - 50 - 20 - 562.5
  assert.equal(r.fullLet.cashflow, 217.5);
  assert.equal(r.fullLet.grossYieldPrice, 12);
  assert.ok(Math.abs(r.fullLet.roi - (217.5 * 12 / 17925) * 100) < 1e-9);
  // ICR: 1000 / (112,500 * 5.5% / 12) = 193.9%
  assert.ok(r.fullLet.icrPass);
  assert.equal(r.lodger.income, 1000);
});

test('money fully out gives infinite ROI', () => {
  const r = analyseDeal({ ...base, gdv: 250000 });
  assert.ok(r.moneyOut);
  assert.equal(r.fullLet.roi, Infinity);
});

test('cash purchase without refinance leaves all cash in', () => {
  const r = analyseDeal({ ...base, financeMethod: 'cash', refinance: false });
  assert.equal(r.purchaseLoan, 0);
  assert.equal(r.ongoingMortgage, 0);
  assert.equal(r.cashLeftIn, r.totalCashIn);
});

test('bridging fees and exit fee', () => {
  const r = analyseDeal({ ...base, financeMethod: 'bridge', bridgeLtv: 70, bridgeMonthlyRate: 1, bridgeArrangementPct: 2, bridgeExitPct: 1 });
  assert.equal(r.purchaseLoan, 70000);
  assert.equal(r.purchaseCosts.lender, 1400);
  assert.equal(r.holding.finance, 2100);
  assert.equal(r.refinance.costs, 1700);
});

test('summary stats', () => {
  const s = summarise([100, 200, 300, 400, 500]);
  assert.equal(s.median, 300);
  assert.equal(s.lowerQuartile, 200);
  assert.equal(s.upperQuartile, 400);
});

test('rent estimate scales with beds and local prices', () => {
  const a = estimateRents({ region: 'North West', localMedianPrice: 225000, beds: 2, type: 'terraced' });
  const b = estimateRents({ region: 'North West', localMedianPrice: 225000, beds: 3, type: 'terraced' });
  const c = estimateRents({ region: 'North West', localMedianPrice: 400000, beds: 3, type: 'terraced' });
  assert.ok(b.fullLet > a.fullLet);
  assert.ok(c.fullLet > b.fullLet);
  assert.equal(estimateRents({ region: 'Nowhere', beds: 2 }), null);
});

test('postcode normalising', () => {
  assert.equal(normalisePostcode('m145tq'), 'M14 5TQ');
  assert.equal(normalisePostcode(' sw1a 1aa '), 'SW1A 1AA');
});
