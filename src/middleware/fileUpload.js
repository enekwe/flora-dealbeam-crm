/**
 * Upload Middleware
 * Buffers a single multipart file in memory for the intake-form file-upload
 * field (Epic 2.5). Buffer size is capped independently of any per-field
 * limit configured on the Form — see s3FileService.HARD_MAX_FILE_SIZE_BYTES.
 */

const multer = require('multer');
const { HARD_MAX_FILE_SIZE_BYTES } = require('../services/storage/s3FileService');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: HARD_MAX_FILE_SIZE_BYTES }
});

function handleUploadError(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File exceeds the maximum upload size' });
    }
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }
  next(err);
}

module.exports = { singleFileUpload: upload.single('file'), handleUploadError };
