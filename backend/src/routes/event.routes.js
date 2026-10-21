const express = require('express');
const router = express.Router();
const eventController = require('../controllers/event.controller');

router.get('/stream', (req, res) => eventController.streamEvents(req, res));
router.post('/', (req, res, next) => eventController.ingestEvent(req, res, next));
router.get('/history', (req, res, next) => eventController.getHistory(req, res, next));

module.exports = router;
