require('dotenv').config();
const fs = require('node:fs/promises');
const path = require('node:path');
const mongoose = require('mongoose');
const Payment = require('../models/Payment');
const connectDB = require('../config/db');
const proofStorage = require('../services/paymentProofStorage');

async function main() {
  if (!proofStorage.isObjectStorageEnabled()) {
    throw new Error('Set PAYMENT_PROOF_STORAGE=s3 before copying payment proofs.');
  }
  proofStorage.validateConfiguration();
  await connectDB();

  let copied = 0;
  try {
    const cursor = Payment.find({
      proofPath: { $exists: true, $ne: '' }
    }).select('proofPath proofMimeType').cursor();

    for await (const payment of cursor) {
      if (!proofStorage.isValidProofKey(payment.proofPath)) {
        throw new Error(`Payment ${payment._id} has an invalid proof storage key.`);
      }

      let body;
      try {
        body = await fs.readFile(path.join(proofStorage.localProofDirectory, payment.proofPath));
      } catch (error) {
        if (error.code === 'ENOENT') {
          throw new Error(`Local proof file is missing for payment ${payment._id}; migration stopped.`);
        }
        throw error;
      }

      await proofStorage.store(
        payment.proofPath,
        body,
        payment.proofMimeType || 'application/octet-stream'
      );
      copied += 1;
    }

    console.log(`Copied ${copied} payment proof file(s) to object storage. Local files were retained.`);
  } finally {
    try {
      await mongoose.disconnect();
    } finally {
      proofStorage.close();
    }
  }
}

main().catch(error => {
  console.error('Payment proof migration failed:', error.message);
  process.exitCode = 1;
});
