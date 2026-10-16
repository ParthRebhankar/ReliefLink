import React, { useState, useEffect } from 'react';
import { X, CheckCircle, Truck, MapPin, AlertTriangle, XCircle, ArrowRight, Activity } from 'lucide-react';
import { updateAssignmentAction } from '../api/client';

export default function TaskActionModal({ isOpen, onClose, assignment, actionType, onActionCompleted }) {
  const [actor, setActor] = useState('Coordinator');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setNote('');
    setReason('');
    setError(null);
  }, [isOpen, actionType, assignment]);

  if (!isOpen || !assignment) return null;

  const isCancel = actionType === 'Cancel';
  const isComplete = actionType === 'Complete';
  const isEnRoute = actionType === 'En Route';
  const isArrive = actionType === 'Arrive';
  const isAccept = actionType === 'Accept';

  const getActionTitle = () => {
    if (isCancel) return 'Cancel Task Assignment';
    if (isComplete) return 'Confirm Mission Completion';
    if (isEnRoute) return 'Mark Team / Volunteer En Route';
    if (isArrive) return 'Confirm Arrival at Destination';
    if (isAccept) return 'Accept Operational Assignment';
    return `Update Task: ${actionType}`;
  };

  const getActionButtonStyle = () => {
    if (isCancel) return { background: '#ef4444', color: '#fff' };
    if (isComplete) return { background: '#10b981', color: '#fff' };
    if (isEnRoute) return { background: '#3b82f6', color: '#fff' };
    if (isArrive) return { background: '#8b5cf6', color: '#fff' };
    return { background: 'var(--accent)', color: '#fff' };
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isCancel && (!reason.trim() || reason.trim().length < 3)) {
      setError('A cancellation reason of at least 3 characters is mandatory');
      return;
    }
    setIsSubmitting(true);
    setError(null);

    try {
      const payload = {
        action: actionType,
        actor: actor.trim() || 'Coordinator',
        note: note.trim(),
        reason: reason.trim()
      };
      const res = await updateAssignmentAction(assignment.assignment_id, payload);
      if (onActionCompleted) onActionCompleted(res.assignment);
      onClose();
    } catch (err) {
      setError(err.message || 'Action failed');
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
      zIndex: 1100,
      padding: '16px'
    }}>
      <div style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-lg)',
        width: '100%',
        maxWidth: '500px',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
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
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              ...getActionButtonStyle()
            }}>
              {isCancel && <XCircle size={18} />}
              {isComplete && <CheckCircle size={18} />}
              {isEnRoute && <Truck size={18} />}
              {isArrive && <MapPin size={18} />}
              {isAccept && <Activity size={18} />}
            </div>
            <div>
              <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                {getActionTitle()}
              </h2>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>
                {assignment.assignment_id} &bull; {assignment.assignee_name}
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
        <form onSubmit={handleSubmit} style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {error && (
            <div style={{
              padding: '10px 14px',
              borderRadius: '6px',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#ef4444',
              fontSize: '0.8125rem'
            }}>
              {error}
            </div>
          )}

          {/* Current Mission Snapshot */}
          <div style={{
            background: 'var(--bg-surface-elevated)',
            padding: '12px 14px',
            borderRadius: '8px',
            border: '1px solid var(--border-subtle)',
            fontSize: '0.8125rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Task Type:</span>
              <strong style={{ color: 'var(--text-primary)' }}>{assignment.task_type}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Current Status:</span>
              <span style={{ fontWeight: 600, color: 'var(--accent)' }}>{assignment.status}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Destination:</span>
              <span style={{ color: 'var(--text-primary)' }}>{assignment.destination}</span>
            </div>
            {assignment.allocation_id && (
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border-subtle)', paddingTop: '4px', marginTop: '4px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Linked Allocation:</span>
                <span style={{ color: '#38bdf8', fontFamily: 'monospace' }}>{assignment.allocation_id}</span>
              </div>
            )}
          </div>

          {/* Simulation disclaimer */}
          {(isEnRoute || isArrive) && (
            <div style={{
              background: 'rgba(56, 189, 248, 0.08)',
              border: '1px solid rgba(56, 189, 248, 0.25)',
              padding: '8px 12px',
              borderRadius: '6px',
              color: '#38bdf8',
              fontSize: '0.75rem'
            }}>
              📡 <strong>Synthetic Demo Simulation:</strong> This action logs simulated route waypoints towards the destination zone without accessing real GPS hardware.
            </div>
          )}

          {/* Important invariant notice for completion */}
          {isComplete && (
            <div style={{
              background: 'rgba(16, 185, 129, 0.08)',
              border: '1px solid rgba(16, 185, 129, 0.25)',
              padding: '8px 12px',
              borderRadius: '6px',
              color: '#10b981',
              fontSize: '0.75rem'
            }}>
              ℹ️ <strong>Stock Delivery Separation:</strong> Completing this task releases the team's availability back to Ready. If supplies were handed over, confirm delivery in the Request Detail Allocations section.
            </div>
          )}

          {isCancel && (
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#ef4444', marginBottom: '6px' }}>
                Cancellation Reason * (Mandatory for audit ledger)
              </label>
              <textarea
                required
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Route blocked by severe water surge; redirecting to higher elevation"
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  background: 'var(--bg-input)',
                  border: '1px solid rgba(239, 68, 68, 0.4)',
                  borderRadius: '6px',
                  color: 'var(--text-primary)',
                  fontSize: '0.8125rem'
                }}
              />
            </div>
          )}

          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              Field Log / Mission Notes
            </label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Inflatable boat deployed; 4 family members secured"
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
              Operating Officer / Dispatcher
            </label>
            <input
              type="text"
              value={actor}
              onChange={(e) => setActor(e.target.value)}
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
            paddingTop: '14px',
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
                border: 'none',
                borderRadius: '6px',
                fontWeight: 600,
                fontSize: '0.8125rem',
                cursor: 'pointer',
                ...getActionButtonStyle()
              }}
            >
              {isSubmitting ? 'Processing...' : `Confirm: ${actionType}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
