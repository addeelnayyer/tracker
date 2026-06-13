'use strict';

// Multipart upload handling that works on both standalone Node and Cloud Functions.
//
// On Firebase Functions (Gen 2 / Cloud Run) the firebase-functions layer reads
// the whole request body into `req.rawBody` and drains the request stream before
// our Express app runs. multer reads the request as a live stream via busboy, so
// on that platform it sees an empty stream and throws "Unexpected end of form".
// (This mirrors the JSON body-parser guard in src/app.js.)
//
// `createMultipart` exposes the slice of multer's API the routes use — `.single`
// and `.array`. When `req.rawBody` is present we parse it from the buffer with
// busboy; otherwise (local `node`, tests) we delegate to a real multer instance
// so behaviour and the existing test path are unchanged.

const multer = require('multer');
const busboy = require('busboy');

// Parse req.rawBody into req.body (fields) and a list of file objects shaped like
// multer's (fieldname, originalname, encoding, mimetype, buffer, size).
function parseRawBody(req, { limits, fileFilter }, done) {
  let bb;
  try {
    bb = busboy({ headers: req.headers, limits });
  } catch (err) {
    return done(err);
  }

  const fields = {};
  const files = [];
  let pending = 0;
  let finished = false;
  let aborted = false;

  const fail = (err) => {
    if (aborted) return;
    aborted = true;
    done(err);
  };

  const maybeDone = () => {
    if (finished && pending === 0 && !aborted) done(null, { fields, files });
  };

  bb.on('field', (name, value) => {
    fields[name] = value;
  });

  bb.on('file', (fieldname, stream, info) => {
    const file = {
      fieldname,
      originalname: info.filename,
      encoding: info.encoding,
      mimetype: info.mimeType,
    };

    const accept = (ok) => {
      if (!ok) {
        stream.resume(); // drain rejected file
        return;
      }
      pending += 1;
      const chunks = [];
      let truncated = false;
      stream.on('data', (c) => chunks.push(c));
      stream.on('limit', () => {
        truncated = true;
        const err = new Error('File too large');
        err.code = 'LIMIT_FILE_SIZE';
        err.field = fieldname;
        fail(err);
      });
      stream.on('close', () => {
        if (truncated || aborted) return;
        file.buffer = Buffer.concat(chunks);
        file.size = file.buffer.length;
        files.push(file);
        pending -= 1;
        maybeDone();
      });
    };

    if (typeof fileFilter === 'function') {
      let settled = false;
      try {
        fileFilter(req, file, (err, ok) => {
          if (settled) return;
          settled = true;
          if (err) {
            stream.resume();
            return fail(err);
          }
          accept(ok !== false);
        });
      } catch (err) {
        stream.resume();
        fail(err);
      }
    } else {
      accept(true);
    }
  });

  bb.on('error', fail);
  bb.on('close', () => {
    finished = true;
    maybeDone();
  });

  bb.end(req.rawBody);
}

function createMultipart(options = {}) {
  const multerInstance = multer({ storage: multer.memoryStorage(), ...options });

  const make = (assign, multerMiddleware) => (req, res, next) => {
    // No rawBody: the request stream is intact, let multer handle it as usual.
    if (!req.rawBody) return multerMiddleware(req, res, next);

    parseRawBody(req, options, (err, result) => {
      if (err) return next(err);
      req.body = result.fields;
      assign(req, result.files);
      next();
    });
  };

  return {
    single(field) {
      return make(
        (req, files) => { req.file = files.find((f) => f.fieldname === field); },
        multerInstance.single(field)
      );
    },
    array(field, maxCount) {
      return make(
        (req, files) => {
          let matched = files.filter((f) => f.fieldname === field);
          if (typeof maxCount === 'number') matched = matched.slice(0, maxCount);
          req.files = matched;
        },
        multerInstance.array(field, maxCount)
      );
    },
  };
}

module.exports = { createMultipart };
