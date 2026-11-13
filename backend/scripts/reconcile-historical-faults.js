#!/usr/bin/env node

/**
 * ==============================================================================
 * Hospital Mobility Monitoring System - Historical Hardware Fault Reconciliation
 * ==============================================================================
 *
 * Purpose:
 * Reconciles the four exact historical unrecovered DeviceFault records identified in the audit:
 * 1. Document ID: 6af165456d4c8207d1f9e6ea (SERIAL_COMM_FAILURE from early Render boot attempt)
 * 2. Document ID: 6aef6291cd40538c49cba04b (INVALID_READINGS - DATA,abc fixture)
 * 3. Document ID: 6aef6291cd40538c49cba04d (INVALID_READINGS - DATA,0,time fixture)
 * 4. Document ID: 6aef6291cd40538c49cba04f (INVALID_READINGS - DATA,0,4500,NaN fixture)
 *
 * Strict Safety Requirements:
 * - Requires EXACT MongoDB document IDs matching the four approved records.
 * - Validates deviceId ('ARDUINO-PIEZO-01'), faultType, severity, and details.
 * - Requires EXACTLY FOUR distinct matching records before allowing --apply.
 * - Aborts without modifying anything if the count or identity differs.
 * - Preserves all 15 historical records in MongoDB (NO deletions).
 * - Preserves original occurredAt, details, severity, and _id fields.
 * - Evaluates device faultStatus according to existing device-health rules.
 * - Defaults to DRY-RUN mode; requires explicit --apply flag to execute updates.
 * - Does NOT run automatically on server boot or test execution.
 *
 * Usage:
 *   node backend/scripts/reconcile-historical-faults.js             (Dry Run: reports planned updates)
 *   node backend/scripts/reconcile-historical-faults.js --dry-run   (Dry Run: reports planned updates)
 *   node backend/scripts/reconcile-historical-faults.js --apply     (Executes reconciliation upon approval)
 * ==============================================================================
 */

const path = require('path');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

// Load environment config
const envPath = path.resolve(__dirname, '..', '.env');
dotenv.config({ path: envPath });

const isApply = process.argv.includes('--apply');
const isDryRun = !isApply;

const APPROVED_TARGET_IDS = [
  '6af165456d4c8207d1f9e6ea',
  '6aef6291cd40538c49cba04b',
  '6aef6291cd40538c49cba04d',
  '6aef6291cd40538c49cba04f',
];

const TARGET_SPECIFICATIONS = [
  {
    targetDocId: '6af165456d4c8207d1f9e6ea',
    targetId: 'SERIAL_BOOT_FAILURE',
    deviceId: 'ARDUINO-PIEZO-01',
    faultType: 'SERIAL_COMM_FAILURE',
    severity: 'CRITICAL',
    detailsMatch: (d) => typeof d === 'string' && d.includes('cannot open COM5'),
    expectedDetailsSnippet: 'cannot open COM5',
    resolutionNotes:
      'Historical environment artifact: Render container attempted direct COM5 access prior to configuring SERIAL_ENABLED=false. Genuine physical sensor communication verified operational via laptop gateway.',
  },
  {
    targetDocId: '6aef6291cd40538c49cba04b',
    targetId: 'MALFORMED_TEST_READINGS_ABC',
    deviceId: 'ARDUINO-PIEZO-01',
    faultType: 'INVALID_READINGS',
    severity: 'WARNING',
    detailsMatch: (d) => typeof d === 'string' && d.includes('DATA,abc,4500,720,580.25,140,75.00,1,MOVEMENT,ACTIVE'),
    expectedDetailsSnippet: 'DATA,abc',
    resolutionNotes:
      'Historical test artifact: Generated during unit test suite execution for malformed packet rejection. Genuine numeric sensor telemetry is verified and streaming continuously.',
  },
  {
    targetDocId: '6aef6291cd40538c49cba04d',
    targetId: 'MALFORMED_TEST_READINGS_TIME',
    deviceId: 'ARDUINO-PIEZO-01',
    faultType: 'INVALID_READINGS',
    severity: 'WARNING',
    detailsMatch: (d) => typeof d === 'string' && d.includes('DATA,0,time,720,580.25,140,75.00,1,MOVEMENT,ACTIVE'),
    expectedDetailsSnippet: 'DATA,0,time',
    resolutionNotes:
      'Historical test artifact: Generated during unit test suite execution for malformed packet rejection. Genuine numeric sensor telemetry is verified and streaming continuously.',
  },
  {
    targetDocId: '6aef6291cd40538c49cba04f',
    targetId: 'MALFORMED_TEST_READINGS_NAN',
    deviceId: 'ARDUINO-PIEZO-01',
    faultType: 'INVALID_READINGS',
    severity: 'WARNING',
    detailsMatch: (d) => typeof d === 'string' && d.includes('DATA,0,4500,NaN,580.25,140,75.00,1,MOVEMENT,ACTIVE'),
    expectedDetailsSnippet: 'DATA,0,4500,NaN',
    resolutionNotes:
      'Historical test artifact: Generated during unit test suite execution for malformed packet rejection. Genuine numeric sensor telemetry is verified and streaming continuously.',
  },
];

/**
 * Validates candidates against exact document IDs and schema rules.
 * Pure function reusable across CLI execution and unit testing.
 */
function validateHistoricalMatches(candidateFaults) {
  const matchedRecords = [];
  const unmatchedFaults = [];

  for (const fault of candidateFaults) {
    const faultIdStr = String(fault._id);
    const spec = TARGET_SPECIFICATIONS.find((s) => s.targetDocId === faultIdStr);

    if (
      spec &&
      fault.deviceId === spec.deviceId &&
      fault.faultType === spec.faultType &&
      fault.severity === spec.severity &&
      spec.detailsMatch(fault.details) &&
      fault.recovered === false
    ) {
      matchedRecords.push({ fault, spec });
    } else {
      unmatchedFaults.push(fault);
    }
  }

  const isExactFour = matchedRecords.length === 4;
  const matchedIds = new Set(matchedRecords.map((m) => String(m.fault._id)));
  const allIdsMatch =
    APPROVED_TARGET_IDS.length === 4 && APPROVED_TARGET_IDS.every((id) => matchedIds.has(id));
  const canApply = isExactFour && allIdsMatch;

  return {
    matchedRecords,
    unmatchedFaults,
    canApply,
    isExactFour,
    allIdsMatch,
  };
}

async function runReconciliation() {
  console.log('==============================================================================');
  console.log(`[Reconciliation] MODE: ${isApply ? 'APPLY (LIVE UPDATE)' : 'DRY RUN (AUDIT ONLY)'}`);
  console.log('==============================================================================');

  if (!process.env.MONGODB_URI) {
    console.error('[Reconciliation] ERROR: MONGODB_URI not found in backend/.env');
    process.exit(1);
  }

  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
    console.log('[Reconciliation] Connected to MongoDB Atlas successfully.');

    const DeviceFault = require('../src/models/DeviceFault');
    const Device = require('../src/models/Device');

    // Fetch all currently unrecovered faults for inspection
    const activeFaults = await DeviceFault.find({ recovered: false }).sort({ occurredAt: 1 }).lean();
    console.log(`[Reconciliation] Found ${activeFaults.length} total active (unrecovered) faults across all devices.`);

    const {
      matchedRecords,
      unmatchedFaults,
      canApply,
      isExactFour,
      allIdsMatch,
    } = validateHistoricalMatches(activeFaults);

    console.log('\n--- MATCHED TARGET HISTORICAL RECORDS ---');
    if (matchedRecords.length === 0) {
      console.log('No unrecovered target historical records found. All historical records may already be reconciled.');
    } else {
      matchedRecords.forEach(({ fault, spec }, idx) => {
        console.log(`\nMatch #${idx + 1} [${spec.targetId}]:`);
        console.log(`  Document ID: ${fault._id}`);
        console.log(`  Device:      ${fault.deviceId}`);
        console.log(`  Fault Type:  ${fault.faultType} (${fault.severity})`);
        console.log(`  Occurred At: ${fault.occurredAt?.toISOString()}`);
        console.log(`  Details:     ${fault.details}`);
        console.log(`  Action:      Mark recovered=true with audited resolution notes`);
      });
    }

    if (unmatchedFaults.length > 0) {
      console.log('\n--- UNMATCHED ACTIVE FAULTS (PROTECTED / WILL NOT TOUCH) ---');
      unmatchedFaults.forEach((f, idx) => {
        console.log(`  #${idx + 1}: [ID: ${f._id}] [${f.deviceId}] ${f.faultType} (${f.severity}) - ${f.details}`);
      });
    }

    // Safety Assertion: Must match exactly the four approved records
    if (!canApply) {
      console.error('\n==============================================================================');
      console.error('[SAFETY CHECK FAILED]');
      if (!isExactFour) {
        console.error(`  Expected exactly 4 matching records, but found ${matchedRecords.length}.`);
      }
      if (!allIdsMatch) {
        console.error('  Matched records do not match the four approved MongoDB document IDs.');
      }
      console.error('  Reconciliation cannot proceed. Aborting without modifying any records.');
      console.error('==============================================================================');
      await mongoose.disconnect();
      if (isApply) {
        process.exit(1);
      }
      return;
    }

    if (isDryRun) {
      console.log('\n==============================================================================');
      console.log('[DRY RUN SUMMARY - ALL SAFETY CHECKS PASSED]');
      console.log(`  Target records verified with exact IDs:    ${matchedRecords.length} / 4`);
      console.log(`  Unmatched active records preserved:        ${unmatchedFaults.length}`);
      console.log('  No database modifications were made.');
      console.log('  To apply these reconciliations, run with the --apply flag after approval.');
      console.log('==============================================================================');
      await mongoose.disconnect();
      return;
    }

    // APPLY MODE (Requires exact 4 matching approved IDs)
    console.log('\nApplying reconciliation updates to the 4 approved records...');
    let reconciledCount = 0;
    const now = new Date();

    for (const { fault, spec } of matchedRecords) {
      const res = await DeviceFault.updateOne(
        { _id: fault._id, recovered: false },
        {
          $set: {
            recovered: true,
            recoveredAt: now,
            resolutionNotes: spec.resolutionNotes,
          },
        }
      );
      if (res.modifiedCount > 0) {
        reconciledCount++;
        console.log(`  [UPDATED] Fault ${fault._id} (${fault.faultType}) marked recovered.`);
      }
    }

    // Re-evaluate ARDUINO-PIEZO-01 device health status using existing device-health rules
    const remainingForArduino = await DeviceFault.find({
      deviceId: 'ARDUINO-PIEZO-01',
      recovered: false,
    });

    console.log(`\nRemaining active faults for ARDUINO-PIEZO-01: ${remainingForArduino.length}`);

    // Standard device health status calculation:
    // 0 active faults -> HEALTHY
    // Remaining critical faults -> FAULTED
    // Remaining warning faults -> DEGRADED
    const computedFaultStatus =
      remainingForArduino.length === 0
        ? 'HEALTHY'
        : remainingForArduino.some((f) => f.severity === 'CRITICAL')
        ? 'FAULTED'
        : 'DEGRADED';

    const deviceRes = await Device.updateOne(
      { deviceCode: 'ARDUINO-PIEZO-01' },
      {
        $set: {
          faultStatus: computedFaultStatus,
        },
      }
    );
    console.log(`  [DEVICE HEALTH] Device ARDUINO-PIEZO-01 faultStatus updated to '${computedFaultStatus}' (matched: ${deviceRes.matchedCount}, modified: ${deviceRes.modifiedCount}).`);

    console.log('\n==============================================================================');
    console.log('[RECONCILIATION COMPLETE]');
    console.log(`  Total historical faults reconciled: ${reconciledCount}`);
    console.log('  All historical audit documents preserved intact in MongoDB Atlas.');
    console.log('==============================================================================');

    await mongoose.disconnect();
  } catch (err) {
    console.error(`[Reconciliation] Error: ${err.message}`);
    process.exit(1);
  }
}

// Only run directly when executed as a CLI script, not when required by a test
if (require.main === module) {
  runReconciliation();
}

module.exports = {
  APPROVED_TARGET_IDS,
  TARGET_SPECIFICATIONS,
  validateHistoricalMatches,
  runReconciliation,
};
