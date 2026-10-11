import { FormEvent, useRef, useState } from 'react';
import { AuthUser, createSimulation, formatPlaceName, GeocodedLocation, geocodeLocation, getPm25Forecast, prefersIndiaSearch, Preferences, saveRoutine, SimulationResult } from '../api';

interface SimulationViewProps { user: AuthUser; preferences: Preferences; onShowToast: (message: string) => void }

function concentrationAt(items: Awaited<ReturnType<typeof getPm25Forecast>>['items'], time: string): number {
  if (!items.length) throw new Error('The provider returned no forecast points for this location.');
  const [hour, minute] = time.split(':').map(Number);
  const target = new Date();
  target.setHours(hour, minute, 0, 0);
  if (target.getTime() < Date.now()) target.setDate(target.getDate() + 1);
  const nearest = items.reduce((best, item) => Math.abs(new Date(item.valid_at).getTime() - target.getTime()) < Math.abs(new Date(best.valid_at).getTime() - target.getTime()) ? item : best);
  return nearest.value;
}

export function SimulationView({ user, preferences, onShowToast }: SimulationViewProps) {
  const [destination, setDestination] = useState('');
  const [destinationMatches, setDestinationMatches] = useState<GeocodedLocation[]>([]);
  const [selectedDestination, setSelectedDestination] = useState<GeocodedLocation | null>(null);
  const [baselineTime, setBaselineTime] = useState('');
  const [alternativeTime, setAlternativeTime] = useState('');
  const [duration, setDuration] = useState('');
  const [comparison, setComparison] = useState<{ baseline: number; alternative: number; source: string; result: SimulationResult } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const searchGeneration = useRef(0);

  const compare = async (event: FormEvent) => {
    event.preventDefault(); const generation = ++searchGeneration.current; setBusy(true); setError(null); setComparison(null); setSaved(false);
    const minutes = Number(duration);
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 1440) { setError('Enter a trip duration from 1 to 1440 minutes.'); setBusy(false); return; }
    try {
      if (!selectedDestination) {
        const homeIsIndia = preferences.home_latitude !== null && preferences.home_longitude !== null && preferences.home_latitude >= 6.5 && preferences.home_latitude <= 37.6 && preferences.home_longitude >= 68 && preferences.home_longitude <= 97.5;
        const matches = await geocodeLocation(destination.trim(), (homeIsIndia || prefersIndiaSearch()) && !destination.includes(',') ? 'IN' : undefined);
        if (generation !== searchGeneration.current) return;
        setDestinationMatches(matches.results);
        if (!matches.results.length) setError('No matching destination found. Check the name or add a country or region.');
        return;
      }
      const place = selectedDestination;
      const [homeForecast, destinationForecast] = await Promise.all([
        getPm25Forecast(preferences.home_latitude!, preferences.home_longitude!),
        getPm25Forecast(place.latitude, place.longitude),
      ]);
      if (generation !== searchGeneration.current) return;
      const source = 'Open-Meteo / CAMS regional forecasts averaged at the trip endpoints';
      const baseline = (concentrationAt(homeForecast.items, baselineTime) + concentrationAt(destinationForecast.items, baselineTime)) / 2;
      const alternative = (concentrationAt(homeForecast.items, alternativeTime) + concentrationAt(destinationForecast.items, alternativeTime)) / 2;
      const input = {
        baseline: { concentration_ug_m3: baseline, duration_minutes: minutes, source, concentration_kind: 'forecast' as const },
        alternative: { concentration_ug_m3: alternative, duration_minutes: minutes, source, concentration_kind: 'forecast' as const },
        context: { origin: preferences.home_location!, destination: formatPlaceName(place), baseline_time: baselineTime, alternative_time: alternativeTime },
      };
      const result = await createSimulation(input);
      if (generation !== searchGeneration.current) return;
      setComparison({ baseline, alternative, source, result });
    } catch (err) { if (generation === searchGeneration.current) setError(err instanceof Error ? err.message : 'Could not compare these forecast windows.'); }
    finally { setBusy(false); }
  };

  const saveCommute = async () => {
    if (!comparison) return;
    setBusy(true); setError(null);
    try {
      const title = `${preferences.home_location} to ${destination.trim()}`;
      await saveRoutine({ title, corridor_id: `${preferences.home_latitude},${preferences.home_longitude}`, simulation: {
        baseline: { concentration_ug_m3: comparison.baseline, duration_minutes: Number(duration), source: comparison.source, concentration_kind: 'forecast' },
        alternative: { concentration_ug_m3: comparison.alternative, duration_minutes: Number(duration), source: comparison.source, concentration_kind: 'forecast' },
        context: { origin: preferences.home_location!, destination, baseline_time: baselineTime, alternative_time: alternativeTime },
      } });
      setSaved(true); onShowToast('Commute comparison saved to your account.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save commute comparison.'); }
    finally { setBusy(false); }
  };

  return (
    <main className="w-full max-w-5xl mx-auto px-5 sm:px-8 py-8 space-y-6">
      <header><p className="font-mono text-xs uppercase tracking-widest text-[#0c6440]">Your commute</p><h1 className="font-headline text-3xl font-bold mt-1">Compare departure times</h1><p className="text-sm text-[#6f7a72] mt-2">Use your saved home location and enter a destination and trip details. This compares regional forecast concentrations; it does not calculate a route.</p></header>
      <form onSubmit={compare} className="rounded-2xl bg-white border border-[#edeee9] p-5 sm:p-6 grid sm:grid-cols-2 gap-4">
        <label className="text-sm font-medium text-[#3f4942]">Starting location
          <input readOnly value={preferences.home_location ?? ''} className="mt-1.5 w-full rounded-xl border border-[#e2e3de] bg-[#f3f4ef] px-3.5 py-3" />
        </label>
        <label className="text-sm font-medium text-[#3f4942]">Destination
          <input required minLength={2} value={destination} onChange={(e) => { searchGeneration.current += 1; setDestination(e.target.value); setSelectedDestination(null); setDestinationMatches([]); }} placeholder="Enter a destination" className="mt-1.5 w-full rounded-xl border border-[#e2e3de] bg-[#f9faf5] px-3.5 py-3" />
        </label>
        {destinationMatches.length > 0 && <div role="radiogroup" aria-label="Choose destination" className="sm:col-span-2 rounded-xl bg-[#f3f4ef] p-3 space-y-2"><p className="text-xs font-semibold">Choose the intended place; its coordinates will be used for the forecast.</p>{destinationMatches.map((place, index) => <button type="button" key={`${place.id ?? index}-${place.latitude}-${place.longitude}`} onClick={() => { searchGeneration.current += 1; setSelectedDestination(place); }} className={`block w-full rounded-lg border p-2 text-left text-sm ${selectedDestination?.latitude === place.latitude && selectedDestination?.longitude === place.longitude ? 'border-[#0c6440] bg-white' : 'border-transparent bg-white/60'}`}><span className="block font-semibold">{formatPlaceName(place)}</span><span className="text-xs text-[#6f7a72]">{place.latitude.toFixed(4)}, {place.longitude.toFixed(4)}</span></button>)}</div>}
        <label className="text-sm font-medium text-[#3f4942]">Current departure time
          <input required type="time" value={baselineTime} onChange={(e) => setBaselineTime(e.target.value)} className="mt-1.5 w-full rounded-xl border border-[#e2e3de] bg-[#f9faf5] px-3.5 py-3" />
        </label>
        <label className="text-sm font-medium text-[#3f4942]">Alternative departure time
          <input required type="time" value={alternativeTime} onChange={(e) => setAlternativeTime(e.target.value)} className="mt-1.5 w-full rounded-xl border border-[#e2e3de] bg-[#f9faf5] px-3.5 py-3" />
        </label>
        <label className="text-sm font-medium text-[#3f4942]">Trip duration (minutes)
          <input required type="number" min="1" max="1440" step="1" value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="Enter estimated duration" className="mt-1.5 w-full rounded-xl border border-[#e2e3de] bg-[#f9faf5] px-3.5 py-3" />
        </label>
        <div className="sm:col-span-2"><button disabled={busy} className="w-full sm:w-auto rounded-xl bg-[#0c6440] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Comparing forecasts…' : selectedDestination ? 'Compare selected destination' : 'Find destination'}</button></div>
      </form>
      {error && <p role="alert" className="rounded-xl bg-[#ffdad6] p-3 text-sm text-[#93000a]">{error}</p>}
      {comparison && <section className="rounded-2xl bg-white border border-[#edeee9] p-5 sm:p-6 space-y-4">
        <div><h2 className="font-headline text-xl font-bold">Comparison for {preferences.home_location} to {destination}</h2><p className="text-xs text-[#6f7a72] mt-1">Both estimates use your entered duration ({duration} min). Route conditions and transit mode are not included.</p></div>
        <div className="grid sm:grid-cols-3 gap-3">
          <div className="rounded-xl bg-[#f3f4ef] p-4"><p className="text-xs text-[#6f7a72]">At {baselineTime}</p><p className="mt-1 text-2xl font-bold">{comparison.result.baseline_dose_ug_h_m3.toFixed(2)}</p><p className="text-xs">µg·h/m³ estimated concentration-time</p></div>
          <div className="rounded-xl bg-[#c2ecdb]/60 p-4"><p className="text-xs text-[#0c6440]">At {alternativeTime}</p><p className="mt-1 text-2xl font-bold text-[#0c6440]">{comparison.result.alternative_dose_ug_h_m3.toFixed(2)}</p><p className="text-xs">µg·h/m³ estimated concentration-time</p></div>
          <div className="rounded-xl bg-[#f3f4ef] p-4"><p className="text-xs text-[#6f7a72]">Difference</p><p className="mt-1 text-2xl font-bold">{comparison.result.delta_ug_h_m3 > 0 ? '+' : ''}{comparison.result.delta_ug_h_m3.toFixed(2)}</p><p className="text-xs">µg·h/m³ · forecast-based estimate</p></div>
        </div>
        <p className="text-xs leading-relaxed text-[#6f7a72]">Values come from Open-Meteo/CAMS regional forecast grids averaged at the two entered endpoints. This is not a health outcome prediction.</p>
        <button disabled={busy || saved} onClick={saveCommute} className="rounded-xl bg-[#0c6440] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{saved ? 'Saved to your account' : 'Save this comparison'}</button>
      </section>}
    </main>
  );
}
