const mongoose = require('mongoose');
const serialBridgeService = require('../services/serialBridge.service');
const piezoEventRepository = require('../repositories/piezoEvent.repository');

class IotController {
  /**
   * POST /api/iot/telemetry
   * Ingests Arduino CSV telemetry line(s) forwarded by the laptop gateway.
   * Reuses serialBridgeService.handleIncomingLine() for parsing, validation,
   * duplicate checking, database persistence, patient status updates, and SSE broadcast.
   */
  async ingestTelemetry(req, res, next) {
    try {
      const { line, lines, arduinoSerialStatus, port, baudRate } = req.body;

      if (!line && (!Array.isArray(lines) || lines.length === 0)) {
        return res.status(400).json({
          success: false,
          error: 'EMPTY_PAYLOAD',
          message: "Payload must contain either a 'line' string or a non-empty 'lines' array.",
        });
      }

      // Record active gateway connectivity
      await serialBridgeService.recordGatewayTelemetry({
        arduinoSerialStatus: arduinoSerialStatus || 'CONNECTED',
        port: port || 'COM5',
        baudRate: baudRate || 9600,
      });

      // Handle single telemetry line (normal 1 Hz streaming)
      if (line !== undefined) {
        if (typeof line !== 'string') {
          return res.status(400).json({
            success: false,
            error: 'INVALID_TYPE',
            message: "The 'line' field must be a string.",
          });
        }

        const rawLine = line.trim();
        const result = await serialBridgeService.handleIncomingLine(rawLine);

        // Line was processed by handleIncomingLine
        if (result && result.success) {
          // Newly created and persisted PiezoEvent record
          return res.status(201).json({
            success: true,
            duplicate: false,
            data: result.event,
          });
        }

        if (result && result.duplicate) {
          // Duplicate sequence number rejected cleanly
          return res.status(200).json({
            success: true,
            duplicate: true,
            message: 'Duplicate event sequence ignored',
          });
        }

        // When result is null, differentiate why handleIncomingLine returned null
        if (rawLine.startsWith('DATA,')) {
          // Started with DATA, but failed field length, numeric checks, or enum validation
          return res.status(400).json({
            success: false,
            error: 'MALFORMED_TELEMETRY',
            message: 'Telemetry packet was malformed or failed validation checks.',
          });
        }

        if (
          rawLine.includes('CALIBRATION_') ||
          rawLine.includes('SENSOR_') ||
          rawLine.includes('HOSPITAL_MOBILITY')
        ) {
          return res.status(200).json({
            success: true,
            processed: true,
            type: 'DIAGNOSTIC',
            message: 'Diagnostic or control message processed',
          });
        }

        if (rawLine.startsWith('TYPE,') || rawLine.startsWith('DATA,SEQUENCE')) {
          return res.status(200).json({
            success: true,
            processed: false,
            type: 'HEADER',
            message: 'CSV header line ignored',
          });
        }

        return res.status(400).json({
          success: false,
          error: 'UNRECOGNIZED_FORMAT',
          message: 'Unrecognized line format.',
        });
      }

      // Handle batch of lines (e.g. flushing buffered queue after reconnect)
      // Preserves sequential FIFO ordering with await
      const results = [];
      let newCount = 0;
      let duplicateCount = 0;
      let errorCount = 0;

      for (let i = 0; i < lines.length; i++) {
        const item = lines[i];
        if (!item || typeof item !== 'string') {
          errorCount++;
          results.push({ index: i, line: item, success: false, error: 'INVALID_TYPE' });
          continue;
        }

        const trimmed = item.trim();
        const resItem = await serialBridgeService.handleIncomingLine(trimmed);

        if (resItem?.duplicate) {
          duplicateCount++;
          results.push({ index: i, line: trimmed, success: true, duplicate: true });
        } else if (resItem?.success) {
          newCount++;
          results.push({ index: i, line: trimmed, success: true, duplicate: false, id: resItem.event?._id });
        } else if (trimmed.startsWith('DATA,')) {
          errorCount++;
          results.push({ index: i, line: trimmed, success: false, error: 'MALFORMED_TELEMETRY' });
        } else {
          results.push({ index: i, line: trimmed, success: true, diagnostic: true });
        }
      }

      return res.status(200).json({
        success: true,
        batch: true,
        total: lines.length,
        newRecords: newCount,
        duplicates: duplicateCount,
        errors: errorCount,
        results,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/iot/heartbeat
   * Gateway periodic heartbeat to confirm laptop gateway is online and report local serial status.
   */
  async recordHeartbeat(req, res, next) {
    try {
      const { arduinoSerialStatus, port, baudRate } = req.body;
      await serialBridgeService.recordGatewayHeartbeat({
        arduinoSerialStatus: arduinoSerialStatus || 'CONNECTED',
        port: port || 'COM5',
        baudRate: baudRate || 9600,
      });

      res.status(200).json({
        success: true,
        message: 'Gateway heartbeat acknowledged',
        status: serialBridgeService.getGatewayStatus(),
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/iot/status
   * Verifies gateway connectivity, authentication status, and provides the highest sequence number in the DB.
   */
  async getGatewayStatus(req, res, next) {
    try {
      const deviceId = (req && req.query && req.query.deviceId) || serialBridgeService.deviceCode || 'ARDUINO-PIEZO-01';
      let latestSequenceNumber = -1;

      if (mongoose.connection && mongoose.connection.readyState === 1) {
        try {
          latestSequenceNumber = await piezoEventRepository.getLatestSequenceForDevice(deviceId);
        } catch (repoErr) {
          latestSequenceNumber = serialBridgeService.lastSequenceNumber ?? -1;
        }
      } else {
        // Fallback to in-memory serialBridgeService state when DB is not directly connected
        latestSequenceNumber = serialBridgeService.lastSequenceNumber ?? -1;
      }

      res.status(200).json({
        success: true,
        gateway: serialBridgeService.getGatewayStatus(),
        deviceId,
        latestSequenceNumber: typeof latestSequenceNumber === 'number' ? latestSequenceNumber : -1,
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new IotController();
