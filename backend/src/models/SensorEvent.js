const mongoose = require('mongoose');

const SensorEventSchema = new mongoose.Schema(
  {
    deviceId: {
      type: String,
      required: true,
      index: true,
    },
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Patient',
      required: true,
      index: true,
    },
    sequenceNumber: {
      type: Number,
      required: true,
      index: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
    movementState: {
      type: String,
      enum: ['WALKING', 'STATIONARY', 'RESTING', 'FALL_IMPACT'],
      required: true,
    },
    metrics: {
      accelMagnitude: {
        type: Number,
        required: true,
      },
      pitch: {
        type: Number,
        default: 0,
      },
      roll: {
        type: Number,
        default: 0,
      },
    },
    processed: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index to guarantee idempotency and fast duplicate rejection
SensorEventSchema.index({ deviceId: 1, sequenceNumber: 1 }, { unique: true });
SensorEventSchema.index({ patientId: 1, timestamp: -1 });

module.exports = mongoose.model('SensorEvent', SensorEventSchema);

