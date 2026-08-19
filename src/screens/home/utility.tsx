import React, { useEffect, useMemo, useState } from 'react';
import { CloudSun, Clock3, MapPin, Search } from 'lucide-react';
import { useData, useStore } from '../../data/store';
import { InfoTip, useToast } from '../../ui/bits';

type SavedClock = { label: string; time_zone: string };
type WeatherPlace = {
  label: string;
  latitude: number;
  longitude: number;
  time_zone: string;
};

const CLOCK_OPTIONS: SavedClock[] = [
  { label: 'India', time_zone: 'Asia/Kolkata' },
  { label: 'Italy', time_zone: 'Europe/Rome' },
  { label: 'London', time_zone: 'Europe/London' },
  { label: 'New York', time_zone: 'America/New_York' },
  { label: 'San Francisco', time_zone: 'America/Los_Angeles' },
  { label: 'Dubai', time_zone: 'Asia/Dubai' },
  { label: 'Singapore', time_zone: 'Asia/Singapore' },
  { label: 'Tokyo', time_zone: 'Asia/Tokyo' },
  { label: 'Sydney', time_zone: 'Australia/Sydney' },
];

const clockText = (timeZone: string, date: Date) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);

export function WorldClockTile() {
  const store = useStore();
  const me = useData((_, s) => s.me);
  const [now, setNow] = useState(() => new Date());
  const [editing, setEditing] = useState(false);
  const clocks = (me.personalization.world_clocks ?? CLOCK_OPTIONS.slice(0, 2)).slice(0, 2);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const setClock = (index: number, timeZone: string) => {
    const picked = CLOCK_OPTIONS.find((item) => item.time_zone === timeZone)!;
    const next = [...clocks];
    next[index] = picked;
    store.update(
      'profiles',
      me.id,
      { personalization: { ...me.personalization, world_clocks: next } },
      store.asMe({ summary: 'Home clocks changed' }),
    );
  };

  return (
    <>
      <div className="bt-hd">
        <span className="eyebrow feature-label">
          World clocks
          <InfoTip label="World clocks" text="Two clocks you choose. They never use or request your current location." />
        </span>
        <span className="spacer" />
        <button type="button" className="btn sm" onClick={() => setEditing((value) => !value)}>
          {editing ? 'Done' : 'Choose clocks'}
        </button>
      </div>
      <div className="clock-pair">
        {clocks.map((clock, index) => (
          <div className="clock-city" key={`${index}-${clock.time_zone}`}>
            <span><Clock3 size={14} aria-hidden /> {clock.label}</span>
            <b className="mono">{clockText(clock.time_zone, now)}</b>
            {editing && (
              <select
                className="srch"
                aria-label={`Clock ${index + 1}`}
                value={clock.time_zone}
                onChange={(event) => setClock(index, event.target.value)}
              >
                {CLOCK_OPTIONS.map((option) => (
                  <option key={option.time_zone} value={option.time_zone}>{option.label}</option>
                ))}
              </select>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

interface GeoResult {
  id: number;
  name: string;
  country?: string;
  admin1?: string;
  latitude: number;
  longitude: number;
  timezone: string;
}

interface CurrentWeather {
  temperature_2m: number;
  apparent_temperature: number;
  weather_code: number;
  wind_speed_10m: number;
}

const weatherLabel = (code: number) => {
  if (code === 0) return 'Clear';
  if (code <= 3) return 'Partly cloudy';
  if (code <= 48) return 'Foggy';
  if (code <= 57) return 'Drizzle';
  if (code <= 67) return 'Rain';
  if (code <= 77) return 'Snow';
  if (code <= 82) return 'Rain showers';
  if (code <= 86) return 'Snow showers';
  return 'Thunderstorms';
};

export function WeatherTile() {
  const store = useStore();
  const me = useData((_, s) => s.me);
  const toast = useToast();
  const place = (me.personalization.weather_place ?? null) as WeatherPlace | null;
  const [editing, setEditing] = useState(!place);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeoResult[]>([]);
  const [weather, setWeather] = useState<CurrentWeather | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!place) {
      setWeather(null);
      return;
    }
    let alive = true;
    setError('');
    fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m&timezone=auto`,
    )
      .then((response) => {
        if (!response.ok) throw new Error('Weather unavailable');
        return response.json();
      })
      .then((json) => alive && setWeather((json as { current: CurrentWeather }).current))
      .catch(() => alive && setError('Weather is unavailable right now.'));
    return () => { alive = false; };
  }, [place?.latitude, place?.longitude]);

  const search = async () => {
    const name = query.trim();
    if (name.length < 2) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=5&language=en&format=json`,
      );
      if (!response.ok) throw new Error('Search unavailable');
      const json = (await response.json()) as { results?: GeoResult[] };
      setResults(json.results ?? []);
      if (!json.results?.length) setError('No matching city found. Try adding the country.');
    } catch {
      setError('City search is unavailable right now.');
    } finally {
      setBusy(false);
    }
  };

  const choose = (result: GeoResult) => {
    const label = [result.name, result.admin1, result.country].filter(Boolean).join(', ');
    const next: WeatherPlace = {
      label,
      latitude: result.latitude,
      longitude: result.longitude,
      time_zone: result.timezone,
    };
    store.update(
      'profiles',
      me.id,
      { personalization: { ...me.personalization, weather_place: next } },
      store.asMe({ summary: `Weather place set to ${label}` }),
    );
    setResults([]);
    setQuery('');
    setEditing(false);
    toast(`Weather set to ${label}`);
  };

  const detail = useMemo(
    () => weather ? weatherLabel(weather.weather_code) : '',
    [weather],
  );

  return (
    <>
      <div className="bt-hd">
        <span className="eyebrow feature-label">
          Weather
          <InfoTip label="Weather" text="You choose a city manually. The app never reads your device location." />
        </span>
        <span className="spacer" />
        <button type="button" className="btn sm" onClick={() => setEditing((value) => !value)}>
          <MapPin size={13} aria-hidden /> {place ? 'Change place' : 'Set place'}
        </button>
      </div>
      {editing && (
        <div className="weather-search">
          <div className="wk-inline">
            <input
              className="srch"
              value={query}
              autoFocus
              placeholder="City or postcode, country"
              aria-label="Weather place"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') search(); }}
            />
            <button type="button" className="btn sm" disabled={busy || query.trim().length < 2} onClick={search}>
              <Search size={13} aria-hidden /> {busy ? 'Looking…' : 'Find'}
            </button>
          </div>
          <div className="weather-results">
            {results.map((result) => (
              <button type="button" key={result.id} onClick={() => choose(result)}>
                <b>{result.name}</b>
                <span>{[result.admin1, result.country].filter(Boolean).join(', ')}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {!place ? (
        <p className="tip">Choose the place you care about. Nothing is selected automatically.</p>
      ) : weather ? (
        <div className="weather-now">
          <CloudSun size={32} strokeWidth={1.5} aria-hidden />
          <div>
            <span>{place.label}</span>
            <b>{Math.round(weather.temperature_2m)}°C</b>
          </div>
          <div className="weather-detail">
            <b>{detail}</b>
            <span>Feels {Math.round(weather.apparent_temperature)}° · Wind {Math.round(weather.wind_speed_10m)} km/h</span>
          </div>
        </div>
      ) : (
        <p className="tip">{error || `Loading weather for ${place.label}…`}</p>
      )}
      {error && place && weather && <p className="tip">{error}</p>}
    </>
  );
}
