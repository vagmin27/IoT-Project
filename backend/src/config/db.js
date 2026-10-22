const mongoose = require('mongoose');

/**
 * Strips sensitive credentials from MongoDB URIs and log messages
 * e.g., mongodb://user:pass@host -> mongodb://***:***@host
 */
const sanitizeUri = (uri) => {
  if (!uri || typeof uri !== 'string') return '';
  return uri.replace(/\/\/[^:]+:[^@]+@/, '//***:***@');
};

/**
 * Returns whether MongoDB connection is actively established
 */
const isDBConnected = () => {
  return mongoose.connection.readyState === 1;
};

/**
 * Returns structured connection status for health checks
 */
const getDBStatus = () => {
  const readyState = mongoose.connection.readyState;
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  const stateDescription = states[readyState] || 'unknown';

  return {
    connected: readyState === 1,
    readyState,
    status: stateDescription,
    host: readyState === 1 ? mongoose.connection.host : null,
    name: readyState === 1 ? mongoose.connection.name : null,
  };
};

/**
 * Derives an isolated test database URI if running in test environment
 */
const resolveTargetUri = (uriOverride) => {
  if (uriOverride) return uriOverride;

  const baseUri = process.env.MONGODB_URI;
  if (!baseUri) {
    console.warn('[MongoDB] MONGODB_URI is not set. Defaulting to local: mongodb://127.0.0.1:27017/hospital_mobility');
    return 'mongodb://127.0.0.1:27017/hospital_mobility';
  }

  // If in test environment, redirect to dedicated test database to protect dev data
  if (process.env.NODE_ENV === 'test') {
    if (process.env.TEST_MONGODB_URI) {
      return process.env.TEST_MONGODB_URI;
    }
    // Isolate by appending _test or replacing database name
    try {
      const parsed = new URL(baseUri.replace('mongodb://', 'http://').replace('mongodb+srv://', 'http://'));
      const originalDb = parsed.pathname.replace(/^\//, '') || 'hospital_mobility';
      const testDb = originalDb.endsWith('_test') ? originalDb : `${originalDb}_test`;
      return baseUri.replace(`/${originalDb}`, `/${testDb}`);
    } catch {
      return baseUri;
    }
  }

  return baseUri;
};

const connectDB = async (uriOverride, options = {}) => {
  const uri = resolveTargetUri(uriOverride);

  // Close existing connection if already connecting/connected to a different target
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }

  const timeoutMs = options.serverSelectionTimeoutMS || 5000;

  try {
    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: timeoutMs,
      ...options,
    });
    console.log(`[MongoDB] Connected successfully to host: ${conn.connection.host}, database: ${conn.connection.name}`);
    return conn;
  } catch (error) {
    const sanitizedError = sanitizeUri(error.message);
    console.error(`[MongoDB] Connection error: ${sanitizedError}`);
    console.error(`[MongoDB] Please verify that your MongoDB service is running or check your MONGODB_URI in .env`);
    throw error;
  }
};

const disconnectDB = async () => {
  try {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
      console.log('[MongoDB] Connection closed.');
    }
  } catch (error) {
    console.error(`[MongoDB] Error closing connection: ${sanitizeUri(error.message)}`);
  }
};

module.exports = {
  connectDB,
  disconnectDB,
  isDBConnected,
  getDBStatus,
  sanitizeUri,
};

