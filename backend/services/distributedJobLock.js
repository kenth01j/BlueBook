const crypto = require('node:crypto');
const ScheduledJobLease = require('../models/ScheduledJobLease');

const DEFAULT_LEASE_MS = 2 * 60 * 1000;
const DEFAULT_HEARTBEAT_MS = 30 * 1000;

async function acquireLease(jobName, owner, leaseMs) {
  const now = new Date();
  const lease = await ScheduledJobLease.findOneAndUpdate(
    {
      _id: jobName,
      $or: [
        { leaseUntil: { $lte: now } },
        { leaseUntil: { $exists: false } }
      ]
    },
    {
      $set: {
        owner,
        leaseUntil: new Date(now.getTime() + leaseMs)
      }
    },
    { new: true }
  ).lean();

  if (lease) return true;

  try {
    await ScheduledJobLease.create({
      _id: jobName,
      owner,
      leaseUntil: new Date(now.getTime() + leaseMs)
    });
    return true;
  } catch (error) {
    if (error.code === 11000) return false;
    throw error;
  }
}

async function runWithDistributedJobLock(jobName, job, options = {}) {
  const leaseMs = options.leaseMs || DEFAULT_LEASE_MS;
  const heartbeatMs = options.heartbeatMs || DEFAULT_HEARTBEAT_MS;
  if (leaseMs <= heartbeatMs) {
    throw new Error('The distributed job lock lease must exceed its heartbeat interval.');
  }

  const owner = crypto.randomUUID();
  const acquired = await acquireLease(jobName, owner, leaseMs);
  if (!acquired) return false;

  let heartbeatTimer;
  let heartbeatRequest;
  let stopped = false;

  async function renewLease() {
    try {
      const result = await ScheduledJobLease.updateOne(
        { _id: jobName, owner },
        { $set: { leaseUntil: new Date(Date.now() + leaseMs) } }
      );
      if (result.matchedCount !== 1) {
        console.error(`Distributed job lock was lost: ${jobName}`);
        return false;
      }
      return true;
    } catch (error) {
      console.error(`Could not renew distributed job lock ${jobName}:`, error.message);
      return true;
    }
  }

  function scheduleRenewal() {
    heartbeatTimer = setTimeout(() => {
      heartbeatTimer = undefined;
      if (stopped) return;

      heartbeatRequest = renewLease();
      heartbeatRequest.then(leaseHeld => {
        heartbeatRequest = undefined;
        if (!stopped && leaseHeld) scheduleRenewal();
      });
    }, heartbeatMs);
    heartbeatTimer.unref();
  }

  scheduleRenewal();

  try {
    await job();
    return true;
  } finally {
    stopped = true;
    clearTimeout(heartbeatTimer);
    if (heartbeatRequest) await heartbeatRequest;
    await ScheduledJobLease.updateOne(
      { _id: jobName, owner },
      { $set: { leaseUntil: new Date(0) } }
    );
  }
}

module.exports = runWithDistributedJobLock;
