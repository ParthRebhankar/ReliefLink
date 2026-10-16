/**
 * FloodGuard API Client
 */

// Allow override via localStorage or environment, defaulting to window.location.origin (via Vite proxy) or direct IP
export const getBaseUrl = () => {
  const custom = localStorage.getItem('floodguard_api_url');
  if (custom) return custom.replace(/\/+$/, '');
  // Default to relative (Vite proxy)
  return '';
};

export const setBaseUrl = (url) => {
  if (!url) {
    localStorage.removeItem('floodguard_api_url');
  } else {
    localStorage.setItem('floodguard_api_url', url.replace(/\/+$/, ''));
  }
};

export async function fetchHealth() {
  const base = getBaseUrl();
  const res = await fetch(`${base}/health`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Health check failed: ${res.statusText}`);
  return await res.json();
}

export async function fetchZones() {
  const base = getBaseUrl();
  const res = await fetch(`${base}/api/zones`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Fetch zones failed: ${res.statusText}`);
  return await res.json();
}

export async function fetchLatestReading(zoneId = 'Z001') {
  const base = getBaseUrl();
  const res = await fetch(`${base}/api/zones/${zoneId}/latest`, { cache: 'no-store' });
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`Fetch latest reading failed: ${res.statusText}`);
  }
  return await res.json();
}

export async function fetchReadingHistory(zoneId = 'Z001', limit = 50) {
  const base = getBaseUrl();
  const res = await fetch(`${base}/api/zones/${zoneId}/history?limit=${limit}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Fetch history failed: ${res.statusText}`);
  return await res.json();
}

export async function fetchMap() {
  const base = getBaseUrl();
  const res = await fetch(`${base}/api/map`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Fetch map failed: ${res.statusText}`);
  return await res.json();
}

export async function postSensorReading(payload) {
  const base = getBaseUrl();
  const res = await fetch(`${base}/api/readings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Ingest reading failed (${res.status}): ${errorText}`);
  }
  return await res.json();
}

export async function fetchEmergencyRequests(filters = {}) {
  const base = getBaseUrl();
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '' && v !== 'ALL') {
      params.append(k, v);
    }
  });
  const queryString = params.toString() ? `?${params.toString()}` : '';
  const res = await fetch(`${base}/api/requests${queryString}`, { cache: 'no-store' });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Fetch emergency requests failed (${res.status}): ${errorText || res.statusText}`);
  }
  return await res.json();
}

export async function fetchEmergencyRequestById(requestId) {
  const base = getBaseUrl();
  const res = await fetch(`${base}/api/requests/${encodeURIComponent(requestId)}`, { cache: 'no-store' });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Fetch request detail failed (${res.status}): ${errorText || res.statusText}`);
  }
  return await res.json();
}

export async function createEmergencyRequest(payload) {
  const base = getBaseUrl();
  const res = await fetch(`${base}/api/requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Create emergency request failed (${res.status}): ${errorText || res.statusText}`);
  }
  return await res.json();
}

export async function updateEmergencyRequest(requestId, payload) {
  const base = getBaseUrl();
  const res = await fetch(`${base}/api/requests/${encodeURIComponent(requestId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Update emergency request failed (${res.status}): ${errorText || res.statusText}`);
  }
  return await res.json();
}

export async function simulateSOSEvent(payload) {
  const base = getBaseUrl();
  const res = await fetch(`${base}/api/sos/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Simulate SOS failed (${res.status}): ${errorText || res.statusText}`);
  }
  return await res.json();
}

// ---------------------------------------------------------------------------
// Phase 2: Relief Inventory & Allocations API Client
// ---------------------------------------------------------------------------

export async function fetchInventory(filters = {}) {
  const base = getBaseUrl();
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '' && v !== 'ALL') {
      params.append(k, v);
    }
  });
  const queryString = params.toString() ? `?${params.toString()}` : '';
  const res = await fetch(`${base}/api/inventory${queryString}`, { cache: 'no-store' });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Fetch inventory failed (${res.status}): ${errorText || res.statusText}`);
  }
  return await res.json();
}

export async function fetchInventoryItem(itemId) {
  const base = getBaseUrl();
  const res = await fetch(`${base}/api/inventory/${encodeURIComponent(itemId)}`, { cache: 'no-store' });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Fetch inventory item failed (${res.status}): ${errorText || res.statusText}`);
  }
  return await res.json();
}

export async function createInventoryItem(payload) {
  const base = getBaseUrl();
  const res = await fetch(`${base}/api/inventory`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Create inventory item failed (${res.status}): ${errorText || res.statusText}`);
  }
  return await res.json();
}

export async function updateInventoryItem(itemId, payload) {
  const base = getBaseUrl();
  const res = await fetch(`${base}/api/inventory/${encodeURIComponent(itemId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Update inventory item failed (${res.status}): ${errorText || res.statusText}`);
  }
  return await res.json();
}

export async function receiveStock(itemId, payload) {
  const base = getBaseUrl();
  const res = await fetch(`${base}/api/inventory/${encodeURIComponent(itemId)}/receive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Receive stock failed (${res.status}): ${errorText || res.statusText}`);
  }
  return await res.json();
}

export async function adjustStock(itemId, payload) {
  const base = getBaseUrl();
  const res = await fetch(`${base}/api/inventory/${encodeURIComponent(itemId)}/adjust`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Adjust stock failed (${res.status}): ${errorText || res.statusText}`);
  }
  return await res.json();
}

export async function fetchItemMovements(itemId, limit = 100) {
  const base = getBaseUrl();
  const res = await fetch(`${base}/api/inventory/${encodeURIComponent(itemId)}/movements?limit=${limit}`, { cache: 'no-store' });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Fetch movements failed (${res.status}): ${errorText || res.statusText}`);
  }
  return await res.json();
}

export async function fetchAllocations(filters = {}) {
  const base = getBaseUrl();
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '' && v !== 'ALL') {
      params.append(k, v);
    }
  });
  const queryString = params.toString() ? `?${params.toString()}` : '';
  const res = await fetch(`${base}/api/allocations${queryString}`, { cache: 'no-store' });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Fetch allocations failed (${res.status}): ${errorText || res.statusText}`);
  }
  return await res.json();
}

export async function createAllocation(payload) {
  const base = getBaseUrl();
  const res = await fetch(`${base}/api/allocations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Create allocation failed (${res.status}): ${errorText || res.statusText}`);
  }
  return await res.json();
}

export async function dispatchAllocation(allocationId, payload = {}) {
  const base = getBaseUrl();
  const res = await fetch(`${base}/api/allocations/${encodeURIComponent(allocationId)}/dispatch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Dispatch allocation failed (${res.status}): ${errorText || res.statusText}`);
  }
  return await res.json();
}

export async function deliverAllocation(allocationId, payload = {}) {
  const base = getBaseUrl();
  const res = await fetch(`${base}/api/allocations/${encodeURIComponent(allocationId)}/deliver`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Deliver allocation failed (${res.status}): ${errorText || res.statusText}`);
  }
  return await res.json();
}

export async function cancelAllocation(allocationId, payload) {
  const base = getBaseUrl();
  const res = await fetch(`${base}/api/allocations/${encodeURIComponent(allocationId)}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Cancel allocation failed (${res.status}): ${errorText || res.statusText}`);
  }
  return await res.json();
}

export async function seedInventoryDemo() {
  const base = getBaseUrl();
  const res = await fetch(`${base}/api/inventory/seed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Seed inventory failed (${res.status}): ${errorText || res.statusText}`);
  }
  return await res.json();
}

// ---------------------------------------------------------------------------
// Phase 3: Volunteers, Response Teams, and Task Assignments
// ---------------------------------------------------------------------------

export async function fetchTeams(filters = {}) {
  const base = getBaseUrl();
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '' && v !== 'ALL') {
      params.append(k, v);
    }
  });
  const queryString = params.toString() ? `?${params.toString()}` : '';
  const res = await fetch(`${base}/api/teams${queryString}`, { cache: 'no-store' });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Fetch teams failed (${res.status}): ${errorText || res.statusText}`);
  }
  return await res.json();
}

export async function createTeam(payload) {
  const base = getBaseUrl();
  const res = await fetch(`${base}/api/teams`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Create team failed (${res.status}): ${errorText || res.statusText}`);
  }
  return await res.json();
}

export async function updateTeam(teamId, payload) {
  const base = getBaseUrl();
  const res = await fetch(`${base}/api/teams/${encodeURIComponent(teamId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Update team failed (${res.status}): ${errorText || res.statusText}`);
  }
  return await res.json();
}

export async function fetchVolunteers(filters = {}) {
  const base = getBaseUrl();
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '' && v !== 'ALL') {
      params.append(k, v);
    }
  });
  const queryString = params.toString() ? `?${params.toString()}` : '';
  const res = await fetch(`${base}/api/volunteers${queryString}`, { cache: 'no-store' });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Fetch volunteers failed (${res.status}): ${errorText || res.statusText}`);
  }
  return await res.json();
}

export async function createVolunteer(payload) {
  const base = getBaseUrl();
  const res = await fetch(`${base}/api/volunteers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Create volunteer failed (${res.status}): ${errorText || res.statusText}`);
  }
  return await res.json();
}

export async function updateVolunteer(volunteerId, payload) {
  const base = getBaseUrl();
  const res = await fetch(`${base}/api/volunteers/${encodeURIComponent(volunteerId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Update volunteer failed (${res.status}): ${errorText || res.statusText}`);
  }
  return await res.json();
}

export async function fetchAssignments(filters = {}) {
  const base = getBaseUrl();
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '' && v !== 'ALL') {
      params.append(k, v);
    }
  });
  const queryString = params.toString() ? `?${params.toString()}` : '';
  const res = await fetch(`${base}/api/assignments${queryString}`, { cache: 'no-store' });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Fetch assignments failed (${res.status}): ${errorText || res.statusText}`);
  }
  return await res.json();
}

export async function createAssignment(payload) {
  const base = getBaseUrl();
  const res = await fetch(`${base}/api/assignments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Create assignment failed (${res.status}): ${errorText || res.statusText}`);
  }
  return await res.json();
}

export async function updateAssignmentAction(assignmentId, payload) {
  const base = getBaseUrl();
  const res = await fetch(`${base}/api/assignments/${encodeURIComponent(assignmentId)}/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Assignment action failed (${res.status}): ${errorText || res.statusText}`);
  }
  return await res.json();
}

export async function fetchAssignmentEvents(assignmentId) {
  const base = getBaseUrl();
  const res = await fetch(`${base}/api/assignments/${encodeURIComponent(assignmentId)}/events`, { cache: 'no-store' });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Fetch assignment events failed (${res.status}): ${errorText || res.statusText}`);
  }
  return await res.json();
}

export async function seedTeamsDemo() {
  const base = getBaseUrl();
  const res = await fetch(`${base}/api/teams/seed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Seed teams failed (${res.status}): ${errorText || res.statusText}`);
  }
  return await res.json();
}


// ===========================================================================
// Phase 4: Relief Intelligence API
// ===========================================================================

export async function fetchIntelligenceOverview() {
  const base = getBaseUrl();
  const res = await fetch(`${base}/api/intelligence/overview`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Intelligence overview failed (${res.status}): ${res.statusText}`);
  return await res.json();
}

export async function fetchIntelligencePriorities(filters = {}) {
  const base = getBaseUrl();
  const params = new URLSearchParams();
  if (filters.zone_id) params.append('zone_id', filters.zone_id);
  if (filters.severity) params.append('severity', filters.severity);
  if (filters.category) params.append('category', filters.category);
  if (filters.band) params.append('band', filters.band);
  if (filters.status) params.append('status', filters.status);
  const query = params.toString() ? `?${params.toString()}` : '';
  const res = await fetch(`${base}/api/intelligence/priorities${query}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Intelligence priorities failed (${res.status}): ${res.statusText}`);
  return await res.json();
}

export async function overrideRequestPriority(requestId, payload) {
  const base = getBaseUrl();
  const res = await fetch(`${base}/api/intelligence/requests/${encodeURIComponent(requestId)}/override-priority`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Priority override failed (${res.status}): ${errorText || res.statusText}`);
  }
  return await res.json();
}

export async function fetchIntelligenceZoneGaps(filters = {}) {
  const base = getBaseUrl();
  const params = new URLSearchParams();
  if (filters.zone_id) params.append('zone_id', filters.zone_id);
  if (filters.category) params.append('category', filters.category);
  if (filters.severity) params.append('severity', filters.severity);
  if (filters.start_date) params.append('start_date', filters.start_date);
  if (filters.end_date) params.append('end_date', filters.end_date);
  const query = params.toString() ? `?${params.toString()}` : '';
  const res = await fetch(`${base}/api/intelligence/zone-gaps${query}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Zone gaps fetch failed (${res.status}): ${res.statusText}`);
  return await res.json();
}

export async function fetchIntelligenceRecommendations() {
  const base = getBaseUrl();
  const res = await fetch(`${base}/api/intelligence/recommendations`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Recommendations fetch failed (${res.status}): ${res.statusText}`);
  return await res.json();
}

export async function fetchIntelligenceImpact() {
  const base = getBaseUrl();
  const res = await fetch(`${base}/api/intelligence/impact`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Impact fetch failed (${res.status}): ${res.statusText}`);
  return await res.json();
}

export async function seedIntelligenceDemo() {
  const base = getBaseUrl();
  const res = await fetch(`${base}/api/intelligence/seed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Seed intelligence failed (${res.status}): ${errorText || res.statusText}`);
  }
  return await res.json();
}

export function getIntelligenceExportUrl() {
  const base = getBaseUrl();
  return `${base}/api/intelligence/export`;
}
