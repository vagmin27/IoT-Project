const eventRepository = require('../repositories/event.repository');
const patientRepository = require('../repositories/patient.repository');
const alertService = require('./alert.service');
const sseManager = require('../sockets/sse.manager');

const FALL_THRESHOLD = parseFloat(process.env.FALL_ACCEL_THRESHOLD) || 2.8;

class SensorService {
  /**
   * Ingest and evaluate incoming telemetry
   * Implements idempotency, fall heuristic, and strict inactivity policy
   */
  async ingestTelemetry(payload) {
    const { deviceId, patientId, sequenceNumber, timestamp, movementState, metrics } = payload;

    // 1. Idempotency Check: Reject duplicate packets
    const existing = await eventRepository.findByDeviceAndSequence(deviceId, sequenceNumber);
    if (existing) {
      console.warn(`[SensorService] Duplicate event discarded: deviceId=${deviceId}, sequence=${sequenceNumber}`);
      return {
        success: false,
        duplicate: true,
        message: 'Duplicate event sequence discarded',
        event: existing,
      };
    }

    // 2. Persist Sensor Event
    let sensorEvent;
    try {
      sensorEvent = await eventRepository.create({
        deviceId,
        patientId,
        sequenceNumber,
        timestamp: timestamp ? new Date(timestamp) : new Date(),
        movementState,
        metrics: {
          accelMagnitude: metrics?.accelMagnitude ?? 1.0,
          pitch: metrics?.pitch ?? 0,
          roll: metrics?.roll ?? 0,
        },
        processed: true,
      });
    } catch (createErr) {
      if (createErr.code === 11000) {
        console.warn(`[SensorService] Duplicate event caught via unique index: deviceId=${deviceId}, sequence=${sequenceNumber}`);
        const duplicateRecord = await eventRepository.findByDeviceAndSequence(deviceId, sequenceNumber);
        return {
          success: false,
          duplicate: true,
          message: 'Duplicate event sequence discarded',
          event: duplicateRecord,
        };
      }
      throw createErr;
    }

    // 3. Fall Detection Evaluation
    const isFallImpact =
      movementState === 'FALL_IMPACT' ||
      (metrics && metrics.accelMagnitude >= FALL_THRESHOLD);

    let generatedAlert = null;
    if (isFallImpact) {
      console.log(`[SensorService] CRITICAL FALL detected for patient ${patientId} (accel: ${metrics?.accelMagnitude}g)`);
      generatedAlert = await alertService.createFallAlert({
        patientId,
        deviceId,
        triggeredAt: sensorEvent.timestamp,
        notes: `Simulated fall impact registered: ${metrics?.accelMagnitude?.toFixed(2)} G`,
      });

      // Update patient status to STATIONARY after fall
      await patientRepository.updateMovementStatus(patientId, 'STATIONARY');
      sseManager.broadcast('patient_status_updated', {
        patientId,
        movementStatus: 'STATIONARY',
        timestamp: new Date(),
      });
    } else {
      // 4. Movement Status & Inactivity Policy Enforcement
      // Walking updates status to WALKING
      // Inactivity / Stationary updates status to STATIONARY
      // Strictly NO alert is generated for inactivity!
      const newStatus = movementState === 'WALKING' ? 'WALKING' : 'STATIONARY';
      const updatedPatient = await patientRepository.updateMovementStatus(patientId, newStatus);

      sseManager.broadcast('patient_status_updated', {
        patientId,
        movementStatus: newStatus,
        lastMovementUpdate: updatedPatient ? updatedPatient.lastMovementUpdate : new Date(),
      });
    }

    // 5. Broadcast live telemetry event over SSE
    sseManager.broadcast('sensor_event', {
      id: sensorEvent._id,
      deviceId,
      patientId,
      sequenceNumber,
      timestamp: sensorEvent.timestamp,
      movementState,
      metrics: sensorEvent.metrics,
      alertGenerated: !!generatedAlert,
    });

    return {
      success: true,
      duplicate: false,
      event: sensorEvent,
      alert: generatedAlert,
    };
  }

  async getRecentEventsForPatient(patientId, limit = 50) {
    return await eventRepository.findRecentByPatient(patientId, limit);
  }

  async getAllEvents(query = {}, limit = 100) {
    return await eventRepository.findAll(query, limit);
  }
}

module.exports = new SensorService();
