# Campaign Tracker

A simple, elegant web application for tracking fundraising campaigns. Create campaigns, track accumulated funds, and manage donations with ease.

## Features

- **Create Campaigns** - Set a campaign name, slug, target amount, and secure credentials
- **Public Campaign View** - Share a campaign URL to let anyone see the progress
- **Progress Tracking** - Visual progress bar showing accumulated vs. target funds
- **Admin Panel** - Secure login for campaign organizers to add/edit donations
- **Donation Records** - Track donor names, amounts, and timestamps

## Tech Stack

- **Frontend**: HTML5, CSS3, JavaScript
- **Backend**: Node.js/Express
- **Database**: SQLite
- **Styling**: Tailwind CSS

## Getting Started

### Prerequisites
- Node.js 16+
- npm

### Installation

```bash
npm install
npm run dev
```

The app will be available at `http://localhost:3000`

## Project Structure

```
.
├── public/           # Static files
├── src/
│   ├── app.js       # Express server
│   ├── db.js        # Database setup
│   ├── routes/      # API routes
│   └── utils/       # Helper functions
├── views/           # HTML templates
└── package.json
```

## Usage

1. Go to home page and create a new campaign
2. Share the campaign slug URL with others
3. View the campaign progress page
4. Use admin credentials to log in and manage donations
