import { useEffect, useState } from 'react';
import { TabType } from '../types';
import { AuthUser, getPm25Forecast, getPlannerSummary, getSavedLocations, PlannerSummary, Preferences, SavedLocation } from '../api';

interface DashboardViewProps {
  onNavigateTab: (tab: TabType) => void;
  user: AuthUser;
  preferences: Preferences;
}

export function DashboardView({ onNavigateTab, user, preferences }: DashboardViewProps) {
  const [forecast, setForecast] = useState<Awaited<ReturnType<typeof getPm25Forecast>> | null>(null);
  const [forecastError, setForecastError] = useState<string | null>(null);
  const [planner, setPlanner] = useState<PlannerSummary | null>(null);
  const [plannerError, setPlannerError] = useState<string | null>(null);
  const [savedPlaces, setSavedPlaces] = useState<SavedLocation[]>([]);
  const [savedPlacesError, setSavedPlacesError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setForecast(null); setForecastError(null);
    getPm25Forecast(preferences.home_latitude!, preferences.home_longitude!)
      .then((data) => { if (active) setForecast(data); })
      .catch((error: Error) => { if (active) setForecastError(error.message); });
    return () => { active = false; };
  }, [preferences.home_latitude, preferences.home_longitude]);

  useEffect(() => {
    let active = true;
    setPlanner(null); setPlannerError(null);
    getPlannerSummary().then((data) => { if (active) setPlanner(data); })
      .catch((error: Error) => { if (active) setPlannerError(error.message); });
    return () => { active = false; };
  }, [user.id]);

  useEffect(() => {
    let active = true;
    getSavedLocations().then((data) => { if (active) { setSavedPlaces(data); setSavedPlacesError(null); } }).catch((error: Error) => { if (active) setSavedPlacesError(error.message); });
    return () => { active = false; };
  }, [user.id]);

  const points = forecast?.items.filter((item) => new Date(item.valid_at).getTime() >= Date.now()).slice(0, 24) ?? [];
  const current = points[0];
  const displayPoints = points.filter((_item, index) => index % 3 === 0);
  const max = Math.max(1, ...displayPoints.map((item) => item.value));

  return (
    <div className="w-full max-w-6xl mx-auto px-5 sm:px-8 py-8 space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-[#0c6440]">Your air quality</p>
          <h1 className="font-headline text-3xl font-bold text-[#1a1c19] mt-1">Hello, {user.display_name || user.email}</h1>
          <p className="text-sm text-[#3f4942] mt-1">Forecast and saved activity for {preferences.home_location}.</p>
        </div>
        <button onClick={() => onNavigateTab('map')} className="rounded-xl bg-[#0c6440] px-4 py-2.5 text-sm font-semibold text-white">View location forecast</button>
      </header>

      <section className="grid md:grid-cols-2 gap-5">
        <article className="rounded-2xl bg-white border border-[#edeee9] p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-headline text-lg font-bold">PM2.5 forecast</h2>
            <span className="rounded-full bg-[#c2ecdb] px-2.5 py-1 text-[10px] font-mono font-bold text-[#0c6440]">REGIONAL MODEL</span>
          </div>
          {current ? <>
            <p className="mt-5 text-5xl font-bold text-[#1a1c19]">{current.value.toFixed(1)} <span className="text-base font-medium">µg/m³</span></p>
            <p className="mt-2 text-xs text-[#6f7a72]">{current.provider} · {new Date(current.valid_at).toLocaleString()}</p>
            <p className="mt-3 text-xs leading-relaxed text-[#6f7a72]">This is a regional forecast, not a measurement from a local sensor.</p>
          </> : <p role={forecastError ? 'alert' : undefined} className="mt-6 text-sm text-[#6f7a72]">{forecastError || 'Loading your location forecast…'}</p>}
        </article>

        <article className="rounded-2xl bg-white border border-[#edeee9] p-6">
          <div className="flex items-center justify-between gap-3">
            <div><h2 className="font-headline text-lg font-bold">Your saved activity</h2><p className="text-xs text-[#6f7a72] mt-1">Only entries you add are shown.</p></div>
            <button onClick={() => onNavigateTab('exposure')} className="text-sm font-semibold text-[#0c6440]">Open log</button>
          </div>
          {planner ? <>
            <p className="mt-5 text-4xl font-bold text-[#1a1c19]">{planner.estimate_count}</p>
            <p className="text-sm text-[#3f4942]">saved exposure {planner.estimate_count === 1 ? 'estimate' : 'estimates'}</p>
            <p className="mt-3 text-xs text-[#6f7a72]">{planner.coverage_note}</p>
          </> : <p className="mt-6 text-sm text-[#6f7a72]">{plannerError || 'Loading your saved activity…'}</p>}
        </article>
      </section>

      <section className="rounded-2xl bg-white border border-[#edeee9] p-5 flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="font-headline font-bold">Your places</h2><p className="mt-1 text-sm text-[#6f7a72]">Home: {preferences.home_location}{savedPlacesError ? ` · Saved places unavailable: ${savedPlacesError}` : savedPlaces.length ? ` · ${savedPlaces.map((place) => place.name).join(' · ')}` : ' · No saved places yet; add places on the map.'}</p></div>
        <button onClick={() => onNavigateTab('map')} className="rounded-xl border border-[#bfc9c0] px-4 py-2 text-sm font-semibold text-[#0c6440]">Manage places and routes</button>
      </section>

      <section className="rounded-2xl bg-white border border-[#edeee9] p-6">
        <div className="flex flex-wrap justify-between gap-2 mb-5">
          <div><h2 className="font-headline text-lg font-bold">Next 24 hours</h2><p className="text-xs text-[#6f7a72] mt-1">Hourly PM2.5 forecast for {preferences.home_location}.</p></div>
          <span className="text-[10px] font-mono text-[#6f7a72]">Open-Meteo / CAMS</span>
        </div>
        {displayPoints.length ? <div className="h-48 flex items-end gap-2 sm:gap-3 border-b border-[#e2e3de]">
          {displayPoints.map((item) => <div key={item.valid_at} className="flex-1 h-full flex flex-col justify-end items-center gap-2" title={`${item.value.toFixed(1)} µg/m³`}>
            <span className="text-[10px] font-mono text-[#3f4942]">{item.value.toFixed(0)}</span>
            <div className="w-full max-w-12 rounded-t-md bg-[#0c6440]" style={{ height: `${Math.max(5, item.value / max * 70)}%` }} />
            <span className="text-[9px] text-[#6f7a72] pb-2">{new Date(item.valid_at).toLocaleTimeString([], { hour: 'numeric' })}</span>
          </div>)}
        </div> : <p className="text-sm text-[#6f7a72]">{forecastError || 'Forecast data will appear here when available.'}</p>}
      </section>
    </div>
  );
}
