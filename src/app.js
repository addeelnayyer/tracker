const crypto = require('crypto');
const fs = require('fs');
const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const path = require('path');
const firebase = require('./firebase');
const email = require('./email');
const { siteMeta, campaignMeta } = require('./meta');
const campaignRoutes = require('./routes/campaigns');
const donationRoutes = require('./routes/donations');
const authRoutes = require('./routes/auth');
const documentRoutes = require('./routes/documents');
const bankDetailRoutes = require('./routes/bankDetails');

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
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../public')));

const cssHash = crypto
  .createHash('md5')
  .update(fs.readFileSync(path.join(__dirname, '../public/css/style.css')))
  .digest('hex')
  .slice(0, 8);
app.locals.cssVersion = cssHash;

// View engine
app.set('view engine', 'html');
app.engine('html', require('ejs').renderFile);
app.set('views', path.join(__dirname, '../views'));

// Inject dependencies so routes and tests can override them
app.locals.firebase = firebase;
app.locals.email = email;

// Routes
app.use('/api/campaigns', campaignRoutes);
app.use('/api/donations', donationRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/bank-details', bankDetailRoutes);

// Whole-amount currency formatting for the register cards. Mirrors meta.js's
// formatMoney; kept local to avoid widening that module's API.
const formatMoney = (amount, currency) => {
  const value = Number(amount) || 0;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: (currency || 'USD').toUpperCase(),
      maximumFractionDigits: 0
    }).format(value);
  } catch {
    return `${value.toLocaleString('en-US')} ${currency || ''}`.trim();
  }
};

// Home page — the register: every campaign with its live ledger progress.
// Rendered server-side so the list is crawlable and there's no empty flash.
// A data hiccup must never blank the page: fall back to an empty register.
app.get('/', async (req, res) => {
  let campaigns = [];
  try {
    const raw = await firebase.getAllCampaigns();
    // Test campaigns stay off the public register; they're reachable only by
    // their direct link.
    campaigns = raw.filter((c) => !c.test_campaign).map((c) => {
      const target = Number(c.target_amount) || 0;
      const raised = Number(c.accumulated_amount) || 0;
      const pct = target > 0 ? Math.min(Math.round((raised / target) * 100), 100) : 0;
      return {
        slug: c.slug,
        name: c.name,
        currency: (c.currency || 'USD').toUpperCase(),
        raised: formatMoney(raised, c.currency),
        goal: formatMoney(target, c.currency),
        pct,
        funded: target > 0 && raised >= target,
        created_at: c.created_at
      };
    });
  } catch (error) {
    console.error('Failed to load campaigns for the register:', error);
  }
  res.render('index', { og: siteMeta(req), campaigns });
});

// Start a campaign — the creation form.
app.get('/start', (req, res) => {
  res.render('start', { og: siteMeta(req, { title: 'Start a campaign — Nasr' }) });
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
