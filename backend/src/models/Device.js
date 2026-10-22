const mongoose = require('mongoose');

const DeviceSchema = new mongoose.Schema(
  {
    deviceCode: {
      type: String,
      required: [true, 'Device code is required'],
      unique: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'OFFLINE', 'SIMULATING'],
      default: 'ACTIVE',
    },
    batteryLevel: {
      type: Number,
      min: 0,
      max: 100,
      default: 98,
    },
    assignedPatientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Patient',
      default: null,
    },
    lastHeartbeat: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Index for patient-device relationship lookups
DeviceSchema.index({ assignedPatientId: 1 });

module.exports = mongoose.model('Device', DeviceSchema);

