import { useEffect, useState } from 'react';
import { AirQualityForecast, getPm25Forecast, Preferences } from '../api';
import { HomeLocationMap } from '../components/HomeLocationMap';

interface PollutionMapViewProps { preferences: Preferences }

export function PollutionMapView({ preferences }: PollutionMapViewProps) {
  const [forecast, setForecast] = useState<AirQualityForecast | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latitude = preferences.home_latitude!;
  const longitude = preferences.home_longitude!;

  useEffect(() => {
    let active = true;
    setForecast(null); setError(null);
    getPm25Forecast(latitude, longitude).then((data) => { if (active) setForecast(data); })
      .catch((err: Error) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [latitude, longitude]);

  const points = forecast?.items.filter((item) => new Date(item.valid_at).getTime() >= Date.now()) ?? [];
  return (
    <main className="w-full max-w-6xl mx-auto px-5 sm:px-8 py-8 space-y-6">
      <header>
        <p className="font-mono text-xs uppercase tracking-widest text-[#0c6440]">Your location</p>
        <h1 className="font-headline text-3xl font-bold mt-1">{preferences.home_location}</h1>
        <p className="text-sm text-[#6f7a72] mt-2">The marker shows the location you saved. Forecast data is regional and may represent a nearby grid cell.</p>
      </header>
      <HomeLocationMap latitude={latitude} longitude={longitude} label={preferences.home_location!} />
      <section className="rounded-2xl bg-white border border-[#edeee9] p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div><h2 className="font-headline text-lg font-bold">Hourly PM2.5 forecast</h2><p className="text-xs text-[#6f7a72] mt-1">Open-Meteo / Copernicus CAMS · modeled values, not sensor observations.</p></div>
          <span className="text-xs font-mono text-[#6f7a72]">µg/m³</span>
        </div>
        {error ? <p role="alert" className="text-sm text-[#ba1a1a]">{error}</p> : points.length ? <div className="divide-y divide-[#edeee9]">
          {points.slice(0, 24).map((item) => <div key={item.valid_at} className="grid grid-cols-2 py-2.5 text-sm">
            <time className="text-[#3f4942]">{new Date(item.valid_at).toLocaleString()}</time>
            <span className="text-right font-semibold">{item.value.toFixed(1)}</span>
          </div>)}
        </div> : <p className="text-sm text-[#6f7a72]">Loading forecast for your saved location…</p>}
      </section>
    </main>
  );
}
