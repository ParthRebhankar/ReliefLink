import React from 'react';
import {
  ShieldAlert,
  MapPin,
  Activity,
  Map,
  Sun,
  Moon,
  Bell,
  BellRing,
  BellOff,
  Sliders,
  Cpu,
  RefreshCw,
  Settings,
  LifeBuoy,
  Radio,
  Package,
  Users,
  Brain
} from 'lucide-react';

export default function Navbar({
  backendOnline,
  selectedZone,
  zones,
  onSelectZone,
  onRefresh,
  isRefreshing,
  onOpenSimulator,
  onOpenSOSModal,
  onOpenConnectModal,
  onOpenSettingsModal,
  activeTab,
  setActiveTab,
  theme = 'dark',
  onToggleTheme,
  notifPermission = 'default',
  onRequestNotification,
  onShowLanding
}) {
  return (
    <header className="dashboard-nav">
      <div className="dashboard-nav__inner">
        {/* Brand */}
        <div className="dashboard-brand">
          <button
            onClick={onShowLanding}
            className="dashboard-brand__mark"
            title={onShowLanding ? 'Back to landing' : undefined}
            aria-label="Back to landing"
          >
            <ShieldAlert size={18} strokeWidth={2.4} />
          </button>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <h1 style={{
                fontSize: '1rem',
                fontWeight: 700,
                color: 'var(--text-primary)',
                letterSpacing: '-0.01em',
                lineHeight: 1.1,
                margin: 0
              }}>
                FloodGuard
              </h1>
              {onShowLanding && (
                <button
                  onClick={onShowLanding}
                  style={{
                    fontSize: '0.625rem',
                    fontWeight: 600,
                    letterSpacing: '0.03em',
                    textTransform: 'uppercase',
                    color: 'var(--text-muted)',
                    background: 'var(--bg-surface-elevated)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '999px',
                    padding: '1px 6px',
                    cursor: 'pointer',
                    lineHeight: 1.4
                  }}
                >
                  Landing
                </button>
              )}
            </div>
            <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1 }}>
              Nagpur Smart Drainage
            </p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="dashboard-tabs" aria-label="Main navigation">
          <NavTab
            active={activeTab === 'live'}
            onClick={() => setActiveTab('live')}
            icon={<Activity size={13} />}
            label="Live"
          />
          <NavTab
            active={activeTab === 'requests'}
            onClick={() => setActiveTab('requests')}
            icon={<LifeBuoy size={13} />}
            label="SOS & Requests"
          />
          <NavTab
            active={activeTab === 'inventory'}
            onClick={() => setActiveTab('inventory')}
            icon={<Package size={13} />}
            label="Inventory"
          />
          <NavTab
            active={activeTab === 'teams'}
            onClick={() => setActiveTab('teams')}
            icon={<Users size={13} />}
            label="Teams"
          />
          <NavTab
            active={activeTab === 'intelligence'}
            onClick={() => setActiveTab('intelligence')}
            icon={<Brain size={13} />}
            label="Intelligence"
          />
          <NavTab
            active={activeTab === 'zones'}
            onClick={() => setActiveTab('zones')}
            icon={<MapPin size={13} />}
            label={`Zones (${zones ? zones.length : 0})`}
          />
          <NavTab
            active={activeTab === 'map'}
            onClick={() => setActiveTab('map')}
            icon={<Map size={13} />}
            label="Map"
          />
        </nav>

        {/* Controls */}
        <div className="dashboard-controls">
          {/* Status indicator */}
          <div
            className="backend-status"
            style={{
              background: backendOnline ? 'var(--status-safe-bg)' : 'var(--status-critical-bg)',
              border: `1px solid ${backendOnline ? 'var(--status-safe)' : 'var(--status-critical)'}`,
              color: backendOnline ? 'var(--status-safe)' : 'var(--status-critical)'
            }}
          >
            <span className={`live-indicator ${backendOnline ? 'online' : 'offline'}`}></span>
            {backendOnline ? 'Online' : 'Offline'}
          </div>

          {/* Zone selector */}
          <div className="zone-switcher">
            <MapPin size={12} color="var(--text-secondary)" />
            <select
              value={selectedZone}
              onChange={(e) => onSelectZone(e.target.value)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-primary)',
                outline: 'none',
                cursor: 'pointer',
                fontFamily: 'var(--font-mono)'
              }}
            >
              {zones && zones.length > 0 ? (
                zones.map((z) => (
                  <option key={z.zone_id} value={z.zone_id} style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)' }}>
                    {z.zone_id}
                  </option>
                ))
              ) : (
                <option value="Z001">Z001</option>
              )}
            </select>
          </div>

          {/* Action buttons */}
          <button
            onClick={onOpenSOSModal}
            className="btn-primary"
            style={{
              background: 'var(--alarm)',
              borderColor: 'var(--alarm)',
              color: '#fff'
            }}
            title="Simulate incoming SOS beacon"
          >
            <Radio size={13} className="pulse-icon" />
            <span>SOS</span>
          </button>

          <button
            onClick={onOpenSimulator}
            className="btn-secondary"
            title="Simulate telemetry readings"
          >
            <Sliders size={13} />
            <span>Simulate</span>
          </button>

          <button
            onClick={onOpenConnectModal}
            className="btn-primary"
            title="Connect ESP32 device"
          >
            <Cpu size={13} />
            <span>Connect</span>
          </button>

          {/* Icon buttons */}
          <button
            onClick={onRequestNotification}
            className="btn-icon"
            style={{
              color: notifPermission === 'granted' ? 'var(--status-safe)' :
                     notifPermission === 'denied' ? 'var(--status-critical)' :
                     'var(--text-secondary)',
              borderColor: notifPermission === 'granted' ? 'var(--status-safe)' : 'var(--border-medium)',
              position: 'relative'
            }}
            title={
              notifPermission === 'granted' ? 'Notifications enabled' :
              notifPermission === 'denied' ? 'Notifications blocked' :
              'Enable notifications'
            }
          >
            {notifPermission === 'granted' ? <BellRing size={14} /> :
             notifPermission === 'denied' ? <BellOff size={14} /> :
             <Bell size={14} />}
            {notifPermission === 'granted' && (
              <span style={{
                position: 'absolute',
                top: '6px',
                right: '6px',
                width: '4px',
                height: '4px',
                borderRadius: '50%',
                background: 'var(--status-safe)'
              }} />
            )}
          </button>

          <button
            onClick={onToggleTheme}
            className="btn-icon"
            title={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
          >
            {theme === 'light' ? <Moon size={14} /> : <Sun size={14} />}
          </button>

          <button
            onClick={onRefresh}
            className="btn-icon"
            title="Refresh telemetry"
          >
            <RefreshCw
              size={14}
              style={{
                transform: isRefreshing ? 'rotate(360deg)' : 'none',
                transition: isRefreshing ? 'transform 0.8s linear' : 'none'
              }}
            />
          </button>

          <button
            onClick={onOpenSettingsModal}
            className="btn-icon"
            title="System Settings"
          >
            <Settings size={14} />
          </button>
        </div>
      </div>
    </header>
  );
}

function NavTab({ active, onClick, icon, label }) {
  return (
    <button
      onClick={onClick}
      className={`nav-tab${active ? ' is-active' : ''}`}
      aria-current={active ? 'page' : undefined}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
