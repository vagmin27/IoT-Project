const Patient = require('../models/Patient');
const Device = require('../models/Device');

const SYNTHETIC_PATIENTS = [
  {
    name: 'Eleanor Vance (Synthetic)',
    roomNumber: '101',
    bedNumber: 'Bed-A',
    status: 'ADMITTED',
    movementStatus: 'STATIONARY',
    assignedDeviceId: 'SIM-TAG-01',
    notes: 'Post-op knee recovery. High fall risk protocol.',
  },
  {
    name: 'Marcus Holloway (Synthetic)',
    roomNumber: '101',
    bedNumber: 'Bed-B',
    status: 'ADMITTED',
    movementStatus: 'WALKING',
    assignedDeviceId: 'SIM-TAG-02',
    notes: 'Assisted ambulation encouraged.',
  },
  {
    name: 'Sarah Connor (Synthetic)',
    roomNumber: '102',
    bedNumber: 'Bed-A',
    status: 'ADMITTED',
    movementStatus: 'STATIONARY',
    assignedDeviceId: 'SIM-TAG-03',
    notes: 'Mild cognitive disorientation during night.',
  },
  {
    name: 'Arthur Dent (Synthetic)',
    roomNumber: '102',
    bedNumber: 'Bed-B',
    status: 'ADMITTED',
    movementStatus: 'WALKING',
    assignedDeviceId: 'SIM-TAG-04',
    notes: 'Recovering nicely, frequent hallway walking.',
  },
  {
    name: 'Elena Fisher (Synthetic)',
    roomNumber: '103',
    bedNumber: 'Bed-A',
    status: 'ADMITTED',
    movementStatus: 'STATIONARY',
    assignedDeviceId: 'SIM-TAG-05',
    notes: 'Monitored bed rest.',
  },
  {
    name: 'Garrus Vakarian (Synthetic)',
    roomNumber: '103',
    bedNumber: 'Bed-B',
    status: 'ADMITTED',
    movementStatus: 'STATIONARY',
    assignedDeviceId: 'SIM-TAG-06',
    notes: 'Calibration underway.',
  },
];

const SYNTHETIC_DEVICES = [
  { deviceCode: 'SIM-TAG-01', batteryLevel: 96, status: 'ACTIVE' },
  { deviceCode: 'SIM-TAG-02', batteryLevel: 89, status: 'ACTIVE' },
  { deviceCode: 'SIM-TAG-03', batteryLevel: 92, status: 'ACTIVE' },
  { deviceCode: 'SIM-TAG-04', batteryLevel: 78, status: 'ACTIVE' },
  { deviceCode: 'SIM-TAG-05', batteryLevel: 84, status: 'ACTIVE' },
  { deviceCode: 'SIM-TAG-06', batteryLevel: 99, status: 'ACTIVE' },
  { deviceCode: 'SIM-TAG-SPARE', batteryLevel: 100, status: 'OFFLINE' },
];

async function seedSyntheticData() {
  try {
    const patientCount = await Patient.countDocuments();
    if (patientCount === 0) {
      console.log('[Seed] Database empty. Seeding initial synthetic patient and device data...');

      // Seed Devices
      const createdDevices = [];
      for (const d of SYNTHETIC_DEVICES) {
        const device = await Device.create(d);
        createdDevices.push(device);
      }

      // Seed Patients and link device
      for (const p of SYNTHETIC_PATIENTS) {
        const patient = await Patient.create(p);
        const matchedDevice = createdDevices.find((d) => d.deviceCode === p.assignedDeviceId);
        if (matchedDevice) {
          await Device.findByIdAndUpdate(matchedDevice._id, { assignedPatientId: patient._id });
        }
      }

      console.log(`[Seed] Seeded ${SYNTHETIC_PATIENTS.length} synthetic patients and ${SYNTHETIC_DEVICES.length} devices.`);
    } else {
      console.log(`[Seed] Existing dataset found (${patientCount} patients). Skipping initial seed.`);
    }
  } catch (err) {
    console.error(`[Seed] Error during seeding: ${err.message}`);
  }
}

module.exports = { seedSyntheticData };
