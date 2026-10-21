const sensorService = require('./sensor.service');
const patientRepository = require('../repositories/patient.repository');
const sseManager = require('../sockets/sse.manager');

class SimulatorService {
  constructor() {
    this.sequenceCounters = new Map(); // deviceId -> counter
    this.isAutoRunning = false; // Strictly disabled by default
    this.autoInterval = null;
    this.intervalMs = parseInt(process.env.AUTO_SIMULATION_INTERVAL_MS, 10) || 3000;
  }

  getNextSequence(deviceId) {
    const current = this.sequenceCounters.get(deviceId) || 0;
    const next = current + 1;
    this.sequenceCounters.set(deviceId, next);
    return next;
  }

  /**
   * Helper to ensure deviceId and patient exist
   */
  async resolvePatientAndDevice(patientId) {
    let patient;
    if (patientId) {
      patient = await patientRepository.findById(patientId);
    }
    if (!patient) {
      // Pick first admitted patient with a device
      const patients = await patientRepository.findAll({ status: 'ADMITTED' });
      patient = patients.find((p) => p.assignedDeviceId) || patients[0];
    }
    if (!patient) {
      throw new Error('No admitted patient found to simulate telemetry for');
    }

    const deviceId = patient.assignedDeviceId || 'SIM-TAG-DEFAULT';
    return { patient, deviceId };
  }

  /**
   * Scenario 1: Manual Walking Simulation (Deterministic)
   * Produces rhythmic movement (accel magnitude ~ 1.15G)
   */
  async simulateWalk(patientId) {
    const { patient, deviceId } = await this.resolvePatientAndDevice(patientId);
    const sequenceNumber = this.getNextSequence(deviceId);

    const payload = {
      deviceId,
      patientId: patient._id,
      sequenceNumber,
      timestamp: new Date(),
      movementState: 'WALKING',
      metrics: {
        accelMagnitude: 1.18, // Normal rhythmic walking acceleration
        pitch: 12.5,
        roll: -4.2,
      },
    };

    return await sensorService.ingestTelemetry(payload);
  }

  /**
   * Scenario 2: Manual Inactivity Simulation (Deterministic)
   * Produces motionless readings; updates status badge to STATIONARY only, NO alert!
   */
  async simulateInactivity(patientId) {
    const { patient, deviceId } = await this.resolvePatientAndDevice(patientId);
    const sequenceNumber = this.getNextSequence(deviceId);

    const payload = {
      deviceId,
      patientId: patient._id,
      sequenceNumber,
      timestamp: new Date(),
      movementState: 'STATIONARY',
      metrics: {
        accelMagnitude: 0.98, // Static 1G gravity with zero dynamic variance
        pitch: 0.5,
        roll: 0.2,
      },
    };

    return await sensorService.ingestTelemetry(payload);
  }

  /**
   * Scenario 3: Manual Fall Simulation (Deterministic)
   * Produces high-G impact spike (3.85G) followed by immobility; triggers CRITICAL alert!
   */
  async simulateFall(patientId) {
    const { patient, deviceId } = await this.resolvePatientAndDevice(patientId);
    const sequenceNumber = this.getNextSequence(deviceId);

    const payload = {
      deviceId,
      patientId: patient._id,
      sequenceNumber,
      timestamp: new Date(),
      movementState: 'FALL_IMPACT',
      metrics: {
        accelMagnitude: 3.85, // Sharp high-G impact spike exceeding 2.8G threshold
        pitch: 78.4,
        roll: -84.1,
      },
    };

    return await sensorService.ingestTelemetry(payload);
  }

  /**
   * Toggle automatic background simulation loop
   */
  async toggleAutoSimulation(enable) {
    if (enable === undefined) {
      this.isAutoRunning = !this.isAutoRunning;
    } else {
      this.isAutoRunning = Boolean(enable);
    }

    if (this.isAutoRunning) {
      this.startAutoLoop();
    } else {
      this.stopAutoLoop();
    }

    sseManager.broadcast('simulator_status', {
      isAutoRunning: this.isAutoRunning,
      intervalMs: this.intervalMs,
      timestamp: new Date(),
    });

    return {
      isAutoRunning: this.isAutoRunning,
      intervalMs: this.intervalMs,
    };
  }

  startAutoLoop() {
    if (this.autoInterval) clearInterval(this.autoInterval);

    console.log(`[Simulator] Starting background simulation loop (interval: ${this.intervalMs}ms)`);
    this.autoInterval = setInterval(async () => {
      try {
        const patients = await patientRepository.findAll({ status: 'ADMITTED' });
        if (patients.length === 0) return;

        // Pick a patient randomly
        const patient = patients[Math.floor(Math.random() * patients.length)];
        const deviceId = patient.assignedDeviceId || 'SIM-TAG-AUTO';
        const sequenceNumber = this.getNextSequence(deviceId);

        // 80% walking, 20% stationary
        const isWalk = Math.random() < 0.8;
        const movementState = isWalk ? 'WALKING' : 'STATIONARY';
        const accelMagnitude = isWalk ? Number((1.05 + Math.random() * 0.25).toFixed(2)) : 0.98;

        await sensorService.ingestTelemetry({
          deviceId,
          patientId: patient._id,
          sequenceNumber,
          timestamp: new Date(),
          movementState,
          metrics: {
            accelMagnitude,
            pitch: Number((Math.random() * 20 - 10).toFixed(1)),
            roll: Number((Math.random() * 20 - 10).toFixed(1)),
          },
        });
      } catch (err) {
        console.error(`[Simulator] Auto-loop error: ${err.message}`);
      }
    }, this.intervalMs);
  }

  stopAutoLoop() {
    if (this.autoInterval) {
      clearInterval(this.autoInterval);
      this.autoInterval = null;
    }
    console.log('[Simulator] Background simulation loop stopped.');
  }

  getStatus() {
    return {
      isAutoRunning: this.isAutoRunning,
      intervalMs: this.intervalMs,
      activeCounters: Object.fromEntries(this.sequenceCounters),
    };
  }
}

module.exports = new SimulatorService();
