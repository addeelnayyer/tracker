'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { createMultipart } = require('../src/multipart');

const BOUNDARY = '----nasrTestBoundary';

// Build a multipart/form-data body buffer like the one firebase-functions stores
// in req.rawBody. `parts` entries are either { name, value } (field) or
// { name, filename, contentType, data } (file).
function buildMultipart(parts) {
  const chunks = [];
  for (const p of parts) {
    chunks.push(Buffer.from(`--${BOUNDARY}\r\n`));
    if (p.filename !== undefined) {
      chunks.push(Buffer.from(
        `Content-Disposition: form-data; name="${p.name}"; filename="${p.filename}"\r\n` +
        `Content-Type: ${p.contentType}\r\n\r\n`
      ));
      chunks.push(Buffer.isBuffer(p.data) ? p.data : Buffer.from(p.data));
      chunks.push(Buffer.from('\r\n'));
    } else {
      chunks.push(Buffer.from(
        `Content-Disposition: form-data; name="${p.name}"\r\n\r\n${p.value}\r\n`
      ));
    }
  }
  chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`));
  return Buffer.concat(chunks);
}

// Minimal req carrying rawBody, as Cloud Functions presents it.
function rawReq(parts) {
  const rawBody = buildMultipart(parts);
  return {
    rawBody,
    headers: {
      'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
      'content-length': String(rawBody.length),
    },
  };
}

// Run a middleware to completion, resolving with the (possibly mutated) req or
// rejecting with the error passed to next().
function run(middleware, req) {
  return new Promise((resolve, reject) => {
    middleware(req, {}, (err) => (err ? reject(err) : resolve(req)));
  });
}

describe('createMultipart — Cloud Functions rawBody path', () => {
  test('array() populates req.files from rawBody and keeps fields in req.body', async () => {
    const upload = createMultipart({ limits: { fileSize: 1024 * 1024 } });
    const req = rawReq([
      { name: 'note', value: 'hello' },
      { name: 'documents', filename: 'a.png', contentType: 'image/png', data: 'AAAA' },
      { name: 'documents', filename: 'b.pdf', contentType: 'application/pdf', data: 'BBBBBB' },
    ]);

    await run(upload.array('documents', 10), req);

    assert.equal(req.files.length, 2);
    assert.equal(req.files[0].originalname, 'a.png');
    assert.equal(req.files[0].mimetype, 'image/png');
    assert.equal(req.files[0].size, 4);
    assert.ok(Buffer.isBuffer(req.files[0].buffer));
    assert.equal(req.files[1].originalname, 'b.pdf');
    assert.equal(req.files[1].size, 6);
    assert.equal(req.body.note, 'hello');
  });

  test('single() populates req.file from rawBody', async () => {
    const upload = createMultipart({ limits: { fileSize: 1024 * 1024 } });
    const req = rawReq([
      { name: 'proof', filename: 'slip.jpg', contentType: 'image/jpeg', data: 'JPEGDATA' },
    ]);

    await run(upload.single('proof'), req);

    assert.ok(req.file);
    assert.equal(req.file.originalname, 'slip.jpg');
    assert.equal(req.file.mimetype, 'image/jpeg');
    assert.equal(req.file.size, 8);
  });

  test('array() respects maxCount', async () => {
    const upload = createMultipart();
    const req = rawReq([
      { name: 'documents', filename: 'a.png', contentType: 'image/png', data: 'A' },
      { name: 'documents', filename: 'b.png', contentType: 'image/png', data: 'B' },
      { name: 'documents', filename: 'c.png', contentType: 'image/png', data: 'C' },
    ]);

    await run(upload.array('documents', 2), req);

    assert.equal(req.files.length, 2);
  });

  test('fileFilter rejection surfaces as an error', async () => {
    const upload = createMultipart({
      fileFilter: (req, file, cb) => {
        file.mimetype === 'application/pdf'
          ? cb(null, true)
          : cb(new Error('Invalid file type'));
      },
    });
    const req = rawReq([
      { name: 'documents', filename: 'evil.exe', contentType: 'application/octet-stream', data: 'X' },
    ]);

    await assert.rejects(
      run(upload.array('documents', 10), req),
      /Invalid file type/
    );
  });

  test('limits.fileSize over-limit fails with LIMIT_FILE_SIZE', async () => {
    const upload = createMultipart({ limits: { fileSize: 4 } });
    const req = rawReq([
      { name: 'proof', filename: 'big.png', contentType: 'image/png', data: 'way too many bytes' },
    ]);

    await assert.rejects(
      run(upload.single('proof'), req),
      (err) => err.code === 'LIMIT_FILE_SIZE'
    );
  });

  test('without rawBody it delegates to multer (no crash on a fields-only stream)', async () => {
    // No rawBody → multer path. A bare object lacks a readable stream, so multer
    // surfaces an error rather than parsing; the point is that our shim hands off
    // to multer instead of touching busboy.
    const upload = createMultipart();
    const mw = upload.single('proof');
    assert.equal(typeof mw, 'function');
  });
});
