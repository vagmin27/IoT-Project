const express = require('express');
const router = express.Router();
const alertController = require('../controllers/alert.controller');

router.get('/', (req, res, next) => alertController.getAlerts(req, res, next));
router.get('/active', (req, res, next) => alertController.getActiveAlerts(req, res, next));
router.patch('/:id/acknowledge', (req, res, next) => alertController.acknowledgeAlert(req, res, next));
router.patch('/:id/resolve', (req, res, next) => alertController.resolveAlert(req, res, next));

module.exports = router;
