// One-off migration: set currency to PKR on all existing campaigns.
const firebase = require('../src/firebase');
const db = firebase.getDatabase();

(async () => {
  const snapshot = await db.ref('campaigns').once('value');
  const campaigns = snapshot.val() || {};
  const slugs = Object.keys(campaigns);

  if (!slugs.length) {
    console.log('No campaigns found.');
    process.exit(0);
  }

  for (const slug of slugs) {
    const before = campaigns[slug].currency || '(unset)';
    await db.ref(`campaigns/${slug}/currency`).set('PKR');
    console.log(`✓ ${slug}: ${before} → PKR`);
  }

  console.log(`Updated ${slugs.length} campaign(s).`);
  process.exit(0);
})().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
