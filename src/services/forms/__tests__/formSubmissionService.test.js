const mongoose = require('mongoose');

jest.mock('../../../models/crm/Contact');
jest.mock('../../../models/crm/Deal');

const Contact = require('../../../models/crm/Contact');
const Deal = require('../../../models/crm/Deal');
const { validateAnswers, isFieldVisible, processSubmission } = require('../formSubmissionService');

function buildForm(overrides = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    organizationId: new mongoose.Types.ObjectId(),
    name: 'BGV Raisify Application',
    fields: [
      { id: 'first_name', label: 'First name', type: 'short_text', required: true },
      { id: 'email', label: 'Email', type: 'email', required: true },
      { id: 'pitch_url', label: 'Pitch deck URL', type: 'url', required: false },
      { id: 'referral', label: 'Referral source', type: 'short_text', required: true,
        conditional: { fieldId: 'has_referral', operator: 'equals', value: 'yes' } },
      { id: 'has_referral', label: 'Were you referred?', type: 'dropdown', options: ['yes', 'no'] }
    ],
    crmMapping: {
      fields: [
        { fieldId: 'first_name', entity: 'contact', property: 'firstName' },
        { fieldId: 'email', entity: 'contact', property: 'email' },
        { fieldId: 'pitch_url', entity: 'deal', property: 'title' }
      ],
      dealPipeline: 'raisify',
      dealStage: 'new',
      applyTags: ['raisify-pilot']
    },
    ...overrides
  };
}

describe('validateAnswers', () => {
  it('flags missing required fields', () => {
    const form = buildForm();
    const { valid, errors } = validateAnswers(form, {});
    expect(valid).toBe(false);
    expect(errors.map((e) => e.fieldId)).toEqual(expect.arrayContaining(['first_name', 'email']));
  });

  it('rejects malformed email and url values', () => {
    const form = buildForm();
    const { valid, errors } = validateAnswers(form, {
      first_name: 'Ada',
      email: 'not-an-email',
      pitch_url: 'not-a-url'
    });
    expect(valid).toBe(false);
    expect(errors.map((e) => e.fieldId)).toEqual(expect.arrayContaining(['email', 'pitch_url']));
  });

  it('passes with valid required fields and skips hidden conditional fields', () => {
    const form = buildForm();
    const { valid, errors } = validateAnswers(form, {
      first_name: 'Ada',
      email: 'ada@example.com',
      has_referral: 'no'
      // "referral" is required only when has_referral === 'yes', so it's fine to omit here
    });
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  it('requires the conditional field once its trigger condition is met', () => {
    const form = buildForm();
    const { valid, errors } = validateAnswers(form, {
      first_name: 'Ada',
      email: 'ada@example.com',
      has_referral: 'yes'
    });
    expect(valid).toBe(false);
    expect(errors.map((e) => e.fieldId)).toContain('referral');
  });
});

describe('isFieldVisible', () => {
  it('evaluates equals/not_equals/contains operators', () => {
    const equalsField = { conditional: { fieldId: 'x', operator: 'equals', value: 'a' } };
    const notEqualsField = { conditional: { fieldId: 'x', operator: 'not_equals', value: 'a' } };
    const containsField = { conditional: { fieldId: 'x', operator: 'contains', value: 'a' } };

    expect(isFieldVisible(equalsField, { x: 'a' })).toBe(true);
    expect(isFieldVisible(equalsField, { x: 'b' })).toBe(false);
    expect(isFieldVisible(notEqualsField, { x: 'b' })).toBe(true);
    expect(isFieldVisible(containsField, { x: ['a', 'b'] })).toBe(true);
    expect(isFieldVisible(containsField, { x: 'banana' })).toBe(true);
  });
});

describe('processSubmission', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('upserts a contact by email and creates a deal with unmapped answers as customFields', async () => {
    const form = buildForm();
    const fakeContact = { _id: new mongoose.Types.ObjectId(), email: 'ada@example.com' };
    Contact.findOneAndUpdate.mockResolvedValue(fakeContact);

    const savedDeal = { _id: new mongoose.Types.ObjectId() };
    Deal.mockImplementation(function FakeDeal(data) {
      Object.assign(this, data);
      this.save = jest.fn().mockResolvedValue(undefined);
      Object.assign(this, savedDeal);
    });

    const submission = {
      answers: new Map(Object.entries({
        first_name: 'Ada',
        email: 'ada@example.com',
        pitch_url: 'https://example.com/deck.pdf',
        has_referral: 'no'
      })),
      save: jest.fn().mockResolvedValue(undefined)
    };

    const result = await processSubmission(form, submission);

    expect(Contact.findOneAndUpdate).toHaveBeenCalledWith(
      { organizationId: form.organizationId, email: 'ada@example.com' },
      expect.objectContaining({ $set: expect.objectContaining({ firstName: 'Ada', email: 'ada@example.com' }) }),
      expect.objectContaining({ upsert: true })
    );

    expect(Deal).toHaveBeenCalledWith(expect.objectContaining({
      pipeline: 'raisify',
      stage: 'new',
      title: 'https://example.com/deck.pdf',
      tags: ['raisify-pilot'],
      contactIds: [fakeContact._id],
      customFields: { has_referral: 'no' }
    }));

    expect(submission.contactId).toBe(fakeContact._id);
    expect(submission.status).toBe('processed');
    expect(submission.save).toHaveBeenCalled();
    expect(result.contact).toBe(fakeContact);
  });

  it('skips contact creation when no field is mapped to contact.email', async () => {
    const form = buildForm({
      crmMapping: { fields: [], dealPipeline: 'default', dealStage: 'new', applyTags: [] }
    });

    const savedDeal = { _id: new mongoose.Types.ObjectId() };
    Deal.mockImplementation(function FakeDeal(data) {
      Object.assign(this, data);
      this.save = jest.fn().mockResolvedValue(undefined);
      Object.assign(this, savedDeal);
    });

    const submission = {
      answers: new Map(Object.entries({ first_name: 'Ada' })),
      save: jest.fn().mockResolvedValue(undefined)
    };

    await processSubmission(form, submission);

    expect(Contact.findOneAndUpdate).not.toHaveBeenCalled();
    expect(submission.contactId).toBeUndefined();
  });
});
