// Price list CSV import: JobNimbus-style and supplier-style sheets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, toPriceRows } from '../src/lib/price-import.ts';

test('CSV parsing handles quotes, commas and line breaks inside fields', () => {
  const rows = parseCsv('\uFEFFName,Description\r\n"Ridge cap, hip & ridge","Line one\nline ""two"""\r\n\r\nDrip edge,\n');
  assert.deepEqual(rows, [['Name', 'Description'], ['Ridge cap, hip & ridge', 'Line one\nline "two"'], ['Drip edge', '']]);
});

test('JobNimbus-style export: material/labor price columns, type, hidden items skipped', () => {
  const csv = [
    'Product,Description,UOM,Material Cost,Labor Cost,Material Price,Labor Price,Type,Active',
    '6 Inch Seamless Gutter,"Custom fabricate 6-inch gutters",LF,4.00,3.00,9.00,6.00,labor+material,true',
    '4x3 DOWNSPOUT,,LF,0,5.5,0,5.5,labor,true',
    'Old item,,EA,1,0,2,0,material,false',
    '6 Inch Seamless Gutter,dup,LF,1,1,1,1,material,true',
  ].join('\n');
  const { rows, skipped } = toPriceRows(csv, 7.8);
  assert.equal(skipped, 2, 'hidden and duplicate rows skipped');
  assert.deepEqual(rows[0], {
    name: '6 Inch Seamless Gutter', description: 'Custom fabricate 6-inch gutters', unit: 'LF', category: 'Material & Labor',
    material_cost: 4, labor_cost: 3, markup: 105.14, price: 15,
  });
  assert.equal(rows[1].markup, 0);
  assert.equal(rows[1].price, 5.5);
});

test('supplier sheet: Item / Cost / Markup with no price works the price out', () => {
  const { rows } = toPriceRows('Item,Unit,Cost,Markup\nGAF Timberline HDZ,BD,$42.50,35%\n', 7.8);
  assert.deepEqual(rows[0], { name: 'GAF Timberline HDZ', description: '', unit: 'BD', category: '', material_cost: 42.5, labor_cost: 0, markup: 35, price: 61.85 });
  assert.match(toPriceRows('Foo,Bar\n1,2', 0).error, /item name column/);
});
