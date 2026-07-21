/**
 * Contact Model
 * Minimal DealBeam CRM contact record. Deduplicated by (organizationId, email).
 */

const mongoose = require('mongoose');

const contactSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    index: true
  },
  firstName: String,
  lastName: String,
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  phone: String,
  company: String,
  title: String,
  website: String,
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

contactSchema.index({ organizationId: 1, email: 1 }, { unique: true, name: 'org_email_unique' });

const Contact = mongoose.model('Contact', contactSchema);

module.exports = Contact;
