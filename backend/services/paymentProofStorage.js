const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client
} = require('@aws-sdk/client-s3');
const isLoginTestOnly = require('../utils/isLoginTestOnly');

const localProofDirectory = path.join(__dirname, '..', 'private', 'payment-proofs');
const uploadTempDirectory = path.join(os.tmpdir(), 'bipsu-bluebook-payment-proofs');
const storageMode = process.env.PAYMENT_PROOF_STORAGE || 'local';
let s3Client;
let s3Bucket;

function isValidProofKey(key) {
  return typeof key === 'string' &&
    key.length > 0 &&
    key.length <= 255 &&
    key !== '.' &&
    key !== '..' &&
    !/[\\/]/.test(key);
}

function initializeS3() {
  if (s3Client) return;

  s3Bucket = process.env.OBJECT_STORAGE_BUCKET;
  const region = process.env.OBJECT_STORAGE_REGION || process.env.AWS_REGION;
  const endpoint = process.env.OBJECT_STORAGE_ENDPOINT || undefined;
  const accessKeyId = process.env.OBJECT_STORAGE_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
  const forcePathStyle = process.env.OBJECT_STORAGE_FORCE_PATH_STYLE || 'false';

  if (!s3Bucket || !region) {
    throw new Error('S3 storage requires OBJECT_STORAGE_BUCKET and OBJECT_STORAGE_REGION.');
  }
  if (!['true', 'false'].includes(forcePathStyle)) {
    throw new Error('OBJECT_STORAGE_FORCE_PATH_STYLE must be "true" or "false".');
  }
  if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) {
    throw new Error('Configure both object-storage access-key values, or neither when using a host identity.');
  }

  s3Client = new S3Client({
    region,
    endpoint,
    forcePathStyle: forcePathStyle === 'true',
    ...(accessKeyId ? { credentials: { accessKeyId, secretAccessKey } } : {})
  });
}

function validateConfiguration() {
  if (!['local', 's3'].includes(storageMode)) {
    throw new Error('PAYMENT_PROOF_STORAGE must be either "local" or "s3".');
  }
  const loginTestOnly = isLoginTestOnly();
  if (process.env.VERCEL && storageMode !== 's3' && !loginTestOnly) {
    throw new Error('Vercel deployments require PAYMENT_PROOF_STORAGE=s3.');
  }

  fs.mkdirSync(uploadTempDirectory, { recursive: true });
  if (storageMode === 'local') {
    if (!process.env.VERCEL) fs.mkdirSync(localProofDirectory, { recursive: true });
    return;
  }

  initializeS3();
}

function ensureValidKey(key) {
  if (!isValidProofKey(key)) throw new Error('Invalid payment-proof storage key.');
}

async function store(key, body, contentType) {
  ensureValidKey(key);
  if (storageMode === 's3') {
    initializeS3();
    await s3Client.send(new PutObjectCommand({
      Bucket: s3Bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: 'private, no-store'
    }));
    return;
  }

  await fs.promises.writeFile(path.join(localProofDirectory, key), body, { flag: 'wx' });
}

async function read(key) {
  ensureValidKey(key);
  if (storageMode === 's3') {
    initializeS3();
    try {
      const result = await s3Client.send(new GetObjectCommand({ Bucket: s3Bucket, Key: key }));
      if (!result.Body || typeof result.Body.transformToByteArray !== 'function') {
        throw new Error('Object storage returned an unreadable payment proof.');
      }
      return Buffer.from(await result.Body.transformToByteArray());
    } catch (error) {
      const status = error.$metadata && error.$metadata.httpStatusCode;
      if (error.name === 'NoSuchKey' || error.name === 'NotFound' || status === 404) {
        const missing = new Error('Payment proof was not found.');
        missing.code = 'ENOENT';
        throw missing;
      }
      throw error;
    }
  }

  return fs.promises.readFile(path.join(localProofDirectory, key));
}

async function remove(key) {
  ensureValidKey(key);
  if (storageMode === 's3') {
    initializeS3();
    await s3Client.send(new DeleteObjectCommand({ Bucket: s3Bucket, Key: key }));
    return;
  }

  try {
    await fs.promises.unlink(path.join(localProofDirectory, key));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function close() {
  if (!s3Client) return;
  s3Client.destroy();
  s3Client = undefined;
  s3Bucket = undefined;
}

module.exports = {
  close,
  isObjectStorageEnabled: () => storageMode === 's3',
  isValidProofKey,
  localProofDirectory,
  read,
  remove,
  store,
  uploadTempDirectory,
  validateConfiguration
};
