const { verifyGatewaySecret } = require('../src/middleware/gatewayAuth');
const iotController = require('../src/controllers/iot.controller');
const serialBridgeService = require('../src/services/serialBridge.service');

jest.mock('../src/repositories/piezoEvent.repository', () => ({
  getLatestSequenceForDevice: jest.fn().mockResolvedValue(3256),
}));

const TEST_SECRET = 'secure_gateway_test_secret_32byteslong!';
process.env.GATEWAY_SECRET = TEST_SECRET;

function createMockReqRes({ headers = {}, body = {}, method = 'POST', path = '/api/iot/telemetry' } = {}) {
  const req = {
    headers: { ...headers },
    body: { ...body },
    method,
    path,
  };

  let statusCode = 200;
  let jsonResponse = null;

  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      jsonResponse = data;
      return this;
    },
    getStatusCode: () => statusCode,
    getResponse: () => jsonResponse,
  };

  const next = jest.fn();

  return { req, res, next, getStatus: () => statusCode, getBody: () => jsonResponse };
}

describe('IoT Gateway Direct Unit Tests (No TCP Binding Needed)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('1. verifyGatewaySecret Middleware', () => {
    it('rejects request with 401 when no secret header is present', () => {
      const { req, res, next, getStatus, getBody } = createMockReqRes();

      verifyGatewaySecret(req, res, next);

      expect(getStatus()).toBe(401);
      expect(getBody().success).toBe(false);
      expect(getBody().message).toMatch(/Missing gateway secret/i);
      expect(next).not.toHaveBeenCalled();
    });

    it('rejects request with 403 when an invalid secret header is provided', () => {
      const { req, res, next, getStatus, getBody } = createMockReqRes({
        headers: { 'x-gateway-secret': 'wrong_secret_token_12345' },
      });

      verifyGatewaySecret(req, res, next);

      expect(getStatus()).toBe(403);
      expect(getBody().success).toBe(false);
      expect(getBody().message).toMatch(/Invalid gateway secret/i);
      expect(next).not.toHaveBeenCalled();
    });

    it('calls next() when a valid x-gateway-secret is provided', () => {
      const { req, res, next, getStatus } = createMockReqRes({
        headers: { 'x-gateway-secret': TEST_SECRET },
      });

      verifyGatewaySecret(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(getStatus()).toBe(200);
    });

    it('calls next() when valid secret is provided via Authorization Bearer header', () => {
      const { req, res, next } = createMockReqRes({
        headers: { authorization: `Bearer ${TEST_SECRET}` },
      });

      verifyGatewaySecret(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe('2. IotController Ingestion Logic', () => {
    it('returns 400 when payload has no line or lines', async () => {
      const { req, res, next, getStatus, getBody } = createMockReqRes({
        body: {},
      });

      await iotController.ingestTelemetry(req, res, next);

      expect(getStatus()).toBe(400);
      expect(getBody().success).toBe(false);
      expect(getBody().message).toMatch(/Payload must contain/i);
    });

    it('returns 201 when telemetry line is valid and stored', async () => {
      const mockSavedEvent = {
        _id: 'mock_event_456',
        sequenceNumber: 42,
        raw: 250,
        event: 'MOVEMENT',
        status: 'ACTIVE',
      };

      jest.spyOn(serialBridgeService, 'handleIncomingLine').mockResolvedValueOnce({
        success: true,
        event: mockSavedEvent,
      });

      const { req, res, next, getStatus, getBody } = createMockReqRes({
        body: {
          line: 'DATA,42,42000,250,45.0,205,30.0,7,MOVEMENT,ACTIVE',
          arduinoSerialStatus: 'CONNECTED',
          port: 'COM5',
        },
      });

      await iotController.ingestTelemetry(req, res, next);

      expect(getStatus()).toBe(201);
      expect(getBody().success).toBe(true);
      expect(getBody().duplicate).toBe(false);
      expect(getBody().data.sequenceNumber).toBe(42);
      expect(serialBridgeService.isGatewayAlive()).toBe(true);
    });

    it('returns 200 with duplicate: true when sequence is already known', async () => {
      jest.spyOn(serialBridgeService, 'handleIncomingLine').mockResolvedValueOnce({
        duplicate: true,
      });

      const { req, res, next, getStatus, getBody } = createMockReqRes({
        body: {
          line: 'DATA,42,42000,250,45.0,205,30.0,7,MOVEMENT,ACTIVE',
        },
      });

      await iotController.ingestTelemetry(req, res, next);

      expect(getStatus()).toBe(200);
      expect(getBody().success).toBe(true);
      expect(getBody().duplicate).toBe(true);
    });

    it('returns 400 MALFORMED_TELEMETRY when a DATA line fails parsing/validation checks', async () => {
      jest.spyOn(serialBridgeService, 'handleIncomingLine').mockResolvedValueOnce(null);

      const { req, res, next, getStatus, getBody } = createMockReqRes({
        body: { line: 'DATA,bad_packet_corrupted' },
      });

      await iotController.ingestTelemetry(req, res, next);

      expect(getStatus()).toBe(400);
      expect(getBody().success).toBe(false);
      expect(getBody().error).toBe('MALFORMED_TELEMETRY');
    });

    it('handles diagnostic and startup lines gracefully with 200 OK', async () => {
      jest.spyOn(serialBridgeService, 'handleIncomingLine').mockResolvedValueOnce(null);

      const { req, res, next, getStatus, getBody } = createMockReqRes({
        body: { line: 'STATUS:SENSOR_READY' },
      });

      await iotController.ingestTelemetry(req, res, next);

      expect(getStatus()).toBe(200);
      expect(getBody().success).toBe(true);
      expect(getBody().type).toBe('DIAGNOSTIC');
    });

    it('handles CSV header lines gracefully with 200 OK and type: HEADER', async () => {
      jest.spyOn(serialBridgeService, 'handleIncomingLine').mockResolvedValueOnce(null);

      const { req, res, next, getStatus, getBody } = createMockReqRes({
        body: { line: 'TYPE,SEQUENCE,TIME_MS,RAW,BASELINE,DEVIATION,THRESHOLD,MOVEMENT_COUNT,EVENT,STATUS' },
      });

      await iotController.ingestTelemetry(req, res, next);

      expect(getStatus()).toBe(200);
      expect(getBody().success).toBe(true);
      expect(getBody().type).toBe('HEADER');
    });

    it('rejects completely unrecognized garbage strings with 400 UNRECOGNIZED_FORMAT', async () => {
      jest.spyOn(serialBridgeService, 'handleIncomingLine').mockResolvedValueOnce(null);

      const { req, res, next, getStatus, getBody } = createMockReqRes({
        body: { line: 'RANDOM_GARBAGE_LINE_12345' },
      });

      await iotController.ingestTelemetry(req, res, next);

      expect(getStatus()).toBe(400);
      expect(getBody().success).toBe(false);
      expect(getBody().error).toBe('UNRECOGNIZED_FORMAT');
    });

    it('handles batch lines correctly with ordering and partial failure isolation', async () => {
      jest.spyOn(serialBridgeService, 'handleIncomingLine')
        .mockResolvedValueOnce({ success: true, event: { _id: 'e1' } })
        .mockResolvedValueOnce({ duplicate: true })
        .mockResolvedValueOnce(null); // corrupted packet

      const { req, res, next, getStatus, getBody } = createMockReqRes({
        body: {
          lines: [
            'DATA,1,1000,45,45.0,0,30.0,0,NONE,ACTIVE',
            'DATA,1,1000,45,45.0,0,30.0,0,NONE,ACTIVE',
            'DATA,corrupt,bad,packet',
          ],
        },
      });

      await iotController.ingestTelemetry(req, res, next);

      expect(getStatus()).toBe(200);
      expect(getBody().batch).toBe(true);
      expect(getBody().total).toBe(3);
      expect(getBody().newRecords).toBe(1);
      expect(getBody().duplicates).toBe(1);
      expect(getBody().errors).toBe(1);
      expect(getBody().results[0].duplicate).toBe(false);
      expect(getBody().results[1].duplicate).toBe(true);
      expect(getBody().results[2].error).toBe('MALFORMED_TELEMETRY');
    });
  });

  describe('3. Gateway Status & Heartbeat Tracking', () => {
    it('records heartbeat and reports gateway status', async () => {
      const { req, res, next, getStatus, getBody } = createMockReqRes({
        body: {
          arduinoSerialStatus: 'CONNECTED',
          port: 'COM5',
          baudRate: 9600,
        },
      });

      await iotController.recordHeartbeat(req, res, next);

      expect(getStatus()).toBe(200);
      expect(getBody().success).toBe(true);
      expect(getBody().status.connected).toBe(true);
      expect(getBody().status.port).toBe('COM5');
    });

    it('provides gateway status on getGatewayStatus', async () => {
      const { req, res, next, getStatus, getBody } = createMockReqRes();

      await iotController.getGatewayStatus(req, res, next);

      expect(getStatus()).toBe(200);
      expect(getBody().success).toBe(true);
      expect(getBody().gateway.connected).toBe(true);
      expect(getBody().deviceId).toBe('ARDUINO-PIEZO-01');
      expect(typeof getBody().latestSequenceNumber).toBe('number');
    });
  });
});
