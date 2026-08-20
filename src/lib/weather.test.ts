import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cachedWeather,
  fetchCurrent,
  isSnowing,
  isWet,
  resetWeatherCache,
  weatherLabel,
  type WeatherPlace,
} from './weather';

const KOLKATA: WeatherPlace = {
  label: 'Kolkata',
  latitude: 22.57,
  longitude: 88.36,
  time_zone: 'Asia/Kolkata',
};
const ROME: WeatherPlace = {
  label: 'Rome',
  latitude: 41.9,
  longitude: 12.5,
  time_zone: 'Europe/Rome',
};

const reading = { temperature_2m: 30, apparent_temperature: 34, weather_code: 61, wind_speed_10m: 9 };

let calls: string[];

beforeEach(() => {
  resetWeatherCache();
  calls = [];
  vi.stubGlobal('fetch', (url: string) => {
    calls.push(url);
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ current: reading }) });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetWeatherCache();
});

describe('WMO code bands', () => {
  it('labels the bands it always did', () => {
    expect(weatherLabel(0)).toBe('Clear');
    expect(weatherLabel(45)).toBe('Foggy');
    expect(weatherLabel(61)).toBe('Rain');
    expect(weatherLabel(99)).toBe('Thunderstorms');
  });

  it('knows what counts as wet enough for an umbrella', () => {
    expect([51, 61, 67, 80, 82, 95, 99].every(isWet)).toBe(true);
    expect([0, 3, 45, 71, 77].some(isWet)).toBe(false);
  });

  it('separates snow from rain — different code band, different problem', () => {
    expect([71, 77, 85, 86].every(isSnowing)).toBe(true);
    expect(isSnowing(61)).toBe(false);
  });
});

describe('the cache', () => {
  it('asks the network once and serves the rest from memory', async () => {
    await fetchCurrent(KOLKATA);
    await fetchCurrent(KOLKATA);
    await fetchCurrent(KOLKATA);
    expect(calls).toHaveLength(1);
  });

  it('joins concurrent callers onto one request', async () => {
    // The Home tile and the companion both asking at mount is the real case.
    const [a, b, c] = await Promise.all([
      fetchCurrent(KOLKATA),
      fetchCurrent(KOLKATA),
      fetchCurrent(KOLKATA),
    ]);
    expect(calls).toHaveLength(1);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it('keeps places apart', async () => {
    await fetchCurrent(KOLKATA);
    await fetchCurrent(ROME);
    expect(calls).toHaveLength(2);
  });

  it('answers synchronously once warm, so nothing suspends to dress a robot', async () => {
    expect(cachedWeather(KOLKATA)).toBeNull();
    await fetchCurrent(KOLKATA);
    expect(cachedWeather(KOLKATA)).toEqual(reading);
  });

  it('has no opinion when no place is set', () => {
    expect(cachedWeather(null)).toBeNull();
  });
});

describe('failure', () => {
  it('resolves null rather than throwing — weather is decoration', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    await expect(fetchCurrent(KOLKATA)).resolves.toBeNull();
  });

  it('resolves null on a bad response too', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve({ ok: false }));
    await expect(fetchCurrent(KOLKATA)).resolves.toBeNull();
  });

  it('does not cache a failure — the next caller gets a fresh try', async () => {
    let attempts = 0;
    vi.stubGlobal('fetch', () => {
      attempts += 1;
      return Promise.reject(new Error('offline'));
    });
    await fetchCurrent(KOLKATA);
    await fetchCurrent(KOLKATA);
    expect(attempts).toBe(2);
  });
});
