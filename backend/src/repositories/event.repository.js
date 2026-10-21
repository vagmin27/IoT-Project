const SensorEvent = require('../models/SensorEvent');

class EventRepository {
  async create(eventData) {
    return await SensorEvent.create(eventData);
  }

  async findByDeviceAndSequence(deviceId, sequenceNumber) {
    return await SensorEvent.findOne({ deviceId, sequenceNumber });
  }

  async findRecentByPatient(patientId, limit = 50) {
    return await SensorEvent.find({ patientId })
      .sort({ timestamp: -1 })
      .limit(limit);
  }

  async findAll(query = {}, limit = 100) {
    return await SensorEvent.find(query)
      .populate('patientId')
      .sort({ timestamp: -1 })
      .limit(limit);
  }
}

module.exports = new EventRepository();
