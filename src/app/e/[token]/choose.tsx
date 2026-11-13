'use client';

import { useState } from 'react';
import { DocSheet, type SheetData } from '@/components/doc-sheet';
import { docTotals, normalizeLines, type Line, type Selection, type Upgrade } from '@/lib/documents';
import { moneyCents } from '@/lib/format';
import { SignForm } from './sign-form';

export type SharedOption = { name: string; items: Line[]; total: number };

/**
 * Customer view of an estimate that's open for signing: pick an option (Good / Better / Best,
 * Repair…), tick any upgrades, answer the product questions, then sign. The estimate shown and the
 * total follow what they pick.
 */
export function SignableEstimate({ d, token, defaultName, options, upgrades, selections }: {
  d: SheetData; token: string; defaultName: string; options: SharedOption[]; upgrades: Upgrade[]; selections: Selection[];
}) {
  const [pick, setPick] = useState(0);
  const [ups, setUps] = useState<number[]>([]);
  const multi = options.length > 1;
  const base = multi ? normalizeLines(options[pick].items) : normalizeLines(d.items);
  const chosenUps = ups.map(i => upgrades[i]).filter(Boolean);
  const items: Line[] = chosenUps.length
    ? [...base, { type: 'section', title: 'Upgrades', display: 'items', show_total: false },
       ...chosenUps.map(u => ({ name: u.name, desc: u.desc, unit: 'EA', qty: 1, mat: 0, lab: 0, markup: 0, price: u.price }))]
    : base;
  const total = docTotals(items, d.tax_rate).total;
  const toggle = (i: number) => setUps(u => (u.includes(i) ? u.filter(x => x !== i) : [...u, i]));

  return (
    <>
      {multi && (
        <section className="panel choose-panel no-print">
          <h2>Choose your option</h2>
          <p className="muted" style={{ marginTop: 2 }}>Tap an option to see exactly what&apos;s included.</p>
          <div className="choose-grid" role="radiogroup" aria-label="Options">
            {options.map((o, i) => (
              <button key={i} type="button" role="radio" aria-checked={pick === i} className={`choose-card${pick === i ? ' on' : ''}`} onClick={() => setPick(i)}>
                <span className="eyebrow">Option {i + 1}</span>
                <b>{o.name}</b>
                <span className="choose-price">{moneyCents(o.total)}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      {upgrades.length > 0 && (
        <section className="panel choose-panel no-print">
          <h2>Optional upgrades</h2>
          {upgrades.map((u, i) => (
            <label key={i} className={`choose-upgrade${ups.includes(i) ? ' on' : ''}`}>
              <input type="checkbox" checked={ups.includes(i)} onChange={() => toggle(i)} />
              <span className="grow"><b>{u.name}</b>{u.desc && <small>{u.desc}</small>}</span>
              <span className="num">+{moneyCents(u.price)}</span>
            </label>
          ))}
        </section>
      )}
      <DocSheet d={{ ...d, items }} />
      <SignForm token={token} defaultName={defaultName} total={moneyCents(total)}
        option={multi ? pick : null} optionName={multi ? options[pick].name : ''} upgrades={ups} selections={selections} />
    </>
  );
}
