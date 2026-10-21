const mongoose = require('mongoose');

const PatientSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Patient name is required'],
      trim: true,
    },
    roomNumber: {
      type: String,
      required: [true, 'Room number is required'],
      trim: true,
    },
    bedNumber: {
      type: String,
      required: [true, 'Bed number is required'],
      trim: true,
    },
    status: {
      type: String,
      enum: ['ADMITTED', 'DISCHARGED'],
      default: 'ADMITTED',
    },
    assignedDeviceId: {
      type: String,
      default: null,
    },
    movementStatus: {
      type: String,
      enum: ['WALKING', 'STATIONARY', 'UNKNOWN'],
      default: 'STATIONARY',
    },
    lastMovementUpdate: {
      type: Date,
      default: Date.now,
    },
    synthetic: {
      type: Boolean,
      default: true,
    },
    notes: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Patient', PatientSchema);
