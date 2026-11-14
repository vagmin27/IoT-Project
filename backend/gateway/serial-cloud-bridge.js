#!/usr/bin/env node

/**
 * ==============================================================================
 * Hospital Mobility Monitoring System - Laptop-to-Cloud Serial Gateway
 * ==============================================================================
 *
 * Bridge process that:
 * 1. Connects to Arduino Uno R3 via local USB Serial (e.g. COM5 @ 9600 baud).
 * 2. Receives piezoelectric sensor CSV telemetry lines and diagnostic notices.
 * 3. Securely forwards messages to the Render cloud backend over HTTPS.
 * 4. Implements bounded FIFO buffering and exponential backoff for network drops.
 * 5. Sends periodic gateway heartbeats reflecting local Arduino serial status.
 * 6. Handles graceful shutdown and releases the COM port cleanly.
 * 7. Translates raw Arduino sequence numbers monotonically using SequenceManager,
 *    preventing sequence collisions on Arduino reboots while preserving 100%
 *    duplicate protection on network retries.
 *
 * Usage:
 *   node backend/gateway/serial-cloud-bridge.js
 *   node backend/gateway/serial-cloud-bridge.js --verify-only   (test cloud auth without opening COM5)
 *   node backend/gateway/serial-cloud-bridge.js --mock          (stream simulated packets without opening COM5)
 * ==============================================================================
 */

const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const dotenv = require('dotenv');
const { SequenceManager } = require('./sequence-manager');

// 1. Load configuration: gateway/.env first, fallback to backend/.env
const gatewayEnv = path.resolve(__dirname, '.env');
const backendEnv = path.resolve(__dirname, '..', '.env');

if (fs.existsSync(gatewayEnv)) {
  dotenv.config({ path: gatewayEnv });
} else if (fs.existsSync(backendEnv)) {
  dotenv.config({ path: backendEnv });
} else {
  dotenv.config();
}

// 2. Gateway Settings
const CLOUD_BACKEND_URL = (process.env.CLOUD_BACKEND_URL || 'https://iot-project-backend-9n5j.onrender.com').replace(/\/+$/, '');
const GATEWAY_SECRET = (process.env.GATEWAY_SECRET || '').trim();
const SERIAL_PORT = process.env.SERIAL_PORT || 'COM5';
const SERIAL_BAUD_RATE = parseInt(process.env.SERIAL_BAUD_RATE, 10) || 9600;
const DEVICE_CODE = process.env.DEVICE_CODE || 'ARDUINO-PIEZO-01';
const HEARTBEAT_INTERVAL_MS = parseInt(process.env.HEARTBEAT_INTERVAL_MS, 10) || 5000;
const MAX_BUFFER_SIZE = parseInt(process.env.MAX_BUFFER_SIZE, 10) || 200;
const BATCH_FLUSH_SIZE = parseInt(process.env.BATCH_FLUSH_SIZE, 10) || 20;

// Command line flags
const IS_VERIFY_ONLY = process.argv.includes('--verify-only') || process.argv.includes('--test');
const IS_MOCK_SERIAL = process.env.MOCK_SERIAL === 'true' || process.argv.includes('--mock');

// 3. Sequence & Persistence Manager
const sequenceManager = new SequenceManager({
  deviceCode: DEVICE_CODE,
  stateFilePath: process.env.GATEWAY_STATE_PATH || path.resolve(__dirname, '.gateway-state.json'),
  lockFilePath: process.env.GATEWAY_LOCK_PATH || path.resolve(__dirname, '.gateway.lock'),
});

// 4. Gateway State
let serialPortInstance = null;
let serialParserInstance = null;
let serialStatus = 'DISCONNECTED'; // 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'ERROR'
let reconnectTimer = null;
let heartbeatTimer = null;
let isShuttingDown = false;

// Queue & Transmission State
const packetQueue = []; // FIFO queue of { line, globalSeq, rawSeq, type, enqueuedAt, retries }
let isFlushingQueue = false;
let backoffDelayMs = 1000;
let backoffUntilTimestamp = 0;

// Statistics
const stats = {
  serialLinesRead: 0,
  telemetrySentNew: 0,
  telemetrySentDuplicates: 0,
  serialDuplicatesSuppressed: 0,
  diagnosticsSent: 0,
  malformedPackets: 0,
  droppedDueToOverflow: 0,
  networkRetries: 0,
  movementEventsDetected: 0,
  movementEventsDelivered: 0,
  startedAt: new Date(),
};

/**
 * Log helper with timestamp and tags
 */
function log(tag, message, level = 'info') {
  const time = new Date().toLocaleTimeString();
  const prefix = `[${time}] [GATEWAY] [${tag}]`;
  if (level === 'error') {
    console.error(`${prefix} ${message}`);
  } else if (level === 'warn') {
    console.warn(`${prefix} ${message}`);
  } else {
    console.log(`${prefix} ${message}`);
  }
}

/**
 * Helper to mask secret strings in error messages if any
 */
function sanitize(str) {
  if (!str || typeof str !== 'string') return '';
  if (!GATEWAY_SECRET) return str;
  return str.split(GATEWAY_SECRET).join('***SECRET***');
}

/**
 * Parse key fields from a DATA CSV telemetry line for diagnostics.
 * Format: DATA,SEQUENCE,TIME_MS,RAW,BASELINE,DEVIATION,THRESHOLD,MOVEMENT_COUNT,EVENT,STATUS
 * Returns parsed object or null if not a DATA line.
 */
function parseTelemetryLine(line) {
  if (!line || !line.startsWith('DATA,')) return null;
  const parts = line.split(',');
  if (parts.length !== 10) return null;
  return {
    seq: parts[1],
    timeMs: parts[2],
    raw: parts[3],
    baseline: parts[4],
    deviation: parts[5],
    threshold: parts[6],
    movementCount: parts[7],
    event: parts[8],
    status: parts[9],
  };
}

/**
 * Send an authenticated HTTPS/HTTP request to Render backend
 * Uses Node's built-in https/http module with agent: false and Connection: close
 * to ensure sockets are closed immediately and never trigger libuv handle race conditions on Windows.
 */
function sendToCloud(endpointPath, payload = null, method = 'POST', timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    let timer = null;
    let req = null;
    let isSettled = false;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    try {
      const fullUrl = new URL(`${CLOUD_BACKEND_URL}${endpointPath}`);
      const isHttps = fullUrl.protocol === 'https:';
      const client = isHttps ? https : http;

      const isPost = method.toUpperCase() === 'POST';
      const postData = isPost && payload ? JSON.stringify(payload) : null;

      const headers = {
        'x-gateway-secret': GATEWAY_SECRET,
        'Connection': 'close',
      };

      if (isPost && postData) {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = Buffer.byteLength(postData);
      }

      const options = {
        protocol: fullUrl.protocol,
        hostname: fullUrl.hostname,
        port: fullUrl.port || (isHttps ? 443 : 80),
        path: fullUrl.pathname + fullUrl.search,
        method: method.toUpperCase(),
        headers,
        agent: false, // Do not pool sockets
      };

      req = client.request(options, (res) => {
        let responseBody = '';
        res.setEncoding('utf8');

        res.on('data', (chunk) => {
          responseBody += chunk;
        });

        res.on('end', () => {
          cleanup();
          if (isSettled) return;
          isSettled = true;

          let data = null;
          try {
            data = JSON.parse(responseBody);
          } catch {
            data = { raw: responseBody };
          }

          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            data,
          });
        });
      });

      // Timeout handling with unref so it never holds event loop open
      timer = setTimeout(() => {
        if (!isSettled && req) {
          req.destroy(new Error('Request timed out'));
        }
      }, timeoutMs);

      if (timer && timer.unref) {
        timer.unref();
      }

      req.on('error', (err) => {
        cleanup();
        if (isSettled) return;
        isSettled = true;
        reject(err);
      });

      if (isPost && postData) {
        req.write(postData);
      }
      req.end();
    } catch (err) {
      cleanup();
      if (!isSettled) {
        isSettled = true;
        reject(err);
      }
    }
  });
}

/**
 * Perform initial verification of cloud connectivity, authentication, and sequence state
 */
async function verifyCloudConnection() {
  log('AUTH', `Checking cloud backend reachability: ${CLOUD_BACKEND_URL}`);

  if (!GATEWAY_SECRET) {
    log('AUTH', 'CRITICAL ERROR: GATEWAY_SECRET is not configured in .env!', 'error');
    log('AUTH', 'Set GATEWAY_SECRET in backend/gateway/.env or backend/.env before running.', 'error');
    process.exitCode = 1;
    return false;
  }

  try {
    const startTime = Date.now();
    // 1. Send test heartbeat to confirm authentication and write permissions
    const resHeartbeat = await sendToCloud('/api/iot/heartbeat', {
      arduinoSerialStatus: 'CONNECTING',
      port: SERIAL_PORT,
      baudRate: SERIAL_BAUD_RATE,
    });

    const elapsedMs = Date.now() - startTime;

    if (resHeartbeat.status === 401 || resHeartbeat.status === 403) {
      log('AUTH', `Authentication failed (HTTP ${resHeartbeat.status}): ${resHeartbeat.data?.message || 'Invalid secret'}`, 'error');
      log('AUTH', 'Please check that GATEWAY_SECRET matches the value set on Render.', 'error');
      return false;
    }

    if (!resHeartbeat.ok) {
      log('AUTH', `Cloud responded with unexpected status HTTP ${resHeartbeat.status}: ${JSON.stringify(resHeartbeat.data)}`, 'warn');
      return false;
    }

    // 2. Query status endpoint for highest persisted sequence number
    let latestSequenceNumber = -1;
    try {
      const resStatus = await sendToCloud(`/api/iot/status?deviceId=${encodeURIComponent(DEVICE_CODE)}`, null, 'GET');
      if (resStatus.ok && typeof resStatus.data?.latestSequenceNumber === 'number') {
        latestSequenceNumber = resStatus.data.latestSequenceNumber;
      }
    } catch (statusErr) {
      log('AUTH', `Warning: could not query latestSequenceNumber: ${statusErr.message}. Defaulting to -1.`, 'warn');
    }

    log('AUTH', `Cloud backend verified successfully! (HTTP ${resHeartbeat.status} in ${elapsedMs}ms). Current cloud latest sequence for ${DEVICE_CODE}: ${latestSequenceNumber}`);
    return { ok: true, latestSequenceNumber };
  } catch (err) {
    const isTimeout = err.name === 'AbortError' || err.message?.includes('aborted') || err.message?.includes('timed out');
    log('AUTH', `Connection to cloud failed: ${isTimeout ? 'Request timed out (Render free tier waking up?)' : sanitize(err.message)}`, 'warn');
    return false;
  }
}

/**
 * Send periodic gateway heartbeat to Render
 */
async function sendHeartbeat() {
  if (isShuttingDown) return;

  try {
    const res = await sendToCloud('/api/iot/heartbeat', {
      arduinoSerialStatus: serialStatus,
      port: SERIAL_PORT,
      baudRate: SERIAL_BAUD_RATE,
    }, 8000);

    if (res.ok) {
      // Successful heartbeat
    } else if (res.status === 401 || res.status === 403) {
      log('HEARTBEAT', `Auth error on heartbeat: ${res.data?.message || res.status}`, 'error');
    }
  } catch (err) {
    // Silent catch on heartbeat network drops; main queue handles retries
  }
}

/**
 * Enqueue an incoming line from the Arduino
 */
function enqueueLine(rawLine) {
  if (isShuttingDown) return;
  if (!rawLine || typeof rawLine !== 'string') return;

  const line = rawLine.trim();
  if (!line) return;

  stats.serialLinesRead += 1;

  let result = null;
  try {
    result = sequenceManager.processIncomingLine(line);
  } catch (err) {
    log('CRITICAL', `Sequence translation error: ${err.message}`, 'error');
    return;
  }

  if (!result) return;

  // Ignore raw CSV header lines locally (no need to waste bandwidth)
  if (result.type === 'HEADER') {
    log('SERIAL', `CSV Header ignored: ${line}`);
    return;
  }

  // Duplicate serial line suppression (prevents phantom movements from UART line bounces)
  if (result.type === 'DUPLICATE') {
    stats.serialDuplicatesSuppressed += 1;
    log('SERIAL', `Duplicate serial packet suppressed: raw Seq #${result.rawSeq} (prev global Seq #${result.globalSeq}) -> not forwarded`);
    return;
  }

  if (result.type === 'MALFORMED') {
    stats.malformedPackets += 1;
    log('SERIAL', `Malformed line ignored: ${line} (${result.reason || 'Invalid format'})`, 'warn');
    return;
  }

  if (result.type === 'UNRECOGNIZED') {
    log('SERIAL', `Unrecognized line: ${line}`, 'warn');
    return;
  }

  // ── DIAGNOSTIC: Per-packet log with RAW | BASELINE | DEVIATION | THRESHOLD | EVENT | MOVEMENT_COUNT ──
  if (result.type === 'DATA') {
    const parsed = parseTelemetryLine(result.line);
    if (parsed) {
      log('DATA', `RAW=${parsed.raw} | BASELINE=${parsed.baseline} | DEVIATION=${parsed.deviation} | THRESHOLD=${parsed.threshold} | EVENT=${parsed.event} | MOVEMENT_COUNT=${parsed.movementCount} | STATUS=${parsed.status}`);

      if (parsed.event === 'MOVEMENT') {
        stats.movementEventsDetected += 1;
        log('MOVEMENT', `>>> MOVEMENT DETECTED (Seq #${parsed.seq}, Count=${parsed.movementCount}) RAW=${parsed.raw} DEV=${parsed.deviation} >= THRESH=${parsed.threshold} <<<`);
        log('MOVEMENT', `    Stage: Arduino -> Gateway(queued) -> API -> MongoDB -> SSE -> Dashboard`);
      }
    }
  }
  // ──────────────────────────────────────────────────────────────────────────────────────────────────────

  // FIFO Buffer Overflow Protection
  if (packetQueue.length >= MAX_BUFFER_SIZE) {
    const dropped = packetQueue.shift();
    stats.droppedDueToOverflow += 1;
    log('QUEUE', `Buffer full (${MAX_BUFFER_SIZE} packets). Dropped oldest packet (Seq #${dropped.globalSeq ?? dropped.line.split(',')[1] ?? '?'})`, 'warn');
  }

  packetQueue.push({
    line: result.line,
    globalSeq: result.globalSeq,
    rawSeq: result.rawSeq,
    type: result.type,
    enqueuedAt: Date.now(),
    retries: 0,
  });

  // Trigger processing
  processQueue();
}

/**
 * Process queued packets (single transmission or batch flushing)
 */
async function processQueue() {
  if (isFlushingQueue || packetQueue.length === 0 || isShuttingDown) {
    return;
  }

  // Check backoff delay
  if (Date.now() < backoffUntilTimestamp) {
    const waitRemaining = backoffUntilTimestamp - Date.now();
    setTimeout(processQueue, Math.max(100, waitRemaining));
    return;
  }

  isFlushingQueue = true;

  try {
    // If only 1 packet is queued, use fast single-packet endpoint
    if (packetQueue.length === 1) {
      const item = packetQueue[0];
      const ev = item.line.split(',')[8] || '?';
      const seq = item.globalSeq ?? item.line.split(',')[1] ?? '?';

      const res = await sendToCloud('/api/iot/telemetry', {
        line: item.line,
        arduinoSerialStatus: serialStatus,
        port: SERIAL_PORT,
        baudRate: SERIAL_BAUD_RATE,
      });

      if (res.status === 201) {
        // Success: newly created record
        packetQueue.shift();
        if (typeof item.globalSeq === 'number') {
          sequenceManager.markDelivered(item.globalSeq);
        }
        stats.telemetrySentNew += 1;
        backoffDelayMs = 1000; // Reset backoff on success
        log('CLOUD', `Forwarded Seq #${seq} (Arduino #${item.rawSeq ?? '?'}) [${ev}] -> HTTP 201 Created (DB saved)`);

        // ── DIAGNOSTIC: Confirm MOVEMENT successfully reached cloud ───────
        if (ev === 'MOVEMENT') {
          stats.movementEventsDelivered += 1;
          log('MOVEMENT', `>>> MOVEMENT DELIVERED to cloud/MongoDB (Seq #${seq}) | Stage: Gateway -> API[201] -> MongoDB ✓ -> SSE -> Dashboard <<<`);
        }
        // ─────────────────────────────────────────────────────────────────
      } else if (res.status === 200 && res.data?.duplicate) {
        // Confirmed duplicate: safely acknowledged
        packetQueue.shift();
        if (typeof item.globalSeq === 'number') {
          sequenceManager.markDelivered(item.globalSeq);
        }
        stats.telemetrySentDuplicates += 1;
        backoffDelayMs = 1000;
        log('CLOUD', `Seq #${seq} already in DB -> HTTP 200 (Duplicate acknowledged)`);

        // Count movement duplicates as delivered too (already in DB = successfully stored before)
        if (ev === 'MOVEMENT') {
          stats.movementEventsDelivered += 1;
          log('MOVEMENT', `>>> MOVEMENT Seq #${seq} already in MongoDB (duplicate ack) - confirmed stored <<<`);
        }
      } else if (res.status === 200 && res.data?.type === 'DIAGNOSTIC') {
        // Diagnostic or startup message
        packetQueue.shift();
        stats.diagnosticsSent += 1;
        backoffDelayMs = 1000;
        log('CLOUD', `Diagnostic line acknowledged -> ${item.line}`);
      } else if (res.status === 200 && res.data?.type === 'HEADER') {
        // Header line
        packetQueue.shift();
        backoffDelayMs = 1000;
      } else if (res.status === 400) {
        // Malformed line: permanently rejected by cloud
        packetQueue.shift();
        stats.malformedPackets += 1;
        log('REJECTED', `Malformed packet rejected by backend (HTTP 400): ${item.line} -> ${res.data?.message || 'Validation failed'}`, 'error');
        if (ev === 'MOVEMENT') {
          log('MOVEMENT', `>>> MOVEMENT EVENT LOST: rejected by cloud (HTTP 400). Check CSV format: ${item.line}`, 'error');
        }
      } else if (res.status === 401 || res.status === 403) {
        // Authentication error
        item.retries += 1;
        stats.networkRetries += 1;
        log('AUTH', `Gateway authentication rejected (HTTP ${res.status}): ${res.data?.message}`, 'error');
        log('AUTH', 'ACTION REQUIRED: Verify GATEWAY_SECRET in backend/gateway/.env matches the value on Render.', 'error');
        backoffDelayMs = Math.min(backoffDelayMs * 2, 15000);
        backoffUntilTimestamp = Date.now() + backoffDelayMs;
      } else {
        // Server error (500, 502, 503, 504 - e.g. Render waking up)
        item.retries += 1;
        stats.networkRetries += 1;
        backoffDelayMs = Math.min(backoffDelayMs * 1.5, 15000);
        backoffUntilTimestamp = Date.now() + backoffDelayMs;
        log('NETWORK', `Cloud returned HTTP ${res.status}. Backing off ${(backoffDelayMs / 1000).toFixed(1)}s (Queue size: ${packetQueue.length})...`, 'warn');
      }
    } else {
      // Multiple packets queued: flush as a sequential batch
      const batchSize = Math.min(packetQueue.length, BATCH_FLUSH_SIZE);
      const batchItems = packetQueue.slice(0, batchSize);
      const batchLines = batchItems.map((b) => b.line);

      // Count MOVEMENT events in this batch for diagnostics
      const movementInBatch = batchItems.filter((b) => (b.line.split(',')[8] || '') === 'MOVEMENT').length;
      log('BATCH', `Flushing batch of ${batchSize} queued packets to cloud${movementInBatch > 0 ? ` [includes ${movementInBatch} MOVEMENT event(s)]` : ''}...`);

      const res = await sendToCloud('/api/iot/telemetry', {
        lines: batchLines,
        arduinoSerialStatus: serialStatus,
        port: SERIAL_PORT,
        baudRate: SERIAL_BAUD_RATE,
      });

      if (res.ok && res.data?.batch) {
        // Dequeue flushed items
        packetQueue.splice(0, batchSize);
        const batchSeqs = batchItems.map((b) => b.globalSeq).filter((s) => typeof s === 'number');
        sequenceManager.markBatchDelivered(batchSeqs);

        stats.telemetrySentNew += (res.data.newRecords || 0);
        stats.telemetrySentDuplicates += (res.data.duplicates || 0);
        backoffDelayMs = 1000;
        log('BATCH', `Flushed ${batchSize} packets -> ${res.data.newRecords} saved, ${res.data.duplicates} duplicates, ${res.data.errors || 0} errors (Remaining queue: ${packetQueue.length})`);

        if (movementInBatch > 0) {
          stats.movementEventsDelivered += movementInBatch;
          log('MOVEMENT', `>>> ${movementInBatch} MOVEMENT EVENT(S) delivered via batch flush -> confirmed reaching cloud <<<`);
        }
      } else if (res.status === 401 || res.status === 403) {
        stats.networkRetries += 1;
        log('AUTH', `Batch auth failed (HTTP ${res.status}): ${res.data?.message}`, 'error');
        log('AUTH', 'ACTION REQUIRED: Verify GATEWAY_SECRET in backend/gateway/.env matches the value on Render.', 'error');
        backoffDelayMs = Math.min(backoffDelayMs * 2, 15000);
        backoffUntilTimestamp = Date.now() + backoffDelayMs;
      } else {
        stats.networkRetries += 1;
        backoffDelayMs = Math.min(backoffDelayMs * 1.5, 15000);
        backoffUntilTimestamp = Date.now() + backoffDelayMs;
        log('NETWORK', `Batch flush HTTP ${res.status}. Retrying in ${(backoffDelayMs / 1000).toFixed(1)}s (Queue: ${packetQueue.length})...`, 'warn');
      }
    }
  } catch (err) {
    stats.networkRetries += 1;
    backoffDelayMs = Math.min(backoffDelayMs * 1.5, 15000);
    backoffUntilTimestamp = Date.now() + backoffDelayMs;
    const isTimeout = err.name === 'AbortError' || err.message?.includes('aborted') || err.message?.includes('timed out');
    log('NETWORK', `Network failure: ${isTimeout ? 'Request timed out (Render cold start)' : sanitize(err.message)}. Retrying in ${(backoffDelayMs / 1000).toFixed(1)}s (Queue: ${packetQueue.length})...`, 'warn');
  } finally {
    isFlushingQueue = false;

    // Continue processing if packets remain
    if (packetQueue.length > 0 && !isShuttingDown) {
      const waitRemaining = Math.max(50, backoffUntilTimestamp - Date.now());
      setTimeout(processQueue, waitRemaining);
    }
  }
}

/**
 * Open connection to Arduino Uno on COM port
 */
function openSerialPort() {
  if (isShuttingDown || IS_MOCK_SERIAL) return;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  // Load serialport dependencies dynamically
  let SerialPort, ReadlineParser;
  try {
    ({ SerialPort } = require('serialport'));
    ({ ReadlineParser } = require('@serialport/parser-readline'));
  } catch (err) {
    log('SERIAL', `Failed to load 'serialport' package: ${err.message}`, 'error');
    log('SERIAL', 'Ensure serialport and @serialport/parser-readline are installed in backend/node_modules.', 'error');
    process.exitCode = 1;
    return;
  }

  serialStatus = 'CONNECTING';
  log('SERIAL', `Opening serial port ${SERIAL_PORT} @ ${SERIAL_BAUD_RATE} baud...`);

  try {
    serialPortInstance = new SerialPort({
      path: SERIAL_PORT,
      baudRate: SERIAL_BAUD_RATE,
      autoOpen: false,
    });

    serialPortInstance.open((err) => {
      if (err) {
        serialStatus = 'ERROR';
        log('SERIAL', `Could not open ${SERIAL_PORT}: ${err.message}`, 'error');
        scheduleReconnect();
        return;
      }

      serialStatus = 'CONNECTED';
      log('SERIAL', `Successfully connected to Arduino on ${SERIAL_PORT} @ ${SERIAL_BAUD_RATE} baud.`);
      log('SERIAL', 'Listening for sensor telemetry and diagnostic packets...');

      // Notify cloud backend immediately of connected state
      sendHeartbeat();

      serialParserInstance = serialPortInstance.pipe(new ReadlineParser({ delimiter: '\r\n' }));
      serialParserInstance.on('data', (line) => {
        enqueueLine(line);
      });

      serialPortInstance.on('close', (closeErr) => {
        serialStatus = 'DISCONNECTED';
        log('SERIAL', `Port ${SERIAL_PORT} closed: ${closeErr ? closeErr.message : 'Clean close'}`, 'warn');
        cleanupSerial();
        sendHeartbeat();
        if (!isShuttingDown) {
          scheduleReconnect();
        }
      });

      serialPortInstance.on('error', (portErr) => {
        serialStatus = 'ERROR';
        log('SERIAL', `Port error on ${SERIAL_PORT}: ${portErr.message}`, 'error');
        cleanupSerial();
        sendHeartbeat();
        if (!isShuttingDown) {
          scheduleReconnect();
        }
      });
    });
  } catch (err) {
    serialStatus = 'ERROR';
    log('SERIAL', `Initialization exception on ${SERIAL_PORT}: ${err.message}`, 'error');
    scheduleReconnect();
  }
}

function cleanupSerial() {
  sequenceManager.notifySerialReset();

  if (serialParserInstance) {
    try {
      serialParserInstance.removeAllListeners();
    } catch {}
    serialParserInstance = null;
  }

  if (serialPortInstance) {
    try {
      serialPortInstance.removeAllListeners();
      if (serialPortInstance.isOpen) {
        serialPortInstance.close();
      }
    } catch {}
    serialPortInstance = null;
  }
}

function scheduleReconnect() {
  if (isShuttingDown || reconnectTimer) return;
  const retryIntervalMs = 4000;
  log('SERIAL', `Will attempt to reconnect to ${SERIAL_PORT} in ${(retryIntervalMs / 1000).toFixed(0)} seconds...`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (!isShuttingDown) {
      openSerialPort();
    }
  }, retryIntervalMs);
}

/**
 * Mock Serial Simulation (for testing cloud forwarding without opening physical COM port)
 */
function startMockSerial() {
  serialStatus = 'CONNECTED';
  log('MOCK', '=======================================================');
  log('MOCK', 'RUNNING IN MOCK SERIAL MODE (--mock flag active)');
  log('MOCK', 'Physical COM5 port is NOT opened.');
  log('MOCK', 'Generating synthetic Arduino piezoelectric telemetry.');
  log('MOCK', '=======================================================');

  // 1. Initial simulated boot & calibration sequence
  setTimeout(() => enqueueLine('HOSPITAL_MOBILITY_SYSTEM_BOOT'), 500);
  setTimeout(() => enqueueLine('CALIBRATION_STARTED'), 1000);
  setTimeout(() => enqueueLine('CALIBRATION_COMPLETED'), 2000);
  setTimeout(() => enqueueLine('STATUS:SENSOR_READY'), 2500);

  // 2. Continuous 1 Hz telemetry loop
  let mockSeq = 1;
  let mockCount = 0;

  const mockInterval = setInterval(() => {
    if (isShuttingDown) {
      clearInterval(mockInterval);
      return;
    }

    const timeMs = mockSeq * 1000;
    // Every 5th packet simulate physical movement, otherwise idle
    const isMovement = (mockSeq % 5 === 0);
    if (isMovement) mockCount += 1;

    const raw = isMovement ? 135 : 45;
    const baseline = 45.0;
    const deviation = isMovement ? 90 : 0;
    const threshold = 30.0;
    const event = isMovement ? 'MOVEMENT' : (mockSeq > 10 && mockSeq % 10 === 0 ? 'INACTIVITY' : 'NONE');
    const status = 'ACTIVE';

    const line = `DATA,${mockSeq},${timeMs},${raw},${baseline.toFixed(2)},${deviation},${threshold.toFixed(2)},${mockCount},${event},${status}`;
    enqueueLine(line);
    mockSeq += 1;
  }, 1000);
}

/**
 * Graceful Process Shutdown
 */
function setupGracefulShutdown() {
  const shutdown = async (signal) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log('\n');
    log('SYSTEM', `Received ${signal}. Shutting down gateway cleanly...`);

    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);

    // Release COM port
    cleanupSerial();
    log('SERIAL', `Released ${SERIAL_PORT}.`);

    // Release instance lock
    sequenceManager.releaseLock();
    log('SYSTEM', 'Released gateway instance lock.');

    // Best-effort final status notice to cloud
    try {
      await sendToCloud('/api/iot/heartbeat', {
        arduinoSerialStatus: 'DISCONNECTED',
        port: SERIAL_PORT,
        baudRate: SERIAL_BAUD_RATE,
      }, 2000);
    } catch {}

    // Print summary stats
    const uptimeSec = Math.round((Date.now() - stats.startedAt.getTime()) / 1000);
    console.log('-------------------------------------------------------');
    console.log(' GATEWAY SESSION SUMMARY');
    console.log(` - Uptime:                    ${uptimeSec} seconds`);
    console.log(` - Serial Lines Read:         ${stats.serialLinesRead}`);
    console.log(` - New Packets Stored:        ${stats.telemetrySentNew}`);
    console.log(` - Duplicates Acknowledged:   ${stats.telemetrySentDuplicates}`);
    console.log(` - Serial Dups Suppressed:    ${stats.serialDuplicatesSuppressed}`);
    console.log(` - Diagnostics Sent:          ${stats.diagnosticsSent}`);
    console.log(` - Rejected Malformed:        ${stats.malformedPackets}`);
    console.log(` - Overflow Dropped:          ${stats.droppedDueToOverflow}`);
    console.log(` - Network Retries:           ${stats.networkRetries}`);
    console.log(` - Remaining in Queue:        ${packetQueue.length}`);
    console.log(` - MOVEMENT Events Detected:  ${stats.movementEventsDetected}`);
    console.log(` - MOVEMENT Events Delivered: ${stats.movementEventsDelivered}`);
    console.log('-------------------------------------------------------');
    log('SYSTEM', 'Gateway stopped.');
    process.exitCode = 0;
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

/**
 * Entrypoint
 */
async function main() {
  console.log('================================================================');
  console.log(' Hospital Mobility Monitoring System - IoT Serial Cloud Bridge');
  console.log(` Device Target:   ${DEVICE_CODE}`);
  console.log(` Serial Port:     ${SERIAL_PORT} @ ${SERIAL_BAUD_RATE} baud`);
  console.log(` Cloud Backend:   ${CLOUD_BACKEND_URL}`);
  console.log(` Secret Status:   ${GATEWAY_SECRET ? 'Configured (' + GATEWAY_SECRET.length + ' chars)' : 'MISSING'}`);
  console.log('================================================================');

  // Test mode: verify authentication and cloud reachability only
  if (IS_VERIFY_ONLY) {
    log('TEST', 'Running in --verify-only mode...');
    const result = await verifyCloudConnection();
    if (result && result.ok) {
      log('TEST', `VERIFICATION SUCCESSFUL: Cloud accepted gateway secret. Latest persisted sequence: ${result.latestSequenceNumber}`);
      process.exitCode = 0;
    } else {
      log('TEST', 'VERIFICATION FAILED: Cloud backend did not acknowledge gateway.', 'error');
      process.exitCode = 1;
    }
    return;
  }

  // Active continuous monitoring lifecycle
  setupGracefulShutdown();

  // Verify cloud backend and fetch latest sequence number before opening serial
  const verifyResult = await verifyCloudConnection();
  if (!verifyResult || !verifyResult.ok) {
    log('CRITICAL', 'Cannot start gateway: cloud backend is unreachable or unauthorized. Halting.', 'error');
    process.exitCode = 1;
    return;
  }

  // Initialize sequence and persistence manager
  try {
    const syncInfo = sequenceManager.init({ cloudLatestSeq: verifyResult.latestSequenceNumber });
    log('GATEWAY', 'Sequence synchronization established:');
    log('GATEWAY', ` - Cloud highest sequence:   ${verifyResult.latestSequenceNumber}`);
    log('GATEWAY', ` - Local baseline floor:      ${syncInfo.startFloor}`);
    log('GATEWAY', ` - Session base offset:       ${syncInfo.sessionBaseOffset}`);
    log('GATEWAY', ` - Next assigned sequence:    ${syncInfo.highestAssignedSequence + 1}`);
    log('GATEWAY', ` - Recovered pending packets: ${syncInfo.recoveredPackets}`);

    // If there were recovered unacknowledged packets from a previous crash, enqueue them now
    if (syncInfo.recoveredPackets > 0) {
      const recovered = sequenceManager.getPendingPackets();

      // Log movement events among recovered packets
      const recoveredMovements = recovered.filter((p) => (p.line.split(',')[8] || '') === 'MOVEMENT');
      if (recoveredMovements.length > 0) {
        log('MOVEMENT', `>>> Found ${recoveredMovements.length} undelivered MOVEMENT event(s) in recovered queue - retrying delivery <<<`);
        recoveredMovements.forEach((p) => {
          const parsed = parseTelemetryLine(p.line);
          if (parsed) {
            log('MOVEMENT', `    - Seq #${p.globalSeq}: RAW=${parsed.raw} DEV=${parsed.deviation} COUNT=${parsed.movementCount}`);
          }
        });
      }

      for (const pkt of recovered) {
        packetQueue.push({
          line: pkt.line,
          globalSeq: pkt.globalSeq,
          rawSeq: pkt.rawSeq,
          type: 'DATA',
          enqueuedAt: pkt.enqueuedAt,
          retries: pkt.retries || 0,
        });
      }
      log('GATEWAY', `Enqueued ${recovered.length} recovered unacknowledged packets to queue.`);
      processQueue();
    }
  } catch (err) {
    log('CRITICAL', `Failed to initialize sequence manager: ${err.message}`, 'error');
    process.exitCode = 1;
    return;
  }

  // Start periodic heartbeat
  heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

  // Start hardware serial or mock simulation
  if (IS_MOCK_SERIAL) {
    startMockSerial();
  } else {
    openSerialPort();
  }
}

main().catch((err) => {
  log('CRITICAL', `Unhandled fatal exception: ${err.message}`, 'error');
  process.exitCode = 1;
});
