const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const session = require('express-session');
const firebase = require('./firebase');
const campaignRoutes = require('./routes/campaigns');
const donationRoutes = require('./routes/donations');
const authRoutes = require('./routes/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
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
  res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Campaign Tracker running at http://localhost:${PORT}`);
});

module.exports = app;
