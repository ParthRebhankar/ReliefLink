import React, { useState, useEffect } from 'react';
import { X, Package, MapPin, Tag, Hash, AlertTriangle, Layers, Save } from 'lucide-react';
import { createInventoryItem, updateInventoryItem } from '../api/client';

const CATEGORIES = [
  'Food',
  'Drinking Water',
  'Medical Supplies',
  'Rescue Equipment',
  'Shelter Supplies',
  'Other'
];

const COMMON_UNITS = [
  'packets',
  'litres',
  'bottles',
  'kits',
  'blankets',
  'pieces',
  'boxes',
  'cans',
  'sets'
];

export default function InventoryItemModal({
  isOpen,
  onClose,
  itemToEdit = null,
  onSuccess
}) {
  const isEdit = Boolean(itemToEdit);

  const [name, setName] = useState('');
  const [category, setCategory] = useState('Food');
  const [unit, setUnit] = useState('packets');
  const [storageLocation, setStorageLocation] = useState('Central Warehouse (Sitabuldi)');
  const [itemCode, setItemCode] = useState('');
  const [onHand, setOnHand] = useState('100');
  const [lowStockThreshold, setLowStockThreshold] = useState('20');
  const [notes, setNotes] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (itemToEdit) {
      setName(itemToEdit.name || '');
      setCategory(itemToEdit.category || 'Food');
      setUnit(itemToEdit.unit || 'packets');
      setStorageLocation(itemToEdit.storage_location || '');
      setItemCode(itemToEdit.item_code || '');
      setOnHand(String(itemToEdit.on_hand ?? '0'));
      setLowStockThreshold(String(itemToEdit.low_stock_threshold ?? '15'));
      setNotes(itemToEdit.notes || '');
    } else {
      setName('');
      setCategory('Food');
      setUnit('packets');
      setStorageLocation('Central Warehouse (Sitabuldi)');
      setItemCode('');
      setOnHand('100');
      setLowStockThreshold('20');
      setNotes('');
    }
    setError(null);
  }, [itemToEdit, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Item name is required');
      return;
    }
    if (!storageLocation.trim()) {
      setError('Storage location is required');
      return;
    }
    const parsedOnHand = parseFloat(onHand);
    if (!isEdit && (isNaN(parsedOnHand) || parsedOnHand < 0)) {
      setError('Initial on-hand stock must be a non-negative number');
      return;
    }
    const parsedThreshold = parseFloat(lowStockThreshold);
    if (isNaN(parsedThreshold) || parsedThreshold < 0) {
      setError('Low-stock threshold must be a non-negative number');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      if (isEdit) {
        const payload = {
          name: name.trim(),
          category,
          unit: unit.trim().toLowerCase(),
          storage_location: storageLocation.trim(),
          item_code: itemCode.trim() || undefined,
          low_stock_threshold: parsedThreshold,
          notes: notes.trim()
        };
        await updateInventoryItem(itemToEdit.id, payload);
      } else {
        const payload = {
          name: name.trim(),
          category,
          unit: unit.trim().toLowerCase(),
          storage_location: storageLocation.trim(),
          item_code: itemCode.trim() || undefined,
          on_hand: parsedOnHand,
          low_stock_threshold: parsedThreshold,
          notes: notes.trim()
        };
        await createInventoryItem(payload);
      }
      if (onSuccess) onSuccess();
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
        maxWidth: '560px',
        maxHeight: '90vh',
        overflowY: 'auto',
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
              <Package size={18} color="var(--text-primary)" />
            </div>
            <div>
              <h2 style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                {isEdit ? 'Edit Inventory Item' : 'Add Relief Inventory Item'}
              </h2>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {isEdit ? `Modifying: ${itemToEdit.name}` : 'Register new emergency relief supply in depot storage'}
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
              borderRadius: 'var(--radius-sm)'
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Form Body */}
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
              Item Name *
            </label>
            <input
              type="text"
              required
              placeholder="e.g. 1L Packaged Mineral Water"
              value={name}
              onChange={(e) => setName(e.target.value)}
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

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                Category *
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                style={{
                  width: '100%',
                  background: 'var(--bg-surface-elevated)',
                  border: '1px solid var(--border-medium)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '9px 12px',
                  color: 'var(--text-primary)',
                  fontSize: '0.85rem'
                }}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c} style={{ background: '#1c1c1c' }}>{c}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                Unit of Measurement *
              </label>
              <input
                type="text"
                required
                list="units-list"
                placeholder="e.g. litres, packets, kits"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
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
              <datalist id="units-list">
                {COMMON_UNITS.map((u) => <option key={u} value={u} />)}
              </datalist>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 'var(--space-md)' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                Storage Location / Relief Center *
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Central Warehouse, Zone 4 Depot"
                value={storageLocation}
                onChange={(e) => setStorageLocation(e.target.value)}
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
                Item Code (SKU)
              </label>
              <input
                type="text"
                placeholder="e.g. WTR-1L-01"
                value={itemCode}
                onChange={(e) => setItemCode(e.target.value.toUpperCase())}
                style={{
                  width: '100%',
                  background: 'var(--bg-surface-elevated)',
                  border: '1px solid var(--border-medium)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '9px 12px',
                  color: 'var(--text-primary)',
                  fontSize: '0.85rem',
                  fontFamily: 'var(--font-mono)'
                }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: isEdit ? '1fr' : '1fr 1fr', gap: 'var(--space-md)' }}>
            {!isEdit && (
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                  Initial Physical On-Hand *
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  required
                  value={onHand}
                  onChange={(e) => setOnHand(e.target.value)}
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
            )}

            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                Low-Stock Threshold *
              </label>
              <input
                type="number"
                min="0"
                step="any"
                required
                value={lowStockThreshold}
                onChange={(e) => setLowStockThreshold(e.target.value)}
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
              Notes / Specifications
            </label>
            <textarea
              rows={2}
              placeholder="e.g. Standard 24-pack cartons, shelf life 2 years..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
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
          </div>

          {/* Actions */}
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
                cursor: isSubmitting ? 'not-allowed' : 'pointer',
                opacity: isSubmitting ? 0.7 : 1
              }}
            >
              <Save size={15} />
              {isSubmitting ? 'Saving...' : (isEdit ? 'Update Item' : 'Add to Inventory')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
