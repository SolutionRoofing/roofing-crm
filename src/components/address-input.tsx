'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { mapHref } from '@/lib/format';

type Suggestion = { label: string; street?: string; city?: string; st?: string; zip?: string; place?: string };
type Parts = { street: string; city: string; st: string; zip: string };

const newSession = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random()).slice(2));

/**
 * Street-address box with suggestions as you type. Picking one fills the city, state and
 * ZIP boxes named in `fill` (by element id). Typing an address by hand still works.
 */
export function AddressInput({ id, defaultValue = '', fill }: {
  id: string; defaultValue?: string; fill: { city: string; st: string; zip: string };
}) {
  const listId = useId();
  const [value, setValue] = useState(defaultValue);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const typed = useRef(false);
  const session = useRef('');

  useEffect(() => {
    if (!typed.current) return;
    const q = value.trim();
    if (q.length < 4) return;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        if (!session.current) session.current = newSession();
        const res = await fetch(`/api/address?q=${encodeURIComponent(q)}&s=${session.current}`, { signal: ctrl.signal });
        const data = (await res.json()) as { suggestions?: Suggestion[] };
        setItems(data.suggestions ?? []);
        setActive(-1);
        setOpen(true);
      } catch { /* offline or cancelled: leave the box as a plain text field */ }
    }, 300);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [value]);

  const setField = (elId: string, v?: string) => {
    const el = document.getElementById(elId) as HTMLInputElement | null;
    if (el && v) el.value = v;
  };

  const pick = async (s: Suggestion) => {
    setOpen(false);
    typed.current = false;
    let parts: Parts | null = s.street ? { street: s.street, city: s.city ?? '', st: s.st ?? '', zip: s.zip ?? '' } : null;
    if (!parts && s.place) {
      setValue(s.label.split(',')[0]);
      try {
        const res = await fetch(`/api/address?place=${encodeURIComponent(s.place)}&s=${session.current}`);
        parts = ((await res.json()) as { parts: Parts | null }).parts;
      } catch { /* keep what's shown */ }
    }
    session.current = '';
    if (!parts) return;
    if (parts.street) setValue(parts.street);
    setField(fill.city, parts.city);
    setField(fill.st, parts.st);
    setField(fill.zip, parts.zip);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || !items.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => (i + 1) % items.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => (i <= 0 ? items.length - 1 : i - 1)); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(items[active]); }
    else if (e.key === 'Escape') setOpen(false);
  };

  // The map link reads the boxes when clicked, so hand-typed city/state count too.
  const openMap = (e: React.MouseEvent<HTMLAnchorElement>) => {
    const v = (elId: string) => (document.getElementById(elId) as HTMLInputElement | null)?.value.trim() ?? '';
    const full = [value.trim(), v(fill.city), [v(fill.st), v(fill.zip)].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    e.currentTarget.href = mapHref(full);
  };

  const showList = open && items.length > 0 && value.trim().length >= 4;
  return (
    <div className="addr-wrap">
      <input
        id={id} name="address" value={value} autoComplete="off"
        role="combobox" aria-expanded={showList} aria-controls={listId} aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
        onChange={e => { typed.current = true; setValue(e.target.value); }}
        onKeyDown={onKeyDown}
        onFocus={() => items.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Start typing, e.g. 3400 Erie Ave"
      />
      {showList && (
        <ul className="addr-list" role="listbox" id={listId}>
          {items.map((s, i) => (
            <li key={s.label} id={`${listId}-${i}`} role="option" aria-selected={i === active}
              className={i === active ? 'on' : undefined}
              onMouseDown={e => { e.preventDefault(); pick(s); }}>
              {s.label}
            </li>
          ))}
        </ul>
      )}
      {value.trim() && (
        <a className="addr-map" href={mapHref(value)} target="_blank" rel="noreferrer" onClick={openMap}>Open in Google Maps</a>
      )}
    </div>
  );
}
