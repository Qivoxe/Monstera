import React, { FormEvent, useEffect, useRef, useState } from 'react';
import { AuthUser, deleteAccount, formatPlaceName, GeocodedLocation, getPreferences, geocodeLocation, login, logout, prefersIndiaSearch, Preferences, register, savePreferences } from '../api';

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: AuthUser | null;
  onAuthChange: (user: AuthUser | null) => void;
  preferences: Preferences;
  onPreferencesChange: (preferences: Preferences) => void;
  onShowToast: (message: string) => void;
}

const DEFAULT_PREFERENCES: Preferences = { sensitivity: 'normal', commute_reminder: false, indoor_air_alert: false, home_location: null, home_latitude: null, home_longitude: null };

export const ProfileModal: React.FC<ProfileModalProps> = ({ isOpen, onClose, user, onAuthChange, preferences: savedPreferences, onPreferencesChange, onShowToast }) => {
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [preferences, setPreferences] = useState<Preferences>(savedPreferences ?? DEFAULT_PREFERENCES);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [homeMatches, setHomeMatches] = useState<GeocodedLocation[]>([]);
  const [homeChoice, setHomeChoice] = useState<GeocodedLocation | null>(null);
  const searchGeneration = useRef(0);

  useEffect(() => {
    if (!isOpen || !user) return;
    getPreferences().then(setPreferences).catch((err: Error) => setError(err.message));
  }, [isOpen, user?.id]);

  useEffect(() => { setPreferences(savedPreferences ?? DEFAULT_PREFERENCES); }, [savedPreferences]);

  if (!isOpen) return null;

  const submitAuth = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(null);
    try {
      const signedIn = mode === 'register' ? await register('', email, password) : await login(email, password);
      onAuthChange(signedIn);
      setPassword('');
      onShowToast(mode === 'register' ? 'Your account is ready.' : 'Signed in. Your data is synced.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not authenticate.'); }
    finally { setBusy(false); }
  };

  const save = async () => {
    setBusy(true); setError(null);
    try {
      if (!homeChoice) {
        const generation = ++searchGeneration.current;
        const query = preferences.home_location?.trim() ?? '';
        const homeIsIndia = preferences.home_latitude !== null && preferences.home_longitude !== null && preferences.home_latitude >= 6.5 && preferences.home_latitude <= 37.6 && preferences.home_longitude >= 68 && preferences.home_longitude <= 97.5;
        const response = await geocodeLocation(query, (homeIsIndia || prefersIndiaSearch()) && !query.includes(',') ? 'IN' : undefined);
        if (generation !== searchGeneration.current) return;
        setHomeMatches(response.results);
        if (!response.results.length) setError('No matching locations found. Check the name or add a country or region.');
        return;
      }
      const updated = await savePreferences({ ...preferences, home_location: formatPlaceName(homeChoice), home_latitude: homeChoice.latitude, home_longitude: homeChoice.longitude });
      setPreferences(updated); onPreferencesChange(updated); onShowToast('Profile saved to your account.'); onClose();
    }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not save preferences.'); }
    finally { setBusy(false); }
  };

  const signOut = async () => {
    setBusy(true); setError(null);
    try { await logout(); onAuthChange(null); onShowToast('Signed out.'); onClose(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not sign out.'); }
    finally { setBusy(false); }
  };

  const removeAccount = async () => {
    if (!window.confirm('Delete your account and all saved exposure history and preferences? This cannot be undone.')) return;
    setBusy(true); setError(null);
    try { await deleteAccount(); onAuthChange(null); onShowToast('Account and saved data deleted.'); onClose(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not delete account.'); }
    finally { setBusy(false); }
  };

  const toggle = (key: 'commute_reminder' | 'indoor_air_alert', value: boolean) => setPreferences((prev) => ({ ...prev, [key]: value }));

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-xs transition-opacity animate-fade-in">
      <div className="w-full max-w-md bg-[#f9faf5] rounded-t-2xl sm:rounded-2xl p-5 shadow-2xl border border-[#edeee9] space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-2 border-b border-[#e2e3de]">
          <div>
            <h3 className="font-headline font-bold text-base text-[#1a1c19]">{user ? 'Your Monstera account' : mode === 'register' ? 'Create your account' : 'Sign in'}</h3>
            {user && <span className="text-xs text-[#3f4942]">{user.email}</span>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close profile" className="w-8 h-8 rounded-full flex items-center justify-center text-[#6f7a72] hover:bg-[#e7e9e4]">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {!user ? (
          <form className="space-y-3" onSubmit={submitAuth}>
            <p className="text-xs text-[#3f4942]">Use an account to sync preferences, simulations, and your exposure log across sessions.</p>
            <label className="block text-xs font-semibold text-[#3f4942]">Email
              <input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded-xl border border-[#e2e3de] bg-white p-3 text-sm" />
            </label>
            <label className="block text-xs font-semibold text-[#3f4942]">Password (at least 12 characters)
              <input required minLength={12} maxLength={128} type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 w-full rounded-xl border border-[#e2e3de] bg-white p-3 text-sm" />
            </label>
            {error && <p role="alert" className="text-sm text-[#ba1a1a]">{error}</p>}
            <button disabled={busy} className="w-full py-2.5 rounded-xl bg-[#0c6440] text-white font-medium text-sm disabled:opacity-50">{busy ? 'Please wait…' : mode === 'register' ? 'Create account' : 'Sign in'}</button>
            <button type="button" className="w-full text-sm text-[#0c6440]" onClick={() => { setMode(mode === 'register' ? 'login' : 'register'); setError(null); }}>
              {mode === 'register' ? 'Already have an account? Sign in' : 'New to Monstera? Create an account'}
            </button>
          </form>
        ) : (
          <>
            <div className="space-y-3">
              <label className="text-xs font-semibold uppercase tracking-wider text-[#3f4942] block">Name
                <input disabled value={user?.display_name ?? ''} className="mt-1 w-full rounded-xl border border-[#e2e3de] bg-white p-3 text-sm normal-case" />
              </label>
              <label className="text-xs font-semibold uppercase tracking-wider text-[#3f4942] block">Home location
                <input required value={preferences.home_location ?? ''} onChange={(e) => { searchGeneration.current += 1; setPreferences((prev) => ({ ...prev, home_location: e.target.value })); setHomeChoice(null); setHomeMatches([]); }} className="mt-1 w-full rounded-xl border border-[#e2e3de] bg-white p-3 text-sm normal-case" />
              </label>
              {homeMatches.length > 0 && <div role="radiogroup" aria-label="Choose home location" className="space-y-2 rounded-xl bg-[#f3f4ef] p-3">{homeMatches.map((place, index) => <button type="button" key={`${place.id ?? index}-${place.latitude}-${place.longitude}`} onClick={() => { searchGeneration.current += 1; setHomeChoice(place); }} className={`w-full rounded-lg border p-2 text-left text-sm ${homeChoice?.latitude === place.latitude && homeChoice?.longitude === place.longitude ? 'border-[#0c6440] bg-white' : 'border-transparent bg-white/60'}`}><span className="block font-semibold">{formatPlaceName(place)}</span><span className="text-xs text-[#6f7a72]">{place.latitude.toFixed(4)}, {place.longitude.toFixed(4)}</span></button>)}</div>}
              <label className="text-xs font-semibold uppercase tracking-wider text-[#3f4942] block">Exposure sensitivity
                <select value={preferences.sensitivity} onChange={(e) => setPreferences((prev) => ({ ...prev, sensitivity: e.target.value as Preferences['sensitivity'] }))} className="mt-1 w-full rounded-xl border border-[#e2e3de] bg-white p-3 text-sm normal-case">
                  <option value="normal">Standard</option><option value="sensitive">Sensitive</option><option value="high">Highest sensitivity</option>
                </select>
              </label>
              <label className="flex items-center justify-between bg-white rounded-xl p-3 border border-[#edeee9] text-sm">Commute reminders<input type="checkbox" checked={preferences.commute_reminder} onChange={(e) => toggle('commute_reminder', e.target.checked)} className="accent-[#0c6440]" /></label>
              <label className="flex items-center justify-between bg-white rounded-xl p-3 border border-[#edeee9] text-sm">Indoor air reminders<input type="checkbox" checked={preferences.indoor_air_alert} onChange={(e) => toggle('indoor_air_alert', e.target.checked)} className="accent-[#0c6440]" /></label>
            </div>
            {error && <p role="alert" className="text-sm text-[#ba1a1a]">{error}</p>}
            <button disabled={busy} onClick={save} className="w-full py-2.5 rounded-xl bg-[#0c6440] text-white font-medium text-sm disabled:opacity-50">{busy ? 'Please wait…' : homeChoice ? 'Save selected home location' : 'Find home location'}</button>
            <button disabled={busy} onClick={signOut} className="w-full py-2.5 rounded-xl bg-[#e7e9e4] text-[#1a1c19] font-medium text-sm">Sign out</button>
            <button disabled={busy} onClick={removeAccount} className="w-full text-xs text-[#ba1a1a]">Delete account and saved data</button>
          </>
        )}
      </div>
    </div>
  );
};
