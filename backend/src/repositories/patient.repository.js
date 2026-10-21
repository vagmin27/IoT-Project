const Patient = require('../models/Patient');

class PatientRepository {
  async findAll(query = {}) {
    return await Patient.find(query).sort({ roomNumber: 1, bedNumber: 1 });
  }

  async findById(id) {
    return await Patient.findById(id);
  }

  async findByDeviceId(deviceId) {
    return await Patient.findOne({ assignedDeviceId: deviceId });
  }

  async create(patientData) {
    return await Patient.create(patientData);
  }

  async update(id, updateData) {
    return await Patient.findByIdAndUpdate(id, updateData, { new: true, runValidators: true });
  }

  async updateMovementStatus(id, movementStatus) {
    return await Patient.findByIdAndUpdate(
      id,
      {
        movementStatus,
        lastMovementUpdate: new Date(),
      },
      { new: true }
    );
  }

  async assignDevice(patientId, deviceId) {
    return await Patient.findByIdAndUpdate(
      patientId,
      { assignedDeviceId: deviceId },
      { new: true }
    );
  }

  async unassignDevice(patientId) {
    return await Patient.findByIdAndUpdate(
      patientId,
      { assignedDeviceId: null },
      { new: true }
    );
  }

  async count(query = {}) {
    return await Patient.countDocuments(query);
  }
}

module.exports = new PatientRepository();
