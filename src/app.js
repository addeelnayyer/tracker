const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const session = require('express-session');
const firebase = require('./firebase');
const { siteMeta, campaignMeta } = require('./meta');
const campaignRoutes = require('./routes/campaigns');
const donationRoutes = require('./routes/donations');
const authRoutes = require('./routes/auth');
const documentRoutes = require('./routes/documents');
const bankDetailRoutes = require('./routes/bankDetails');
const paymentRoutes = require('./routes/payments');

const app = express();
const PORT = process.env.DEV_PORT || 3000;

// Behind Cloud Functions / hosting, TLS is terminated upstream; trust the proxy
// headers so req.protocol/host reflect the public URL used in og:url & og:image.
app.set('trust proxy', true);

// Middleware
// On Cloud Functions (K_SERVICE set) firebase-functions has already parsed the
// body, consuming the stream; re-parsing here throws "stream is not readable".
// Only parse when running standalone (local `node`), where the stream is fresh.
if (!process.env.K_SERVICE) {
  app.use(bodyParser.json({ limit: '50mb' }));
  app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
}
app.use(express.static(path.join(__dirname, '../public')));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-in-production',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false, httpOnly: true, maxAge: 24 * 60 * 60 * 1000 }
}));

// View engine
app.set('view engine', 'html');
app.engine('html', require('ejs').renderFile);
app.set('views', path.join(__dirname, '../views'));

// Routes
app.use('/api/campaigns', campaignRoutes);
app.use('/api/donations', donationRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/bank-details', bankDetailRoutes);
app.use('/api/payments', paymentRoutes);

// Home page
app.get('/', (req, res) => {
  res.render('index', { og: siteMeta(req) });
});

// Campaign view page — fetch the campaign so crawlers get a real preview
// (name, progress, thumbnail). Rendering must never fail on a data hiccup:
// the client re-fetches everything and handles a missing campaign itself.
app.get('/campaign/:slug', async (req, res) => {
  let og;
  try {
    const campaign = await firebase.getCampaign(req.params.slug);
    if (campaign) {
      const documents = await firebase.getDocuments(campaign.id);
      og = campaignMeta(req, campaign, documents);
    } else {
      og = siteMeta(req, { title: `Campaign not found — Nasr`, noindex: true });
    }
  } catch (error) {
    console.error('Failed to build campaign preview metadata:', error);
    og = siteMeta(req);
  }
  res.render('campaign', { og });
});

// Admin page — private, keep it out of search engines and link previews.
app.get('/campaign/:slug/admin', (req, res) => {
  res.render('admin', { og: siteMeta(req, { title: 'Campaign Admin — Nasr', noindex: true }) });
});

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message || 'Something went wrong!' });
});

// Start server (only when run directly, not when imported by Cloud Functions)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Campaign Tracker running at http://localhost:${PORT}`);
  });
}

module.exports = app;
