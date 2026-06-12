const { onRequest } = require('firebase-functions/v2/https');
const app = require('../src/app');

// Secrets are fetched from Secret Manager and injected into process.env at runtime.
// Non-sensitive vars (PROJECT_ID, DATABASE_URL, etc.) come from .env via the deploy bundle.
const SECRETS = [
  'SA_PRIVATE_KEY',
  'SA_PRIVATE_KEY_ID',
  'SA_CLIENT_EMAIL',
  'SA_CLIENT_ID',
  'SESSION_SECRET',
];

exports.api = onRequest({ region: 'us-central1', secrets: SECRETS, invoker: 'public' }, app);
