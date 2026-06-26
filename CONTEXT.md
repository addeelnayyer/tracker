# Nasr — Campaign Ledger

A web app for tracking fundraising campaigns: a public donation ledger per campaign, managed by its organizer.

## Language

**Campaign**:
A single fundraising effort with a goal, a public ledger of donations, bank details, and documents. Identified publicly by its slug.

**Organizer**:
The person who created a campaign and holds full control over it. Authenticated by control of the owner email. Can edit campaign settings, delete the campaign, and add or remove members. There is exactly one organizer per campaign — no separate user account exists.
_Avoid_: Admin, user, account

**Member**:
A person added by the organizer to help handle payments on a campaign. Can add bank details and attach payment proof, but cannot edit campaign settings, delete the campaign, or manage the member list. Authenticated via OTP to their own email. A campaign may have zero or more members.
_Avoid_: Admin, collaborator, co-organizer

**Owner email**:
The single email address that identifies the organizer of a campaign. It is the primary ownership factor and the organizer's login channel. A campaign has exactly one owner email.

**OTP**:
A short-lived, single-use numeric code emailed to an address (owner email or member email) to authenticate that identity for a campaign. It is the sole login mechanism; there is no password. OTP state is scoped per campaign + email, so concurrent logins do not interfere.
_Avoid_: Password, PIN, token

**Session**:
The authenticated period following a successful OTP verification. Carries a role — either `organizer` or `member` — which gates what actions the holder may perform.

**Pending signup**:
A campaign creation that has been submitted but not yet confirmed by OTP. It is not a Campaign yet — it holds no slug reservation and expires if the code is never entered.

**Donation**:
A single recorded contribution to a campaign's ledger (donor name, amount, timestamp).
