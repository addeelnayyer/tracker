# Campaign Tracker

A simple, elegant web application for tracking fundraising campaigns with **Firebase Realtime Database**.

## Features

- **Create Campaigns** - Set a campaign name, slug, target amount, and secure credentials
- **Public Campaign View** - Share a campaign URL to let anyone see the progress
- **Progress Tracking** - Visual progress bar showing accumulated vs. target funds
- **Admin Panel** - Secure login for campaign organizers to add/edit donations
- **Donation Records** - Track donor names, amounts, and timestamps
- **Firebase Integration** - Real-time database with read-only access for public users and write access only for campaign organizers

## Tech Stack

- **Frontend**: HTML5, CSS3, JavaScript
- **Backend**: Node.js/Express
- **Database**: Firebase Realtime Database
- **Authentication**: Bcrypt password hashing
- **Styling**: Custom CSS with gradients

## Getting Started

### Prerequisites
- Node.js 16+
- npm
- Firebase project with a Realtime Database

### Installation

1. Clone the repository
2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory using `.env.example` as a template:
```bash
cp .env.example .env
```

4. Add your Firebase credentials to `.env`:
   - Go to Firebase Console
   - Select your project
   - Go to Project Settings → Service Accounts
   - Click "Generate New Private Key"
   - Copy the JSON content and fill in the `.env` file

5. Start the development server:
```bash
npm run dev
```

The app will be available at `http://localhost:3000`

## Project Structure

```
.
├── public/
│   ├── css/
│   │   └── style.css
│   └── js/
│       └── app.js
├── src/
│   ├── app.js              # Express server
│   ├── firebase.js         # Firebase database utilities
│   ├── routes/
│   │   ├── campaigns.js    # Campaign API routes
│   │   ├── donations.js    # Donation API routes
│   │   └── auth.js         # Authentication routes
├── views/
│   ├── index.html          # Home page (create campaign)
│   ├── campaign.html       # Campaign view + admin panel
│   └── admin.html          # Admin redirect page
├── .env.example            # Environment variables template
├── package.json
└── README.md
```

## API Endpoints

### Campaigns
- `POST /api/campaigns` - Create a new campaign
- `GET /api/campaigns/:slug` - Get campaign details and donations (public read access)

### Donations
- `POST /api/donations/:campaignSlug` - Add a donation (requires organizer credentials)
- `DELETE /api/donations/:campaignSlug/:donationId` - Delete a donation (requires organizer credentials)

### Authentication
- `POST /api/auth/verify` - Verify organizer credentials
- `POST /api/auth/logout` - Logout

## Firebase Database Structure

```
campaigns/
  ├── {slug}
  │   ├── id: string
  │   ├── name: string
  │   ├── slug: string
  │   ├── target_amount: number
  │   ├── accumulated_amount: number
  │   ├── email: string
  │   ├── password_hash: string
  │   ├── created_at: string (ISO timestamp)
  │   └── updated_at: string (ISO timestamp)

donations/
  ├── {campaignId}
  │   ├── {donationId}
  │   │   ├── donor_name: string
  │   │   ├── amount: number
  │   │   ├── timestamp: string (ISO timestamp)
  │   │   └── created_at: string (ISO timestamp)
```

## Firebase Security Rules

Configure the following security rules for your Firebase Realtime Database to ensure:
- **Public read access** for campaigns and donations
- **No direct writes** from client SDK (only via backend API)
- **Sensitive data protection** (password_hash and email hidden)

```json
{
  "rules": {
    "campaigns": {
      ".read": true,
      "$slug": {
        "password_hash": {
          ".read": false
        },
        "email": {
          ".read": false
        }
      }
    },
    "donations": {
      ".read": true,
      ".write": false
    }
  }
}
```

**How it works:**
- All users can read campaigns and donations (`".read": true`)
- Password hashes and emails are never readable (`".read": false`)
- No direct writes to the database via Firebase client SDK (`".write": false`)
- Only the backend server (with admin credentials) can write donations and update campaign amounts

## Usage

1. Go to home page and create a new campaign
2. Share the campaign slug URL with supporters
3. Anyone can view the campaign progress page and see all donations
4. Use admin credentials to log in and add/manage donations
5. All changes are reflected in real-time across all connected clients

## License

MIT
