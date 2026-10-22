# BlockLand role-based dashboards

This document describes the implemented role-scoped dashboard prototype and its current boundaries.

## Sign-in and dashboard routes

The site opens on a login screen with a role selector for Landowner, Buyer, and Government Officer; Administrator is available on sign-in only and cannot be self-selected during registration. New public accounts choose Landowner, Buyer, or Government Officer. Landowner and Buyer account creation activates only the selected public role. Choosing Government Officer creates a regular account and a pending officer-access request; it does not grant government permissions. An administrator must approve that request and assign a jurisdiction before Government sign-in is permitted. Existing approved officers select Government Officer when signing in.

The public registry remains available at `/explore`.

| Role | Route | Scope |
| --- | --- | --- |
| Landowner | `/dashboard/owner` | Owned plots, ownership events, shares, document hashes, freezes, sales, and notifications |
| Buyer | `/dashboard/buyer` | Purchases, escrow status, watchlist, registry verification reports, and identity status |
| Developer | `/dashboard/developer` | Profile, owned-land portfolio, projects, followers, and buyer enquiries |
| Government officer | `/officer` | Verification, transfer, fraud, dispute, encumbrance, objection, and officer audit queues |
| Administrator | `/admin` | Accounts and roles, officer provisioning, access requests, second approvals, system health, audit search, and legal correction events |

The shared dashboard header offers a role switcher for active assignments. Switching requests a new role-bound access token from `POST /api/v1/auth/switch-role` and records an audit event. The API checks active role assignments for every protected request; dashboard links are not authorization controls.

## Implemented controls and workflows

- Legacy accounts receive their initial role assignments only when no assignment records exist. Revoked assignments are not recreated by authentication.
- Administrators can grant or revoke roles, suspend accounts, create jurisdiction-scoped government accounts, and review developer access requests.
- Officer queues and write actions are scoped to the officer's assigned state. Officers cannot review or act on their own registrations, land, disputes, objections, or transfers in which they are a party.
- Land registration only accepts parcel attributes. Verification state, owner identity, token IDs, and other protected fields are set by the server.
- Public land and transfer responses use explicit safe projections. Private document paths are not returned; document metadata is limited to the uploader, current plot owner, assigned review officer, or administrator.
- Sale initiation requires a verified owner wallet signature over a nonce-bound sale message and a time-limited email OTP. A plot is locked only after both checks pass. The seller can cancel before escrow is funded.
- Buyer phone OTP requests are account-scoped and time-limited. OTP confirmation alone is recorded as pending (`OTP_ONLY`); it does not assert legal identity or Aadhaar/UIDAI verification.
- Active disputes, encumbrances, transfer freezes, and sale locks prevent new transfers. Officer approval rechecks current restrictions, cooling-off completion, escrow funding, jurisdiction, and party conflicts.
- High-value transfers use a second independent officer approval. The configurable threshold is `SECOND_APPROVAL_THRESHOLD_INR` (default INR 5,000,000); high/critical fraud flags also require a second approval.
- Watchlisted buyers receive account-scoped notifications for new sale locks, completed/cancelled transfers, and changes to disputes, encumbrances, and fraud reviews.
- Court-ordered ownership corrections create an ownership-history event and an audit record; the correction does not rewrite earlier history.
- Realtime socket connections require a valid role-bound token. Events are emitted only to participating users, the plot's jurisdiction room, or administrators.

## Local prototype limitations

- Escrow is represented by the `DEMO_ESCROW` database workflow. It is not a bank, payment-provider, or production smart-contract escrow integration.
- Registry records, government accounts, verification, and sample data are local illustrative data. The application is not an authoritative land registry or legal conveyance service.
- Email OTP delivery requires SMTP configuration. Without SMTP, the local development email transport logs the message for demonstration.
- Aadhaar/UIDAI verification is not integrated. Local demo OTPs are for UI testing only; production SMS OTP confirms phone access and must not be treated as identity proof.
- The project workflow currently supports project creation, status changes, profile editing, and safe land linkage; it is not a complete nine-step construction-planning wizard.
- The role dashboard APIs are backed by the local Prisma/PostgreSQL schema. Production deployment still requires reviewed migrations, jurisdiction onboarding, operational key management, privacy review, and end-to-end integration tests.
