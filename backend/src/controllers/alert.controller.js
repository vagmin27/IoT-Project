const alertService = require('../services/alert.service');

class AlertController {
  async getAlerts(req, res, next) {
    try {
      const { status, severity, patientId } = req.query;
      const filter = {};
      if (status) filter.status = status;
      if (severity) filter.severity = severity;
      if (patientId) filter.patientId = patientId;

      const alerts = await alertService.getAllAlerts(filter);
      res.json({ success: true, count: alerts.length, data: alerts });
    } catch (err) {
      next(err);
    }
  }

  async getActiveAlerts(req, res, next) {
    try {
      const alerts = await alertService.getActiveAlerts();
      res.json({ success: true, count: alerts.length, data: alerts });
    } catch (err) {
      next(err);
    }
  }

  async acknowledgeAlert(req, res, next) {
    try {
      const { id } = req.params;
      const { staffId = 'STAFF-RN-DEFAULT', notes = '' } = req.body;
      const updated = await alertService.acknowledgeAlert(id, staffId, notes);
      res.json({ success: true, message: 'Alert acknowledged successfully', data: updated });
    } catch (err) {
      next(err);
    }
  }

  async resolveAlert(req, res, next) {
    try {
      const { id } = req.params;
      const { staffId = 'STAFF-RN-DEFAULT', notes = '' } = req.body;
      const updated = await alertService.resolveAlert(id, staffId, notes);
      res.json({ success: true, message: 'Alert resolved successfully', data: updated });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new AlertController();
