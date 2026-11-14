const EventEmitter = require('events');

// Mock dependencies
const mockPiezoEvents = new Map();
const mockDevices = new Map();
const mockPatients = new Map();

jest.mock('../src/repositories/piezoEvent.repository', () => ({
  create: jest.fn().mockImplementation(async (data) => {
    const key = `${data.deviceId}-${data.sequenceNumber}`;
    if (mockPiezoEvents.has(key)) {
      const err = new Error('Duplicate key');
      err.code = 11000;
      throw err;
    }
    const doc = { _id: `pe-${Date.now()}-${data.sequenceNumber}`, ...data };
    mockPiezoEvents.set(key, doc);
    return doc;
  }),
  findByDeviceAndSequence: jest.fn().mockImplementation(async (deviceId, sequenceNumber) => {
    return mockPiezoEvents.get(`${deviceId}-${sequenceNumber}`) || null;
  }),
  getLatestForDevice: jest.fn().mockResolvedValue(null),
  getLatestMovementForDevice: jest.fn().mockResolvedValue(null),
}));

jest.mock('../src/repositories/device.repository', () => ({
  findByCode: jest.fn().mockImplementation(async (code) => {
    return mockDevices.get(code) || null;
  }),
  updateHeartbeat: jest.fn().mockImplementation(async (code) => {
    const dev = mockDevices.get(code);
    if (dev) {
      dev.lastHeartbeat = new Date();
      return dev;
    }
    return null;
  }),
}));

jest.mock('../src/repositories/patient.repository', () => ({
  findById: jest.fn().mockImplementation(async (id) => {
    return mockPatients.get(String(id)) || null;
  }),
  updatePiezoActivityStatus: jest.fn().mockImplementation(async (id, status) => {
    const pat = mockPatients.get(String(id));
    if (pat) {
      pat.piezoActivityStatus = status;
      pat.lastPiezoActivityUpdate = new Date();
      return pat;
    }
    return null;
  }),
}));

jest.mock('../src/models/Device', () => ({
  create: jest.fn().mockImplementation(async (data) => {
    const doc = { _id: `dev-${data.deviceCode}`, ...data };
    mockDevices.set(data.deviceCode, doc);
    return doc;
  }),
  findOne: jest.fn().mockImplementation(async (query) => {
    if (query.deviceCode) return mockDevices.get(query.deviceCode) || null;
    return null;
  }),
}));

jest.mock('../src/models/Patient', () => ({
  findOne: jest.fn().mockImplementation(async () => {
    return mockPatients.get('patient-eleanor') || null;
  }),
}));

jest.mock('../src/sockets/sse.manager', () => ({
  broadcast: jest.fn(),
}));

jest.mock('../src/services/hardwareFault.service', () => ({
  recordFault: jest.fn(),
  recordRecovery: jest.fn(),
}));

const serialBridgeService = require('../src/services/serialBridge.service');
const sseManager = require('../src/sockets/sse.manager');
const patientRepository = require('../src/repositories/patient.repository');
const deviceRepository = require('../src/repositories/device.repository');

describe('SerialBridge & Gateway Integration Unit Tests', () => {
  beforeEach(() => {
    mockPiezoEvents.clear();
    mockDevices.clear();
    mockPatients.clear();
    jest.clearAllMocks();

    // Setup default patient Eleanor
    mockPatients.set('patient-eleanor', {
      _id: 'patient-eleanor',
      name: 'Eleanor Vance (Synthetic)',
      roomNumber: '101',
      bedNumber: 'Bed-A',
      piezoActivityStatus: 'UNKNOWN',
    });
  });

  describe('1. Device Registration & Patient Assignment Preservation', () => {
    it('creates device record linked to Eleanor Vance when no existing device is found', async () => {
      await serialBridgeService.ensureDeviceRegistered();

      const device = mockDevices.get('ARDUINO-PIEZO-01');
      expect(device).toBeDefined();
      expect(device.deviceCode).toBe('ARDUINO-PIEZO-01');
      expect(device.status).toBe('ACTIVE');
      expect(device.assignedPatientId).toBe('patient-eleanor');
    });

    it('preserves existing assigned patient and NEVER overwrites it', async () => {
      // Pre-assign device to a different patient
      mockPatients.set('patient-marcus', {
        _id: 'patient-marcus',
        name: 'Marcus Holloway',
        roomNumber: '102',
        bedNumber: 'Bed-B',
      });

      mockDevices.set('ARDUINO-PIEZO-01', {
        deviceCode: 'ARDUINO-PIEZO-01',
        status: 'ACTIVE',
        assignedPatientId: 'patient-marcus',
      });

      // Run ensureDeviceRegistered again
      await serialBridgeService.ensureDeviceRegistered();

      const device = mockDevices.get('ARDUINO-PIEZO-01');
      expect(device.assignedPatientId).toBe('patient-marcus');
    });
  });

  describe('2. Telemetry Processing & Patient Semantics via Gateway', () => {
    beforeEach(async () => {
      await serialBridgeService.ensureDeviceRegistered();
    });

    it('processes genuine MOVEMENT packet, saves record, and updates patient status to MOVEMENT_DETECTED', async () => {
      const line = 'DATA,1,1000,120,45.0,75,30.0,1,MOVEMENT,ACTIVE';

      const result = await serialBridgeService.handleIncomingLine(line);

      expect(result.success).toBe(true);
      expect(result.event.sequenceNumber).toBe(1);
      expect(result.event.raw).toBe(120);
      expect(result.event.deviation).toBe(75);
      expect(result.event.event).toBe('MOVEMENT');
      expect(result.event.status).toBe('ACTIVE');

      // Heartbeat updated
      expect(deviceRepository.updateHeartbeat).toHaveBeenCalledWith('ARDUINO-PIEZO-01');

      // Patient activity updated to MOVEMENT_DETECTED
      expect(patientRepository.updatePiezoActivityStatus).toHaveBeenCalledWith(
        'patient-eleanor',
        'MOVEMENT_DETECTED'
      );

      // SSE broadcasts emitted
      expect(sseManager.broadcast).toHaveBeenCalledWith(
        'patient_status_updated',
        expect.objectContaining({
          patientId: 'patient-eleanor',
          piezoActivityStatus: 'MOVEMENT_DETECTED',
        })
      );

      expect(sseManager.broadcast).toHaveBeenCalledWith(
        'piezo_telemetry',
        expect.objectContaining({
          sequenceNumber: 1,
          event: 'MOVEMENT',
          status: 'ACTIVE',
        })
      );
    });

    it('processes INACTIVITY packet and updates patient status to NO_RECENT_MOVEMENT', async () => {
      const line = 'DATA,2,11000,45,45.0,0,30.0,1,INACTIVITY,ACTIVE';

      const result = await serialBridgeService.handleIncomingLine(line);

      expect(result.success).toBe(true);
      expect(patientRepository.updatePiezoActivityStatus).toHaveBeenCalledWith(
        'patient-eleanor',
        'NO_RECENT_MOVEMENT'
      );
    });

    it('rejects duplicate sequence packet and does not create duplicate record', async () => {
      const line = 'DATA,3,12000,45,45.0,0,30.0,1,NONE,ACTIVE';

      // First ingestion
      const res1 = await serialBridgeService.handleIncomingLine(line);
      expect(res1.success).toBe(true);

      // Duplicate ingestion
      const res2 = await serialBridgeService.handleIncomingLine(line);
      expect(res2.duplicate).toBe(true);
    });

    it('does NOT alter patient activity status on SENSOR_CHECK', async () => {
      const line = 'DATA,4,13000,1020,45.0,975,30.0,1,NONE,SENSOR_CHECK';

      const result = await serialBridgeService.handleIncomingLine(line);

      expect(result.success).toBe(true);
      // Must NOT update patient status
      expect(patientRepository.updatePiezoActivityStatus).not.toHaveBeenCalled();
      // Emits diagnostic notice
      expect(sseManager.broadcast).toHaveBeenCalledWith(
        'serial_diagnostic',
        expect.objectContaining({ type: 'SENSOR_CHECK' })
      );
    });
  });

  describe('3. Gateway Tracking in getStatus()', () => {
    it('accurately reports gateway status in getStatus() without claiming physical connection', async () => {
      // Simulate telemetry from gateway
      serialBridgeService.recordGatewayTelemetry({
        arduinoSerialStatus: 'CONNECTED',
        port: 'COM5',
        baudRate: 9600,
      });

      const status = await serialBridgeService.getStatus();

      // Cloud bridge physical status remains truthful (not claiming physical connection)
      expect(status.status).toBe('DISCONNECTED');
      // Gateway tracking is populated and active
      expect(status.gateway).toBeDefined();
      expect(status.gateway.connected).toBe(true);
      expect(status.gateway.arduinoSerialStatus).toBe('CONNECTED');
      expect(status.gateway.port).toBe('COM5');
      expect(status.gateway.packetsForwarded).toBeGreaterThan(0);
    });
  });

  describe('5. Local Serial Sequence Translation (Arduino counter reset vs stored history)', () => {
    const hardwareFaultService = require('../src/services/hardwareFault.service');
    const { SerialBridgeService } = require('../src/services/serialBridge.service');

    it('re-anchors raw Arduino sequences after the highest stored sequence so MOVEMENT is not discarded as a duplicate', async () => {
      // Historical record with the same raw sequence number from an earlier session
      mockPiezoEvents.set('ARDUINO-PIEZO-01-7', { _id: 'old-7', deviceId: 'ARDUINO-PIEZO-01', sequenceNumber: 7, event: 'NONE' });

      const bridge = new SerialBridgeService();
      bridge.highestSequenceNumber = 10026; // as restored from MongoDB on boot
      bridge.localSeq.rebootPending = true; // port just opened

      const t1 = bridge.translateLocalSerialLine('DATA,7,7000,219,67.0,152,150.0,1,MOVEMENT,ACTIVE');
      expect(t1.rawSeq).toBe(7);
      expect(t1.line).toBe('DATA,10027,7000,219,67.0,152,150.0,1,MOVEMENT,ACTIVE');

      const res = await bridge.handleIncomingLine(t1.line, { arduinoSequenceNumber: t1.rawSeq });
      expect(res.success).toBe(true);
      expect(res.event.sequenceNumber).toBe(10027);
      expect(res.event.arduinoSequenceNumber).toBe(7);
      expect(res.event.event).toBe('MOVEMENT');
      expect(bridge.lastSequenceNumber).toBe(10027);
      expect(bridge.lastArduinoSequenceNumber).toBe(7);
      expect(bridge.lastMovementCount).toBe(1);
      expect(bridge.lastPiezoActivity).toBe('MOVEMENT_DETECTED');

      const telemetryCall = sseManager.broadcast.mock.calls.find(([evt]) => evt === 'piezo_telemetry');
      expect(telemetryCall[1]).toMatchObject({ deviceId: 'ARDUINO-PIEZO-01', sequenceNumber: 10027, arduinoSequenceNumber: 7, event: 'MOVEMENT', movementCount: 1 });

      // Subsequent packets in the same session stay contiguous
      expect(bridge.translateLocalSerialLine('DATA,8,8000,60,67.0,7,150.0,1,NONE,ACTIVE').line.split(',')[1]).toBe('10028');
      // Same raw sequence repeated without a reboot maps to the same global sequence (duplicate)
      expect(bridge.translateLocalSerialLine('DATA,8,8000,60,67.0,7,150.0,1,NONE,ACTIVE').line.split(',')[1]).toBe('10028');
      // Arduino reboot (raw sequence goes backwards) re-anchors above the highest assigned sequence
      expect(bridge.translateLocalSerialLine('DATA,0,0,60,67.0,7,150.0,0,NONE,ACTIVE').line.split(',')[1]).toBe('10029');
    });

    it('leaves non-DATA lines untouched and flags reboot on firmware startup markers', () => {
      const bridge = new SerialBridgeService();
      bridge.localSeq.rebootPending = false;
      expect(bridge.translateLocalSerialLine('TYPE,SEQUENCE,TIME_MS').line).toBe('TYPE,SEQUENCE,TIME_MS');
      expect(bridge.translateLocalSerialLine('SYSTEM: CALIBRATION_STARTED').rawSeq).toBeNull();
      expect(bridge.localSeq.rebootPending).toBe(true);
    });

    it('does not preserve a NONE packet as a new movement timestamp', async () => {
      const bridge = new SerialBridgeService();
      bridge.highestSequenceNumber = 50;
      const move = bridge.translateLocalSerialLine('DATA,1,1000,219,67.0,152,150.0,1,MOVEMENT,ACTIVE');
      await bridge.handleIncomingLine(move.line, { arduinoSequenceNumber: move.rawSeq });
      const movementAt = bridge.lastMovementDetectedAt;
      const none = bridge.translateLocalSerialLine('DATA,2,2000,60,67.0,7,150.0,1,NONE,ACTIVE');
      await bridge.handleIncomingLine(none.line, { arduinoSequenceNumber: none.rawSeq });
      expect(bridge.lastMovementDetectedAt).toBe(movementAt);
      expect(bridge.lastSequenceNumber).toBe(52);
    });

    it('recovers SENSOR_DISCONNECTED only after valid non-SENSOR_CHECK telemetry is persisted', async () => {
      const bridge = new SerialBridgeService();
      await bridge.handleIncomingLine('DATA,900,1000,1020,45.0,975,30.0,0,NONE,SENSOR_CHECK');
      expect(hardwareFaultService.recordRecovery).not.toHaveBeenCalledWith('ARDUINO-PIEZO-01', 'SENSOR_DISCONNECTED', expect.anything());

      await bridge.handleIncomingLine('DATA,901,2000,60,45.0,15,30.0,0,NONE,ACTIVE');
      expect(hardwareFaultService.recordRecovery).toHaveBeenCalledWith('ARDUINO-PIEZO-01', 'SENSOR_DISCONNECTED', expect.stringContaining('#901'));
    });
  });
});
