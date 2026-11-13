const express = require('express');
const router = express.Router();
const iotController = require('../controllers/iot.controller');
const { verifyGatewaySecret } = require('../middleware/gatewayAuth');

// All IoT routes are strictly protected by gateway secret verification
router.use(verifyGatewaySecret);

// Ingest Arduino CSV telemetry line(s) from gateway
router.post('/telemetry', (req, res, next) => iotController.ingestTelemetry(req, res, next));

// Gateway heartbeat
router.post('/heartbeat', (req, res, next) => iotController.recordHeartbeat(req, res, next));

// Gateway status check
router.get('/status', (req, res, next) => iotController.getGatewayStatus(req, res, next));

module.exports = router;
