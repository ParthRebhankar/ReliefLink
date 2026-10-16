import React, { useState } from 'react';
import { X, PlusCircle, AlertTriangle, Send, RefreshCw, MapPin } from 'lucide-react';
import { createEmergencyRequest } from '../api/client';

export default function CreateRequestModal({
  isOpen,
  onClose,
  selectedZone = 'Z001',
  zones = [],
  onRequestCreated
}) {
  const [householdLabel, setHouseholdLabel] = useState('');
  const [category, setCategory] = useState('Water');
  const [zoneId, setZoneId] = useState(selectedZone || 'Z001');
  const [severity, setSeverity] = useState('MEDIUM');
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [notes, setNotes] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const payload = {
        household_label: householdLabel.trim(),
        category,
        description: description.trim(),
        quantity: quantity.trim(),
        latitude: latitude ? parseFloat(latitude) : undefined,
        longitude: longitude ? parseFloat(longitude) : undefined,
        zone_id: zoneId,
        severity,
        coordinator_notes: notes.trim(),
        source: 'web_form'
      };

      const res = await createEmergencyRequest(payload);
      if (onRequestCreated) onRequestCreated(res);
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to create emergency request');
    } finally {
      setIsSubmitting(false);
    }
  };

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
        maxWidth: '600px',
        width: '100%',
        maxHeight: '92vh',
        overflowY: 'auto',
        padding: '24px',
        border: '1px solid var(--border-medium)',
        background: 'var(--bg-surface)',
        borderRadius: 'var(--radius-lg)'
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '36px',
              height: '36px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--accent-bg)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-primary)'
            }}>
              <PlusCircle size={20} />
            </div>
            <div>
              <h2 style={{ fontSize: '1.125rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                New Emergency Request Intake
              </h2>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Manual log for citizen portal, helpline desk, or municipal field operator
              </p>
            </div>
          </div>

          <button onClick={onClose} className="btn-icon" style={{ width: '32px', height: '32px' }} aria-label="Close modal">
            <X size={16} />
          </button>
        </div>

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
            gap: '8px',
            marginBottom: '16px'
          }}>
            <AlertTriangle size={15} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px' }}>
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
                Household / Contact Label *
              </label>
              <input
                type="text"
                required
                value={householdLabel}
                onChange={(e) => setHouseholdLabel(e.target.value)}
                placeholder="e.g. House 14, Ward 8 Reshimbagh"
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
                Request Category *
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
                <option value="Water">Water (Potable / Clean Water)</option>
                <option value="Food">Food (Dry Rations / Ready Meals)</option>
                <option value="Medical">Medical (First-aid / Urgent Medicine)</option>
                <option value="Rescue">Rescue (Boat / Evacuation Needed)</option>
                <option value="Shelter">Shelter (Temporary Dry Accommodation)</option>
              </select>
            </div>
          </div>

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
                Severity Assessment *
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
                <option value="CRITICAL">CRITICAL (Direct Threat to Life)</option>
                <option value="HIGH">HIGH (Severe Need within 2-4 hrs)</option>
                <option value="MEDIUM">MEDIUM (Standard Relief Support)</option>
                <option value="LOW">LOW (Informational / Deferred)</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
                Quantity / Number
              </label>
              <input
                type="text"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="e.g. 5 water cans, 3 persons"
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

          <div>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
              Detailed Description *
            </label>
            <textarea
              required
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Specific details about flood depth, vulnerability, access route, or urgent condition..."
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

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                Latitude (optional)
              </label>
              <input
                type="number"
                step="0.0001"
                value={latitude}
                onChange={(e) => setLatitude(e.target.value)}
                placeholder="e.g. 21.1458"
                style={{
                  width: '100%',
                  padding: '6px 10px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-surface-elevated)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)',
                  fontSize: '0.75rem'
                }}
              />
            </div>

            <div>
              <label style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                Longitude (optional)
              </label>
              <input
                type="number"
                step="0.0001"
                value={longitude}
                onChange={(e) => setLongitude(e.target.value)}
                placeholder="e.g. 79.0882"
                style={{
                  width: '100%',
                  padding: '6px 10px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-surface-elevated)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)',
                  fontSize: '0.75rem'
                }}
              />
            </div>
          </div>

          <div>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
              Coordinator / Dispatcher Notes
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Citizen contacted via helpline desk #3"
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

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
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
            >
              {isSubmitting ? (
                <>
                  <RefreshCw size={14} className="spin" />
                  Logging Request...
                </>
              ) : (
                <>
                  <Send size={14} />
                  Submit Emergency Request
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
