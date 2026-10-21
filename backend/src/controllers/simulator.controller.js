const simulatorService = require('../services/simulator.service');

class SimulatorController {
  async simulateWalk(req, res, next) {
    try {
      const { patientId } = req.body;
      const result = await simulatorService.simulateWalk(patientId);
      res.json({
        success: true,
        scenario: 'WALKING',
        message: 'Walking movement telemetry emitted successfully',
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  async simulateInactivity(req, res, next) {
    try {
      const { patientId } = req.body;
      const result = await simulatorService.simulateInactivity(patientId);
      res.json({
        success: true,
        scenario: 'INACTIVITY',
        message: 'Stationary telemetry emitted; movement status updated to STATIONARY (zero alerts generated)',
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  async simulateFall(req, res, next) {
    try {
      const { patientId } = req.body;
      const result = await simulatorService.simulateFall(patientId);
      res.status(201).json({
        success: true,
        scenario: 'FALL_IMPACT',
        message: 'Fall impact telemetry emitted; CRITICAL alert generated immediately',
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  async getStatus(req, res) {
    const status = simulatorService.getStatus();
    res.json({ success: true, data: status });
  }

  async toggleAutoLoop(req, res, next) {
    try {
      const { enable } = req.body;
      const result = await simulatorService.toggleAutoSimulation(enable);
      res.json({
        success: true,
        message: `Background auto-simulation is now ${result.isAutoRunning ? 'ENABLED' : 'DISABLED'}`,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new SimulatorController();
