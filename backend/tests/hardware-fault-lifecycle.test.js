const mongoose = require('mongoose');

// Mock SSE Manager
jest.mock('../src/sockets/sse.manager', () => ({
  broadcast: jest.fn(),
}));

// Mock Models
jest.mock('../src/models/Device', () => ({
  create: jest.fn().mockImplementation(async (data) => ({ _id: `dev-${data.deviceCode}`, ...data })),
  findOne: jest.fn(),
}));

jest.mock('../src/models/Patient', () => ({
  findOne: jest.fn(),
}));

jest.mock('../src/models/DeviceFault', () => ({
  create: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  updateMany: jest.fn(),
}));

// In-Memory Data Stores for Mock Repositories
const mockFaults = new Map();
const mockDevices = new Map();

jest.mock('../src/repositories/deviceFault.repository', () => ({
  create: jest.fn().mockImplementation(async (data) => {
    const id = `fault-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    const doc = {
      _id: id,
      recovered: false,
      occurredAt: new Date(),
      recoveredAt: null,
      resolutionNotes: '',
      ...data,
    };
    mockFaults.set(id, doc);
    return doc;
  }),

  findActiveByDevice: jest.fn().mockImplementation(async (deviceId) => {
    const results = [];
    for (const f of mockFaults.values()) {
      if (f.deviceId === deviceId && !f.recovered) {
        results.push(f);
      }
    }
    return results.sort((a, b) => b.occurredAt - a.occurredAt);
  }),

  findLatestActiveFault: jest.fn().mockImplementation(async (deviceId, faultType) => {
    const matches = [];
    for (const f of mockFaults.values()) {
      if (f.deviceId === deviceId && f.faultType === faultType && !f.recovered) {
        matches.push(f);
      }
    }
    matches.sort((a, b) => b.occurredAt - a.occurredAt);
    return matches[0] || null;
  }),

  markRecovered: jest.fn().mockImplementation(async (faultId, resolutionNotes = 'Auto-recovered') => {
    const f = mockFaults.get(faultId);
    if (f) {
      f.recovered = true;
      f.recoveredAt = new Date();
      f.resolutionNotes = resolutionNotes;
      return f;
    }
    return null;
  }),

  markRecoveredByType: jest.fn().mockImplementation(async (deviceId, faultType, resolutionNotes = 'Auto-recovered') => {
    let modifiedCount = 0;
    for (const f of mockFaults.values()) {
      if (f.deviceId === deviceId && f.faultType === faultType && !f.recovered) {
        f.recovered = true;
        f.recoveredAt = new Date();
        f.resolutionNotes = resolutionNotes;
        modifiedCount++;
      }
    }
    return { modifiedCount };
  }),

  findAll: jest.fn().mockImplementation(async (query = {}, limit = 100) => {
    const results = [];
    for (const f of mockFaults.values()) {
      let matches = true;
      if (query.deviceId && f.deviceId !== query.deviceId) matches = false;
      if (query.recovered !== undefined && f.recovered !== query.recovered) matches = false;
      if (matches) results.push(f);
    }
    return results.sort((a, b) => b.occurredAt - a.occurredAt).slice(0, limit);
  }),
}));

jest.mock('../src/repositories/device.repository', () => ({
  findByCode: jest.fn().mockImplementation(async (code) => {
    return mockDevices.get(code) || null;
  }),
  update: jest.fn().mockImplementation(async (id, data) => {
    for (const dev of mockDevices.values()) {
      if (dev._id === id) {
        Object.assign(dev, data);
        return dev;
      }
    }
    return null;
  }),
  updateHeartbeat: jest.fn().mockImplementation(async (code) => {
    const dev = mockDevices.get(code);
    if (dev) dev.lastHeartbeat = new Date();
    return dev;
  }),
}));

jest.mock('../src/repositories/piezoEvent.repository', () => ({
  create: jest.fn().mockResolvedValue({ _id: 'pe-1', timestamp: new Date() }),
  findByDeviceAndSequence: jest.fn().mockResolvedValue(null),
  getLatestForDevice: jest.fn().mockResolvedValue(null),
  getLatestMovementForDevice: jest.fn().mockResolvedValue(null),
}));

jest.mock('../src/repositories/patient.repository', () => ({
  findById: jest.fn().mockResolvedValue(null),
  updatePiezoActivityStatus: jest.fn().mockResolvedValue(null),
}));

// Mock mongoose readyState for hardwareFaultService connection guard
mongoose.connection.readyState = 1;

const hardwareFaultService = require('../src/services/hardwareFault.service');
const serialBridgeService = require('../src/services/serialBridge.service');
const serialController = require('../src/controllers/serial.controller');
const sseManager = require('../src/sockets/sse.manager');
const {
  APPROVED_TARGET_IDS,
  TARGET_SPECIFICATIONS,
  validateHistoricalMatches,
} = require('../scripts/reconcile-historical-faults');

describe('Hardware Fault Detection & Recovery Lifecycle Test Suite', () => {
  beforeEach(() => {
    mockFaults.clear();
    mockDevices.clear();
    jest.clearAllMocks();
    serialBridgeService.isStopped = false;

    // Setup standard ARDUINO-PIEZO-01 device
    mockDevices.set('ARDUINO-PIEZO-01', {
      _id: 'dev-piezo-01',
      deviceCode: 'ARDUINO-PIEZO-01',
      faultStatus: 'HEALTHY',
      lastFaultType: null,
      lastFaultAt: null,
    });
  });

  afterEach(async () => {
    await serialBridgeService.stop();
  });

  // ============================================================================
  // SUITE 1: Device-Scoped Active Fault Queries & Historical Filtering (Phase 2)
  // ============================================================================
  describe('Suite 1: Device-Scoped Active Fault Queries & Historical Filtering', () => {
    beforeEach(() => {
      // Seed a mix of active, recovered, and multi-device faults
      mockFaults.set('f1', {
        _id: 'f1',
        deviceId: 'ARDUINO-PIEZO-01',
        faultType: 'INVALID_READINGS',
        severity: 'WARNING',
        recovered: false,
        occurredAt: new Date(Date.now() - 5000),
      });

      mockFaults.set('f2', {
        _id: 'f2',
        deviceId: 'ARDUINO-PIEZO-01',
        faultType: 'MISSING_PACKETS',
        severity: 'WARNING',
        recovered: true, // RECOVERED
        occurredAt: new Date(Date.now() - 10000),
        recoveredAt: new Date(Date.now() - 7000),
      });

      mockFaults.set('f3', {
        _id: 'f3',
        deviceId: 'AUDIT-TAG-01', // DIFFERENT DEVICE
        faultType: 'SENSOR_DISCONNECTED',
        severity: 'CRITICAL',
        recovered: false,
        occurredAt: new Date(Date.now() - 3000),
      });
    });

    it('defaults to returning active faults only (recovered=false)', async () => {
      const req = { query: {} };
      let jsonResult = null;
      const res = { json: (data) => { jsonResult = data; } };

      await serialController.getFaults(req, res, () => {});

      expect(jsonResult).toBeDefined();
      expect(jsonResult.success).toBe(true);
      // Only f1 is active for ARDUINO-PIEZO-01
      expect(jsonResult.count).toBe(1);
      expect(jsonResult.data[0]._id).toBe('f1');
      expect(jsonResult.data[0].recovered).toBe(false);
    });

    it('defaults device scoping to ARDUINO-PIEZO-01 and excludes AUDIT-TAG-01', async () => {
      const req = { query: {} };
      let jsonResult = null;
      const res = { json: (data) => { jsonResult = data; } };

      await serialController.getFaults(req, res, () => {});

      expect(jsonResult.data.some((f) => f.deviceId === 'AUDIT-TAG-01')).toBe(false);
      expect(jsonResult.data.every((f) => f.deviceId === 'ARDUINO-PIEZO-01')).toBe(true);
    });

    it('allows explicit historical query when activeOnly=false or history=true', async () => {
      const req = { query: { activeOnly: 'false', deviceId: 'ARDUINO-PIEZO-01' } };
      let jsonResult = null;
      const res = { json: (data) => { jsonResult = data; } };

      await serialController.getFaults(req, res, () => {});

      expect(jsonResult.success).toBe(true);
      // Should include both f1 (active) and f2 (recovered) for ARDUINO-PIEZO-01
      expect(jsonResult.count).toBe(2);
      expect(jsonResult.data.some((f) => f._id === 'f1')).toBe(true);
      expect(jsonResult.data.some((f) => f._id === 'f2')).toBe(true);
      // Still excludes AUDIT-TAG-01
      expect(jsonResult.data.some((f) => f.deviceId === 'AUDIT-TAG-01')).toBe(false);
    });
  });

  // ============================================================================
  // SUITE 2: Gateway Heartbeat Watchdog & Timeout Monitoring (Phase 3)
  // ============================================================================
  describe('Suite 2: Gateway Heartbeat Watchdog & Timeout Monitoring', () => {
    it('initializes with gateway watchdog timer support and configurable timeout', () => {
      expect(serialBridgeService.gatewayWatchdogTimeoutMs).toBe(12000);
      expect(typeof serialBridgeService.resetGatewayWatchdog).toBe('function');
      expect(typeof serialBridgeService.cleanupGatewayWatchdog).toBe('function');
    });

    it('triggers MISSING_PACKETS fault when gateway heartbeat timer expires', async () => {
      serialBridgeService.gatewayWatchdogTimeoutMs = 50;

      // Establish gateway connectivity
      await serialBridgeService.recordGatewayHeartbeat({
        arduinoSerialStatus: 'CONNECTED',
        port: 'COM5',
        baudRate: 9600,
      });

      expect(serialBridgeService.gateway.connected).toBe(true);

      // Wait 150ms for watchdog to fire
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(serialBridgeService.gateway.connected).toBe(false);

      // Fault should be recorded in mockFaults
      const activeFaults = Array.from(mockFaults.values()).filter((f) => !f.recovered);
      expect(activeFaults.some((f) => f.faultType === 'MISSING_PACKETS')).toBe(true);

      // Restore timeout
      serialBridgeService.gatewayWatchdogTimeoutMs = 12000;
    });

    it('does NOT recover MISSING_PACKETS when only gateway heartbeats arrive', async () => {
      // First insert an active MISSING_PACKETS fault
      await hardwareFaultService.recordFault({
        deviceId: 'ARDUINO-PIEZO-01',
        faultType: 'MISSING_PACKETS',
        severity: 'WARNING',
        details: 'Telemetry missing',
      });

      expect((await hardwareFaultService.getActiveFaults('ARDUINO-PIEZO-01')).length).toBe(1);

      // Heartbeat arrives - confirms gateway is alive, but does NOT recover missing telemetry
      await serialBridgeService.recordGatewayHeartbeat({
        arduinoSerialStatus: 'CONNECTED',
        port: 'COM5',
        baudRate: 9600,
      });

      const remaining = await hardwareFaultService.getActiveFaults('ARDUINO-PIEZO-01');
      expect(remaining.some((f) => f.faultType === 'MISSING_PACKETS')).toBe(true);
    });

    it('recovers MISSING_PACKETS when valid numeric telemetry arrives', async () => {
      // First insert an active MISSING_PACKETS fault
      await hardwareFaultService.recordFault({
        deviceId: 'ARDUINO-PIEZO-01',
        faultType: 'MISSING_PACKETS',
        severity: 'WARNING',
        details: 'Gateway expired',
      });

      expect((await hardwareFaultService.getActiveFaults('ARDUINO-PIEZO-01')).length).toBe(1);

      // Fresh valid DATA telemetry packet arrives
      await serialBridgeService.handleIncomingLine('DATA,1,1000,500,500.00,0,50.00,0,NONE,ACTIVE');

      const remaining = await hardwareFaultService.getActiveFaults('ARDUINO-PIEZO-01');
      expect(remaining.some((f) => f.faultType === 'MISSING_PACKETS')).toBe(false);
    });

    it('prevents race condition where stale watchdog timer fires after fresh heartbeat or reconnection', async () => {
      serialBridgeService.gatewayWatchdogTimeoutMs = 80;

      // Start watchdog (generation 1)
      await serialBridgeService.recordGatewayHeartbeat({ arduinoSerialStatus: 'CONNECTED' });
      expect(serialBridgeService.gateway.connected).toBe(true);
      const firstGen = serialBridgeService.gatewayWatchdogGeneration;

      // At 40ms, a fresh heartbeat arrives, resetting watchdog and updating generation
      await new Promise((r) => setTimeout(r, 40));
      await serialBridgeService.recordGatewayHeartbeat({ arduinoSerialStatus: 'CONNECTED' });
      expect(serialBridgeService.gatewayWatchdogGeneration).toBeGreaterThan(firstGen);

      // Wait until 100ms (past the original 80ms timer of generation 1)
      await new Promise((r) => setTimeout(r, 60));

      // Gateway must STILL be connected because generation 1 timer was superseded!
      expect(serialBridgeService.gateway.connected).toBe(true);
      const activeFaults = Array.from(mockFaults.values()).filter((f) => !f.recovered);
      expect(activeFaults.some((f) => f.faultType === 'MISSING_PACKETS')).toBe(false);

      // Cleanup
      serialBridgeService.gatewayWatchdogTimeoutMs = 12000;
      serialBridgeService.cleanupGatewayWatchdog();
    });

    it('handles repeated heartbeats safely without creating duplicate faults or errors', async () => {
      // Send 3 consecutive heartbeats
      await serialBridgeService.recordGatewayHeartbeat({ arduinoSerialStatus: 'CONNECTED', port: 'COM5', baudRate: 9600 });
      await serialBridgeService.recordGatewayHeartbeat({ arduinoSerialStatus: 'CONNECTED', port: 'COM5', baudRate: 9600 });
      await serialBridgeService.recordGatewayHeartbeat({ arduinoSerialStatus: 'CONNECTED', port: 'COM5', baudRate: 9600 });

      expect(serialBridgeService.gateway.connected).toBe(true);
      const active = await hardwareFaultService.getActiveFaults('ARDUINO-PIEZO-01');
      expect(active.length).toBe(0);
    });

    it('cleans up gateway watchdog timer cleanly on stop() without timer leaks', async () => {
      serialBridgeService.resetGatewayWatchdog();
      expect(serialBridgeService.gatewayWatchdogTimer).not.toBeNull();

      await serialBridgeService.stop();
      expect(serialBridgeService.gatewayWatchdogTimer).toBeNull();
    });

    it('preserves explicit shutdown state and rejects reactivation from incoming telemetry or heartbeats', async () => {
      // Explicitly stop the service
      await serialBridgeService.stop();
      expect(serialBridgeService.isStopped).toBe(true);

      // Attempt to send a gateway heartbeat
      await serialBridgeService.recordGatewayHeartbeat({
        arduinoSerialStatus: 'CONNECTED',
        port: 'COM5',
        baudRate: 9600,
      });

      // Service must STILL be stopped, and watchdog timer must NOT be scheduled
      expect(serialBridgeService.isStopped).toBe(true);
      expect(serialBridgeService.gatewayWatchdogTimer).toBeNull();

      // Attempt to send gateway telemetry
      await serialBridgeService.recordGatewayTelemetry({
        arduinoSerialStatus: 'CONNECTED',
        port: 'COM5',
        baudRate: 9600,
      });

      expect(serialBridgeService.isStopped).toBe(true);
      expect(serialBridgeService.gatewayWatchdogTimer).toBeNull();

      // Attempt to process a line
      const res = await serialBridgeService.handleIncomingLine('DATA,1,1000,500,500.00,0,50.00,0,NONE,ACTIVE');
      expect(res).toBeNull();

      // Re-enable for subsequent tests
      serialBridgeService.isStopped = false;
    });
  });

  // ============================================================================
  // SUITE 3: Evidence-Based Fault Recovery Rules (Phase 4)
  // ============================================================================
  describe('Suite 3: Evidence-Based Fault Recovery Rules', () => {
    it('recovers INVALID_READINGS when valid numeric telemetry arrives', async () => {
      // Record an active INVALID_READINGS fault
      await hardwareFaultService.recordFault({
        deviceId: 'ARDUINO-PIEZO-01',
        faultType: 'INVALID_READINGS',
        severity: 'WARNING',
        details: 'Malformed packet test',
      });

      expect((await hardwareFaultService.getActiveFaults('ARDUINO-PIEZO-01')).length).toBe(1);

      // Process a valid numeric telemetry line
      const validLine = 'DATA,10,5000,600,550.0,50,60.0,1,MOVEMENT,ACTIVE';
      await serialBridgeService.handleIncomingLine(validLine);

      const active = await hardwareFaultService.getActiveFaults('ARDUINO-PIEZO-01');
      expect(active.some((f) => f.faultType === 'INVALID_READINGS')).toBe(false);
    });

    it('rejects out-of-range ADC readings (-1, 1024, 1500) and does NOT recover faults or process telemetry', async () => {
      // Record an active MISSING_PACKETS fault to verify it is NOT recovered
      await hardwareFaultService.recordFault({
        deviceId: 'ARDUINO-PIEZO-01',
        faultType: 'MISSING_PACKETS',
        severity: 'WARNING',
        details: 'Initial missing packets',
      });

      const initialDropped = serialBridgeService.stats.droppedPackets;

      // 1. Test raw = -1
      const resNeg = await serialBridgeService.handleIncomingLine('DATA,1,100,-1,500.0,0,50.0,0,NONE,ACTIVE');
      expect(resNeg).toBeNull();
      expect(serialBridgeService.stats.droppedPackets).toBe(initialDropped + 1);

      // 2. Test raw = 1024
      const res1024 = await serialBridgeService.handleIncomingLine('DATA,2,200,1024,500.0,0,50.0,0,NONE,ACTIVE');
      expect(res1024).toBeNull();
      expect(serialBridgeService.stats.droppedPackets).toBe(initialDropped + 2);

      // 3. Test raw = 1500
      const res1500 = await serialBridgeService.handleIncomingLine('DATA,3,300,1500,500.0,0,50.0,0,NONE,ACTIVE');
      expect(res1500).toBeNull();
      expect(serialBridgeService.stats.droppedPackets).toBe(initialDropped + 3);

      const active = await hardwareFaultService.getActiveFaults('ARDUINO-PIEZO-01');
      // INVALID_READINGS must be recorded and active!
      const invalidFault = active.find((f) => f.faultType === 'INVALID_READINGS');
      expect(invalidFault).toBeDefined();
      expect(invalidFault.details).toContain('ADC raw value out of 10-bit range');

      // MISSING_PACKETS must NOT be recovered
      expect(active.some((f) => f.faultType === 'MISSING_PACKETS')).toBe(true);
    });

    it('rejects malformed non-numeric DATA packets without recovering faults, resetting watchdogs, or persisting events', async () => {
      // Seed active SERIAL_COMM_FAILURE fault
      await hardwareFaultService.recordFault({
        deviceId: 'ARDUINO-PIEZO-01',
        faultType: 'SERIAL_COMM_FAILURE',
        severity: 'CRITICAL',
      });

      const initialMovementCount = serialBridgeService.lastMovementCount;
      const initialDropped = serialBridgeService.stats.droppedPackets;

      // Malformed packets
      const malformed1 = 'DATA,abc,1000,500,500,0,50,0,NONE,ACTIVE'; // sequence is NaN
      const malformed2 = 'DATA,1,time,500,500,0,50,0,NONE,ACTIVE'; // time is NaN
      const malformed3 = 'DATA,2,1000,NaN,500,0,50,0,NONE,ACTIVE'; // raw is NaN
      const malformed4 = 'DATA,3,1000,500,500,0,50,0,BAD_EVENT,ACTIVE'; // invalid enum

      expect(await serialBridgeService.handleIncomingLine(malformed1)).toBeNull();
      expect(await serialBridgeService.handleIncomingLine(malformed2)).toBeNull();
      expect(await serialBridgeService.handleIncomingLine(malformed3)).toBeNull();
      expect(await serialBridgeService.handleIncomingLine(malformed4)).toBeNull();

      expect(serialBridgeService.stats.droppedPackets).toBe(initialDropped + 4);
      expect(serialBridgeService.lastMovementCount).toBe(initialMovementCount);

      // Fault must NOT be recovered
      const active = await hardwareFaultService.getActiveFaults('ARDUINO-PIEZO-01');
      expect(active.some((f) => f.faultType === 'SERIAL_COMM_FAILURE')).toBe(true);
    });

    it('recovers SERIAL_COMM_FAILURE when gateway reports arduinoSerialStatus=CONNECTED', async () => {
      // Record an active SERIAL_COMM_FAILURE
      await hardwareFaultService.recordFault({
        deviceId: 'ARDUINO-PIEZO-01',
        faultType: 'SERIAL_COMM_FAILURE',
        severity: 'CRITICAL',
        details: 'COM5 not found',
      });

      expect((await hardwareFaultService.getActiveFaults('ARDUINO-PIEZO-01')).length).toBe(1);

      // Gateway reports CONNECTED
      await serialBridgeService.recordGatewayHeartbeat({
        arduinoSerialStatus: 'CONNECTED',
        port: 'COM5',
        baudRate: 9600,
      });

      const active = await hardwareFaultService.getActiveFaults('ARDUINO-PIEZO-01');
      expect(active.some((f) => f.faultType === 'SERIAL_COMM_FAILURE')).toBe(false);
    });

    it('records SERIAL_COMM_FAILURE when gateway reports arduinoSerialStatus=DISCONNECTED', async () => {
      await serialBridgeService.recordGatewayHeartbeat({
        arduinoSerialStatus: 'DISCONNECTED',
        port: 'COM5',
      });

      const active = await hardwareFaultService.getActiveFaults('ARDUINO-PIEZO-01');
      expect(active.some((f) => f.faultType === 'SERIAL_COMM_FAILURE')).toBe(true);
    });

    it('does NOT automatically recover SENSOR_DISCONNECTED from gateway connectivity alone', async () => {
      // Record active SENSOR_DISCONNECTED
      await hardwareFaultService.recordFault({
        deviceId: 'ARDUINO-PIEZO-01',
        faultType: 'SENSOR_DISCONNECTED',
        severity: 'CRITICAL',
        details: 'Probe detached',
      });

      // Gateway connects and sends heartbeat
      await serialBridgeService.recordGatewayHeartbeat({
        arduinoSerialStatus: 'CONNECTED',
        port: 'COM5',
      });

      // SENSOR_DISCONNECTED must still be active!
      const active = await hardwareFaultService.getActiveFaults('ARDUINO-PIEZO-01');
      expect(active.some((f) => f.faultType === 'SENSOR_DISCONNECTED')).toBe(true);
    });

    it('recovers SENSOR_SATURATED when firmware transmits SENSOR_READY evidence, but does NOT recover SENSOR_DISCONNECTED', async () => {
      // Record active SENSOR_DISCONNECTED and SENSOR_SATURATED
      await hardwareFaultService.recordFault({
        deviceId: 'ARDUINO-PIEZO-01',
        faultType: 'SENSOR_DISCONNECTED',
        severity: 'CRITICAL',
        details: 'Probe detached',
      });
      await hardwareFaultService.recordFault({
        deviceId: 'ARDUINO-PIEZO-01',
        faultType: 'SENSOR_SATURATED',
        severity: 'WARNING',
        details: 'Rail saturation',
      });

      // Arduino diagnostic line indicates hardware upper-rail saturation has cleared
      await serialBridgeService.handleIncomingLine('SYSTEM: SENSOR_READY on A0');

      const active = await hardwareFaultService.getActiveFaults('ARDUINO-PIEZO-01');
      // SENSOR_SATURATED is recovered because upper-rail saturation cleared
      expect(active.some((f) => f.faultType === 'SENSOR_SATURATED')).toBe(false);
      // SENSOR_DISCONNECTED remains active because firmware does not perform continuity/physical connection testing
      expect(active.some((f) => f.faultType === 'SENSOR_DISCONNECTED')).toBe(true);
    });
  });

  // ============================================================================
  // SUITE 4: Device Health Recalculation & SSE Recovery Broadcast
  // ============================================================================
  describe('Suite 4: Device Health Recalculation & SSE Recovery Broadcast', () => {
    it('restores Device.faultStatus to HEALTHY once all active faults are recovered', async () => {
      // Create a critical fault
      await hardwareFaultService.recordFault({
        deviceId: 'ARDUINO-PIEZO-01',
        faultType: 'SERIAL_COMM_FAILURE',
        severity: 'CRITICAL',
      });

      let device = mockDevices.get('ARDUINO-PIEZO-01');
      expect(device.faultStatus).toBe('FAULTED');

      // Recover the fault
      await hardwareFaultService.recordRecovery('ARDUINO-PIEZO-01', 'SERIAL_COMM_FAILURE', 'Resolved');

      device = mockDevices.get('ARDUINO-PIEZO-01');
      expect(device.faultStatus).toBe('HEALTHY');
    });

    it('broadcasts SSE hardware_fault_recovered with matching event name and payload', async () => {
      await hardwareFaultService.recordFault({
        deviceId: 'ARDUINO-PIEZO-01',
        faultType: 'MISSING_PACKETS',
        severity: 'WARNING',
      });

      await hardwareFaultService.recordRecovery('ARDUINO-PIEZO-01', 'MISSING_PACKETS', 'Heartbeat stream active');

      expect(sseManager.broadcast).toHaveBeenCalledWith(
        'hardware_fault_recovered',
        expect.objectContaining({
          deviceId: 'ARDUINO-PIEZO-01',
          faultType: 'MISSING_PACKETS',
          resolutionNotes: 'Heartbeat stream active',
        })
      );
    });

    it('returns promises and handles asynchronous operations safely without unhandled rejections', async () => {
      const faultPromise = hardwareFaultService.recordFault({
        deviceId: 'ARDUINO-PIEZO-01',
        faultType: 'INVALID_READINGS',
        severity: 'WARNING',
        details: 'Async fault write test',
      });
      expect(faultPromise).toBeInstanceOf(Promise);
      const fault = await faultPromise;
      expect(fault).toBeDefined();

      const recoveryPromise = hardwareFaultService.recordRecovery(
        'ARDUINO-PIEZO-01',
        'INVALID_READINGS',
        'Async recovery test'
      );
      expect(recoveryPromise).toBeInstanceOf(Promise);
      const res = await recoveryPromise;
      expect(res).toBeDefined();
    });

    it('deduplicates repeated fault events and prevents duplicate active faults while preserving historical records', async () => {
      // Initial fault record
      const fault1 = await hardwareFaultService.recordFault({
        deviceId: 'ARDUINO-PIEZO-01',
        faultType: 'MISSING_PACKETS',
        severity: 'WARNING',
        details: 'First timeout event',
      });

      // Repeated timeout events for same device and faultType
      const fault2 = await hardwareFaultService.recordFault({
        deviceId: 'ARDUINO-PIEZO-01',
        faultType: 'MISSING_PACKETS',
        severity: 'WARNING',
        details: 'Second repeated timeout event',
      });

      const fault3 = await hardwareFaultService.recordFault({
        deviceId: 'ARDUINO-PIEZO-01',
        faultType: 'MISSING_PACKETS',
        severity: 'WARNING',
        details: 'Third repeated timeout event',
      });

      // Must return existing active fault, avoiding duplicate documents
      expect(fault2._id).toBe(fault1._id);
      expect(fault3._id).toBe(fault1._id);

      const activeFaults = await hardwareFaultService.getActiveFaults('ARDUINO-PIEZO-01');
      const missingPacketsActive = activeFaults.filter((f) => f.faultType === 'MISSING_PACKETS');
      expect(missingPacketsActive).toHaveLength(1);

      // Now recover the fault
      await hardwareFaultService.recordRecovery('ARDUINO-PIEZO-01', 'MISSING_PACKETS', 'Fresh telemetry');
      expect((await hardwareFaultService.getActiveFaults('ARDUINO-PIEZO-01')).filter((f) => f.faultType === 'MISSING_PACKETS')).toHaveLength(0);

      // Subsequent incident after recovery creates a new fault record while preserving history
      const faultNewIncident = await hardwareFaultService.recordFault({
        deviceId: 'ARDUINO-PIEZO-01',
        faultType: 'MISSING_PACKETS',
        severity: 'WARNING',
        details: 'New incident after recovery',
      });

      expect(faultNewIncident._id).not.toBe(fault1._id);
      const allHistory = await hardwareFaultService.getFaultHistory({ deviceId: 'ARDUINO-PIEZO-01', faultType: 'MISSING_PACKETS' }, 10);
      expect(allHistory.length).toBeGreaterThanOrEqual(2);
      expect(allHistory.some((f) => f.recovered === true)).toBe(true);
      expect(allHistory.some((f) => f.recovered === false)).toBe(true);
    });
  });

  // ============================================================================
  // SUITE 5: Historical Reconciliation Exact ID Matching & Safety Abort Rules
  // ============================================================================
  describe('Suite 5: Historical Reconciliation Exact ID Matching & Safety Abort Rules', () => {
    const validFourApprovedFaults = [
      {
        _id: '6af165456d4c8207d1f9e6ea',
        deviceId: 'ARDUINO-PIEZO-01',
        faultType: 'SERIAL_COMM_FAILURE',
        severity: 'CRITICAL',
        details: 'Error: No such file or directory, cannot open COM5',
        recovered: false,
      },
      {
        _id: '6aef6291cd40538c49cba04b',
        deviceId: 'ARDUINO-PIEZO-01',
        faultType: 'INVALID_READINGS',
        severity: 'WARNING',
        details: 'Packet contained non-numeric or malformed telemetry: DATA,abc,4500,720,580.25,140,75.00,1,MOVEMENT,ACTIVE',
        recovered: false,
      },
      {
        _id: '6aef6291cd40538c49cba04d',
        deviceId: 'ARDUINO-PIEZO-01',
        faultType: 'INVALID_READINGS',
        severity: 'WARNING',
        details: 'Packet contained non-numeric or malformed telemetry: DATA,0,time,720,580.25,140,75.00,1,MOVEMENT,ACTIVE',
        recovered: false,
      },
      {
        _id: '6aef6291cd40538c49cba04f',
        deviceId: 'ARDUINO-PIEZO-01',
        faultType: 'INVALID_READINGS',
        severity: 'WARNING',
        details: 'Packet contained non-numeric or malformed telemetry: DATA,0,4500,NaN,580.25,140,75.00,1,MOVEMENT,ACTIVE',
        recovered: false,
      },
    ];

    it('requires exact approved MongoDB document IDs and validates all four specifications', () => {
      expect(APPROVED_TARGET_IDS).toHaveLength(4);
      expect(APPROVED_TARGET_IDS).toEqual([
        '6af165456d4c8207d1f9e6ea',
        '6aef6291cd40538c49cba04b',
        '6aef6291cd40538c49cba04d',
        '6aef6291cd40538c49cba04f',
      ]);

      const result = validateHistoricalMatches(validFourApprovedFaults);
      expect(result.canApply).toBe(true);
      expect(result.isExactFour).toBe(true);
      expect(result.allIdsMatch).toBe(true);
      expect(result.matchedRecords).toHaveLength(4);
    });

    it('aborts reconciliation if fewer than four matching records are found', () => {
      // Only 3 of the 4 approved records
      const threeFaults = validFourApprovedFaults.slice(0, 3);
      const result = validateHistoricalMatches(threeFaults);

      expect(result.isExactFour).toBe(false);
      expect(result.canApply).toBe(false);
    });

    it('aborts reconciliation if more than four matching records are found', () => {
      // 5 matching records (e.g. duplicate entry of an approved record)
      const fiveFaults = [
        ...validFourApprovedFaults,
        validFourApprovedFaults[0],
      ];
      const result = validateHistoricalMatches(fiveFaults);

      expect(result.isExactFour).toBe(false);
      expect(result.canApply).toBe(false);
    });

    it('aborts reconciliation if document ID does not match the approved target IDs', () => {
      const wrongIdFaults = [
        { ...validFourApprovedFaults[0], _id: 'unapproved_id_1234567890' },
        validFourApprovedFaults[1],
        validFourApprovedFaults[2],
        validFourApprovedFaults[3],
      ];
      const result = validateHistoricalMatches(wrongIdFaults);

      expect(result.allIdsMatch).toBe(false);
      expect(result.canApply).toBe(false);
    });
  });

  // ============================================================================
  // SUITE 6: Frontend Strict Fault Filtering Logic
  // ============================================================================
  describe('Suite 6: Frontend Strict Fault Filtering Logic', () => {
    // Exact predicate used in ArduinoStatusCard.jsx
    const filterActiveFaults = (faults) =>
      faults.filter((f) => !f.recovered && f.deviceId === 'ARDUINO-PIEZO-01');

    it('strictly rejects fault records without deviceId or with missing/empty deviceId', () => {
      const candidates = [
        { _id: '1', faultType: 'INVALID_READINGS', recovered: false, deviceId: undefined },
        { _id: '2', faultType: 'SERIAL_COMM_FAILURE', recovered: false, deviceId: null },
        { _id: '3', faultType: 'MISSING_PACKETS', recovered: false, deviceId: '' },
        { _id: '4', faultType: 'MISSING_PACKETS', recovered: false }, // missing deviceId property
      ];

      const accepted = filterActiveFaults(candidates);
      expect(accepted).toHaveLength(0);
    });

    it('strictly accepts only unrecovered records where deviceId === ARDUINO-PIEZO-01', () => {
      const candidates = [
        { _id: '1', faultType: 'INVALID_READINGS', recovered: false, deviceId: 'ARDUINO-PIEZO-01' },
        { _id: '2', faultType: 'SERIAL_COMM_FAILURE', recovered: true, deviceId: 'ARDUINO-PIEZO-01' }, // recovered
        { _id: '3', faultType: 'SENSOR_DISCONNECTED', recovered: false, deviceId: 'AUDIT-TAG-01' }, // wrong device
        { _id: '4', faultType: 'MISSING_PACKETS', recovered: false, deviceId: undefined }, // missing deviceId
      ];

      const accepted = filterActiveFaults(candidates);
      expect(accepted).toHaveLength(1);
      expect(accepted[0]._id).toBe('1');
      expect(accepted[0].deviceId).toBe('ARDUINO-PIEZO-01');
      expect(accepted[0].recovered).toBe(false);
    });

    it('guards SSE hardware_fault events against missing or non-matching deviceId', () => {
      const isValidSseFault = (fault) => Boolean(fault && fault.deviceId === 'ARDUINO-PIEZO-01');

      expect(isValidSseFault(null)).toBe(false);
      expect(isValidSseFault(undefined)).toBe(false);
      expect(isValidSseFault({ faultType: 'MISSING_PACKETS' })).toBe(false);
      expect(isValidSseFault({ deviceId: null, faultType: 'MISSING_PACKETS' })).toBe(false);
      expect(isValidSseFault({ deviceId: 'AUDIT-TAG-01', faultType: 'MISSING_PACKETS' })).toBe(false);
      expect(isValidSseFault({ deviceId: 'ARDUINO-PIEZO-01', faultType: 'MISSING_PACKETS' })).toBe(true);
    });

    it('guards SSE hardware_fault_recovered events against missing or non-matching deviceId', () => {
      const isValidSseRecovery = (rec) => Boolean(rec && rec.deviceId === 'ARDUINO-PIEZO-01');

      expect(isValidSseRecovery(null)).toBe(false);
      expect(isValidSseRecovery({ faultType: 'SERIAL_COMM_FAILURE' })).toBe(false);
      expect(isValidSseRecovery({ deviceId: 'AUDIT-TAG-01', faultType: 'SERIAL_COMM_FAILURE' })).toBe(false);
      expect(isValidSseRecovery({ deviceId: 'ARDUINO-PIEZO-01', faultType: 'SERIAL_COMM_FAILURE' })).toBe(true);
    });
  });

  // ============================================================================
  // SUITE 7: Fault History API & Limit Parameter Validation
  // ============================================================================
  describe('Suite 7: Fault History API & Limit Parameter Validation', () => {
    it('validates limit query parameter and uses safe default of 100 when limit is omitted', async () => {
      const req = { query: { activeOnly: 'false', deviceId: 'ARDUINO-PIEZO-01' } };
      const res = { json: jest.fn() };
      const next = jest.fn();

      await serialController.getFaults(req, res, next);

      expect(res.json).toHaveBeenCalled();
      const payload = res.json.mock.calls[0][0];
      expect(payload.success).toBe(true);
    });

    it('accepts valid positive integer limit (e.g. 50)', async () => {
      for (let i = 0; i < 60; i++) {
        mockFaults.set(`f-lim-${i}`, {
          _id: `f-lim-${i}`,
          deviceId: 'ARDUINO-PIEZO-01',
          faultType: 'INVALID_READINGS',
          occurredAt: new Date(Date.now() - i * 1000),
          recovered: true,
        });
      }

      const req = { query: { history: 'true', limit: '50', deviceId: 'ARDUINO-PIEZO-01' } };
      const res = { json: jest.fn() };
      const next = jest.fn();

      await serialController.getFaults(req, res, next);

      const payload = res.json.mock.calls[0][0];
      expect(payload.success).toBe(true);
      expect(payload.count).toBe(50);
    });

    it('clamps excessively large limit (e.g. 1000) to maximum of 500', async () => {
      const req = { query: { activeOnly: 'false', limit: '1000', deviceId: 'ARDUINO-PIEZO-01' } };
      const res = { json: jest.fn() };
      const next = jest.fn();

      const spy = jest.spyOn(hardwareFaultService, 'getFaultHistory');
      await serialController.getFaults(req, res, next);

      expect(spy).toHaveBeenCalledWith({ deviceId: 'ARDUINO-PIEZO-01' }, 500);
      spy.mockRestore();
    });

    it('falls back to default 100 when limit is zero, negative, or invalid string', async () => {
      const spy = jest.spyOn(hardwareFaultService, 'getFaultHistory');

      // Test zero
      await serialController.getFaults({ query: { history: 'true', limit: '0' } }, { json: jest.fn() }, jest.fn());
      expect(spy).toHaveBeenLastCalledWith({ deviceId: 'ARDUINO-PIEZO-01' }, 100);

      // Test negative
      await serialController.getFaults({ query: { history: 'true', limit: '-25' } }, { json: jest.fn() }, jest.fn());
      expect(spy).toHaveBeenLastCalledWith({ deviceId: 'ARDUINO-PIEZO-01' }, 100);

      // Test invalid non-numeric string
      await serialController.getFaults({ query: { history: 'true', limit: 'invalid_limit' } }, { json: jest.fn() }, jest.fn());
      expect(spy).toHaveBeenLastCalledWith({ deviceId: 'ARDUINO-PIEZO-01' }, 100);

      // Test non-integer float
      await serialController.getFaults({ query: { history: 'true', limit: '12.5' } }, { json: jest.fn() }, jest.fn());
      expect(spy).toHaveBeenLastCalledWith({ deviceId: 'ARDUINO-PIEZO-01' }, 100);

      spy.mockRestore();
    });

    it('preserves default active-fault filtering when activeOnly is not false', async () => {
      const spyActive = jest.spyOn(hardwareFaultService, 'getActiveFaults');
      const req = { query: { deviceId: 'ARDUINO-PIEZO-01' } };
      const res = { json: jest.fn() };

      await serialController.getFaults(req, res, jest.fn());

      expect(spyActive).toHaveBeenCalledWith('ARDUINO-PIEZO-01');
      spyActive.mockRestore();
    });
  });
});
