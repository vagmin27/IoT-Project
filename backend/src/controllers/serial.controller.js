const serialBridgeService = require('../services/serialBridge.service');
const hardwareFaultService = require('../services/hardwareFault.service');

class SerialController {
  /**
   * GET /api/serial/status
   * Returns live status of the USB serial bridge
   */
  async getStatus(req, res, next) {
    try {
      const status = await serialBridgeService.getStatus();
      res.json({ success: true, data: status });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/serial/reconnect
   * Triggers manual reconnection (ADMIN only)
   */
  async reconnect(req, res, next) {
    try {
      const updatedStatus = await serialBridgeService.reconnect();
      res.json({
        success: true,
        message: 'Serial bridge reconnection initiated',
        data: updatedStatus,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/serial/history
   * Returns historical PiezoEvent telemetry logs
   */
  async getHistory(req, res, next) {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit, 10) : 100;
      const history = await serialBridgeService.getHistory(limit);
      res.json({ success: true, count: history.length, data: history });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/serial/faults
   * Returns active or historical hardware fault events
   */
  async getFaults(req, res, next) {
    try {
      const deviceParam = req.query.deviceId;
      const targetDeviceId = (deviceParam === 'ALL' || deviceParam === '*')
        ? null
        : (deviceParam || serialBridgeService.deviceCode || 'ARDUINO-PIEZO-01');
      const isHistorical = req.query.activeOnly === 'false' || req.query.history === 'true';

      // Validate limit: accept only valid positive integers, clamp to maximum of 500, default to 100
      let limit = 100;
      if (req.query.limit !== undefined) {
        const parsed = Number(req.query.limit);
        if (Number.isInteger(parsed) && parsed > 0) {
          limit = Math.min(parsed, 500);
        } else {
          limit = 100;
        }
      }
      const faults = isHistorical
        ? await hardwareFaultService.getFaultHistory(targetDeviceId ? { deviceId: targetDeviceId } : {}, limit)
        : await hardwareFaultService.getActiveFaults(targetDeviceId);
      res.json({ success: true, count: faults.length, data: faults });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new SerialController();
