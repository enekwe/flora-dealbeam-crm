/**
 * Intake Forms — Authenticated GP/Admin API
 * Create, edit, publish, and review submissions for custom intake forms
 * (Epic 2.5 — DealBeam Intake Forms).
 */

const express = require('express');
const router = express.Router();

const Form = require('../../models/forms/Form');
const FormSubmission = require('../../models/forms/FormSubmission');
const { requireAuth, requireRole } = require('../../middleware/auth');
const s3FileService = require('../../services/storage/s3FileService');

router.use(requireAuth, requireRole('gp', 'admin'));

async function loadOwnedForm(req, res) {
  const form = await Form.findOne({ _id: req.params.id, organizationId: req.user.organizationId });
  if (!form) {
    res.status(404).json({ error: 'Form not found' });
    return null;
  }
  return form;
}

router.post('/', async (req, res, next) => {
  try {
    const { name, description, fields, branding, crmMapping } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    const form = new Form({
      organizationId: req.user.organizationId,
      name,
      description,
      fields: fields || [],
      branding,
      crmMapping,
      createdBy: req.user.id
    });

    await form.save();
    res.status(201).json({ form });
  } catch (error) {
    next(error);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const query = { organizationId: req.user.organizationId };
    if (status) query.status = status;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

    const [forms, total] = await Promise.all([
      Form.find(query)
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum),
      Form.countDocuments(query)
    ]);

    res.json({ forms, total, page: pageNum, limit: limitNum });
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const form = await loadOwnedForm(req, res);
    if (!form) return;
    res.json({ form });
  } catch (error) {
    next(error);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const form = await loadOwnedForm(req, res);
    if (!form) return;

    const { name, description, fields, branding, crmMapping, publishSettings } = req.body;

    if (name !== undefined) form.name = name;
    if (description !== undefined) form.description = description;
    if (fields !== undefined) form.fields = fields;
    if (branding !== undefined) form.branding = { ...form.branding.toObject(), ...branding };
    if (crmMapping !== undefined) form.crmMapping = { ...form.crmMapping.toObject(), ...crmMapping };
    if (publishSettings !== undefined) {
      form.publishSettings = { ...form.publishSettings.toObject(), ...publishSettings };
    }

    await form.save();
    res.json({ form });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const form = await loadOwnedForm(req, res);
    if (!form) return;
    await form.deleteOne();
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/publish', async (req, res, next) => {
  try {
    const form = await loadOwnedForm(req, res);
    if (!form) return;

    if (!form.fields.length) {
      return res.status(400).json({ error: 'Cannot publish a form with no fields' });
    }

    const hasEmailMapping = (form.crmMapping?.fields || []).some(
      (m) => m.entity === 'contact' && m.property === 'email'
    );
    if (!hasEmailMapping) {
      return res.status(400).json({
        error: 'A field must be mapped to contact.email before publishing, so submissions can be deduplicated'
      });
    }

    form.status = 'published';
    await form.save();
    res.json({ form });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/close', async (req, res, next) => {
  try {
    const form = await loadOwnedForm(req, res);
    if (!form) return;
    form.status = 'closed';
    await form.save();
    res.json({ form });
  } catch (error) {
    next(error);
  }
});

router.get('/:id/submissions', async (req, res, next) => {
  try {
    const form = await loadOwnedForm(req, res);
    if (!form) return;

    const { page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

    const [submissions, total] = await Promise.all([
      FormSubmission.find({ formId: form._id })
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum),
      FormSubmission.countDocuments({ formId: form._id })
    ]);

    res.json({ submissions, total, page: pageNum, limit: limitNum });
  } catch (error) {
    next(error);
  }
});

router.get('/:id/submissions/:submissionId/files/:fieldId', async (req, res, next) => {
  try {
    const form = await loadOwnedForm(req, res);
    if (!form) return;

    const submission = await FormSubmission.findOne({ _id: req.params.submissionId, formId: form._id });
    if (!submission) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    const fileRef = submission.files.find((f) => f.fieldId === req.params.fieldId);
    if (!fileRef) {
      return res.status(404).json({ error: 'No file uploaded for this field' });
    }

    const url = await s3FileService.getSignedDownloadUrl(fileRef.key);
    res.json({ url, filename: fileRef.filename, expiresIn: s3FileService.presignedUrlExpirySeconds });
  } catch (error) {
    next(error);
  }
});

router.get('/:id/submissions/export', async (req, res, next) => {
  try {
    const form = await loadOwnedForm(req, res);
    if (!form) return;

    const submissions = await FormSubmission.find({ formId: form._id }).sort({ createdAt: -1 });

    const fieldIds = form.fields.filter((f) => f.type !== 'section_header').map((f) => f.id);
    const header = ['submittedAt', 'status', 'contactId', 'dealId', ...fieldIds];

    // Submission answers come from an unauthenticated public form — a cell
    // starting with =, +, -, or @ is interpreted as a formula by Excel/
    // Sheets when this CSV is opened, so neutralize it before quoting.
    const escapeCsv = (value) => {
      let str = value === undefined || value === null ? '' : String(value);
      if (/^[=+\-@]/.test(str)) {
        str = `'${str}`;
      }
      return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };

    const rows = submissions.map((submission) => {
      const answers = submission.answers instanceof Map
        ? submission.answers
        : new Map(Object.entries(submission.answers || {}));

      return [
        submission.createdAt.toISOString(),
        submission.status,
        submission.contactId || '',
        submission.dealId || '',
        ...fieldIds.map((id) => answers.get(id))
      ].map(escapeCsv).join(',');
    });

    const csv = [header.join(','), ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${form.publishSettings.slug}-submissions.csv"`);
    res.send(csv);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
