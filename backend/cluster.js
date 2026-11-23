require('dotenv').config();
const cluster = require('node:cluster');

function getWorkerCount() {
  const workerCount = Number(process.env.APP_WORKERS || 2);

  if (!Number.isInteger(workerCount) || workerCount < 2 || workerCount > 16) {
    throw new Error('APP_WORKERS must be a whole number from 2 to 16.');
  }

  return workerCount;
}

if (cluster.isPrimary) {
  let workerCount;
  try {
    workerCount = getWorkerCount();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  cluster.schedulingPolicy = cluster.SCHED_RR;

  const workerNumbers = new Map();
  let shuttingDown = false;

  function startWorker(workerNumber) {
    const worker = cluster.fork({
      APP_WORKER_ID: `worker-${workerNumber}`,
      RUN_ORDER_EXPIRATION: workerNumber === 1 ? 'true' : 'false'
    });
    workerNumbers.set(worker.id, workerNumber);
    console.log(`Started worker-${workerNumber} (PID ${worker.process.pid}).`);
  }

  cluster.on('exit', (worker, code, signal) => {
    const workerNumber = workerNumbers.get(worker.id);
    workerNumbers.delete(worker.id);
    if (shuttingDown) return;

    console.error(`Worker-${workerNumber} exited (code ${code}, signal ${signal || 'none'}); restarting in 1 second.`);
    setTimeout(() => {
      if (!shuttingDown) startWorker(workerNumber);
    }, 1000);
  });

  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}; shutting down cluster workers.`);

    for (const worker of Object.values(cluster.workers || {})) {
      worker.disconnect();
    }

    const forceExit = setTimeout(() => {
      for (const worker of Object.values(cluster.workers || {})) {
        worker.kill();
      }
      process.exit(1);
    }, 10000);
    forceExit.unref();
  }

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  console.log(`Starting ${workerCount} workers on port ${process.env.PORT || 5000}.`);
  for (let workerNumber = 1; workerNumber <= workerCount; workerNumber += 1) {
    startWorker(workerNumber);
  }
} else {
  require('./server').startServer().catch(error => {
    console.error('Worker startup failed:', error.message);
    process.exitCode = 1;
  });
}
