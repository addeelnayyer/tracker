const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const session = require('express-session');
const firebase = require('./firebase');
const campaignRoutes = require('./routes/campaigns');
const donationRoutes = require('./routes/donations');
const authRoutes = require('./routes/auth');
const documentRoutes = require('./routes/documents');
const bankDetailRoutes = require('./routes/bankDetails');

const app = express();
const PORT = process.env.DEV_PORT || 3000;

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
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

// Home page
app.get('/', (req, res) => {
  res.render('index');
});

// Campaign view page
app.get('/campaign/:slug', (req, res) => {
  res.render('campaign');
});

// Admin page
app.get('/campaign/:slug/admin', (req, res) => {
  res.render('admin');
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
