/**
 * REST API Client for Hospital Mobility
 */
const BASE_URL = '/api';

export const apiClient = {
  // Patients
  async getPatients() {
    const res = await fetch(`${BASE_URL}/patients`);
    return await res.json();
  },

  async getPatient(id) {
    const res = await fetch(`${BASE_URL}/patients/${id}`);
    return await res.json();
  },

  // Alerts
  async getActiveAlerts() {
    const res = await fetch(`${BASE_URL}/alerts/active`);
    return await res.json();
  },

  async getAllAlerts(filters = {}) {
    const query = new URLSearchParams(filters).toString();
    const res = await fetch(`${BASE_URL}/alerts?${query}`);
    return await res.json();
  },

  async acknowledgeAlert(alertId, staffId, notes = '') {
    const res = await fetch(`${BASE_URL}/alerts/${alertId}/acknowledge`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ staffId, notes }),
    });
    return await res.json();
  },

  async resolveAlert(alertId, staffId, notes = '') {
    const res = await fetch(`${BASE_URL}/alerts/${alertId}/resolve`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ staffId, notes }),
    });
    return await res.json();
  },

  // Simulation Triggers
  async simulateWalk(patientId) {
    const res = await fetch(`${BASE_URL}/simulator/walk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patientId }),
    });
    return await res.json();
  },

  async simulateInactivity(patientId) {
    const res = await fetch(`${BASE_URL}/simulator/inactivity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patientId }),
    });
    return await res.json();
  },

  async simulateFall(patientId) {
    const res = await fetch(`${BASE_URL}/simulator/fall`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patientId }),
    });
    return await res.json();
  },

  async getSimulatorStatus() {
    const res = await fetch(`${BASE_URL}/simulator/status`);
    return await res.json();
  },

  async toggleAutoSimulation(enable) {
    const res = await fetch(`${BASE_URL}/simulator/auto-loop/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enable }),
    });
    return await res.json();
  },

  // Telemetry History
  async getTelemetryHistory(patientId, limit = 50) {
    const params = new URLSearchParams();
    if (patientId) params.append('patientId', patientId);
    if (limit) params.append('limit', limit);
    const res = await fetch(`${BASE_URL}/events/history?${params.toString()}`);
    return await res.json();
  },
};
