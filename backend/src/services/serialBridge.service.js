const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const piezoEventRepository = require('../repositories/piezoEvent.repository');
const deviceRepository = require('../repositories/device.repository');
const patientRepository = require('../repositories/patient.repository');
const Device = require('../models/Device');
const sseManager = require('../sockets/sse.manager');
const hardwareFaultService = require('./hardwareFault.service');

class SerialBridgeService {
  constructor(options = {}) {
    this.SerialPortClass = options.SerialPort || SerialPort;
    this.ReadlineParserClass = options.ReadlineParser || ReadlineParser;

    this.portName = options.portName || process.env.SERIAL_PORT || 'COM5';
    this.baudRate = options.baudRate || parseInt(process.env.SERIAL_BAUD_RATE, 10) || 9600;
    this.deviceCode = options.deviceCode || process.env.SERIAL_DEVICE_CODE || 'ARDUINO-PIEZO-01';
    this.reconnectIntervalMs =
      options.reconnectIntervalMs || parseInt(process.env.SERIAL_RECONNECT_INTERVAL_MS, 10) || 5000;

    this.port = null;
    this.parser = null;
    this.status = 'DISCONNECTED'; // 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'ERROR'
    this.lastError = null;
    this.lastReceivedAt = null;
    this.lastSequenceNumber = null;
    this.lastMovementCount = 0;
    this.lastMovementDetectedAt = null;
    this.lastPiezoActivity = 'UNKNOWN'; // 'MOVEMENT_DETECTED' | 'NO_RECENT_MOVEMENT' | 'UNKNOWN'
    this.lastSensorStatus = null; // 'ACTIVE' | 'INACTIVE' | 'SENSOR_CHECK'
    this.lastDiagnostic = null;
    this.gatewayWatchdogTimer = null;
    this.gatewayWatchdogGeneration = 0;
    this.gatewayWatchdogTimeoutMs = options.gatewayWatchdogTimeoutMs || 12000;
    this.reconnectTimer = null;
    this.packetWatchdogTimer = null;
    this.packetWatchdogGeneration = 0;

    this.isStopped = false;

    this.stats = {
      totalPacketsReceived: 0,
      validPackets: 0,
      droppedPackets: 0,
      duplicatePackets: 0,
    };

    // Dedicated Laptop Gateway Tracking (distinct from server's local serial port)
    this.gateway = {
      connected: false,
      lastSeen: null,
      arduinoSerialStatus: 'DISCONNECTED',
      port: null,
      baudRate: null,
      packetsForwarded: 0,
    };
  }

  /**
   * Ensure the Arduino device is registered in MongoDB
   */
  async ensureDeviceRegistered() {
    try {
      const existing = await deviceRepository.findByCode(this.deviceCode);
      if (!existing) {
        let defaultPatientId = null;
        try {
          const Patient = require('../models/Patient');
          const defaultPatient = await Patient.findOne({ name: { $regex: /Eleanor/i } });
          if (defaultPatient) defaultPatientId = defaultPatient._id;
        } catch {}

        await Device.create({
          deviceCode: this.deviceCode,
          batteryLevel: 100,
          status: 'ACTIVE',
          assignedPatientId: defaultPatientId,
          lastHeartbeat: new Date(),
        });
        console.log(`[SerialBridge] Registered default device record for ${this.deviceCode} (patient: ${defaultPatientId || 'unassigned'})`);
      }
    } catch (err) {
      console.warn(`[SerialBridge] Device registration check: ${err.message}`);
    }
  }

  /**
   * Restore latest telemetry state from database on boot
   */
  async restoreLatestState() {
    try {
      const latest = await piezoEventRepository.getLatestForDevice(this.deviceCode);
      if (latest) {
        this.lastReceivedAt = latest.timestamp;
        this.lastSequenceNumber = latest.sequenceNumber;
        this.lastMovementCount = latest.movementCount;
        this.lastSensorStatus = latest.status;
        if (latest.status === 'ACTIVE') {
          this.lastPiezoActivity =
            latest.event === 'MOVEMENT'
              ? 'MOVEMENT_DETECTED'
              : latest.event === 'INACTIVITY'
              ? 'NO_RECENT_MOVEMENT'
              : this.lastPiezoActivity;
        }
      }

      const latestMovement = await piezoEventRepository.getLatestMovementForDevice(this.deviceCode);
      if (latestMovement) {
        this.lastMovementDetectedAt = latestMovement.timestamp;
      }
    } catch (err) {
      console.warn(`[SerialBridge] State restoration note: ${err.message}`);
    }
  }

  /**
   * Start serial bridge listener
   */
  async start() {
    this.isStopped = false;

    // Always ensure the device is registered in MongoDB and restore latest state on boot
    await this.ensureDeviceRegistered();
    await this.restoreLatestState();

    if (this.status === 'CONNECTED' || this.status === 'CONNECTING') {
      console.log(`[SerialBridge] Already ${this.status}. Ignoring start request.`);
      return this.getStatus();
    }

    const isEnabled = process.env.SERIAL_ENABLED === 'true';
    if (!isEnabled && process.env.NODE_ENV !== 'test') {
      console.log('[SerialBridge] Hardware serial bridge disabled by configuration (SERIAL_ENABLED=false).');
      return this.getStatus();
    }

    return await this.connect();
  }

  /**
   * Internal connection routine
   */
  connect() {
    if (this.isStopped) return Promise.resolve(false);

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.status = 'CONNECTING';
    console.log(`[SerialBridge] Attempting connection to ${this.portName} at ${this.baudRate} baud...`);
    sseManager.broadcast('serial_status', this.getStatusPayload());

    return new Promise((resolve) => {
      try {
        this.port = new this.SerialPortClass({
          path: this.portName,
          baudRate: this.baudRate,
          autoOpen: false,
        });

        this.port.open((err) => {
          if (err) {
            this.handlePortError(err);
            resolve(false);
            return;
          }

          this.status = 'CONNECTED';
          this.lastError = null;
          console.log(`[SerialBridge] Successfully connected to Arduino on ${this.portName} @ ${this.baudRate} baud.`);

          hardwareFaultService.recordRecovery(this.deviceCode, 'SERIAL_COMM_FAILURE', 'Serial port connected successfully')
            .catch((err) => console.error('[SerialBridge] Error recovering SERIAL_COMM_FAILURE on open:', err.message));

          this.resetPacketWatchdog();

          sseManager.broadcast('serial_status', this.getStatusPayload());

          this.parser = this.port.pipe(new this.ReadlineParserClass({ delimiter: '\r\n' }));
          this.parser.on('data', (line) => {
            this.handleIncomingLine(line).catch((err) => {
              console.error('[SerialBridge] Error handling incoming serial data:', err.message);
            });
          });

          this.port.on('close', (closeErr) => {
            console.warn(`[SerialBridge] Serial port ${this.portName} closed: ${closeErr ? closeErr.message : 'Clean close'}`);
            this.cleanupPort();
            this.status = 'DISCONNECTED';
            hardwareFaultService.recordFault({
              deviceId: this.deviceCode,
              faultType: 'SENSOR_DISCONNECTED',
              severity: 'CRITICAL',
              details: closeErr ? closeErr.message : 'Serial connection closed',
            }).catch((err) => console.error('[SerialBridge] Error recording SENSOR_DISCONNECTED on close:', err.message));
            sseManager.broadcast('serial_status', this.getStatusPayload());
            if (!this.isStopped) {
              this.scheduleReconnect();
            }
          });

          this.port.on('error', (portErr) => {
            this.handlePortError(portErr);
          });

          resolve(true);
        });
      } catch (err) {
        this.handlePortError(err);
        resolve(false);
      }
    });
  }

  resetPacketWatchdog() {
    this.cleanupWatchdog();
    const generation = ++this.packetWatchdogGeneration;

    const timer = setTimeout(async () => {
      if (
        this.isStopped ||
        this.packetWatchdogGeneration !== generation ||
        this.packetWatchdogTimer !== timer
      ) {
        return;
      }

      if (this.status === 'CONNECTED') {
        try {
          await hardwareFaultService.recordFault({
            deviceId: this.deviceCode,
            faultType: 'MISSING_PACKETS',
            severity: 'WARNING',
            details: 'Telemetry packets stopped arriving (heartbeat timeout > 3500ms)',
          });
        } catch (err) {
          console.error('[SerialBridge] Error recording packet watchdog fault:', err.message);
        }
      }
    }, 3500);

    this.packetWatchdogTimer = timer;

    if (this.packetWatchdogTimer.unref) {
      this.packetWatchdogTimer.unref();
    }
  }

  cleanupWatchdog() {
    this.packetWatchdogGeneration++;
    if (this.packetWatchdogTimer) {
      clearTimeout(this.packetWatchdogTimer);
      this.packetWatchdogTimer = null;
    }
  }

  resetGatewayWatchdog() {
    this.cleanupGatewayWatchdog();
    const generation = ++this.gatewayWatchdogGeneration;

    const timer = setTimeout(async () => {
      // Race protection: ignore if stopped or cancelled/superseded by a newer generation or timer
      if (
        this.isStopped ||
        this.gatewayWatchdogGeneration !== generation ||
        this.gatewayWatchdogTimer !== timer
      ) {
        return;
      }

      // Elapsed check: verify that gateway has indeed been silent for >= timeout
      if (this.gateway.lastSeen) {
        const elapsed = Date.now() - new Date(this.gateway.lastSeen).getTime();
        if (elapsed < this.gatewayWatchdogTimeoutMs) {
          return;
        }
      }

      this.gateway.connected = false;

      try {
        await hardwareFaultService.recordFault({
          deviceId: this.deviceCode,
          faultType: 'MISSING_PACKETS',
          severity: 'WARNING',
          details: `Gateway heartbeat expired: Telemetry and heartbeats stopped arriving from laptop gateway (>${Math.round(this.gatewayWatchdogTimeoutMs / 1000)}s)`,
        });
      } catch (err) {
        console.error('[SerialBridge] Error recording gateway expiration fault:', err.message);
      }

      sseManager.broadcast('gateway_status', this.getGatewayStatus());
    }, this.gatewayWatchdogTimeoutMs);

    this.gatewayWatchdogTimer = timer;

    if (this.gatewayWatchdogTimer.unref) {
      this.gatewayWatchdogTimer.unref();
    }
  }

  cleanupGatewayWatchdog() {
    this.gatewayWatchdogGeneration++;
    if (this.gatewayWatchdogTimer) {
      clearTimeout(this.gatewayWatchdogTimer);
      this.gatewayWatchdogTimer = null;
    }
  }

  handlePortError(err) {
    const errorMsg = err?.message || 'Unknown serial port error';
    console.error(`[SerialBridge] Port error on ${this.portName}: ${errorMsg}`);
    this.status = 'ERROR';
    this.lastError = errorMsg;
    hardwareFaultService.recordFault({
      deviceId: this.deviceCode,
      faultType: 'SERIAL_COMM_FAILURE',
      severity: 'CRITICAL',
      details: errorMsg,
    }).catch((fErr) => console.error('[SerialBridge] Error recording port error fault:', fErr.message));
    this.cleanupPort();
    sseManager.broadcast('serial_status', this.getStatusPayload());

    if (!this.isStopped) {
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (this.isStopped || this.reconnectTimer) return;

    console.log(`[SerialBridge] Will retry connection to ${this.portName} in ${this.reconnectIntervalMs}ms...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.isStopped) {
        this.connect();
      }
    }, this.reconnectIntervalMs);

    if (this.reconnectTimer.unref) {
      this.reconnectTimer.unref();
    }
  }

  cleanupPort() {
    this.cleanupWatchdog();
    if (this.parser) {
      try {
        this.parser.removeAllListeners();
      } catch {}
      this.parser = null;
    }
    if (this.port) {
      try {
        this.port.removeAllListeners();
        if (this.port.isOpen) {
          this.port.close();
        }
      } catch {}
      this.port = null;
    }
  }

  /**
   * Stop serial bridge cleanly
   */
  async stop() {
    this.isStopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.cleanupWatchdog();
    this.cleanupGatewayWatchdog();

    return new Promise((resolve) => {
      if (this.port && this.port.isOpen) {
        this.port.close((err) => {
          this.cleanupPort();
          this.status = 'DISCONNECTED';
          console.log('[SerialBridge] Serial bridge stopped cleanly.');
          sseManager.broadcast('serial_status', this.getStatusPayload());
          resolve();
        });
      } else {
        this.cleanupPort();
        this.status = 'DISCONNECTED';
        resolve();
      }
    });
  }

  /**
   * Explicit reconnect trigger (e.g. from admin API)
   */
  async reconnect() {
    if (this.status === 'CONNECTING') {
      const err = new Error('Serial bridge is already in the process of connecting');
      err.statusCode = 409;
      throw err;
    }

    await this.stop();
    await this.start();
    return this.getStatus();
  }

  /**
   * Core line parser and message router
   */
  async handleIncomingLine(rawLine) {
    if (this.isStopped) return null;
    if (!rawLine || typeof rawLine !== 'string') return null;

    const line = rawLine.trim();
    if (!line) return null;

    this.stats.totalPacketsReceived += 1;

    // Check for startup and diagnostic control messages
    if (
      line.includes('HOSPITAL_MOBILITY_SYSTEM') ||
      line.includes('CALIBRATION_STARTED') ||
      line.includes('CALIBRATION_COMPLETED') ||
      line.includes('SENSOR_READY') ||
      line.includes('SENSOR_SIGNAL_CHECK_REQUIRED')
    ) {
      this.lastDiagnostic = line;
      console.log(`[SerialBridge] Hardware diagnostic message: ${line}`);

      if (line.includes('SENSOR_SIGNAL_CHECK_REQUIRED')) {
        this.lastSensorStatus = 'SENSOR_CHECK';
        await hardwareFaultService.recordFault({
          deviceId: this.deviceCode,
          faultType: 'SENSOR_SATURATED',
          severity: 'WARNING',
          details: 'Piezo sensor upper rail saturation detected by firmware diagnostic window',
        });
        sseManager.broadcast('serial_diagnostic', {
          type: 'SENSOR_SIGNAL_CHECK_REQUIRED',
          message: 'Piezo sensor signal check required. Verify physical probe placement and wiring.',
          timestamp: new Date(),
        });
      } else if (line.includes('SENSOR_READY')) {
        // Firmware emits SENSOR_READY when upper-rail saturation is absent (recovering from SENSOR_SATURATED).
        // Firmware does not perform physical continuity/presence validation, so SENSOR_DISCONNECTED is not recovered here.
        await hardwareFaultService.recordRecovery(this.deviceCode, 'SENSOR_SATURATED', 'Sensor returned to normal operating voltage');
      }
      return null;
    }

    // Ignore CSV headers if any
    if (
      line.startsWith('DATA,SEQUENCE') ||
      line.startsWith('TYPE,SEQUENCE') ||
      line.startsWith('TYPE,')
    ) {
      return null;
    }

    // Telemetry must begin with DATA,
    if (!line.startsWith('DATA,')) {
      this.stats.droppedPackets += 1;
      return null;
    }

    // Expected format: DATA,SEQUENCE,TIME_MS,RAW,BASELINE,DEVIATION,THRESHOLD,MOVEMENT_COUNT,EVENT,STATUS
    const parts = line.split(',');
    if (parts.length !== 10) {
      console.warn(`[SerialBridge] Malformed packet (expected 10 fields, received ${parts.length}): ${line}`);
      this.stats.droppedPackets += 1;
      return null;
    }

    const [
      ,
      rawSeq,
      rawTimeMs,
      rawSensorVal,
      rawBaseline,
      rawDeviation,
      rawThreshold,
      rawCount,
      rawEvent,
      rawStatus,
    ] = parts;

    // Validate numeric fields
    const sequenceNumber = parseInt(rawSeq, 10);
    const arduinoTimeMs = parseInt(rawTimeMs, 10);
    const raw = parseFloat(rawSensorVal);
    const baseline = parseFloat(rawBaseline);
    const deviation = parseFloat(rawDeviation);
    const threshold = parseFloat(rawThreshold);
    const movementCount = parseInt(rawCount, 10);

    if (
      isNaN(sequenceNumber) || sequenceNumber < 0 ||
      isNaN(arduinoTimeMs) || arduinoTimeMs < 0 ||
      isNaN(raw) || !isFinite(raw) ||
      isNaN(baseline) || !isFinite(baseline) ||
      isNaN(deviation) || !isFinite(deviation) ||
      isNaN(threshold) || !isFinite(threshold) ||
      isNaN(movementCount) || movementCount < 0
    ) {
      console.warn(`[SerialBridge] Discarded packet with invalid numeric data: ${line}`);
      this.stats.droppedPackets += 1;
      await hardwareFaultService.recordFault({
        deviceId: this.deviceCode,
        faultType: 'INVALID_READINGS',
        severity: 'WARNING',
        details: 'Packet contained non-numeric or malformed telemetry: ' + line,
      });
      return null;
    }

    // Check for out-of-range ADC reading (0-1023 for 10-bit ADC)
    if (raw < 0 || raw > 1023) {
      console.warn(`[SerialBridge] Discarded packet with out-of-range ADC value (${raw}): ${line}`);
      this.stats.droppedPackets += 1;
      await hardwareFaultService.recordFault({
        deviceId: this.deviceCode,
        faultType: 'INVALID_READINGS',
        severity: 'WARNING',
        details: `ADC raw value out of 10-bit range: ${raw}`,
      });
      return null;
    }

    // Validate enums
    const event = rawEvent.trim().toUpperCase();
    const status = rawStatus.trim().toUpperCase();

    if (!['MOVEMENT', 'INACTIVITY', 'NONE'].includes(event)) {
      console.warn(`[SerialBridge] Invalid event '${event}' in packet: ${line}`);
      this.stats.droppedPackets += 1;
      return null;
    }

    if (!['ACTIVE', 'INACTIVE', 'SENSOR_CHECK'].includes(status)) {
      console.warn(`[SerialBridge] Invalid status '${status}' in packet: ${line}`);
      this.stats.droppedPackets += 1;
      return null;
    }

    // Valid telemetry packet received: recover missing packets fault and reset watchdog
    this.resetPacketWatchdog();
    await hardwareFaultService.recordRecovery(this.deviceCode, 'MISSING_PACKETS', 'Fresh telemetry data received from Arduino');
    await hardwareFaultService.recordRecovery(this.deviceCode, 'INVALID_READINGS', 'Valid numeric telemetry readings received and verified');
    await hardwareFaultService.recordRecovery(this.deviceCode, 'SERIAL_COMM_FAILURE', 'Valid telemetry successfully received from Arduino');

    // Check duplicate sequence number
    const existing = await piezoEventRepository.findByDeviceAndSequence(this.deviceCode, sequenceNumber);
    if (existing) {
      console.warn(`[SerialBridge] Duplicate sequence ${sequenceNumber} discarded for device ${this.deviceCode}`);
      this.stats.duplicatePackets += 1;
      return { duplicate: true };
    }

    // Look up device and associated patient (with defensive registration guarantee)
    let device = null;
    try {
      device = await deviceRepository.findByCode(this.deviceCode);
      if (!device) {
        await this.ensureDeviceRegistered();
        device = await deviceRepository.findByCode(this.deviceCode);
      }
    } catch {}

    const patientId = device?.assignedPatientId
      ? (device.assignedPatientId._id || device.assignedPatientId)
      : null;

    // Persist genuine piezo telemetry
    let savedRecord = null;
    try {
      savedRecord = await piezoEventRepository.create({
        deviceId: this.deviceCode,
        patientId,
        sequenceNumber,
        arduinoTimeMs,
        raw,
        baseline,
        deviation,
        threshold,
        movementCount,
        event,
        status,
        timestamp: new Date(),
      });
    } catch (err) {
      if (err.code === 11000) {
        this.stats.duplicatePackets += 1;
        return { duplicate: true };
      }
      console.error(`[SerialBridge] Failed to save PiezoEvent: ${err.message}`);
      throw err;
    }

    // Update device heartbeat
    try {
      await deviceRepository.updateHeartbeat(this.deviceCode);
    } catch {}

    // Update stats and state
    this.stats.validPackets += 1;
    this.lastReceivedAt = new Date();
    this.lastSequenceNumber = sequenceNumber;
    this.lastMovementCount = movementCount;
    this.lastSensorStatus = status;

    // Patient Activity Semantics (Stage 5)
    // SENSOR_CHECK does NOT change patient activity!
    // Note: Piezo vibration is kept strictly distinct from gait 'WALKING'
    if (status === 'ACTIVE') {
      if (event === 'MOVEMENT') {
        this.lastPiezoActivity = 'MOVEMENT_DETECTED';
        this.lastMovementDetectedAt = savedRecord.timestamp;
        if (patientId) {
          await patientRepository.updatePiezoActivityStatus(patientId, 'MOVEMENT_DETECTED');
          sseManager.broadcast('patient_status_updated', {
            patientId,
            piezoActivityStatus: 'MOVEMENT_DETECTED',
            lastMovementUpdate: new Date(),
            lastPiezoActivityUpdate: new Date(),
            timestamp: new Date(),
            source: 'PIEZO_SENSOR',
          });
        }
      } else if (event === 'INACTIVITY') {
        this.lastPiezoActivity = 'NO_RECENT_MOVEMENT';
        if (patientId) {
          await patientRepository.updatePiezoActivityStatus(patientId, 'NO_RECENT_MOVEMENT');
          sseManager.broadcast('patient_status_updated', {
            patientId,
            piezoActivityStatus: 'NO_RECENT_MOVEMENT',
            lastMovementUpdate: new Date(),
            lastPiezoActivityUpdate: new Date(),
            timestamp: new Date(),
            source: 'PIEZO_SENSOR',
          });
        }
      }
      // If event === 'NONE', retain previous piezo activity state
    } else if (status === 'SENSOR_CHECK') {
      // Diagnostic notice: do not change patient activity
      sseManager.broadcast('serial_diagnostic', {
        type: 'SENSOR_CHECK',
        message: 'Arduino reported SENSOR_CHECK state. Diagnostic probe inspection required.',
        timestamp: new Date(),
      });
    }

    // Broadcast live telemetry event
    sseManager.broadcast('piezo_telemetry', {
      deviceId: this.deviceCode,
      patientId,
      sequenceNumber,
      arduinoTimeMs,
      raw,
      baseline,
      deviation,
      threshold,
      movementCount,
      event,
      status,
      timestamp: savedRecord.timestamp,
      lastMovementDetectedAt: this.lastMovementDetectedAt,
    });

    return {
      success: true,
      event: savedRecord,
    };
  }

  getStatusPayload() {
    return {
      status: this.status,
      port: this.portName,
      baudRate: this.baudRate,
      deviceCode: this.deviceCode,
      lastError: this.lastError,
      timestamp: new Date(),
    };
  }

  async recordGatewayTelemetry({ arduinoSerialStatus = 'CONNECTED', port = 'COM5', baudRate = 9600 } = {}) {
    if (this.isStopped) return;
    const wasConnected = this.isGatewayAlive();
    this.gateway.connected = true;
    this.gateway.lastSeen = new Date();
    this.gateway.arduinoSerialStatus = arduinoSerialStatus;
    this.gateway.port = port;
    this.gateway.baudRate = baudRate;
    this.gateway.packetsForwarded += 1;

    this.resetGatewayWatchdog();

    if (arduinoSerialStatus === 'CONNECTED') {
      await hardwareFaultService.recordRecovery(this.deviceCode, 'SERIAL_COMM_FAILURE', 'Serial communication operational via gateway bridge');
    }

    if (!wasConnected) {
      sseManager.broadcast('gateway_status', this.getGatewayStatus());
    }
  }

  async recordGatewayHeartbeat({ arduinoSerialStatus, port, baudRate } = {}) {
    if (this.isStopped) return;
    this.gateway.connected = true;
    this.gateway.lastSeen = new Date();
    if (arduinoSerialStatus) this.gateway.arduinoSerialStatus = arduinoSerialStatus;
    if (port) this.gateway.port = port;
    if (baudRate) this.gateway.baudRate = baudRate;

    this.resetGatewayWatchdog();

    if (arduinoSerialStatus === 'CONNECTED') {
      await hardwareFaultService.recordRecovery(this.deviceCode, 'SERIAL_COMM_FAILURE', 'Serial communication operational via gateway bridge');
      // NOTE: A gateway heartbeat confirms the gateway process is online, but does NOT prove
      // Arduino telemetry is arriving. MISSING_PACKETS is ONLY recovered when a valid DATA packet is processed.
    } else if (arduinoSerialStatus === 'DISCONNECTED' || arduinoSerialStatus === 'ERROR') {
      await hardwareFaultService.recordFault({
        deviceId: this.deviceCode,
        faultType: 'SERIAL_COMM_FAILURE',
        severity: 'CRITICAL',
        details: `Gateway reported Arduino serial status: ${arduinoSerialStatus} on ${port || this.gateway.port || 'COM5'}`,
      });
    }

    sseManager.broadcast('gateway_status', this.getGatewayStatus());
  }

  isGatewayAlive() {
    if (!this.gateway.lastSeen || this.gateway.connected === false) return false;
    const diffMs = Date.now() - new Date(this.gateway.lastSeen).getTime();
    return diffMs < this.gatewayWatchdogTimeoutMs;
  }

  getGatewayStatus() {
    const alive = this.isGatewayAlive();
    this.gateway.connected = alive;
    return {
      connected: alive,
      lastSeen: this.gateway.lastSeen,
      arduinoSerialStatus: alive ? this.gateway.arduinoSerialStatus : 'DISCONNECTED',
      port: this.gateway.port || 'COM5',
      baudRate: this.gateway.baudRate || 9600,
      packetsForwarded: this.gateway.packetsForwarded,
    };
  }

  async getStatus() {
    let assignedPatient = null;
    try {
      const device = await deviceRepository.findByCode(this.deviceCode);
      if (device && device.assignedPatientId) {
        const patient = await patientRepository.findById(
          device.assignedPatientId._id || device.assignedPatientId
        );
        if (patient) {
          assignedPatient = {
            id: patient._id,
            name: patient.name,
            roomNumber: patient.roomNumber,
            bedNumber: patient.bedNumber,
            piezoActivityStatus: patient.piezoActivityStatus || 'UNKNOWN',
          };
        }
      }
    } catch {}

    return {
      enabled: process.env.SERIAL_ENABLED === 'true',
      port: this.portName,
      baudRate: this.baudRate,
      status: this.status,
      deviceCode: this.deviceCode,
      assignedPatient,
      lastReceivedAt: this.lastReceivedAt,
      lastSequenceNumber: this.lastSequenceNumber,
      lastMovementCount: this.lastMovementCount,
      lastMovementDetectedAt: this.lastMovementDetectedAt,
      lastPiezoActivity: this.lastPiezoActivity,
      lastSensorStatus: this.lastSensorStatus,
      lastDiagnostic: this.lastDiagnostic,
      stats: { ...this.stats },
      lastError: this.lastError,
      gateway: this.getGatewayStatus(),
    };
  }

  async getHistory(limit = 100) {
    return await piezoEventRepository.findRecent({}, limit);
  }
}

module.exports = new SerialBridgeService();
module.exports.SerialBridgeService = SerialBridgeService;
