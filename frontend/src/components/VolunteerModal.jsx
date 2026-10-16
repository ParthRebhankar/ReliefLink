import React, { useState, useEffect } from 'react';
import { X, User, Users, MapPin, Phone, AlertCircle, Save } from 'lucide-react';
import { createVolunteer, updateVolunteer, fetchTeams } from '../api/client';

export default function VolunteerModal({ isOpen, onClose, volunteer = null, onSaved }) {
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [teamId, setTeamId] = useState('');
  const [skills, setSkills] = useState('First Aid, General Assistance');
  const [currentZone, setCurrentZone] = useState('Sitabuldi');
  const [availabilityStatus, setAvailabilityStatus] = useState('Available');
  const [notes, setNotes] = useState('');
  const [teamsList, setTeamsList] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (isOpen) {
      fetchTeams().then(data => {
        setTeamsList(data.teams || []);
      }).catch(err => {
        console.error('Failed to load teams for dropdown:', err);
      });
    }
  }, [isOpen]);

  useEffect(() => {
    if (volunteer) {
      setName(volunteer.name || '');
      setContact(volunteer.contact || '');
      setTeamId(volunteer.team_id || '');
      setSkills(volunteer.skills || 'First Aid, General Assistance');
      setCurrentZone(volunteer.current_zone || 'Sitabuldi');
      setAvailabilityStatus(volunteer.availability_status || 'Available');
      setNotes(volunteer.notes || '');
    } else {
      setName('');
      setContact('');
      setTeamId('');
      setSkills('First Aid, General Assistance');
      setCurrentZone('Sitabuldi');
      setAvailabilityStatus('Available');
      setNotes('');
    }
    setError(null);
  }, [volunteer, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Volunteer name is required');
      return;
    }
    setIsSubmitting(true);
    setError(null);

    try {
      if (volunteer) {
        const payload = {
          name: name.trim(),
          contact: contact.trim(),
          team_id: teamId || '',
          skills: skills.trim(),
          current_zone: currentZone.trim(),
          availability_status: availabilityStatus,
          notes: notes.trim()
        };
        const updated = await updateVolunteer(volunteer.volunteer_id, payload);
        if (onSaved) onSaved(updated);
      } else {
        const payload = {
          name: name.trim(),
          contact: contact.trim(),
          team_id: teamId || null,
          skills: skills.trim(),
          current_zone: currentZone.trim(),
          notes: notes.trim()
        };
        const created = await createVolunteer(payload);
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
        maxWidth: '520px',
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
              background: 'rgba(16, 185, 129, 0.1)',
              color: '#10b981',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <User size={18} />
            </div>
            <div>
              <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                {volunteer ? `Edit Volunteer: ${volunteer.volunteer_id}` : 'Register Volunteer'}
              </h2>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>
                {volunteer ? 'Update skills, team assignment or availability' : 'Add a disaster relief responder to the network'}
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
              Full Name / Demo Label *
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Priya Nair"
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
                Contact Phone
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  placeholder="e.g. +91 98211 10002"
                  style={{
                    width: '100%',
                    padding: '9px 12px 9px 32px',
                    background: 'var(--bg-input)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '6px',
                    color: 'var(--text-primary)',
                    fontSize: '0.8125rem'
                  }}
                />
                <Phone size={14} style={{ position: 'absolute', left: '10px', top: '12px', color: 'var(--text-muted)' }} />
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                Assigned Team
              </label>
              <select
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
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
                <option value="">(Unattached / Independent)</option>
                {teamsList.map(t => (
                  <option key={t.team_id} value={t.team_id}>
                    {t.name} ({t.team_id})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                Current Zone / Base
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  value={currentZone}
                  onChange={(e) => setCurrentZone(e.target.value)}
                  placeholder="e.g. Sitabuldi"
                  style={{
                    width: '100%',
                    padding: '9px 12px 9px 32px',
                    background: 'var(--bg-input)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '6px',
                    color: 'var(--text-primary)',
                    fontSize: '0.8125rem'
                  }}
                />
                <MapPin size={14} style={{ position: 'absolute', left: '10px', top: '12px', color: 'var(--text-muted)' }} />
              </div>
            </div>

            {volunteer && (
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
                  <option value="Available">Available</option>
                  <option value="Assigned">Assigned (Active Task)</option>
                  <option value="Busy">Busy</option>
                  <option value="Offline">Offline</option>
                </select>
              </div>
            )}
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              Skills & Expertise (Comma-separated)
            </label>
            <input
              type="text"
              value={skills}
              onChange={(e) => setSkills(e.target.value)}
              placeholder="e.g. Water Rescue, CPR, Logistics, Hindi & Marathi, Drone Pilot"
              style={{
                width: '100%',
                padding: '9px 12px',
                background: 'var(--bg-input)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '6px',
                color: 'var(--text-primary)',
                fontSize: '0.8125rem'
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              Coordinator Notes & Certifications
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Certified boat pilot with 5 years experience in river floodings"
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

          <div style={{
            fontSize: '0.6875rem',
            color: 'var(--text-muted)',
            background: 'var(--bg-surface-elevated)',
            padding: '8px 12px',
            borderRadius: '6px',
            border: '1px solid var(--border-subtle)'
          }}>
            📍 Demo Note: Last known location will be recorded as <strong>{currentZone} (Synthetic Demo)</strong>. Real GPS tracking is simulated and clearly demarcated.
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
                background: '#10b981',
                border: 'none',
                borderRadius: '6px',
                color: '#fff',
                fontWeight: 600,
                fontSize: '0.8125rem',
                cursor: 'pointer'
              }}
            >
              <Save size={15} />
              {isSubmitting ? 'Saving...' : volunteer ? 'Update Volunteer' : 'Register Volunteer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
