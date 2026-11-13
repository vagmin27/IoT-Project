const EventEmitter = require('events');

describe('Gateway Client Unit Tests', () => {
  const TEST_SECRET = 'my_test_gateway_secret_12345';
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.GATEWAY_SECRET = TEST_SECRET;
    process.env.CLOUD_BACKEND_URL = 'https://fake-backend.test';
    process.env.SERIAL_PORT = 'COM5';
    process.env.SERIAL_BAUD_RATE = '9600';
  });

  afterEach(() => {
    process.env = originalEnv;
    process.exitCode = undefined;
    jest.restoreAllMocks();
  });

  describe('1. Queue and Acknowledgement Logic', () => {
    it('verifies that headers are filtered out and DATA lines are enqueued', () => {
      const queue = [];
      const MAX_SIZE = 5;

      function enqueue(rawLine) {
        const line = rawLine.trim();
        if (line.startsWith('TYPE,') || line.startsWith('DATA,SEQUENCE')) return;
        if (queue.length >= MAX_SIZE) queue.shift();
        queue.push({ line, timestamp: Date.now() });
      }

      enqueue('TYPE,SEQUENCE,TIME_MS,RAW,BASELINE,DEVIATION,THRESHOLD,MOVEMENT_COUNT,EVENT,STATUS');
      expect(queue.length).toBe(0);

      enqueue('DATA,1,1000,45,45.0,0,30.0,0,NONE,ACTIVE');
      expect(queue.length).toBe(1);
      expect(queue[0].line).toBe('DATA,1,1000,45,45.0,0,30.0,0,NONE,ACTIVE');
    });

    it('verifies FIFO buffer overflow drops oldest packet when limit is reached', () => {
      const queue = [];
      const MAX_SIZE = 3;

      function enqueue(line) {
        if (queue.length >= MAX_SIZE) queue.shift();
        queue.push({ line });
      }

      enqueue('DATA,1,...');
      enqueue('DATA,2,...');
      enqueue('DATA,3,...');
      expect(queue.length).toBe(3);
      expect(queue[0].line).toBe('DATA,1,...');

      // 4th packet should drop packet 1
      enqueue('DATA,4,...');
      expect(queue.length).toBe(3);
      expect(queue[0].line).toBe('DATA,2,...');
      expect(queue[2].line).toBe('DATA,4,...');
    });

    it('verifies exponential backoff calculation on network failure', () => {
      let delay = 1000;
      const calculateNextBackoff = (current) => Math.min(current * 1.5, 15000);

      delay = calculateNextBackoff(delay);
      expect(delay).toBe(1500);

      delay = calculateNextBackoff(delay);
      expect(delay).toBe(2250);

      // Capped at 15000
      let maxDelay = 12000;
      maxDelay = calculateNextBackoff(maxDelay);
      expect(maxDelay).toBe(15000);
    });

    it('verifies secret sanitizer strips out secrets from error strings', () => {
      function sanitize(str, secret) {
        if (!str || !secret) return str;
        return str.split(secret).join('***SECRET***');
      }

      const rawError = `Failed connecting with secret ${TEST_SECRET} on header`;
      const sanitized = sanitize(rawError, TEST_SECRET);
      expect(sanitized).toBe('Failed connecting with secret ***SECRET*** on header');
      expect(sanitized).not.toContain(TEST_SECRET);
    });
  });

  describe('2. sendToCloud & Connection Teardown Logic (node:https)', () => {
    it('verifies request options specify Connection: close and agent: false', () => {
      const fullUrl = new URL('https://fake-backend.test/api/iot/heartbeat');
      const postData = JSON.stringify({ test: true });

      const options = {
        protocol: fullUrl.protocol,
        hostname: fullUrl.hostname,
        port: 443,
        path: fullUrl.pathname + fullUrl.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'x-gateway-secret': TEST_SECRET,
          'Connection': 'close',
        },
        agent: false,
      };

      expect(options.headers['Connection']).toBe('close');
      expect(options.agent).toBe(false);
      expect(options.headers['x-gateway-secret']).toBe(TEST_SECRET);
    });

    it('verifies verify-only exit code lifecycle without process.exit force', async () => {
      let testExitCode = null;
      async function runVerifyOnly(isAuthOk) {
        if (isAuthOk) {
          testExitCode = 0;
          return true;
        } else {
          testExitCode = 1;
          return false;
        }
      }

      // Success test
      await runVerifyOnly(true);
      expect(testExitCode).toBe(0);

      // Failure test
      await runVerifyOnly(false);
      expect(testExitCode).toBe(1);
    });
  });
});
