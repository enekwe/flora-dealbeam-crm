/**
 * FormSubmission Model
 * A single applicant's answers to a Form, plus the CRM records it produced.
 */

const mongoose = require('mongoose');

const fileRefSchema = new mongoose.Schema({
  fieldId: { type: String, required: true },
  filename: String,
  url: String,
  size: Number,
  mimeType: String
}, { _id: false });

const formSubmissionSchema = new mongoose.Schema({
  formId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Form',
    required: true,
    index: true
  },
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    index: true
  },
  answers: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: {}
  },
  files: {
    type: [fileRefSchema],
    default: []
  },
  contactId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Contact'
  },
  dealId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Deal'
  },
  status: {
    type: String,
    enum: ['received', 'processed', 'failed'],
    default: 'received',
    index: true
  },
  processingError: String,
  source: {
    ipHash: String,
    userAgent: String,
    referrer: String,
    embedOrigin: String
  }
}, {
  timestamps: true
});

formSubmissionSchema.index({ formId: 1, createdAt: -1 });

const FormSubmission = mongoose.model('FormSubmission', formSubmissionSchema);

module.exports = FormSubmission;
