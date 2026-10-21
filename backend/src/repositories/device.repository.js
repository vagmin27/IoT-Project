const Device = require('../models/Device');

class DeviceRepository {
  async findAll(query = {}) {
    return await Device.find(query).populate('assignedPatientId');
  }

  async findById(id) {
    return await Device.findById(id).populate('assignedPatientId');
  }

  async findByCode(deviceCode) {
    return await Device.findOne({ deviceCode });
  }

  async create(deviceData) {
    return await Device.create(deviceData);
  }

  async update(id, updateData) {
    return await Device.findByIdAndUpdate(id, updateData, { new: true, runValidators: true });
  }

  async assignToPatient(deviceId, patientId) {
    return await Device.findByIdAndUpdate(
      deviceId,
      { assignedPatientId: patientId, status: 'ACTIVE' },
      { new: true }
    );
  }

  async unassign(deviceId) {
    return await Device.findByIdAndUpdate(
      deviceId,
      { assignedPatientId: null },
      { new: true }
    );
  }

  async count(query = {}) {
    return await Device.countDocuments(query);
  }
}

module.exports = new DeviceRepository();
