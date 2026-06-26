# Email OTP login with a signed-cookie session, replacing the campaign password

## Status

accepted

## Context

Authentication was a per-campaign password: the password was bcrypt-hashed on the
campaign record, and the **plaintext password was stored in `localStorage` and replayed
on every mutating request**, where each route independently re-verified `email + bcrypt`.
The `express-session` cookie existed but was effectively vestigial. We want to remove the
password and authenticate organizers via a one-time code emailed to the campaign's owner
email.

## Decision

- **Login is email OTP.** The organizer enters an email; a 6-digit, single-use code with a
  10-minute TTL is sent **only** if the email matches the campaign's owner email. The
  response is always neutral ("if that address is the organizer, a code was sent") to avoid
  owner-email enumeration. Codes are stored hashed in RTDB. Abuse limits: 60s resend
  cooldown, max 5 sends/campaign/hour, max 5 wrong verify attempts before the code is voided.
- **A verified OTP establishes a real session, carried by a stateless signed cookie**
  (`httpOnly`, `secure` in production, `sameSite`) holding `{campaignId, slug, exp}`. There
  is **no server-side session store** — required because this runs on ephemeral, autoscaling
  Cloud Functions where the in-memory store fails across instances. Session is 7 days, rolling.
- **All mutation routes gate on the session cookie**, not on replayed credentials. The
  frontend no longer stores or sends any secret; admin controls are revealed via a server
  `auth/status` check (the cookie is not JS-readable).
- **Campaign creation is OTP-verified.** Submitted fields are held in a short-lived RTDB
  pending-signup node; the real campaign is materialized (and slug-uniqueness checked) only
  after the code verifies, which also logs the creator in. This proves email ownership up
  front and prevents typo-lockout, since the owner email is now the only way back in.
- **Removed:** the password field at creation, and the `verify` / `change-password` /
  `reset-password` endpoints and their UI. Existing campaigns' `password_hash` is left
  dormant and ignored.

## Considered alternatives

- **Bearer token in localStorage** after OTP — rejected; reinvents sessions and re-introduces
  a long-lived client-side secret, the exact pattern we're removing.
- **RTDB/Firestore-backed server session store** — rejected; the session payload is tiny, so a
  signed cookie avoids a store entirely and suits serverless better.
- **Firebase Authentication email sign-in** — rejected; it re-architects identity (owners
  become Firebase Auth users) rather than keeping the owner-email-on-campaign model.
- **Nodemailer/SMTP for delivery** — rejected in favor of a transactional API (Resend) for
  deliverability on auth-critical mail; SMTP/Gmail has rate limits and poor inbox placement.
