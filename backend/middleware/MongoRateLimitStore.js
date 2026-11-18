const crypto = require('node:crypto');
const RateLimitEntry = require('../models/RateLimitEntry');

class MongoRateLimitStore {
  constructor() {
    this.windowMs = 60 * 1000;
    this.localKeys = false;
    this.prefix = 'bluebook-auth:';
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  storageKey(key) {
    const digest = crypto.createHash('sha256').update(key).digest('hex');
    return `${this.prefix}${digest}`;
  }

  async get(key) {
    const entry = await RateLimitEntry.findOne({
      _id: this.storageKey(key),
      resetTime: { $gt: new Date() }
    }).lean();

    return entry
      ? { totalHits: entry.totalHits, resetTime: entry.resetTime }
      : undefined;
  }

  async updateCounter(id, upsert) {
    const now = new Date();
    const nextResetTime = new Date(now.getTime() + this.windowMs);
    const activeWindow = { $gt: ['$resetTime', now] };
    const entry = await RateLimitEntry.findOneAndUpdate(
      { _id: id },
      [{
        $set: {
          totalHits: {
            $cond: [
              activeWindow,
              { $add: [{ $ifNull: ['$totalHits', 0] }, 1] },
              1
            ]
          },
          resetTime: { $cond: [activeWindow, '$resetTime', nextResetTime] }
        }
      }],
      { upsert, new: true }
    ).lean();

    return entry;
  }

  async increment(key) {
    const id = this.storageKey(key);
    let entry;

    try {
      entry = await this.updateCounter(id, true);
    } catch (error) {
      if (error.code !== 11000) throw error;
      entry = await this.updateCounter(id, false);
      if (!entry) entry = await this.updateCounter(id, true);
    }

    return { totalHits: entry.totalHits, resetTime: entry.resetTime };
  }

  async decrement(key) {
    await RateLimitEntry.updateOne(
      {
        _id: this.storageKey(key),
        resetTime: { $gt: new Date() },
        totalHits: { $gt: 0 }
      },
      { $inc: { totalHits: -1 } }
    );
  }

  async resetKey(key) {
    await RateLimitEntry.deleteOne({ _id: this.storageKey(key) });
  }

  async resetAll() {
    await RateLimitEntry.deleteMany({ _id: new RegExp(`^${this.prefix}`) });
  }
}

module.exports = MongoRateLimitStore;
