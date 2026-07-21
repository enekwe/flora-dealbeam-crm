/**
 * Deal Model
 * Minimal DealBeam CRM deal/application record. A pipeline is identified by
 * name (string) rather than a separate Pipeline collection — no Pipeline
 * model exists yet in this service.
 */

const mongoose = require('mongoose');

const dealSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    index: true
  },
  title: {
    type: String,
    required: true
  },
  pipeline: {
    type: String,
    required: true,
    default: 'default'
  },
  stage: {
    type: String,
    required: true,
    default: 'new'
  },
  status: {
    type: String,
    enum: ['open', 'won', 'lost'],
    default: 'open'
  },
  amount: Number,
  contactIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Contact'
  }],
  tags: [String],
  source: {
    type: String,
    default: 'manual'
  },
  customFields: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: {}
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

dealSchema.index({ organizationId: 1, pipeline: 1, stage: 1 });

const Deal = mongoose.model('Deal', dealSchema);

module.exports = Deal;
