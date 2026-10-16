import React, { useState, useEffect } from 'react';
import { X, Users, Shield, MapPin, Phone, UserCheck, AlertCircle, Save } from 'lucide-react';
import { createTeam, updateTeam } from '../api/client';

const TEAM_TYPES = [
  'Rescue & Evacuation',
  'Water Rescue & Evacuation',
  'Field Medical Support',
  'Relief Supply Logistics',
  'Search & Vulnerable Evacuation',
  'Hazard Assessment',
  'General Response'
];

export default function TeamModal({ isOpen, onClose, team = null, onSaved }) {
  const [name, setName] = useState('');
  const [teamType, setTeamType] = useState('Rescue & Evacuation');
  const [skills, setSkills] = useState('');
  const [equipment, setEquipment] = useState('');
  const [baseLocation, setBaseLocation] = useState('Central Depot - Sitabuldi');
  const [leaderName, setLeaderName] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [availabilityStatus, setAvailabilityStatus] = useState('Available');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (team) {
      setName(team.name || '');
      setTeamType(team.team_type || 'Rescue & Evacuation');
      setSkills(team.skills || '');
      setEquipment(team.equipment || '');
      setBaseLocation(team.base_location || 'Central Depot - Sitabuldi');
      setLeaderName(team.leader_name || '');
      setContactNumber(team.contact_number || '');
      setAvailabilityStatus(team.availability_status || 'Available');
    } else {
      setName('');
      setTeamType('Rescue & Evacuation');
      setSkills('');
      setEquipment('');
      setBaseLocation('Central Depot - Sitabuldi');
      setLeaderName('');
      setContactNumber('');
      setAvailabilityStatus('Available');
    }
    setError(null);
  }, [team, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Team name is required');
      return;
    }
    setIsSubmitting(true);
    setError(null);

    try {
      if (team) {
        const payload = {
          name: name.trim(),
          team_type: teamType,
          skills: skills.trim(),
          equipment: equipment.trim(),
          base_location: baseLocation.trim(),
          leader_name: leaderName.trim(),
          contact_number: contactNumber.trim(),
          availability_status: availabilityStatus
        };
        const updated = await updateTeam(team.team_id, payload);
        if (onSaved) onSaved(updated);
      } else {
        const payload = {
          name: name.trim(),
          team_type: teamType,
          skills: skills.trim(),
          equipment: equipment.trim(),
          base_location: baseLocation.trim(),
          leader_name: leaderName.trim(),
          contact_number: contactNumber.trim()
        };
        const created = await createTeam(payload);
        if (onSaved) onSaved(created);
      }
      onClose();
    } catch (err) {
      setError(err.message || 'Operation failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.75)',
      backdropFilter: 'blur(4px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: '16px'
    }}>
      <div style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-lg)',
        width: '100%',
        maxWidth: '560px',
        maxHeight: '90vh',
        overflowY: 'auto',
        boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
        display: 'flex',
        flexDirection: 'column'
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'var(--bg-surface-elevated)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              background: 'var(--accent-subtle)',
              color: 'var(--accent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <Users size={18} />
            </div>
            <div>
              <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                {team ? `Edit Team: ${team.team_id}` : 'Register Response Team'}
              </h2>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>
                {team ? 'Update team capabilities and status' : 'Add a dedicated flood response unit'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: '6px',
              borderRadius: '6px'
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {error && (
            <div style={{
              padding: '10px 14px',
              borderRadius: '6px',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#ef4444',
              fontSize: '0.8125rem',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              Team Name *
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Nagpur Swiftwater Rescue Unit"
              style={{
                width: '100%',
                padding: '9px 12px',
                background: 'var(--bg-input)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '6px',
                color: 'var(--text-primary)',
                fontSize: '0.875rem'
              }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                Operational Type
              </label>
              <select
                value={teamType}
                onChange={(e) => setTeamType(e.target.value)}
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '6px',
                  color: 'var(--text-primary)',
                  fontSize: '0.8125rem'
                }}
              >
                {TEAM_TYPES.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>

            {team && (
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                  Availability Status
                </label>
                <select
                  value={availabilityStatus}
                  onChange={(e) => setAvailabilityStatus(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    background: 'var(--bg-input)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '6px',
                    color: 'var(--text-primary)',
                    fontSize: '0.8125rem'
                  }}
                >
                  <option value="Available">Available (Ready)</option>
                  <option value="Assigned">Assigned (Active Mission)</option>
                  <option value="Busy">Busy (Maintenance/Training)</option>
                  <option value="Offline">Offline (Off Duty)</option>
                </select>
              </div>
            )}
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              Base Location / Depot
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                value={baseLocation}
                onChange={(e) => setBaseLocation(e.target.value)}
                placeholder="e.g. Ambazari Lake Rescue Station"
                style={{
                  width: '100%',
                  padding: '9px 12px 9px 34px',
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '6px',
                  color: 'var(--text-primary)',
                  fontSize: '0.875rem'
                }}
              />
              <MapPin size={16} style={{ position: 'absolute', left: '10px', top: '10px', color: 'var(--text-muted)' }} />
            </div>
            <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>
              Location label: Will be tagged as Synthetic Demo Base for simulated logistics
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                Team Leader / Officer
              </label>
              <input
                type="text"
                value={leaderName}
                onChange={(e) => setLeaderName(e.target.value)}
                placeholder="e.g. Capt. Rajesh Sharma"
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '6px',
                  color: 'var(--text-primary)',
                  fontSize: '0.875rem'
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                Contact Hotline
              </label>
              <input
                type="text"
                value={contactNumber}
                onChange={(e) => setContactNumber(e.target.value)}
                placeholder="e.g. +91 98230 11221"
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '6px',
                  color: 'var(--text-primary)',
                  fontSize: '0.875rem'
                }}
              />
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              Skills & Qualifications
            </label>
            <textarea
              rows={2}
              value={skills}
              onChange={(e) => setSkills(e.target.value)}
              placeholder="e.g. Swiftwater Rescue, Boat Navigation, CPR, Water Safety"
              style={{
                width: '100%',
                padding: '9px 12px',
                background: 'var(--bg-input)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '6px',
                color: 'var(--text-primary)',
                fontSize: '0.8125rem',
                resize: 'vertical'
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              Dedicated Equipment & Vehicles
            </label>
            <textarea
              rows={2}
              value={equipment}
              onChange={(e) => setEquipment(e.target.value)}
              placeholder="e.g. Zodiac Inflatable Boat, 10 Type-III Lifejackets, Throw Bags, Waterproof Radios, Sonar"
              style={{
                width: '100%',
                padding: '9px 12px',
                background: 'var(--bg-input)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '6px',
                color: 'var(--text-primary)',
                fontSize: '0.8125rem',
                resize: 'vertical'
              }}
            />
          </div>

          {/* Footer Buttons */}
          <div style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '10px',
            marginTop: '8px',
            paddingTop: '16px',
            borderTop: '1px solid var(--border-subtle)'
          }}>
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              style={{
                padding: '8px 16px',
                background: 'transparent',
                border: '1px solid var(--border-subtle)',
                borderRadius: '6px',
                color: 'var(--text-secondary)',
                fontSize: '0.8125rem',
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 18px',
                background: 'var(--accent)',
                border: 'none',
                borderRadius: '6px',
                color: '#fff',
                fontWeight: 600,
                fontSize: '0.8125rem',
                cursor: 'pointer'
              }}
            >
              <Save size={15} />
              {isSubmitting ? 'Saving...' : team ? 'Update Team' : 'Register Team'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
