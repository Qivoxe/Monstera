import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AirQualityForecast, compareRoutes, deleteSavedLocation, formatPlaceName, GeocodedLocation, geocodeLocation, getPm25Forecast, getSavedLocations, prefersIndiaSearch, RouteAlternative, RouteComparison, saveLocation, SavedLocation, updateSavedLocation } from '../api';
import { PollutionMapCanvas } from '../components/PollutionMapCanvas';
import { Preferences } from '../api';

interface PollutionMapViewProps { preferences: Preferences }
type Place = { id: string; name: string; latitude: number; longitude: number; place_label: string | null };

const distance = (meters: number) => meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
const duration = (seconds: number) => `${Math.floor(seconds / 3600) ? `${Math.floor(seconds / 3600)} h ` : ''}${Math.round(seconds % 3600 / 60)} min`;

export function PollutionMapView({ preferences }: PollutionMapViewProps) {
  const home: Place = { id: 'home', name: preferences.home_location || 'Home', latitude: preferences.home_latitude!, longitude: preferences.home_longitude!, place_label: null };
  const [places, setPlaces] = useState<SavedLocation[]>([]);
  const [selected, setSelected] = useState<Place>(home);
  const [search, setSearch] = useState('');
  const [result, setResult] = useState<GeocodedLocation | null>(null);
  const [matches, setMatches] = useState<GeocodedLocation[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [saveName, setSaveName] = useState('');
  const [forecast, setForecast] = useState<AirQualityForecast | null>(null);
  const [forecastError, setForecastError] = useState<string | null>(null);
  const [placesError, setPlacesError] = useState<string | null>(null);
  const [placesMessage, setPlacesMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [geoMessage, setGeoMessage] = useState('');
  const [originId, setOriginId] = useState('home');
  const [destinationId, setDestinationId] = useState('');
  const [comparison, setComparison] = useState<RouteComparison | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<string | null>(null);
  const [departureAt, setDepartureAt] = useState(() => new Date(Date.now() + 5 * 60000).toISOString().slice(0, 16));
  const searchGeneration = useRef(0);

  const allPlaces = useMemo<Place[]>(() => {
    const saved = [home, ...places];
    return selected.id !== 'home' && !places.some((place) => place.id === selected.id) ? [...saved, selected] : saved;
  }, [home.name, home.latitude, home.longitude, places, selected]);
  const selectedPlace = useCallback((id: string) => allPlaces.find((place) => place.id === id), [allPlaces]);

  useEffect(() => {
    let active = true;
    getSavedLocations().then((data) => { if (active) { setPlaces(data); setPlacesError(null); } })
      .catch((error: Error) => { if (active) setPlacesError(error.message); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setForecast(null); setForecastError(null);
    getPm25Forecast(selected.latitude, selected.longitude)
      .then((data) => { if (active) setForecast(data); })
      .catch((error: Error) => { if (active) setForecastError(error.message); });
    return () => { active = false; };
  }, [selected.latitude, selected.longitude, refresh]);

  async function searchPlace(event: FormEvent) {
    event.preventDefault(); const generation = ++searchGeneration.current;
    setBusy(true); setSearchError(null); setMatches([]); setResult(null);
    try {
      const homeIsIndia = home.latitude >= 6.5 && home.latitude <= 37.6 && home.longitude >= 68 && home.longitude <= 97.5;
      const countryCode = (homeIsIndia || prefersIndiaSearch()) && !search.includes(',') ? 'IN' : undefined;
      const response = await geocodeLocation(search.trim(), countryCode);
      if (generation !== searchGeneration.current) return;
      setMatches(response.results);
      if (!response.results.length) setSearchError(countryCode
        ? 'No matching places were found in India. Add a country or region to search elsewhere.'
        : 'No matching places were found. Check the spelling or add a country or region.');
    } catch (error) { if (generation === searchGeneration.current) setSearchError((error as Error).message); }
    finally { if (generation === searchGeneration.current) setBusy(false); }
  }

  function chooseSearchResult(place: GeocodedLocation) {
    searchGeneration.current += 1;
    setBusy(false);
    const label = formatPlaceName(place);
    setResult(place); setSaveName(place.name);
    setSelected({ id: `search-${place.id ?? `${place.latitude}-${place.longitude}`}`, name: label,
      latitude: place.latitude, longitude: place.longitude, place_label: label });
  }

  function useCurrentLocation() {
    const generation = ++searchGeneration.current;
    setBusy(false); setMatches([]); setSearchError(null);
    setGeoMessage('Waiting for browser location permission…');
    if (!navigator.geolocation) { setGeoMessage('This browser does not provide location access.'); return; }
    navigator.geolocation.getCurrentPosition((position) => {
      if (generation !== searchGeneration.current) return;
      const place = { id: 'current', name: 'Current location', latitude: position.coords.latitude, longitude: position.coords.longitude, place_label: null };
      setResult({ name: place.name, country: null, latitude: place.latitude, longitude: place.longitude });
      setSaveName(place.name); setSelected(place); setGeoMessage('Showing your current location. It has not changed your saved home.');
    }, (error) => {
      if (generation !== searchGeneration.current) return;
      setGeoMessage(error.code === error.PERMISSION_DENIED ? 'Location permission was denied. You can still search for a place.' : 'Current location is unavailable. You can still search for a place.');
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
  }

  async function addSavedPlace() {
    try {
      const place = await saveLocation({ name: saveName.trim() || selected.name, latitude: selected.latitude, longitude: selected.longitude, place_label: selected.place_label });
      setPlaces((items) => [...items, place]); setSelected(place); setResult(null); setPlacesError(null); setPlacesMessage(`Saved ${place.name}.`);
    } catch (error) { setPlacesMessage(null); setPlacesError((error as Error).message); }
  }

  async function renamePlace(place: SavedLocation) {
    const name = window.prompt('Name this saved place', place.name)?.trim();
    if (!name || name === place.name) return;
    try { const updated = await updateSavedLocation(place.id, { name }); setPlaces((items) => items.map((item) => item.id === place.id ? updated : item)); setPlacesError(null); setPlacesMessage(`Renamed place to ${updated.name}.`); }
    catch (error) { setPlacesMessage(null); setPlacesError((error as Error).message); }
  }

  async function removePlace(place: SavedLocation) {
    try { await deleteSavedLocation(place.id); setPlaces((items) => items.filter((item) => item.id !== place.id)); if (selected.id === place.id) setSelected(home); setPlacesError(null); setPlacesMessage(`Removed ${place.name}.`); }
    catch (error) { setPlacesMessage(null); setPlacesError((error as Error).message); }
  }

  async function findRoutes() {
    const origin = selectedPlace(originId), destination = selectedPlace(destinationId);
    if (!origin || !destination || origin.id === destination.id) { setRouteError('Choose two different saved places for the trip.'); return; }
    setBusy(true); setRouteError(null); setComparison(null); setSelectedRoute(null);
    try {
      const response = await compareRoutes({ origin, destination, departure_at: new Date(departureAt).toISOString(), mode: 'driving' });
      setComparison(response); setSelectedRoute(response.routes[0]?.id ?? null);
    } catch (error) { setRouteError((error as Error).message); }
    finally { setBusy(false); }
  }

  const upcoming = forecast?.items.filter((item) => new Date(item.valid_at).getTime() >= Date.now()) ?? [];
  const currentEstimate = upcoming[0];
  const retrievedAt = forecast?.retrieved_at ? new Date(forecast.retrieved_at) : null;
  const stale = retrievedAt !== null && Date.now() - retrievedAt.getTime() > 60 * 60 * 1000;
  const marked = comparison?.routes ?? [];

  return <main className="w-full max-w-6xl mx-auto px-5 sm:px-8 py-8 space-y-6">
    <header>
      <p className="font-mono text-xs uppercase tracking-widest text-[#0c6440]">Multi-location air quality</p>
      <h1 className="font-headline text-3xl font-bold mt-1">Explore places and compare routes</h1>
      <p className="text-sm text-[#6f7a72] mt-2">Open-Meteo / CAMS regional model forecasts. Values are not sensor measurements and do not resolve roadside pollution.</p>
    </header>

    <section className="grid lg:grid-cols-[0.8fr_1.2fr] gap-5">
      <div className="rounded-2xl bg-white border border-[#edeee9] p-5 space-y-5">
        <form onSubmit={searchPlace} className="space-y-2">
          <label className="font-headline font-bold" htmlFor="place-search">Search a location</label>
          <div className="flex gap-2"><input id="place-search" value={search} onChange={(event) => { searchGeneration.current += 1; setBusy(false); setSearch(event.target.value); setMatches([]); setSearchError(null); }} placeholder="City or place name" minLength={2} className="min-w-0 flex-1 rounded-xl border border-[#bfc9c0] px-3 py-2 text-sm" />
            <button disabled={busy || search.trim().length < 2} className="rounded-xl bg-[#0c6440] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Search</button></div>
        </form>
        <button onClick={useCurrentLocation} className="rounded-xl border border-[#bfc9c0] px-3 py-2 text-sm font-semibold text-[#0c6440]">Use my current location</button>
        {geoMessage && <p className="text-xs text-[#6f7a72]" role="status">{geoMessage}</p>}
        {searchError && <p role="status" className="text-sm text-[#6f7a72]">{searchError}</p>}
        {matches.length > 0 && <div className="rounded-xl bg-[#f3f4ef] p-3 space-y-2"><p className="text-sm font-semibold">Choose a matching place</p>{matches.map((place, index) => <button key={`${place.id ?? index}-${place.latitude}-${place.longitude}`} onClick={() => chooseSearchResult(place)} className="block w-full rounded-lg bg-white p-2 text-left text-sm hover:bg-[#c2ecdb]"><span className="font-semibold">{formatPlaceName(place)}</span><span className="block text-xs text-[#6f7a72]">{place.latitude.toFixed(4)}, {place.longitude.toFixed(4)}</span></button>)}</div>}
        {result && <div className="rounded-xl bg-[#f3f4ef] p-3 space-y-2"><p className="text-sm">Inspecting <strong>{formatPlaceName(result)}</strong>. Your saved home is unchanged.</p>
          {!places.some((place) => place.latitude === result.latitude && place.longitude === result.longitude) && <div className="flex gap-2"><input aria-label="Saved place name" value={saveName} onChange={(event) => setSaveName(event.target.value)} className="min-w-0 flex-1 rounded-lg border px-2 py-1 text-sm" /><button onClick={addSavedPlace} className="text-sm font-semibold text-[#0c6440]">Save place</button></div>}</div>}
        <div><h2 className="font-headline font-bold">Saved places</h2><div className="mt-2 space-y-1">
          {allPlaces.map((place) => <div key={place.id} className={`flex items-center rounded-lg px-3 py-2 text-sm ${selected.id === place.id ? 'bg-[#c2ecdb] text-[#0c6440]' : 'hover:bg-[#f3f4ef]'}`}>
            <button onClick={() => { searchGeneration.current += 1; setBusy(false); setSelected(place); setResult(null); }} className="min-w-0 flex-1 text-left"><span className="font-semibold">{place.name}{place.id === 'home' ? ' · home' : ''}</span>{place.place_label && <span className="ml-2 text-xs text-[#6f7a72]">{place.place_label}</span>}</button>
            {place.id !== 'home' && <span className="ml-2 flex shrink-0 gap-3"><button onClick={() => void renamePlace(place as SavedLocation)} className="text-xs font-semibold text-[#0c6440]">Rename</button><button onClick={() => void removePlace(place as SavedLocation)} className="text-xs font-semibold text-[#ba1a1a]">Remove</button></span>}
          </div>)}
          {!placesError && places.length === 0 && <p className="rounded-lg bg-[#f3f4ef] px-3 py-2 text-xs text-[#6f7a72]">No saved places yet. Search for a place or use your current location, then choose “Save place”.</p>}
        </div>{placesError && <p role="alert" className="mt-2 text-xs text-[#ba1a1a]">Saved-place service: {placesError}</p>}{placesMessage && <p role="status" className="mt-2 text-xs text-[#0c6440]">{placesMessage}</p>}</div>
        <div className="border-t border-[#edeee9] pt-4"><div className="flex items-center justify-between gap-2"><h2 className="font-headline font-bold">{selected.name} forecast</h2><button onClick={() => setRefresh((value) => value + 1)} className="text-sm font-semibold text-[#0c6440]">Refresh</button></div>
          {currentEstimate ? <><p className="mt-3 text-4xl font-bold">{currentEstimate.value.toFixed(1)} <span className="text-sm font-medium">µg/m³ PM2.5</span></p><p className="mt-1 text-xs text-[#6f7a72]">Forecast hour: {new Date(currentEstimate.valid_at).toLocaleString()}</p><p className="mt-1 text-xs text-[#6f7a72]">{forecast?.source} · retrieved {retrievedAt?.toLocaleString() ?? 'time unavailable'} · {stale ? 'stale cached data' : 'recently retrieved'} · regional model</p><p className="mt-2 text-xs text-[#6f7a72]">{forecast?.attribution}</p></>
            : <p role={forecastError ? 'alert' : undefined} className="mt-3 text-sm text-[#6f7a72]">{forecastError || (forecast ? 'No forecast hours are currently available for this location.' : 'Loading forecast…')}</p>}</div>
      </div>
      <div className="space-y-4"><PollutionMapCanvas center={{ ...selected, label: selected.name }} home={{ latitude: home.latitude, longitude: home.longitude, label: home.name }} savedPlaces={places} routes={marked} selectedRouteId={selectedRoute} />
        <section className="rounded-2xl bg-white border border-[#edeee9] p-5 space-y-3"><div><h2 className="font-headline font-bold">Compare driving routes</h2><p className="text-xs text-[#6f7a72] mt-1">OSRM alternatives where available. Standard driving routes do not include live traffic.</p></div>
          <div className="grid sm:grid-cols-[1fr_auto_1fr_auto] gap-2 items-center"><select aria-label="Route origin" value={originId} onChange={(event) => setOriginId(event.target.value)} className="rounded-lg border border-[#bfc9c0] p-2 text-sm">{allPlaces.map((place) => <option key={place.id} value={place.id}>{place.name}</option>)}</select><span className="text-sm text-[#6f7a72]">to</span><select aria-label="Route destination" value={destinationId} onChange={(event) => setDestinationId(event.target.value)} className="rounded-lg border border-[#bfc9c0] p-2 text-sm"><option value="">Choose destination</option>{allPlaces.map((place) => <option key={place.id} value={place.id}>{place.name}</option>)}</select><button disabled={busy || !destinationId} onClick={findRoutes} className="rounded-xl bg-[#0c6440] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Loading…' : 'Compare'}</button></div>
          <label className="flex flex-wrap items-center gap-2 text-xs text-[#6f7a72]">Departure time <input type="datetime-local" value={departureAt} onChange={(event) => setDepartureAt(event.target.value)} className="rounded-lg border border-[#bfc9c0] px-2 py-1 text-sm text-[#1a1c19]" /></label>
          {routeError && <p role="alert" className="text-sm text-[#ba1a1a]">{routeError}</p>}
          {comparison && <div className="space-y-3"><p className="text-sm font-semibold">{comparison.status === 'comparable' ? comparison.recommendation : 'Route choices are available, but the air-quality data does not support a confident comparison.'}</p>
            <div className="grid md:grid-cols-2 gap-2">{comparison.routes.map((route, index) => <button key={route.id} onClick={() => setSelectedRoute(route.id)} className={`rounded-xl border p-3 text-left ${selectedRoute === route.id ? 'border-[#0c6440] bg-[#f3f8f4]' : 'border-[#edeee9]'}`}>
              <div className="flex justify-between"><strong>Route {index + 1}</strong><span className="text-xs text-[#6f7a72]">{duration(route.duration_s)} · {distance(route.distance_m)}</span></div>
              <p className="mt-2 text-sm">{route.exposure_proxy_ug_h_m3 === null ? 'Exposure proxy unavailable' : `Modeled proxy ${route.exposure_proxy_ug_h_m3.toFixed(2)} ${route.exposure_unit}`}</p>
              <p className="text-xs text-[#6f7a72]">Coverage {Math.round(route.data_coverage * 100)}% · {route.available_sample_count}/{route.sample_count} forecast samples</p>
              <p className="text-xs text-[#6f7a72]">Open-Meteo / CAMS · generated {new Date(route.retrieved_at).toLocaleString()}</p>
              <p className="text-xs text-[#6f7a72]">{route.freshness}. {route.uncertainty}</p>
            </button>)}</div>
            <details><summary className="cursor-pointer text-xs font-semibold text-[#0c6440]">Method and data notes</summary><ul className="mt-2 list-disc pl-5 text-xs text-[#6f7a72]">{comparison.methodology.map((item) => <li key={item}>{item}</li>)}</ul></details>
          </div>}
        </section>
      </div>
    </section>
  </main>;
}
