import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import Navbar from './components/Navbar';
import HeroTelemetry from './components/HeroTelemetry';
import TelemetryCharts from './components/TelemetryCharts';
import ZoneExplorer from './components/ZoneExplorer';
import ReadingsTable from './components/ReadingsTable';
import EmergencyRequestsView from './components/EmergencyRequestsView';
import ReliefInventoryView from './components/ReliefInventoryView';
import VolunteersTeamsView from './components/VolunteersTeamsView';
import ReliefIntelligenceView from './components/ReliefIntelligenceView';
// Three.js is heavy (~800 kB) and only needed on the Flood Map tab, so load it on demand.
const NagpurMap = lazy(() => import('./components/NagpurMap'));
import DeviceConnectModal from './components/DeviceConnectModal';
import SimulatorModal from './components/SimulatorModal';
import SOSSimulatorModal from './components/SOSSimulatorModal';
import SettingsModal from './components/SettingsModal';
import CriticalAlertPopup from './components/CriticalAlertPopup';
import LandingPage from './components/LandingPage';
import { fetchHealth, fetchZones, fetchLatestReading, fetchReadingHistory, getBaseUrl } from './api/client';
import { getNotificationPermission, requestNotificationPermission, sendCriticalPushNotification } from './utils/notifications';
import { startContinuousBuzzer, stopContinuousBuzzer, setBuzzerMuted } from './utils/buzzer';

export default function App() {
  const [backendOnline, setBackendOnline] = useState(false);
  const [zones, setZones] = useState([]);
  const [selectedZone, setSelectedZone] = useState('Z001');
  const [latestReading, setLatestReading] = useState(null);
  const [history, setHistory] = useState([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(2000);
  const [activeTab, setActiveTab] = useState('landing');
  const [showLanding, setShowLanding] = useState(true);
  const [notifPermission, setNotifPermission] = useState(() => getNotificationPermission());
  const [alertPopupData, setAlertPopupData] = useState(null);
  const [isSirenMuted, setIsSirenMuted] = useState(false);
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('floodguard_theme') || 'dark';
    } catch {
      return 'dark';
    }
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('floodguard_theme', theme);
    } catch {}
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  }, []);

  const handleRequestNotification = useCallback(async () => {
    const res = await requestNotificationPermission();
    setNotifPermission(res);
  }, []);

  // Modals
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [showSimulatorModal, setShowSimulatorModal] = useState(false);
  const [showSOSModal, setShowSOSModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  // Initial Load: Zones and Health
  const loadInitialData = useCallback(async () => {
    try {
      const health = await fetchHealth();
      setBackendOnline(health?.status === 'ok');

      const zonesData = await fetchZones();
      if (zonesData && zonesData.length > 0) {
        setZones(zonesData);
      }
    } catch (err) {
      console.warn('Initial load warning:', err.message);
      setBackendOnline(false);
    }
  }, []);

  // Fetch Telemetry for current zone
  const loadTelemetry = useCallback(async (showLoading = false) => {
    if (showLoading) setIsRefreshing(true);
    try {
      const [latest, hist] = await Promise.all([
        fetchLatestReading(selectedZone),
        fetchReadingHistory(selectedZone, 50),
      ]);
      setLatestReading(latest);
      setHistory(hist || []);
      setBackendOnline(true);
    } catch (err) {
      console.warn('Telemetry sync error:', err.message);
    } finally {
      if (showLoading) setTimeout(() => setIsRefreshing(false), 400);
    }
  }, [selectedZone]);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  useEffect(() => {
    loadTelemetry(true);
    const timer = setInterval(() => {
      loadTelemetry(false);
    }, refreshInterval);
    return () => clearInterval(timer);
  }, [selectedZone, refreshInterval, loadTelemetry]);

  // Continuous Siren & Push Notification Management:
  // Starts continuous buzzing when CRITICAL and keeps buzzing until status changes to any other state.
  const prevRiskRef = useRef({});
  useEffect(() => {
    if (!latestReading) {
      stopContinuousBuzzer();
      return;
    }
    const espStatus = (latestReading.local_status || '').toUpperCase();
    const aiRisk = (latestReading.risk_level || 'SAFE').toUpperCase();
    const currentRisk = ['SAFE', 'WARNING', 'DANGER', 'CRITICAL'].includes(espStatus) ? espStatus : aiRisk;
    const zoneId = latestReading.zone_id || selectedZone;

    if (currentRisk === 'CRITICAL') {
      startContinuousBuzzer();
      setAlertPopupData({
        zoneId,
        waterLevel: latestReading.water_level_cm,
        trend: latestReading.water_trend_cm_per_hour,
        probability: latestReading.flood_probability,
        observedAt: latestReading.observed_at,
      });
      if (prevRiskRef.current[zoneId] !== 'CRITICAL') {
        setIsSirenMuted(false);
        sendCriticalPushNotification(zoneId, {
          waterLevel: latestReading.water_level_cm,
          trend: latestReading.water_trend_cm_per_hour,
          probability: latestReading.flood_probability,
        });
      }
    } else {
      // Immediately stop siren and hide popup when status drops below CRITICAL
      stopContinuousBuzzer();
      setAlertPopupData(null);
      setIsSirenMuted(false);
    }
    prevRiskRef.current[zoneId] = currentRisk;
  }, [latestReading, selectedZone]);

  useEffect(() => {
    return () => {
      stopContinuousBuzzer();
    };
  }, []);

  const selectedZoneInfo = zones.find((z) => z.zone_id === selectedZone);
  const activeServer = getBaseUrl() || `${window.location.hostname}:8000`;

  const enterDashboard = useCallback((tab = 'live') => {
    setShowLanding(false);
    setActiveTab(tab);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  if (showLanding) {
    return (
      <div style={{ minHeight: '100vh', background: '#09090b' }}>
        <LandingPage
          onEnterDashboard={() => enterDashboard('live')}
          onViewZones={() => enterDashboard('zones')}
        />
        {/* keep popups even on landing if critical */}
        <CriticalAlertPopup
          alertData={alertPopupData}
          onClose={() => setAlertPopupData(null)}
          onMuteToggle={() => {
            setIsSirenMuted((prev) => {
              const next = !prev;
              setBuzzerMuted(next);
              return next;
            });
          }}
          isMuted={isSirenMuted}
        />
      </div>
    );
  }

  return (
    <div className="app-shell" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
      {/* Top Navigation - includes entry back to landing */}
      <Navbar
        backendOnline={backendOnline}
        selectedZone={selectedZone}
        zones={zones}
        onSelectZone={(z) => {
          setSelectedZone(z);
          setActiveTab('live');
        }}
        onRefresh={() => loadTelemetry(true)}
        isRefreshing={isRefreshing}
        onOpenSimulator={() => setShowSimulatorModal(true)}
        onOpenSOSModal={() => setShowSOSModal(true)}
        onOpenConnectModal={() => setShowConnectModal(true)}
        onOpenSettingsModal={() => setShowSettingsModal(true)}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        theme={theme}
        onToggleTheme={toggleTheme}
        notifPermission={notifPermission}
        onRequestNotification={handleRequestNotification}
        onShowLanding={() => setShowLanding(true)}
      />

      {/* Main Content Area */}
      <main className="dashboard-main" style={{ maxWidth: '1440px', margin: '0 auto', width: '100%', padding: '24px', flex: 1 }}>
        {activeTab === 'live' ? (
          <div className="dashboard-stack" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {/* Live Telemetry Hero Widget */}
            <HeroTelemetry latest={latestReading} zoneInfo={selectedZoneInfo} />

            {/* Live Charts & Visual Analytics */}
            <TelemetryCharts history={history} />

            {/* Ingestion Data Log Table */}
            <ReadingsTable history={history} selectedZone={selectedZone} />
          </div>
        ) : activeTab === 'requests' ? (
          /* Emergency Requests and SOS Module */
          <EmergencyRequestsView
            selectedZone={selectedZone}
            zones={zones}
            onSelectZone={(z) => {
              setSelectedZone(z);
              setActiveTab('live');
            }}
          />
        ) : activeTab === 'inventory' ? (
          /* Relief Inventory & Stock Management Module */
          <ReliefInventoryView
            onNavigateToRequests={() => setActiveTab('requests')}
          />
        ) : activeTab === 'teams' ? (
          /* Response Teams & Volunteer Coordination Module */
          <VolunteersTeamsView
            onNavigateToRequests={() => setActiveTab('requests')}
          />
        ) : activeTab === 'intelligence' ? (
          /* Phase 4: Relief Intelligence & Smart Prioritization */
          <ReliefIntelligenceView
            onNavigateToRequests={() => setActiveTab('requests')}
            onNavigateToInventory={() => setActiveTab('inventory')}
            onNavigateToTeams={() => setActiveTab('teams')}
          />
        ) : activeTab === 'map' ? (
          /* Nagpur Flood Map (2D / 3D) */
          <Suspense fallback={<div className="glass-card map-loading-state" style={{ height: '560px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>Loading map engine...</div>}>
            <NagpurMap
              selectedZone={selectedZone}
              latestReading={latestReading}
              onSelectZone={(z) => {
                setSelectedZone(z);
                setActiveTab('live');
              }}
            />
          </Suspense>
        ) : (
          /* Nagpur Geo-Risk Zone Directory */
          <ZoneExplorer
            zones={zones}
            selectedZone={selectedZone}
            onSelectZone={(z) => {
              setSelectedZone(z);
              setActiveTab('live');
            }}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="app-footer" style={{
        borderTop: '1px solid var(--border-subtle)',
        padding: '16px 24px',
        textAlign: 'center',
        fontSize: '0.75rem',
        color: 'var(--text-muted)',
        background: 'var(--bg-surface-glass)'
      }}>
        FloodGuard Nagpur &bull; IoT Drainage Telemetry & Early Warning System &bull; Active Server: <span style={{ color: 'var(--text-primary)' }}>{activeServer}</span>
      </footer>

      {/* Modals */}
      <DeviceConnectModal
        isOpen={showConnectModal}
        onClose={() => setShowConnectModal(false)}
      />

      <SimulatorModal
        isOpen={showSimulatorModal}
        onClose={() => setShowSimulatorModal(false)}
        selectedZone={selectedZone}
        onReadingSent={(res) => {
          if (res) {
            setLatestReading(res);
            const status = (res.local_status || res.risk_level || '').toUpperCase();
            if (status === 'CRITICAL') {
              startContinuousBuzzer();
            } else {
              stopContinuousBuzzer();
            }
          }
          loadTelemetry(false);
        }}
      />

      <SOSSimulatorModal
        isOpen={showSOSModal}
        onClose={() => setShowSOSModal(false)}
        selectedZone={selectedZone}
        zones={zones}
        onRequestCreated={() => {
          // If created, can stay or switch
        }}
        onNavigateToRequests={() => {
          setActiveTab('requests');
        }}
      />

      <SettingsModal
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        refreshInterval={refreshInterval}
        setRefreshInterval={setRefreshInterval}
        onSettingsSaved={() => {
          loadInitialData();
          loadTelemetry(true);
        }}
      />

      {/* On-Screen Critical Push Notification Popup */}
      <CriticalAlertPopup
        alertData={alertPopupData}
        onClose={() => setAlertPopupData(null)}
        onMuteToggle={() => {
          setIsSirenMuted((prev) => {
            const next = !prev;
            setBuzzerMuted(next);
            return next;
          });
        }}
        isMuted={isSirenMuted}
      />
    </div>
  );
}
