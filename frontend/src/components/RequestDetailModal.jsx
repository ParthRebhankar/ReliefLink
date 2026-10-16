import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  ShieldCheck,
  Clock,
  MapPin,
  Activity,
  CheckCircle2,
  XCircle,
  Truck,
  RotateCw,
  AlertTriangle,
  Radio,
  Globe,
  Copy,
  Check,
  Package,
  Users,
  User,
  Plus
} from 'lucide-react';
import {
  fetchEmergencyRequestById,
  updateEmergencyRequest,
  fetchInventory,
  createAllocation,
  dispatchAllocation,
  deliverAllocation,
  cancelAllocation
} from '../api/client';
import AssignTaskModal from './AssignTaskModal';
import TaskActionModal from './TaskActionModal';

export default function RequestDetailModal({
  isOpen,
  onClose,
  requestId,
  onUpdated
}) {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // Status mutation state
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateError, setUpdateError] = useState(null);
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [coordinatorNote, setCoordinatorNote] = useState('');
  const [operatorName, setOperatorName] = useState('Relief Coordinator');
  const [copiedId, setCopiedId] = useState(false);

  // Phase 2: Relief Allocation State
  const [showAllocateForm, setShowAllocateForm] = useState(false);
  const [inventoryList, setInventoryList] = useState([]);
  const [loadingInventory, setLoadingInventory] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState('');
  const [allocateQty, setAllocateQty] = useState('');
  const [allocateNotes, setAllocateNotes] = useState('');
  const [isAllocating, setIsAllocating] = useState(false);
  const [allocateError, setAllocateError] = useState(null);

  // Allocation Action State (Dispatch, Deliver, Cancel)
  const [actionAlloc, setActionAlloc] = useState(null);
  const [actionType, setActionType] = useState(null); // 'dispatch' | 'deliver' | 'cancel'
  const [actionQty, setActionQty] = useState('');
  const [actionReason, setActionReason] = useState('');
  const [isActionSubmitting, setIsActionSubmitting] = useState(false);
  const [actionError, setActionError] = useState(null);

  // Phase 3: Task Assignment Modal states
  const [showAssignTaskModal, setShowAssignTaskModal] = useState(false);
  const [taskActionModalData, setTaskActionModalData] = useState({
    isOpen: false,
    assignment: null,
    actionType: ''
  });
  const [expandedTaskEvents, setExpandedTaskEvents] = useState({});

  const loadDetail = useCallback(async () => {
    if (!requestId) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetchEmergencyRequestById(requestId);
      setData(res);
      setCoordinatorNote(res.request?.coordinator_notes || '');
    } catch (err) {
      setError(err.message || 'Failed to load request details');
    } finally {
      setIsLoading(false);
    }
  }, [requestId]);

  useEffect(() => {
    if (isOpen && requestId) {
      loadDetail();
      setShowRejectInput(false);
      setRejectionReason('');
      setUpdateError(null);
    }
  }, [isOpen, requestId, loadDetail]);

  const handleUpdate = async (updates) => {
    setIsUpdating(true);
    setUpdateError(null);
    try {
      const payload = {
        ...updates,
        changed_by: operatorName.trim() || 'Coordinator'
      };
      const res = await updateEmergencyRequest(requestId, payload);
      setData(res);
      setShowRejectInput(false);
      setRejectionReason('');
      if (onUpdated) onUpdated(res);
    } catch (err) {
      setUpdateError(err.message || 'Failed to update request');
    } finally {
      setIsUpdating(false);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard?.writeText(text);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  const handleOpenAllocate = async () => {
    setShowAllocateForm(true);
    setLoadingInventory(true);
    setAllocateError(null);
    try {
      const invData = await fetchInventory();
      const items = invData.items || [];
      setInventoryList(items);

      // Pre-select matching category item if available
      const reqCat = data?.request?.category;
      const matching = items.find(i => i.category === reqCat && i.available > 0) || items.find(i => i.available > 0) || items[0];
      if (matching) {
        setSelectedItemId(String(matching.id));
      }
      // Suggest unmet quantity
      const requestedQty = parseFloat(data?.request?.quantity_requested) || 1;
      const currentAllocated = (data?.allocations || [])
        .filter(a => a.status !== 'Cancelled')
        .reduce((sum, a) => sum + (parseFloat(a.quantity_reserved) || 0), 0);
      const remainingNeeded = Math.max(1, requestedQty - currentAllocated);
      setAllocateQty(String(remainingNeeded));
    } catch (err) {
      setAllocateError('Failed to fetch inventory items: ' + err.message);
    } finally {
      setLoadingInventory(false);
    }
  };

  const handleCreateAllocation = async (e) => {
    e.preventDefault();
    const qty = parseFloat(allocateQty);
    if (isNaN(qty) || qty <= 0) {
      setAllocateError('Allocation quantity must be greater than 0');
      return;
    }
    const selectedItem = inventoryList.find(i => String(i.id) === String(selectedItemId));
    if (!selectedItem) {
      setAllocateError('Please select a valid inventory item');
      return;
    }
    if (qty > selectedItem.available) {
      setAllocateError(`Insufficient available stock. Max available on shelf: ${selectedItem.available} ${selectedItem.unit}`);
      return;
    }

    if (!window.confirm(`Confirm reserving ${qty} ${selectedItem.unit} of "${selectedItem.name}" from ${selectedItem.storage_location}?`)) {
      return;
    }

    setIsAllocating(true);
    setAllocateError(null);
    try {
      await createAllocation({
        request_id: requestId,
        inventory_item_id: parseInt(selectedItemId, 10),
        quantity: qty,
        allocated_by: operatorName.trim() || 'Coordinator',
        notes: allocateNotes.trim() || undefined
      });
      setShowAllocateForm(false);
      setAllocateNotes('');
      await loadDetail();
      if (onUpdated) onUpdated();
    } catch (err) {
      setAllocateError(err.message || 'Failed to create stock allocation');
    } finally {
      setIsAllocating(false);
    }
  };

  const handleOpenAction = (alloc, type) => {
    setActionAlloc(alloc);
    setActionType(type);
    setActionError(null);
    if (type === 'dispatch') {
      const rem = parseFloat(alloc.quantity_reserved) - parseFloat(alloc.quantity_dispatched);
      setActionQty(String(rem));
      setActionReason('');
    } else if (type === 'deliver') {
      const rem = parseFloat(alloc.quantity_dispatched) - parseFloat(alloc.quantity_delivered);
      setActionQty(String(rem));
      setActionReason('');
    } else if (type === 'cancel') {
      setActionQty(String(parseFloat(alloc.quantity_reserved) - parseFloat(alloc.quantity_dispatched)));
      setActionReason('');
    }
  };

  const handleExecuteAction = async (e) => {
    e.preventDefault();
    if (!actionAlloc || !actionType) return;

    if (actionType === 'cancel' && (!actionReason.trim() || actionReason.trim().length < 3)) {
      setActionError('A mandatory cancellation reason (at least 3 characters) is required');
      return;
    }

    const qty = parseFloat(actionQty);
    if (actionType !== 'cancel' && (isNaN(qty) || qty <= 0)) {
      setActionError('Quantity must be strictly positive');
      return;
    }

    setIsActionSubmitting(true);
    setActionError(null);
    try {
      if (actionType === 'dispatch') {
        await dispatchAllocation(actionAlloc.allocation_id, {
          quantity: qty,
          operator: operatorName.trim() || 'Coordinator',
          reason: actionReason.trim() || `Supplies dispatched for request ${requestId}`
        });
      } else if (actionType === 'deliver') {
        await deliverAllocation(actionAlloc.allocation_id, {
          quantity: qty,
          operator: operatorName.trim() || 'Coordinator',
          reason: actionReason.trim() || `Supplies confirmed delivered to citizen`
        });
      } else if (actionType === 'cancel') {
        await cancelAllocation(actionAlloc.allocation_id, {
          reason: actionReason.trim(),
          operator: operatorName.trim() || 'Coordinator'
        });
      }
      setActionAlloc(null);
      setActionType(null);
      await loadDetail();
      if (onUpdated) onUpdated();
    } catch (err) {
      setActionError(err.message || 'Operation failed');
    } finally {
      setIsActionSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const req = data?.request;
  const history = data?.history || [];
  const zoneCtx = data?.zone_context;

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(5, 5, 5, 0.75)',
      backdropFilter: 'blur(10px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 110,
      padding: '20px'
    }}>
      <div className="glass-card" style={{
        maxWidth: '760px',
        width: '100%',
        maxHeight: '94vh',
        overflowY: 'auto',
        padding: '24px',
        border: '1px solid var(--border-medium)',
        background: 'var(--bg-surface)',
        borderRadius: 'var(--radius-lg)'
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '18px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '1rem',
                fontWeight: 700,
                color: 'var(--text-primary)'
              }}>
                {req?.request_id || requestId}
              </span>

              <button
                onClick={() => copyToClipboard(req?.request_id || requestId)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}
                title="Copy request ID"
              >
                {copiedId ? <Check size={14} color="var(--status-safe-strong)" /> : <Copy size={14} />}
              </button>

              {/* Source Badge */}
              <span style={{
                fontSize: '0.6875rem',
                padding: '2px 8px',
                borderRadius: '999px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                background: req?.source === 'simulated_sos' ? 'var(--alarm-bg)' : 'var(--bg-surface-elevated)',
                color: req?.source === 'simulated_sos' ? 'var(--alarm)' : 'var(--text-secondary)',
                border: `1px solid ${req?.source === 'simulated_sos' ? 'var(--alarm-border)' : 'var(--border-subtle)'}`
              }}>
                {req?.source === 'simulated_sos' ? <Radio size={11} /> : <Globe size={11} />}
                {req?.source === 'simulated_sos' ? 'Simulated SOS' : 'Web Form'}
              </span>

              {/* Priority Badge */}
              {req?.priority_score && (
                <span style={{
                  fontSize: '0.6875rem',
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: '999px',
                  background: req.priority_score >= 80 ? 'var(--alarm-bg)' : 'var(--bg-surface-elevated)',
                  color: req.priority_score >= 80 ? 'var(--alarm)' : 'var(--text-primary)',
                  border: '1px solid var(--border-medium)'
                }}>
                  Priority {req.priority_score}/100
                </span>
              )}
            </div>

            <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
              {req?.household_label || 'Loading...'} &bull; Zone <strong>{req?.zone_id}</strong>
            </p>
          </div>

          <button onClick={onClose} className="btn-icon" style={{ width: '32px', height: '32px' }} aria-label="Close modal">
            <X size={16} />
          </button>
        </div>

        {isLoading ? (
          <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-muted)' }}>
            <RotateCw size={24} className="spin" style={{ margin: '0 auto 12px' }} />
            <p style={{ fontSize: '0.8125rem' }}>Loading emergency request record and audit history...</p>
          </div>
        ) : error ? (
          <div style={{
            padding: '16px',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--alarm-bg)',
            border: '1px solid var(--alarm-border)',
            color: 'var(--alarm)',
            fontSize: '0.8125rem',
            display: 'flex',
            alignItems: 'center',
            gap: '10px'
          }}>
            <AlertTriangle size={18} />
            <div>
              <strong>Error:</strong> {error}
              <div style={{ marginTop: '8px' }}>
                <button onClick={loadDetail} className="btn-secondary" style={{ fontSize: '0.75rem', padding: '4px 10px' }}>
                  Retry
                </button>
              </div>
            </div>
          </div>
        ) : req ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            {/* Duplicate Flag Alert */}
            {req.is_possible_duplicate === 1 && (
              <div style={{
                padding: '12px 16px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--status-warning-bg)',
                border: '1px solid var(--status-warning-border)',
                color: 'var(--status-warning)',
                fontSize: '0.8125rem',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '10px'
              }}>
                <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <strong>Potential Duplicate Flagged:</strong> {req.duplicate_notes || 'An active request for this household or category exists.'}
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                    Carefully review details below before verifying or dispatching relief teams.
                  </div>
                </div>
              </div>
            )}

            {/* Status & Verification Summary Strip */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
              gap: '12px',
              padding: '14px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--bg-surface-elevated)',
              border: '1px solid var(--border-subtle)'
            }}>
              <div>
                <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Verification State
                </div>
                <div style={{
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  marginTop: '4px',
                  color: req.verification_status === 'Verified' ? 'var(--status-safe-strong)' :
                         req.verification_status === 'Rejected' ? 'var(--alarm)' : 'var(--status-warning)'
                }}>
                  {req.verification_status}
                </div>
              </div>

              <div>
                <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Fulfilment Workflow
                </div>
                <div style={{
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  marginTop: '4px',
                  color: req.status === 'Fulfilled' ? 'var(--status-safe-strong)' :
                         req.status === 'In Progress' ? 'var(--accent)' :
                         req.status === 'Assigned' ? 'var(--text-primary)' :
                         req.status === 'Rejected' ? 'var(--alarm)' : 'var(--text-secondary)'
                }}>
                  {req.status}
                </div>
              </div>

              <div>
                <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Category & Quantity
                </div>
                <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', marginTop: '4px' }}>
                  {req.category} {req.quantity ? `(${req.quantity})` : ''}
                </div>
              </div>

              <div>
                <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Severity
                </div>
                <div style={{
                  fontSize: '0.875rem',
                  fontWeight: 700,
                  marginTop: '4px',
                  color: req.severity === 'CRITICAL' ? 'var(--alarm)' :
                         req.severity === 'HIGH' ? 'var(--status-warning-strong)' : 'var(--text-secondary)'
                }}>
                  {req.severity}
                </div>
              </div>
            </div>

            {/* Description & Coordinator Notes */}
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              padding: '14px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-primary)',
              border: '1px solid var(--border-subtle)'
            }}>
              <div>
                <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '4px' }}>
                  EMERGENCY DESCRIPTION
                </div>
                <p style={{ fontSize: '0.875rem', color: 'var(--text-primary)', lineHeight: 1.5 }}>
                  {req.description}
                </p>
              </div>

              {req.rejection_reason && (
                <div style={{
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--alarm-bg)',
                  border: '1px solid var(--alarm-border)',
                  fontSize: '0.75rem',
                  color: 'var(--alarm)'
                }}>
                  <strong>Reason for Rejection:</strong> {req.rejection_reason}
                </div>
              )}

              {req.coordinator_notes && (
                <div style={{
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  fontSize: '0.75rem',
                  color: 'var(--text-secondary)'
                }}>
                  <strong>Coordinator Notes:</strong> {req.coordinator_notes}
                </div>
              )}

              {(req.latitude || req.longitude) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  <MapPin size={13} />
                  <span>GPS Coordinates: {req.latitude}, {req.longitude}</span>
                </div>
              )}
            </div>

            {/* Live Zone Telemetry Sensor Context */}
            {zoneCtx && (
              <div style={{
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: '14px',
                background: 'var(--bg-surface-elevated)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '10px' }}>
                  <Activity size={15} color="var(--color-cyan)" />
                  FloodGuard Zone {zoneCtx.zone_id} Telemetry Reading Context
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px', fontSize: '0.75rem' }}>
                  <div>
                    <span style={{ color: 'var(--text-muted)', display: 'block' }}>Drain Water Level</span>
                    <strong style={{ fontSize: '0.9rem' }}>
                      {zoneCtx.water_level_cm !== null ? `${zoneCtx.water_level_cm} cm` : 'Pending sensor'}
                    </strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)', display: 'block' }}>Live Flood Risk</span>
                    <span style={{
                      fontWeight: 700,
                      fontSize: '0.9rem',
                      color: zoneCtx.risk_level === 'CRITICAL' || zoneCtx.risk_level === 'DANGER' ? 'var(--alarm)' : 'var(--text-primary)'
                    }}>
                      {zoneCtx.risk_level || 'SAFE'}
                    </span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)', display: 'block' }}>24h Rainfall</span>
                    <strong style={{ fontSize: '0.9rem' }}>
                      {zoneCtx.rainfall_24h_mm !== undefined ? `${zoneCtx.rainfall_24h_mm} mm` : 'N/A'}
                    </strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)', display: 'block' }}>Geo Risk Class</span>
                    <strong style={{ fontSize: '0.9rem' }}>
                      {zoneCtx.geo_risk_class || `Score ${zoneCtx.geo_risk_score}`}
                    </strong>
                  </div>
                </div>
              </div>
            )}

            {/* Phase 2: Relief Inventory Allocations Card */}
            {(() => {
              const allocations = data?.allocations || [];
              const activeAllocs = allocations.filter(a => a.status !== 'Cancelled');
              const totalAllocated = activeAllocs.reduce((s, a) => s + (parseFloat(a.quantity_reserved) || 0), 0);
              const totalDispatched = activeAllocs.reduce((s, a) => s + (parseFloat(a.quantity_dispatched) || 0), 0);
              const totalDelivered = activeAllocs.reduce((s, a) => s + (parseFloat(a.quantity_delivered) || 0), 0);
              const reqQty = parseFloat(req.quantity_requested) || 0;
              const unmet = Math.max(0, reqQty - totalAllocated);

              return (
                <div style={{
                  border: '1px solid var(--border-medium)',
                  borderRadius: 'var(--radius-md)',
                  padding: '16px',
                  background: 'var(--bg-surface)'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Package size={16} color="var(--text-primary)" />
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '0.02em', textTransform: 'uppercase' }}>
                        Relief Inventory Allocations ({allocations.length})
                      </span>
                    </div>

                    {req.verification_status !== 'Rejected' && !showAllocateForm && (
                      <button
                        type="button"
                        onClick={handleOpenAllocate}
                        disabled={isUpdating}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '5px 12px',
                          background: 'var(--text-primary)',
                          color: 'var(--bg-primary)',
                          border: 'none',
                          borderRadius: 'var(--radius-sm)',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          cursor: 'pointer'
                        }}
                      >
                        <Package size={13} />
                        Allocate Relief Supplies...
                      </button>
                    )}
                  </div>

                  {/* Allocation Metrics Strip */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
                    gap: '10px',
                    padding: '12px',
                    background: 'var(--bg-surface-elevated)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    marginBottom: '14px',
                    textAlign: 'center'
                  }}>
                    <div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Requested</div>
                      <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                        {reqQty} <span style={{ fontSize: '0.7rem', fontWeight: 400 }}>{req.category}</span>
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Reserved</div>
                      <div style={{ fontSize: '0.95rem', fontWeight: 700, color: totalAllocated > 0 ? 'var(--status-warning)' : 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                        {totalAllocated}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Dispatched</div>
                      <div style={{ fontSize: '0.95rem', fontWeight: 700, color: totalDispatched > 0 ? 'var(--alarm)' : 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                        {totalDispatched}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Delivered</div>
                      <div style={{ fontSize: '0.95rem', fontWeight: 700, color: totalDelivered > 0 ? 'var(--status-safe-strong)' : 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                        {totalDelivered}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Unmet Balance</div>
                      <div style={{ fontSize: '0.95rem', fontWeight: 700, color: unmet === 0 ? 'var(--status-safe-strong)' : 'var(--status-warning)', fontFamily: 'var(--font-mono)' }}>
                        {unmet}
                      </div>
                    </div>
                  </div>

                  {/* Allocate Supplies Inline Form */}
                  {showAllocateForm && (
                    <div style={{
                      background: 'var(--bg-surface-elevated)',
                      border: '1px solid var(--border-medium)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '14px',
                      marginBottom: '14px'
                    }}>
                      <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '10px' }}>
                        Reserve Supplies for Household Request
                      </div>

                      {allocateError && (
                        <div style={{
                          padding: '8px 12px',
                          background: 'var(--alarm-bg)',
                          border: '1px solid var(--alarm-border)',
                          borderRadius: 'var(--radius-sm)',
                          fontSize: '0.75rem',
                          color: 'var(--alarm)',
                          marginBottom: '10px'
                        }}>
                          {allocateError}
                        </div>
                      )}

                      {loadingInventory ? (
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', padding: '12px 0' }}>
                          Fetching compatible inventory stock...
                        </div>
                      ) : (
                        <form onSubmit={handleCreateAllocation} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 0.8fr', gap: '10px' }}>
                            <div>
                              <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                                Inventory Item & Storage Depot *
                              </label>
                              <select
                                required
                                value={selectedItemId}
                                onChange={(e) => setSelectedItemId(e.target.value)}
                                style={{
                                  width: '100%',
                                  padding: '7px 10px',
                                  borderRadius: 'var(--radius-sm)',
                                  background: 'var(--bg-primary)',
                                  border: '1px solid var(--border-medium)',
                                  color: 'var(--text-primary)',
                                  fontSize: '0.8rem'
                                }}
                              >
                                {inventoryList.map((item) => (
                                  <option key={item.id} value={item.id} style={{ background: '#1c1c1c' }}>
                                    {item.name} — Avail: {item.available} {item.unit} ({item.storage_location})
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div>
                              <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                                Quantity to Reserve *
                              </label>
                              <input
                                type="number"
                                min="0.01"
                                step="any"
                                required
                                placeholder="Qty"
                                value={allocateQty}
                                onChange={(e) => setAllocateQty(e.target.value)}
                                style={{
                                  width: '100%',
                                  padding: '7px 10px',
                                  borderRadius: 'var(--radius-sm)',
                                  background: 'var(--bg-primary)',
                                  border: '1px solid var(--border-medium)',
                                  color: 'var(--text-primary)',
                                  fontSize: '0.85rem',
                                  fontFamily: 'var(--font-mono)'
                                }}
                              />
                            </div>
                          </div>

                          <div>
                            <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                              Allocation Notes / Dispatch Instructions
                            </label>
                            <input
                              type="text"
                              placeholder="e.g. Batch reserved from Bay 3; prioritize elderly residents in house"
                              value={allocateNotes}
                              onChange={(e) => setAllocateNotes(e.target.value)}
                              style={{
                                width: '100%',
                                padding: '7px 10px',
                                borderRadius: 'var(--radius-sm)',
                                background: 'var(--bg-primary)',
                                border: '1px solid var(--border-medium)',
                                color: 'var(--text-primary)',
                                fontSize: '0.78rem'
                              }}
                            />
                          </div>

                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
                            <button
                              type="button"
                              onClick={() => setShowAllocateForm(false)}
                              disabled={isAllocating}
                              className="btn-secondary"
                              style={{ padding: '6px 12px', fontSize: '0.75rem' }}
                            >
                              Cancel
                            </button>
                            <button
                              type="submit"
                              disabled={isAllocating}
                              className="btn-primary"
                              style={{ padding: '6px 14px', fontSize: '0.75rem' }}
                            >
                              {isAllocating ? 'Reserving...' : 'Confirm Stock Reservation'}
                            </button>
                          </div>
                        </form>
                      )}
                    </div>
                  )}

                  {/* Action Sub-form (Dispatch / Deliver / Cancel) */}
                  {actionAlloc && actionType && (
                    <div style={{
                      background: 'var(--bg-surface-elevated)',
                      border: `1px solid ${actionType === 'cancel' ? 'var(--alarm-border)' : 'var(--border-strong)'}`,
                      borderRadius: 'var(--radius-sm)',
                      padding: '14px',
                      marginBottom: '14px'
                    }}>
                      <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}>
                        {actionType === 'dispatch' && `Dispatch Supplies for ${actionAlloc.item_name}`}
                        {actionType === 'deliver' && `Confirm Field Delivery for ${actionAlloc.item_name}`}
                        {actionType === 'cancel' && `Cancel Reservation: ${actionAlloc.item_name}`}
                      </div>

                      {actionError && (
                        <div style={{
                          padding: '8px 12px',
                          background: 'var(--alarm-bg)',
                          border: '1px solid var(--alarm-border)',
                          borderRadius: 'var(--radius-sm)',
                          fontSize: '0.75rem',
                          color: 'var(--alarm)',
                          marginBottom: '8px'
                        }}>
                          {actionError}
                        </div>
                      )}

                      <form onSubmit={handleExecuteAction} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {actionType !== 'cancel' && (
                          <div>
                            <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                              Quantity ({actionAlloc.item_unit || 'units'}) *
                            </label>
                            <input
                              type="number"
                              min="0.01"
                              step="any"
                              required
                              value={actionQty}
                              onChange={(e) => setActionQty(e.target.value)}
                              style={{
                                width: '100%',
                                padding: '6px 10px',
                                borderRadius: 'var(--radius-sm)',
                                background: 'var(--bg-primary)',
                                border: '1px solid var(--border-medium)',
                                color: 'var(--text-primary)',
                                fontSize: '0.85rem',
                                fontFamily: 'var(--font-mono)'
                              }}
                            />
                          </div>
                        )}

                        <div>
                          <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                            {actionType === 'cancel' ? 'Mandatory Cancellation Reason *' : 'Reason / Reference'}
                          </label>
                          <input
                            type="text"
                            required={actionType === 'cancel'}
                            placeholder={actionType === 'cancel' ? 'Reason for releasing reservation...' : 'Optional notes or vehicle info...'}
                            value={actionReason}
                            onChange={(e) => setActionReason(e.target.value)}
                            style={{
                              width: '100%',
                              padding: '6px 10px',
                              borderRadius: 'var(--radius-sm)',
                              background: 'var(--bg-primary)',
                              border: '1px solid var(--border-medium)',
                              color: 'var(--text-primary)',
                              fontSize: '0.78rem'
                            }}
                          />
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
                          <button
                            type="button"
                            onClick={() => {
                              setActionAlloc(null);
                              setActionType(null);
                            }}
                            disabled={isActionSubmitting}
                            className="btn-secondary"
                            style={{ padding: '6px 12px', fontSize: '0.75rem' }}
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={isActionSubmitting}
                            className="btn-primary"
                            style={{
                              padding: '6px 14px',
                              fontSize: '0.75rem',
                              background: actionType === 'cancel' ? 'var(--alarm)' : undefined,
                              borderColor: actionType === 'cancel' ? 'var(--alarm)' : undefined
                            }}
                          >
                            {isActionSubmitting ? 'Processing...' : (
                              actionType === 'dispatch' ? 'Confirm Dispatch' :
                              actionType === 'deliver' ? 'Confirm Delivery' : 'Release Reserved Stock'
                            )}
                          </button>
                        </div>
                      </form>
                    </div>
                  )}

                  {/* Allocations Table */}
                  {allocations.length === 0 ? (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center', padding: '16px 0' }}>
                      No relief inventory has been allocated to this request yet. Click "Allocate Relief Supplies" above to reserve stock.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {allocations.map((a) => {
                        const isReserved = a.status === 'Reserved';
                        const isDispatched = a.status === 'Dispatched';
                        const isDelivered = a.status === 'Delivered';
                        const isCancelled = a.status === 'Cancelled';

                        return (
                          <div
                            key={a.id || a.allocation_id}
                            style={{
                              background: 'var(--bg-surface-elevated)',
                              border: '1px solid var(--border-subtle)',
                              borderRadius: 'var(--radius-sm)',
                              padding: '10px 14px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: '12px',
                              flexWrap: 'wrap'
                            }}
                          >
                            <div style={{ flex: '1 1 200px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                                <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.8125rem' }}>
                                  {a.item_name}
                                </span>
                                <span style={{
                                  fontSize: '0.65rem',
                                  padding: '1px 6px',
                                  borderRadius: 'var(--radius-full)',
                                  background: isDelivered ? 'rgba(255, 255, 255, 0.15)' :
                                              isDispatched ? 'rgba(255, 69, 58, 0.15)' :
                                              isReserved ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.04)',
                                  color: isDispatched ? 'var(--alarm)' : isCancelled ? 'var(--text-muted)' : 'var(--text-primary)',
                                  fontWeight: 600
                                }}>
                                  {a.status}
                                </span>
                              </div>
                              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                {a.storage_location} • SKU: {a.item_code} • Ref: {a.allocation_id}
                              </div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', fontSize: '0.75rem', fontFamily: 'var(--font-mono)' }}>
                              <div>
                                <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem', display: 'block' }}>RESERVED</span>
                                <strong style={{ color: 'var(--text-primary)' }}>{a.quantity_reserved} {a.item_unit}</strong>
                              </div>
                              <div>
                                <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem', display: 'block' }}>DISPATCHED</span>
                                <strong style={{ color: a.quantity_dispatched > 0 ? 'var(--alarm)' : 'var(--text-muted)' }}>{a.quantity_dispatched}</strong>
                              </div>
                              <div>
                                <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem', display: 'block' }}>DELIVERED</span>
                                <strong style={{ color: a.quantity_delivered > 0 ? 'var(--status-safe-strong)' : 'var(--text-muted)' }}>{a.quantity_delivered}</strong>
                              </div>
                            </div>

                            {/* Action Buttons for Allocation */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              {isReserved && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => handleOpenAction(a, 'dispatch')}
                                    title="Dispatch physical stock from depot"
                                    style={{
                                      padding: '4px 8px',
                                      background: 'var(--bg-surface)',
                                      border: '1px solid var(--border-medium)',
                                      borderRadius: 'var(--radius-sm)',
                                      fontSize: '0.72rem',
                                      color: 'var(--text-primary)',
                                      cursor: 'pointer',
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '4px'
                                    }}
                                  >
                                    <Truck size={12} />
                                    Dispatch
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleOpenAction(a, 'cancel')}
                                    title="Cancel reservation and release stock"
                                    style={{
                                      padding: '4px 8px',
                                      background: 'transparent',
                                      border: '1px solid var(--border-subtle)',
                                      borderRadius: 'var(--radius-sm)',
                                      fontSize: '0.72rem',
                                      color: 'var(--text-muted)',
                                      cursor: 'pointer'
                                    }}
                                  >
                                    Cancel
                                  </button>
                                </>
                              )}

                              {isDispatched && (
                                <button
                                  type="button"
                                  onClick={() => handleOpenAction(a, 'deliver')}
                                  title="Confirm citizen delivery"
                                  style={{
                                    padding: '4px 8px',
                                    background: 'var(--text-primary)',
                                    color: 'var(--bg-primary)',
                                    border: 'none',
                                    borderRadius: 'var(--radius-sm)',
                                    fontSize: '0.72rem',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px'
                                  }}
                                >
                                  <CheckCircle2 size={12} />
                                  Confirm Delivery
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Phase 3: Response Teams & Task Assignments */}
            {(() => {
              const taskList = data?.assignments || [];
              return (
                <div style={{
                  border: '1px solid var(--border-medium)',
                  borderRadius: 'var(--radius-md)',
                  padding: '16px',
                  background: 'var(--bg-surface)'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Users size={16} color="var(--accent)" />
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '0.02em', textTransform: 'uppercase' }}>
                        Operational Response Teams & Task Assignments
                      </span>
                      <span style={{
                        fontSize: '0.6875rem',
                        fontWeight: 600,
                        padding: '1px 6px',
                        borderRadius: '999px',
                        background: 'var(--bg-surface-elevated)',
                        color: 'var(--text-secondary)'
                      }}>
                        {taskList.length}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => setShowAssignTaskModal(true)}
                      className="btn-primary"
                      style={{ padding: '6px 12px', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                    >
                      <Plus size={14} />
                      Deploy Team / Volunteer
                    </button>
                  </div>

                  {taskList.length === 0 ? (
                    <div style={{
                      padding: '16px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--bg-primary)',
                      border: '1px dashed var(--border-medium)',
                      textAlign: 'center',
                      color: 'var(--text-muted)',
                      fontSize: '0.78rem'
                    }}>
                      No operational teams or volunteers assigned to this request yet. Click "Deploy Team / Volunteer" above to dispatch field responders.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {taskList.map((task) => {
                        const isCompleted = task.status === 'Completed';
                        const isCancelled = task.status === 'Cancelled';
                        const isEnRoute = task.status === 'En Route';
                        const isArrived = task.status === 'Arrived';
                        const isAssigned = task.status === 'Assigned';
                        const isAccepted = task.status === 'Accepted';

                        return (
                          <div
                            key={task.assignment_id}
                            style={{
                              border: '1px solid var(--border-subtle)',
                              borderRadius: 'var(--radius-sm)',
                              background: 'var(--bg-primary)',
                              padding: '12px 14px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '8px'
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                  {task.assignment_id}
                                </span>
                                <span style={{
                                  padding: '2px 6px',
                                  borderRadius: '4px',
                                  fontSize: '0.65rem',
                                  fontWeight: 700,
                                  background: task.priority === 'Critical' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                                  color: task.priority === 'Critical' ? '#ef4444' : '#f59e0b'
                                }}>
                                  {task.priority}
                                </span>
                                <span style={{
                                  padding: '2px 8px',
                                  borderRadius: '999px',
                                  fontSize: '0.6875rem',
                                  fontWeight: 600,
                                  background: isCompleted ? 'rgba(16, 185, 129, 0.15)' : isCancelled ? 'rgba(239, 68, 68, 0.15)' : 'rgba(56, 189, 248, 0.15)',
                                  color: isCompleted ? '#10b981' : isCancelled ? '#ef4444' : '#38bdf8'
                                }}>
                                  {task.status}
                                </span>
                                <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                                  {task.task_type}: {task.assignee_name} ({task.assignee_type})
                                </span>
                              </div>

                              {/* Lifecycle action buttons */}
                              {!isCompleted && !isCancelled && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  {isAssigned && (
                                    <button
                                      type="button"
                                      onClick={() => setTaskActionModalData({ isOpen: true, assignment: task, actionType: 'Accept' })}
                                      className="btn-secondary"
                                      style={{ padding: '4px 8px', fontSize: '0.72rem', color: '#a855f7' }}
                                    >
                                      Accept
                                    </button>
                                  )}
                                  {(isAssigned || isAccepted) && (
                                    <button
                                      type="button"
                                      onClick={() => setTaskActionModalData({ isOpen: true, assignment: task, actionType: 'En Route' })}
                                      className="btn-secondary"
                                      style={{ padding: '4px 8px', fontSize: '0.72rem', color: '#0ea5e9' }}
                                    >
                                      En Route
                                    </button>
                                  )}
                                  {isEnRoute && (
                                    <button
                                      type="button"
                                      onClick={() => setTaskActionModalData({ isOpen: true, assignment: task, actionType: 'Arrive' })}
                                      className="btn-secondary"
                                      style={{ padding: '4px 8px', fontSize: '0.72rem', color: '#eab308' }}
                                    >
                                      Arrived
                                    </button>
                                  )}
                                  {(isArrived || isEnRoute || isAccepted) && (
                                    <button
                                      type="button"
                                      onClick={() => setTaskActionModalData({ isOpen: true, assignment: task, actionType: 'Complete' })}
                                      className="btn-secondary"
                                      style={{ padding: '4px 8px', fontSize: '0.72rem', color: '#10b981' }}
                                    >
                                      Complete
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => setTaskActionModalData({ isOpen: true, assignment: task, actionType: 'Cancel' })}
                                    className="btn-secondary"
                                    style={{ padding: '4px 8px', fontSize: '0.72rem', color: '#ef4444' }}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              )}
                            </div>

                            <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: 0 }}>
                              {task.task_description}
                            </p>

                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                              <div>Dest: <strong style={{ color: 'var(--text-primary)' }}>{task.destination}</strong></div>
                              {task.allocation_id && <div>Allocation: <strong style={{ color: '#38bdf8' }}>{task.allocation_id}</strong></div>}
                              {task.override_reason && <div style={{ color: '#f59e0b' }}>⚠️ Override: {task.override_reason}</div>}
                              <button
                                type="button"
                                onClick={() => setExpandedTaskEvents(prev => ({ ...prev, [task.assignment_id]: !prev[task.assignment_id] }))}
                                style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: '0.6875rem', cursor: 'pointer', textDecoration: 'underline' }}
                              >
                                {expandedTaskEvents[task.assignment_id] ? 'Hide Events' : `Events (${task.events?.length || 0})`}
                              </button>
                            </div>

                            {/* Expanded event trail */}
                            {expandedTaskEvents[task.assignment_id] && (
                              <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                {(task.events || []).map((ev, eIdx) => (
                                  <div key={eIdx} style={{ fontSize: '0.72rem', display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
                                    <span><strong>{ev.action}</strong>: {ev.note} {ev.simulated_coordinates && <span style={{ color: '#38bdf8' }}>[{ev.simulated_coordinates}]</span>}</span>
                                    <span style={{ color: 'var(--text-muted)', fontSize: '0.68rem' }}>{new Date(ev.timestamp).toLocaleTimeString()}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Actions Panel: Verify / Advance / Reject */}
            <div style={{
              border: '1px solid var(--border-medium)',
              borderRadius: 'var(--radius-md)',
              padding: '16px',
              background: 'var(--bg-surface)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '0.02em', textTransform: 'uppercase' }}>
                  Coordinator Actions & Verification
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>Operator:</span>
                  <input
                    type="text"
                    value={operatorName}
                    onChange={(e) => setOperatorName(e.target.value)}
                    style={{
                      background: 'var(--bg-surface-elevated)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-primary)',
                      fontSize: '0.72rem',
                      borderRadius: 'var(--radius-sm)',
                      padding: '2px 8px',
                      width: '130px'
                    }}
                  />
                </div>
              </div>

              {updateError && (
                <div style={{
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--alarm-bg)',
                  border: '1px solid var(--alarm-border)',
                  color: 'var(--alarm)',
                  fontSize: '0.75rem',
                  marginBottom: '12px'
                }}>
                  {updateError}
                </div>
              )}

              {showRejectInput ? (
                <div style={{
                  background: 'var(--bg-surface-elevated)',
                  border: '1px solid var(--alarm-border)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px'
                }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--alarm)' }}>
                    Rejection Reason (Required) *
                  </label>
                  <input
                    type="text"
                    required
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                    placeholder="e.g. Duplicate report / out of jurisdiction / false beacon trigger"
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--bg-primary)',
                      border: '1px solid var(--border-medium)',
                      color: 'var(--text-primary)',
                      fontSize: '0.8125rem',
                      outline: 'none'
                    }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setShowRejectInput(false)}
                      disabled={isUpdating}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={isUpdating || !rejectionReason.trim()}
                      onClick={() => handleUpdate({
                        verification_status: 'Rejected',
                        status: 'Rejected',
                        rejection_reason: rejectionReason.trim(),
                        change_reason: `Rejected: ${rejectionReason.trim()}`
                      })}
                      style={{ background: 'var(--alarm)', borderColor: 'var(--alarm)', color: '#fff' }}
                    >
                      Confirm Rejection
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
                  {/* Verification Actions */}
                  {req.verification_status !== 'Verified' && (
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={isUpdating}
                      onClick={() => handleUpdate({
                        verification_status: 'Verified',
                        change_reason: 'Citizen need verified by coordinator'
                      })}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                    >
                      <ShieldCheck size={14} />
                      Verify Request
                    </button>
                  )}

                  {/* Workflow Advancement */}
                  {req.status === 'Verified' && (
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={isUpdating}
                      onClick={() => handleUpdate({
                        status: 'Assigned',
                        change_reason: 'Assigned to field relief crew'
                      })}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                    >
                      <Truck size={14} />
                      Mark Assigned
                    </button>
                  )}

                  {req.status === 'Assigned' && (
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={isUpdating}
                      onClick={() => handleUpdate({
                        status: 'In Progress',
                        change_reason: 'Field unit en route / delivery in progress'
                      })}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                    >
                      <RotateCw size={14} />
                      Mark In Progress
                    </button>
                  )}

                  {req.status === 'In Progress' && (
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={isUpdating}
                      onClick={() => handleUpdate({
                        status: 'Fulfilled',
                        change_reason: 'Relief goods / rescue confirmed delivered'
                      })}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        background: 'var(--status-safe-strong)',
                        color: 'var(--bg-primary)'
                      }}
                    >
                      <CheckCircle2 size={14} />
                      Mark Fulfilled
                    </button>
                  )}

                  {/* Reject Action */}
                  {req.verification_status !== 'Rejected' && (
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={isUpdating}
                      onClick={() => setShowRejectInput(true)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        color: 'var(--alarm)'
                      }}
                    >
                      <XCircle size={14} />
                      Reject Request...
                    </button>
                  )}

                  {/* Quick Note Update */}
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                      type="text"
                      value={coordinatorNote}
                      onChange={(e) => setCoordinatorNote(e.target.value)}
                      placeholder="Add note..."
                      style={{
                        padding: '6px 10px',
                        borderRadius: 'var(--radius-sm)',
                        background: 'var(--bg-surface-elevated)',
                        border: '1px solid var(--border-subtle)',
                        color: 'var(--text-primary)',
                        fontSize: '0.75rem',
                        width: '180px'
                      }}
                    />
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={isUpdating || coordinatorNote === req.coordinator_notes}
                      onClick={() => handleUpdate({
                        coordinator_notes: coordinatorNote.trim(),
                        change_reason: 'Coordinator note updated'
                      })}
                      style={{ padding: '6px 10px', fontSize: '0.75rem' }}
                    >
                      Save Note
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Audit History & Status Timeline */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '12px' }}>
                <Clock size={15} color="var(--text-muted)" />
                Audit Trail & Status History ({history.length} events)
              </div>

              <div style={{
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--bg-primary)',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px'
              }}>
                {history.length === 0 ? (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                    No audit history records available.
                  </div>
                ) : (
                  history.map((h, i) => (
                    <div
                      key={h.id || i}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '12px',
                        position: 'relative',
                        paddingBottom: i === history.length - 1 ? 0 : '12px',
                        borderBottom: i === history.length - 1 ? 'none' : '1px solid var(--border-subtle)'
                      }}
                    >
                      <div style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        background: h.action === 'CREATED' ? 'var(--color-cyan)' :
                                   h.action === 'VERIFIED' ? 'var(--status-safe-strong)' :
                                   h.action === 'REJECTED' ? 'var(--alarm)' : 'var(--text-secondary)',
                        marginTop: '6px',
                        flexShrink: 0
                      }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px' }}>
                          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                            {h.action} &bull; <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>{h.changed_by}</span>
                          </span>
                          <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                            {new Date(h.timestamp).toLocaleString()}
                          </span>
                        </div>
                        {h.reason && (
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                            {h.reason}
                          </div>
                        )}
                        {(h.previous_status || h.new_status) && (
                          <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                            {h.previous_status ? `${h.previous_status} &rarr; ` : ''}<strong>{h.new_status}</strong>
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* Phase 3 Assignment Modals */}
      <AssignTaskModal
        isOpen={showAssignTaskModal}
        onClose={() => setShowAssignTaskModal(false)}
        requestData={data}
        onAssignmentCreated={() => {
          loadDetail();
          if (onUpdated) onUpdated();
        }}
      />

      <TaskActionModal
        isOpen={taskActionModalData.isOpen}
        onClose={() => setTaskActionModalData({ isOpen: false, assignment: null, actionType: '' })}
        assignment={taskActionModalData.assignment}
        actionType={taskActionModalData.actionType}
        onActionCompleted={() => {
          loadDetail();
          if (onUpdated) onUpdated();
        }}
      />
    </div>
  );
}
