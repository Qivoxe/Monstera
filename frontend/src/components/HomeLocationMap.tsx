import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface HomeLocationMapProps { latitude: number; longitude: number; label: string }

export function HomeLocationMap({ latitude, longitude, label }: HomeLocationMapProps) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!container.current) return;
    const map = L.map(container.current, { center: [latitude, longitude], zoom: 11, zoomControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    L.circleMarker([latitude, longitude], { radius: 9, color: '#0c6440', fillColor: '#a4f3c5', fillOpacity: 0.9 })
      .bindPopup(`${label} (saved home location)`)
      .addTo(map);
    return () => { map.remove(); };
  }, [latitude, longitude, label]);
  return <div ref={container} className="h-[420px] w-full rounded-2xl overflow-hidden border border-[#e2e3de]" aria-label={`Map centered on ${label}`} />;
}
