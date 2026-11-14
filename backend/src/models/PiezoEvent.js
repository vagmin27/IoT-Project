const mongoose = require('mongoose');

const PiezoEventSchema = new mongoose.Schema(
  {
    deviceId: {
      type: String,
      required: true,
      index: true,
    },
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Patient',
      default: null,
      index: true,
    },
    sequenceNumber: {
      type: Number,
      required: true,
      index: true,
    },
    // Raw firmware SEQUENCE value (resets on Arduino reboot). sequenceNumber above is the
    // translated, monotonic per-device sequence. Null for records forwarded by the gateway.
    arduinoSequenceNumber: {
      type: Number,
      default: null,
    },
    arduinoTimeMs: {
      type: Number,
      required: true,
    },
    raw: {
      type: Number,
      required: true,
    },
    baseline: {
      type: Number,
      required: true,
    },
    deviation: {
      type: Number,
      required: true,
    },
    threshold: {
      type: Number,
      required: true,
    },
    movementCount: {
      type: Number,
      required: true,
    },
    event: {
      type: String,
      enum: ['MOVEMENT', 'INACTIVITY', 'NONE'],
      required: true,
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'INACTIVE', 'SENSOR_CHECK'],
      required: true,
    },
    severity: {
      type: String,
      enum: ['NORMAL', 'WARNING', 'CRITICAL'],
      default: 'NORMAL',
    },
    source: {
      type: String,
      default: 'REAL_HARDWARE',
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Unique compound index on deviceId and sequenceNumber to prevent duplicates
PiezoEventSchema.index({ deviceId: 1, sequenceNumber: 1 }, { unique: true });
PiezoEventSchema.index({ patientId: 1, timestamp: -1 });

module.exports = mongoose.model('PiezoEvent', PiezoEventSchema);
