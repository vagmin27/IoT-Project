const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../src/app');
const { connectDB, disconnectDB, getDBStatus, sanitizeUri } = require('../src/config/db');
const Patient = require('../src/models/Patient');
const Device = require('../src/models/Device');
const Alert = require('../src/models/Alert');
const SensorEvent = require('../src/models/SensorEvent');
const simulatorService = require('../src/services/simulator.service');
const sensorService = require('../src/services/sensor.service');
const sseManager = require('../src/sockets/sse.manager');
const http = require('http');

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  await connectDB();
  // Ensure schema indexes (especially unique compound indexes) are built
  await Patient.init();
  await Device.init();
  await Alert.init();
  await SensorEvent.init();
  // Clear test collections for isolated clean test run
  await Patient.deleteMany({});
  await Device.deleteMany({});
  await Alert.deleteMany({});
  await SensorEvent.deleteMany({});
});

afterAll(async () => {
  simulatorService.stopAutoLoop();
  sseManager.clear();
  await disconnectDB();
});

describe('Hospital Mobility Project — MongoDB Integration Tests', () => {
  let testPatient;
  let testDevice;

  beforeAll(async () => {
    testPatient = await Patient.create({
      name: 'Test Synthetic Patient',
      roomNumber: '101',
      bedNumber: 'Bed-A',
      status: 'ADMITTED',
      assignedDeviceId: 'SIM-TAG-TEST-01',
      movementStatus: 'STATIONARY',
      synthetic: true,
    });

    testDevice = await Device.create({
      deviceCode: 'SIM-TAG-TEST-01',
      status: 'ACTIVE',
      batteryLevel: 98,
      assignedPatientId: testPatient._id,
    });
  });

  // =========================================================================
  // 1. MongoDB Connection and Failure Handling
  // =========================================================================
  describe('1. MongoDB Connection, Health Endpoint, and Failure Handling', () => {
    it('should have automatic background simulation disabled by default', () => {
      const status = simulatorService.getStatus();
      expect(status.isAutoRunning).toBe(false);
    });

    it('getDBStatus returns structured connection status and host info', () => {
      const dbStatus = getDBStatus();
      expect(dbStatus.connected).toBe(true);
      expect(dbStatus.readyState).toBe(1);
      expect(dbStatus.status).toBe('connected');
      expect(dbStatus.host).toBeDefined();
    });

    it('health check endpoint distinguishes application health from database connectivity', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('healthy');
      expect(res.body.application).toBe('healthy');
      expect(res.body.database).toBeDefined();
      expect(res.body.database.connected).toBe(true);
      expect(res.body.database.status).toBe('connected');
    });

    it('sanitizeUri correctly strips credentials from connection strings and logs', () => {
      const sample = 'mongodb://admin_user:secret_password_123@cluster0.net:27017/test?ssl=true';
      const sanitized = sanitizeUri(sample);
      expect(sanitized).not.toContain('admin_user');
      expect(sanitized).not.toContain('secret_password_123');
      expect(sanitized).toBe('mongodb://***:***@cluster0.net:27017/test?ssl=true');
    });

    it('handles connection failures cleanly without crashing or exposing credentials', async () => {
      const unreachableUri = 'mongodb://testuser:supersecretpass@127.0.0.1:29999/unreachable_db';
      let caughtError = null;
      try {
        await connectDB(unreachableUri, { serverSelectionTimeoutMS: 500 });
      } catch (err) {
        caughtError = err;
      } finally {
        // Reconnect to test database for subsequent tests
        await connectDB();
      }
      expect(caughtError).toBeDefined();
      // Verify credentials are NOT present in sanitized logs/messages
      expect(caughtError.message).not.toContain('supersecretpass');
      expect(getDBStatus().connected).toBe(true);
    }, 10000);
  });

  // =========================================================================
  // 2. Patient and Device Persistence Across Application Restarts
  // =========================================================================
  describe('2. Patient and Device Persistence Across Application Restarts', () => {
    it('persists synthetic patient and device records through disconnect and reconnect cycles', async () => {
      const p = await Patient.create({
        name: 'Restart Persistence Patient',
        roomNumber: '204',
        bedNumber: 'Bed-B',
        status: 'ADMITTED',
        assignedDeviceId: 'PERSIST-RESTART-01',
        movementStatus: 'STATIONARY',
        synthetic: true,
      });

      const d = await Device.create({
        deviceCode: 'PERSIST-RESTART-01',
        status: 'ACTIVE',
        batteryLevel: 94,
        assignedPatientId: p._id,
      });

      // Simulate application / database shutdown
      await disconnectDB();
      expect(mongoose.connection.readyState).toBe(0);

      // Simulate application restart and reconnection
      await connectDB();
      expect(mongoose.connection.readyState).toBe(1);

      // Verify persistent state in MongoDB
      const loadedPatient = await Patient.findById(p._id);
      expect(loadedPatient).not.toBeNull();
      expect(loadedPatient.name).toBe('Restart Persistence Patient');
      expect(loadedPatient.roomNumber).toBe('204');
      expect(loadedPatient.assignedDeviceId).toBe('PERSIST-RESTART-01');

      const loadedDevice = await Device.findById(d._id);
      expect(loadedDevice).not.toBeNull();
      expect(loadedDevice.deviceCode).toBe('PERSIST-RESTART-01');
      expect(loadedDevice.assignedPatientId.toString()).toBe(p._id.toString());
    });

    it('GET /api/patients returns persistent patient list from MongoDB', async () => {
      const res = await request(app).get('/api/patients');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
    });

    it('GET /api/patients/:id returns specific patient from MongoDB', async () => {
      const res = await request(app).get(`/api/patients/${testPatient._id}`);
      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Test Synthetic Patient');
    });
  });

  // =========================================================================
  // 3. Sensor Event Persistence and Duplicate Rejection
  // =========================================================================
  describe('3. Sensor Event Persistence, Unique Indexes, and Duplicate Rejection', () => {
    it('persists sensor telemetry events into MongoDB collection with metrics', async () => {
      const telemetry = {
        deviceId: 'SIM-TAG-TEST-01',
        patientId: testPatient._id,
        sequenceNumber: 101,
        timestamp: new Date(),
        movementState: 'WALKING',
        metrics: { accelMagnitude: 1.15, pitch: 10.2, roll: -3.5 },
      };

      const result = await sensorService.ingestTelemetry(telemetry);
      expect(result.success).toBe(true);
      expect(result.duplicate).toBe(false);
      expect(result.event).toBeDefined();

      // Verify direct database persistence
      const saved = await SensorEvent.findById(result.event._id);
      expect(saved).not.toBeNull();
      expect(saved.deviceId).toBe('SIM-TAG-TEST-01');
      expect(saved.sequenceNumber).toBe(101);
      expect(saved.metrics.accelMagnitude).toBe(1.15);
      expect(saved.processed).toBe(true);
    });

    it('discards duplicate telemetry matching deviceId + sequenceNumber without creating duplicate records or alerts', async () => {
      const duplicatePayload = {
        deviceId: 'SIM-TAG-IDEMPOTENT',
        patientId: testPatient._id,
        sequenceNumber: 7777,
        timestamp: new Date(),
        movementState: 'FALL_IMPACT',
        metrics: { accelMagnitude: 3.5, pitch: 80, roll: -80 },
      };

      // 1. Initial ingestion -> succeeds and creates alert
      const firstRes = await sensorService.ingestTelemetry(duplicatePayload);
      expect(firstRes.success).toBe(true);
      expect(firstRes.duplicate).toBe(false);
      expect(firstRes.alert).toBeDefined();

      const eventCountBefore = await SensorEvent.countDocuments({ deviceId: 'SIM-TAG-IDEMPOTENT', sequenceNumber: 7777 });
      const alertCountBefore = await Alert.countDocuments();

      // 2. Duplicate ingestion with identical deviceId and sequenceNumber
      const secondRes = await sensorService.ingestTelemetry(duplicatePayload);
      expect(secondRes.success).toBe(false);
      expect(secondRes.duplicate).toBe(true);

      // Verify no duplicate records created in MongoDB
      const eventCountAfter = await SensorEvent.countDocuments({ deviceId: 'SIM-TAG-IDEMPOTENT', sequenceNumber: 7777 });
      const alertCountAfter = await Alert.countDocuments();
      expect(eventCountAfter).toBe(eventCountBefore);
      expect(alertCountAfter).toBe(alertCountBefore);
    });

    it('enforces compound unique index on deviceId + sequenceNumber at MongoDB database level', async () => {
      // Attempt to directly insert a record with duplicate deviceId + sequenceNumber
      let duplicateError = null;
      try {
        await SensorEvent.create({
          deviceId: 'SIM-TAG-IDEMPOTENT',
          patientId: testPatient._id,
          sequenceNumber: 7777, // already exists
          movementState: 'WALKING',
          metrics: { accelMagnitude: 1.0 },
        });
      } catch (err) {
        duplicateError = err;
      }
      expect(duplicateError).toBeDefined();
      expect(duplicateError.code).toBe(11000); // MongoDB duplicate key error code
    });
  });

  // =========================================================================
  // 4. Fall Alert Creation and Persistence
  // =========================================================================
  describe('4. Fall Alert Creation and Persistence', () => {
    it('POST /api/simulator/fall creates a CRITICAL fall alert persisted in MongoDB', async () => {
      const res = await request(app)
        .post('/api/simulator/fall')
        .send({ patientId: testPatient._id });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.scenario).toBe('FALL_IMPACT');
      expect(res.body.data.alert).toBeDefined();

      const alertId = res.body.data.alert._id;

      // Verify persistence in MongoDB alerts collection
      const savedAlert = await Alert.findById(alertId);
      expect(savedAlert).not.toBeNull();
      expect(savedAlert.severity).toBe('CRITICAL');
      expect(savedAlert.status).toBe('ACTIVE');
      expect(savedAlert.alertType).toBe('FALL_DETECTED');
      expect(savedAlert.deviceId).toBe('SIM-TAG-TEST-01');

      // Verify patient status was set to STATIONARY after fall
      const patientAfterFall = await Patient.findById(testPatient._id);
      expect(patientAfterFall.movementStatus).toBe('STATIONARY');
    });
  });

  // =========================================================================
  // 5. Acknowledgement and Resolution Persistence
  // =========================================================================
  describe('5. Acknowledgement and Resolution Persistence in MongoDB', () => {
    let activeAlertId;

    beforeAll(async () => {
      const activeAlert = await Alert.findOne({ status: 'ACTIVE' });
      activeAlertId = activeAlert._id;
    });

    it('PATCH /api/alerts/:id/acknowledge updates and persists ACKNOWLEDGED status with staff ID', async () => {
      const res = await request(app)
        .patch(`/api/alerts/${activeAlertId}/acknowledge`)
        .send({
          staffId: 'STAFF-RN-SARAH',
          notes: 'Caregiver attending patient at bedside.',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('ACKNOWLEDGED');

      // Verify directly from MongoDB
      const dbAlert = await Alert.findById(activeAlertId);
      expect(dbAlert.status).toBe('ACKNOWLEDGED');
      expect(dbAlert.acknowledgedBy).toBe('STAFF-RN-SARAH');
      expect(dbAlert.acknowledgedAt).toBeDefined();
      expect(dbAlert.notes).toBe('Caregiver attending patient at bedside.');
    });

    it('PATCH /api/alerts/:id/resolve updates and persists RESOLVED status and timestamp', async () => {
      const res = await request(app)
        .patch(`/api/alerts/${activeAlertId}/resolve`)
        .send({
          staffId: 'STAFF-RN-SARAH',
          notes: 'Patient evaluated, no injury, assisted back into bed.',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('RESOLVED');

      // Verify directly from MongoDB
      const dbAlert = await Alert.findById(activeAlertId);
      expect(dbAlert.status).toBe('RESOLVED');
      expect(dbAlert.resolvedAt).toBeDefined();
      expect(dbAlert.notes).toBe('Patient evaluated, no injury, assisted back into bed.');
    });
  });

  // =========================================================================
  // 6. Inactivity Updates Without Alerts
  // =========================================================================
  describe('6. Inactivity Updates Without Creating Alerts', () => {
    it('POST /api/simulator/inactivity updates patient status to STATIONARY and creates ZERO alerts', async () => {
      // First put patient into WALKING
      await Patient.findByIdAndUpdate(testPatient._id, { movementStatus: 'WALKING' });

      const alertCountBefore = await Alert.countDocuments();

      const res = await request(app)
        .post('/api/simulator/inactivity')
        .send({ patientId: testPatient._id });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.scenario).toBe('INACTIVITY');

      // Verify patient status is updated to STATIONARY in MongoDB
      const updatedPatient = await Patient.findById(testPatient._id);
      expect(updatedPatient.movementStatus).toBe('STATIONARY');

      // Crucial: Verify zero alerts generated in MongoDB
      const alertCountAfter = await Alert.countDocuments();
      expect(alertCountAfter).toBe(alertCountBefore);
    });

    it('POST /api/simulator/walk updates patient status to WALKING in MongoDB', async () => {
      const res = await request(app)
        .post('/api/simulator/walk')
        .send({ patientId: testPatient._id });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.scenario).toBe('WALKING');

      const updatedPatient = await Patient.findById(testPatient._id);
      expect(updatedPatient.movementStatus).toBe('WALKING');
    });
  });

  // =========================================================================
  // 7. SSE Event Delivery and Reconnection Behavior
  // =========================================================================
  describe('7. Server-Sent Events (SSE) Delivery and Reconnection Behavior', () => {
    it('GET /api/events/stream responds with text/event-stream and keep-alive headers', (done) => {
      const server = app.listen(0, () => {
        const port = server.address().port;
        const req = http.get(`http://localhost:${port}/api/events/stream`, (res) => {
          expect(res.headers['content-type']).toContain('text/event-stream');
          expect(res.headers['connection']).toBe('keep-alive');
          expect(res.headers['cache-control']).toContain('no-cache');
          res.destroy();
          req.destroy();
          server.close(done);
        });

        req.on('error', (err) => {
          if (err.code !== 'ECONNRESET') done(err);
        });
      });
    });

    it('delivers broadcast events with monotonic IDs and supports Last-Event-ID replay from memory buffer', (done) => {
      const server = app.listen(0, () => {
        const port = server.address().port;
        const eventId = sseManager.broadcast('test_monotonic_event', { key: 'value1' });
        expect(typeof eventId).toBe('number');
        expect(eventId).toBeGreaterThan(0);

        // Reconnect with Last-Event-ID header (requesting replay of events after eventId - 1)
        const options = {
          hostname: 'localhost',
          port,
          path: '/api/events/stream',
          headers: {
            'Last-Event-ID': String(eventId - 1),
          },
        };

        const req = http.get(options, (res) => {
          let buffer = '';
          res.on('data', (chunk) => {
            buffer += chunk.toString();
            if (buffer.includes('test_monotonic_event')) {
              expect(buffer).toContain(`id: ${eventId}`);
              expect(buffer).toContain('event: test_monotonic_event');
              res.destroy();
              req.destroy();
              server.close(done);
            }
          });
        });

        req.on('error', (err) => {
          if (err.code !== 'ECONNRESET') done(err);
        });
      });
    });
  });
});
