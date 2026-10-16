import React, { useState, useEffect } from 'react';
import { X, Users, Shield, MapPin, AlertCircle, Save, AlertTriangle, Truck } from 'lucide-react';
import { fetchTeams, fetchVolunteers, createAssignment } from '../api/client';

export default function AssignTaskModal({ isOpen, onClose, requestData, onAssignmentCreated }) {
  const [assigneeType, setAssigneeType] = useState('Team'); // 'Team' | 'Volunteer'
  const [teams, setTeams] = useState([]);
  const [volunteers, setVolunteers] = useState([]);
  const [selectedAssigneeId, setSelectedAssigneeId] = useState('');
  const [taskType, setTaskType] = useState('Delivery');
  const [taskDescription, setTaskDescription] = useState('');
  const [priority, setPriority] = useState('High');
  const [destination, setDestination] = useState('');
  const [selectedAllocationId, setSelectedAllocationId] = useState('');
  const [emergencyOverride, setEmergencyOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [assignedBy, setAssignedBy] = useState('Coordinator');
  const [loadingAssignees, setLoadingAssignees] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const request = requestData?.request || {};
  const allocations = (requestData?.allocations || []).filter(a => a.status !== 'Cancelled');
  const isVerified = request.verification_status === 'Verified';

  useEffect(() => {
    if (isOpen) {
      setLoadingAssignees(true);
      setError(null);
      Promise.all([fetchTeams(), fetchVolunteers()]).then(([tData, vData]) => {
        const availableTeams = (tData.teams || []).filter(t => t.availability_status === 'Available');
        const availableVols = (vData.volunteers || []).filter(v => v.availability_status === 'Available');
        setTeams(tData.teams || []);
        setVolunteers(vData.volunteers || []);

        if (availableTeams.length > 0) {
          setSelectedAssigneeId(availableTeams[0].team_id);
        } else if (availableVols.length > 0) {
          setAssigneeType('Volunteer');
          setSelectedAssigneeId(availableVols[0].volunteer_id);
        }
      }).catch(err => {
        setError('Failed to fetch teams/volunteers: ' + err.message);
      }).finally(() => {
        setLoadingAssignees(false);
      });

      // Default destination to household location / zone
      const destDefault = request.household_label ? `${request.household_label} (${request.zone_id || 'Nagpur'})` : (request.zone_id || 'Nagpur Sector');
      setDestination(destDefault);

      // Default description based on category
      const cat = request.category || 'General';
      if (cat === 'Rescue') {
        setTaskType('Rescue Evacuation');
        setTaskDescription(`Urgent boat rescue evacuation: ${request.description || 'Assistance requested'}`);
        setPriority('Critical');
      } else if (cat === 'Medical') {
        setTaskType('Medical Support');
        setTaskDescription(`Medical first responder triage: ${request.description || 'Medical relief'}`);
        setPriority('High');
      } else {
        setTaskType('Delivery');
        setTaskDescription(`Delivery of emergency ${cat.toLowerCase()} supplies to household`);
        setPriority(request.severity === 'CRITICAL' ? 'Critical' : 'High');
      }

      // Default allocation
      if (allocations.length > 0) {
        setSelectedAllocationId(allocations[0].allocation_id);
      } else {
        setSelectedAllocationId('');
      }

      setEmergencyOverride(!isVerified);
      setOverrideReason('');
    }
  }, [isOpen, requestData]);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedAssigneeId) {
      setError('Please select an operational team or volunteer');
      return;
    }
    if (!taskDescription.trim()) {
      setError('Task description is required');
      return;
    }
    if (!destination.trim()) {
      setError('Destination location is required');
      return;
    }
    if (!isVerified && (!emergencyOverride || !overrideReason.trim() || overrideReason.trim().length < 5)) {
      setError('This request is not yet verified. An emergency override with a valid reason (min 5 characters) is required.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const payload = {
        request_id: request.request_id,
        assignee_type: assigneeType,
        assignee_id: selectedAssigneeId,
        task_type: taskType,
        task_description: taskDescription.trim(),
        priority: priority,
        destination: destination.trim(),
        allocation_id: selectedAllocationId || null,
        assigned_by: assignedBy.trim() || 'Coordinator',
        emergency_override: emergencyOverride,
        override_reason: emergencyOverride ? overrideReason.trim() : ''
      };

      const created = await createAssignment(payload);
      if (onAssignmentCreated) onAssignmentCreated(created);
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to create operational assignment');
    } finally {
      setIsSubmitting(false);
    }
  };

  const currentAssignees = assigneeType === 'Team' ? teams : volunteers;
  const availableAssignees = currentAssignees.filter(a => a.availability_status === 'Available');

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
      zIndex: 1200,
      padding: '16px'
    }}>
      <div style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-lg)',
        width: '100%',
        maxWidth: '580px',
        maxHeight: '92vh',
        overflowY: 'auto',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
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
              <Truck size={18} />
            </div>
            <div>
              <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                Deploy Response Team / Volunteer
              </h2>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>
                Assign task for request {request.request_id} ({request.household_label})
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

        {/* Request Context Strip */}
        <div style={{
          background: 'var(--bg-surface-elevated)',
          padding: '12px 20px',
          borderBottom: '1px solid var(--border-subtle)',
          fontSize: '0.75rem',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '16px',
          color: 'var(--text-secondary)'
        }}>
          <div>Category: <strong style={{ color: 'var(--text-primary)' }}>{request.category}</strong></div>
          <div>Severity: <strong style={{ color: request.severity === 'CRITICAL' ? '#ef4444' : 'var(--text-primary)' }}>{request.severity}</strong></div>
          <div>Zone: <strong style={{ color: 'var(--text-primary)' }}>{request.zone_id}</strong></div>
          <div>Status: <strong style={{ color: isVerified ? '#10b981' : '#f59e0b' }}>{request.verification_status}</strong></div>
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

          {/* Verification check / Emergency Override */}
          {!isVerified && (
            <div style={{
              background: 'rgba(245, 158, 11, 0.08)',
              border: '1px solid rgba(245, 158, 11, 0.3)',
              borderRadius: '8px',
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#f59e0b', fontSize: '0.8125rem', fontWeight: 600 }}>
                <AlertTriangle size={16} />
                <span>Notice: Request is Unverified ({request.verification_status})</span>
              </div>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: 0 }}>
                Assignment rule enforces verification before operational deployment unless an authorized life-safety emergency override is applied.
              </p>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8125rem', color: 'var(--text-primary)', cursor: 'pointer', marginTop: '4px' }}>
                <input
                  type="checkbox"
                  checked={emergencyOverride}
                  onChange={(e) => setEmergencyOverride(e.target.checked)}
                />
                <span style={{ fontWeight: 600 }}>Authorize Operational Emergency Override</span>
              </label>

              {emergencyOverride && (
                <div>
                  <input
                    type="text"
                    required
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    placeholder="Mandatory override audit justification (e.g. Life threat exception)"
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      background: 'var(--bg-input)',
                      border: '1px solid rgba(245, 158, 11, 0.4)',
                      borderRadius: '6px',
                      color: 'var(--text-primary)',
                      fontSize: '0.75rem',
                      marginTop: '4px'
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Assignee Type Selector */}
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '8px' }}>
              Assignee Category
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <button
                type="button"
                onClick={() => {
                  setAssigneeType('Team');
                  const avail = teams.filter(t => t.availability_status === 'Available');
                  if (avail.length > 0) setSelectedAssigneeId(avail[0].team_id);
                  else setSelectedAssigneeId('');
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  padding: '9px',
                  borderRadius: '6px',
                  border: assigneeType === 'Team' ? '2px solid var(--accent)' : '1px solid var(--border-subtle)',
                  background: assigneeType === 'Team' ? 'var(--accent-subtle)' : 'var(--bg-surface-elevated)',
                  color: assigneeType === 'Team' ? 'var(--accent)' : 'var(--text-secondary)',
                  fontWeight: 600,
                  fontSize: '0.8125rem',
                  cursor: 'pointer'
                }}
              >
                <Shield size={16} />
                Response Team
              </button>

              <button
                type="button"
                onClick={() => {
                  setAssigneeType('Volunteer');
                  const avail = volunteers.filter(v => v.availability_status === 'Available');
                  if (avail.length > 0) setSelectedAssigneeId(avail[0].volunteer_id);
                  else setSelectedAssigneeId('');
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  padding: '9px',
                  borderRadius: '6px',
                  border: assigneeType === 'Volunteer' ? '2px solid #10b981' : '1px solid var(--border-subtle)',
                  background: assigneeType === 'Volunteer' ? 'rgba(16, 185, 129, 0.1)' : 'var(--bg-surface-elevated)',
                  color: assigneeType === 'Volunteer' ? '#10b981' : 'var(--text-secondary)',
                  fontWeight: 600,
                  fontSize: '0.8125rem',
                  cursor: 'pointer'
                }}
              >
                <Users size={16} />
                Field Volunteer
              </button>
            </div>
          </div>

          {/* Select Member/Team dropdown */}
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              Select Available {assigneeType === 'Team' ? 'Response Team' : 'Field Volunteer'} *
            </label>
            <select
              value={selectedAssigneeId}
              onChange={(e) => setSelectedAssigneeId(e.target.value)}
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
              {availableAssignees.length === 0 && (
                <option value="">No available {assigneeType.toLowerCase()}s found (all busy/offline)</option>
              )}
              {availableAssignees.map(a => (
                <option key={assigneeType === 'Team' ? a.team_id : a.volunteer_id} value={assigneeType === 'Team' ? a.team_id : a.volunteer_id}>
                  {a.name} ({assigneeType === 'Team' ? a.team_id : a.volunteer_id}) &bull; {a.skills || 'Ready'}
                </option>
              ))}
            </select>
          </div>

          {/* Task Type and Priority */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                Operational Task Type
              </label>
              <select
                value={taskType}
                onChange={(e) => setTaskType(e.target.value)}
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
                <option value="Delivery">Supply Delivery</option>
                <option value="Rescue Evacuation">Rescue Evacuation</option>
                <option value="Medical Support">Medical Support</option>
                <option value="Assessment">Damage & Depth Assessment</option>
                <option value="Shelter Support">Shelter Support</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                Priority Level
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
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
                <option value="Critical">Critical</option>
                <option value="High">High</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
              </select>
            </div>
          </div>

          {/* Linked Allocation (optional) */}
          {allocations.length > 0 && (
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                Link to Inventory Allocation (Optional)
              </label>
              <select
                value={selectedAllocationId}
                onChange={(e) => setSelectedAllocationId(e.target.value)}
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
                <option value="">(None / General Operational Task)</option>
                {allocations.map(a => (
                  <option key={a.allocation_id} value={a.allocation_id}>
                    {a.item_name} ({a.quantity_reserved} {a.item_unit}) &bull; Allocation {a.allocation_id}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Destination */}
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              Destination / Target Sector *
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                required
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="e.g. Sitabuldi Main Market, House 12"
                style={{
                  width: '100%',
                  padding: '9px 12px 9px 34px',
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '6px',
                  color: 'var(--text-primary)',
                  fontSize: '0.8125rem'
                }}
              />
              <MapPin size={15} style={{ position: 'absolute', left: '10px', top: '11px', color: 'var(--text-muted)' }} />
            </div>
          </div>

          {/* Task Description */}
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              Mission Description & Orders *
            </label>
            <textarea
              required
              rows={3}
              value={taskDescription}
              onChange={(e) => setTaskDescription(e.target.value)}
              placeholder="Provide exact field instructions, hazards, and objectives..."
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

          {/* Dispatcher name */}
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              Assigning Coordinator
            </label>
            <input
              type="text"
              value={assignedBy}
              onChange={(e) => setAssignedBy(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                background: 'var(--bg-input)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '6px',
                color: 'var(--text-primary)',
                fontSize: '0.8125rem'
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
              disabled={isSubmitting || availableAssignees.length === 0}
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
                cursor: 'pointer',
                opacity: (isSubmitting || availableAssignees.length === 0) ? 0.6 : 1
              }}
            >
              <Truck size={15} />
              {isSubmitting ? 'Dispatching...' : 'Confirm Assignment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
