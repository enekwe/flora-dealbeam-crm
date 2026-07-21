/**
 * S3 File Service
 * Backs the intake-form file-upload field type (Epic 2.5). Follows the
 * conventions used by passbook-flora/services/s3DocumentService.js: SDK v3,
 * AES256 server-side encryption, private objects with short-lived presigned
 * GET URLs rather than permanent public links.
 *
 * Env vars are read with both naming conventions found across Flora
 * services (config/index.js's AWS_* vs s3DocumentService.js's S3_*) since
 * it's not guaranteed which one was set on this service in Railway.
 */

const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('crypto');
const path = require('path');

const DEFAULT_ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
  'application/vnd.ms-powerpoint', // .ppt
  'image/png',
  'image/jpeg'
];

// Hard ceiling regardless of a form field's configured maxFileSizeMb — a
// public, unauthenticated endpoint shouldn't trust an arbitrarily large
// client-supplied limit when buffering uploads in memory.
const HARD_MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

class S3FileService {
  constructor() {
    this.bucketName = process.env.S3_BUCKET_NAME || process.env.AWS_S3_BUCKET || 'flora_files';
    this.presignedUrlExpirySeconds = 3600;

    this.s3Client = new S3Client({
      region: process.env.AWS_REGION || process.env.S3_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY
      }
    });
  }

  isConfigured() {
    return Boolean(this.bucketName);
  }

  /**
   * @param {Buffer} buffer
   * @param {string} mimeType
   * @param {{ maxFileSizeMb?: number, allowedFileTypes?: string[] }} fieldValidation
   *   Per-field overrides from the Form's field config; falls back to the
   *   service defaults above.
   */
  validateFile(buffer, mimeType, fieldValidation = {}) {
    if (!buffer || buffer.length === 0) {
      return { valid: false, error: 'Empty file not allowed' };
    }

    const allowedTypes = fieldValidation.allowedFileTypes?.length
      ? fieldValidation.allowedFileTypes
      : DEFAULT_ALLOWED_MIME_TYPES;

    if (!allowedTypes.includes(mimeType)) {
      return { valid: false, error: `Unsupported file type: ${mimeType}` };
    }

    const configuredMaxBytes = fieldValidation.maxFileSizeMb
      ? fieldValidation.maxFileSizeMb * 1024 * 1024
      : HARD_MAX_FILE_SIZE_BYTES;
    const maxBytes = Math.min(configuredMaxBytes, HARD_MAX_FILE_SIZE_BYTES);

    if (buffer.length > maxBytes) {
      return {
        valid: false,
        error: `File too large: ${(buffer.length / (1024 * 1024)).toFixed(2)}MB. Maximum: ${(maxBytes / (1024 * 1024)).toFixed(0)}MB`
      };
    }

    return { valid: true };
  }

  async uploadBuffer({ buffer, mimeType, originalFilename, keyPrefix }) {
    if (!this.isConfigured()) {
      throw new Error('S3 storage is not configured (missing S3_BUCKET_NAME)');
    }

    const ext = path.extname(originalFilename || '').slice(0, 10);
    const key = `${keyPrefix}/${Date.now()}-${crypto.randomUUID()}${ext}`;

    await this.s3Client.send(new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
      ServerSideEncryption: 'AES256'
    }));

    return { key, size: buffer.length, mimeType, filename: originalFilename };
  }

  async getSignedDownloadUrl(key) {
    const command = new GetObjectCommand({ Bucket: this.bucketName, Key: key });
    return getSignedUrl(this.s3Client, command, { expiresIn: this.presignedUrlExpirySeconds });
  }
}

module.exports = new S3FileService();
module.exports.S3FileService = S3FileService;
module.exports.DEFAULT_ALLOWED_MIME_TYPES = DEFAULT_ALLOWED_MIME_TYPES;
module.exports.HARD_MAX_FILE_SIZE_BYTES = HARD_MAX_FILE_SIZE_BYTES;
