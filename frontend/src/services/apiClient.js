/**
 * REST API Client for Hospital Mobility with JWT Authentication Support
 */
export const API_HOST = import.meta.env.VITE_API_URL
  ? import.meta.env.VITE_API_URL.replace(/\/+$/, '')
  : '';
const BASE_URL = `${API_HOST}/api`;

let authToken = localStorage.getItem('hospital_mobility_token') || null;

export const setAuthToken = (token) => {
  authToken = token;
  if (token) {
    localStorage.setItem('hospital_mobility_token', token);
  } else {
    localStorage.removeItem('hospital_mobility_token');
  }
};

export const getAuthToken = () => authToken;

export const clearAuthToken = () => {
  authToken = null;
  localStorage.removeItem('hospital_mobility_token');
};

async function customFetch(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const response = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers,
    credentials: 'include', // Include HTTP-only cookies
  });

  // Handle unauthorized responses
  if (response.status === 401 && !endpoint.includes('/auth/login')) {
    clearAuthToken();
    window.dispatchEvent(new CustomEvent('auth:expired'));
  }

  return await response.json();
}

export const apiClient = {
  // Authentication
  async login(credentials) {
    const res = await customFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials),
    });
    if (res && res.success && res.token) {
      setAuthToken(res.token);
    }
    return res;
  },

  async logout() {
    try {
      await customFetch('/auth/logout', { method: 'POST' });
    } finally {
      clearAuthToken();
    }
    return { success: true };
  },

  async getMe() {
    return await customFetch('/auth/me');
  },

  // Staff Management (ADMIN only)
  async getStaff() {
    return await customFetch('/staff');
  },

  async getStaffMember(id) {
    return await customFetch(`/staff/${id}`);
  },

  async createStaff(data) {
    return await customFetch('/staff', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateStaff(id, data) {
    return await customFetch(`/staff/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async updateStaffStatus(id, status) {
    return await customFetch(`/staff/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  },

  // Patients
  async getPatients(filters = {}) {
    const query = new URLSearchParams(filters).toString();
    const endpoint = query ? `/patients?${query}` : '/patients';
    return await customFetch(endpoint);
  },

  async getPatient(id) {
    return await customFetch(`/patients/${id}`);
  },

  async createPatient(data) {
    return await customFetch('/patients', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updatePatient(id, data) {
    return await customFetch(`/patients/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async assignNurse(patientId, nurseId) {
    return await customFetch(`/patients/${patientId}/assign-nurse`, {
      method: 'PATCH',
      body: JSON.stringify({ nurseId }),
    });
  },

  async dischargePatient(patientId) {
    return await customFetch(`/patients/${patientId}/discharge`, {
      method: 'PATCH',
    });
  },

  // Locations
  async getLocations(filters = {}) {
    const query = new URLSearchParams(filters).toString();
    const endpoint = query ? `/locations?${query}` : '/locations';
    return await customFetch(endpoint);
  },

  async getPatientLocationHistory(patientId, limit = 100) {
    const params = new URLSearchParams();
    if (limit) params.append('limit', limit);
    return await customFetch(`/locations/patient/${patientId}?${params.toString()}`);
  },

  async getPatientCurrentLocation(patientId) {
    return await customFetch(`/locations/patient/${patientId}/current`);
  },

  async recordLocation(data) {
    return await customFetch('/locations', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async getWardLocations(wardId = 'WARD-3B') {
    return await customFetch(`/locations/ward/${encodeURIComponent(wardId)}`);
  },

  // Devices
  async getDevices(filters = {}) {
    const query = new URLSearchParams(filters).toString();
    const endpoint = query ? `/devices?${query}` : '/devices';
    return await customFetch(endpoint);
  },

  async getDeviceOverview() {
    return await customFetch('/devices/overview');
  },

  async getDevice(id) {
    return await customFetch(`/devices/${id}`);
  },

  async registerDevice(deviceData) {
    return await customFetch('/devices', {
      method: 'POST',
      body: JSON.stringify(deviceData),
    });
  },

  async updateDevice(id, data) {
    return await customFetch(`/devices/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  async assignDevice(deviceId, patientId) {
    return await customFetch(`/devices/${deviceId}/assign`, {
      method: 'PATCH',
      body: JSON.stringify({ patientId }),
    });
  },

  async unassignDevice(deviceId) {
    return await customFetch(`/devices/${deviceId}/unassign`, {
      method: 'PATCH',
    });
  },

  // Alerts
  async getActiveAlerts() {
    return await customFetch('/alerts/active');
  },

  async getAllAlerts(filters = {}) {
    const query = new URLSearchParams(filters).toString();
    const endpoint = query ? `/alerts?${query}` : '/alerts';
    return await customFetch(endpoint);
  },

  async acknowledgeAlert(alertId, staffId, notes = '') {
    return await customFetch(`/alerts/${alertId}/acknowledge`, {
      method: 'PATCH',
      body: JSON.stringify({ staffId, notes }),
    });
  },

  async resolveAlert(alertId, staffId, notes = '') {
    return await customFetch(`/alerts/${alertId}/resolve`, {
      method: 'PATCH',
      body: JSON.stringify({ staffId, notes }),
    });
  },

  // Simulation Triggers
  async simulateWalk(patientId) {
    return await customFetch('/simulator/walk', {
      method: 'POST',
      body: JSON.stringify({ patientId }),
    });
  },

  async simulateStand(patientId) {
    return await customFetch('/simulator/stand', {
      method: 'POST',
      body: JSON.stringify({ patientId }),
    });
  },

  async simulateSit(patientId) {
    return await customFetch('/simulator/sit', {
      method: 'POST',
      body: JSON.stringify({ patientId }),
    });
  },

  async simulateSuddenMovement(patientId) {
    return await customFetch('/simulator/sudden-movement', {
      method: 'POST',
      body: JSON.stringify({ patientId }),
    });
  },

  async simulateInactivity(patientId) {
    return await customFetch('/simulator/inactivity', {
      method: 'POST',
      body: JSON.stringify({ patientId }),
    });
  },

  async simulateFreeFall(patientId) {
    return await customFetch('/simulator/free-fall', {
      method: 'POST',
      body: JSON.stringify({ patientId }),
    });
  },

  async simulateImpact(patientId) {
    return await customFetch('/simulator/impact', {
      method: 'POST',
      body: JSON.stringify({ patientId }),
    });
  },

  async simulateImpactOnly(patientId) {
    return await customFetch('/simulator/impact-only', {
      method: 'POST',
      body: JSON.stringify({ patientId }),
    });
  },

  async simulateOrientationChange(patientId) {
    return await customFetch('/simulator/orientation-change', {
      method: 'POST',
      body: JSON.stringify({ patientId }),
    });
  },

  async simulatePostImpactInactivity(patientId, durationSec = 10) {
    return await customFetch('/simulator/post-impact-inactivity', {
      method: 'POST',
      body: JSON.stringify({ patientId, durationSec }),
    });
  },

  async simulateCompleteFall(patientId) {
    return await customFetch('/simulator/complete-fall', {
      method: 'POST',
      body: JSON.stringify({ patientId }),
    });
  },

  async simulateFallAndRecover(patientId) {
    return await customFetch('/simulator/fall-and-recover', {
      method: 'POST',
      body: JSON.stringify({ patientId }),
    });
  },

  async simulateFall(patientId) {
    return await customFetch('/simulator/fall', {
      method: 'POST',
      body: JSON.stringify({ patientId }),
    });
  },

  async simulateSensorDisconnection(patientId) {
    return await customFetch('/simulator/fault/disconnect', {
      method: 'POST',
      body: JSON.stringify({ patientId }),
    });
  },

  async simulateAbnormalValues(patientId) {
    return await customFetch('/simulator/fault/abnormal-values', {
      method: 'POST',
      body: JSON.stringify({ patientId }),
    });
  },

  async simulateCommInterruption(patientId) {
    return await customFetch('/simulator/fault/comm-interruption', {
      method: 'POST',
      body: JSON.stringify({ patientId }),
    });
  },

  async simulateFaultRecovery(patientId, faultType = null) {
    return await customFetch('/simulator/fault/recover', {
      method: 'POST',
      body: JSON.stringify({ patientId, faultType }),
    });
  },

  async getSimulatorStatus() {
    return await customFetch('/simulator/status');
  },

  async toggleAutoSimulation(enable) {
    return await customFetch('/simulator/auto-loop/toggle', {
      method: 'POST',
      body: JSON.stringify({ enable }),
    });
  },

  // Telemetry & Unified History
  async getTelemetryHistory(patientId, limit = 50) {
    const params = new URLSearchParams();
    if (patientId) params.append('patientId', patientId);
    if (limit) params.append('limit', limit);
    return await customFetch(`/events/history?${params.toString()}`);
  },

  async getUnifiedHistory(filters = {}) {
    const params = new URLSearchParams(filters);
    return await customFetch(`/events/unified-history?${params.toString()}`);
  },

  // Health and DB connectivity
  async getHealth() {
    return await customFetch('/health');
  },

  // USB Serial Hardware Integration
  async getSerialStatus() {
    return await customFetch('/serial/status');
  },

  async getSerialHistory(limit = 100) {
    return await customFetch(`/serial/history?limit=${limit}`);
  },

  async getSerialFaults(deviceId = 'ARDUINO-PIEZO-01', activeOnly = true) {
    const params = new URLSearchParams();
    if (activeOnly !== undefined && activeOnly !== null) {
      params.append('activeOnly', activeOnly ? 'true' : 'false');
    }
    if (deviceId) {
      params.append('deviceId', deviceId);
    }
    const qs = params.toString() ? `?${params.toString()}` : '';
    return await customFetch(`/serial/faults${qs}`);
  },

  async reconnectSerial() {
    return await customFetch('/serial/reconnect', {
      method: 'POST',
    });
  },

  // Audit Logs (ADMIN only)
  async getAuditLogs(filters = {}) {
    const params = new URLSearchParams(filters);
    return await customFetch(`/audit-logs?${params.toString()}`);
  },
};
