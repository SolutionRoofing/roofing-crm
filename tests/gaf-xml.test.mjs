// GAF QuickMeasure Report XML → measurements. Fixture is a real export's geometry with the address replaced.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseGafXml } from '../src/lib/gaf-xml.ts';

const xml = readFileSync(new URL('./fixtures/gaf-report.xml', import.meta.url), 'utf8');

test('sums face areas and line lengths by type; chimney top is not roof', () => {
  const r = parseGafXml(xml);
  assert.equal(r.address, '100 Sample Rd, Loveland, OH 45140');
  assert.equal(r.area_sqft, 2667, '2678 sq ft of faces minus the 11 sq ft chimney top');
  assert.equal(r.faces, 8);
  assert.equal(r.pitch, 4);
  assert.deepEqual([r.low_sq, r.steep_sq], [0, 0]);
  assert.deepEqual(
    [r.eaves, r.rakes, r.ridges, r.hips, r.valleys, r.step, r.wall, r.chimney],
    [167.6, 122.8, 104.8, 0, 32.2, 42.8, 13.4, 14.3],
  );
  assert.equal(r.chimneys, 1);
  assert.deepEqual(r.ignored, []);
});

test('low-slope and steep faces split out; two structures with repeated ids both count', () => {
  const roof = (pitch, size, id) => `<ROOF id="${id}"><FACES><FACE id="F1"><POLYGON id="P1" path="L1,L2" pitch="${pitch}" size="${size}"/></FACE></FACES>
    <LINES><LINE id="L1" path="C1,C2" type="EAVE"/><LINE id="L2" path="C2,C1" type="PARAPET"/></LINES>
    <POINTS><POINT data="0,0,0" id="C1"/><POINT data="30,40,0" id="C2"/></POINTS></ROOF>`;
  const r = parseGafXml(`<DATA_EXPORT><STRUCTURES>${roof(1, 400, 'ROOF1')}${roof(12, 600, 'ROOF2')}</STRUCTURES></DATA_EXPORT>`);
  assert.equal(r.area_sqft, 1000);
  assert.deepEqual([r.low_sq, r.steep_sq, r.pitch], [4, 6, 12]);
  assert.equal(r.eaves, 100, '50 ft eave in each structure');
  assert.deepEqual(r.ignored, ['PARAPET']);
});

test('rejects files that are not a GAF report', () => {
  assert.throws(() => parseGafXml('<html></html>'), /doesn't look like a GAF/);
  assert.throws(() => parseGafXml('<DATA_EXPORT><ROOF id="R"></ROOF></DATA_EXPORT>'), /no roof area/);
});
