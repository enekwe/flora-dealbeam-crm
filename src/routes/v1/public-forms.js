/**
 * Intake Forms — Public API
 * Unauthenticated endpoints for hosted/embedded forms (Epic 2.5,
 * MP-2.5-S9/S10). File uploads are accepted as pre-uploaded {url, filename,
 * size, mimeType} references — this service has no storage backend wired
 * up yet, so the embed client is expected to upload directly to storage
 * (e.g. a signed S3 URL from another Flora service) and pass the result here.
 */

const crypto = require('crypto');
const express = require('express');
const router = express.Router();

const Form = require('../../models/forms/Form');
const FormSubmission = require('../../models/forms/FormSubmission');
const { validateAnswers, processSubmission } = require('../../services/forms/formSubmissionService');
const { publicFormRateLimiter, checkHoneypot } = require('../../middleware/publicFormProtection');

router.use(publicFormRateLimiter);

function hashIp(ip) {
  if (!ip) return undefined;
  return crypto.createHash('sha256').update(ip).digest('hex');
}

// Safe subset of a form's config for public rendering — no organizationId,
// no crmMapping (that would leak the studio's CRM field structure).
function toPublicForm(form) {
  return {
    id: form._id,
    name: form.name,
    description: form.description,
    fields: form.fields,
    branding: form.branding,
    embedEnabled: form.publishSettings.embedEnabled
  };
}

async function loadPublishedForm(req, res) {
  const form = await Form.findOne({ 'publishSettings.slug': req.params.slug });
  if (!form || !form.isAcceptingSubmissions()) {
    res.status(404).json({ error: 'Form not found or not accepting submissions' });
    return null;
  }
  return form;
}

router.get('/:slug', async (req, res, next) => {
  try {
    const form = await loadPublishedForm(req, res);
    if (!form) return;

    form.analytics.views += 1;
    await form.save();

    res.json({ form: toPublicForm(form) });
  } catch (error) {
    next(error);
  }
});

router.post('/:slug/start', async (req, res, next) => {
  try {
    const form = await loadPublishedForm(req, res);
    if (!form) return;

    form.analytics.starts += 1;
    await form.save();

    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.post('/:slug/submit', checkHoneypot, async (req, res, next) => {
  try {
    const form = await loadPublishedForm(req, res);
    if (!form) return;

    const successResponse = {
      success: true,
      message: form.branding.confirmationMessage,
      redirectUrl: form.branding.redirectUrl || null
    };

    // Silently no-op likely-bot submissions instead of rejecting, so bots
    // don't learn to retry without the honeypot field.
    if (req.isSpam) {
      return res.status(201).json(successResponse);
    }

    const { answers = {}, files = [] } = req.body;

    const { valid, errors } = validateAnswers(form, answers);
    if (!valid) {
      return res.status(400).json({ error: 'Validation failed', errors });
    }

    const submission = new FormSubmission({
      formId: form._id,
      organizationId: form.organizationId,
      answers,
      files,
      source: {
        ipHash: hashIp(req.ip),
        userAgent: req.headers['user-agent'],
        referrer: req.headers.referer || req.headers.referrer,
        embedOrigin: req.headers.origin
      }
    });
    await submission.save();

    try {
      await processSubmission(form, submission);
      form.analytics.completions += 1;
      await form.save();
    } catch (processingError) {
      submission.status = 'failed';
      submission.processingError = processingError.message;
      await submission.save();
    }

    res.status(201).json(successResponse);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
