const alertRepository = require('../repositories/alert.repository');
const patientRepository = require('../repositories/patient.repository');
const sseManager = require('../sockets/sse.manager');

class AlertService {
  /**
   * Create a critical fall alert
   */
  async createFallAlert({ patientId, deviceId, triggeredAt = new Date(), notes = 'Automated fall impact detected' }) {
    const patient = await patientRepository.findById(patientId);

    const alertData = {
      patientId,
      deviceId,
      patientName: patient ? patient.name : 'Unknown Patient',
      roomNumber: patient ? patient.roomNumber : 'Unknown Room',
      bedNumber: patient ? patient.bedNumber : 'Unknown Bed',
      alertType: 'FALL_DETECTED',
      severity: 'CRITICAL',
      status: 'ACTIVE',
      triggeredAt,
      notes,
    };

    const alert = await alertRepository.create(alertData);

    // Broadcast critical alert immediately over SSE
    sseManager.broadcast('alert_created', alert);

    return alert;
  }

  /**
   * Acknowledge an active alert
   */
  async acknowledgeAlert(alertId, staffId, notes = '') {
    const alert = await alertRepository.acknowledge(alertId, staffId, notes);
    if (!alert) {
      throw new Error(`Alert not found: ${alertId}`);
    }

    // Broadcast update over SSE
    sseManager.broadcast('alert_updated', alert);
    return alert;
  }

  /**
   * Resolve an alert
   */
  async resolveAlert(alertId, staffId, notes = '') {
    const alert = await alertRepository.resolve(alertId, staffId, notes);
    if (!alert) {
      throw new Error(`Alert not found: ${alertId}`);
    }

    // Broadcast update over SSE
    sseManager.broadcast('alert_updated', alert);
    return alert;
  }

  async getActiveAlerts() {
    return await alertRepository.findActive();
  }

  async getAllAlerts(filters = {}) {
    return await alertRepository.findAll(filters);
  }

  async getAlertById(id) {
    return await alertRepository.findById(id);
  }
}

module.exports = new AlertService();
