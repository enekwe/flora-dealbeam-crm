/**
 * Form Model
 * GP/Admin-authored intake form (Epic 2.5 — DealBeam Intake Forms).
 * A form is a set of fields plus branding, a CRM field-mapping config, and
 * publish settings for hosted/embedded distribution.
 */

const mongoose = require('mongoose');
const crypto = require('crypto');

const FIELD_TYPES = [
  'short_text', 'long_text', 'email', 'phone', 'number',
  'date', 'url', 'dropdown', 'multi_select', 'file_upload', 'section_header'
];

const conditionSchema = new mongoose.Schema({
  fieldId: { type: String, required: true },
  operator: {
    type: String,
    enum: ['equals', 'not_equals', 'contains'],
    default: 'equals'
  },
  value: mongoose.Schema.Types.Mixed
}, { _id: false });

const fieldSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true
  },
  label: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: FIELD_TYPES,
    required: true
  },
  required: {
    type: Boolean,
    default: false
  },
  placeholder: String,
  helpText: String,
  options: [String], // for dropdown / multi_select
  validation: {
    minLength: Number,
    maxLength: Number,
    pattern: String,
    maxFileSizeMb: Number,
    allowedFileTypes: [String]
  },
  page: {
    type: Number,
    default: 1,
    min: 1
  },
  order: {
    type: Number,
    default: 0
  },
  conditional: conditionSchema
}, { _id: false });

const fieldMappingSchema = new mongoose.Schema({
  fieldId: {
    type: String,
    required: true
  },
  entity: {
    type: String,
    enum: ['contact', 'deal', 'custom'],
    required: true
  },
  // Named contact/deal property (e.g. "firstName", "email", "title", "amount").
  // Ignored when entity is "custom" — those land in customFields keyed by fieldId.
  property: String
}, { _id: false });

const brandingSchema = new mongoose.Schema({
  logoUrl: String,
  headerImageUrl: String,
  accentColor: {
    type: String,
    default: '#7C3AED'
  },
  fontFamily: String,
  buttonText: {
    type: String,
    default: 'Submit'
  },
  confirmationMessage: {
    type: String,
    default: 'Thanks — your application has been received.'
  },
  redirectUrl: String
}, { _id: false });

const crmMappingSchema = new mongoose.Schema({
  fields: {
    type: [fieldMappingSchema],
    default: []
  },
  dealPipeline: {
    type: String,
    default: 'default'
  },
  dealStage: {
    type: String,
    default: 'new'
  },
  applyTags: [String]
}, { _id: false });

const publishSettingsSchema = new mongoose.Schema({
  slug: {
    type: String,
    unique: true,
    sparse: true,
    index: true
  },
  embedEnabled: {
    type: Boolean,
    default: true
  },
  submissionCap: Number,
  closesAt: Date
}, { _id: false });

const formSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true
  },
  description: String,
  status: {
    type: String,
    enum: ['draft', 'published', 'closed'],
    default: 'draft',
    index: true
  },
  fields: {
    type: [fieldSchema],
    default: []
  },
  branding: {
    type: brandingSchema,
    default: () => ({})
  },
  crmMapping: {
    type: crmMappingSchema,
    default: () => ({})
  },
  publishSettings: {
    type: publishSettingsSchema,
    default: () => ({})
  },
  analytics: {
    views: { type: Number, default: 0 },
    starts: { type: Number, default: 0 },
    completions: { type: Number, default: 0 }
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

formSchema.index({ organizationId: 1, status: 1 });

formSchema.pre('validate', function assignSlug(next) {
  if (!this.publishSettings) this.publishSettings = {};
  if (!this.publishSettings.slug) {
    const base = (this.name || 'form')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 40) || 'form';
    this.publishSettings.slug = `${base}-${crypto.randomBytes(3).toString('hex')}`;
  }
  next();
});

formSchema.methods.isAcceptingSubmissions = function isAcceptingSubmissions() {
  if (this.status !== 'published') return false;
  if (this.publishSettings?.closesAt && new Date() > this.publishSettings.closesAt) return false;
  if (
    this.publishSettings?.submissionCap &&
    this.analytics.completions >= this.publishSettings.submissionCap
  ) {
    return false;
  }
  return true;
};

formSchema.statics.FIELD_TYPES = FIELD_TYPES;

const Form = mongoose.model('Form', formSchema);

module.exports = Form;
