import React, { useState, useEffect, useCallback } from 'react';
import {
  Users,
  User,
  Shield,
  Activity,
  Truck,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Plus,
  RefreshCw,
  Search,
  MapPin,
  Phone,
  Edit2,
  XCircle,
  ArrowRight,
  Radio,
  ExternalLink,
  ChevronRight,
  Database
} from 'lucide-react';
import {
  fetchTeams,
  fetchVolunteers,
  fetchAssignments,
  seedTeamsDemo
} from '../api/client';
import TeamModal from './TeamModal';
import VolunteerModal from './VolunteerModal';
import TaskActionModal from './TaskActionModal';

export default function VolunteersTeamsView({ onNavigateToRequests }) {
  const [subTab, setSubTab] = useState('teams'); // 'teams' | 'volunteers' | 'tasks'
  const [teams, setTeams] = useState([]);
  const [teamsSummary, setTeamsSummary] = useState({});
  const [volunteers, setVolunteers] = useState([]);
  const [volunteersSummary, setVolunteersSummary] = useState({});
  const [assignments, setAssignments] = useState([]);
  const [assignmentsSummary, setAssignmentsSummary] = useState({});

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [teamFilter, setTeamFilter] = useState('ALL');

  // Modals state
  const [isTeamModalOpen, setIsTeamModalOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState(null);

  const [isVolModalOpen, setIsVolModalOpen] = useState(false);
  const [editingVol, setEditingVol] = useState(null);

  const [actionModalData, setActionModalData] = useState({
    isOpen: false,
    assignment: null,
    actionType: ''
  });

  const [expandedTaskEvents, setExpandedTaskEvents] = useState({});

  const loadAllData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const [tData, vData, aData] = await Promise.all([
        fetchTeams(),
        fetchVolunteers(),
        fetchAssignments()
      ]);
      setTeams(tData.teams || []);
      setTeamsSummary(tData.summary || {});
      setVolunteers(vData.volunteers || []);
      setVolunteersSummary(vData.summary || {});
      setAssignments(aData.assignments || []);
      setAssignmentsSummary(aData.summary || {});
    } catch (err) {
      console.error('Failed to load teams/volunteers data:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  const handleSeedDemo = async () => {
    try {
      setRefreshing(true);
      await seedTeamsDemo();
      await loadAllData(true);
    } catch (err) {
      console.error('Failed to seed teams demo:', err);
    } finally {
      setRefreshing(false);
    }
  };

  const toggleTaskEvents = (taskId) => {
    setExpandedTaskEvents(prev => ({ ...prev, [taskId]: !prev[taskId] }));
  };

  const openActionModal = (assignment, actionType) => {
    setActionModalData({
      isOpen: true,
      assignment,
      actionType
    });
  };

  // Filtered lists
  const filteredTeams = teams.filter(t => {
    if (statusFilter !== 'ALL' && t.availability_status !== statusFilter) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      t.name.toLowerCase().includes(q) ||
      t.team_id.toLowerCase().includes(q) ||
      (t.skills || '').toLowerCase().includes(q) ||
      (t.equipment || '').toLowerCase().includes(q) ||
      (t.base_location || '').toLowerCase().includes(q)
    );
  });

  const filteredVolunteers = volunteers.filter(v => {
    if (statusFilter !== 'ALL' && v.availability_status !== statusFilter) return false;
    if (teamFilter !== 'ALL') {
      if (teamFilter === 'UNASSIGNED' && v.team_id) return false;
      if (teamFilter !== 'UNASSIGNED' && v.team_id !== teamFilter) return false;
    }
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      v.name.toLowerCase().includes(q) ||
      v.volunteer_id.toLowerCase().includes(q) ||
      (v.skills || '').toLowerCase().includes(q) ||
      (v.current_zone || '').toLowerCase().includes(q)
    );
  });

  const filteredAssignments = assignments.filter(a => {
    if (statusFilter !== 'ALL' && a.status !== statusFilter) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      a.assignment_id.toLowerCase().includes(q) ||
      a.assignee_name.toLowerCase().includes(q) ||
      a.task_description.toLowerCase().includes(q) ||
      a.destination.toLowerCase().includes(q) ||
      (a.household_label || '').toLowerCase().includes(q)
    );
  });

  const getStatusBadge = (status) => {
    switch (status) {
      case 'Available':
        return <span style={{ padding: '3px 8px', borderRadius: '999px', fontSize: '0.6875rem', fontWeight: 600, background: 'rgba(16, 185, 129, 0.12)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.3)' }}>Available</span>;
      case 'Assigned':
        return <span style={{ padding: '3px 8px', borderRadius: '999px', fontSize: '0.6875rem', fontWeight: 600, background: 'rgba(56, 189, 248, 0.12)', color: '#38bdf8', border: '1px solid rgba(56, 189, 248, 0.3)' }}>Assigned</span>;
      case 'Busy':
        return <span style={{ padding: '3px 8px', borderRadius: '999px', fontSize: '0.6875rem', fontWeight: 600, background: 'rgba(245, 158, 11, 0.12)', color: '#f59e0b', border: '1px solid rgba(245, 158, 11, 0.3)' }}>Busy</span>;
      case 'Offline':
        return <span style={{ padding: '3px 8px', borderRadius: '999px', fontSize: '0.6875rem', fontWeight: 600, background: 'rgba(148, 163, 184, 0.12)', color: '#94a3b8', border: '1px solid rgba(148, 163, 184, 0.3)' }}>Offline</span>;
      default:
        return <span style={{ padding: '3px 8px', borderRadius: '999px', fontSize: '0.6875rem', fontWeight: 600, background: 'var(--bg-surface-elevated)', color: 'var(--text-secondary)' }}>{status}</span>;
    }
  };

  const getTaskStatusBadge = (status) => {
    switch (status) {
      case 'Assigned':
        return <span style={{ padding: '3px 8px', borderRadius: '999px', fontSize: '0.6875rem', fontWeight: 600, background: 'rgba(59, 130, 246, 0.12)', color: '#3b82f6', border: '1px solid rgba(59, 130, 246, 0.3)' }}>Assigned</span>;
      case 'Accepted':
        return <span style={{ padding: '3px 8px', borderRadius: '999px', fontSize: '0.6875rem', fontWeight: 600, background: 'rgba(168, 85, 247, 0.12)', color: '#a855f7', border: '1px solid rgba(168, 85, 247, 0.3)' }}>Accepted</span>;
      case 'En Route':
        return <span style={{ padding: '3px 8px', borderRadius: '999px', fontSize: '0.6875rem', fontWeight: 600, background: 'rgba(14, 165, 233, 0.15)', color: '#0ea5e9', border: '1px solid rgba(14, 165, 233, 0.3)' }}>En Route</span>;
      case 'Arrived':
        return <span style={{ padding: '3px 8px', borderRadius: '999px', fontSize: '0.6875rem', fontWeight: 600, background: 'rgba(234, 179, 8, 0.15)', color: '#eab308', border: '1px solid rgba(234, 179, 8, 0.3)' }}>Arrived</span>;
      case 'Completed':
        return <span style={{ padding: '3px 8px', borderRadius: '999px', fontSize: '0.6875rem', fontWeight: 600, background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.3)' }}>Completed</span>;
      case 'Cancelled':
        return <span style={{ padding: '3px 8px', borderRadius: '999px', fontSize: '0.6875rem', fontWeight: 600, background: 'rgba(239, 68, 68, 0.12)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.3)' }}>Cancelled</span>;
      default:
        return <span style={{ padding: '3px 8px', borderRadius: '999px', fontSize: '0.6875rem', fontWeight: 600, background: 'var(--bg-surface-elevated)' }}>{status}</span>;
    }
  };

  const getPriorityBadge = (p) => {
    const isCrit = (p || '').toUpperCase() === 'CRITICAL';
    const isHigh = (p || '').toUpperCase() === 'HIGH';
    return (
      <span style={{
        padding: '2px 7px',
        borderRadius: '4px',
        fontSize: '0.65rem',
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        background: isCrit ? 'rgba(239, 68, 68, 0.15)' : isHigh ? 'rgba(245, 158, 11, 0.15)' : 'rgba(148, 163, 184, 0.12)',
        color: isCrit ? '#ef4444' : isHigh ? '#f59e0b' : '#94a3b8',
        border: `1px solid ${isCrit ? 'rgba(239, 68, 68, 0.3)' : isHigh ? 'rgba(245, 158, 11, 0.3)' : 'rgba(148, 163, 184, 0.2)'}`
      }}>
        {p}
      </span>
    );
  };

  return (
    <div className="volunteers-teams-view" style={{ padding: '24px', maxWidth: '1440px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Top Header */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '16px',
        borderBottom: '1px solid var(--border-subtle)',
        paddingBottom: '16px'
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              background: 'var(--accent-subtle)',
              color: 'var(--accent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <Users size={20} />
            </div>
            <div>
              <h1 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                Response Teams & Volunteer Coordination
              </h1>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>
                Manage emergency field personnel, dispatch relief task assignments, and monitor simulated deployment routes
              </p>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <button
            onClick={() => { setEditingTeam(null); setIsTeamModalOpen(true); }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '7px 14px',
              borderRadius: '6px',
              background: 'var(--accent)',
              color: '#fff',
              fontSize: '0.8125rem',
              fontWeight: 600,
              border: 'none',
              cursor: 'pointer'
            }}
          >
            <Plus size={15} />
            Register Team
          </button>

          <button
            onClick={() => { setEditingVol(null); setIsVolModalOpen(true); }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '7px 14px',
              borderRadius: '6px',
              background: '#10b981',
              color: '#fff',
              fontSize: '0.8125rem',
              fontWeight: 600,
              border: 'none',
              cursor: 'pointer'
            }}
          >
            <Plus size={15} />
            Register Volunteer
          </button>

          <button
            onClick={handleSeedDemo}
            disabled={refreshing}
            title="Seed baseline demonstration units"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '7px 12px',
              borderRadius: '6px',
              background: 'var(--bg-surface-elevated)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-secondary)',
              fontSize: '0.8125rem',
              cursor: 'pointer'
            }}
          >
            <Database size={14} />
            Seed Demo Units
          </button>

          <button
            onClick={() => loadAllData(true)}
            disabled={refreshing}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '7px 12px',
              borderRadius: '6px',
              background: 'var(--bg-surface-elevated)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-secondary)',
              fontSize: '0.8125rem',
              cursor: 'pointer'
            }}
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Summary KPI Metric Cards (6 cards) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px' }}>
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '10px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 500 }}>Response Teams</span>
            <Shield size={16} color="var(--accent)" />
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            {teamsSummary.total_teams || teams.length}
          </div>
          <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
            <span style={{ color: '#10b981', fontWeight: 600 }}>{teamsSummary.available_teams || 0}</span> ready &bull; <span style={{ color: '#38bdf8', fontWeight: 600 }}>{teamsSummary.assigned_teams || 0}</span> deployed
          </div>
        </div>

        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '10px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 500 }}>Field Volunteers</span>
            <Users size={16} color="#10b981" />
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            {volunteersSummary.total_volunteers || volunteers.length}
          </div>
          <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
            <span style={{ color: '#10b981', fontWeight: 600 }}>{volunteersSummary.available || 0}</span> available &bull; <span style={{ color: '#f59e0b', fontWeight: 600 }}>{volunteersSummary.unassigned || 0}</span> unassigned
          </div>
        </div>

        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '10px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 500 }}>En Route / Transit</span>
            <Truck size={16} color="#0ea5e9" />
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0ea5e9' }}>
            {assignmentsSummary.en_route || 0}
          </div>
          <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
            Simulated transit to flood zones
          </div>
        </div>

        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '10px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 500 }}>Assigned / Accepted</span>
            <Clock size={16} color="#3b82f6" />
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#3b82f6' }}>
            {(assignmentsSummary.assigned || 0) + (assignmentsSummary.accepted || 0)}
          </div>
          <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
            Pending dispatch departure
          </div>
        </div>

        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '10px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 500 }}>Completed Missions</span>
            <CheckCircle2 size={16} color="#10b981" />
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#10b981' }}>
            {assignmentsSummary.completed || 0}
          </div>
          <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
            Successful field deliveries & rescues
          </div>
        </div>

        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '10px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 500 }}>Offline / Inactive</span>
            <Radio size={16} color="#94a3b8" />
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-muted)' }}>
            {(teamsSummary.offline_teams || 0) + (volunteersSummary.offline || 0)}
          </div>
          <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
            Off-duty personnel
          </div>
        </div>
      </div>

      {/* Main Tabs Navigation */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '1px solid var(--border-subtle)',
        paddingBottom: '8px',
        flexWrap: 'wrap',
        gap: '12px'
      }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => { setSubTab('teams'); setStatusFilter('ALL'); setSearchQuery(''); }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 16px',
              borderRadius: '6px',
              fontSize: '0.8125rem',
              fontWeight: 600,
              background: subTab === 'teams' ? 'var(--accent)' : 'transparent',
              color: subTab === 'teams' ? '#fff' : 'var(--text-secondary)',
              border: subTab === 'teams' ? 'none' : '1px solid var(--border-subtle)',
              cursor: 'pointer'
            }}
          >
            <Shield size={15} />
            Response Teams ({teams.length})
          </button>

          <button
            onClick={() => { setSubTab('volunteers'); setStatusFilter('ALL'); setSearchQuery(''); }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 16px',
              borderRadius: '6px',
              fontSize: '0.8125rem',
              fontWeight: 600,
              background: subTab === 'volunteers' ? 'var(--accent)' : 'transparent',
              color: subTab === 'volunteers' ? '#fff' : 'var(--text-secondary)',
              border: subTab === 'volunteers' ? 'none' : '1px solid var(--border-subtle)',
              cursor: 'pointer'
            }}
          >
            <Users size={15} />
            Field Volunteers ({volunteers.length})
          </button>

          <button
            onClick={() => { setSubTab('tasks'); setStatusFilter('ALL'); setSearchQuery(''); }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 16px',
              borderRadius: '6px',
              fontSize: '0.8125rem',
              fontWeight: 600,
              background: subTab === 'tasks' ? 'var(--accent)' : 'transparent',
              color: subTab === 'tasks' ? '#fff' : 'var(--text-secondary)',
              border: subTab === 'tasks' ? 'none' : '1px solid var(--border-subtle)',
              cursor: 'pointer'
            }}
          >
            <Truck size={15} />
            Operational Tasks ({assignments.length})
          </button>
        </div>

        {/* Search & Filters */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', width: '220px' }}>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search..."
              style={{
                width: '100%',
                padding: '6px 10px 6px 30px',
                background: 'var(--bg-input)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '6px',
                color: 'var(--text-primary)',
                fontSize: '0.8125rem'
              }}
            />
            <Search size={14} style={{ position: 'absolute', left: '10px', top: '9px', color: 'var(--text-muted)' }} />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{
              padding: '6px 10px',
              background: 'var(--bg-input)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '6px',
              color: 'var(--text-primary)',
              fontSize: '0.8125rem'
            }}
          >
            <option value="ALL">All Statuses</option>
            {subTab === 'tasks' ? (
              <>
                <option value="Assigned">Assigned</option>
                <option value="Accepted">Accepted</option>
                <option value="En Route">En Route</option>
                <option value="Arrived">Arrived</option>
                <option value="Completed">Completed</option>
                <option value="Cancelled">Cancelled</option>
              </>
            ) : (
              <>
                <option value="Available">Available</option>
                <option value="Assigned">Assigned</option>
                <option value="Busy">Busy</option>
                <option value="Offline">Offline</option>
              </>
            )}
          </select>

          {subTab === 'volunteers' && (
            <select
              value={teamFilter}
              onChange={(e) => setTeamFilter(e.target.value)}
              style={{
                padding: '6px 10px',
                background: 'var(--bg-input)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '6px',
                color: 'var(--text-primary)',
                fontSize: '0.8125rem'
              }}
            >
              <option value="ALL">All Teams</option>
              <option value="UNASSIGNED">Unassigned Only</option>
              {teams.map(t => (
                <option key={t.team_id} value={t.team_id}>{t.name}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Tab 1: Response Teams Grid */}
      {subTab === 'teams' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '16px' }}>
          {filteredTeams.map(team => (
            <div
              key={team.team_id}
              style={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '10px',
                padding: '18px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
              }}
            >
              {/* Card Header */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '0.6875rem', fontFamily: 'monospace', color: 'var(--text-muted)' }}>{team.team_id}</span>
                    {getStatusBadge(team.availability_status)}
                  </div>
                  <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', margin: '4px 0 2px 0' }}>
                    {team.name}
                  </h3>
                  <span style={{ fontSize: '0.75rem', color: 'var(--accent)', fontWeight: 500 }}>
                    {team.team_type}
                  </span>
                </div>
                <button
                  onClick={() => { setEditingTeam(team); setIsTeamModalOpen(true); }}
                  title="Edit Team"
                  style={{
                    background: 'var(--bg-surface-elevated)',
                    border: '1px solid var(--border-subtle)',
                    padding: '6px',
                    borderRadius: '6px',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer'
                  }}
                >
                  <Edit2 size={14} />
                </button>
              </div>

              {/* Leader & Contact */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', fontSize: '0.75rem', color: 'var(--text-secondary)', borderTop: '1px solid var(--border-subtle)', paddingTop: '10px' }}>
                {team.leader_name && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <User size={13} color="var(--text-muted)" />
                    <span>Leader: <strong style={{ color: 'var(--text-primary)' }}>{team.leader_name}</strong></span>
                  </div>
                )}
                {team.contact_number && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Phone size={13} color="var(--text-muted)" />
                    <span>{team.contact_number}</span>
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Users size={13} color="var(--text-muted)" />
                  <span>Members: <strong>{team.members_count}</strong></span>
                </div>
              </div>

              {/* Base Location */}
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <MapPin size={14} color="var(--accent)" />
                <span>Base: <strong>{team.base_location}</strong></span>
              </div>

              {/* Skills Tags */}
              {team.skills && (
                <div>
                  <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Specialized Skills</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                    {team.skills.split(',').map((s, idx) => (
                      <span key={idx} style={{ fontSize: '0.6875rem', background: 'var(--bg-surface-elevated)', border: '1px solid var(--border-subtle)', padding: '2px 6px', borderRadius: '4px', color: 'var(--text-secondary)' }}>
                        {s.trim()}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Equipment Tags */}
              {team.equipment && (
                <div>
                  <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Equipment & Vehicles</span>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>
                    {team.equipment}
                  </p>
                </div>
              )}

              {/* Active Assignment Snippet */}
              {team.current_assignment ? (
                <div style={{
                  background: 'rgba(56, 189, 248, 0.08)',
                  border: '1px solid rgba(56, 189, 248, 0.25)',
                  borderRadius: '6px',
                  padding: '8px 10px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginTop: 'auto'
                }}>
                  <div>
                    <span style={{ fontSize: '0.6875rem', color: '#38bdf8', fontWeight: 600, display: 'block' }}>
                      Active Mission: {team.current_assignment.assignment_id}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-primary)' }}>
                      {team.current_assignment.destination} &bull; {team.current_assignment.task_type}
                    </span>
                  </div>
                  {getTaskStatusBadge(team.current_assignment.status)}
                </div>
              ) : (
                <div style={{
                  background: 'var(--bg-surface-elevated)',
                  borderRadius: '6px',
                  padding: '6px 10px',
                  fontSize: '0.75rem',
                  color: 'var(--text-muted)',
                  marginTop: 'auto'
                }}>
                  No active operational task &bull; Ready for deployment
                </div>
              )}
            </div>
          ))}

          {filteredTeams.length === 0 && (
            <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '40px', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
              No response teams found matching the filters. Click "Register Team" to create one.
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Volunteers Table / Grid */}
      {subTab === 'volunteers' && (
        <div style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '10px',
          overflow: 'hidden'
        }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.8125rem' }}>
              <thead>
                <tr style={{ background: 'var(--bg-surface-elevated)', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase' }}>
                  <th style={{ padding: '12px 16px' }}>Volunteer</th>
                  <th style={{ padding: '12px 16px' }}>Assigned Team</th>
                  <th style={{ padding: '12px 16px' }}>Skills & Expertise</th>
                  <th style={{ padding: '12px 16px' }}>Status</th>
                  <th style={{ padding: '12px 16px' }}>Current Zone</th>
                  <th style={{ padding: '12px 16px' }}>Contact</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredVolunteers.map(vol => (
                  <tr key={vol.volunteer_id} style={{ borderBottom: '1px solid var(--border-subtle)', transition: 'background 0.15s' }}>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{vol.name}</div>
                      <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{vol.volunteer_id}</span>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      {vol.team_id ? (
                        <div>
                          <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{vol.team_name || vol.team_id}</div>
                          <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{vol.team_id}</span>
                        </div>
                      ) : (
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>Independent</span>
                      )}
                    </td>
                    <td style={{ padding: '12px 16px', maxWidth: '240px' }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                        {(vol.skills || 'General Assistance').split(',').map((s, idx) => (
                          <span key={idx} style={{ fontSize: '0.6875rem', background: 'var(--bg-surface-elevated)', border: '1px solid var(--border-subtle)', padding: '2px 6px', borderRadius: '4px' }}>
                            {s.trim()}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      {getStatusBadge(vol.availability_status)}
                    </td>
                    <td style={{ padding: '12px 16px', color: 'var(--text-secondary)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <MapPin size={13} color="var(--accent)" />
                        <span>{vol.current_zone}</span>
                      </div>
                      <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>(Synthetic Demo)</span>
                    </td>
                    <td style={{ padding: '12px 16px', color: 'var(--text-secondary)' }}>
                      {vol.contact || '—'}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                      <button
                        onClick={() => { setEditingVol(vol); setIsVolModalOpen(true); }}
                        style={{
                          background: 'var(--bg-surface-elevated)',
                          border: '1px solid var(--border-subtle)',
                          padding: '5px 10px',
                          borderRadius: '5px',
                          color: 'var(--text-secondary)',
                          fontSize: '0.75rem',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                      >
                        <Edit2 size={13} />
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}

                {filteredVolunteers.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: '36px', color: 'var(--text-muted)' }}>
                      No volunteers found matching the filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: Operational Tasks & Delivery Tracking */}
      {subTab === 'tasks' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {filteredAssignments.map(task => {
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
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '10px',
                  padding: '16px 20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.1)'
                }}
              >
                {/* Task Top Row */}
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '0.75rem', fontFamily: 'monospace', color: 'var(--text-muted)' }}>{task.assignment_id}</span>
                    {getPriorityBadge(task.priority)}
                    {getTaskStatusBadge(task.status)}
                    <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {task.task_type}: {task.destination}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {/* Action buttons based on lifecycle */}
                    {!isCompleted && !isCancelled && (
                      <>
                        {isAssigned && (
                          <button
                            onClick={() => openActionModal(task, 'Accept')}
                            style={{ padding: '5px 12px', borderRadius: '5px', background: 'rgba(168, 85, 247, 0.15)', border: '1px solid rgba(168, 85, 247, 0.3)', color: '#a855f7', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer' }}
                          >
                            Accept Task
                          </button>
                        )}
                        {(isAssigned || isAccepted) && (
                          <button
                            onClick={() => openActionModal(task, 'En Route')}
                            style={{ padding: '5px 12px', borderRadius: '5px', background: 'rgba(14, 165, 233, 0.15)', border: '1px solid rgba(14, 165, 233, 0.3)', color: '#0ea5e9', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer' }}
                          >
                            Mark En Route
                          </button>
                        )}
                        {isEnRoute && (
                          <button
                            onClick={() => openActionModal(task, 'Arrive')}
                            style={{ padding: '5px 12px', borderRadius: '5px', background: 'rgba(234, 179, 8, 0.15)', border: '1px solid rgba(234, 179, 8, 0.3)', color: '#eab308', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer' }}
                          >
                            Confirm Arrival
                          </button>
                        )}
                        {(isArrived || isEnRoute || isAccepted) && (
                          <button
                            onClick={() => openActionModal(task, 'Complete')}
                            style={{ padding: '5px 12px', borderRadius: '5px', background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.3)', color: '#10b981', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer' }}
                          >
                            Complete Mission
                          </button>
                        )}
                        <button
                          onClick={() => openActionModal(task, 'Cancel')}
                          style={{ padding: '5px 12px', borderRadius: '5px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#ef4444', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer' }}
                        >
                          Cancel
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => toggleTaskEvents(task.assignment_id)}
                      style={{ padding: '5px 10px', borderRadius: '5px', background: 'var(--bg-surface-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)', fontSize: '0.75rem', cursor: 'pointer' }}
                    >
                      {expandedTaskEvents[task.assignment_id] ? 'Hide Audit Log' : `Audit Log (${task.events?.length || 0})`}
                    </button>
                  </div>
                </div>

                {/* Description & Details */}
                <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', margin: 0 }}>
                  {task.task_description}
                </p>

                {/* Metadata strip */}
                <div style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '16px',
                  fontSize: '0.75rem',
                  color: 'var(--text-muted)',
                  background: 'var(--bg-surface-elevated)',
                  padding: '8px 12px',
                  borderRadius: '6px'
                }}>
                  <div>
                    <span>Assignee:</span> <strong style={{ color: 'var(--text-primary)' }}>{task.assignee_name} ({task.assignee_type})</strong>
                  </div>
                  <div>
                    <span>Request:</span> <strong style={{ color: 'var(--text-primary)' }}>{task.household_label || task.request_id}</strong>
                  </div>
                  {task.allocation_id && (
                    <div>
                      <span>Linked Supply:</span> <strong style={{ color: '#38bdf8' }}>{task.item_name || task.allocation_id}</strong>
                    </div>
                  )}
                  {task.override_reason && (
                    <div style={{ color: '#f59e0b' }}>
                      <span>⚠️ Emergency Override:</span> {task.override_reason}
                    </div>
                  )}
                  <div style={{ marginLeft: 'auto', fontSize: '0.6875rem' }}>
                    Created: {new Date(task.created_at).toLocaleTimeString()}
                  </div>
                </div>

                {/* Expandable Audit Log */}
                {expandedTaskEvents[task.assignment_id] && (
                  <div style={{
                    borderTop: '1px solid var(--border-subtle)',
                    paddingTop: '12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px'
                  }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>Lifecycle Events & Waypoint Log:</span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {(task.events || []).map((ev, idx) => (
                        <div key={idx} style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          fontSize: '0.75rem',
                          background: 'var(--bg-surface-elevated)',
                          padding: '6px 10px',
                          borderRadius: '4px'
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontWeight: 600, color: 'var(--accent)' }}>{ev.action}</span>
                            <span style={{ color: 'var(--text-muted)' }}>&bull;</span>
                            <span style={{ color: 'var(--text-secondary)' }}>{ev.note || 'No notes'}</span>
                            {ev.simulated_coordinates && (
                              <span style={{ fontSize: '0.6875rem', color: '#38bdf8', fontFamily: 'monospace' }}>
                                [{ev.simulated_coordinates}]
                              </span>
                            )}
                          </div>
                          <div style={{ color: 'var(--text-muted)', fontSize: '0.6875rem' }}>
                            {ev.actor} &bull; {new Date(ev.timestamp).toLocaleTimeString()}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {filteredAssignments.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
              No operational tasks found matching the filter. Tasks are assigned from the Emergency Requests detail modal.
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      <TeamModal
        isOpen={isTeamModalOpen}
        onClose={() => setIsTeamModalOpen(false)}
        team={editingTeam}
        onSaved={() => loadAllData(true)}
      />

      <VolunteerModal
        isOpen={isVolModalOpen}
        onClose={() => setIsVolModalOpen(false)}
        volunteer={editingVol}
        onSaved={() => loadAllData(true)}
      />

      <TaskActionModal
        isOpen={actionModalData.isOpen}
        onClose={() => setActionModalData({ isOpen: false, assignment: null, actionType: '' })}
        assignment={actionModalData.assignment}
        actionType={actionModalData.actionType}
        onActionCompleted={() => loadAllData(true)}
      />
    </div>
  );
}
