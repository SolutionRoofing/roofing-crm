// Quantity formulas: safe evaluator, and calibration against three real 2026 replacement jobs
// (measurements from the job, "used" = delivered minus returned on the supplier orders).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanMeasurements, evalFormula, formulaError, formulaVars, quantityFor } from '../src/lib/measure.ts';

// The default formulas seeded on the price list (keep in sync with the seed).
export const F = {
  shingles: 'ceil((sq - low_sq) * (1 + waste) * 3)',
  hipRidge: 'ceil((hips + ridges) / 30)',
  starter: 'ceil((eaves + rakes) / 116)',
  underlayment: 'ceil((sq - low_sq) / 10)',
  iceWater: 'ceil((eaves + valleys + step + wall + chimney) * 3 * 1.1 / 195)',
  ridgeVent: 'ceil(ridges / 28)',
  dripEdge: 'ceil(rakes * 1.1 / 10)',
  apron: 'ceil(eaves * 1.1 / 10)',
  coilNails: 'ceil(sq / 10)',
  labor46: 'round(p_4_6 * 10) / 10',
};

const jobA = cleanMeasurements({ area_sqft: 2714, waste_pct: 14, pitch: 8, eaves: 169, rakes: 120, ridges: 81, hips: 84, valleys: 97, step: 34, wall: 23, pipes: 3 });
const jobB = cleanMeasurements({ area_sqft: 3256, waste_pct: 14, pitch: 6, eaves: 334, rakes: 0, ridges: 29, hips: 191, valleys: 8, step: 77, wall: 34, pipes: 5 });
const jobC = cleanMeasurements({ area_sqft: 2100, waste_pct: 6, pitch: 6, eaves: 100, rakes: 123, ridges: 49, hips: 49, valleys: 0, step: 37, wall: 2, pipes: 3 });

test('formula language: math, functions, names; rejects anything else', () => {
  const v = { sq: 27.14, eaves: 169, rakes: 120 };
  assert.equal(evalFormula('ceil((eaves + rakes) / 116)', v), 3);
  assert.equal(evalFormula('max(2, -sq / 10 + 1)', v), 2);
  assert.equal(evalFormula('round(sq * 10) / 10', v), 27.1);
  assert.equal(evalFormula('5 / 0', v), 0, 'divide by zero gives 0, not Infinity');
  assert.throws(() => evalFormula('process.exit()', v), /Unexpected|Unknown|Bad number/);
  assert.throws(() => evalFormula('sq +', v), /ends too soon/);
  assert.throws(() => evalFormula('bogus * 2', v), /Unknown name "bogus"/);
  assert.equal(formulaError('ceil(sq'), 'Expected ")"');
  assert.equal(formulaError(F.iceWater), null);
  assert.equal(quantityFor('nonsense +', jobA), null, 'bad formula leaves the quantity alone');
});

test('labor bands follow pitch; low and steep areas split out', () => {
  const m = cleanMeasurements({ area_sqft: 3000, pitch: 6, low_sq: 4, steep_sq: 6 });
  const v = formulaVars(m);
  assert.deepEqual([v.p_low, v.p_4_6, v.p_7_9, v.p_10_12], [4, 20, 0, 6]);
  assert.equal(formulaVars(cleanMeasurements({ area_sqft: 2000, pitch: 8 })).p_7_9, 20);
});

test('calibration: formulas match what three real jobs actually used', () => {
  const q = (f, m) => quantityFor(f, m);
  // [formula, job, actually used (or ordered when nothing came back)]
  const checks = [
    [F.starter, jobA, 3], [F.starter, jobC, 2],
    [F.underlayment, jobA, 3], [F.underlayment, jobB, 4], [F.underlayment, jobC, 3],
    [F.iceWater, jobA, 6],
    [F.ridgeVent, jobA, 3], [F.ridgeVent, jobC, 2],
    [F.coilNails, jobA, 3], [F.coilNails, jobC, 3],
  ];
  for (const [f, m, used] of checks) assert.equal(q(f, m), used, `${f} → expected ${used}`);
  // Close calls (within one unit): ice & water and starter on job B, hip & ridge on A and C.
  assert.ok(Math.abs(q(F.iceWater, jobB) - 9) <= 1);
  assert.ok(Math.abs(q(F.starter, jobB) - 4) <= 1);
  assert.ok(Math.abs(q(F.hipRidge, jobA) - 7) <= 1);
  assert.ok(Math.abs(q(F.hipRidge, jobC) - 3) <= 1);
  // Shingles with the report's suggested waste run high on A and B (used 87 and 95 bundles).
  assert.equal(q(F.shingles, jobA), 93);
  assert.equal(q(F.shingles, jobB), 112);
  assert.equal(q(F.shingles, jobC), 67);
  assert.equal(q(F.labor46, jobB), 32.6);
});
