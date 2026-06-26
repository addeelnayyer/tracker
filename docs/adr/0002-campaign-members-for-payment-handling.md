# Campaign members for payment handling

## Status

accepted

## Context

A campaign has exactly one organizer, authenticated by the owner email. There is no
mechanism for other people to manage payment details (bank accounts, payment proof) on
behalf of the organizer. The organizer needs to delegate these tasks to trusted individuals
without handing over the owner email.

## Decision

- **A new `Member` role is introduced.** Members can add bank details and attach payment
  proof. They cannot edit campaign settings, extend the goal, delete the campaign, or
  manage the member list. Only the organizer can add and remove members.

- **Members are stored in a separate Firebase collection** `members/{campaignId}`, each
  entry holding `{ email, added_at }`. This mirrors the existing pattern for sub-entities
  (`bank_details`, `donations`, `documents`). A campaign may have zero or more members.
  Member emails are added immediately — there is no acceptance step.

- **Login is the same unified OTP flow** used by the organizer. The user enters their email
  on the campaign page; the server checks whether it matches the owner email (→ organizer)
  or any member email for this campaign (→ member) and sends an OTP accordingly. The
  response remains neutral to avoid email enumeration.

- **OTP state is now keyed by `campaignSlug + email`** (previously `campaignSlug` only).
  This isolates concurrent login attempts — organizer and members can authenticate
  simultaneously without clobbering each other's pending code.

- **The session cookie gains two fields: `role` and `email`.** Final shape:
  `{ campaignId, slug, role, email, exp }`. `role` is either `"organizer"` or `"member"`.
  Protected routes gate restricted actions (settings, delete, member management) on
  `role === "organizer"`.

- **Member revocation is immediate.** On every write request from a `member` session, the
  server re-verifies that the session email is still present in `members/{campaignId}`.
  If the organizer has removed them, the next request returns 401. There is no server-side
  session store — the re-verification check against the `members` collection is the
  invalidation mechanism.

## Considered alternatives

- **Version counter on the members collection** — the session would carry a `membersVersion`
  integer and the server would reject sessions whose version is stale. Rejected: adds write
  overhead on every add/remove and is harder to reason about than a direct membership check.

- **Server-side session store for invalidation** — rejected for the same reason as ADR 0001:
  this runs on ephemeral Cloud Functions where an in-memory store fails across instances, and
  adding a persistent store (RTDB-backed sessions) is disproportionate for this use case.

- **Invite-link / accept flow** — the organizer would generate a one-time invite URL and the
  member would accept it before gaining access. Rejected: adds friction with no meaningful
  security gain, since the organizer already controls who is on the list and OTP at login
  time verifies email ownership.

- **Embedding members in the campaign document** — rejected in favor of a separate collection
  to stay consistent with existing sub-entity patterns and avoid unbounded campaign document
  growth.
