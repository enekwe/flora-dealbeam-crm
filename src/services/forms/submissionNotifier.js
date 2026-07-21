/**
 * Submission Notifier
 * First slice of MP-2.5-S8 (GP notifications on new submissions). Fires a
 * webhook when a submission is processed, so notification delivery (email
 * digest via flora-email-service, in-app, Slack) can be wired downstream
 * without this service knowing about those channels. No-op unless
 * SUBMISSION_WEBHOOK_URL is configured.
 */

const axios = require('axios');

async function notifyNewSubmission({ form, submission, contact }) {
  const url = process.env.SUBMISSION_WEBHOOK_URL;
  if (!url) return;

  try {
    await axios.post(url, {
      event: 'form.submission.processed',
      formId: String(form._id),
      formName: form.name,
      organizationId: String(form.organizationId),
      submissionId: String(submission._id),
      contactEmail: contact?.email || null,
      submittedAt: submission.createdAt
    }, { timeout: 5000 });
  } catch (error) {
    // Notification failure must never fail the submission itself.
    const logger = require('winston');
    logger.warn(`Submission notification webhook failed: ${error.message}`);
  }
}

module.exports = { notifyNewSubmission };
