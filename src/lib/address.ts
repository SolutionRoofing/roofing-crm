// Address suggestions for the street-address boxes. Server only (called from /api/address).
//
// With GOOGLE_MAPS_API_KEY set, suggestions come from Google Places (best for house numbers).
// Google needs a Google Cloud billing account, but this use stays inside its free monthly
// allowance for a small team. Without the key, it falls back to Photon (photon.komoot.io),
// which is free with no account but built on OpenStreetMap, so some houses are missing:
// people can still type the address by hand. See UPGRADES.md.

/** Results lean toward this area (Cincinnati). */
const BIAS = { lat: 39.1031, lon: -84.512, radiusM: 80_000 };
/** Photon searches this box first (Dayton to northern Kentucky, west into Indiana), then everywhere. */
const LOCAL_BBOX = '-85.6,38.4,-83.4,39.9';

export type Suggestion = {
  /** Shown in the list. */
  label: string;
  /** Filled in straight away (Photon), or looked up when picked (Google: `place`). */
  street?: string; city?: string; st?: string; zip?: string;
  place?: string;
};
export type AddressParts = { street: string; city: string; st: string; zip: string };

const googleKey = () => process.env.GOOGLE_MAPS_API_KEY || '';
export const addressProvider = () => (googleKey() ? 'google' : 'photon');

export async function suggest(q: string, session: string): Promise<Suggestion[]> {
  return googleKey() ? googleSuggest(q, session) : photonSuggest(q);
}

/** Google only: street, city, state and ZIP for a picked suggestion. */
export async function placeDetails(place: string, session: string): Promise<AddressParts | null> {
  if (!googleKey() || !/^[\w-]{10,300}$/.test(place)) return null;
  const res = await fetch(`https://places.googleapis.com/v1/places/${place}?sessionToken=${encodeURIComponent(session)}`, {
    headers: { 'X-Goog-Api-Key': googleKey(), 'X-Goog-FieldMask': 'addressComponents' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Google Places ${res.status}`);
  const data = (await res.json()) as { addressComponents?: { longText: string; shortText: string; types: string[] }[] };
  const part = (type: string, short = false) => {
    const c = data.addressComponents?.find(x => x.types.includes(type));
    return c ? (short ? c.shortText : c.longText) : '';
  };
  return {
    street: [part('street_number'), part('route', true)].filter(Boolean).join(' '),
    city: part('locality') || part('postal_town') || part('sublocality') || part('administrative_area_level_3'),
    st: part('administrative_area_level_1', true),
    zip: part('postal_code'),
  };
}

async function googleSuggest(q: string, session: string): Promise<Suggestion[]> {
  const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': googleKey() },
    body: JSON.stringify({
      input: q,
      sessionToken: session,
      includedRegionCodes: ['us'],
      includedPrimaryTypes: ['street_address', 'premise', 'subpremise', 'route'],
      locationBias: { circle: { center: { latitude: BIAS.lat, longitude: BIAS.lon }, radius: Math.min(BIAS.radiusM, 50_000) } },
    }),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Google Places ${res.status}`);
  const data = (await res.json()) as { suggestions?: { placePrediction?: { placeId: string; text: { text: string } } }[] };
  return (data.suggestions ?? [])
    .map(s => s.placePrediction)
    .filter((p): p is NonNullable<typeof p> => !!p)
    .slice(0, 6)
    .map(p => ({ label: p.text.text.replace(/, USA$/, ''), place: p.placeId }));
}

type PhotonFeature = { properties: Record<string, string | undefined> };

// Photon matches whole words, so "Rd" has to become "Road".
const ABBREV: Record<string, string> = {
  rd: 'Road', st: 'Street', ave: 'Avenue', av: 'Avenue', dr: 'Drive', ln: 'Lane', ct: 'Court', blvd: 'Boulevard',
  pl: 'Place', sq: 'Square', pkwy: 'Parkway', cir: 'Circle', hwy: 'Highway', ter: 'Terrace', trl: 'Trail',
  n: 'North', s: 'South', e: 'East', w: 'West',
};
const expand = (q: string) => q.replace(/\b([a-z]+)\.?(?=\s|,|$)/gi, (w, a: string) => ABBREV[a.toLowerCase()] ?? w);

async function photon(q: string, local: boolean): Promise<PhotonFeature[]> {
  const area = local ? `&bbox=${LOCAL_BBOX}` : `&lat=${BIAS.lat}&lon=${BIAS.lon}`;
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=12&lang=en&layer=house&layer=street${area}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'roofing-crm/1.0' }, cache: 'no-store' });
  if (!res.ok) throw new Error(`Photon ${res.status}`);
  return ((await res.json()) as { features?: PhotonFeature[] }).features ?? [];
}

async function photonSuggest(raw: string): Promise<Suggestion[]> {
  const q = expand(raw);
  const local = toSuggestions(await photon(q, true), q);
  return local.length ? local : toSuggestions(await photon(q, false), q);
}

function toSuggestions(features: PhotonFeature[], q: string): Suggestion[] {
  // A house number the person typed, kept when the map only knows the street.
  const typedNumber = /^\s*(\d+[a-z]?)\s/i.exec(q)?.[1] ?? '';
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  for (const { properties: p } of features) {
    if (p.countrycode !== 'US') continue;
    const isStreet = p.osm_key === 'highway' && p.type === 'street';
    if (!p.housenumber && !isStreet) continue; // skip bus stops, shops, towns
    const road = p.street || (isStreet ? p.name : '') || '';
    if (!road) continue;
    const street = [p.housenumber || typedNumber, road].filter(Boolean).join(' ');
    const st = stateCode(p.state);
    const city = p.city || p.town || p.village || p.locality || p.county?.replace(/ County$/, '') || '';
    const label = [street, city, [st, p.postcode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    if (seen.has(label)) continue;
    seen.add(label);
    out.push({ label, street, city, st, zip: p.postcode ?? '' });
    if (out.length === 6) break;
  }
  return out;
}

const STATES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT',
  delaware: 'DE', 'district of columbia': 'DC', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL',
  indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT',
  nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA',
  'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT',
  vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
};
function stateCode(s = '') {
  if (/^[A-Z]{2}$/.test(s)) return s;
  return STATES[s.toLowerCase()] ?? '';
}
