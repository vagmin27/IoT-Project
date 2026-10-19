# Backend Service

Server architecture, ingestion layer, API routes, data models, and services for the Hospital Mobility Project.

## Structure
- \src/config/\: Application and environment configuration.
- \src/models/\: Data models (Patient, Device, LocationEvent, SensorEvent, Alert).
- \src/routes/\: REST endpoint definitions.
- \src/controllers/\: Request handling and validation.
- \src/services/\: Business logic (sensors, location tracking, alerting).
- \src/middleware/\: Authentication, error handling, and request logging.
- \src/sockets/\: Real-time WebSocket / MQTT event handlers.
