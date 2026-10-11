const API_BASE = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '');

let csrfToken = '';

export interface AirQualityForecast {
  requested_location: { latitude: number; longitude: number };
  items: Array<{
    pollutant: 'pm2_5'; value: number; unit: 'µg/m³'; kind: 'forecast';
    valid_at: string; provider: string; grid_location: { latitude: number; longitude: number };
  }>;
  attribution: string;
  source?: string; kind?: 'forecast'; retrieved_at?: string; freshness?: string;
}

export interface AuthUser { id: string; display_name: string | null; email: string; csrf_token: string }
export interface Preferences {
  sensitivity: 'normal' | 'sensitive' | 'high'; commute_reminder: boolean; indoor_air_alert: boolean;
  home_location: string | null; home_latitude: number | null; home_longitude: number | null;
}
export interface ExposureHistoryItem {
  id: string; period_start: string; period_end: string; dose_ug_h_m3: number;
  time_weighted_mean_ug_m3: number | null; coverage: number; assumptions: string[];
}
export interface PlannerSummary {
  terminology_note: string; estimate_count: number; total_dose_ug_h_m3: number;
  daily_series: Array<{ date: string; dose_ug_h_m3: number; time_weighted_mean_ug_m3: number | null; covered_hours: number }>;
  coverage_note: string; recommendations: string[];
}
export interface SimulationResult {
  baseline_dose_ug_h_m3: number; alternative_dose_ug_h_m3: number;
  delta_ug_h_m3: number; delta_percent: number | null; unit: string; assumptions: string[];
}
export interface GeocodedLocation {
  id?: number; name: string; country: string | null; country_code?: string | null;
  admin1?: string | null; admin2?: string | null; admin3?: string | null; admin4?: string | null;
  latitude: number; longitude: number;
}
export interface LocationSearchResponse extends Partial<GeocodedLocation> { results: GeocodedLocation[] }
export interface SavedLocation { id: string; name: string; latitude: number; longitude: number; place_label: string | null; created_at: string; updated_at: string }
export interface RouteAlternative {
  id: string; geometry: { type: 'LineString'; coordinates: number[][] }; distance_m: number; duration_s: number;
  exposure_proxy_ug_h_m3: number | null; exposure_unit: string; data_coverage: number; sample_count: number;
  available_sample_count: number; source: string; retrieved_at: string; freshness: string; provenance: Array<Record<string, unknown>>; uncertainty: string;
}
export interface RouteComparison { status: 'comparable' | 'insufficient_data'; recommendation: string | null; routes: RouteAlternative[]; methodology: string[] }
export interface SavedRoutine { id: string; title: string; corridor_id: string; created_at: string; simulation: Record<string, unknown> }

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (csrfToken && ['POST', 'PUT', 'PATCH', 'DELETE'].includes((init.method || 'GET').toUpperCase())) {
    headers.set('X-CSRF-Token', csrfToken);
  }
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers, credentials: 'include' });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try { message = (await response.json()).detail || message; } catch { /* keep generic error */ }
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function rememberAuth(user: AuthUser): AuthUser { csrfToken = user.csrf_token; return user; }

export async function getPm25Forecast(latitude: number, longitude: number): Promise<AirQualityForecast> {
  const query = new URLSearchParams({ latitude: String(latitude), longitude: String(longitude), hours: '24' });
  return request(`/air-quality/forecast?${query}`);
}
export async function geocodeLocation(name: string, countryCode?: string): Promise<LocationSearchResponse> {
  const query = new URLSearchParams({ name });
  if (countryCode) query.set('country_code', countryCode);
  return request(`/locations/search?${query}`);
}
export function prefersIndiaSearch(): boolean {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return timezone === 'Asia/Kolkata' || timezone === 'Asia/Calcutta' || navigator.language.toLowerCase().endsWith('-in');
}
export function formatPlaceName(place: GeocodedLocation): string {
  return [place.name, place.admin4, place.admin3, place.admin2, place.admin1, place.country]
    .filter((part, index, all): part is string => Boolean(part?.trim()) && all.indexOf(part) === index)
    .join(', ');
}
export const getSavedLocations = () => request<SavedLocation[]>('/locations/saved');
export const saveLocation = (input: Pick<SavedLocation, 'name' | 'latitude' | 'longitude' | 'place_label'>) => request<SavedLocation>('/locations/saved', { method: 'POST', body: JSON.stringify(input) });
export const updateSavedLocation = (id: string, input: Partial<Pick<SavedLocation, 'name' | 'latitude' | 'longitude' | 'place_label'>>) => request<SavedLocation>(`/locations/saved/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) });
export const deleteSavedLocation = (id: string) => request<void>(`/locations/saved/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const compareRoutes = (input: { origin: { latitude: number; longitude: number }; destination: { latitude: number; longitude: number }; departure_at: string; mode?: 'driving' }) =>
  request<RouteComparison>('/routes/compare', { method: 'POST', body: JSON.stringify({ ...input, mode: input.mode || 'driving' }) });

export async function register(display_name: string, email: string, password: string): Promise<AuthUser> {
  return rememberAuth(await request('/auth/register', { method: 'POST', body: JSON.stringify({ display_name, email, password }) }));
}
export async function login(email: string, password: string): Promise<AuthUser> {
  return rememberAuth(await request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }));
}
export async function loadCurrentUser(): Promise<AuthUser | null> {
  try { return rememberAuth(await request('/auth/me')); }
  catch { csrfToken = ''; return null; }
}
export async function logout(): Promise<void> { await request('/auth/logout', { method: 'POST' }); csrfToken = ''; }
export async function deleteAccount(): Promise<void> { await request('/auth/account', { method: 'DELETE' }); csrfToken = ''; }
export const getPreferences = () => request<Preferences>('/preferences');
export const savePreferences = (preferences: Preferences) => request<Preferences>('/preferences', { method: 'PUT', body: JSON.stringify(preferences) });
export const getPlannerSummary = () => request<PlannerSummary>('/planner/summary');
export const getExposureHistory = () => request<{ items: ExposureHistoryItem[] }>('/exposure/history');
export const getInterventions = () => request<{ items: Array<{ code: string; applied: boolean }> }>('/planner/interventions');
export const saveIntervention = (code: string, applied: boolean) => request(`/planner/interventions/${encodeURIComponent(code)}`, { method: 'PUT', body: JSON.stringify({ applied }) });
export const logDashboardAction = (event_type: 'filter_replacement' | 'mask_reminder', payload: Record<string, unknown> = {}) =>
  request('/dashboard/actions', { method: 'POST', body: JSON.stringify({ event_type, payload }) });

export function createExposureEstimate(input: {
  segments: Array<{ started_at: string; ended_at: string; concentration_ug_m3: number; concentration_kind: 'observed' | 'forecast' | 'modeled'; source: string; activity: string }>;
}) { return request('/exposure/estimates', { method: 'POST', body: JSON.stringify(input) }); }

export function createSimulation(input: {
  baseline: { concentration_ug_m3: number; duration_minutes: number; source: string; concentration_kind: 'observed' | 'forecast' | 'modeled' };
  alternative: { concentration_ug_m3: number; duration_minutes: number; source: string; concentration_kind: 'observed' | 'forecast' | 'modeled' };
  context?: Record<string, string | number | boolean>;
}): Promise<SimulationResult> { return request('/simulations', { method: 'POST', body: JSON.stringify(input) }); }

export const getRoutines = () => request<SavedRoutine[]>('/routines');
export const saveRoutine = (input: {
  title: string; corridor_id: string;
  simulation: Parameters<typeof createSimulation>[0];
}) => request<SavedRoutine>('/routines', { method: 'POST', body: JSON.stringify(input) });
