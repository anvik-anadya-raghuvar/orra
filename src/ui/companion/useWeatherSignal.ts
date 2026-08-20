/**
 * Current conditions for the reader's saved place, kept fresh enough to dress
 * a robot. All the caching lives in lib/weather.ts — this only decides when to
 * ask, and never asks while the tab is hidden.
 */
import { useEffect, useState } from 'react';
import { useData } from '../../data/store';
import {
  cachedWeather,
  fetchCurrent,
  type CurrentWeather,
  type WeatherPlace,
} from '../../lib/weather';

/** Re-ask on this cadence; the cache's own TTL decides if it costs a request. */
const POLL_MS = 15 * 60_000;

export function useWeatherSignal(): CurrentWeather | null {
  const place = useData(
    (_, s) => (s.me.personalization.weather_place ?? null) as WeatherPlace | null,
  );
  // Start from whatever this device already knows, so a deep link into /work
  // dresses him immediately rather than after a round trip.
  const [weather, setWeather] = useState<CurrentWeather | null>(() => cachedWeather(place));

  const lat = place?.latitude;
  const lon = place?.longitude;

  useEffect(() => {
    if (!place) {
      setWeather(null);
      return;
    }
    let alive = true;
    const ask = () => {
      if (document.visibilityState !== 'visible') return;
      void fetchCurrent(place).then((w) => {
        if (alive && w) setWeather(w);
      });
    };
    ask();
    const iv = window.setInterval(ask, POLL_MS);
    document.addEventListener('visibilitychange', ask);
    return () => {
      alive = false;
      clearInterval(iv);
      document.removeEventListener('visibilitychange', ask);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lon]);

  return weather;
}
