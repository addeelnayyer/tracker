'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { isAllowedDocMime } = require('../src/routes/documents');

describe('documents upload allowlist', () => {
  test('accepts images, videos and PDFs', () => {
    for (const mime of [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
      'application/pdf',
      'video/mp4', 'video/webm', 'video/quicktime', 'video/ogg',
    ]) {
      assert.equal(isAllowedDocMime(mime), true, `${mime} should be allowed`);
    }
  });

  test('rejects disallowed types', () => {
    for (const mime of ['application/octet-stream', 'text/html', 'application/zip', '']) {
      assert.equal(isAllowedDocMime(mime), false, `${mime} should be rejected`);
    }
  });
});
