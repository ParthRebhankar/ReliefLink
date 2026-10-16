import React, { useState, useEffect } from 'react';
import { X, Sliders, AlertTriangle, Scale, CheckCircle2 } from 'lucide-react';
import { adjustStock } from '../api/client';

export default function StockAdjustmentModal({
  isOpen,
  onClose,
  item = null,
  onSuccess
}) {
  const [newOnHand, setNewOnHand] = useState('');
  const [reason, setReason] = useState('');
  const [operator, setOperator] = useState('Audit Officer');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (item) {
      setNewOnHand(String(item.on_hand ?? '0'));
    }
    setReason('');
    setOperator('Audit Officer');
    setError(null);
  }, [isOpen, item]);

  if (!isOpen || !item) return null;

  const currentOnHand = parseFloat(item.on_hand) || 0;
  const reservedStock = parseFloat(item.reserved) || 0;
  const parsedNew = parseFloat(newOnHand);
  const delta = !isNaN(parsedNew) ? parsedNew - currentOnHand : 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isNaN(parsedNew) || parsedNew < 0) {
      setError('New physical stock must be a non-negative number');
      return;
    }
    if (parsedNew < reservedStock) {
      setError(`Cannot reduce physical stock below currently reserved stock (${reservedStock} ${item.unit})`);
      return;
    }
    if (!reason.trim() || reason.trim().length < 3) {
      setError('A descriptive, mandatory reason (at least 3 characters) is required for audit compliance');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await adjustStock(item.id, {
        new_on_hand: parsedNew,
        reason: reason.trim(),
        operator: operator.trim() || 'Audit Officer'
      });
      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      setError(err.message || 'Stock adjustment failed');
    } finally {
      setIsSubmitting(false);
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
        maxWidth: '500px',
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
              <Scale size={18} color="var(--text-primary)" />
            </div>
            <div>
              <h2 style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                Physical Stock Correction
              </h2>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Audited stock reconciliation & discrepancy adjustment
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

        {/* Item context banner */}
        <div style={{
          padding: '12px var(--space-lg)',
          background: 'var(--bg-surface-elevated)',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '8px',
          textAlign: 'center'
        }}>
          <div>
            <div style={{ fontSize: '0.675rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Current On Hand</div>
            <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
              {currentOnHand} {item.unit}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '0.675rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Reserved / Locked</div>
            <div style={{ fontSize: '0.95rem', fontWeight: 700, color: reservedStock > 0 ? 'var(--status-warning)' : 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              {reservedStock} {item.unit}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '0.675rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Minimum Permitted</div>
            <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
              {reservedStock} {item.unit}
            </div>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ padding: 'var(--space-lg)', display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          {error && (
            <div style={{
              padding: '10px 14px',
              background: 'var(--alarm-bg)',
              border: '1px solid var(--alarm-border)',
              borderRadius: 'var(--radius-md)',
              fontSize: '0.8rem',
              color: 'var(--alarm)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              <AlertTriangle size={15} />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              Actual Physical Count on Shelf ({item.unit}) *
            </label>
            <input
              type="number"
              min="0"
              step="any"
              required
              value={newOnHand}
              onChange={(e) => setNewOnHand(e.target.value)}
              style={{
                width: '100%',
                background: 'var(--bg-surface-elevated)',
                border: '1px solid var(--border-medium)',
                borderRadius: 'var(--radius-sm)',
                padding: '9px 12px',
                color: 'var(--text-primary)',
                fontSize: '1rem',
                fontWeight: 600,
                fontFamily: 'var(--font-mono)'
              }}
            />
            {!isNaN(parsedNew) && (
              <p style={{
                fontSize: '0.75rem',
                marginTop: '6px',
                color: delta === 0 ? 'var(--text-muted)' : delta > 0 ? 'var(--status-safe-strong)' : 'var(--alarm)'
              }}>
                Discrepancy adjustment: <strong>{delta >= 0 ? `+${delta}` : delta} {item.unit}</strong>
                {delta < 0 && ' (Reduction will be permanently logged)'}
              </p>
            )}
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              Mandatory Audit Reason / Explanation *
            </label>
            <textarea
              required
              rows={3}
              placeholder="e.g. Physical inventory cycle count; 5 boxes discovered damaged by dampness in Section B; disposed per SOP."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              style={{
                width: '100%',
                background: 'var(--bg-surface-elevated)',
                border: '1px solid var(--border-medium)',
                borderRadius: 'var(--radius-sm)',
                padding: '9px 12px',
                color: 'var(--text-primary)',
                fontSize: '0.85rem',
                resize: 'none'
              }}
            />
            <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '4px' }}>
              Required by inventory audit policy. This entry is immutable and stored in the movement ledger.
            </p>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              Operator / Auditor Name *
            </label>
            <input
              type="text"
              required
              value={operator}
              onChange={(e) => setOperator(e.target.value)}
              style={{
                width: '100%',
                background: 'var(--bg-surface-elevated)',
                border: '1px solid var(--border-medium)',
                borderRadius: 'var(--radius-sm)',
                padding: '9px 12px',
                color: 'var(--text-primary)',
                fontSize: '0.85rem'
              }}
            />
          </div>

          <div style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '10px',
            marginTop: 'var(--space-sm)',
            borderTop: '1px solid var(--border-subtle)',
            paddingTop: 'var(--space-md)'
          }}>
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              style={{
                padding: '8px 16px',
                background: 'transparent',
                border: '1px solid var(--border-medium)',
                borderRadius: 'var(--radius-md)',
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
                gap: '8px',
                padding: '8px 18px',
                background: 'var(--text-primary)',
                color: 'var(--bg-primary)',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                fontSize: '0.8125rem',
                fontWeight: 600,
                cursor: isSubmitting ? 'not-allowed' : 'pointer'
              }}
            >
              <Scale size={15} />
              {isSubmitting ? 'Recording...' : 'Commit Correction'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
