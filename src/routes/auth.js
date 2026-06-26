'use strict';

const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const cookieSession = require('../cookieSession');

// ─── OTP helpers ──────────────────────────────────────────────────────────────

const NEUTRAL_MSG = { message: 'If that address is the organizer, a code has been sent.' };
const OTP_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_SENDS_PER_HOUR = 5;
const MAX_VERIFY_ATTEMPTS = 5;
const HOUR_MS = 60 * 60 * 1000;

function generateOtp() {
  return String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
}

function hashOtp(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

function hashEmail(email) {
  return crypto.createHash('sha256').update(String(email).toLowerCase()).digest('hex');
}

// ─── OTP request ──────────────────────────────────────────────────────────────

router.post('/otp/request', async (req, res) => {
  try {
    const { firebase, email } = req.app.locals;
    const { campaignSlug, email: submittedEmail } = req.body;

    if (!campaignSlug || !submittedEmail) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const campaign = await firebase.getCampaign(campaignSlug);

    // Always respond neutrally — never reveal whether campaign or email matched
    if (!campaign) {
      return res.json(NEUTRAL_MSG);
    }

    const isOwner = campaign.email === submittedEmail;
    if (!isOwner) {
      const members = await firebase.getMembers(campaign.id);
      const isMember = members.some(m => m.email === submittedEmail);
      if (!isMember) return res.json(NEUTRAL_MSG);
    }

    const now = Date.now();
    const emailHash = hashEmail(submittedEmail);
    const state = (await firebase.getOtpState(campaignSlug, emailHash)) || {};

    if (state.lastSentAt && now - state.lastSentAt < RESEND_COOLDOWN_MS) {
      return res.status(429).json(NEUTRAL_MSG);
    }

    const stillSameHour = state.hourStart && now - state.hourStart < HOUR_MS;
    const hourStart = stillSameHour ? state.hourStart : now;
    const sendsThisHour = stillSameHour ? (state.sendsThisHour || 0) : 0;

    if (sendsThisHour >= MAX_SENDS_PER_HOUR) {
      return res.status(429).json(NEUTRAL_MSG);
    }

    const code = generateOtp();
    await firebase.setOtpState(campaignSlug, emailHash, {
      codeHash: hashOtp(code),
      expiresAt: now + OTP_TTL_MS,
      attemptCount: 0,
      lastSentAt: now,
      sendsThisHour: sendsThisHour + 1,
      hourStart,
    });

    await email.sendOtp(submittedEmail, code);

    res.json(NEUTRAL_MSG);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ─── OTP verify ───────────────────────────────────────────────────────────────

router.post('/otp/verify', async (req, res) => {
  try {
    const { firebase } = req.app.locals;
    const { campaignSlug, email: submittedEmail, code } = req.body;

    if (!campaignSlug || !submittedEmail || code === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const emailHash = hashEmail(submittedEmail);
    const [campaign, state] = await Promise.all([
      firebase.getCampaign(campaignSlug),
      firebase.getOtpState(campaignSlug, emailHash),
    ]);

    if (!campaign) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    if (!state || !state.codeHash || Date.now() > state.expiresAt) {
      return res.status(400).json({ error: 'Code expired or not found' });
    }

    const submitted = hashOtp(code);
    const stored = state.codeHash;
    // Both are 64-char hex strings; timingSafeEqual prevents timing leaks
    const match = crypto.timingSafeEqual(Buffer.from(submitted), Buffer.from(stored));

    if (!match) {
      const attempts = (state.attemptCount || 0) + 1;
      if (attempts >= MAX_VERIFY_ATTEMPTS) {
        await firebase.clearOtpState(campaignSlug, emailHash);
        return res.status(400).json({ error: 'Too many failed attempts, request a new code' });
      }
      await firebase.setOtpState(campaignSlug, emailHash, { ...state, attemptCount: attempts });
      return res.status(400).json({ error: 'Invalid code' });
    }

    await firebase.clearOtpState(campaignSlug, emailHash);

    let role, sessionEmail;
    if (submittedEmail === campaign.email) {
      role = 'organizer';
      sessionEmail = campaign.email;
    } else {
      const members = await firebase.getMembers(campaign.id);
      const member = members.find(m => m.email === submittedEmail);
      if (!member) return res.status(400).json({ error: 'Invalid request' });
      role = 'member';
      sessionEmail = submittedEmail;
    }

    cookieSession.setSessionCookie(res, { campaignId: campaign.id, slug: campaignSlug, role, email: sessionEmail });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Session status ───────────────────────────────────────────────────────────

router.get('/status', async (req, res) => {
  try {
    const session = cookieSession.getSession(req);
    const slug = req.query?.slug;
    if (session && session.slug === slug) {
      const { firebase } = req.app.locals;
      const campaign = await firebase.getCampaign(slug);

      // Legacy sessions (issued before the role field was added on 2026-06-15)
      // have no role, which makes the client hide the organizer-only tools. Such
      // sessions predate member login, so derive the role: an email matching the
      // campaign owner (or no email at all, the legacy organizer shape) is the
      // organizer; anything else is a member.
      let role = session.role;
      if (!role) {
        if (session.email && campaign && session.email !== campaign.email) {
          const members = await firebase.getMembers(campaign.id);
          role = members.some(m => m.email === session.email) ? 'member' : 'organizer';
        } else {
          role = 'organizer';
        }
      }

      // Re-issue the cookie with the resolved role so the session self-heals for
      // every subsequent request, not just this status check.
      cookieSession.setSessionCookie(res, { campaignId: session.campaignId, slug: session.slug, role, email: session.email });
      const tourPending = !campaign?.tour_seen_at;
      return res.json({ authenticated: true, tourPending, role });
    }
    return res.json({ authenticated: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie(cookieSession.COOKIE_NAME);
  res.json({ success: true });
});

module.exports = router;
