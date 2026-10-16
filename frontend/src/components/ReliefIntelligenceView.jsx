/**
 * ReliefIntelligenceView.jsx
 * Phase 4: Relief Intelligence, Smart Prioritization & Impact Analytics
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Brain, RefreshCw, Download, AlertTriangle, CheckCircle, Clock,
  Users, Package, Zap, TrendingUp, Filter, Eye, EyeOff, Info,
  ChevronDown, ChevronUp, BarChart2, Map, Shield, AlertCircle,
  Flame, Activity, ArrowUpRight, FileText, Database, XCircle
} from 'lucide-react';
import {
  BarChart, Bar, PieChart, Pie, Cell, AreaChart, Area,
  XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid
} from 'recharts';
import {
  fetchIntelligenceOverview,
  fetchIntelligencePriorities,
  fetchIntelligenceZoneGaps,
  fetchIntelligenceRecommendations,
  fetchIntelligenceImpact,
  seedIntelligenceDemo,
  getIntelligenceExportUrl,
  overrideRequestPriority
} from '../api/client';

// ─────────────────────────────────────────────────────────────────────────────
// Colours and helpers
// ─────────────────────────────────────────────────────────────────────────────
const BAND_COLORS = {
  Critical: '#ef4444',
  High: '#f97316',
  Medium: '#eab308',
  Low: '#22c55e',
  Fulfilled: '#6b7280',
};

const SEVERITY_COLORS = {
  CRITICAL: '#ef4444',
  HIGH: '#f97316',
  MEDIUM: '#eab308',
  LOW: '#22c55e',
};

const HAZARD_COLORS = {
  CRITICAL: '#ef4444',
  DANGER: '#f97316',
  WARNING: '#eab308',
  WATCH: '#3b82f6',
  SAFE: '#22c55e',
  NO_DATA: '#6b7280',
};

const PIE_COLORS = ['#22c55e', '#f97316', '#6b7280', '#ef4444'];

function bandColor(band) { return BAND_COLORS[band] || '#6b7280'; }
function hazardColor(status) { return HAZARD_COLORS[status] || '#6b7280'; }

function formatWait(hours) {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function relTime(isoStr) {
  if (!isoStr) return 'N/A';
  const dt = new Date(isoStr);
  const diffMs = Date.now() - dt;
  const diffMins = Math.round(diffMs / 60000);
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
  return `${Math.floor(diffMins / 1440)}d ago`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function MetricCard({ icon, label, value, sub, color = 'var(--text-primary)', urgent = false }) {
  return (
    <div style={{
      background: urgent ? 'rgba(239,68,68,0.08)' : 'var(--bg-surface-elevated)',
      border: `1px solid ${urgent ? 'rgba(239,68,68,0.3)' : 'var(--border-subtle)'}`,
      borderRadius: '12px',
      padding: '18px 20px',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      minWidth: 0,
      transition: 'transform 0.15s ease, box-shadow 0.15s ease',
    }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.15)'; }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
        <span style={{ color }}>{icon}</span>
        <span style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>{label}</span>
      </div>
      <div style={{ fontSize: '2rem', fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{sub}</div>}
    </div>
  );
}

function BandPill({ band, overridden }) {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px',
      padding: '3px 10px',
      borderRadius: '999px',
      background: bandColor(band) + '22',
      border: `1px solid ${bandColor(band)}55`,
      color: bandColor(band),
      fontSize: '0.7rem',
      fontWeight: 700,
      letterSpacing: '0.04em',
    }}>
      {overridden && <Shield size={10} />}
      {band}
    </span>
  );
}

function HazardBadge({ status }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: '999px',
      background: hazardColor(status) + '22',
      border: `1px solid ${hazardColor(status)}55`,
      color: hazardColor(status),
      fontSize: '0.68rem',
      fontWeight: 700,
    }}>{status}</span>
  );
}

function SectionHeader({ icon, title, subtitle }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '20px' }}>
      <div style={{
        width: '40px', height: '40px', borderRadius: '10px',
        background: 'var(--accent-primary)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0
      }}>
        {icon}
      </div>
      <div>
        <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>{title}</h2>
        {subtitle && <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>{subtitle}</p>}
      </div>
    </div>
  );
}

// Expandable score breakdown popup
function ScoreBreakdown({ item, onClose }) {
  const s = item.score_breakdown;
  const bars = [
    { label: 'Severity', score: s.severity_score, max: 40, color: '#ef4444' },
    { label: 'Waiting Time', score: s.waiting_time_score, max: 20, color: '#f97316' },
    { label: 'Flood Hazard', score: s.flood_hazard_score, max: 15, color: '#3b82f6' },
    { label: 'Unmet Needs', score: s.unmet_needs_score, max: 15, color: '#a855f7' },
    { label: 'Vulnerability', score: s.vulnerability_score, max: 10, color: '#ec4899' },
  ];

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px'
    }} onClick={onClose}>
      <div style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-medium)',
        borderRadius: '16px',
        padding: '28px',
        maxWidth: '540px',
        width: '100%',
        maxHeight: '80vh',
        overflowY: 'auto',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Priority Score Breakdown</h3>
            <p style={{ margin: '4px 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>{item.request_id} — {item.household_label}</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '4px' }}>
            <XCircle size={20} />
          </button>
        </div>

        {/* Total score */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '16px',
          padding: '16px', borderRadius: '12px',
          background: bandColor(item.effective_band) + '15',
          border: `1px solid ${bandColor(item.effective_band)}30`,
          marginBottom: '20px'
        }}>
          <div style={{ fontSize: '2.5rem', fontWeight: 800, color: bandColor(item.effective_band) }}>
            {item.priority_score}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>
              <BandPill band={item.effective_band} overridden={item.is_overridden} /> priority
            </div>
            {item.is_overridden && (
              <div style={{ fontSize: '0.7rem', color: '#f97316', marginTop: '4px' }}>
                ⚡ Coordinator override applied
              </div>
            )}
          </div>
        </div>

        {/* Score bars */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>
          {bars.map(b => (
            <div key={b.label}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '0.78rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>{b.label}</span>
                <span style={{ fontWeight: 700, color: b.color }}>{b.score} / {b.max}</span>
              </div>
              <div style={{ height: '6px', background: 'var(--border-subtle)', borderRadius: '99px', overflow: 'hidden' }}>
                <div style={{
                  height: '100%', width: `${(b.score / b.max) * 100}%`,
                  background: b.color, borderRadius: '99px',
                  transition: 'width 0.6s ease'
                }} />
              </div>
            </div>
          ))}
        </div>

        {/* Explanations */}
        <div style={{ marginBottom: '16px' }}>
          <p style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Score Explanations
          </p>
          {item.explanations.map((exp, i) => (
            <div key={i} style={{
              fontSize: '0.78rem', color: 'var(--text-secondary)',
              padding: '6px 10px', borderLeft: '3px solid var(--border-medium)',
              marginBottom: '4px', background: 'var(--bg-surface-elevated)',
              borderRadius: '0 6px 6px 0'
            }}>{exp}</div>
          ))}
        </div>

        {/* Review flags */}
        {item.needs_human_review && (
          <div style={{
            background: '#f97316' + '15', border: '1px solid #f97316' + '30',
            borderRadius: '10px', padding: '12px'
          }}>
            <p style={{ fontSize: '0.75rem', fontWeight: 700, color: '#f97316', margin: '0 0 6px' }}>⚠ Requires Human Review</p>
            {item.review_reasons.map((r, i) => (
              <div key={i} style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>• {r}</div>
            ))}
          </div>
        )}

        {/* Stale hazard */}
        {item.latest_hazard_reading?.is_stale && (
          <div style={{
            background: '#eab308' + '15', border: '1px solid #eab308' + '30',
            borderRadius: '10px', padding: '12px', marginTop: '10px'
          }}>
            <p style={{ fontSize: '0.78rem', color: '#eab308', margin: 0 }}>
              ⚠ Zone {item.zone_id} hazard telemetry is stale ({item.latest_hazard_reading.age_hours}h old). 
              Hazard score omitted per safety rule.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// Priority Override Modal
function PriorityOverrideModal({ item, onClose, onSuccess }) {
  const [band, setBand] = useState('');
  const [reason, setReason] = useState('');
  const [changedBy, setChangedBy] = useState('Coordinator');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!band) { setError('Select a target priority band.'); return; }
    if (reason.trim().length < 5) { setError('Reason must be at least 5 characters (safety requirement).'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await overrideRequestPriority(item.request_id, {
        overridden_band: band,
        reason: reason.trim(),
        changed_by: changedBy.trim() || 'Coordinator',
      });
      onSuccess(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1010,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px'
    }} onClick={onClose}>
      <div style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border-medium)',
        borderRadius: '16px', padding: '28px', maxWidth: '480px', width: '100%'
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Shield size={18} style={{ color: '#f97316' }} /> Coordinator Priority Override
            </h3>
            <p style={{ margin: '4px 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>{item.request_id}</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
            <XCircle size={20} />
          </button>
        </div>

        <div style={{
          background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.2)',
          borderRadius: '10px', padding: '12px', marginBottom: '20px', fontSize: '0.78rem', color: '#f97316'
        }}>
          <strong>Safety Requirement:</strong> Override reason must be specific and will be permanently audit-logged.
          Current band: <BandPill band={item.effective_band} overridden={item.is_overridden} />
          &nbsp;(Score: {item.priority_score})
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
              Target Priority Band *
            </label>
            <select
              value={band}
              onChange={e => setBand(e.target.value)}
              required
              style={{
                width: '100%', padding: '10px 12px', borderRadius: '8px',
                background: 'var(--bg-surface-elevated)',
                border: '1px solid var(--border-medium)', color: 'var(--text-primary)',
                fontSize: '0.875rem'
              }}
            >
              <option value="">Select target band...</option>
              {['Critical', 'High', 'Medium', 'Low'].map(b => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
              Override Reason (mandatory) *
            </label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Specific operational reason for this override (e.g. field reconnaissance confirms worsening conditions)..."
              required
              rows={4}
              style={{
                width: '100%', padding: '10px 12px', borderRadius: '8px',
                background: 'var(--bg-surface-elevated)',
                border: '1px solid var(--border-medium)', color: 'var(--text-primary)',
                fontSize: '0.875rem', resize: 'vertical', fontFamily: 'inherit',
                boxSizing: 'border-box'
              }}
            />
            <div style={{ fontSize: '0.68rem', color: reason.trim().length < 5 ? '#ef4444' : 'var(--text-muted)', marginTop: '4px' }}>
              {reason.trim().length}/500 characters (minimum 5)
            </div>
          </div>

          <div>
            <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
              Your Name / Role
            </label>
            <input
              value={changedBy}
              onChange={e => setChangedBy(e.target.value)}
              placeholder="Coordinator name or role"
              style={{
                width: '100%', padding: '10px 12px', borderRadius: '8px',
                background: 'var(--bg-surface-elevated)',
                border: '1px solid var(--border-medium)', color: 'var(--text-primary)',
                fontSize: '0.875rem', boxSizing: 'border-box'
              }}
            />
          </div>

          {error && (
            <div style={{
              padding: '10px 14px', background: 'rgba(239,68,68,0.1)',
              border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px',
              fontSize: '0.8rem', color: '#ef4444'
            }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '4px' }}>
            <button type="button" onClick={onClose} style={{
              padding: '10px 20px', borderRadius: '8px',
              background: 'var(--bg-surface-elevated)',
              border: '1px solid var(--border-medium)', cursor: 'pointer',
              color: 'var(--text-primary)', fontSize: '0.875rem'
            }}>Cancel</button>
            <button type="submit" disabled={loading || reason.trim().length < 5 || !band} style={{
              padding: '10px 20px', borderRadius: '8px',
              background: loading ? 'var(--border-medium)' : '#f97316',
              border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
              color: '#fff', fontSize: '0.875rem', fontWeight: 700,
              opacity: (reason.trim().length < 5 || !band) ? 0.5 : 1
            }}>
              {loading ? 'Saving...' : 'Apply Override (Audit Logged)'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────
export default function ReliefIntelligenceView({ onNavigateToRequests, onNavigateToInventory, onNavigateToTeams }) {
  const [overview, setOverview] = useState(null);
  const [priorities, setPriorities] = useState([]);
  const [zoneGaps, setZoneGaps] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [impact, setImpact] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeSection, setActiveSection] = useState('overview');
  const [filters, setFilters] = useState({ severity: '', category: '', band: '', zone_id: '' });
  const [selectedItem, setSelectedItem] = useState(null);
  const [overrideItem, setOverrideItem] = useState(null);
  const [seeding, setSeeding] = useState(false);
  const [seedMsg, setSeedMsg] = useState('');
  const [expandedRec, setExpandedRec] = useState(null);
  const exportUrl = getIntelligenceExportUrl();

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [ov, prio, gaps, recs, imp] = await Promise.all([
        fetchIntelligenceOverview(),
        fetchIntelligencePriorities(filters),
        fetchIntelligenceZoneGaps(),
        fetchIntelligenceRecommendations(),
        fetchIntelligenceImpact(),
      ]);
      setOverview(ov);
      setPriorities(prio);
      setZoneGaps(gaps);
      setRecommendations(recs);
      setImpact(imp);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const handleSeed = async () => {
    setSeeding(true);
    setSeedMsg('');
    try {
      const r = await seedIntelligenceDemo();
      setSeedMsg(`✓ ${r.message}`);
      await loadAll();
    } catch (err) {
      setSeedMsg(`Error: ${err.message}`);
    } finally {
      setSeeding(false);
    }
  };

  const handleOverrideSuccess = async () => {
    setOverrideItem(null);
    await loadAll();
  };

  const sections = [
    { id: 'overview', label: 'Overview', icon: <Activity size={14} /> },
    { id: 'priorities', label: 'Smart Priorities', icon: <Brain size={14} /> },
    { id: 'zone-gaps', label: 'Zone Gaps', icon: <Map size={14} /> },
    { id: 'recommendations', label: 'Recommendations', icon: <AlertTriangle size={14} /> },
    { id: 'impact', label: 'Impact Analytics', icon: <BarChart2 size={14} /> },
  ];

  // Build chart data for impact
  const statusPieData = impact ? [
    { name: 'Fulfilled', value: impact.requests_fulfilled },
    { name: 'In Progress', value: impact.requests_partially_fulfilled },
    { name: 'Waiting', value: impact.requests_still_waiting },
  ] : [];

  const unmetZoneChartData = impact?.unmet_needs_by_zone?.map(z => ({
    zone: z.zone_id,
    unmet: z.unmet_count,
  })) || [];

  const deliveredChartData = impact?.delivered_by_category_and_unit?.map(d => ({
    name: `${d.category} (${d.unit})`,
    quantity: d.quantity,
  })) || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: '12px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{
            width: '48px', height: '48px', borderRadius: '14px',
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 6px 20px rgba(99,102,241,0.35)'
          }}>
            <Brain size={24} color="#fff" />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800 }}>Relief Intelligence</h1>
            <p style={{ margin: '2px 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Explainable prioritization · Zone gap analysis · Fairness recommendations · Impact analytics
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          <button onClick={handleSeed} disabled={seeding} style={{
            padding: '8px 16px', borderRadius: '8px', border: '1px solid var(--border-medium)',
            background: 'var(--bg-surface-elevated)', cursor: 'pointer', color: 'var(--text-secondary)',
            fontSize: '0.78rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px'
          }}>
            <Database size={13} /> {seeding ? 'Seeding...' : 'Load Demo'}
          </button>
          <a href={exportUrl} download style={{
            padding: '8px 16px', borderRadius: '8px', border: '1px solid var(--border-medium)',
            background: 'var(--bg-surface-elevated)', cursor: 'pointer', color: 'var(--text-secondary)',
            fontSize: '0.78rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px',
            textDecoration: 'none'
          }}>
            <Download size={13} /> Export CSV
          </a>
          <button onClick={loadAll} disabled={loading} style={{
            padding: '8px 16px', borderRadius: '8px',
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
            color: '#fff', fontSize: '0.78rem', fontWeight: 700,
            display: 'flex', alignItems: 'center', gap: '6px'
          }}>
            <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
            Refresh
          </button>
        </div>
      </div>

      {seedMsg && (
        <div style={{
          padding: '10px 16px', borderRadius: '8px',
          background: seedMsg.startsWith('Error') ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)',
          border: `1px solid ${seedMsg.startsWith('Error') ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`,
          color: seedMsg.startsWith('Error') ? '#ef4444' : '#22c55e',
          fontSize: '0.8rem'
        }}>{seedMsg}</div>
      )}

      {error && (
        <div style={{
          padding: '12px 16px', borderRadius: '10px',
          background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
          color: '#ef4444', fontSize: '0.85rem',
          display: 'flex', gap: '8px', alignItems: 'center'
        }}>
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* Section tabs */}
      <div style={{
        display: 'flex', gap: '4px', background: 'var(--bg-surface-elevated)',
        padding: '4px', borderRadius: '10px', border: '1px solid var(--border-subtle)',
        flexWrap: 'wrap'
      }}>
        {sections.map(s => (
          <button key={s.id} onClick={() => setActiveSection(s.id)} style={{
            padding: '7px 16px', borderRadius: '7px', border: 'none',
            background: activeSection === s.id ? 'var(--accent-primary)' : 'transparent',
            color: activeSection === s.id ? '#fff' : 'var(--text-secondary)',
            fontWeight: activeSection === s.id ? 700 : 500,
            fontSize: '0.78rem', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: '6px',
            transition: 'all 0.15s ease'
          }}>
            {s.icon}{s.label}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ── */}
      {activeSection === 'overview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <SectionHeader
            icon={<Activity size={20} color="#fff" />}
            title="Emergency Operations Overview"
            subtitle="Live counts computed from persisted database records — never fabricated."
          />
          {loading ? <div style={{ color: 'var(--text-muted)', padding: '20px' }}>Loading...</div> : (
            <>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                gap: '14px'
              }}>
                <MetricCard icon={<AlertTriangle size={16} />} label="Active Requests" value={overview?.total_active_requests ?? '—'} urgent={overview?.total_active_requests > 0} color="#f97316" />
                <MetricCard icon={<Clock size={16} />} label="Awaiting Verification" value={overview?.requests_awaiting_verification ?? '—'} color="#eab308" />
                <MetricCard icon={<Users size={16} />} label="Verified, Unassigned" value={overview?.verified_awaiting_assignment ?? '—'} color="#3b82f6" urgent={overview?.verified_awaiting_assignment > 0} />
                <MetricCard icon={<Flame size={16} />} label="Critical Unresolved" value={overview?.critical_unresolved ?? '—'} color="#ef4444" urgent={overview?.critical_unresolved > 0} />
                <MetricCard icon={<Activity size={16} />} label="Active Assignments" value={overview?.active_assignments ?? '—'} color="#22c55e" />
                <MetricCard icon={<Package size={16} />} label="Deliveries Pending" value={overview?.deliveries_awaiting_completion ?? '—'} color="#a855f7" />
                <MetricCard icon={<TrendingUp size={16} />} label="Unmet Requests" value={overview?.requests_with_unmet_quantities ?? '—'} color="#f97316" />
                <MetricCard icon={<AlertCircle size={16} />} label="Low Stock Items" value={overview?.low_stock_items ?? '—'} color="#ef4444" urgent={overview?.low_stock_items > 0} />
              </div>
              {overview?.definitions && (
                <details style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Metric definitions (click to expand)</summary>
                  <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {Object.entries(overview.definitions).map(([k, v]) => (
                      <div key={k}><span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{k}:</span> {v}</div>
                    ))}
                  </div>
                </details>
              )}
            </>
          )}
        </div>
      )}

      {/* ── SMART PRIORITIES ── */}
      {activeSection === 'priorities' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <SectionHeader
            icon={<Brain size={20} color="#fff" />}
            title="Smart Priority Engine"
            subtitle="Deterministic 100-point score: Severity(40) + Wait(20) + Hazard(15) + Needs(15) + Vulnerability(10)"
          />

          {/* Filters */}
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
            <Filter size={14} style={{ color: 'var(--text-muted)' }} />
            {[
              { key: 'severity', label: 'Severity', opts: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] },
              { key: 'category', label: 'Category', opts: ['Rescue', 'Medical', 'Water', 'Food', 'Shelter'] },
              { key: 'band', label: 'Band', opts: ['Critical', 'High', 'Medium', 'Low', 'Fulfilled'] },
            ].map(f => (
              <select key={f.key} value={filters[f.key]} onChange={e => setFilters(p => ({ ...p, [f.key]: e.target.value }))}
                style={{
                  padding: '6px 10px', borderRadius: '8px', fontSize: '0.78rem',
                  background: 'var(--bg-surface-elevated)', border: '1px solid var(--border-medium)',
                  color: 'var(--text-primary)'
                }}>
                <option value="">All {f.label}s</option>
                {f.opts.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            ))}
            {(filters.severity || filters.category || filters.band) && (
              <button onClick={() => setFilters({ severity: '', category: '', band: '', zone_id: '' })} style={{
                padding: '6px 12px', borderRadius: '8px', border: 'none',
                background: 'rgba(239,68,68,0.1)', color: '#ef4444', cursor: 'pointer', fontSize: '0.75rem'
              }}>Clear filters</button>
            )}
          </div>

          {loading ? <div style={{ color: 'var(--text-muted)' }}>Computing priorities...</div> : (
            priorities.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', padding: '32px', textAlign: 'center', background: 'var(--bg-surface-elevated)', borderRadius: '12px', border: '1px solid var(--border-subtle)' }}>
                No requests found matching the selected filters.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {priorities.map((item) => (
                  <div key={item.request_id} style={{
                    background: 'var(--bg-surface-elevated)', border: `1px solid ${bandColor(item.effective_band)}22`,
                    borderLeft: `4px solid ${bandColor(item.effective_band)}`,
                    borderRadius: '10px', padding: '14px 16px',
                    display: 'flex', alignItems: 'flex-start', gap: '14px', flexWrap: 'wrap'
                  }}>
                    {/* Score circle */}
                    <div style={{
                      width: '52px', height: '52px', borderRadius: '50%', flexShrink: 0,
                      border: `3px solid ${bandColor(item.effective_band)}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexDirection: 'column', background: bandColor(item.effective_band) + '15'
                    }}>
                      <span style={{ fontSize: '1.1rem', fontWeight: 800, color: bandColor(item.effective_band), lineHeight: 1 }}>
                        {item.priority_score}
                      </span>
                      <span style={{ fontSize: '0.55rem', color: 'var(--text-muted)', textAlign: 'center' }}>pts</span>
                    </div>

                    {/* Main content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '4px' }}>
                        <BandPill band={item.effective_band} overridden={item.is_overridden} />
                        <span style={{ fontSize: '0.7rem', color: SEVERITY_COLORS[item.severity] || 'var(--text-muted)', fontWeight: 700 }}>
                          {item.severity}
                        </span>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>{item.category}</span>
                        {item.needs_human_review && (
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: '3px',
                            padding: '2px 7px', borderRadius: '999px',
                            background: '#f97316' + '15', border: '1px solid #f97316' + '30',
                            color: '#f97316', fontSize: '0.65rem', fontWeight: 700
                          }}>
                            <AlertTriangle size={9} /> Review Required
                          </span>
                        )}
                        {item.latest_hazard_reading?.is_stale && (
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: '3px',
                            padding: '2px 7px', borderRadius: '999px',
                            background: '#eab308' + '15', border: '1px solid #eab308' + '30',
                            color: '#eab308', fontSize: '0.65rem', fontWeight: 700
                          }}>
                            ⚡ Stale Telemetry
                          </span>
                        )}
                      </div>
                      <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: '2px' }}>{item.household_label}</div>
                      <div style={{ display: 'flex', gap: '14px', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        <span>🗺 {item.zone_id}</span>
                        <span>⏱ {formatWait(item.waiting_hours)} waiting</span>
                        <span>ID: {item.request_id}</span>
                        {item.latest_hazard_reading && (
                          <span>Flood: <HazardBadge status={item.latest_hazard_reading.status} /></span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                      <button onClick={() => setSelectedItem(item)} style={{
                        padding: '6px 12px', borderRadius: '8px',
                        background: 'var(--bg-surface)', border: '1px solid var(--border-medium)',
                        color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.72rem',
                        display: 'flex', alignItems: 'center', gap: '4px'
                      }}>
                        <Eye size={12} /> Score
                      </button>
                      <button onClick={() => setOverrideItem(item)} style={{
                        padding: '6px 12px', borderRadius: '8px',
                        background: 'rgba(249,115,22,0.1)', border: '1px solid rgba(249,115,22,0.3)',
                        color: '#f97316', cursor: 'pointer', fontSize: '0.72rem',
                        display: 'flex', alignItems: 'center', gap: '4px'
                      }}>
                        <Shield size={12} /> Override
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      )}

      {/* ── ZONE GAPS ── */}
      {activeSection === 'zone-gaps' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <SectionHeader
            icon={<Map size={20} color="#fff" />}
            title="Zone Relief Gap Analysis"
            subtitle="Per-zone breakdown of requests, deliveries, hazard telemetry and supply status. Units are never summed across incompatible categories."
          />
          {loading ? <div style={{ color: 'var(--text-muted)' }}>Analysing zones...</div> : (
            zoneGaps.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', padding: '32px', textAlign: 'center', background: 'var(--bg-surface-elevated)', borderRadius: '12px' }}>
                No zone data available.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {zoneGaps.map(z => (
                  <div key={z.zone_id} style={{
                    background: 'var(--bg-surface-elevated)',
                    border: `1px solid ${hazardColor(z.flood_hazard_status)}22`,
                    borderLeft: `4px solid ${hazardColor(z.flood_hazard_status)}`,
                    borderRadius: '12px', padding: '18px'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 700, fontSize: '1rem' }}>{z.zone_id}</span>
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{z.zone_name}</span>
                          <HazardBadge status={z.flood_hazard_status} />
                          {z.is_hazard_stale && (
                            <span style={{ fontSize: '0.68rem', padding: '2px 7px', borderRadius: '999px', background: '#eab308' + '15', color: '#eab308', border: '1px solid #eab308' + '30', fontWeight: 700 }}>
                              ⚠ Stale ({z.hazard_age_hours}h)
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                          {z.water_level_cm > 0 ? `Water: ${z.water_level_cm}cm` : 'No sensor data'} {z.hazard_timestamp && `· ${relTime(z.hazard_timestamp)}`}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '0.78rem', fontWeight: 700, color: z.relief_gap_status.includes('Critical') ? '#ef4444' : z.relief_gap_status.includes('High') ? '#f97316' : z.relief_gap_status.includes('Moderate') ? '#eab308' : 'var(--text-secondary)' }}>
                          {z.relief_gap_status}
                        </div>
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', maxWidth: '280px' }}>{z.classification_rule}</div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '10px' }}>
                      <span>📋 {z.known_requests_count} requests</span>
                      <span>✅ {z.verified_requests_count} verified</span>
                      <span>⏳ {z.unresolved_requests_count} unresolved</span>
                      <span>📦 {z.requests_with_delivery_count} with delivery</span>
                    </div>

                    {z.quantities.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Quantities by category & unit</div>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                          {z.quantities.map((q, qi) => (
                            <div key={qi} style={{
                              padding: '8px 12px', borderRadius: '8px',
                              background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
                              fontSize: '0.72rem'
                            }}>
                              <div style={{ fontWeight: 700, marginBottom: '4px' }}>{q.category} ({q.unit})</div>
                              <div style={{ display: 'flex', gap: '10px', color: 'var(--text-muted)' }}>
                                <span>Req: {q.requested || '—'}</span>
                                <span>Alloc: {q.allocated || '—'}</span>
                                <span>Delivered: {q.delivered}</span>
                                {q.unmet > 0 && <span style={{ color: '#ef4444', fontWeight: 700 }}>Unmet: {q.unmet}</span>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      )}

      {/* ── RECOMMENDATIONS ── */}
      {activeSection === 'recommendations' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <SectionHeader
            icon={<AlertTriangle size={20} color="#fff" />}
            title="Fairness & Coordination Recommendations"
            subtitle="Automatically detected operational issues. Click each recommendation to expand."
          />
          {loading ? <div style={{ color: 'var(--text-muted)' }}>Analyzing patterns...</div> : (
            recommendations.length === 0 ? (
              <div style={{
                padding: '32px', textAlign: 'center', background: 'var(--bg-surface-elevated)',
                borderRadius: '12px', border: '1px solid var(--border-subtle)',
                color: 'var(--text-muted)', fontSize: '0.875rem'
              }}>
                <CheckCircle size={32} style={{ marginBottom: '10px', color: '#22c55e' }} />
                <div>No active operational issues detected. All systems nominal.</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {recommendations.map((rec) => {
                  const isOpen = expandedRec === rec.id;
                  const sevColor = rec.severity === 'CRITICAL' ? '#ef4444' : rec.severity === 'HIGH' ? '#f97316' : '#eab308';
                  return (
                    <div key={rec.id} style={{
                      background: 'var(--bg-surface-elevated)',
                      border: `1px solid ${sevColor}22`,
                      borderLeft: `4px solid ${sevColor}`,
                      borderRadius: '10px', overflow: 'hidden'
                    }}>
                      <button
                        onClick={() => setExpandedRec(isOpen ? null : rec.id)}
                        style={{
                          width: '100%', background: 'none', border: 'none', cursor: 'pointer',
                          padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '12px',
                          textAlign: 'left'
                        }}
                      >
                        <span style={{
                          flexShrink: 0, padding: '3px 8px', borderRadius: '999px',
                          background: sevColor + '15', border: `1px solid ${sevColor}30`,
                          color: sevColor, fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase'
                        }}>{rec.severity}</span>
                        <span style={{ flex: 1, fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>{rec.title}</span>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{rec.category}</span>
                        {isOpen ? <ChevronUp size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} /> : <ChevronDown size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />}
                      </button>
                      {isOpen && (
                        <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', borderTop: '1px solid var(--border-subtle)', paddingTop: '12px' }}>
                            <strong>Detected Issue:</strong> {rec.detected_issue}
                          </div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                            <strong>Why it matters:</strong> {rec.why_it_matters}
                          </div>
                          <div style={{
                            padding: '10px 14px', borderRadius: '8px',
                            background: '#22c55e' + '10', border: '1px solid #22c55e' + '25',
                            fontSize: '0.8rem', color: '#22c55e', fontWeight: 600
                          }}>
                            ✓ Suggested Action: {rec.suggested_action}
                          </div>
                          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            {rec.supporting_records.map((r, i) => (
                              <span key={i} style={{
                                padding: '3px 8px', borderRadius: '6px',
                                background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
                                fontSize: '0.7rem', color: 'var(--text-muted)'
                              }}>{r}</span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )
          )}
        </div>
      )}

      {/* ── IMPACT ANALYTICS ── */}
      {activeSection === 'impact' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <SectionHeader
            icon={<BarChart2 size={20} color="#fff" />}
            title="Relief Impact Analytics"
            subtitle="All metrics computed from real database records. 'Not enough data' is shown when denominators are zero."
          />
          {loading ? <div style={{ color: 'var(--text-muted)' }}>Computing impact...</div> : impact && (
            <>
              {/* Key metrics */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '14px' }}>
                <MetricCard icon={<CheckCircle size={16} />} label="Requests Fulfilled" value={impact.requests_fulfilled} color="#22c55e" />
                <MetricCard icon={<Activity size={16} />} label="Partially Fulfilled" value={impact.requests_partially_fulfilled} color="#3b82f6" />
                <MetricCard icon={<Clock size={16} />} label="Still Waiting" value={impact.requests_still_waiting} color="#f97316" />
                <MetricCard
                  icon={<TrendingUp size={16} />}
                  label="Delivery Completion"
                  value={impact.completion_rate_insufficient_data ? 'Not enough data' : `${impact.delivery_completion_rate}%`}
                  sub={impact.completion_rate_insufficient_data ? 'No dispatched allocations recorded yet' : undefined}
                  color={impact.completion_rate_insufficient_data ? 'var(--text-muted)' : '#22c55e'}
                />
                <MetricCard
                  icon={<Clock size={16} />}
                  label="Avg Response Time"
                  value={impact.average_response_time_minutes === null ? 'Not enough data' : `${Math.round(impact.average_response_time_minutes)}m`}
                  sub={impact.response_time_sample_size > 0 ? `From ${impact.response_time_sample_size} completed request(s)` : 'No completed requests yet'}
                  color={impact.average_response_time_minutes === null ? 'var(--text-muted)' : 'var(--text-primary)'}
                />
              </div>

              {/* Charts row */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' }}>
                {/* Status Pie */}
                <div style={{ background: 'var(--bg-surface-elevated)', border: '1px solid var(--border-subtle)', borderRadius: '12px', padding: '20px' }}>
                  <h3 style={{ margin: '0 0 16px', fontSize: '0.9rem', fontWeight: 700 }}>Request Status Distribution</h3>
                  {statusPieData.every(d => d.value === 0) ? (
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', padding: '20px 0' }}>Not enough data to display.</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie data={statusPieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={4} dataKey="value" label={({ name, value }) => `${name}: ${value}`} labelLine={false}>
                          {statusPieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </div>

                {/* Unmet needs by zone */}
                <div style={{ background: 'var(--bg-surface-elevated)', border: '1px solid var(--border-subtle)', borderRadius: '12px', padding: '20px' }}>
                  <h3 style={{ margin: '0 0 16px', fontSize: '0.9rem', fontWeight: 700 }}>Unmet Needs by Zone</h3>
                  {unmetZoneChartData.length === 0 ? (
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', padding: '20px 0' }}>No unmet needs recorded.</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={unmetZoneChartData} margin={{ top: 0, right: 10, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                        <XAxis dataKey="zone" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                        <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                        <Tooltip contentStyle={{ background: 'var(--bg-surface)', border: '1px solid var(--border-medium)' }} />
                        <Bar dataKey="unmet" fill="#ef4444" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>

                {/* Delivered by category & unit */}
                <div style={{ background: 'var(--bg-surface-elevated)', border: '1px solid var(--border-subtle)', borderRadius: '12px', padding: '20px', gridColumn: '1 / -1' }}>
                  <h3 style={{ margin: '0 0 4px', fontSize: '0.9rem', fontWeight: 700 }}>Delivered Quantities by Category & Unit</h3>
                  <p style={{ margin: '0 0 16px', fontSize: '0.72rem', color: 'var(--text-muted)' }}>Each bar represents a distinct (category, physical unit) combination. Units are never summed across incompatible types.</p>
                  {deliveredChartData.length === 0 ? (
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', padding: '20px 0' }}>No delivered quantities recorded yet.</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={240}>
                      <BarChart data={deliveredChartData} margin={{ top: 0, right: 10, left: -10, bottom: 30 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                        <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} angle={-20} textAnchor="end" />
                        <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                        <Tooltip contentStyle={{ background: 'var(--bg-surface)', border: '1px solid var(--border-medium)' }} />
                        <Bar dataKey="quantity" fill="#22c55e" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Modals */}
      {selectedItem && <ScoreBreakdown item={selectedItem} onClose={() => setSelectedItem(null)} />}
      {overrideItem && <PriorityOverrideModal item={overrideItem} onClose={() => setOverrideItem(null)} onSuccess={handleOverrideSuccess} />}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
