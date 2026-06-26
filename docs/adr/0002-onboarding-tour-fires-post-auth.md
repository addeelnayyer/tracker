# Onboarding tour fires post-authentication and does not teach login

## Status

accepted

## Context

The campaign page is the app's only complex surface. Most of its machinery lives in
the organizer drawer ("Organizer Desk"), a slide-out `<aside>` that is invisible until
an organizer authenticates and whose tools (record a donation, bank accounts, documents)
sit in collapsed accordions. A brand-new organizer can plausibly miss the drawer entirely.
We want a first-run guided tour that orients organizers around the desk.

A wrinkle drove this decision. The drawer swaps between two mutually-exclusive states via
the `admin-mode` body class: when authenticated, the "Sign in" button **and** the email/OTP
login fields are `display:none`, and only then are the desk tools shown. So the moment an
organizer is able to use the desk is exactly the moment the login UI no longer exists in the
DOM as visible elements. Authentication is per-campaign OTP with no user account, so a
logged-out viewer is indistinguishable from any public visitor, and there is no session in
which to record per-organizer state.

## Decision

- **The tour targets a newly-authenticated organizer on the campaign page only**, and is
  scoped **per campaign** (one campaign has exactly one owner email).
- **Trigger is a single client-side rule: authenticated AND `tour_seen_at` unset ⇒ run the
  tour.** It is evaluated both on campaign-page load (which catches the brand-new creator,
  who verifies their OTP on the `/start` confirm page and is redirected in already
  authenticated) and immediately after a successful drawer OTP verify (the returning
  organizer). Both entry paths collapse to the same check.
- **The login flow is deliberately not part of the tour.** Because the tour runs post-auth,
  the sign-in button and email/OTP fields are hidden; a single desk step instead notes that
  re-entry is OTP-only (no password). Teaching login would require either driving the drawer
  back into its logged-out state to demo fields the organizer doesn't need, or a separate
  logged-out tour — see alternatives.
- **"Seen" is server-side: `tour_seen_at` on the campaign record**, written via the existing
  `updateCampaign`, and set only on **finish or explicit skip**. A mid-tour reload re-shows
  the tour, which is the right failure mode for one-time onboarding.

## Considered alternatives

- **A logged-out "how to sign in" tour** (real spotlights on the button → email → OTP fields)
  — rejected for v1. It would fire for *any* logged-out visitor including donors (we can't
  identify the organizer without a session), needs a `localStorage` seen-flag for the
  logged-out half, and roughly doubles the scope. Left open as a possible distinct feature.
- **Driving the drawer into its logged-out state mid-tour** to demo the hidden login fields,
  then restoring `admin-mode` — rejected; theatrical (demoing a login the organizer has just
  completed), risks a stray real OTP send if they type, and is fragile state-juggling.
- **Marking "seen" on tour start rather than finish/skip** — rejected; an accidental refresh
  would cost the organizer the entire one-time onboarding.
- **Client-only `localStorage` seen-state** — rejected; per-device, so an organizer who
  creates on a laptop and later signs in from a phone would see the tour again. The
  one-owner-per-campaign model makes a server-side campaign flag both cheaper and more correct.
