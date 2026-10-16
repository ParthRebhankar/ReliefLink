import React, { useState, useEffect, useCallback } from 'react';
import {
  Package,
  Boxes,
  Lock,
  CheckCircle,
  Truck,
  AlertTriangle,
  LifeBuoy,
  Plus,
  RefreshCw,
  Search,
  History,
  ArrowDownCircle,
  Scale,
  Edit2,
  Database,
  MapPin,
  ChevronRight
} from 'lucide-react';
import { fetchInventory, seedInventoryDemo } from '../api/client';
import InventoryItemModal from './InventoryItemModal';
import ReceiveStockModal from './ReceiveStockModal';
import StockAdjustmentModal from './StockAdjustmentModal';
import StockMovementsModal from './StockMovementsModal';

const CATEGORIES = [
  'ALL',
  'Food',
  'Drinking Water',
  'Medical Supplies',
  'Rescue Equipment',
  'Shelter Supplies',
  'Other'
];

const STATUSES = ['ALL', 'Available', 'Low Stock', 'Out of Stock'];

export default function ReliefInventoryView({ onNavigateToRequests }) {
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState(null);
  const [locations, setLocations] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [selectedStatus, setSelectedStatus] = useState('ALL');
  const [selectedLocation, setSelectedLocation] = useState('ALL');

  // Modals state
  const [showItemModal, setShowItemModal] = useState(false);
  const [itemToEdit, setItemToEdit] = useState(null);

  const [showReceiveModal, setShowReceiveModal] = useState(false);
  const [itemToReceive, setItemToReceive] = useState(null);

  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [itemToAdjust, setItemToAdjust] = useState(null);

  const [showMovementsModal, setShowMovementsModal] = useState(false);
  const [itemForMovements, setItemForMovements] = useState(null);

  // Seeding state
  const [isSeeding, setIsSeeding] = useState(false);
  const [seedNotice, setSeedNotice] = useState(null);

  const loadData = useCallback(async (isSilent = false) => {
    if (!isSilent) setIsLoading(true);
    else setIsRefreshing(true);
    setError(null);
    try {
      const res = await fetchInventory({
        category: selectedCategory,
        status: selectedStatus,
        location: selectedLocation,
        search: searchQuery
      });
      setItems(res.items || []);
      setSummary(res.summary || null);
      setLocations(res.locations || []);
    } catch (err) {
      setError(err.message || 'Failed to load relief inventory');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [selectedCategory, selectedStatus, selectedLocation, searchQuery]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSeed = async () => {
    if (!window.confirm('Seed demonstration relief inventory and active allocations? (Existing items will not be overwritten)')) {
      return;
    }
    setIsSeeding(true);
    try {
      const res = await seedInventoryDemo();
      setSeedNotice(res.message);
      await loadData(true);
      setTimeout(() => setSeedNotice(null), 5000);
    } catch (err) {
      alert(`Seeding failed: ${err.message}`);
    } finally {
      setIsSeeding(false);
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'Available':
        return {
          label: 'Available',
          bg: 'rgba(255, 255, 255, 0.08)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border-medium)'
        };
      case 'Low Stock':
        return {
          label: 'Low Stock',
          bg: 'rgba(255, 255, 255, 0.16)',
          color: 'var(--text-primary)',
          border: '1px solid rgba(255, 255, 255, 0.4)'
        };
      case 'Out of Stock':
        return {
          label: 'Out of Stock',
          bg: 'var(--alarm-bg)',
          color: 'var(--alarm)',
          border: '1px solid var(--alarm-border)'
        };
      default:
        return {
          label: status,
          bg: 'transparent',
          color: 'var(--text-secondary)',
          border: '1px solid var(--border-subtle)'
        };
    }
  };

  return (
    <div className="relief-inventory-view" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xl)' }}>
      {/* Top Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 'var(--space-md)'
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span style={{
              fontSize: '0.675rem',
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)'
            }}>
              Logistics & Supply Management
            </span>
            <span style={{ color: 'var(--border-strong)' }}>•</span>
            <span style={{ fontSize: '0.675rem', color: 'var(--text-muted)' }}>Phase 2 Live Ledger</span>
          </div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
            Relief Inventory & Stock Accounting
          </h1>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
            Persistent warehouse physical inventory, atomic reservations, field dispatches, and SOS request allocations.
          </p>
        </div>

        {/* Header Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <button
            onClick={() => loadData(true)}
            disabled={isRefreshing}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 14px',
              background: 'var(--bg-surface-elevated)',
              border: '1px solid var(--border-medium)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--text-secondary)',
              fontSize: '0.8125rem',
              cursor: 'pointer'
            }}
          >
            <RefreshCw size={14} className={isRefreshing ? 'spin' : ''} />
            Refresh
          </button>

          <button
            onClick={handleSeed}
            disabled={isSeeding}
            title="Seed demonstration inventory items into SQLite database"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 14px',
              background: 'var(--bg-surface-elevated)',
              border: '1px solid var(--border-medium)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--text-secondary)',
              fontSize: '0.8125rem',
              cursor: 'pointer'
            }}
          >
            <Database size={14} />
            {isSeeding ? 'Seeding...' : 'Seed Demo Stock'}
          </button>

          <button
            onClick={() => {
              setItemToEdit(null);
              setShowItemModal(true);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 16px',
              background: 'var(--text-primary)',
              color: 'var(--bg-primary)',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              fontSize: '0.8125rem',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            <Plus size={15} />
            Add Item
          </button>
        </div>
      </div>

      {seedNotice && (
        <div style={{
          padding: '10px 16px',
          background: 'var(--bg-surface-elevated)',
          border: '1px solid var(--border-strong)',
          borderRadius: 'var(--radius-md)',
          fontSize: '0.8125rem',
          color: 'var(--text-primary)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <CheckCircle size={16} />
          <span>{seedNotice}</span>
        </div>
      )}

      {/* Summary Metrics Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 'var(--space-md)'
      }}>
        {/* On Hand */}
        <div style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-lg)',
          padding: '18px 20px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Physical On Hand
            </span>
            <Boxes size={16} />
          </div>
          <div style={{ marginTop: '12px' }}>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
              {summary ? Math.round(summary.total_on_hand).toLocaleString() : '—'}
            </div>
            <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)', marginTop: '2px' }}>
              Across {summary ? summary.total_items_count : 0} registered supply items
            </div>
          </div>
        </div>

        {/* Reserved */}
        <div style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-lg)',
          padding: '18px 20px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Active Reserved
            </span>
            <Lock size={16} />
          </div>
          <div style={{ marginTop: '12px' }}>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
              {summary ? Math.round(summary.total_reserved).toLocaleString() : '—'}
            </div>
            <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)', marginTop: '2px' }}>
              Committed to active allocations
            </div>
          </div>
        </div>

        {/* Available */}
        <div style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-lg)',
          padding: '18px 20px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Available Stock
            </span>
            <CheckCircle size={16} />
          </div>
          <div style={{ marginTop: '12px' }}>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
              {summary ? Math.round(summary.total_available).toLocaleString() : '—'}
            </div>
            <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)', marginTop: '2px' }}>
              Formula: On Hand − Reserved
            </div>
          </div>
        </div>

        {/* Dispatched */}
        <div style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-lg)',
          padding: '18px 20px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Dispatched Out
            </span>
            <Truck size={16} />
          </div>
          <div style={{ marginTop: '12px' }}>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
              {summary ? Math.round(summary.total_dispatched).toLocaleString() : '—'}
            </div>
            <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)', marginTop: '2px' }}>
              Supplies sent to field zones
            </div>
          </div>
        </div>

        {/* Low Stock Items */}
        <div style={{
          background: summary && summary.low_stock_count > 0 ? 'rgba(255, 69, 58, 0.06)' : 'var(--bg-surface)',
          border: summary && summary.low_stock_count > 0 ? '1px solid rgba(255, 69, 58, 0.3)' : '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-lg)',
          padding: '18px 20px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: summary && summary.low_stock_count > 0 ? 'var(--alarm)' : 'var(--text-muted)' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Low Stock Alerts
            </span>
            <AlertTriangle size={16} />
          </div>
          <div style={{ marginTop: '12px' }}>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: summary && summary.low_stock_count > 0 ? 'var(--alarm)' : 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
              {summary ? summary.low_stock_count + summary.out_of_stock_count : 0}
            </div>
            <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)', marginTop: '2px' }}>
              {summary ? `${summary.out_of_stock_count} out of stock` : 'Depleted or under safety threshold'}
            </div>
          </div>
        </div>

        {/* Pending Request Allocations */}
        <div
          onClick={onNavigateToRequests}
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-lg)',
            padding: '18px 20px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            cursor: onNavigateToRequests ? 'pointer' : 'default',
            transition: 'border-color 0.2s'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Pending Allocations
            </span>
            <LifeBuoy size={16} />
          </div>
          <div style={{ marginTop: '12px' }}>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
              {summary ? summary.pending_allocation_requests : 0}
            </div>
            <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
              <span>Verified requests needing supplies</span>
              {onNavigateToRequests && <ChevronRight size={12} />}
            </div>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-lg)',
        padding: '14px 18px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 'var(--space-md)'
      }}>
        {/* Search */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          background: 'var(--bg-surface-elevated)',
          border: '1px solid var(--border-medium)',
          borderRadius: 'var(--radius-md)',
          padding: '6px 12px',
          flex: '1 1 240px',
          maxWidth: '380px'
        }}>
          <Search size={15} color="var(--text-muted)" />
          <input
            type="text"
            placeholder="Search items, SKU, or depot..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--text-primary)',
              fontSize: '0.8125rem',
              width: '100%'
            }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}
            >
              ×
            </button>
          )}
        </div>

        {/* Dropdowns */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          {/* Category */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Category:</span>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              style={{
                background: 'var(--bg-surface-elevated)',
                border: '1px solid var(--border-medium)',
                borderRadius: 'var(--radius-sm)',
                padding: '6px 10px',
                color: 'var(--text-primary)',
                fontSize: '0.8125rem',
                cursor: 'pointer'
              }}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c} style={{ background: '#1c1c1c' }}>
                  {c === 'ALL' ? 'All Categories' : c}
                </option>
              ))}
            </select>
          </div>

          {/* Status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Status:</span>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              style={{
                background: 'var(--bg-surface-elevated)',
                border: '1px solid var(--border-medium)',
                borderRadius: 'var(--radius-sm)',
                padding: '6px 10px',
                color: 'var(--text-primary)',
                fontSize: '0.8125rem',
                cursor: 'pointer'
              }}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s} style={{ background: '#1c1c1c' }}>
                  {s === 'ALL' ? 'All Statuses' : s}
                </option>
              ))}
            </select>
          </div>

          {/* Location */}
          {locations.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Depot:</span>
              <select
                value={selectedLocation}
                onChange={(e) => setSelectedLocation(e.target.value)}
                style={{
                  background: 'var(--bg-surface-elevated)',
                  border: '1px solid var(--border-medium)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '6px 10px',
                  color: 'var(--text-primary)',
                  fontSize: '0.8125rem',
                  cursor: 'pointer'
                }}
              >
                <option value="ALL" style={{ background: '#1c1c1c' }}>All Locations</option>
                {locations.map((loc) => (
                  <option key={loc} value={loc} style={{ background: '#1c1c1c' }}>{loc}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Inventory Table Container */}
      <div style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden'
      }}>
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Package size={16} color="var(--text-muted)" />
            <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              Depot Stock Ledger ({items.length})
            </span>
          </div>
          <span style={{ fontSize: '0.725rem', color: 'var(--text-muted)' }}>
            Showing items matching active filters
          </span>
        </div>

        {isLoading ? (
          <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Loading live inventory records...
          </div>
        ) : error ? (
          <div style={{ padding: '24px', margin: '20px', background: 'var(--alarm-bg)', color: 'var(--alarm)', borderRadius: 'var(--radius-md)', fontSize: '0.85rem' }}>
            {error}
          </div>
        ) : items.length === 0 ? (
          <div style={{ padding: '60px 0', textAlign: 'center' }}>
            <Boxes size={36} color="var(--text-muted)" style={{ margin: '0 auto 12px', opacity: 0.5 }} />
            <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
              No inventory items found
            </h3>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', maxWidth: '380px', margin: '0 auto 16px' }}>
              No supplies match the current search or filters. You can add a new item or seed demonstration stock.
            </p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '10px' }}>
              <button
                onClick={() => {
                  setItemToEdit(null);
                  setShowItemModal(true);
                }}
                style={{
                  padding: '8px 16px',
                  background: 'var(--text-primary)',
                  color: 'var(--bg-primary)',
                  border: 'none',
                  borderRadius: 'var(--radius-md)',
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Add First Item
              </button>
              <button
                onClick={handleSeed}
                style={{
                  padding: '8px 16px',
                  background: 'var(--bg-surface-elevated)',
                  border: '1px solid var(--border-medium)',
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--text-secondary)',
                  fontSize: '0.8125rem',
                  cursor: 'pointer'
                }}
              >
                Seed Demo Inventory
              </button>
            </div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.8125rem' }}>
              <thead>
                <tr style={{ background: 'var(--bg-surface-elevated)', borderBottom: '1px solid var(--border-medium)', color: 'var(--text-secondary)' }}>
                  <th style={{ padding: '12px 18px', fontWeight: 600 }}>Item & SKU</th>
                  <th style={{ padding: '12px 14px', fontWeight: 600 }}>Category</th>
                  <th style={{ padding: '12px 14px', fontWeight: 600 }}>Location</th>
                  <th style={{ padding: '12px 14px', fontWeight: 600, textAlign: 'right' }}>On Hand</th>
                  <th style={{ padding: '12px 14px', fontWeight: 600, textAlign: 'right' }}>Reserved</th>
                  <th style={{ padding: '12px 14px', fontWeight: 600, textAlign: 'right' }}>Available</th>
                  <th style={{ padding: '12px 14px', fontWeight: 600, textAlign: 'right' }}>Threshold</th>
                  <th style={{ padding: '12px 14px', fontWeight: 600, textAlign: 'center' }}>Status</th>
                  <th style={{ padding: '12px 18px', fontWeight: 600, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => {
                  const statusStyle = getStatusBadge(item.stock_status);
                  const isLow = item.stock_status !== 'Available';
                  const formattedDate = new Date(item.updated_at).toLocaleTimeString('en-IN', {
                    hour: '2-digit',
                    minute: '2-digit'
                  });

                  return (
                    <tr
                      key={item.id}
                      style={{
                        borderBottom: '1px solid var(--border-subtle)',
                        background: idx % 2 === 0 ? 'transparent' : 'rgba(255, 255, 255, 0.01)',
                        transition: 'background 0.15s'
                      }}
                    >
                      {/* Name & SKU */}
                      <td style={{ padding: '14px 18px' }}>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '2px' }}>
                          {item.name}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          <span style={{ fontFamily: 'var(--font-mono)' }}>{item.item_code}</span>
                          <span>•</span>
                          <span>Unit: {item.unit}</span>
                        </div>
                      </td>

                      {/* Category */}
                      <td style={{ padding: '14px 14px' }}>
                        <span style={{
                          padding: '3px 8px',
                          borderRadius: 'var(--radius-full)',
                          background: 'var(--bg-surface-elevated)',
                          border: '1px solid var(--border-subtle)',
                          fontSize: '0.725rem',
                          color: 'var(--text-secondary)'
                        }}>
                          {item.category}
                        </span>
                      </td>

                      {/* Location */}
                      <td style={{ padding: '14px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: 'var(--text-secondary)', fontSize: '0.775rem' }}>
                          <MapPin size={12} color="var(--text-muted)" />
                          <span>{item.storage_location}</span>
                        </div>
                        <div style={{ fontSize: '0.675rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                          Updated {formattedDate}
                        </div>
                      </td>

                      {/* Physical On Hand */}
                      <td style={{ padding: '14px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {item.on_hand} <span style={{ fontSize: '0.7rem', fontWeight: 400, color: 'var(--text-muted)' }}>{item.unit}</span>
                      </td>

                      {/* Reserved */}
                      <td style={{ padding: '14px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, color: item.reserved > 0 ? 'var(--status-warning)' : 'var(--text-muted)' }}>
                        {item.reserved} <span style={{ fontSize: '0.7rem', fontWeight: 400, color: 'var(--text-muted)' }}>{item.unit}</span>
                      </td>

                      {/* Available */}
                      <td style={{ padding: '14px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: item.available <= 0 ? 'var(--alarm)' : 'var(--text-primary)' }}>
                        {item.available} <span style={{ fontSize: '0.7rem', fontWeight: 400, color: 'var(--text-muted)' }}>{item.unit}</span>
                      </td>

                      {/* Low Stock Threshold */}
                      <td style={{ padding: '14px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                        {item.low_stock_threshold}
                      </td>

                      {/* Status */}
                      <td style={{ padding: '14px 14px', textAlign: 'center' }}>
                        <span style={{
                          padding: '3px 9px',
                          borderRadius: 'var(--radius-full)',
                          background: statusStyle.bg,
                          color: statusStyle.color,
                          border: statusStyle.border,
                          fontSize: '0.7rem',
                          fontWeight: 600,
                          letterSpacing: '0.03em',
                          display: 'inline-block'
                        }}>
                          {statusStyle.label}
                        </span>
                      </td>

                      {/* Actions */}
                      <td style={{ padding: '14px 18px', textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                          <button
                            onClick={() => {
                              setItemToReceive(item);
                              setShowReceiveModal(true);
                            }}
                            title="Receive Incoming Stock"
                            style={{
                              padding: '5px 8px',
                              background: 'var(--bg-surface-elevated)',
                              border: '1px solid var(--border-medium)',
                              borderRadius: 'var(--radius-sm)',
                              color: 'var(--text-primary)',
                              fontSize: '0.725rem',
                              fontWeight: 500,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px'
                            }}
                          >
                            <ArrowDownCircle size={13} />
                            Receive
                          </button>

                          <button
                            onClick={() => {
                              setItemToAdjust(item);
                              setShowAdjustModal(true);
                            }}
                            title="Audit Physical Stock Correction"
                            style={{
                              padding: '5px 8px',
                              background: 'var(--bg-surface-elevated)',
                              border: '1px solid var(--border-medium)',
                              borderRadius: 'var(--radius-sm)',
                              color: 'var(--text-secondary)',
                              fontSize: '0.725rem',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px'
                            }}
                          >
                            <Scale size={13} />
                            Correct
                          </button>

                          <button
                            onClick={() => {
                              setItemForMovements(item);
                              setShowMovementsModal(true);
                            }}
                            title="View Stock Movement Audit Trail"
                            style={{
                              padding: '5px 8px',
                              background: 'var(--bg-surface-elevated)',
                              border: '1px solid var(--border-medium)',
                              borderRadius: 'var(--radius-sm)',
                              color: 'var(--text-secondary)',
                              fontSize: '0.725rem',
                              cursor: 'pointer'
                            }}
                          >
                            <History size={13} />
                          </button>

                          <button
                            onClick={() => {
                              setItemToEdit(item);
                              setShowItemModal(true);
                            }}
                            title="Edit Item Details"
                            style={{
                              padding: '5px 8px',
                              background: 'var(--bg-surface-elevated)',
                              border: '1px solid var(--border-medium)',
                              borderRadius: 'var(--radius-sm)',
                              color: 'var(--text-secondary)',
                              fontSize: '0.725rem',
                              cursor: 'pointer'
                            }}
                          >
                            <Edit2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modals */}
      <InventoryItemModal
        isOpen={showItemModal}
        onClose={() => setShowItemModal(false)}
        itemToEdit={itemToEdit}
        onSuccess={() => loadData(true)}
      />

      <ReceiveStockModal
        isOpen={showReceiveModal}
        onClose={() => setShowReceiveModal(false)}
        item={itemToReceive}
        onSuccess={() => loadData(true)}
      />

      <StockAdjustmentModal
        isOpen={showAdjustModal}
        onClose={() => setShowAdjustModal(false)}
        item={itemToAdjust}
        onSuccess={() => loadData(true)}
      />

      <StockMovementsModal
        isOpen={showMovementsModal}
        onClose={() => setShowMovementsModal(false)}
        item={itemForMovements}
      />
    </div>
  );
}
