/**
 * Intake Forms — Public API
 * Unauthenticated endpoints for hosted/embedded forms (Epic 2.5,
 * MP-2.5-S9/S10). File-upload fields go through POST /:slug/upload first,
 * which stores the file in S3 and returns a {fieldId, key, filename, size,
 * mimeType} reference for the client to include in its /:slug/submit call.
 */

const crypto = require('crypto');
const express = require('express');
const QRCode = require('qrcode');
const router = express.Router();

const Form = require('../../models/forms/Form');
const FormSubmission = require('../../models/forms/FormSubmission');
const { validateAnswers, processSubmission } = require('../../services/forms/formSubmissionService');
const { notifyNewSubmission } = require('../../services/forms/submissionNotifier');
const { publicFormRateLimiter, checkHoneypot } = require('../../middleware/publicFormProtection');
const { singleFileUpload, handleUploadError } = require('../../middleware/fileUpload');
const s3FileService = require('../../services/storage/s3FileService');

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

router.get('/:slug/qr.svg', async (req, res, next) => {
  try {
    const form = await loadPublishedForm(req, res);
    if (!form) return;

    // The QR encodes the hosted form URL — override the derived origin with
    // PUBLIC_FORMS_BASE_URL when the hosted page lives behind a custom domain.
    const base = process.env.PUBLIC_FORMS_BASE_URL || `${req.protocol}://${req.get('host')}`;
    const hostedUrl = `${base.replace(/\/$/, '')}/forms/${encodeURIComponent(form.publishSettings.slug)}`;

    const svg = await QRCode.toString(hostedUrl, { type: 'svg', margin: 1, width: 512 });
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(svg);
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

router.post('/:slug/upload', singleFileUpload, handleUploadError, async (req, res, next) => {
  try {
    const form = await loadPublishedForm(req, res);
    if (!form) return;

    const { fieldId } = req.body;
    const field = form.fields.find((f) => f.id === fieldId && f.type === 'file_upload');

    if (!field) {
      return res.status(400).json({ error: 'Unknown or non-file field: ' + fieldId });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const { valid, error } = s3FileService.validateFile(
      req.file.buffer,
      req.file.mimetype,
      field.validation || {}
    );
    if (!valid) {
      return res.status(400).json({ error });
    }

    const uploaded = await s3FileService.uploadBuffer({
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
      originalFilename: req.file.originalname,
      keyPrefix: `form-submissions/${form.organizationId}/${form._id}`
    });

    res.status(201).json({ fieldId, ...uploaded });
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

    const { answers = {}, files: rawFiles = [] } = req.body;

    // `files` is client-supplied on an unauthenticated endpoint — nothing
    // stops a caller from skipping POST /upload and fabricating a {key: ...}
    // pointing at an S3 object it doesn't own. Only accept refs whose key
    // falls under this form's own upload prefix (see POST /:slug/upload)
    // and whose fieldId names an actual file_upload field, so a crafted
    // submission can't later hand a GP admin a presigned URL to someone
    // else's object via GET /:id/submissions/:submissionId/files/:fieldId.
    const expectedKeyPrefix = `form-submissions/${form.organizationId}/${form._id}/`;
    const fileUploadFieldIds = new Set(
      form.fields.filter((f) => f.type === 'file_upload').map((f) => f.id)
    );
    const files = (Array.isArray(rawFiles) ? rawFiles : []).filter((file) =>
      file && typeof file.key === 'string' &&
      file.key.startsWith(expectedKeyPrefix) &&
      fileUploadFieldIds.has(file.fieldId)
    );

    const { valid, errors } = validateAnswers(form, answers, files);
    if (!valid) {
      return res.status(400).json({ error: 'Validation failed', errors });
    }

    // Surface the uploaded filename under the field's answer too, so CSV
    // export and CRM custom-field mapping show something readable without
    // needing to resolve the S3 key.
    const answersWithFileNames = { ...answers };
    for (const file of files) {
      if (!(file.fieldId in answersWithFileNames)) {
        answersWithFileNames[file.fieldId] = file.filename;
      }
    }

    const submission = new FormSubmission({
      formId: form._id,
      organizationId: form.organizationId,
      answers: answersWithFileNames,
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
      const { contact } = await processSubmission(form, submission);
      form.analytics.completions += 1;
      await form.save();
      notifyNewSubmission({ form, submission, contact }); // fire-and-forget
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
