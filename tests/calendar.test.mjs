// Calendar views (date ranges, overlap lanes, colors) and the iCal feed text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIcs, layoutLanes, stepDate, viewRange, viewTitle, whoColors, WHO_COLORS } from '../src/lib/calendar.ts';

test('view ranges: month is whole weeks from Sunday, week is Sun–Sat, list is 14 days', () => {
  assert.deepEqual(viewRange('month', '2026-11-17'), { from: '2026-11-01', to: '2026-12-12', days: 42 });
  assert.deepEqual(viewRange('month', '2026-12-05'), { from: '2026-11-29', to: '2027-01-09', days: 42 });
  assert.deepEqual(viewRange('week', '2026-11-17'), { from: '2026-11-15', to: '2026-11-21', days: 7 });
  assert.equal(viewRange('list', '2026-11-17').to, '2026-11-30');
  assert.equal(stepDate('month', '2026-01-31', 1), '2026-02-01', 'month steps never skip a short month');
  assert.equal(stepDate('week', '2026-11-17', -1), '2026-11-10');
  assert.equal(viewTitle('week', '2026-11-17'), 'Nov 15 – 21, 2026');
  assert.equal(viewTitle('week', '2026-11-30'), 'Nov 29 – Dec 5, 2026');
  assert.equal(viewTitle('month', '2026-11-17'), 'November 2026');
});

test('overlapping appointments sit side by side; separate ones get the full width', () => {
  // 10:00, 10:30 overlap; 13:00 alone
  assert.deepEqual(layoutLanes([600, 630, 780]), [{ lane: 0, lanes: 2 }, { lane: 1, lanes: 2 }, { lane: 0, lanes: 1 }]);
  // 9:00, 9:30, 10:00 → 10:00 can reuse lane 0 once 9:00 ends
  assert.deepEqual(layoutLanes([540, 570, 600]).map(x => x.lane), [0, 1, 0]);
});

test('colors are stable by name, people before crews', () => {
  const c = whoColors([{ id: 'b', name: 'Keenan' }, { id: 'a', name: 'Aaron' }], [{ id: 'x', name: 'Crew 1' }]);
  assert.deepEqual([c['p:a'], c['p:b'], c['c:x']], WHO_COLORS.slice(0, 3));
});

test('iCal feed: timed items in the business time zone, untimed all-day, text escaped', () => {
  const ics = buildIcs([
    { uid: 'ev-1', title: 'Roof inspection', kind: 'Inspection', ev_date: '2026-11-17', ev_time: '14:30', notes: 'Gate code 12; dog', job_number: 1001, job_name: 'Re-Roof', customer: 'Pat Doe', address: '1 Main St, Cincinnati', who: 'Aaron' },
    { uid: 'wo-2', title: 'Crew A: install', kind: 'Install', ev_date: '2026-11-19', ev_time: '', notes: '', job_number: 1002, job_name: 'X', customer: 'Lee', address: '', who: 'Crew A' },
  ], { name: 'Test', tz: 'America/New_York', host: 'app.example.com', now: new Date('2026-11-13T00:00:00Z') });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTART;TZID=America\/New_York:20261117T143000\r\nDTEND;TZID=America\/New_York:20261117T153000/);
  assert.match(ics, /SUMMARY:Roof inspection · #1001 Pat Doe/);
  assert.ok(ics.includes(String.raw`LOCATION:1 Main St\, Cincinnati`), 'commas escaped');
  assert.ok(ics.includes(String.raw`Gate code 12\; dog`), 'semicolons escaped');
  assert.match(ics, /DTSTART;VALUE=DATE:20261119\r\nDTEND;VALUE=DATE:20261120/);
  assert.match(ics, /UID:wo-2@app.example.com/);
  assert.ok(ics.split('\r\n').every(l => new TextEncoder().encode(l).length <= 75), 'lines folded at 75 octets');
});
