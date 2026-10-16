import React, { useState, useEffect, useCallback } from 'react';
import { X, History, Clock, User, FileText } from 'lucide-react';
import { fetchItemMovements } from '../api/client';

export default function StockMovementsModal({
  isOpen,
  onClose,
  item = null
}) {
  const [movements, setMovements] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const loadMovements = useCallback(async () => {
    if (!item) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchItemMovements(item.id, 100);
      setMovements(data);
    } catch (err) {
      setError(err.message || 'Failed to load stock movements');
    } finally {
      setIsLoading(false);
    }
  }, [item]);

  useEffect(() => {
    if (isOpen && item) {
      loadMovements();
    }
  }, [isOpen, item, loadMovements]);

  if (!isOpen || !item) return null;

  const getMovementBadge = (type) => {
    switch (type) {
      case 'INCOMING':
        return { label: 'Incoming Receipt', bg: 'rgba(255, 255, 255, 0.1)', color: 'var(--text-primary)' };
      case 'CORRECTION':
        return { label: 'Correction', bg: 'rgba(255, 255, 255, 0.08)', color: 'var(--text-secondary)' };
      case 'ALLOCATION_RESERVED':
        return { label: 'Reserved for Relief', bg: 'rgba(255, 255, 255, 0.06)', color: 'var(--text-secondary)' };
      case 'RESERVATION_DISPATCHED':
        return { label: 'Dispatched to Field', bg: 'rgba(255, 69, 58, 0.15)', color: 'var(--alarm)' };
      case 'DELIVERED':
        return { label: 'Field Delivery Confirmed', bg: 'rgba(255, 255, 255, 0.15)', color: 'var(--text-primary)' };
      case 'RESERVATION_CANCELLED':
        return { label: 'Reservation Released', bg: 'rgba(255, 255, 255, 0.06)', color: 'var(--text-muted)' };
      case 'INITIAL_BALANCE':
      default:
        return { label: 'Initial Inventory', bg: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-muted)' };
    }
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(5, 5, 5, 0.8)',
      backdropFilter: 'blur(10px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 100,
      padding: 'var(--space-md)'
    }}>
      <div style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-medium)',
        borderRadius: 'var(--radius-lg)',
        width: '100%',
        maxWidth: '720px',
        maxHeight: '85vh',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 20px 40px rgba(0,0,0,0.6)'
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 'var(--space-lg)',
          borderBottom: '1px solid var(--border-subtle)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '36px',
              height: '36px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--bg-surface-elevated)',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <History size={18} color="var(--text-primary)" />
            </div>
            <div>
              <h2 style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                Stock Movement Ledger
              </h2>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {item.name} • {item.storage_location}
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
              padding: '6px'
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Content list */}
        <div style={{ padding: 'var(--space-lg)', overflowY: 'auto', flex: 1 }}>
          {isLoading ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Loading movement history...
            </div>
          ) : error ? (
            <div style={{ padding: '16px', background: 'var(--alarm-bg)', color: 'var(--alarm)', borderRadius: 'var(--radius-md)', fontSize: '0.85rem' }}>
              {error}
            </div>
          ) : movements.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              No recorded stock movements found for this item.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {movements.map((m) => {
                const badge = getMovementBadge(m.movement_type);
                const isPositive = m.quantity > 0;
                const formattedDate = new Date(m.created_at).toLocaleString('en-IN', {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit'
                });

                return (
                  <div
                    key={m.id || m.movement_id}
                    style={{
                      background: 'var(--bg-surface-elevated)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-md)',
                      padding: '12px 16px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '16px'
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                        <span style={{
                          padding: '2px 8px',
                          borderRadius: 'var(--radius-full)',
                          background: badge.bg,
                          color: badge.color,
                          fontSize: '0.675rem',
                          fontWeight: 600,
                          textTransform: 'uppercase',
                          letterSpacing: '0.04em'
                        }}>
                          {badge.label}
                        </span>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                          {m.movement_id}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.825rem', color: 'var(--text-primary)', marginBottom: '3px' }}>
                        {m.reason || 'No description provided'}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Clock size={12} />
                          {formattedDate}
                        </span>
                        {m.operator && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <User size={12} />
                            {m.operator}
                          </span>
                        )}
                        {m.reference_id && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontFamily: 'var(--font-mono)' }}>
                            <FileText size={12} />
                            Ref: {m.reference_id}
                          </span>
                        )}
                      </div>
                    </div>

                    <div style={{ textAlign: 'right', minWidth: '90px' }}>
                      <div style={{
                        fontSize: '0.95rem',
                        fontWeight: 700,
                        fontFamily: 'var(--font-mono)',
                        color: m.movement_type === 'RESERVATION_DISPATCHED' ? 'var(--alarm)' : 'var(--text-primary)'
                      }}>
                        {m.quantity > 0 ? `+${m.quantity}` : m.quantity} <span style={{ fontSize: '0.7rem', fontWeight: 400 }}>{item.unit}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px var(--space-lg)',
          borderTop: '1px solid var(--border-subtle)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '0.75rem',
          color: 'var(--text-muted)'
        }}>
          <div>Total Movements: {movements.length}</div>
          <button
            onClick={onClose}
            style={{
              padding: '6px 14px',
              background: 'var(--bg-surface-elevated)',
              border: '1px solid var(--border-medium)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              fontSize: '0.75rem'
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
