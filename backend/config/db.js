const mongoose = require('mongoose');
let connectionPromise;

async function connectDB() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is missing. Create your .env file.');
  const maxPoolSize = Number(process.env.MONGODB_MAX_POOL_SIZE || 10);
  if (!Number.isInteger(maxPoolSize) || maxPoolSize < 1 || maxPoolSize > 100) {
    throw new Error('MONGODB_MAX_POOL_SIZE must be a whole number from 1 to 100.');
  }
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (mongoose.connection.readyState === 2 && connectionPromise) return connectionPromise;

  connectionPromise = mongoose.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10000,
    maxPoolSize
  }).then(() => {
    console.log(`MongoDB connected: ${mongoose.connection.name}`);
    return mongoose.connection;
  }).catch(error => {
    connectionPromise = undefined;
    throw error;
  });

  return connectionPromise;
}

mongoose.connection.on('disconnected', () => {
  connectionPromise = undefined;
});

module.exports = connectDB;
