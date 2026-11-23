const { Worker } = require('node:worker_threads');
const path = require('node:path');
const os = require('node:os');
const { pbkdf2Sync } = require('node:crypto');

const JOBS = Math.max(2, Math.min(16, Number(process.argv[2]) || 4));
const ROUNDS = 60000;
const WORKERS = Math.max(2, Math.min(JOBS, os.availableParallelism ? os.availableParallelism() : os.cpus().length));

function runWorker(job) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'hash-worker.js'), { workerData: { job, rounds: ROUNDS } });
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', code => { if (code !== 0) reject(new Error(`Worker ${job} exited with code ${code}`)); });
  });
}

async function main() {
  console.log(`BiPSU BlueBook parallel computing benchmark`);
  console.log(`Independent CPU jobs: ${JOBS}; workers: ${WORKERS}; PBKDF2 rounds/job: ${ROUNDS}`);
  let start = process.hrtime.bigint();
  for (let job = 0; job < JOBS; job++) pbkdf2Sync(`BiPSU-BlueBook-${job}`, 'bipsu-benchmark-salt', ROUNDS, 32, 'sha256');
  const sequentialMs = Number(process.hrtime.bigint() - start) / 1e6;
  start = process.hrtime.bigint();
  const results = await Promise.all(Array.from({ length: JOBS }, (_, job) => runWorker(job)));
  const parallelMs = Number(process.hrtime.bigint() - start) / 1e6;
  console.log(`Sequential time: ${sequentialMs.toFixed(2)} ms`);
  console.log(`Parallel time:   ${parallelMs.toFixed(2)} ms`);
  console.log(`Measured speedup: ${(sequentialMs / parallelMs).toFixed(2)}x`);
  console.log(`Completed worker results: ${results.length}`);
  console.log('Note: results depend on CPU cores, operating system scheduling, and worker startup overhead.');
}
main().catch(error => { console.error(error); process.exit(1); });
