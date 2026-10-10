import { FormEvent, useState } from 'react';
import { AuthUser, GeocodedLocation, getPreferences, geocodeLocation, login, Preferences, register, savePreferences } from '../api';

interface WelcomeScreenProps {
  onComplete: (user: AuthUser, preferences: Preferences) => void;
  initialUser?: AuthUser | null;
}

const DEFAULT_PREFERENCES: Preferences = {
  sensitivity: 'normal', commute_reminder: false, indoor_air_alert: false,
  home_location: null, home_latitude: null, home_longitude: null,
};

export function WelcomeScreen({ onComplete, initialUser = null }: WelcomeScreenProps) {
  const [mode, setMode] = useState<'register' | 'login'>('register');
  const [pendingUser, setPendingUser] = useState<AuthUser | null>(initialUser);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [location, setLocation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveLocation = async (user: AuthUser, existing: Preferences) => {
    const match: GeocodedLocation = await geocodeLocation(location.trim());
    const preferences = await savePreferences({
      ...existing,
      home_location: [match.name, match.country].filter(Boolean).join(', '),
      home_latitude: match.latitude,
      home_longitude: match.longitude,
    });
    onComplete(user, preferences);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      if (pendingUser) {
        await saveLocation(pendingUser, await getPreferences());
        return;
      }
      if (mode === 'register') {
        if (displayName.trim().length < 2) throw new Error('Enter your name to create your profile.');
        if (location.trim().length < 2) throw new Error('Enter your city or town to personalize your air-quality forecast.');
        const place = await geocodeLocation(location.trim());
        const user = await register(displayName.trim(), email, password);
        const preferences = await savePreferences({
          ...DEFAULT_PREFERENCES,
          home_location: [place.name, place.country].filter(Boolean).join(', '),
          home_latitude: place.latitude,
          home_longitude: place.longitude,
        });
        onComplete(user, preferences);
      } else {
        const user = await login(email, password);
        const preferences = await getPreferences();
        if (preferences.home_location && preferences.home_latitude !== null && preferences.home_longitude !== null) onComplete(user, preferences);
        else { setPendingUser(user); setDisplayName(user.display_name ?? ''); }
      }
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not complete account setup.'); }
    finally { setBusy(false); }
  };

  const completingProfile = pendingUser !== null;
  return (
    <main className="min-h-screen bg-[#f9faf5] px-5 py-12 flex items-center justify-center">
      <section className="w-full max-w-lg rounded-3xl bg-white border border-[#edeee9] shadow-sm p-7 sm:p-10">
        <div className="w-12 h-12 rounded-2xl bg-[#0c6440] text-white flex items-center justify-center mb-6">
          <span className="material-symbols-outlined">spa</span>
        </div>
        <p className="font-mono text-xs uppercase tracking-widest text-[#0c6440] mb-2">Monstera</p>
        <h1 className="font-headline text-3xl font-bold text-[#1a1c19]">
          {completingProfile ? 'Set your home location' : mode === 'register' ? 'Set up your account' : 'Welcome back'}
        </h1>
        <p className="text-sm text-[#3f4942] mt-2 mb-7">
          {completingProfile ? 'We use this location to load your regional air-quality forecast.' : 'Enter your details to open your personal air-quality dashboard.'}
        </p>
        <form onSubmit={submit} className="space-y-4">
          {!completingProfile && mode === 'register' && (
            <label className="block text-sm font-medium text-[#3f4942]">Your name
              <input required minLength={2} maxLength={120} autoComplete="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="mt-1.5 w-full rounded-xl border border-[#e2e3de] bg-[#f9faf5] px-3.5 py-3" />
            </label>
          )}
          {!completingProfile && <>
            <label className="block text-sm font-medium text-[#3f4942]">Email
              <input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1.5 w-full rounded-xl border border-[#e2e3de] bg-[#f9faf5] px-3.5 py-3" />
            </label>
            <label className="block text-sm font-medium text-[#3f4942]">Password {mode === 'register' && <span className="font-normal">(at least 12 characters)</span>}
              <input required minLength={mode === 'register' ? 12 : 1} maxLength={128} type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1.5 w-full rounded-xl border border-[#e2e3de] bg-[#f9faf5] px-3.5 py-3" />
            </label>
          </>}
          {(completingProfile || mode === 'register') && (
            <label className="block text-sm font-medium text-[#3f4942]">City or town
              <input required minLength={2} maxLength={120} autoComplete="address-level2" placeholder="Enter your location" value={location} onChange={(e) => setLocation(e.target.value)} className="mt-1.5 w-full rounded-xl border border-[#e2e3de] bg-[#f9faf5] px-3.5 py-3" />
            </label>
          )}
          {error && <p role="alert" className="text-sm text-[#ba1a1a]">{error}</p>}
          <button disabled={busy} className="w-full rounded-xl bg-[#0c6440] py-3 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? 'Please wait…' : completingProfile ? 'Save location and continue' : mode === 'register' ? 'Create account and continue' : 'Sign in'}
          </button>
        </form>
        {!completingProfile && <button type="button" onClick={() => { setMode(mode === 'register' ? 'login' : 'register'); setError(null); }} className="w-full mt-4 text-sm text-[#0c6440]">
          {mode === 'register' ? 'Already have an account? Sign in' : 'New to Monstera? Create an account'}
        </button>}
        <p className="mt-7 text-xs text-[#6f7a72]">Your profile and saved activity are stored in your Monstera account. Location is used for regional forecast lookup.</p>
      </section>
    </main>
  );
}
