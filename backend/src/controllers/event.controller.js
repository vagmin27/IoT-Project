const sseManager = require('../sockets/sse.manager');
const sensorService = require('../services/sensor.service');

class EventController {
  /**
   * SSE Stream endpoint (GET /api/events/stream)
   */
  streamEvents(req, res) {
    sseManager.addClient(req, res);
  }

  /**
   * Ingest direct telemetry (POST /api/events)
   */
  async ingestEvent(req, res, next) {
    try {
      const payload = req.body;
      const result = await sensorService.ingestTelemetry(payload);
      if (result.duplicate) {
        return res.status(200).json({
          success: false,
          duplicate: true,
          message: 'Duplicate event sequence ignored',
        });
      }
      res.status(201).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Telemetry history (GET /api/events/history)
   */
  async getHistory(req, res, next) {
    try {
      const { patientId, limit } = req.query;
      const events = patientId
        ? await sensorService.getRecentEventsForPatient(patientId, limit ? parseInt(limit, 10) : 50)
        : await sensorService.getAllEvents({}, limit ? parseInt(limit, 10) : 100);

      res.json({ success: true, count: events.length, data: events });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new EventController();
