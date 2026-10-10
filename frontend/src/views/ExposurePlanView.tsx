import { FormEvent, useEffect, useState } from 'react';
import { AuthUser, createExposureEstimate, getPlannerSummary, getPm25Forecast, PlannerSummary, Preferences } from '../api';

interface ExposurePlanViewProps { onShowToast: (message: string) => void; user: AuthUser; preferences: Preferences }

export function ExposurePlanView({ onShowToast, user, preferences }: ExposurePlanViewProps) {
  const [planner, setPlanner] = useState<PlannerSummary | null>(null);
  const [concentration, setConcentration] = useState('');
  const [duration, setDuration] = useState('');
  const [activity, setActivity] = useState('');
  const [kind, setKind] = useState<'observed' | 'forecast' | 'modeled' | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => setPlanner(await getPlannerSummary());
  useEffect(() => { refresh().catch((err: Error) => setError(err.message)); }, [user.id]);

  const useForecast = async () => {
    setBusy(true); setError(null);
    try {
      const data = await getPm25Forecast(preferences.home_latitude!, preferences.home_longitude!);
      const next = data.items.find((item) => new Date(item.valid_at).getTime() >= Date.now()) ?? data.items[0];
      if (!next) throw new Error('No forecast values are available for this location.');
      setConcentration(next.value.toFixed(1)); setKind('forecast');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not load location forecast.'); }
    finally { setBusy(false); }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(null);
    const value = Number(concentration); const minutes = Number(duration);
    if (!kind || !activity || !Number.isFinite(value) || value < 0 || value > 5000 || !Number.isFinite(minutes) || minutes < 1 || minutes > 1440) {
      setError('Enter a concentration, duration, activity, and input type.'); setBusy(false); return;
    }
    const ended = new Date(); const started = new Date(ended.getTime() - minutes * 60000);
    try {
      await createExposureEstimate({ segments: [{
        started_at: started.toISOString(), ended_at: ended.toISOString(), concentration_ug_m3: value,
        concentration_kind: kind, source: kind === 'forecast' ? 'Open-Meteo / CAMS user location forecast' : kind === 'observed' ? 'User-entered measurement' : 'User-entered estimate', activity,
      }] });
      await refresh(); setConcentration(''); setDuration(''); setActivity(''); setKind('');
      onShowToast('Activity saved to your personal history.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save this activity.'); }
    finally { setBusy(false); }
  };

  const days = planner?.daily_series ?? [];
  const maxMean = Math.max(1, ...days.map((day) => day.time_weighted_mean_ug_m3 ?? 0));
  return (
    <main className="w-full max-w-5xl mx-auto px-5 sm:px-8 py-8 space-y-6">
      <header><p className="font-mono text-xs uppercase tracking-widest text-[#0c6440]">Your history</p><h1 className="font-headline text-3xl font-bold mt-1">Exposure log</h1><p className="text-sm text-[#6f7a72] mt-2">Record your own concentration and activity data. Missing time is left unestimated.</p></header>
      <form onSubmit={submit} className="rounded-2xl bg-white border border-[#edeee9] p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-headline text-lg font-bold">Add an activity segment</h2><button type="button" onClick={useForecast} disabled={busy} className="rounded-lg bg-[#c2ecdb] px-3 py-2 text-xs font-semibold text-[#0c6440] disabled:opacity-50">Use {preferences.home_location} forecast</button></div>
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="text-sm text-[#3f4942]">PM2.5 concentration (ug/m3)<input required type="number" min="0" max="5000" step="0.1" value={concentration} onChange={(e) => setConcentration(e.target.value)} placeholder="Enter a measured or forecast value" className="mt-1.5 w-full rounded-xl border border-[#e2e3de] bg-[#f9faf5] px-3.5 py-3" /></label>
          <label className="text-sm text-[#3f4942]">Duration (minutes)<input required type="number" min="1" max="1440" step="1" value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="Enter duration" className="mt-1.5 w-full rounded-xl border border-[#e2e3de] bg-[#f9faf5] px-3.5 py-3" /></label>
          <label className="text-sm text-[#3f4942]">Activity<select required value={activity} onChange={(e) => setActivity(e.target.value)} className="mt-1.5 w-full rounded-xl border border-[#e2e3de] bg-[#f9faf5] px-3.5 py-3"><option value="" disabled>Select an activity</option><option value="commute">Commute</option><option value="outdoor">Outdoor activity</option><option value="indoor">Indoor</option><option value="other">Other</option></select></label>
          <label className="text-sm text-[#3f4942]">Value type<select required value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className="mt-1.5 w-full rounded-xl border border-[#e2e3de] bg-[#f9faf5] px-3.5 py-3"><option value="" disabled>Select an input type</option><option value="observed">Measured</option><option value="forecast">Forecast</option><option value="modeled">Estimate</option></select></label>
        </div>
        {error && <p role="alert" className="text-sm text-[#ba1a1a]">{error}</p>}
        <button disabled={busy} className="rounded-xl bg-[#0c6440] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save activity'}</button>
      </form>

      <section className="rounded-2xl bg-white border border-[#edeee9] p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap justify-between gap-2"><div><h2 className="font-headline text-lg font-bold">Your last seven days</h2><p className="text-xs text-[#6f7a72] mt-1">Summarized from activity segments you saved.</p></div><span className="text-xs font-mono text-[#6f7a72]">{planner?.estimate_count ?? 0} entries</span></div>
        {days.length ? <div className="h-48 flex items-end gap-2 border-b border-[#e2e3de]">{days.map((day) => <div key={day.date} className="flex-1 h-full flex flex-col items-center justify-end gap-2" title={`${day.covered_hours.toFixed(1)} logged hours`}><span className="text-[10px] font-mono">{day.time_weighted_mean_ug_m3?.toFixed(0) ?? '—'}</span><div className="w-full max-w-12 rounded-t bg-[#0c6440]" style={{ height: `${Math.max(5, (day.time_weighted_mean_ug_m3 ?? 0) / maxMean * 70)}%` }} /><span className="text-[10px] text-[#6f7a72] pb-2">{new Date(`${day.date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short' })}</span></div>)}</div> : <p className="rounded-xl bg-[#f3f4ef] p-5 text-sm text-[#6f7a72]">No activity has been saved yet. Add your first segment above to start your history.</p>}
        <p className="text-xs text-[#6f7a72]">{planner?.coverage_note ?? 'Your saved history will appear here.'}</p>
      </section>
    </main>
  );
}
