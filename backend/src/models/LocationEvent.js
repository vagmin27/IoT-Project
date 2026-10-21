const mongoose = require('mongoose');

const LocationEventSchema = new mongoose.Schema(
  {
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Patient',
      required: true,
    },
    roomNumber: {
      type: String,
      required: true,
    },
    bedNumber: {
      type: String,
      default: '',
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('LocationEvent', LocationEventSchema);
