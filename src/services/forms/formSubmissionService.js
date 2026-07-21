/**
 * Form Submission Service
 * Validates answers against a Form's field config, then maps them into
 * DealBeam CRM records per the form's crmMapping (Epic 2.5, MP-2.5-S6/S7):
 * a Contact is upserted by email, a Deal/application is created in the
 * mapped pipeline stage, and unmapped fields land in the deal's
 * customFields so nothing entered on the form is dropped silently.
 */

const Contact = require('../../models/crm/Contact');
const Deal = require('../../models/crm/Deal');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/.+/i;

function isFieldVisible(field, answers) {
  if (!field.conditional) return true;
  const { fieldId, operator, value } = field.conditional;
  const actual = answers[fieldId];

  switch (operator) {
    case 'not_equals':
      return actual !== value;
    case 'contains':
      return Array.isArray(actual) ? actual.includes(value) : String(actual ?? '').includes(value);
    case 'equals':
    default:
      return actual === value;
  }
}

function isEmpty(value) {
  return value === undefined || value === null || value === '' ||
    (Array.isArray(value) && value.length === 0);
}

function validateAnswers(form, answers = {}) {
  const errors = [];

  for (const field of form.fields) {
    if (field.type === 'section_header') continue;
    if (!isFieldVisible(field, answers)) continue;

    const value = answers[field.id];

    if (field.required && isEmpty(value)) {
      errors.push({ fieldId: field.id, message: `${field.label} is required` });
      continue;
    }

    if (isEmpty(value)) continue;

    if (field.type === 'email' && !EMAIL_RE.test(String(value))) {
      errors.push({ fieldId: field.id, message: `${field.label} must be a valid email` });
    }

    if (field.type === 'url' && !URL_RE.test(String(value))) {
      errors.push({ fieldId: field.id, message: `${field.label} must be a valid URL` });
    }

    if (field.type === 'number' && !Number.isFinite(Number(value))) {
      errors.push({ fieldId: field.id, message: `${field.label} must be a number` });
    }

    const minLength = field.validation?.minLength;
    const maxLength = field.validation?.maxLength;
    if (typeof value === 'string') {
      if (minLength && value.length < minLength) {
        errors.push({ fieldId: field.id, message: `${field.label} is too short` });
      }
      if (maxLength && value.length > maxLength) {
        errors.push({ fieldId: field.id, message: `${field.label} is too long` });
      }
    }

    if ((field.type === 'dropdown') && field.options?.length && !field.options.includes(value)) {
      errors.push({ fieldId: field.id, message: `${field.label} has an invalid selection` });
    }
  }

  return { valid: errors.length === 0, errors };
}

function buildEntityData(form, answers) {
  const mappingByFieldId = new Map(
    (form.crmMapping?.fields || []).map((m) => [m.fieldId, m])
  );

  const contactData = {};
  const dealCustomFields = {};
  const dealOverrides = {};

  for (const field of form.fields) {
    if (field.type === 'section_header') continue;
    const value = answers[field.id];
    if (isEmpty(value)) continue;

    const mapping = mappingByFieldId.get(field.id);

    if (!mapping || mapping.entity === 'custom') {
      dealCustomFields[field.id] = value;
      continue;
    }

    if (mapping.entity === 'contact' && mapping.property) {
      contactData[mapping.property] = value;
    } else if (mapping.entity === 'deal' && mapping.property) {
      dealOverrides[mapping.property] = value;
    }
  }

  return { contactData, dealOverrides, dealCustomFields };
}

async function upsertContact(organizationId, contactData, formName) {
  if (!contactData.email) return null;

  const email = String(contactData.email).toLowerCase().trim();

  const contact = await Contact.findOneAndUpdate(
    { organizationId, email },
    {
      $set: {
        ...contactData,
        email,
        organizationId,
        source: `form:${formName}`
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return contact;
}

async function createDeal(form, contact, dealOverrides, dealCustomFields) {
  const title = dealOverrides.title ||
    `${form.name} — ${contact?.email || contact?.firstName || 'New Application'}`;

  const deal = new Deal({
    organizationId: form.organizationId,
    pipeline: form.crmMapping?.dealPipeline || 'default',
    stage: form.crmMapping?.dealStage || 'new',
    ...dealOverrides,
    title,
    tags: form.crmMapping?.applyTags || [],
    source: `form:${form._id}`,
    contactIds: contact ? [contact._id] : [],
    customFields: dealCustomFields
  });

  await deal.save();
  return deal;
}

/**
 * Processes a validated submission into CRM records. Does not itself decide
 * whether the submission passed validation or spam checks — callers run
 * validateAnswers() and the honeypot/rate-limit middleware first.
 */
async function processSubmission(form, submission) {
  const answers = Object.fromEntries(submission.answers instanceof Map
    ? submission.answers
    : Object.entries(submission.answers || {}));

  const { contactData, dealOverrides, dealCustomFields } = buildEntityData(form, answers);

  const contact = await upsertContact(form.organizationId, contactData, form.name);
  const deal = await createDeal(form, contact, dealOverrides, dealCustomFields);

  submission.contactId = contact?._id;
  submission.dealId = deal._id;
  submission.status = 'processed';
  await submission.save();

  return { contact, deal, submission };
}

module.exports = { validateAnswers, processSubmission, isFieldVisible };
