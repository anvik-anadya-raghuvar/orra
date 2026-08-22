/**
 * Current conditions for a saved place, from Open-Meteo — keyless, free, and
 * already in use by the Home weather tile.
 *
 * The cache is module-level rather than component state on purpose. Home
 * unmounts the moment you navigate to /work, and Vik still needs to know
 * whether to carry an umbrella. Two callers asking at once share one request;
 * a caller asking again inside the TTL gets the cached reading and no network
 * traffic at all. Net API calls are unchanged from before this file existed.
 */

export interface WeatherPlace {
  label: string;
  latitude: number;
  longitude: number;
  time_zone: string;
}

export interface CurrentWeather {
  temperature_2m: number;
  apparent_temperature: number;
  weather_code: number;
  wind_speed_10m: number;
}

/** A reading is good for half an hour; weather does not turn on a sixpence. */
const TTL_MS = 30 * 60_000;
const STORAGE_PREFIX = 'orra:weather:';

interface Entry {
  at: number;
  value: CurrentWeather;
}

const cache = new Map<string, Entry>();
const inFlight = new Map<string, Promise<CurrentWeather | null>>();

const keyOf = (place: WeatherPlace) => `${place.latitude},${place.longitude}`;

/** WMO weather codes, banded. Moved verbatim from the Home tile. */
export function weatherLabel(code: number): string {
  if (code === 0) return 'Clear';
  if (code <= 3) return 'Partly cloudy';
  if (code <= 48) return 'Foggy';
  if (code <= 57) return 'Drizzle';
  if (code <= 67) return 'Rain';
  if (code <= 77) return 'Snow';
  if (code <= 82) return 'Rain showers';
  if (code <= 86) return 'Snow showers';
  return 'Thunderstorms';
}

/** Anything falling out of the sky as water. Drives the umbrella. */
export function isWet(code: number): boolean {
  return (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95;
}

export function isSnowing(code: number): boolean {
  return (code >= 71 && code <= 77) || (code >= 85 && code <= 86);
}

/** The last reading seen on this device, for a cold start on a deep link. */
function readMirror(key: string): CurrentWeather | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Entry;
    if (typeof parsed?.value?.weather_code !== 'number') return null;
    return parsed.value;
  } catch {
    return null;
  }
}

function writeMirror(key: string, entry: Entry) {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(entry));
  } catch {}
}

/**
 * The cached reading if one is fresh, else null. Synchronous — a caller that
 * only wants to dress a robot should never suspend on the network.
 */
export function cachedWeather(place: WeatherPlace | null): CurrentWeather | null {
  if (!place) return null;
  const key = keyOf(place);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  // Stale beats nothing: yesterday's rain is a better guess than no guess.
  return hit?.value ?? readMirror(key);
}

/**
 * Fetch, or join the request already in flight, or return the fresh cache.
 * Resolves null on any failure — weather is decoration, and a failed lookup
 * must never surface as an error state in a robot's hat.
 */
export function fetchCurrent(place: WeatherPlace): Promise<CurrentWeather | null> {
  const key = keyOf(place);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.value);

  const existing = inFlight.get(key);
  if (existing) return existing;

  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}` +
    `&longitude=${place.longitude}` +
    `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m&timezone=auto`;

  const request = fetch(url)
    .then((response) => {
      if (!response.ok) throw new Error('Weather unavailable');
      return response.json();
    })
    .then((json) => {
      const value = (json as { current: CurrentWeather }).current;
      const entry = { at: Date.now(), value };
      cache.set(key, entry);
      writeMirror(key, entry);
      return value;
    })
    .catch(() => null)
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, request);
  return request;
}

/** Test seam — the cache is module state, so a suite has to be able to clear it. */
export function resetWeatherCache() {
  cache.clear();
  inFlight.clear();
}
