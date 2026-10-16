import React, { useState, useEffect } from 'react';
import { X, ArrowDownCircle, AlertTriangle, CheckCircle, Package } from 'lucide-react';
import { receiveStock } from '../api/client';

export default function ReceiveStockModal({
  isOpen,
  onClose,
  item = null,
  onSuccess
}) {
  const [quantity, setQuantity] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [operator, setOperator] = useState('Logistics Officer');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setQuantity('');
    setReference('');
    setNotes('');
    setOperator('Logistics Officer');
    setError(null);
  }, [isOpen, item]);

  if (!isOpen || !item) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    const qty = parseFloat(quantity);
    if (isNaN(qty) || qty <= 0) {
      setError('Received quantity must be a positive number greater than 0');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await receiveStock(item.id, {
        quantity: qty,
        reference: reference.trim() || undefined,
        notes: notes.trim() || undefined,
        operator: operator.trim() || 'Logistics Officer'
      });
      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to record incoming stock');
    } finally {
      setIsSubmitting(false);
    }
  };

  const parsedQty = parseFloat(quantity) || 0;
  const projectedOnHand = (item.on_hand || 0) + parsedQty;

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
        maxWidth: '480px',
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
              <ArrowDownCircle size={18} color="var(--text-primary)" />
            </div>
            <div>
              <h2 style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                Receive Incoming Stock
              </h2>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Record incoming shipment or donation receipt
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
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div>
            <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              {item.name}
            </div>
            <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)' }}>
              {item.storage_location} • Category: {item.category}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '0.675rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Current On Hand</div>
            <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
              {item.on_hand} <span style={{ fontSize: '0.75rem', fontWeight: 400 }}>{item.unit}</span>
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
              Incoming Quantity ({item.unit}) *
            </label>
            <input
              type="number"
              min="0.01"
              step="any"
              required
              placeholder={`Enter quantity in ${item.unit}`}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              style={{
                width: '100%',
                background: 'var(--bg-surface-elevated)',
                border: '1px solid var(--border-medium)',
                borderRadius: 'var(--radius-sm)',
                padding: '9px 12px',
                color: 'var(--text-primary)',
                fontSize: '0.95rem',
                fontFamily: 'var(--font-mono)'
              }}
            />
            {parsedQty > 0 && (
              <p style={{ fontSize: '0.725rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                New on-hand balance will be: <strong style={{ color: 'var(--text-primary)' }}>{projectedOnHand} {item.unit}</strong> (+{parsedQty})
              </p>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                PO / Delivery Ref
              </label>
              <input
                type="text"
                placeholder="e.g. PO-8849 / DON-NMC"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
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

            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                Operator / Receiver
              </label>
              <input
                type="text"
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
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              Notes / Delivery Vehicle Details
            </label>
            <input
              type="text"
              placeholder="e.g. Received via Truck MH-31-AP-4001, seal intact"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
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
              <ArrowDownCircle size={15} />
              {isSubmitting ? 'Recording...' : 'Confirm Receipt'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
