const fs = require('fs');
const path = require('path');

/**
 * ==============================================================================
 * SequenceManager - Laptop-to-Cloud Monotonic Sequence Translation & Crash-Safe State
 * ==============================================================================
 *
 * Responsibilities:
 * 1. Synchronize starting sequence with the cloud backend (latestSequenceNumber).
 * 2. Maintain crash-safe local persistence in .gateway-state.json.
 * 3. Enforce strict single-process locking via .gateway.lock.
 * 4. Translate raw Arduino sequence numbers (which reset to 0 on reboot or COM5 reopen)
 *    into strictly monotonic global sequence numbers.
 * 5. Ensure non-DATA packets (headers, diagnostics, startup notices) are never modified.
 * 6. Track and recover unacknowledged pending packets across gateway restarts.
 * 7. Guarantee network retry stability: once a packet is queued with an assigned sequence,
 *    retries always resend the exact same translated packet and sequence number.
 * 8. Halt immediately on storage failure to prevent silent packet drops or sequence divergence.
 * ==============================================================================
 */

class SequenceManager {
  constructor({
    deviceCode = 'ARDUINO-PIEZO-01',
    stateFilePath = null,
    lockFilePath = null,
  } = {}) {
    this.deviceCode = deviceCode;
    this.stateFilePath = stateFilePath || path.resolve(__dirname, '.gateway-state.json');
    this.lockFilePath = lockFilePath || path.resolve(__dirname, '.gateway.lock');

    this.highestAssignedSequence = -1;
    this.sessionBaseOffset = 0;
    this.lastRawSeq = -1;
    this.arduinoRebootPending = true;
    this.pendingPackets = []; // Array of { line, globalSeq, rawSeq, enqueuedAt, retries }
    this.lockAcquired = false;
    this.isHalted = false;
    this.sessionId = `GW-SESSION-${Date.now()}-${process.pid}`;
  }

  /**
   * Test if a given OS process ID is currently alive
   */
  static isProcessAlive(pid) {
    if (!pid || typeof pid !== 'number' || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      return err.code === 'EPERM'; // Process exists but lacks permission to signal
    }
  }

  /**
   * Acquire exclusive instance lock to prevent concurrent gateways for the same device
   */
  acquireLock() {
    if (this.lockAcquired) return true;

    const lockDir = path.dirname(this.lockFilePath);
    if (!fs.existsSync(lockDir)) {
      fs.mkdirSync(lockDir, { recursive: true });
    }

    if (fs.existsSync(this.lockFilePath)) {
      try {
        const raw = fs.readFileSync(this.lockFilePath, 'utf8');
        const data = JSON.parse(raw);
        if (data.pid && SequenceManager.isProcessAlive(data.pid) && data.pid !== process.pid) {
          throw new Error(
            `Another gateway instance (PID ${data.pid}) is currently running for device ${this.deviceCode}. Aborting to prevent sequence collision.`
          );
        }
      } catch (err) {
        if (err.message.includes('Another gateway instance')) {
          throw err;
        }
        // Stale or unreadable lock file from a dead process - safe to claim
      }
    }

    const payload = JSON.stringify({
      pid: process.pid,
      deviceCode: this.deviceCode,
      acquiredAt: new Date().toISOString(),
      sessionId: this.sessionId,
    }, null, 2);

    fs.writeFileSync(this.lockFilePath, payload, 'utf8');
    this.lockAcquired = true;
    return true;
  }

  /**
   * Release the instance lock on clean shutdown
   */
  releaseLock() {
    if (!this.lockAcquired) return;
    try {
      if (fs.existsSync(this.lockFilePath)) {
        const raw = fs.readFileSync(this.lockFilePath, 'utf8');
        const data = JSON.parse(raw);
        if (data.pid === process.pid) {
          fs.unlinkSync(this.lockFilePath);
        }
      }
    } catch {}
    this.lockAcquired = false;
  }

  /**
   * Safely load local state from disk
   */
  loadStateSafe() {
    if (!fs.existsSync(this.stateFilePath)) {
      return null;
    }

    let raw = '';
    try {
      raw = fs.readFileSync(this.stateFilePath, 'utf8');
    } catch (readErr) {
      throw new Error(`Failed to read local state file at ${this.stateFilePath}: ${readErr.message}`);
    }

    try {
      const data = JSON.parse(raw);
      if (data && typeof data === 'object') {
        return data;
      }
      throw new Error('State file does not contain a JSON object');
    } catch (parseErr) {
      throw new Error(
        `Storage integrity error: corrupted gateway state file at ${this.stateFilePath}. Refusing to start to avoid sequence divergence.`
      );
    }
  }

  /**
   * Crash-safe atomic state save (write to .tmp with fsync, then rename)
   */
  saveStateCrashSafe() {
    const stateData = {
      deviceCode: this.deviceCode,
      highestAssignedSequence: this.highestAssignedSequence,
      lastPersistedAt: new Date().toISOString(),
      sessionId: this.sessionId,
      pendingPackets: this.pendingPackets.slice(-200), // Bounded buffer
    };

    const tmpPath = `${this.stateFilePath}.tmp`;
    const content = JSON.stringify(stateData, null, 2);
    const fd = fs.openSync(tmpPath, 'w');
    try {
      fs.writeSync(fd, content, 0, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmpPath, this.stateFilePath);
  }

  /**
   * Initialize SequenceManager with cloud backend state and local persistence
   */
  init({ cloudLatestSeq = -1 } = {}) {
    this.acquireLock();

    const localState = this.loadStateSafe();
    const localHighest = localState && typeof localState.highestAssignedSequence === 'number'
      ? localState.highestAssignedSequence
      : -1;

    // Start floor is the maximum of cloud database sequence and local state sequence
    const startFloor = Math.max(
      typeof cloudLatestSeq === 'number' ? cloudLatestSeq : -1,
      localHighest
    );

    this.highestAssignedSequence = startFloor;
    this.sessionBaseOffset = startFloor >= 0 ? (startFloor + 1) : 0;
    this.arduinoRebootPending = true;
    this.lastRawSeq = -1;
    this.isHalted = false;

    // Recover unacknowledged pending packets from previous gateway crash if present
    if (localState && Array.isArray(localState.pendingPackets) && localState.pendingPackets.length > 0) {
      this.pendingPackets = localState.pendingPackets.map((pkt) => ({
        line: pkt.line,
        globalSeq: pkt.globalSeq,
        rawSeq: pkt.rawSeq,
        enqueuedAt: pkt.enqueuedAt || Date.now(),
        retries: pkt.retries || 0,
      }));
    } else {
      this.pendingPackets = [];
    }

    try {
      this.saveStateCrashSafe();
    } catch (err) {
      this.isHalted = true;
      throw new Error(`Failed to persist initial gateway state: ${err.message}`);
    }

    return {
      highestAssignedSequence: this.highestAssignedSequence,
      sessionBaseOffset: this.sessionBaseOffset,
      recoveredPackets: this.pendingPackets.length,
      startFloor,
    };
  }

  /**
   * Process and translate an incoming raw line from Arduino
   */
  processIncomingLine(rawLine) {
    if (this.isHalted) {
      throw new Error(
        'SequenceManager is halted due to a previous storage persistence failure. Restart gateway or resolve disk permissions.'
      );
    }

    if (!rawLine || typeof rawLine !== 'string') return null;

    const line = rawLine.trim();
    if (!line) return null;

    // 1. Ignore CSV headers
    if (line.startsWith('TYPE,SEQUENCE') || line.startsWith('DATA,SEQUENCE')) {
      return { type: 'HEADER', line, modified: false };
    }

    // 2. Hardware diagnostic or startup notification lines
    if (
      line.startsWith('STATUS:') ||
      line.startsWith('SYSTEM:') ||
      line.includes('HOSPITAL_MOBILITY') ||
      line.includes('CALIBRATION_') ||
      line.includes('SENSOR_READY')
    ) {
      // Diagnostic markers indicate Arduino reboot or recalibration
      if (
        line.includes('CALIBRATION_STARTED') ||
        line.includes('HOSPITAL_MOBILITY') ||
        line.includes('CALIBRATION_COMPLETED') ||
        line.includes('SENSOR_READY')
      ) {
        this.arduinoRebootPending = true;
      }
      return { type: 'DIAGNOSTIC', line, modified: false };
    }

    // 3. Telemetry lines must begin with DATA,
    if (!line.startsWith('DATA,')) {
      return { type: 'UNRECOGNIZED', line, modified: false };
    }

    // Expected CSV format: DATA,SEQUENCE,TIME_MS,RAW,BASELINE,DEVIATION,THRESHOLD,MOVEMENT_COUNT,EVENT,STATUS
    const parts = line.split(',');
    if (parts.length !== 10) {
      return { type: 'MALFORMED', line, modified: false, reason: `Expected 10 fields, received ${parts.length}` };
    }

    const rawSeq = parseInt(parts[1], 10);
    if (isNaN(rawSeq) || rawSeq < 0) {
      return { type: 'MALFORMED', line, modified: false, reason: `Invalid sequence integer: ${parts[1]}` };
    }

    // 4. Duplicate Serial Packet Suppression (repeated raw sequence without reboot)
    if (this.lastRawSeq >= 0 && rawSeq === this.lastRawSeq && !this.arduinoRebootPending) {
      return {
        type: 'DUPLICATE',
        line,
        rawSeq,
        globalSeq: this.highestAssignedSequence,
        modified: false,
        reason: `Duplicate raw sequence #${rawSeq} received from serial line without reboot`,
      };
    }

    // 5. Reboot / Reset Detection & Base Offset Recalculation
    const isReboot = this.arduinoRebootPending || (this.lastRawSeq >= 0 && rawSeq < this.lastRawSeq);

    if (isReboot) {
      // Re-anchor session base offset so rawSeq maps to highestAssignedSequence + 1
      this.sessionBaseOffset = this.highestAssignedSequence >= 0
        ? (this.highestAssignedSequence + 1 - rawSeq)
        : 0;
      this.arduinoRebootPending = false;
    }

    // 6. Calculate translated global sequence
    let globalSeq = this.sessionBaseOffset + rawSeq;

    // Strict Monotonicity Guard:
    // If global sequence is somehow <= highestAssignedSequence,
    // advance sessionBaseOffset to ensure globalSeq is strictly greater than highestAssignedSequence.
    if (globalSeq <= this.highestAssignedSequence) {
      this.sessionBaseOffset = this.highestAssignedSequence + 1 - rawSeq;
      globalSeq = this.highestAssignedSequence + 1;
    }

    // 7. Construct translated CSV line
    parts[1] = String(globalSeq);
    const translatedLine = parts.join(',');

    // 8. Update internal state
    this.highestAssignedSequence = globalSeq;
    this.lastRawSeq = rawSeq;

    const packetItem = {
      line: translatedLine,
      globalSeq,
      rawSeq,
      enqueuedAt: Date.now(),
      retries: 0,
    };
    this.pendingPackets.push(packetItem);

    // 9. Crash-safe persistence
    try {
      this.saveStateCrashSafe();
    } catch (err) {
      this.isHalted = true;
      throw new Error(
        `Critical persistence failure while saving sequence #${globalSeq}: ${err.message}. Halting to prevent data corruption.`
      );
    }

    return {
      type: 'DATA',
      line: translatedLine,
      globalSeq,
      rawSeq,
      modified: true,
      packetItem,
    };
  }

  /**
   * Mark a single packet delivered upon HTTP 201 (Created) or HTTP 200 (Duplicate)
   */
  markDelivered(globalSeq) {
    if (typeof globalSeq !== 'number') return;
    const initialLen = this.pendingPackets.length;
    this.pendingPackets = this.pendingPackets.filter((p) => p.globalSeq !== globalSeq);

    if (this.pendingPackets.length !== initialLen) {
      try {
        this.saveStateCrashSafe();
      } catch (err) {
        console.warn(`[SequenceManager] Warning: failed to save state after delivery of #${globalSeq}: ${err.message}`);
      }
    }
  }

  /**
   * Mark a batch of packets delivered
   */
  markBatchDelivered(globalSeqList) {
    if (!Array.isArray(globalSeqList) || globalSeqList.length === 0) return;
    const seqSet = new Set(globalSeqList);
    const initialLen = this.pendingPackets.length;
    this.pendingPackets = this.pendingPackets.filter((p) => !seqSet.has(p.globalSeq));

    if (this.pendingPackets.length !== initialLen) {
      try {
        this.saveStateCrashSafe();
      } catch (err) {
        console.warn(`[SequenceManager] Warning: failed to save state after batch delivery: ${err.message}`);
      }
    }
  }

  /**
   * Notify manager of serial disconnect / reconnect (COM5 closed or DTR reset)
   */
  notifySerialReset() {
    this.arduinoRebootPending = true;
    this.lastRawSeq = -1;
  }

  /**
   * Get unacknowledged pending packets
   */
  getPendingPackets() {
    return [...this.pendingPackets];
  }

  /**
   * Inspect current manager state
   */
  getState() {
    return {
      deviceCode: this.deviceCode,
      highestAssignedSequence: this.highestAssignedSequence,
      sessionBaseOffset: this.sessionBaseOffset,
      lastRawSeq: this.lastRawSeq,
      arduinoRebootPending: this.arduinoRebootPending,
      pendingCount: this.pendingPackets.length,
      isHalted: this.isHalted,
      lockAcquired: this.lockAcquired,
    };
  }
}

module.exports = { SequenceManager };
