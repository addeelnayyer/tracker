# Campaign Tracker 🎯

A simple, elegant web application for tracking fundraising campaigns with **Firebase Realtime Database**.

## Features ✨

- **Create Campaigns** - Set a campaign name, slug, target amount, and secure credentials
- **Public Campaign View** - Share a campaign URL to let anyone see the progress
- **Progress Tracking** - Visual progress bar showing accumulated vs. target funds
- **Admin Panel** - Secure login for campaign organizers to add/edit donations
- **Donation Records** - Track donor names, amounts, and timestamps
- **Real-Time Updates** - All changes reflected instantly across all connected clients
- **Firebase Integration** - Real-time database with read-only access for public users and write access only for campaign organizers
- **Secure Authentication** - Bcrypt-hashed passwords for campaign organizers

## Tech Stack 🛠️

- **Frontend**: HTML5, CSS3, JavaScript (Vanilla)
- **Backend**: Node.js with Express.js
- **Database**: Firebase Realtime Database
- **Authentication**: Bcrypt password hashing with session management
- **Styling**: Custom CSS with gradient backgrounds and responsive design
- **Environment Management**: dotenv

## Getting Started 🚀

### Prerequisites
- Node.js 16 or higher
- npm (Node Package Manager)
- Firebase project with Realtime Database enabled
- Internet connection for Firebase connectivity

### Installation Steps

1. **Clone the repository**
```bash
git clone https://github.com/addeelnayyer/tracker.git
cd tracker
```

2. **Install dependencies**
```bash
npm install
```

3. **Set up environment variables**
```bash
cp .env.example .env
```

4. **Configure Firebase credentials**
   - Go to [Firebase Console](https://console.firebase.google.com)
   - Select your project
   - Navigate to **Project Settings** → **Service Accounts**
   - Click **Generate New Private Key**
   - Copy the JSON content
   - Fill in your `.env` file with the credentials:
     - `FIREBASE_PROJECT_ID`
     - `FIREBASE_PRIVATE_KEY_ID`
     - `FIREBASE_PRIVATE_KEY`
     - `FIREBASE_CLIENT_EMAIL`
     - `FIREBASE_CLIENT_ID`
     - `FIREBASE_DATABASE_URL`

5. **Start the development server**
```bash
npm run dev
```

The application will be available at `http://localhost:3000`

## Project Structure 📁

```
.
├── public/                      # Static files served to clients
│   ├── css/
│   │   └── style.css           # Main stylesheet with responsive design
│   └── js/
│       └── app.js              # Client-side utility functions
├── src/
│   ├── app.js                  # Express server setup and middleware
│   ├── firebase.js             # Firebase database operations and utilities
│   └── routes/
│       ├── campaigns.js        # Campaign CRUD operations
│       ├── donations.js        # Donation management endpoints
│       └── auth.js             # Authentication and verification
├── views/
│   ├── index.html              # Home page - create new campaign
│   ├── campaign.html           # Campaign view + admin panel
│   └── admin.html              # Admin page redirect
├── .env.example                # Template for environment variables
├── package.json                # Project dependencies and scripts
├── .gitignore                  # Git ignore rules
└── README.md                   # This file
```

## API Endpoints 📡

### Campaign Management

#### Create Campaign
```
POST /api/campaigns
Content-Type: application/json

{
  "name": "School Library Fund",
  "slug": "school-library",
  "targetAmount": 10000,
  "email": "organizer@example.com",
  "password": "SecurePass123"
}
```

#### Get Campaign Details (Public)
```
GET /api/campaigns/:slug

Response:
{
  "id": "uuid",
  "name": "School Library Fund",
  "slug": "school-library",
  "target_amount": 10000,
  "accumulated_amount": 5000,
  "created_at": "2026-06-12T09:00:00Z",
  "donations": [...],
  "progressPercentage": 50
}
```

### Donation Management

#### Add Donation (Organizer Only)
```
POST /api/donations/:campaignSlug
Content-Type: application/json

{
  "donorName": "John Doe",
  "amount": 500,
  "timestamp": "2026-06-12T09:30:00Z",
  "email": "organizer@example.com",
  "password": "SecurePass123"
}
```

#### Delete Donation (Organizer Only)
```
DELETE /api/donations/:campaignSlug/:donationId
Content-Type: application/json

{
  "email": "organizer@example.com",
  "password": "SecurePass123"
}
```

### Authentication

#### Verify Organizer Credentials
```
POST /api/auth/verify
Content-Type: application/json

{
  "campaignSlug": "school-library",
  "email": "organizer@example.com",
  "password": "SecurePass123"
}
```

#### Logout
```
POST /api/auth/logout
```

## Firebase Database Structure 🗄️

### Campaigns Collection
```
campaigns/
└── {slug}
    ├── id: string (UUID)
    ├── name: string
    ├── slug: string (unique identifier)
    ├── target_amount: number (in dollars)
    ├── accumulated_amount: number (in dollars)
    ├── email: string (organizer email)
    ├── password_hash: string (bcrypt hashed)
    ├── created_at: string (ISO 8601 timestamp)
    └── updated_at: string (ISO 8601 timestamp)
```

### Donations Collection
```
donations/
└── {campaignId}
    └── {donationId}
        ├── donor_name: string
        ├── amount: number (in dollars)
        ├── timestamp: string (ISO 8601 timestamp)
        └── created_at: string (ISO 8601 timestamp)
```

## Firebase Security Rules 🔒

Configure the following rules in your Firebase Realtime Database:

1. Go to Firebase Console → Your Project → Realtime Database → Rules
2. Replace the default rules with:

```json
{
  "rules": {
    "campaigns": {
      ".read": true,
      ".write": false,
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

### Security Rule Explanation:
- ✅ **Public Read Access**: Anyone can view all campaigns and donations
- ✅ **No Direct Writes**: Clients cannot directly write to the database
- ✅ **Sensitive Data Hidden**: Password hashes and organizer emails are not readable
- ✅ **Backend Control**: Only the backend server (with Firebase Admin SDK) can write data

**Why this approach?**
- Prevents unauthorized data modification
- Protects sensitive organizer information
- Ensures data integrity
- Allows real-time public visibility

## Usage Guide 📖

### For Supporters/Public Users:
1. Navigate to the home page
2. Click on a campaign URL shared by the organizer
3. View the campaign progress and list of donations
4. No login required!

### For Campaign Organizers:
1. Go to home page
2. Fill in campaign details:
   - Campaign Name
   - Campaign Slug (URL-friendly identifier)
   - Target Amount (fundraising goal)
   - Email and secure password
3. Click "Create Campaign"
4. Share the campaign URL with supporters
5. To manage donations:
   - Go to your campaign page
   - Click "Admin Login"
   - Enter your email and password
   - Add/delete donations as needed

## Scripts 🎬

```bash
# Start development server with auto-reload
npm run dev

# Start production server
npm start
```

## Development Notes 💡

- The application uses **Express.js** for routing and middleware
- **Firebase Admin SDK** handles all database operations server-side
- **Bcryptjs** secures all passwords with salt rounds of 10
- **Session management** via express-session (optional, primarily for future enhancements)
- **EJS** templating engine renders HTML views

## Error Handling 🚨

The application includes comprehensive error handling:
- Invalid credentials return 401 Unauthorized
- Missing campaigns return 404 Not Found
- Duplicate campaign slugs return 400 Bad Request
- Server errors return 500 Internal Server Error

## Future Enhancements 🚀

Potential features to add:
- Email notifications for donations
- Campaign analytics and charts
- Multiple currency support
- Social sharing buttons
- Donor anonymity options
- Export donation data to CSV
- QR code for campaign sharing
- Recurring donation support

## Troubleshooting 🔧

### Firebase Connection Error
- Verify `.env` file has correct Firebase credentials
- Check that Firebase Realtime Database is enabled in your project
- Ensure network connectivity

### Campaign Already Exists Error
- Campaign slug must be unique
- Try a different slug name

### Password Requirements
- Minimum 8 characters
- Must contain uppercase letter
- Must contain lowercase letter
- Must contain number

### Session Expires
- Re-login with your credentials
- Session timeout is set to 24 hours

## Contributing 🤝

Contributions are welcome! Please feel free to submit a Pull Request.

## License 📄

MIT License - feel free to use this project for personal or commercial purposes.

## Support 💬

For issues, questions, or suggestions, please open an issue on GitHub.

---

**Made with ❤️ by [addeelnayyer](https://github.com/addeelnayyer)**
