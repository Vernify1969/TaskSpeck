/**
 * Places TaskSpeck can show on the map.
 * Greater Melbourne is the first city. Another city is a new entry in CITIES
 * with its own centre, bounds and suburbs. Street addresses are never stored here.
 */

export const RADII = [5, 10, 25, 50];

/** Flinders Street / Swanston Street. The launch circle is measured from here. */
export const LAUNCH_CENTER = { lat: -37.8183, lng: 144.9671, label: 'Melbourne CBD (Flinders and Swanston Streets)' };

export function launchRadiusKm() {
  const n = Number(process.env.LAUNCH_RADIUS_KM);
  return Number.isFinite(n) && n > 0 ? n : 10;
}

export function extraOpenSuburbs() {
  return String(process.env.LAUNCH_EXTRA_SUBURBS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function comingSoonMessage() {
  const extra = extraOpenSuburbs();
  const more = extra.length ? ` Also open: ${extra.join(', ')}.` : '';
  return `Coming soon to your area. TaskSpeck is open within ${launchRadiusKm()} km of Melbourne CBD, around Flinders Street and Swanston Street.${more} Join the waitlist and we will email you when your suburb opens.`;
}

const VICTORIA = { south: -39.2, north: -33.98, west: 140.96, east: 149.98 };

export const CITIES = [
  {
    id: 'melbourne',
    name: 'Greater Melbourne',
    state: 'Victoria',
    country: 'AU',
    center: { lat: -37.8136, lng: 144.9631 },
    bounds: { south: -38.43, north: -37.4, west: 144.34, east: 145.76 },
    aliases: { 'melbourne cbd': 'Melbourne', cbd: 'Melbourne' },
    suburbs: [
      ['Melbourne', -37.8136, 144.9631],
      ['East Melbourne', -37.8126, 144.9859],
      ['West Melbourne', -37.807, 144.942],
      ['North Melbourne', -37.802, 144.949],
      ['Southbank', -37.8228, 144.9643],
      ['Docklands', -37.8152, 144.946],
      ['Carlton', -37.8001, 144.9671],
      ['Carlton North', -37.785, 144.973],
      ['Fitzroy', -37.799, 144.978],
      ['Fitzroy North', -37.783, 144.981],
      ['Collingwood', -37.802, 144.988],
      ['Abbotsford', -37.804, 144.998],
      ['Richmond', -37.818, 144.998],
      ['Cremorne', -37.828, 144.993],
      ['South Yarra', -37.838, 144.992],
      ['Prahran', -37.851, 144.99],
      ['Windsor', -37.856, 144.992],
      ['St Kilda', -37.868, 144.981],
      ['St Kilda East', -37.862, 144.994],
      ['Elwood', -37.882, 144.985],
      ['Albert Park', -37.844, 144.956],
      ['Port Melbourne', -37.837, 144.942],
      ['South Melbourne', -37.833, 144.958],
      ['Parkville', -37.787, 144.955],
      ['Flemington', -37.788, 144.931],
      ['Kensington', -37.794, 144.929],
      ['Northcote', -37.77, 145.0],
      ['Thornbury', -37.758, 145.006],
      ['Preston', -37.742, 145.007],
      ['Reservoir', -37.717, 145.0],
      ['Brunswick', -37.766, 144.961],
      ['Brunswick East', -37.769, 144.973],
      ['Brunswick West', -37.763, 144.944],
      ['Coburg', -37.744, 144.964],
      ['Pascoe Vale', -37.728, 144.94],
      ['Essendon', -37.755, 144.916],
      ['Moonee Ponds', -37.766, 144.922],
      ['Ascot Vale', -37.775, 144.922],
      ['Footscray', -37.8, 144.9],
      ['Yarraville', -37.816, 144.89],
      ['Williamstown', -37.858, 144.898],
      ['Newport', -37.844, 144.883],
      ['Altona', -37.868, 144.83],
      ['Sunshine', -37.788, 144.832],
      ['St Albans', -37.745, 144.8],
      ['Deer Park', -37.767, 144.771],
      ['Caroline Springs', -37.741, 144.744],
      ['Melton', -37.683, 144.577],
      ['Werribee', -37.9, 144.662],
      ['Hoppers Crossing', -37.883, 144.7],
      ['Point Cook', -37.91, 144.753],
      ['Tarneit', -37.836, 144.66],
      ['Truganina', -37.82, 144.73],
      ['Sunbury', -37.578, 144.728],
      ['Craigieburn', -37.6, 144.94],
      ['Roxburgh Park', -37.638, 144.935],
      ['Broadmeadows', -37.68, 144.919],
      ['Glenroy', -37.704, 144.917],
      ['Fawkner', -37.708, 144.967],
      ['Heidelberg', -37.756, 145.068],
      ['Ivanhoe', -37.769, 145.044],
      ['Bundoora', -37.698, 145.06],
      ['Mill Park', -37.666, 145.068],
      ['Greensborough', -37.704, 145.103],
      ['Eltham', -37.713, 145.148],
      ['Templestowe', -37.754, 145.148],
      ['Doncaster', -37.785, 145.124],
      ['Doncaster East', -37.788, 145.15],
      ['Bulleen', -37.767, 145.092],
      ['Balwyn', -37.811, 145.081],
      ['Kew', -37.806, 145.031],
      ['Hawthorn', -37.822, 145.035],
      ['Camberwell', -37.826, 145.069],
      ['Canterbury', -37.825, 145.08],
      ['Surrey Hills', -37.826, 145.099],
      ['Box Hill', -37.819, 145.122],
      ['Blackburn', -37.819, 145.15],
      ['Nunawading', -37.819, 145.177],
      ['Mitcham', -37.818, 145.192],
      ['Ringwood', -37.811, 145.229],
      ['Croydon', -37.796, 145.281],
      ['Lilydale', -37.756, 145.351],
      ['Boronia', -37.86, 145.285],
      ['Ferntree Gully', -37.884, 145.295],
      ['Glen Waverley', -37.878, 145.164],
      ['Mount Waverley', -37.877, 145.128],
      ['Chadstone', -37.887, 145.096],
      ['Oakleigh', -37.9, 145.088],
      ['Clayton', -37.915, 145.121],
      ['Springvale', -37.948, 145.153],
      ['Noble Park', -37.967, 145.176],
      ['Dandenong', -37.987, 145.215],
      ['Berwick', -38.033, 145.35],
      ['Narre Warren', -38.028, 145.303],
      ['Cranbourne', -38.099, 145.283],
      ['Pakenham', -38.071, 145.486],
      ['Frankston', -38.144, 145.123],
      ['Seaford', -38.102, 145.128],
      ['Chelsea', -38.052, 145.116],
      ['Mentone', -37.982, 145.065],
      ['Mordialloc', -38.006, 145.087],
      ['Cheltenham', -37.967, 145.054],
      ['Moorabbin', -37.933, 145.057],
      ['Bentleigh', -37.918, 145.036],
      ['Bentleigh East', -37.919, 145.053],
      ['Caulfield', -37.877, 145.027],
      ['Elsternwick', -37.884, 145.002],
      ['Brighton', -37.906, 144.999],
      ['Hampton', -37.937, 145.001],
      ['Sandringham', -37.95, 145.004],
      ['Malvern', -37.862, 145.028],
      ['Malvern East', -37.876, 145.053],
      ['Armadale', -37.855, 145.019],
      ['Toorak', -37.841, 145.017],
      ['Glen Iris', -37.86, 145.058],
      ['Ashburton', -37.867, 145.081],
      ['Burwood', -37.85, 145.113],
      ['Carnegie', -37.889, 145.057],
      ['Hughesdale', -37.895, 145.078],
      ['Rowville', -37.927, 145.24],
      ['Wantirna', -37.853, 145.23],
      ['Scoresby', -37.9, 145.23],
      ['Wheelers Hill', -37.91, 145.19],
      ['Keysborough', -37.991, 145.174],
      ['Endeavour Hills', -37.977, 145.258],
      ['Hallam', -38.006, 145.27],
      ['Epping', -37.65, 145.022],
      ['Lalor', -37.666, 145.017],
      ['Thomastown', -37.68, 145.014],
      ['South Morang', -37.65, 145.09],
      ['Mernda', -37.6, 145.1],
      ['Tullamarine', -37.701, 144.881],
      ['Airport West', -37.724, 144.886],
      ['Niddrie', -37.737, 144.892],
      ['Keilor', -37.717, 144.83],
      ['Keilor East', -37.74, 144.865],
      ['Taylors Lakes', -37.7, 144.786],
      ['Sydenham', -37.7, 144.765],
      ['Hillside', -37.69, 144.745],
      ['Braybrook', -37.786, 144.855],
      ['Maribyrnong', -37.773, 144.89],
      ['Maidstone', -37.782, 144.874],
      ['West Footscray', -37.797, 144.878],
      ['Altona North', -37.835, 144.847],
      ['Laverton', -37.862, 144.772],
      ['Williams Landing', -37.86, 144.747],
      ['Greenvale', -37.64, 144.88],
      ['Gladstone Park', -37.688, 144.888],
      ['Meadow Heights', -37.65, 144.92],
      ['Campbellfield', -37.68, 144.96],
      ['Heidelberg West', -37.748, 145.045],
      ['Rosanna', -37.742, 145.066],
      ['Macleod', -37.726, 145.07],
      ['Viewbank', -37.74, 145.093],
      ['Donvale', -37.789, 145.174],
      ['Park Orchards', -37.776, 145.214],
      ['Warrandyte', -37.742, 145.22],
      ['Vermont', -37.836, 145.194],
      ['Forest Hill', -37.84, 145.165],
      ['Ashwood', -37.867, 145.103],
      ['Mount Eliza', -38.183, 145.09],
      ['Mornington', -38.218, 145.037],
      ['Diamond Creek', -37.673, 145.158],
      ['Hurstbridge', -37.639, 145.192],
      ['Belgrave', -37.909, 145.355],
      ['Upwey', -37.904, 145.331],
      ['Mooroolbark', -37.782, 145.316],
      ['Kilsyth', -37.81, 145.317],
      ['Bayswater', -37.843, 145.267],
      ['Heathmont', -37.828, 145.244],
      ['Ringwood East', -37.812, 145.25],
      ['Chirnside Park', -37.739, 145.314],
      ['Healesville', -37.653, 145.514],
      ['Officer', -38.065, 145.409],
      ['Beaconsfield', -38.05, 145.366],
      ['Narre Warren South', -38.05, 145.29],
      ['Cranbourne East', -38.11, 145.31],
      ['Hampton Park', -38.033, 145.264],
      ['Lyndhurst', -38.04, 145.25],
      ['Dingley Village', -37.983, 145.133],
      ['Clayton South', -37.94, 145.125],
      ['Notting Hill', -37.905, 145.14],
      ['Mulgrave', -37.928, 145.16],
      ['Knoxfield', -37.868, 145.248],
      ['Lysterfield', -37.93, 145.29],
      ['Avondale Heights', -37.768, 144.863],
      ['Essendon West', -37.754, 144.89],
      ['Strathmore', -37.736, 144.922],
      ['Oak Park', -37.718, 144.922],
      ['Hadfield', -37.71, 144.942],
      ['Coburg North', -37.728, 144.964],
      ['Preston West', -37.742, 144.99],
      ['Fairfield', -37.78, 145.017],
      ['Alphington', -37.78, 145.031],
      ['Clifton Hill', -37.788, 144.995],
      ['Princes Hill', -37.782, 144.966],
      ['Seddon', -37.808, 144.891],
      ['Spotswood', -37.831, 144.885],
      ['Seaholme', -37.868, 144.841],
      ['Altona Meadows', -37.883, 144.777],
      ['Seabrook', -37.886, 144.76],
      ['Wyndham Vale', -37.89, 144.62],
      ['Manor Lakes', -37.87, 144.58],
      ['Rockbank', -37.73, 144.65],
      ['Diggers Rest', -37.627, 144.72],
      ['Wollert', -37.61, 145.033],
      ['Doreen', -37.604, 145.15],
      ['Whittlesea', -37.513, 145.118],
      ['Kew East', -37.797, 145.052],
      ['Hawthorn East', -37.824, 145.046],
      ['Auburn', -37.823, 145.045],
      ['Glen Huntly', -37.89, 145.042],
      ['Ormond', -37.903, 145.04],
      ['McKinnon', -37.91, 145.038],
      ['Brighton East', -37.917, 145.016],
      ['Black Rock', -37.971, 145.016],
      ['Beaumaris', -37.985, 145.033],
      ['Parkdale', -37.993, 145.076],
      ['Carrum', -38.075, 145.122],
      ['Patterson Lakes', -38.07, 145.143],
      ['Carrum Downs', -38.099, 145.184],
      ['Langwarrin', -38.157, 145.188],
      ['Skye', -38.108, 145.22],
      ['Clyde', -38.125, 145.33],
      ['Clyde North', -38.11, 145.34],
      ['Officer South', -38.09, 145.42],
      ['Pakenham Upper', -38.02, 145.51],
      ['Emerald', -37.933, 145.444],
      ['Cockatoo', -37.936, 145.492],
      ['Gembrook', -37.953, 145.555],
      ['Yarra Glen', -37.657, 145.372],
      ['Coldstream', -37.724, 145.378],
      ['Wandin North', -37.77, 145.42],
      ['Mount Evelyn', -37.783, 145.385],
      ['Montrose', -37.811, 145.342],
      ['The Basin', -37.85, 145.32],
      ['Upper Ferntree Gully', -37.892, 145.307],
      ['Boronia', -37.86, 145.285],
    ],
  },
];

function city(id = 'melbourne') {
  return CITIES.find((c) => c.id === id) || CITIES[0];
}

function asPlace(row, cityId) {
  return { name: row[0], lat: row[1], lng: row[2], cityId };
}

export function listCities() {
  return CITIES.map((c) => ({
    id: c.id,
    name: c.name,
    state: c.state,
    country: c.country,
    center: c.center,
  }));
}

export function haversineKm(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some((v) => v == null || Number.isNaN(+v))) return 999;
  const R = 6371;
  const dLat = ((+lat2) - (+lat1)) * Math.PI / 180;
  const dLng = ((+lng2) - (+lng1)) * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos((+lat1) * Math.PI / 180) * Math.cos((+lat2) * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

export function searchSuburbs(query, cityId = 'melbourne') {
  const c = city(cityId);
  const q = String(query || '').trim().toLowerCase();
  const rows = c.suburbs
    .map((row) => asPlace(row, c.id))
    .filter((s) => !q || s.name.toLowerCase().includes(q));
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows.slice(0, q ? 12 : rows.length);
}

export function resolveSuburb(name, cityId = 'melbourne') {
  const raw = String(name || '').trim();
  if (!raw) return null;
  const c = city(cityId);
  const key = raw.toLowerCase();
  const aliased = c.aliases?.[key];
  const want = (aliased || raw).toLowerCase();
  const row = c.suburbs.find((s) => s[0].toLowerCase() === want);
  return row ? asPlace(row, c.id) : null;
}

export function nearestSuburb(lat, lng, cityId = 'melbourne') {
  const c = city(cityId);
  let best = null;
  let bestKm = Infinity;
  for (const row of c.suburbs) {
    const km = haversineKm(lat, lng, row[1], row[2]);
    if (km < bestKm) {
      best = row;
      bestKm = km;
    }
  }
  if (!best || bestKm > 15) return null;
  return { ...asPlace(best, c.id), distanceKm: Math.round(bestKm * 10) / 10 };
}

export function launchStatus(place) {
  if (!place || place.lat == null) return { open: false, km: null, reason: 'unknown' };
  const km = Math.round(haversineKm(LAUNCH_CENTER.lat, LAUNCH_CENTER.lng, place.lat, place.lng) * 10) / 10;
  const extra = extraOpenSuburbs().some((name) => name.toLowerCase() === String(place.name || '').toLowerCase());
  if (extra) return { open: true, km, reason: 'extra' };
  return { open: km <= launchRadiusKm() + 0.05, km, reason: 'radius' };
}

export function snapRadius(km) {
  const n = Number(km);
  if (RADII.includes(n)) return n;
  return RADII.reduce((best, r) => (Math.abs(r - n) < Math.abs(best - n) ? r : best), 10);
}

export function inVictoria(lat, lng) {
  return lat >= VICTORIA.south && lat <= VICTORIA.north && lng >= VICTORIA.west && lng <= VICTORIA.east;
}

export function suburbFromNominatim(item) {
  if (!item) return null;
  const address = item.address || {};
  const country = String(address.country_code || '').toLowerCase();
  if (country && country !== 'au') return null;
  const state = String(address.state || '').toLowerCase();
  if (state && !state.includes('victoria')) return null;
  const lat = Number(item.lat);
  const lng = Number(item.lon);
  if (!inVictoria(lat, lng)) return null;
  const name = address.suburb || address.town || address.city || address.village || address.hamlet || '';
  if (!name) return null;
  if (address.road && !address.suburb && !address.town && !address.village && !address.hamlet) return null;
  const known = CITIES.find((c) => {
    const b = c.bounds;
    return lat >= b.south && lat <= b.north && lng >= b.west && lng <= b.east;
  });
  return { name, lat, lng, cityId: known ? known.id : 'victoria' };
}

let lastGeocodeAt = 0;

export function geocodeWaitMs(now = Date.now()) {
  return Math.max(0, 1100 - (now - lastGeocodeAt));
}

export function markGeocode(now = Date.now()) {
  lastGeocodeAt = now;
}

export async function geocodeVictoria(query) {
  const q = String(query || '').trim();
  if (q.length < 2) return { error: 'Type a suburb name', code: 400 };
  const wait = geocodeWaitMs();
  if (wait > 0) return { error: 'Please wait a moment before searching the map again.', code: 429 };
  markGeocode();
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', `${q}, Victoria, Australia`);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '5');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('countrycodes', 'au');
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'TaskSpeck/1.0 (local marketplace; suburb lookup)',
      Accept: 'application/json',
    },
  });
  if (!res.ok) return { error: 'The map search is not available right now. Pick a suburb from the list.', code: 502 };
  const rows = await res.json();
  const places = (Array.isArray(rows) ? rows : []).map(suburbFromNominatim).filter(Boolean);
  const seen = new Set();
  const unique = [];
  for (const place of places) {
    const key = place.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(place);
  }
  if (!unique.length) return { error: 'No Victorian suburb matched that name.', code: 404 };
  return { places: unique };
}
