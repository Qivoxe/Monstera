import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { RouteAlternative, SavedLocation } from '../api';

interface Props {
  center: { latitude: number; longitude: number; label: string };
  home: { latitude: number; longitude: number; label: string };
  savedPlaces: SavedLocation[];
  routes: RouteAlternative[];
  selectedRouteId: string | null;
}

export function PollutionMapCanvas({ center, home, savedPlaces, routes, selectedRouteId }: Props) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!container.current) return;
    const map = L.map(container.current, { center: [center.latitude, center.longitude], zoom: 11 });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    const markers = L.layerGroup().addTo(map);
    L.circleMarker([home.latitude, home.longitude], { radius: 8, color: '#0c6440', fillColor: '#a4f3c5', fillOpacity: 0.9 })
      .bindPopup(`${home.label} · saved home`).addTo(markers);
    savedPlaces.forEach((place) => L.circleMarker([place.latitude, place.longitude], { radius: 7, color: '#406659', fillColor: '#c2ecdb', fillOpacity: 0.9 })
      .bindPopup(`${place.name}${place.place_label ? ` · ${place.place_label}` : ''}`).addTo(markers));
    if (center.latitude !== home.latitude || center.longitude !== home.longitude) {
      L.circleMarker([center.latitude, center.longitude], { radius: 10, color: '#b97816', fillColor: '#ffda8a', fillOpacity: 0.95 })
        .bindPopup(center.label).addTo(markers);
    }
    const routeLayers = routes.map((route, index) => L.geoJSON(route.geometry as GeoJSON.GeoJsonObject, {
      style: { color: route.id === selectedRouteId ? '#0c6440' : ['#7c5aa6', '#d78027', '#3478a5'][index % 3], weight: route.id === selectedRouteId ? 7 : 4, opacity: route.id === selectedRouteId ? 0.9 : 0.65 },
    }).addTo(map));
    const bounds: L.LatLngExpression[] = [[center.latitude, center.longitude], [home.latitude, home.longitude]];
    savedPlaces.forEach((place) => bounds.push([place.latitude, place.longitude]));
    routes.forEach((route) => route.geometry.coordinates.forEach(([lon, lat]) => bounds.push([lat, lon])));
    if (routes.length) map.fitBounds(L.latLngBounds(bounds), { padding: [24, 24], maxZoom: 12 });
    return () => { routeLayers.forEach((layer) => layer.remove()); map.remove(); };
  }, [center.latitude, center.longitude, center.label, home.latitude, home.longitude, home.label, savedPlaces, routes, selectedRouteId]);
  return <div ref={container} className="h-[390px] w-full rounded-2xl overflow-hidden border border-[#e2e3de]" aria-label="Map showing saved places and route alternatives" />;
}
