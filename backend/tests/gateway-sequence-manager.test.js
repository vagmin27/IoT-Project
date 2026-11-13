const fs = require('fs');
const path = require('path');
const os = require('os');
const { SequenceManager } = require('../gateway/sequence-manager');

describe('Gateway SequenceManager & Monotonic Offset Unit Tests', () => {
  let tmpDir = null;
  let stateFilePath = null;
  let lockFilePath = null;
  let activeManagers = [];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-seq-test-'));
    stateFilePath = path.join(tmpDir, '.gateway-state.json');
    lockFilePath = path.join(tmpDir, '.gateway.lock');
    activeManagers = [];
  });

  afterEach(() => {
    for (const mgr of activeManagers) {
      try {
        mgr.releaseLock();
      } catch {}
    }
    if (tmpDir && fs.existsSync(tmpDir)) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {}
    }
  });

  function createManager(options = {}) {
    const mgr = new SequenceManager({
      deviceCode: 'ARDUINO-PIEZO-01',
      stateFilePath,
      lockFilePath,
      ...options,
    });
    activeManagers.push(mgr);
    return mgr;
  }

  describe('1. First Startup When Database is Empty (-1)', () => {
    test('initializes sequence floor to -1 and base offset to 0', () => {
      const mgr = createManager();
      const initInfo = mgr.init({ cloudLatestSeq: -1 });

      expect(initInfo.startFloor).toBe(-1);
      expect(initInfo.sessionBaseOffset).toBe(0);
      expect(initInfo.highestAssignedSequence).toBe(-1);

      const r0 = mgr.processIncomingLine('DATA,0,100,512,512.00,0,30.00,0,NONE,ACTIVE');
      expect(r0.type).toBe('DATA');
      expect(r0.globalSeq).toBe(0);
      expect(r0.line).toBe('DATA,0,100,512,512.00,0,30.00,0,NONE,ACTIVE');

      const r1 = mgr.processIncomingLine('DATA,1,1100,515,512.00,3,30.00,0,NONE,ACTIVE');
      expect(r1.globalSeq).toBe(1);
      expect(r1.line).toBe('DATA,1,1100,515,512.00,3,30.00,0,NONE,ACTIVE');
    });
  });

  describe('2. First Startup When Latest Sequence is 3256', () => {
    test('translates raw sequence 0 to 3257 and strictly increments', () => {
      const mgr = createManager();
      const initInfo = mgr.init({ cloudLatestSeq: 3256 });

      expect(initInfo.startFloor).toBe(3256);
      expect(initInfo.sessionBaseOffset).toBe(3257);
      expect(initInfo.highestAssignedSequence).toBe(3256);

      const r0 = mgr.processIncomingLine('DATA,0,100,512,512.00,0,30.00,0,NONE,ACTIVE');
      expect(r0.type).toBe('DATA');
      expect(r0.rawSeq).toBe(0);
      expect(r0.globalSeq).toBe(3257);
      expect(r0.line).toBe('DATA,3257,100,512,512.00,0,30.00,0,NONE,ACTIVE');

      const r1 = mgr.processIncomingLine('DATA,1,1100,512,512.00,0,30.00,0,NONE,ACTIVE');
      expect(r1.rawSeq).toBe(1);
      expect(r1.globalSeq).toBe(3258);
      expect(r1.line).toBe('DATA,3258,1100,512,512.00,0,30.00,0,NONE,ACTIVE');

      const r2 = mgr.processIncomingLine('DATA,2,2100,550,512.00,38,30.00,1,MOVEMENT,ACTIVE');
      expect(r2.rawSeq).toBe(2);
      expect(r2.globalSeq).toBe(3259);
      expect(r2.line).toBe('DATA,3259,2100,550,512.00,38,30.00,1,MOVEMENT,ACTIVE');

      expect(mgr.getState().highestAssignedSequence).toBe(3259);
    });
  });

  describe('3. Arduino Reboot During Operation', () => {
    test('re-anchors sequence monotonically when startup diagnostic precedes reset', () => {
      const mgr = createManager();
      mgr.init({ cloudLatestSeq: 3256 });

      // First run before reboot
      mgr.processIncomingLine('DATA,0,100,512,512.00,0,30.00,0,NONE,ACTIVE'); // 3257
      mgr.processIncomingLine('DATA,1,1100,512,512.00,0,30.00,0,NONE,ACTIVE'); // 3258
      mgr.processIncomingLine('DATA,2,2100,512,512.00,0,30.00,0,NONE,ACTIVE'); // 3259

      // Arduino reboots: outputs diagnostic
      const diag = mgr.processIncomingLine('STATUS:CALIBRATION_STARTED');
      expect(diag.type).toBe('DIAGNOSTIC');
      expect(diag.modified).toBe(false);

      // Arduino sends raw sequence 0 after reboot
      const rebootPkt0 = mgr.processIncomingLine('DATA,0,100,512,512.00,0,30.00,0,NONE,ACTIVE');
      expect(rebootPkt0.rawSeq).toBe(0);
      expect(rebootPkt0.globalSeq).toBe(3260); // Continues from 3259 + 1
      expect(rebootPkt0.line).toBe('DATA,3260,100,512,512.00,0,30.00,0,NONE,ACTIVE');

      const rebootPkt1 = mgr.processIncomingLine('DATA,1,1100,512,512.00,0,30.00,0,NONE,ACTIVE');
      expect(rebootPkt1.rawSeq).toBe(1);
      expect(rebootPkt1.globalSeq).toBe(3261);
      expect(rebootPkt1.line).toBe('DATA,3261,1100,512,512.00,0,30.00,0,NONE,ACTIVE');
    });

    test('re-anchors sequence monotonically even if reboot occurred silently without diagnostics', () => {
      const mgr = createManager();
      mgr.init({ cloudLatestSeq: 3256 });

      mgr.processIncomingLine('DATA,0,100,512,512.00,0,30.00,0,NONE,ACTIVE'); // 3257
      mgr.processIncomingLine('DATA,50,50000,512,512.00,0,30.00,0,NONE,ACTIVE'); // 3307

      // Raw sequence drops from 50 to 0 without preceding diagnostic
      const silentReboot = mgr.processIncomingLine('DATA,0,100,512,512.00,0,30.00,0,NONE,ACTIVE');
      expect(silentReboot.rawSeq).toBe(0);
      expect(silentReboot.globalSeq).toBe(3308); // 3307 + 1
      expect(silentReboot.line).toBe('DATA,3308,100,512,512.00,0,30.00,0,NONE,ACTIVE');
    });
  });

  describe('4. COM5 Reconnection and DTR Reset', () => {
    test('handles repeated startup diagnostics and serial reset without multiplying offsets', () => {
      const mgr = createManager();
      mgr.init({ cloudLatestSeq: 3256 });

      mgr.processIncomingLine('DATA,0,100,512,512.00,0,30.00,0,NONE,ACTIVE'); // 3257

      // Port drops and triggers notifySerialReset
      mgr.notifySerialReset();

      // Board reboot sequence sends multiple startup diagnostic lines
      mgr.processIncomingLine('SYSTEM:HOSPITAL_MOBILITY_SYSTEM_V1');
      mgr.processIncomingLine('STATUS:CALIBRATION_STARTED');
      mgr.processIncomingLine('STATUS:CALIBRATION_COMPLETED');
      mgr.processIncomingLine('STATUS:SENSOR_READY');

      // Next telemetry line arrives
      const pkt = mgr.processIncomingLine('DATA,0,100,512,512.00,0,30.00,0,NONE,ACTIVE');
      expect(pkt.globalSeq).toBe(3258); // Exactly 3257 + 1, not incremented by 4 diagnostics!
    });
  });

  describe('5. Gateway Process Restart & Pending Packet Recovery', () => {
    test('recovers pending unacknowledged packets and prevents sequence reuse', () => {
      // Instance 1
      const mgr1 = createManager();
      mgr1.init({ cloudLatestSeq: 3256 });

      mgr1.processIncomingLine('DATA,0,100,512,512.00,0,30.00,0,NONE,ACTIVE'); // 3257
      mgr1.processIncomingLine('DATA,1,1100,512,512.00,0,30.00,0,NONE,ACTIVE'); // 3258
      mgr1.processIncomingLine('DATA,2,2100,512,512.00,0,30.00,0,NONE,ACTIVE'); // 3259

      // Only 3257 was acknowledged by cloud
      mgr1.markDelivered(3257);

      // Packets 3258 and 3259 remain pending
      expect(mgr1.getPendingPackets().length).toBe(2);
      expect(mgr1.getPendingPackets()[0].globalSeq).toBe(3258);
      expect(mgr1.getPendingPackets()[1].globalSeq).toBe(3259);

      // Simulate crash: release lock so Instance 2 can start
      mgr1.releaseLock();

      // Instance 2 starts up. Cloud database only has 3257.
      const mgr2 = createManager();
      const initInfo2 = mgr2.init({ cloudLatestSeq: 3257 });

      // Start floor must be max(cloudLatestSeq: 3257, localHighest: 3259) = 3259
      expect(initInfo2.startFloor).toBe(3259);
      expect(initInfo2.recoveredPackets).toBe(2);

      const recovered = mgr2.getPendingPackets();
      expect(recovered.length).toBe(2);
      expect(recovered[0].globalSeq).toBe(3258);
      expect(recovered[1].globalSeq).toBe(3259);

      // First newly received packet from Arduino after restart MUST be >= 3260
      const nextPkt = mgr2.processIncomingLine('DATA,0,100,512,512.00,0,30.00,0,NONE,ACTIVE');
      expect(nextPkt.globalSeq).toBe(3260);
      expect(nextPkt.globalSeq).toBeGreaterThan(3259);
    });
  });

  describe('6. Network Timeout After Successful Cloud Persistence & Retry Stability', () => {
    test('guarantees packet sequence assignment is stable and retries resend exact same line', () => {
      const mgr = createManager();
      mgr.init({ cloudLatestSeq: 3256 });

      const pkt = mgr.processIncomingLine('DATA,0,100,512,512.00,0,30.00,0,NONE,ACTIVE');
      expect(pkt.globalSeq).toBe(3257);

      // The packet line is fixed at DATA,3257,...
      const pendingBefore = mgr.getPendingPackets();
      expect(pendingBefore[0].line).toBe('DATA,3257,100,512,512.00,0,30.00,0,NONE,ACTIVE');

      // Network retry occurs: pending item retries count increments, line and globalSeq remain identical
      pendingBefore[0].retries += 1;
      expect(pendingBefore[0].globalSeq).toBe(3257);
      expect(pendingBefore[0].line).toBe('DATA,3257,100,512,512.00,0,30.00,0,NONE,ACTIVE');
    });
  });

  describe('7. Duplicate HTTP 200 Acknowledgement', () => {
    test('cleans delivered packet from pending queue and persists state', () => {
      const mgr = createManager();
      mgr.init({ cloudLatestSeq: 3256 });

      mgr.processIncomingLine('DATA,0,100,512,512.00,0,30.00,0,NONE,ACTIVE'); // 3257
      mgr.processIncomingLine('DATA,1,1100,512,512.00,0,30.00,0,NONE,ACTIVE'); // 3258

      expect(mgr.getPendingPackets().length).toBe(2);

      // HTTP 200 Duplicate acknowledged for 3257
      mgr.markDelivered(3257);
      expect(mgr.getPendingPackets().length).toBe(1);
      expect(mgr.getPendingPackets()[0].globalSeq).toBe(3258);

      // Verify state file on disk has updated pendingPackets
      const diskState = mgr.loadStateSafe();
      expect(diskState.pendingPackets.length).toBe(1);
      expect(diskState.pendingPackets[0].globalSeq).toBe(3258);
    });

    test('batch delivery marks multiple packets delivered simultaneously', () => {
      const mgr = createManager();
      mgr.init({ cloudLatestSeq: 3256 });

      mgr.processIncomingLine('DATA,0,100,512,512.00,0,30.00,0,NONE,ACTIVE'); // 3257
      mgr.processIncomingLine('DATA,1,1100,512,512.00,0,30.00,0,NONE,ACTIVE'); // 3258
      mgr.processIncomingLine('DATA,2,2100,512,512.00,0,30.00,0,NONE,ACTIVE'); // 3259

      mgr.markBatchDelivered([3257, 3258]);
      expect(mgr.getPendingPackets().length).toBe(1);
      expect(mgr.getPendingPackets()[0].globalSeq).toBe(3259);
    });
  });

  describe('8. Repeated Serial Packets & Out-of-Order Handling', () => {
    test('suppresses repeated identical raw sequence without reboot (type DUPLICATE)', () => {
      const mgr = createManager();
      mgr.init({ cloudLatestSeq: 3256 });

      const p1 = mgr.processIncomingLine('DATA,5,5000,512,512.00,0,30.00,0,NONE,ACTIVE');
      expect(p1.type).toBe('DATA');
      expect(p1.rawSeq).toBe(5);
      expect(p1.globalSeq).toBe(3257);
      expect(mgr.getPendingPackets().length).toBe(1);

      // Serial port line bounce / duplicate raw packet arrives without reboot
      const p2 = mgr.processIncomingLine('DATA,5,5000,512,512.00,0,30.00,0,NONE,ACTIVE');
      expect(p2.type).toBe('DUPLICATE');
      expect(p2.rawSeq).toBe(5);
      expect(p2.globalSeq).toBe(3257);
      expect(p2.modified).toBe(false);

      // Verify no new sequence was allocated and no second packet was added to pending
      expect(mgr.getState().highestAssignedSequence).toBe(3257);
      expect(mgr.getPendingPackets().length).toBe(1);
    });

    test('repeated MOVEMENT packet does not allocate new sequence or create duplicate event', () => {
      const mgr = createManager();
      mgr.init({ cloudLatestSeq: 3256 });

      // First physical movement event
      const p1 = mgr.processIncomingLine('DATA,10,10000,600,512.00,88,30.00,1,MOVEMENT,ACTIVE');
      expect(p1.type).toBe('DATA');
      expect(p1.globalSeq).toBe(3257);
      expect(p1.line).toContain('MOVEMENT');
      expect(mgr.getPendingPackets().length).toBe(1);

      // Duplicate serial line arrives with the same MOVEMENT data
      const p2 = mgr.processIncomingLine('DATA,10,10000,600,512.00,88,30.00,1,MOVEMENT,ACTIVE');
      expect(p2.type).toBe('DUPLICATE');
      expect(p2.globalSeq).toBe(3257);

      // Pending queue MUST still only contain the single initial event
      expect(mgr.getPendingPackets().length).toBe(1);
      expect(mgr.getState().highestAssignedSequence).toBe(3257);
    });

    test('valid normal sequential telemetry increments strictly by 1', () => {
      const mgr = createManager();
      mgr.init({ cloudLatestSeq: 3256 });

      for (let seq = 0; seq < 5; seq++) {
        const res = mgr.processIncomingLine(`DATA,${seq},${seq * 1000},512,512.00,0,30.00,0,NONE,ACTIVE`);
        expect(res.type).toBe('DATA');
        expect(res.rawSeq).toBe(seq);
        expect(res.globalSeq).toBe(3257 + seq);
      }
      expect(mgr.getState().highestAssignedSequence).toBe(3261);
      expect(mgr.getPendingPackets().length).toBe(5);
    });

    test('genuine reboot with sequence zero after single packet is correctly recognized', () => {
      const mgr = createManager();
      mgr.init({ cloudLatestSeq: 3256 });

      // Board booted, sent sequence 0
      const p1 = mgr.processIncomingLine('DATA,0,1000,512,512.00,0,30.00,0,NONE,ACTIVE');
      expect(p1.globalSeq).toBe(3257);

      // Board immediately rebooted: outputs calibration diagnostic
      const diag = mgr.processIncomingLine('STATUS:CALIBRATION_STARTED');
      expect(diag.type).toBe('DIAGNOSTIC');

      // Board sends sequence 0 again after reboot
      const p2 = mgr.processIncomingLine('DATA,0,100,512,512.00,0,30.00,0,NONE,ACTIVE');
      expect(p2.type).toBe('DATA'); // Not DUPLICATE, because reboot diagnostic was present!
      expect(p2.rawSeq).toBe(0);
      expect(p2.globalSeq).toBe(3258);
      expect(mgr.getState().highestAssignedSequence).toBe(3258);
    });

    test('handles out-of-order packets while preserving monotonicity', () => {
      const mgr = createManager();
      mgr.init({ cloudLatestSeq: 3256 });

      const p0 = mgr.processIncomingLine('DATA,0,1000,512,512.00,0,30.00,0,NONE,ACTIVE');
      expect(p0.globalSeq).toBe(3257);

      // Sequence jumps from 0 to 3 (packets 1 and 2 dropped over lossy cable)
      const p3 = mgr.processIncomingLine('DATA,3,4000,512,512.00,0,30.00,0,NONE,ACTIVE');
      expect(p3.globalSeq).toBe(3260);

      // Out-of-order delayed packet 1 arrives later (rawSeq 1 < lastRawSeq 3)
      const p1 = mgr.processIncomingLine('DATA,1,2000,512,512.00,0,30.00,0,NONE,ACTIVE');
      expect(p1.type).toBe('DATA');
      expect(p1.globalSeq).toBe(3261); // Monotonicity strictly preserved > 3260!
      expect(p1.globalSeq).toBeGreaterThan(p3.globalSeq);
    });
  });

  describe('9. Diagnostic Messages Remaining Unchanged', () => {
    test('preserves diagnostic and header lines without modifying content or sequence counters', () => {
      const mgr = createManager();
      mgr.init({ cloudLatestSeq: 3256 });

      const diag1 = 'STATUS:SENSOR_SIGNAL_CHECK_REQUIRED';
      const rDiag1 = mgr.processIncomingLine(diag1);
      expect(rDiag1.type).toBe('DIAGNOSTIC');
      expect(rDiag1.line).toBe(diag1);
      expect(rDiag1.modified).toBe(false);

      const header = 'TYPE,SEQUENCE,TIME_MS,RAW,BASELINE,DEVIATION,THRESHOLD,MOVEMENT_COUNT,EVENT,STATUS';
      const rHeader = mgr.processIncomingLine(header);
      expect(rHeader.type).toBe('HEADER');
      expect(rHeader.line).toBe(header);
      expect(rHeader.modified).toBe(false);

      expect(mgr.getState().highestAssignedSequence).toBe(3256); // Unchanged
    });
  });

  describe('10. Storage Failure and Backend Synchronization Failure', () => {
    test('halts and throws on storage write failure without silently dropping packets', () => {
      const mgr = createManager();
      mgr.init({ cloudLatestSeq: 3256 });

      // Mock saveStateCrashSafe to simulate disk I/O error
      jest.spyOn(mgr, 'saveStateCrashSafe').mockImplementation(() => {
        throw new Error('EACCES: permission denied, disk write protected');
      });

      expect(() => {
        mgr.processIncomingLine('DATA,0,100,512,512.00,0,30.00,0,NONE,ACTIVE');
      }).toThrow(/Critical persistence failure/);

      expect(mgr.getState().isHalted).toBe(true);

      // Subsequent packets must be refused while halted
      expect(() => {
        mgr.processIncomingLine('DATA,1,1100,512,512.00,0,30.00,0,NONE,ACTIVE');
      }).toThrow(/SequenceManager is halted/);
    });

    test('refuses to start if local state file is corrupted JSON', () => {
      fs.writeFileSync(stateFilePath, 'CORRUPTED_NON_JSON_DATA{{{', 'utf8');

      const mgr = createManager();
      expect(() => {
        mgr.init({ cloudLatestSeq: 3256 });
      }).toThrow(/Storage integrity error: corrupted gateway state file/);
    });
  });

  describe('11. Concurrent Gateway Startup Protection', () => {
    test('blocks second gateway instance from starting when active PID holds lock', () => {
      const mgr1 = createManager();
      mgr1.acquireLock();
      expect(mgr1.getState().lockAcquired).toBe(true);

      const mgr2 = createManager();
      // mgr2 attempts to acquire lock while process.pid holds it
      expect(() => {
        // Mock PID in lock file to simulate another alive process
        const activePid = process.pid;
        fs.writeFileSync(
          lockFilePath,
          JSON.stringify({ pid: activePid, deviceCode: 'ARDUINO-PIEZO-01' }),
          'utf8'
        );
        // Change process.pid simulation or call with another instance
        const anotherMgr = new SequenceManager({
          deviceCode: 'ARDUINO-PIEZO-01',
          stateFilePath,
          lockFilePath,
        });
        // We simulate another process checking an active PID:
        jest.spyOn(SequenceManager, 'isProcessAlive').mockReturnValue(true);
        // Set fake PID in lock file
        fs.writeFileSync(
          lockFilePath,
          JSON.stringify({ pid: 88888, deviceCode: 'ARDUINO-PIEZO-01' }),
          'utf8'
        );
        anotherMgr.acquireLock();
      }).toThrow(/Another gateway instance \(PID 88888\) is currently running/);
    });

    test('claims lock safely if existing lock file belongs to a dead/stale process', () => {
      // Write stale lock with dead PID
      fs.writeFileSync(
        lockFilePath,
        JSON.stringify({ pid: 999999, deviceCode: 'ARDUINO-PIEZO-01' }),
        'utf8'
      );

      const mgr = createManager();
      jest.spyOn(SequenceManager, 'isProcessAlive').mockReturnValue(false);

      const acquired = mgr.acquireLock();
      expect(acquired).toBe(true);
      expect(mgr.getState().lockAcquired).toBe(true);
    });
  });
});
