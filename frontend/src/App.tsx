import { useEffect, useState } from 'react';
import { TabType } from './types';
import { AuthUser, loadCurrentUser, Preferences, getPreferences } from './api';
import { Header } from './components/Header';
import { ProfileModal } from './components/ProfileModal';
import { Toast } from './components/Toast';
import { DashboardView } from './views/DashboardView';
import { PollutionMapView } from './views/PollutionMapView';
import { SimulationView } from './views/SimulationView';
import { ExposurePlanView } from './views/ExposurePlanView';
import { WelcomeScreen } from './components/WelcomeScreen';

export default function App() {
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [profilePreferences, setProfilePreferences] = useState<Preferences | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    loadCurrentUser().then(async (user) => {
      setCurrentUser(user);
      if (user) {
        try { setProfilePreferences(await getPreferences()); }
        catch { setProfilePreferences(null); }
      }
    }).finally(() => setCheckingSession(false));
  }, []);

  const handleAuthChange = (user: AuthUser | null) => {
    setCurrentUser(user);
    if (!user) setProfilePreferences(null);
  };

  if (checkingSession) return <main className="min-h-screen bg-[#f9faf5] flex items-center justify-center text-sm text-[#3f4942]">Loading your Monstera account…</main>;
  if (!currentUser || !profilePreferences?.home_location || profilePreferences.home_latitude === null || profilePreferences.home_longitude === null) {
    return <WelcomeScreen key={currentUser?.id ?? 'new-user'} initialUser={currentUser} onComplete={(user, preferences) => { setCurrentUser(user); setProfilePreferences(preferences); }} />;
  }

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((curr) => (curr === msg ? null : curr));
    }, 3500);
  };

  const renderActiveView = () => {
    switch (activeTab) {
      case 'dashboard':
        return (
          <DashboardView
            onNavigateTab={(tab) => {
              setActiveTab(tab);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            user={currentUser}
            preferences={profilePreferences}
          />
        );
      case 'map':
        return (
          <PollutionMapView
            preferences={profilePreferences}
          />
        );
      case 'simulation':
        return (
          <SimulationView
            onShowToast={showToast}
            user={currentUser}
            preferences={profilePreferences}
          />
        );
      case 'exposure':
        return (
          <ExposurePlanView
            onShowToast={showToast}
            user={currentUser}
            preferences={profilePreferences}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-[#f9faf5] text-[#1a1c19] flex flex-col selection:bg-[#c2ecdb] selection:text-[#0c6440]">
      {/* Desktop Web Top Bar Navigation */}
      <Header
        activeTab={activeTab}
        onChangeTab={(tab) => {
          setActiveTab(tab);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onOpenProfile={() => setIsProfileOpen(true)}
        user={currentUser}
        location={profilePreferences.home_location}
      />

      {/* Main Desktop Web Content */}
      <main className="flex-1 w-full flex flex-col">
        {renderActiveView()}
      </main>

      {/* User Preferences & Health Sensitivity Modal */}
      <ProfileModal
        isOpen={isProfileOpen}
        onClose={() => setIsProfileOpen(false)}
        user={currentUser}
        onAuthChange={handleAuthChange}
        preferences={profilePreferences}
        onPreferencesChange={setProfilePreferences}
        onShowToast={showToast}
      />

      {/* Toast Confirmation Notification */}
      <Toast
        message={toastMessage}
        onClose={() => setToastMessage(null)}
      />
    </div>
  );
}
