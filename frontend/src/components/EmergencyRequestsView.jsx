import React, { useState, useEffect, useCallback } from 'react';
import {
  LifeBuoy,
  Plus,
  Radio,
  Search,
  RefreshCw,
  AlertTriangle,
  Clock,
  CheckCircle2,
  XCircle,
  Truck,
  Droplet,
  Utensils,
  HeartPulse,
  Home,
  ShieldCheck,
  MapPin,
  ChevronRight,
  RotateCw,
  Globe
} from 'lucide-react';
import { fetchEmergencyRequests } from '../api/client';
import RequestDetailModal from './RequestDetailModal';
import CreateRequestModal from './CreateRequestModal';
import SOSSimulatorModal from './SOSSimulatorModal';

const CATEGORY_ICONS = {
  Water: <Droplet size={14} color="var(--accent)" />,
  Food: <Utensils size={14} color="var(--text-secondary)" />,
  Medical: <HeartPulse size={14} color="var(--alarm)" />,
  Rescue: <LifeBuoy size={14} color="var(--alarm)" />,
  Shelter: <Home size={14} color="var(--text-secondary)" />
};

export default function EmergencyRequestsView({
  selectedZone = 'Z001',
  zones = [],
  onSelectZone
}) {
  const [requests, setRequests] = useState([]);
  const [counts, setCounts] = useState({
    total: 0,
    pending_verification: 0,
    verified: 0,
    assigned: 0,
    in_progress: 0,
    fulfilled: 0,
    rejected: 0,
    critical: 0,
    high: 0,
    duplicates: 0
  });
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [verificationFilter, setVerificationFilter] = useState('ALL');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [severityFilter, setSeverityFilter] = useState('ALL');
  const [zoneFilter, setZoneFilter] = useState('ALL');

  // Modals
  const [selectedRequestId, setSelectedRequestId] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showSOSModal, setShowSOSModal] = useState(false);

  const loadRequests = useCallback(async (showSpinner = true) => {
    if (showSpinner) setIsLoading(true);
    setError(null);
    try {
      const filters = {
        limit: 100,
        offset: 0
      };
      if (searchQuery.trim()) filters.search = searchQuery.trim();
      if (statusFilter !== 'ALL') filters.status = statusFilter;
      if (verificationFilter !== 'ALL') filters.verification_status = verificationFilter;
      if (categoryFilter !== 'ALL') filters.category = categoryFilter;
      if (severityFilter !== 'ALL') filters.severity = severityFilter;
      if (zoneFilter !== 'ALL') filters.zone_id = zoneFilter;

      const data = await fetchEmergencyRequests(filters);
      setRequests(data.items || []);
      setTotal(data.total || 0);
      if (data.counts) setCounts(data.counts);
    } catch (err) {
      console.error('Failed to load emergency requests:', err);
      setError(err.message || 'Cannot connect to FloodGuard requests server');
    } finally {
      if (showSpinner) setIsLoading(false);
    }
  }, [searchQuery, statusFilter, verificationFilter, categoryFilter, severityFilter, zoneFilter]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadRequests(true);
    }, 250);
    return () => clearTimeout(timer);
  }, [loadRequests]);

  const handleOpenDetail = (reqId) => {
    setSelectedRequestId(reqId);
    setShowDetailModal(true);
  };

  const handleRequestCreated = () => {
    loadRequests(true);
  };

  const handleRequestUpdated = () => {
    loadRequests(false);
  };

  return (
    <div className="emergency-requests-page" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Top Banner / Actions Strip */}
      <div className="glass-card" style={{
        padding: '24px',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border-medium)',
        background: 'var(--bg-surface)'
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '16px'
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{
                width: '38px',
                height: '38px',
                borderRadius: 'var(--radius-md)',
                background: 'var(--alarm-bg)',
                border: '1px solid var(--alarm-border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--alarm)'
              }}>
                <LifeBuoy size={20} />
              </div>
              <div>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '0' }}>
                  Emergency Requests & SOS Coordination
                </h2>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Active flood relief intake, verification desk, and simulated LoRa beacon dispatch
                </p>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            {/* Prominent Simulated SOS Action */}
            <button
              onClick={() => setShowSOSModal(true)}
              className="btn-primary"
              style={{
                background: 'var(--alarm)',
                borderColor: 'var(--alarm)',
                color: '#fff',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow: '0 0 16px rgba(255, 69, 58, 0.25)'
              }}
              title="Open controlled emergency SOS simulation modal"
            >
              <Radio size={15} className="pulse-icon" />
              Simulate SOS
            </button>

            {/* Manual Request Creation */}
            <button
              onClick={() => setShowCreateModal(true)}
              className="btn-secondary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <Plus size={15} />
              New Request
            </button>

            {/* Refresh */}
            <button
              onClick={() => loadRequests(true)}
              className="btn-icon"
              title="Refresh requests list"
              aria-label="Refresh requests"
            >
              <RefreshCw size={15} className={isLoading ? 'spin' : ''} />
            </button>
          </div>
        </div>
      </div>

      {/* KPI Metrics Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: '16px'
      }}>
        <div className="glass-card" style={{ padding: '16px', background: 'var(--bg-surface)' }}>
          <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Total Requests
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '4px' }}>
            {counts.total || 0}
          </div>
          <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            Across all {zones ? zones.length : 438} Nagpur zones
          </div>
        </div>

        <div className="glass-card" style={{ padding: '16px', background: 'var(--bg-surface)' }}>
          <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--status-warning)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Pending Verification
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--status-warning-strong)', marginTop: '4px' }}>
            {counts.pending_verification || 0}
          </div>
          <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            Requires desk review
          </div>
        </div>

        <div className="glass-card" style={{ padding: '16px', background: 'var(--bg-surface)' }}>
          <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--alarm)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Critical Severity
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--alarm)', marginTop: '4px' }}>
            {counts.critical || 0}
          </div>
          <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            Immediate life-threat
          </div>
        </div>

        <div className="glass-card" style={{ padding: '16px', background: 'var(--bg-surface)' }}>
          <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Active Operations
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '4px' }}>
            {(counts.assigned || 0) + (counts.in_progress || 0)}
          </div>
          <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            Assigned or in progress
          </div>
        </div>

        <div className="glass-card" style={{ padding: '16px', background: 'var(--bg-surface)' }}>
          <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--status-safe-strong)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Fulfilled Relieved
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--status-safe-strong)', marginTop: '4px' }}>
            {counts.fulfilled || 0}
          </div>
          <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            Completed relief deliveries
          </div>
        </div>

        {counts.duplicates > 0 && (
          <div className="glass-card" style={{ padding: '16px', background: 'var(--bg-surface)', border: '1px solid var(--alarm-border)' }}>
            <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--alarm)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Potential Duplicates
            </div>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--alarm)', marginTop: '4px' }}>
              {counts.duplicates}
            </div>
            <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: '4px' }}>
              Flagged for coordinator review
            </div>
          </div>
        )}
      </div>

      {/* Filter and Search Bar */}
      <div className="glass-card" style={{
        padding: '16px',
        borderRadius: 'var(--radius-md)',
        background: 'var(--bg-surface)',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px'
      }}>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Search Box */}
          <div style={{
            flex: '1 1 260px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: 'var(--bg-surface-elevated)',
            border: '1px solid var(--border-medium)',
            borderRadius: 'var(--radius-sm)',
            padding: '6px 12px'
          }}>
            <Search size={15} color="var(--text-muted)" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by Request ID, Household, or description..."
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-primary)',
                fontSize: '0.8125rem',
                outline: 'none',
                width: '100%'
              }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}
              >
                <XCircle size={14} />
              </button>
            )}
          </div>

          {/* Fulfilment Status */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{
              padding: '8px 12px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-surface-elevated)',
              border: '1px solid var(--border-medium)',
              color: 'var(--text-primary)',
              fontSize: '0.75rem',
              fontWeight: 500,
              outline: 'none'
            }}
          >
            <option value="ALL">Status: All</option>
            <option value="Pending Verification">Pending Verification</option>
            <option value="Verified">Verified</option>
            <option value="Assigned">Assigned</option>
            <option value="In Progress">In Progress</option>
            <option value="Fulfilled">Fulfilled</option>
            <option value="Rejected">Rejected</option>
          </select>

          {/* Verification Status */}
          <select
            value={verificationFilter}
            onChange={(e) => setVerificationFilter(e.target.value)}
            style={{
              padding: '8px 12px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-surface-elevated)',
              border: '1px solid var(--border-medium)',
              color: 'var(--text-primary)',
              fontSize: '0.75rem',
              fontWeight: 500,
              outline: 'none'
            }}
          >
            <option value="ALL">Verification: All</option>
            <option value="Pending Verification">Pending Verification</option>
            <option value="Verified">Verified</option>
            <option value="Rejected">Rejected</option>
          </select>

          {/* Category */}
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            style={{
              padding: '8px 12px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-surface-elevated)',
              border: '1px solid var(--border-medium)',
              color: 'var(--text-primary)',
              fontSize: '0.75rem',
              fontWeight: 500,
              outline: 'none'
            }}
          >
            <option value="ALL">Category: All</option>
            <option value="Rescue">Rescue</option>
            <option value="Water">Water</option>
            <option value="Medical">Medical</option>
            <option value="Food">Food</option>
            <option value="Shelter">Shelter</option>
          </select>

          {/* Severity */}
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            style={{
              padding: '8px 12px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-surface-elevated)',
              border: '1px solid var(--border-medium)',
              color: 'var(--text-primary)',
              fontSize: '0.75rem',
              fontWeight: 500,
              outline: 'none'
            }}
          >
            <option value="ALL">Severity: All</option>
            <option value="CRITICAL">Critical</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </select>

          {/* Zone */}
          <select
            value={zoneFilter}
            onChange={(e) => setZoneFilter(e.target.value)}
            style={{
              padding: '8px 12px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-surface-elevated)',
              border: '1px solid var(--border-medium)',
              color: 'var(--text-primary)',
              fontSize: '0.75rem',
              fontFamily: 'var(--font-mono)',
              outline: 'none'
            }}
          >
            <option value="ALL">Zone: All</option>
            {zones && zones.slice(0, 50).map((z) => (
              <option key={z.zone_id} value={z.zone_id}>
                {z.zone_id}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Main Table / Card Content */}
      <div className="glass-card" style={{
        padding: '0',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border-medium)',
        background: 'var(--bg-surface)',
        overflow: 'hidden'
      }}>
        {error ? (
          /* Error State */
          <div style={{ padding: '48px 24px', textAlign: 'center' }}>
            <div style={{
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              background: 'var(--alarm-bg)',
              color: 'var(--alarm)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px'
            }}>
              <AlertTriangle size={24} />
            </div>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>
              Connection Error
            </h3>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', maxWidth: '420px', margin: '0 auto 16px' }}>
              {error}. Ensure the FastAPI backend server is running on port 8000.
            </p>
            <button
              onClick={() => loadRequests(true)}
              className="btn-primary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <RefreshCw size={14} />
              Retry Connection
            </button>
          </div>
        ) : isLoading ? (
          /* Loading State */
          <div style={{ padding: '64px 24px', textAlign: 'center', color: 'var(--text-muted)' }}>
            <RotateCw size={24} className="spin" style={{ margin: '0 auto 12px' }} />
            <p style={{ fontSize: '0.8125rem' }}>Loading emergency relief requests...</p>
          </div>
        ) : requests.length === 0 ? (
          /* Empty State */
          <div style={{ padding: '64px 24px', textAlign: 'center', color: 'var(--text-muted)' }}>
            <div style={{
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              background: 'var(--bg-surface-elevated)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px'
            }}>
              <LifeBuoy size={24} color="var(--text-secondary)" />
            </div>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}>
              No Emergency Requests Found
            </h3>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', maxWidth: '380px', margin: '0 auto 16px' }}>
              {searchQuery || statusFilter !== 'ALL' || categoryFilter !== 'ALL' || severityFilter !== 'ALL'
                ? 'No requests matched your active filter criteria. Try clearing some filters.'
                : 'No emergency distress records have been recorded yet. You can simulate an incoming SOS or add a manual intake record.'}
            </p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              {(searchQuery || statusFilter !== 'ALL' || categoryFilter !== 'ALL' || severityFilter !== 'ALL') ? (
                <button
                  onClick={() => {
                    setSearchQuery('');
                    setStatusFilter('ALL');
                    setVerificationFilter('ALL');
                    setCategoryFilter('ALL');
                    setSeverityFilter('ALL');
                    setZoneFilter('ALL');
                  }}
                  className="btn-secondary"
                >
                  Clear Filters
                </button>
              ) : (
                <>
                  <button onClick={() => setShowSOSModal(true)} className="btn-primary" style={{ background: 'var(--alarm)', borderColor: 'var(--alarm)' }}>
                    <Radio size={14} />
                    Simulate First SOS
                  </button>
                  <button onClick={() => setShowCreateModal(true)} className="btn-secondary">
                    <Plus size={14} />
                    Manual Intake
                  </button>
                </>
              )}
            </div>
          </div>
        ) : (
          /* Responsive Requests Table */
          <div style={{ overflowX: 'auto' }}>
            <table style={{
              width: '100%',
              borderCollapse: 'collapse',
              textAlign: 'left',
              fontSize: '0.8125rem'
            }}>
              <thead>
                <tr style={{
                  borderBottom: '1px solid var(--border-medium)',
                  background: 'var(--bg-surface-elevated)',
                  color: 'var(--text-muted)',
                  fontSize: '0.6875rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em'
                }}>
                  <th style={{ padding: '12px 16px' }}>Request ID</th>
                  <th style={{ padding: '12px 16px' }}>Household & Zone</th>
                  <th style={{ padding: '12px 16px' }}>Category</th>
                  <th style={{ padding: '12px 16px' }}>Severity / Priority</th>
                  <th style={{ padding: '12px 16px' }}>Source</th>
                  <th style={{ padding: '12px 16px' }}>Verification</th>
                  <th style={{ padding: '12px 16px' }}>Fulfilment Status</th>
                  <th style={{ padding: '12px 16px' }}>Created</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => {
                  const isCrit = r.severity === 'CRITICAL';
                  const isHigh = r.severity === 'HIGH';
                  return (
                    <tr
                      key={r.request_id}
                      onClick={() => handleOpenDetail(r.request_id)}
                      style={{
                        borderBottom: '1px solid var(--border-subtle)',
                        cursor: 'pointer',
                        transition: 'background 0.15s ease',
                        background: r.is_possible_duplicate ? 'rgba(255, 69, 58, 0.03)' : 'transparent'
                      }}
                      className="request-row-hover"
                    >
                      {/* ID & Dup flag */}
                      <td style={{ padding: '14px 16px', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ color: 'var(--accent)' }}>{r.request_id}</span>
                          {r.is_possible_duplicate === 1 && (
                            <span
                              title={`Flagged duplicate: ${r.duplicate_notes}`}
                              style={{
                                fontSize: '0.625rem',
                                color: 'var(--alarm)',
                                background: 'var(--alarm-bg)',
                                border: '1px solid var(--alarm-border)',
                                padding: '1px 5px',
                                borderRadius: '4px',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '3px'
                              }}
                            >
                              <AlertTriangle size={10} /> DUP
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Household & Zone */}
                      <td style={{ padding: '14px 16px' }}>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.household_label}
                        </div>
                        <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
                          <MapPin size={11} /> Zone {r.zone_id}
                        </div>
                      </td>

                      {/* Category */}
                      <td style={{ padding: '14px 16px' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 500, color: 'var(--text-primary)' }}>
                          {CATEGORY_ICONS[r.category] || <LifeBuoy size={14} />}
                          <span>{r.category}</span>
                        </div>
                        {r.quantity && (
                          <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
                            {r.quantity}
                          </div>
                        )}
                      </td>

                      {/* Severity & Priority */}
                      <td style={{ padding: '14px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{
                            fontSize: '0.6875rem',
                            fontWeight: 700,
                            padding: '2px 8px',
                            borderRadius: '999px',
                            background: isCrit ? 'var(--alarm-bg)' : isHigh ? 'var(--status-warning-bg)' : 'var(--bg-surface-elevated)',
                            color: isCrit ? 'var(--alarm)' : isHigh ? 'var(--status-warning-strong)' : 'var(--text-secondary)',
                            border: `1px solid ${isCrit ? 'var(--alarm-border)' : 'var(--border-subtle)'}`
                          }}>
                            {r.severity}
                          </span>
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                            P{r.priority_score}
                          </span>
                        </div>
                      </td>

                      {/* Source */}
                      <td style={{ padding: '14px 16px' }}>
                        <span style={{
                          fontSize: '0.6875rem',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          color: r.source === 'simulated_sos' ? 'var(--alarm)' : 'var(--text-muted)'
                        }}>
                          {r.source === 'simulated_sos' ? <Radio size={12} /> : <Globe size={12} />}
                          {r.source === 'simulated_sos' ? 'Simulated SOS' : 'Web Form'}
                        </span>
                      </td>

                      {/* Verification Status */}
                      <td style={{ padding: '14px 16px' }}>
                        <span style={{
                          fontSize: '0.6875rem',
                          fontWeight: 600,
                          padding: '3px 8px',
                          borderRadius: 'var(--radius-sm)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          background: r.verification_status === 'Verified' ? 'var(--status-safe-bg)' :
                                     r.verification_status === 'Rejected' ? 'var(--alarm-bg)' : 'var(--bg-surface-elevated)',
                          color: r.verification_status === 'Verified' ? 'var(--status-safe-strong)' :
                                 r.verification_status === 'Rejected' ? 'var(--alarm)' : 'var(--status-warning)',
                          border: `1px solid ${r.verification_status === 'Verified' ? 'var(--border-subtle)' :
                                              r.verification_status === 'Rejected' ? 'var(--alarm-border)' : 'var(--border-subtle)'}`
                        }}>
                          {r.verification_status === 'Verified' ? <ShieldCheck size={12} /> :
                           r.verification_status === 'Rejected' ? <XCircle size={12} /> : <Clock size={12} />}
                          {r.verification_status}
                        </span>
                      </td>

                      {/* Fulfilment Status */}
                      <td style={{ padding: '14px 16px' }}>
                        <span style={{
                          fontSize: '0.6875rem',
                          fontWeight: 600,
                          padding: '3px 8px',
                          borderRadius: 'var(--radius-sm)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          background: r.status === 'Fulfilled' ? 'var(--status-safe-bg)' :
                                     r.status === 'In Progress' ? 'var(--accent-bg)' :
                                     r.status === 'Assigned' ? 'var(--bg-surface-elevated)' :
                                     r.status === 'Rejected' ? 'var(--alarm-bg)' : 'var(--bg-surface-elevated)',
                          color: r.status === 'Fulfilled' ? 'var(--status-safe-strong)' :
                                 r.status === 'In Progress' ? 'var(--text-primary)' :
                                 r.status === 'Assigned' ? 'var(--text-primary)' :
                                 r.status === 'Rejected' ? 'var(--alarm)' : 'var(--text-muted)',
                          border: '1px solid var(--border-subtle)'
                        }}>
                          {r.status === 'Fulfilled' ? <CheckCircle2 size={12} /> :
                           r.status === 'In Progress' ? <RotateCw size={12} /> :
                           r.status === 'Assigned' ? <Truck size={12} /> : <Clock size={12} />}
                          {r.status}
                        </span>
                      </td>

                      {/* Created At */}
                      <td style={{ padding: '14px 16px', color: 'var(--text-muted)', fontSize: '0.72rem' }}>
                        {new Date(r.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>

                      {/* Action */}
                      <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenDetail(r.request_id);
                          }}
                          className="btn-secondary"
                          style={{ padding: '4px 8px', fontSize: '0.72rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                        >
                          View Details
                          <ChevronRight size={12} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modals */}
      <RequestDetailModal
        isOpen={showDetailModal}
        onClose={() => {
          setShowDetailModal(false);
          setSelectedRequestId(null);
        }}
        requestId={selectedRequestId}
        onUpdated={handleRequestUpdated}
      />

      <CreateRequestModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        selectedZone={selectedZone}
        zones={zones}
        onRequestCreated={handleRequestCreated}
      />

      <SOSSimulatorModal
        isOpen={showSOSModal}
        onClose={() => setShowSOSModal(false)}
        selectedZone={selectedZone}
        zones={zones}
        onRequestCreated={handleRequestCreated}
        onNavigateToRequests={() => {
          loadRequests(true);
        }}
      />
    </div>
  );
}
