const { parentPort, workerData } = require('node:worker_threads');
const { pbkdf2Sync } = require('node:crypto');
const result = pbkdf2Sync(`BiPSU-BlueBook-${workerData.job}`, 'bipsu-benchmark-salt', workerData.rounds, 32, 'sha256').toString('hex');
parentPort.postMessage({ job: workerData.job, result });
