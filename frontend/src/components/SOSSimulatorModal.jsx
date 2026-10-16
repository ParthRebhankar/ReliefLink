import React, { useState, useEffect } from 'react';
import {
  X,
  Radio,
  AlertTriangle,
  Send,
  CheckCircle,
  Copy,
  Check,
  Activity,
  Layers,
  MapPin,
  RefreshCw,
  Info
} from 'lucide-react';
import { simulateSOSEvent } from '../api/client';

const DEMO_HOUSEHOLD_PRESETS = [
  {
    label: 'Demo #101 - Sitabuldi (Ground Inundation)',
    household: 'Demo Household #101 - Ward 12 Sitabuldi',
    category: 'Rescue',
    zone_id: 'Z001',
    severity: 'CRITICAL',
    quantity: '4 persons (1 elderly, 1 infant)',
    latitude: 21.1458,
    longitude: 79.0882,
    description: '[DEMO SOS] Drain overflow entered ground floor (approx 45cm). Family trapped on upper stairs. Urgent boat evacuation requested.',
    notes: 'Triggered from simulated household distress beacon'
  },
  {
    label: 'Demo #102 - Reshimbagh (Water Contamination)',
    household: 'Demo Household #102 - Reshimbagh',
    category: 'Water',
    zone_id: 'Z002',
    severity: 'HIGH',
    quantity: '5 cans (100L drinking water)',
    latitude: 21.1272,
    longitude: 79.1038,
    description: '[DEMO SOS] Storm backflow ruptured fresh water pipeline; tap water contaminated with sewage silt. 12 residents without potable water.',
    notes: 'Simulated community hand-pump alarm'
  },
  {
    label: 'Demo #103 - Dharampeth (Medical / Insulin)',
    household: 'Demo Household #103 - Dharampeth',
    category: 'Medical',
    zone_id: 'Z003',
    severity: 'MEDIUM',
    quantity: 'Insulin + cold storage gel pack',
    latitude: 21.1410,
    longitude: 79.0620,
    description: '[DEMO SOS] Transformer submerged; domestic refrigerator failed. Diabetic patient insulin vials require emergency ice pack cooling.',
    notes: 'Simulated health alert beacon'
  },
  {
    label: 'Demo #104 - Gandhibagh (Stranded / Ration)',
    household: 'Demo Household #104 - Gandhibagh',
    category: 'Food',
    zone_id: 'Z001',
    severity: 'HIGH',
    quantity: '6 dry ration meal kits',
    latitude: 21.1520,
    longitude: 79.1120,
    description: '[DEMO SOS] Ground floor flooded to 30cm; 6 residents stranded on building terrace without food supplies for >12 hours.',
    notes: 'Simulated building committee distress beacon'
  },
  {
    label: 'Demo #105 - Mahal (Elderly Evacuation)',
    household: 'Demo Household #105 - Mahal Old City',
    category: 'Shelter',
    zone_id: 'Z004',
    severity: 'HIGH',
    quantity: '2 persons',
    latitude: 21.1435,
    longitude: 79.1080,
    description: '[DEMO SOS] Old mud-brick boundary wall collapsing due to waterlogging. Two elderly citizens need emergency shelter relocation.',
    notes: 'Simulated neighbor SOS trigger'
  }
];

export default function SOSSimulatorModal({
  isOpen,
  onClose,
  selectedZone = 'Z001',
  zones = [],
  onRequestCreated,
  onNavigateToRequests
}) {
  const [presetIndex, setPresetIndex] = useState(0);
  const [householdLabel, setHouseholdLabel] = useState(DEMO_HOUSEHOLD_PRESETS[0].household);
  const [category, setCategory] = useState(DEMO_HOUSEHOLD_PRESETS[0].category);
  const [zoneId, setZoneId] = useState(selectedZone || DEMO_HOUSEHOLD_PRESETS[0].zone_id);
  const [severity, setSeverity] = useState(DEMO_HOUSEHOLD_PRESETS[0].severity);
  const [description, setDescription] = useState(DEMO_HOUSEHOLD_PRESETS[0].description);
  const [quantity, setQuantity] = useState(DEMO_HOUSEHOLD_PRESETS[0].quantity);
  const [latitude, setLatitude] = useState(DEMO_HOUSEHOLD_PRESETS[0].latitude);
  const [longitude, setLongitude] = useState(DEMO_HOUSEHOLD_PRESETS[0].longitude);
  const [notes, setNotes] = useState(DEMO_HOUSEHOLD_PRESETS[0].notes);

  const [eventId, setEventId] = useState(() => `SOS-SIM-${Math.random().toString(36).substring(2, 8).toUpperCase()}`);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [copiedId, setCopiedId] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setResult(null);
      setError(null);
      setEventId(`SOS-SIM-${Math.random().toString(36).substring(2, 8).toUpperCase()}`);
    }
  }, [isOpen]);

  const handleApplyPreset = (index) => {
    setPresetIndex(index);
    if (index === -1) {
      // Custom mode
      setHouseholdLabel('Demo Household #99 - Custom Location');
      setDescription('[DEMO SOS] ');
      setQuantity('1 unit');
      return;
    }
    const p = DEMO_HOUSEHOLD_PRESETS[index];
    setHouseholdLabel(p.household);
    setCategory(p.category);
    setZoneId(p.zone_id);
    setSeverity(p.severity);
    setDescription(p.description);
    setQuantity(p.quantity);
    setLatitude(p.latitude);
    setLongitude(p.longitude);
    setNotes(p.notes);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const payload = {
        event_id: eventId,
        household_label: householdLabel.trim(),
        category,
        description: description.trim(),
        quantity: quantity.trim(),
        latitude: latitude ? parseFloat(latitude) : undefined,
        longitude: longitude ? parseFloat(longitude) : undefined,
        zone_id: zoneId,
        severity,
        coordinator_notes: notes.trim()
      };

      const res = await simulateSOSEvent(payload);
      setResult(res);
      if (onRequestCreated) onRequestCreated(res);
    } catch (err) {
      setError(err.message || 'Failed to dispatch simulated SOS event');
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard?.writeText(text);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(5, 5, 5, 0.75)',
      backdropFilter: 'blur(10px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 120,
      padding: '20px'
    }}>
      <div className="glass-card" style={{
        maxWidth: '640px',
        width: '100%',
        maxHeight: '92vh',
        overflowY: 'auto',
        padding: '24px',
        border: '1px solid var(--border-medium)',
        background: 'var(--bg-surface)',
        borderRadius: 'var(--radius-lg)'
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '42px',
              height: '42px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--alarm-bg)',
              border: '1px solid var(--alarm-border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--alarm)'
            }}>
              <Radio size={22} className="pulse-icon" />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h2 style={{ fontSize: '1.15rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Simulate SOS Distress Signal
                </h2>
                <span style={{
                  fontSize: '0.65rem',
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  padding: '2px 8px',
                  borderRadius: '999px',
                  background: 'var(--alarm-bg)',
                  color: 'var(--alarm)',
                  border: '1px solid var(--alarm-border)'
                }}>
                  Simulated Mode
                </span>
              </div>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                Emulates LoRa / ESP32 mesh radio distress beacons without physical hardware.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="btn-icon"
            style={{ width: '32px', height: '32px' }}
            aria-label="Close modal"
          >
            <X size={16} />
          </button>
        </div>

        {/* Disclaimer Callout */}
        <div style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '10px',
          padding: '10px 14px',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--bg-surface-elevated)',
          border: '1px solid var(--border-subtle)',
          fontSize: '0.72rem',
          color: 'var(--text-secondary)',
          marginBottom: '18px'
        }}>
          <Info size={16} color="var(--text-muted)" style={{ flexShrink: 0, marginTop: '2px' }} />
          <span>
            <strong>Controlled Demonstration:</strong> This tool submits synthetic demo events to the same intake pipeline as field hardware. No real physical SOS or emergency frequency was transmitted.
          </span>
        </div>

        {result ? (
          /* Success Screen */
          <div style={{
            background: 'var(--bg-surface-elevated)',
            border: '1px solid var(--border-medium)',
            borderRadius: 'var(--radius-md)',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-primary)' }}>
              <CheckCircle size={24} color="var(--status-safe-strong)" />
              <div>
                <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>
                  {result.is_retry ? 'SOS Event Already Processed (Idempotent)' : 'SOS Event Received & Logged'}
                </h3>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {result.message}
                </p>
              </div>
            </div>

            {/* Event & Request Identifiers */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '12px',
              padding: '12px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-primary)',
              border: '1px solid var(--border-subtle)'
            }}>
              <div>
                <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>Event ID (SOS Beacon)</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {result.event_id}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>Request ID (Backend)</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--accent)' }}>
                    {result.request?.request_id || result.request_id}
                  </span>
                  <button
                    onClick={() => copyToClipboard(result.request?.request_id || result.request_id)}
                    style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}
                    title="Copy request ID"
                  >
                    {copiedId ? <Check size={13} color="var(--status-safe-strong)" /> : <Copy size={13} />}
                  </button>
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>Priority Score</div>
                <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--alarm)' }}>
                  {result.request?.priority_score || 50} / 100
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>Verification Status</div>
                <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--status-warning)' }}>
                  {result.request?.verification_status || 'Pending Verification'}
                </div>
              </div>
            </div>

            {/* Duplicate Flag warning if applicable */}
            {result.request?.is_possible_duplicate === 1 && (
              <div style={{
                padding: '10px 14px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--status-warning-bg)',
                border: '1px solid var(--status-warning-border)',
                fontSize: '0.75rem',
                color: 'var(--status-warning)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <AlertTriangle size={16} />
                <span><strong>Duplicate Flag:</strong> {result.request.duplicate_notes || 'Similar active request detected in system. Flagged for coordinator verification.'}</span>
              </div>
            )}

            {/* Attached Zone Telemetry Context */}
            {result.zone_context && (
              <div style={{
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: '12px',
                background: 'var(--bg-primary)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>
                  <Activity size={14} color="var(--color-cyan)" />
                  Matching Flood-Zone Sensor Context ({result.zone_context.zone_id})
                </div>
                <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', fontSize: '0.75rem' }}>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Water Level: </span>
                    <strong>{result.zone_context.water_level_cm !== null ? `${result.zone_context.water_level_cm} cm` : 'No reading yet'}</strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Flood Risk: </span>
                    <span style={{
                      fontWeight: 700,
                      color: result.zone_context.risk_level === 'CRITICAL' || result.zone_context.risk_level === 'DANGER' ? 'var(--alarm)' : 'var(--text-primary)'
                    }}>
                      {result.zone_context.risk_level || 'UNKNOWN'}
                    </span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Geo Risk Score: </span>
                    <strong>{result.zone_context.geo_risk_score}</strong>
                  </div>
                </div>
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '8px' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setResult(null);
                  setEventId(`SOS-SIM-${Math.random().toString(36).substring(2, 8).toUpperCase()}`);
                }}
              >
                Simulate Another
              </button>
              {onNavigateToRequests && (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    onClose();
                    onNavigateToRequests();
                  }}
                >
                  Open Requests Board &rarr;
                </button>
              )}
            </div>
          </div>
        ) : (
          /* Intake Form */
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {error && (
              <div style={{
                padding: '10px 14px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--alarm-bg)',
                border: '1px solid var(--alarm-border)',
                color: 'var(--alarm)',
                fontSize: '0.75rem',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <AlertTriangle size={15} />
                <span>{error}</span>
              </div>
            )}

            {/* Preset Selector */}
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
                Select Demo Scenario Preset:
              </label>
              <select
                value={presetIndex}
                onChange={(e) => handleApplyPreset(parseInt(e.target.value, 10))}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-surface-elevated)',
                  border: '1px solid var(--border-medium)',
                  color: 'var(--text-primary)',
                  fontSize: '0.8125rem',
                  outline: 'none'
                }}
              >
                {DEMO_HOUSEHOLD_PRESETS.map((p, idx) => (
                  <option key={idx} value={idx}>
                    {p.label}
                  </option>
                ))}
                <option value={-1}>Custom Emergency Entry...</option>
              </select>
            </div>

            {/* Grid for Household and Category */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
                  Household / Location Label *
                </label>
                <input
                  type="text"
                  required
                  value={householdLabel}
                  onChange={(e) => setHouseholdLabel(e.target.value)}
                  placeholder="e.g. House 42, Ward 12 Sitabuldi"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-surface-elevated)',
                    border: '1px solid var(--border-medium)',
                    color: 'var(--text-primary)',
                    fontSize: '0.8125rem',
                    outline: 'none'
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
                  Emergency Category *
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-surface-elevated)',
                    border: '1px solid var(--border-medium)',
                    color: 'var(--text-primary)',
                    fontSize: '0.8125rem',
                    outline: 'none'
                  }}
                >
                  <option value="Rescue">Rescue (Immediate Evacuation)</option>
                  <option value="Water">Water (Potable Drinking Water)</option>
                  <option value="Medical">Medical (First-aid / Medication)</option>
                  <option value="Food">Food (Emergency Rations)</option>
                  <option value="Shelter">Shelter (Displacement / Housing)</option>
                </select>
              </div>
            </div>

            {/* Grid for Zone, Severity, Quantity */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
                  Zone ID *
                </label>
                <select
                  value={zoneId}
                  onChange={(e) => setZoneId(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-surface-elevated)',
                    border: '1px solid var(--border-medium)',
                    color: 'var(--text-primary)',
                    fontSize: '0.8125rem',
                    fontFamily: 'var(--font-mono)',
                    outline: 'none'
                  }}
                >
                  {zones && zones.length > 0 ? (
                    zones.map((z) => (
                      <option key={z.zone_id} value={z.zone_id}>
                        {z.zone_id} {z.geo_risk_class ? `(${z.geo_risk_class})` : ''}
                      </option>
                    ))
                  ) : (
                    <option value="Z001">Z001</option>
                  )}
                </select>
              </div>

              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
                  Severity Level *
                </label>
                <select
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-surface-elevated)',
                    border: '1px solid var(--border-medium)',
                    color: severity === 'CRITICAL' ? 'var(--alarm)' : 'var(--text-primary)',
                    fontWeight: 600,
                    fontSize: '0.8125rem',
                    outline: 'none'
                  }}
                >
                  <option value="CRITICAL">CRITICAL (Life-Threatening)</option>
                  <option value="HIGH">HIGH (Urgent Assistance)</option>
                  <option value="MEDIUM">MEDIUM (Needs Support)</option>
                  <option value="LOW">LOW (Inquiry / Non-urgent)</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
                  Quantity / Scope
                </label>
                <input
                  type="text"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="e.g. 4 persons, 5 cans"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-surface-elevated)',
                    border: '1px solid var(--border-medium)',
                    color: 'var(--text-primary)',
                    fontSize: '0.8125rem',
                    outline: 'none'
                  }}
                />
              </div>
            </div>

            {/* Description */}
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
                Distress Description *
              </label>
              <textarea
                required
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="State the emergency details clearly..."
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-surface-elevated)',
                  border: '1px solid var(--border-medium)',
                  color: 'var(--text-primary)',
                  fontSize: '0.8125rem',
                  outline: 'none',
                  resize: 'vertical'
                }}
              />
            </div>

            {/* Coordinates & Event ID */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '12px',
              padding: '10px',
              background: 'var(--bg-surface-elevated)',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-subtle)'
            }}>
              <div>
                <label style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                  Beacon Event ID
                </label>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <input
                    type="text"
                    value={eventId}
                    onChange={(e) => setEventId(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '4px 8px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--bg-primary)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-primary)',
                      fontSize: '0.75rem',
                      fontFamily: 'var(--font-mono)'
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setEventId(`SOS-SIM-${Math.random().toString(36).substring(2, 8).toUpperCase()}`)}
                    className="btn-icon"
                    style={{ padding: '4px', width: '28px', height: '28px' }}
                    title="Generate new Event ID"
                  >
                    <RefreshCw size={12} />
                  </button>
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                  Latitude (approx)
                </label>
                <input
                  type="number"
                  step="0.0001"
                  value={latitude || ''}
                  onChange={(e) => setLatitude(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '4px 8px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-primary)',
                    fontSize: '0.75rem'
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                  Longitude (approx)
                </label>
                <input
                  type="number"
                  step="0.0001"
                  value={longitude || ''}
                  onChange={(e) => setLongitude(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '4px 8px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-primary)',
                    fontSize: '0.75rem'
                  }}
                />
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={onClose}
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn-primary"
                disabled={isSubmitting}
                style={{
                  background: 'var(--alarm)',
                  borderColor: 'var(--alarm)',
                  color: '#fff',
                  fontWeight: 600
                }}
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw size={14} className="spin" />
                    Transmitting SOS...
                  </>
                ) : (
                  <>
                    <Send size={14} />
                    Dispatch Simulated SOS
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
