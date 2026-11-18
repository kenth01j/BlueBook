const mongoose = require('mongoose');

const scheduledJobLeaseSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  owner: { type: String, required: true },
  leaseUntil: { type: Date, required: true }
}, {
  collection: 'scheduled_job_leases',
  versionKey: false
});

scheduledJobLeaseSchema.index({ leaseUntil: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('ScheduledJobLease', scheduledJobLeaseSchema);
