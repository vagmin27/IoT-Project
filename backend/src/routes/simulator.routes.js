const express = require('express');
const router = express.Router();
const simulatorController = require('../controllers/simulator.controller');

router.post('/walk', (req, res, next) => simulatorController.simulateWalk(req, res, next));
router.post('/inactivity', (req, res, next) => simulatorController.simulateInactivity(req, res, next));
router.post('/fall', (req, res, next) => simulatorController.simulateFall(req, res, next));
router.get('/status', (req, res) => simulatorController.getStatus(req, res));
router.post('/auto-loop/toggle', (req, res, next) => simulatorController.toggleAutoLoop(req, res, next));

module.exports = router;
