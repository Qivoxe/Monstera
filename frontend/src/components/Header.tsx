import React from 'react';
import { TabType } from '../types';
import { AuthUser } from '../api';

interface HeaderProps {
  activeTab: TabType;
  onChangeTab: (tab: TabType) => void;
  onOpenProfile: () => void;
  user: AuthUser;
  location: string;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  onChangeTab,
  onOpenProfile,
  user,
  location,
}) => {
  const navTabs: { id: TabType; label: string; icon: string }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: 'home' },
    { id: 'map', label: 'Pollution Map', icon: 'location_on' },
    { id: 'simulation', label: 'Simulation', icon: 'schedule' },
    { id: 'exposure', label: 'Exposure Plan', icon: 'energy_savings_leaf' },
  ];

  return (
    <header className="sticky top-0 w-full z-50 bg-[#f9faf5]/90 backdrop-blur-xl shadow-[0_1px_8px_rgba(0,0,0,0.03)] border-b border-[#edeee9]">
      <div className="max-w-7xl mx-auto h-16 px-6 flex items-center justify-between gap-8">
        {/* Zone 1: Wordmark & Regional Telemetry Indicator */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="h-9 w-9 rounded-xl bg-[#0c6440] flex items-center justify-center shrink-0 overflow-hidden shadow-xs">
            <img
              alt="Monstera Logo"
              className="h-8 w-8 object-contain"
              src="https://lh3.googleusercontent.com/aida/AEtjO1X06UqjYXs3ljuPFHVOx34OWSitOceisTrFhoFLVgIwIJonnB05mya5ZU6hUkeqrlCBPYLNEmABK0Xqvx0Fp0uXc4YUzn03VLG8nxzh9EYzPv64i_Eoncof58VfxjQr0AmBdrF1KTnWar0IFWnJQoTDg32FNjiw_O7XcCpyIvYp0zH619-smD1oYpGyE5q9LJZeDUooYWlHNVu2QgW6myW6PFoBlChOtimVQj_0VdUJIWrp0vEXUwHmqF0"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
                if (e.currentTarget.parentElement) {
                  e.currentTarget.parentElement.innerHTML = '<span class="material-symbols-outlined text-white text-[20px]">spa</span>';
                }
              }}
            />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="font-headline font-bold text-base text-[#1a1c19] tracking-tight whitespace-nowrap">
                Monstera
              </span>
              <span className="text-xs font-semibold text-[#0c6440] bg-[#c2ecdb] px-2 py-0.5 rounded-full">
                {location}
              </span>
            </div>
            <span className="text-[11px] font-mono text-[#3f4942] uppercase tracking-wider">
              Hyper-Local Air Intelligence
            </span>
          </div>
        </div>

        {/* Zone 2: Primary Web Navigation Tabs */}
        <nav className="flex items-center gap-2 bg-[#f3f4ef] p-1.5 rounded-full border border-[#e2e3de]">
          {navTabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onChangeTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap cursor-pointer ${
                  isActive
                    ? 'bg-white text-[#0c6440] font-semibold shadow-xs'
                    : 'text-[#3f4942] hover:text-[#1a1c19] hover:bg-white/60'
                }`}
              >
                <span
                  className="material-symbols-outlined text-[17px]"
                  style={isActive ? { fontVariationSettings: "'FILL' 1" } : undefined}
                >
                  {tab.icon}
                </span>
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        {/* User profile */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            aria-label="Open profile and health preferences"
            className="flex items-center gap-2 p-1 rounded-full hover:ring-2 hover:ring-[#0c6440]/30 transition-all active:scale-95 cursor-pointer"
            type="button"
            onClick={onOpenProfile}
          >
            <span className="w-9 h-9 rounded-full bg-[#0c6440] text-white flex items-center justify-center text-sm font-semibold" aria-hidden="true">
              {(user.display_name || user.email).slice(0, 1).toUpperCase()}
            </span>
          </button>
        </div>
      </div>
    </header>
  );
};
