// Estimate math: material tax counts as cost, markup sets price, margin targets, sections and old lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyMargin, cleanLines, costTotals, docTotals, markupFor, normalizeLine, priceFor, sectionTotals, unitCost,
} from '../src/lib/documents.ts';

test('unit cost includes the tax paid on materials; markup sets the price', () => {
  const l = { mat: 100, lab: 50, markup: 50 };
  assert.equal(unitCost(l, 7.8), 157.8);
  assert.equal(priceFor(l, 7.8), 236.7);
  assert.equal(priceFor(l, 0), 225);
  assert.equal(markupFor(236.7, l, 7.8), 50);
  assert.equal(markupFor(100, { mat: 0, lab: 0 }, 7.8), 0, 'no cost, no markup');
});

test('cost totals: profit and margin are figured on taxed material cost', () => {
  const items = [
    { name: 'Shingles', desc: '', unit: 'SQ', qty: 30, mat: 100, lab: 0, markup: 0, price: 200 },
    { name: 'Install', desc: '', unit: 'SQ', qty: 30, mat: 0, lab: 80, markup: 0, price: 150 },
    { type: 'section', title: 'Gutters', display: 'items', show_total: true },
    { name: 'Permit', desc: '', unit: 'EA', qty: 1, mat: 0, lab: 0, markup: 0, price: 150 },
  ];
  const c = costTotals(items, 7.8);
  assert.equal(c.material, 3000);
  assert.equal(c.materialTax, 234);
  assert.equal(c.labor, 2400);
  assert.equal(c.cost, 5634);
  assert.equal(c.subtotal, 10650);
  assert.equal(c.profit, 5016);
  assert.equal(c.margin, 47.1);
  // Without counting the tax, the margin would look 2.2 points better than it really is.
  assert.equal(costTotals(items, 0).margin, 49.3);

  const t = docTotals(items, 0);
  assert.deepEqual([t.subtotal, t.tax, t.total], [10650, 0, 10650], 'customer sees no material tax');
  assert.equal(sectionTotals(items).get(2), 150);
});

test('set margin re-prices lines with costs to hit the target', () => {
  const items = [
    { name: 'Shingles', desc: '', unit: 'SQ', qty: 30, mat: 100, lab: 0, markup: 0, price: 120 },
    { name: 'Install', desc: '', unit: 'SQ', qty: 30, mat: 0, lab: 80, markup: 0, price: 100 },
  ];
  const out = applyMargin(items, 40, 7.8);
  assert.equal(Math.round(costTotals(out, 7.8).margin), 40);
  assert.equal(out[0].price, 179.67);

  // A flat-price line with no cost counts as profit, so costed lines need less markup to hit 40% overall.
  const withPermit = [...items, { name: 'Permit', desc: '', unit: 'EA', qty: 1, mat: 0, lab: 0, markup: 0, price: 500 }];
  const out2 = applyMargin(withPermit, 40, 7.8);
  assert.equal(Math.round(costTotals(out2, 7.8).margin), 40);
  assert.equal(out2[2].price, 500, 'flat-price line untouched');
  // If the flat lines alone beat the target, nothing is priced below cost.
  const big = applyMargin([items[0], { ...withPermit[2], price: 50000 }], 40, 7.8);
  assert.equal(big[0].markup, 0);
});

test('old lines ({ desc, qty, unit, price }) read as item names; junk is cleaned', () => {
  assert.deepEqual(normalizeLine({ desc: 'Pipe boot', qty: 3, unit: 'EA', price: 45 }),
    { name: 'Pipe boot', desc: '', unit: 'EA', qty: 3, mat: 0, lab: 0, markup: 0, price: 45 });
  const clean = cleanLines([
    { name: '  Ridge vent ', desc: 'Shingle-over', unit: 'LF', qty: '40', mat: '2.5', lab: 1, markup: 60, price: 'x', pid: 'not-a-uuid' },
    { name: '', desc: '' },
    { type: 'section', title: 'Gutters', display: 'bogus' },
  ]);
  assert.equal(clean.length, 2);
  assert.deepEqual(clean[0], { name: 'Ridge vent', desc: 'Shingle-over', unit: 'LF', qty: 40, mat: 2.5, lab: 1, markup: 60, price: 0 });
  assert.deepEqual(clean[1], { type: 'section', title: 'Gutters', display: 'items', show_total: true });
});
