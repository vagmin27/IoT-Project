const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../src/app');
const { connectDB, disconnectDB } = require('../src/config/db');
const Patient = require('../src/models/Patient');
const Alert = require('../src/models/Alert');
const SensorEvent = require('../src/models/SensorEvent');
const simulatorService = require('../src/services/simulator.service');
const sensorService = require('../src/services/sensor.service');
const sseManager = require('../src/sockets/sse.manager');
const http = require('http');

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  await connectDB();
  // Clear collections for clean test run
  await Patient.deleteMany({});
  await Alert.deleteMany({});
  await SensorEvent.deleteMany({});
});

afterAll(async () => {
  simulatorService.stopAutoLoop();
  sseManager.clear();
  await disconnectDB();
});

describe('Hospital Mobility Backend (MERN Stack Tests)', () => {
  let testPatient;

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
  });

  describe('1. Startup Configuration & Default States', () => {
    it('should have automatic background simulation disabled by default', () => {
      const status = simulatorService.getStatus();
      expect(status.isAutoRunning).toBe(false);
    });

    it('health check endpoint responds with healthy status', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('healthy');
    });
  });

  describe('2. Patient Management REST Endpoints', () => {
    it('GET /api/patients returns the patient list', async () => {
      const res = await request(app).get('/api/patients');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
    });

    it('GET /api/patients/:id returns specific patient', async () => {
      const res = await request(app).get(`/api/patients/${testPatient._id}`);
      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Test Synthetic Patient');
    });
  });

  describe('3. Manual Simulation Controls & Inactivity Policy', () => {
    it('POST /api/simulator/walk triggers deterministic walking telemetry and updates patient status', async () => {
      const res = await request(app)
        .post('/api/simulator/walk')
        .send({ patientId: testPatient._id });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.scenario).toBe('WALKING');
      expect(res.body.data.event.movementState).toBe('WALKING');

      const updatedPatient = await Patient.findById(testPatient._id);
      expect(updatedPatient.movementStatus).toBe('WALKING');
    });

    it('POST /api/simulator/inactivity updates status to STATIONARY and creates ZERO alerts', async () => {
      const initialAlertCount = await Alert.countDocuments();

      const res = await request(app)
        .post('/api/simulator/inactivity')
        .send({ patientId: testPatient._id });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.scenario).toBe('INACTIVITY');

      // Patient status is updated to STATIONARY
      const updatedPatient = await Patient.findById(testPatient._id);
      expect(updatedPatient.movementStatus).toBe('STATIONARY');

      // Crucial: No alert generated for inactivity!
      const afterAlertCount = await Alert.countDocuments();
      expect(afterAlertCount).toBe(initialAlertCount);
    });

    it('POST /api/simulator/fall generates an immediate CRITICAL alert', async () => {
      const res = await request(app)
        .post('/api/simulator/fall')
        .send({ patientId: testPatient._id });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.scenario).toBe('FALL_IMPACT');
      expect(res.body.data.alert).toBeDefined();
      expect(res.body.data.alert.severity).toBe('CRITICAL');
      expect(res.body.data.alert.status).toBe('ACTIVE');
    });
  });

  describe('4. Idempotency & Duplicate Telemetry Discarding', () => {
    it('discards duplicate telemetry matching deviceId + sequenceNumber without creating duplicate alerts', async () => {
      const duplicatePayload = {
        deviceId: 'SIM-TAG-IDEMPOTENT',
        patientId: testPatient._id,
        sequenceNumber: 9999,
        timestamp: new Date(),
        movementState: 'FALL_IMPACT',
        metrics: { accelMagnitude: 3.5, pitch: 80, roll: -80 },
      };

      // First ingestion -> should succeed and generate alert
      const firstRes = await sensorService.ingestTelemetry(duplicatePayload);
      expect(firstRes.success).toBe(true);
      expect(firstRes.duplicate).toBe(false);
      expect(firstRes.alert).toBeDefined();

      const alertCountBefore = await Alert.countDocuments();

      // Second ingestion with SAME sequenceNumber -> must be discarded as duplicate!
      const secondRes = await sensorService.ingestTelemetry(duplicatePayload);
      expect(secondRes.success).toBe(false);
      expect(secondRes.duplicate).toBe(true);

      const alertCountAfter = await Alert.countDocuments();
      expect(alertCountAfter).toBe(alertCountBefore); // No duplicate alert created
    });
  });

  describe('5. Alert Lifecycle: Acknowledge & Resolve Workflow', () => {
    let activeAlertId;

    beforeAll(async () => {
      const activeAlert = await Alert.findOne({ status: 'ACTIVE' });
      activeAlertId = activeAlert._id;
    });

    it('PATCH /api/alerts/:id/acknowledge updates alert to ACKNOWLEDGED with staff ID and timestamp', async () => {
      const res = await request(app)
        .patch(`/api/alerts/${activeAlertId}/acknowledge`)
        .send({
          staffId: 'STAFF-RN-SARAH',
          notes: 'Responding to Room 101 immediately.',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('ACKNOWLEDGED');
      expect(res.body.data.acknowledgedBy).toBe('STAFF-RN-SARAH');
      expect(res.body.data.acknowledgedAt).toBeDefined();
    });

    it('PATCH /api/alerts/:id/resolve closes the alert with RESOLVED status', async () => {
      const res = await request(app)
        .patch(`/api/alerts/${activeAlertId}/resolve`)
        .send({
          staffId: 'STAFF-RN-SARAH',
          notes: 'Patient assisted back to bed safely. Vitals normal.',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('RESOLVED');
      expect(res.body.data.resolvedAt).toBeDefined();
    });
  });

  describe('6. Server-Sent Events (SSE) Endpoint', () => {
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
          // Socket destroyed error is expected when closing manually
          if (err.code !== 'ECONNRESET') {
            done(err);
          }
        });
      });
    });
  });
});
