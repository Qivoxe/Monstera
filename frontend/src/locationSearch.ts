export interface GeocodedLocation {
  id?: number;
  name: string;
  country: string | null;
  country_code?: string | null;
  admin1?: string | null;
  admin2?: string | null;
  admin3?: string | null;
  admin4?: string | null;
  latitude: number;
  longitude: number;
}

export interface LocationSearchResponse extends Partial<GeocodedLocation> {
  results: GeocodedLocation[];
}

function isGeocodedLocation(value: unknown): value is GeocodedLocation {
  if (typeof value !== 'object' || value === null) return false;
  const place = value as Record<string, unknown>;
  return typeof place.name === 'string'
    && (place.country === null || typeof place.country === 'string' || place.country === undefined)
    && typeof place.latitude === 'number' && Number.isFinite(place.latitude)
    && typeof place.longitude === 'number' && Number.isFinite(place.longitude);
}

/** Normalize the current list response and the legacy single-place response. */
export function normalizeLocationSearchResponse(payload: unknown): LocationSearchResponse {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('Location search returned an invalid response. Please try again.');
  }
  const response = payload as Record<string, unknown>;
  if (Array.isArray(response.results)) {
    if (!response.results.every(isGeocodedLocation)) {
      throw new Error('Location search returned an invalid response. Please try again.');
    }
    return { results: response.results };
  }
  if (isGeocodedLocation(response)) return { ...response, results: [response] };
  throw new Error('Location search returned an invalid response. Please try again.');
}
