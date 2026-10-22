const mongoose = require('mongoose');

const AlertSchema = new mongoose.Schema(
  {
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Patient',
      required: true,
      index: true,
    },
    deviceId: {
      type: String,
      required: true,
    },
    patientName: {
      type: String,
      default: '',
    },
    roomNumber: {
      type: String,
      default: '',
    },
    bedNumber: {
      type: String,
      default: '',
    },
    alertType: {
      type: String,
      enum: ['FALL_DETECTED', 'LOW_BATTERY'],
      default: 'FALL_DETECTED',
    },
    severity: {
      type: String,
      enum: ['CRITICAL', 'WARNING', 'INFO'],
      default: 'CRITICAL',
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'ACKNOWLEDGED', 'RESOLVED'],
      default: 'ACTIVE',
      index: true,
    },
    triggeredAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    acknowledgedAt: {
      type: Date,
      default: null,
    },
    acknowledgedBy: {
      type: String,
      default: null,
    },
    resolvedAt: {
      type: Date,
      default: null,
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

// Compound indexes for active alert queries and patient incident filtering
AlertSchema.index({ status: 1, triggeredAt: -1 });
AlertSchema.index({ patientId: 1, status: 1 });

module.exports = mongoose.model('Alert', AlertSchema);

