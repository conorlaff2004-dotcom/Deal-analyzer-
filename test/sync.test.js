const test = require('node:test');
const assert = require('node:assert/strict');
const { merge } = require('../js/sync.js');

test('merges rents and sales from two devices without duplicates', () => {
  const phone = { rents: [{ id: 'a', rent: 900 }, { id: 'b', rent: 950 }], sales: [{ id: 's1', price: 150000 }] };
  const laptop = { rents: [{ id: 'b', rent: 950 }, { id: 'c', rent: 1000 }], sales: [] };
  const m = merge(phone, laptop);
  assert.deepEqual(m.rents.map((r) => r.id).sort(), ['a', 'b', 'c']);
  assert.deepEqual(m.sales.map((r) => r.id), ['s1']);
});

test('a delete on one device removes the item everywhere', () => {
  const now = Date.now();
  const phone = { rents: [{ id: 'a' }], deleted: { b: now } };
  const laptop = { rents: [{ id: 'a' }, { id: 'b' }] };
  const m = merge(phone, laptop);
  assert.deepEqual(m.rents.map((r) => r.id), ['a']);
  assert.equal(merge(laptop, m).rents.length, 1); // laptop syncing again doesn't bring it back
});

test('the most recently edited deal wins', () => {
  const m = merge({ deal: { updated: 2, state: { price: '200000' } } }, { deal: { updated: 1, state: { price: '150000' } } });
  assert.equal(m.deal.state.price, '200000');
  assert.equal(merge({}, { deal: { updated: 1, state: {} } }).deal.updated, 1);
});
