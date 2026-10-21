const Alert = require('../models/Alert');

class AlertRepository {
  async findAll(query = {}, limit = 50) {
    return await Alert.find(query)
      .populate('patientId')
      .sort({ triggeredAt: -1 })
      .limit(limit);
  }

  async findActive() {
    return await Alert.find({ status: { $in: ['ACTIVE', 'ACKNOWLEDGED'] } })
      .populate('patientId')
      .sort({ triggeredAt: -1 });
  }

  async findById(id) {
    return await Alert.findById(id).populate('patientId');
  }

  async create(alertData) {
    return await Alert.create(alertData);
  }

  async acknowledge(id, staffId, notes = '') {
    return await Alert.findByIdAndUpdate(
      id,
      {
        status: 'ACKNOWLEDGED',
        acknowledgedBy: staffId,
        acknowledgedAt: new Date(),
        ...(notes ? { notes } : {}),
      },
      { new: true }
    ).populate('patientId');
  }

  async resolve(id, staffId, notes = '') {
    return await Alert.findByIdAndUpdate(
      id,
      {
        status: 'RESOLVED',
        resolvedAt: new Date(),
        ...(staffId && !this.acknowledgedBy ? { acknowledgedBy: staffId } : {}),
        ...(notes ? { notes } : {}),
      },
      { new: true }
    ).populate('patientId');
  }

  async count(query = {}) {
    return await Alert.countDocuments(query);
  }
}

module.exports = new AlertRepository();
