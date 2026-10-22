require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { connectDB, getDBStatus } = require('./config/db');
const { seedSyntheticData } = require('./services/seed.service');

const patientRoutes = require('./routes/patient.routes');
const alertRoutes = require('./routes/alert.routes');
const simulatorRoutes = require('./routes/simulator.routes');
const eventRoutes = require('./routes/event.routes');
const errorHandler = require('./middleware/errorHandler');

const app = express();

// Middleware
app.use(cors({
  origin: '*', // Allow frontend client connections
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging in development
if (process.env.NODE_ENV !== 'test') {
  app.use((req, res, next) => {
    console.log(`[HTTP] ${req.method} ${req.path}`);
    next();
  });
}

// Health check endpoint distinguishing application health from database connectivity
app.get('/api/health', (req, res) => {
  const dbStatus = getDBStatus();
  const isHealthy = dbStatus.connected;

  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'healthy' : 'degraded',
    application: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'Hospital Mobility Backend (MERN)',
    database: dbStatus,
  });
});

// Mount domain routes
app.use('/api/patients', patientRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/simulator', simulatorRoutes);
app.use('/api/events', eventRoutes);

// Error Handler
app.use(errorHandler);

// Start server if run directly
const PORT = process.env.PORT || 5000;

if (process.env.NODE_ENV !== 'test') {
  (async () => {
    try {
      await connectDB();
      await seedSyntheticData();
      app.listen(PORT, () => {
        console.log(`[Server] Hospital Mobility Backend running on port ${PORT}`);
        console.log(`[Server] REST API: http://localhost:${PORT}/api`);
        console.log(`[Server] SSE Stream: http://localhost:${PORT}/api/events/stream`);
      });
    } catch (err) {
      console.error(`[Server] Failed to initialize: ${err.message}`);
      process.exit(1);
    }
  })();
}

module.exports = app;
