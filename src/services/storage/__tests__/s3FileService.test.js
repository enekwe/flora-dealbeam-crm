jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: jest.fn().mockResolvedValue({}) })),
  PutObjectCommand: jest.fn(),
  GetObjectCommand: jest.fn()
}));
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://signed.example.com/file')
}));

const { S3FileService, HARD_MAX_FILE_SIZE_BYTES } = require('../s3FileService');

describe('S3FileService.validateFile', () => {
  let service;

  beforeEach(() => {
    process.env.S3_BUCKET_NAME = 'flora_files';
    service = new S3FileService();
  });

  it('rejects an empty buffer', () => {
    const { valid, error } = service.validateFile(Buffer.alloc(0), 'application/pdf');
    expect(valid).toBe(false);
    expect(error).toMatch(/empty/i);
  });

  it('rejects a disallowed mime type', () => {
    const { valid, error } = service.validateFile(Buffer.from('x'), 'application/x-msdownload');
    expect(valid).toBe(false);
    expect(error).toMatch(/unsupported/i);
  });

  it('accepts a default-allowed mime type within size limits', () => {
    const { valid } = service.validateFile(Buffer.from('x'.repeat(1024)), 'application/pdf');
    expect(valid).toBe(true);
  });

  it('honors a field-level allowedFileTypes override', () => {
    const buffer = Buffer.from('x');
    expect(service.validateFile(buffer, 'image/png', { allowedFileTypes: ['application/pdf'] }).valid).toBe(false);
    expect(service.validateFile(buffer, 'application/pdf', { allowedFileTypes: ['application/pdf'] }).valid).toBe(true);
  });

  it('caps a field-level maxFileSizeMb at the hard ceiling', () => {
    const oversizedForHardCap = Buffer.alloc(HARD_MAX_FILE_SIZE_BYTES + 1);
    const { valid, error } = service.validateFile(oversizedForHardCap, 'application/pdf', { maxFileSizeMb: 500 });
    expect(valid).toBe(false);
    expect(error).toMatch(/too large/i);
  });

  it('rejects a file over its field-level maxFileSizeMb even under the hard ceiling', () => {
    const buffer = Buffer.alloc(2 * 1024 * 1024); // 2MB
    const { valid } = service.validateFile(buffer, 'application/pdf', { maxFileSizeMb: 1 });
    expect(valid).toBe(false);
  });
});

describe('S3FileService.uploadBuffer', () => {
  it('generates a key namespaced under the given prefix', async () => {
    const service = new S3FileService();
    const result = await service.uploadBuffer({
      buffer: Buffer.from('x'),
      mimeType: 'application/pdf',
      originalFilename: 'deck.pdf',
      keyPrefix: 'form-submissions/org1/form1'
    });

    expect(result.key).toMatch(/^form-submissions\/org1\/form1\/\d+-[0-9a-f-]{36}\.pdf$/);
    expect(result.filename).toBe('deck.pdf');
  });
});
