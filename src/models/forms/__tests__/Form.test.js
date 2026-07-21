const mongoose = require('mongoose');
const Form = require('../Form');

function baseAttrs(overrides = {}) {
  return {
    organizationId: new mongoose.Types.ObjectId(),
    name: 'Accelerator Application',
    status: 'published',
    ...overrides
  };
}

describe('Form model', () => {
  it('auto-generates a URL-safe publishSettings.slug on validate', async () => {
    const form = new Form(baseAttrs());
    await form.validate();

    expect(form.publishSettings.slug).toMatch(/^accelerator-application-[a-f0-9]{6}$/);
  });

  it('does not overwrite an explicitly set slug', async () => {
    const form = new Form(baseAttrs({ publishSettings: { slug: 'my-custom-slug' } }));
    await form.validate();

    expect(form.publishSettings.slug).toBe('my-custom-slug');
  });

  describe('isAcceptingSubmissions', () => {
    it('is false for a draft form', () => {
      const form = new Form(baseAttrs({ status: 'draft' }));
      expect(form.isAcceptingSubmissions()).toBe(false);
    });

    it('is true for a published form with no cap or deadline', () => {
      const form = new Form(baseAttrs());
      expect(form.isAcceptingSubmissions()).toBe(true);
    });

    it('is false once the close date has passed', () => {
      const form = new Form(baseAttrs({
        publishSettings: { closesAt: new Date(Date.now() - 1000) }
      }));
      expect(form.isAcceptingSubmissions()).toBe(false);
    });

    it('is false once the submission cap is reached', () => {
      const form = new Form(baseAttrs({
        publishSettings: { submissionCap: 2 },
        analytics: { views: 10, starts: 5, completions: 2 }
      }));
      expect(form.isAcceptingSubmissions()).toBe(false);
    });
  });
});
