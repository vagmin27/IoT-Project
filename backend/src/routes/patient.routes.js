const express = require('express');
const router = express.Router();
const patientController = require('../controllers/patient.controller');

router.get('/', (req, res, next) => patientController.getPatients(req, res, next));
router.get('/:id', (req, res, next) => patientController.getPatientById(req, res, next));
router.post('/', (req, res, next) => patientController.createPatient(req, res, next));
router.put('/:id', (req, res, next) => patientController.updatePatient(req, res, next));
router.patch('/:id/assign-device', (req, res, next) => patientController.assignDevice(req, res, next));
router.patch('/:id/unassign-device', (req, res, next) => patientController.unassignDevice(req, res, next));

module.exports = router;
