const mongoose = require('mongoose');

const connectDB = async (uriOverride) => {
  const uri = uriOverride || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/hospital_mobility';

  try {
    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
    });
    console.log(`[MongoDB] Connected successfully to host: ${conn.connection.host}, database: ${conn.connection.name}`);
    return conn;
  } catch (error) {
    console.error(`[MongoDB] Connection error: ${error.message}`);
    console.error(`[MongoDB] Please verify that your MongoDB service is running or check your MONGODB_URI in .env`);
    throw error;
  }
};

const disconnectDB = async () => {
  try {
    await mongoose.connection.close();
    console.log('[MongoDB] Connection closed.');
  } catch (error) {
    console.error(`[MongoDB] Error closing connection: ${error.message}`);
  }
};

module.exports = { connectDB, disconnectDB };
