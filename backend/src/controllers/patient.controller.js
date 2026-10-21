const patientRepository = require('../repositories/patient.repository');
const deviceRepository = require('../repositories/device.repository');

class PatientController {
  async getPatients(req, res, next) {
    try {
      const { status } = req.query;
      const query = status ? { status } : {};
      const patients = await patientRepository.findAll(query);
      res.json({ success: true, data: patients });
    } catch (err) {
      next(err);
    }
  }

  async getPatientById(req, res, next) {
    try {
      const patient = await patientRepository.findById(req.params.id);
      if (!patient) {
        return res.status(404).json({ success: false, message: 'Patient not found' });
      }
      res.json({ success: true, data: patient });
    } catch (err) {
      next(err);
    }
  }

  async createPatient(req, res, next) {
    try {
      const { name, roomNumber, bedNumber, notes, assignedDeviceId } = req.body;
      const patient = await patientRepository.create({
        name,
        roomNumber,
        bedNumber,
        notes,
        assignedDeviceId: assignedDeviceId || null,
        synthetic: true,
      });

      if (assignedDeviceId) {
        const device = await deviceRepository.findByCode(assignedDeviceId);
        if (device) {
          await deviceRepository.assignToPatient(device._id, patient._id);
        }
      }

      res.status(201).json({ success: true, data: patient });
    } catch (err) {
      next(err);
    }
  }

  async updatePatient(req, res, next) {
    try {
      const updated = await patientRepository.update(req.params.id, req.body);
      if (!updated) {
        return res.status(404).json({ success: false, message: 'Patient not found' });
      }
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  }

  async assignDevice(req, res, next) {
    try {
      const { deviceId } = req.body;
      const patient = await patientRepository.assignDevice(req.params.id, deviceId);
      if (!patient) {
        return res.status(404).json({ success: false, message: 'Patient not found' });
      }
      const device = await deviceRepository.findByCode(deviceId);
      if (device) {
        await deviceRepository.assignToPatient(device._id, patient._id);
      }
      res.json({ success: true, data: patient });
    } catch (err) {
      next(err);
    }
  }

  async unassignDevice(req, res, next) {
    try {
      const patient = await patientRepository.findById(req.params.id);
      if (!patient) {
        return res.status(404).json({ success: false, message: 'Patient not found' });
      }
      if (patient.assignedDeviceId) {
        const device = await deviceRepository.findByCode(patient.assignedDeviceId);
        if (device) {
          await deviceRepository.unassign(device._id);
        }
      }
      const updated = await patientRepository.unassignDevice(req.params.id);
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new PatientController();
