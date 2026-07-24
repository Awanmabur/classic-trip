# Classic Trip Authentication and Role Onboarding

**Release date:** July 22, 2026  
**Scope:** Authentication, company-owner/partner signup, promoter onboarding, staff and driver invitations, contact verification, administrator MFA, role permissions, and access state machines.

## 1. Design rule

The existing Classic Trip UI is the source of truth. Authentication and onboarding reuse the current login/signup panels, partner profile, promoter profile, invitation page, dashboard shell, cards, buttons, inputs, notices, and tables. No duplicate auth portal or second dashboard was introduced.

Account access and operational verification are separate:

- An active account may sign in to finish onboarding.
- A pending company, promoter, or driver is restricted to its onboarding-safe workspace.
- Publication, live booking operations, check-in, payment/refund operations, offline sales, withdrawals, assignments, and payouts require the relevant approved state.

## 2. Canonical role matrix

| Role | Entry method | Initial state | Allowed before approval | Blocked before approval |
|---|---|---|---|---|
| Customer | Public signup or Google | Active customer | Customer profile, search and booking | Provider/admin functions |
| Company owner / partner | Public partner signup or approved invitation | Active account; pending company | Company profile, legal/payout/support setup, draft bus setup, verification | Publish, live booking operations, check-in, payment/refund, staff/driver creation, payout |
| Promoter | Public signup or invitation | Active account; pending verification | Profile, referral links, verification submission | Offline sales, withdrawals and promoter payout |
| Company staff | Signed company invitation | Active after acceptance | Only assigned branch/listing/schedule permissions | Other tenants, unassigned permissions, driver/admin authority |
| Driver | Administrator-approved signed invitation | Active for verification; pending membership | Driver profile, documents, email/phone verification status | Assignment and trip operations |
| Delegated platform admin | Super Admin invitation | Active; MFA enforcement currently off | Admin dashboard | When `PLATFORM_MFA_ENABLED=true`, all administrative dashboards/APIs until MFA succeeds |
| Super Admin | Secure bootstrap/provisioning | Active; MFA enforcement currently off | Super Admin workspace | When `PLATFORM_MFA_ENABLED=true`, Super Admin workspace until MFA succeeds |

Public registration cannot create company staff, drivers, finance/support/operations/content administrators, administrators, or Super Admins.

## 3. Partner signup and onboarding

1. Owner submits name, company, service type, country, city, email, phone, password, currency, and accepted terms through the existing auth UI.
2. The backend creates one owner account and one new pending company.
3. Public input cannot select or attach to an existing company ID/slug.
4. Account status is active for onboarding; company verification remains pending.
5. The session is regenerated and redirected to `/company/profile?onboarding=1`.
6. Email verification and six-digit phone verification are required.
7. The owner completes legal identity, payout, support, agreement, documents, and draft inventory.
8. Company verification is submitted to the administrator review queue.
9. Activation rechecks the owner account, verified contacts, company status, documents, payout/support details, and checklist.
10. Only activation enables publish and operational actions.

The existing company profile edit modal also includes owner login email and owner verified phone. A change:

- Checks account uniqueness.
- Audits the change.
- Clears old verification evidence.
- Sends a new email link and/or phone OTP.
- Disables company publication and returns onboarding to contact reverification.

Google-created partner accounts can therefore add the required phone inside the same existing profile UI.

## 4. Promoter onboarding

1. Promoter self-registers or accepts a signed invitation.
2. The account enters the existing promoter profile/referral workspace.
3. Email and phone are verified.
4. Identity, payout, terms, and anti-fraud/offline-sales training are submitted.
5. Admin reviews the promoter checklist.
6. Approval sets verification and onboarding to complete.
7. Withdrawals and offline sales are independently blocked in route middleware and service methods until approval.
8. Changing the promoter email or phone invalidates approval and requires reverification.

## 5. Staff invitation lifecycle

1. Company must be active and verified.
2. Owner chooses an existing branch, listing(s), schedule(s), service categories, role title, and canonical permissions.
3. Backend validates every selected relationship belongs to that company.
4. A signed invitation is sent; no passwordless account is silently activated.
5. Invitee accepts terms and creates a bcrypt-safe password.
6. Membership records `invitedAt` and `acceptedAt`.
7. Staff receives only the canonical scoped permissions.
8. Generic role editing cannot activate an invitation that lacks accepted credentials.
9. Staff invitation cannot request driver-only title/permissions.

Canonical UI/backend permission examples include:

- `booking.view`
- `booking.create_manual`
- `checkin.scan`
- `checkin.manage`
- `manifest.view`
- `inventory.update`
- `schedule.update`
- `payment.record`
- `refund.request`
- `support.manage`
- `reports.view`

Legacy labels are normalized only for migration/backward compatibility; they are not the authorization source of truth.

## 6. Driver lifecycle

```text
Approved company
  -> administrator-approved driver invitation
  -> signed invitation acceptance and password
  -> dedicated user.role = driver
  -> scoped company employee membership
  -> verified email
  -> verified phone
  -> licence and identity documents
  -> safety review
  -> all required driver permissions
  -> admin checklist approval
  -> driver activation
  -> vehicle/schedule assignment
  -> manifest, check-in assistance, trip status and incident operations
```

Required permissions are centralized:

```text
manifest.view
checkin.assist
trip.status.update
incident.create
```

Activation independently checks:

- Active, verified company.
- Dedicated driver account role.
- Accepted invitation and password credentials.
- Verified email and phone.
- Licence documentation.
- Every required permission.
- Approved verification checklist.

Assignment independently checks the account role/status/verification, membership status, safety clearance, and every required permission. A role title such as “Driver” is never enough.

Changing a driver email or phone:

- Clears the corresponding proof.
- Returns account/membership to pending verification.
- Suspends active assignments.
- Sends fresh verification.

## 7. Administrator invitations and MFA

Delegated roles:

- `admin`
- `content_admin`
- `support_admin`
- `finance_admin`
- `operations_admin`

`super_admin` is not available in the normal invitation interface.

Administrator flow:

1. Secure invitation and password setup.
2. Account enters `mfa_setup_required`.
3. TOTP secret is generated and encrypted with AES-256-GCM.
4. Authenticator QR/manual secret is shown during setup.
5. Recovery codes are shown once and stored only as hashes.
6. While `PLATFORM_MFA_ENABLED=false`, login proceeds directly to the authorized administrator dashboard.
7. When the flag is changed to `true`, login creates a short-lived MFA challenge and fresh MFA is required on administrator dashboards and sensitive shared APIs.
8. Attempt limits, expiration, session regeneration, and recovery-code consumption are enforced.

## 8. CSRF, passwords, sessions, and one-time secrets

- Browser mutations require CSRF protection.
- Sessions regenerate after registration, login, and MFA completion.
- Passwords require at least eight characters, a letter, a number, and no more than 72 UTF-8 bytes.
- Password reset and email verification tokens are stored as hashes.
- Invitation tokens are stored as hashes and removed from durable records.
- Phone codes use cryptographic random generation, salted hashing, constant-time comparison, expiry, attempt limits, and resend cooldown.
- Durable notification records contain redacted messages; only delivery adapters receive one-time secrets.
- Sensitive user fields are removed from browser session projections.

## 9. Route and service enforcement

The interface is not trusted as an authorization mechanism.

- Company tenant scope comes from the authenticated account.
- Pending owners retain onboarding access but operational routes require company verification.
- Staff membership and permissions are refreshed from storage.
- Driver assignment and schedule selection require an actual verified driver identity.
- Promoter offline sales and payouts require verified promoter state.
- Platform administration always requires the correct role; fresh MFA is additionally required when `PLATFORM_MFA_ENABLED=true`.
- Changing regulated contact data invalidates stale approval.

## 10. Existing-data migration

Back up MongoDB and use a replica-set/mongos deployment with transactions enabled.

```bash
npm run migrate:auth-onboarding
npm run migrate:auth-onboarding:apply
```

The migration:

- Unlocks pending partner/promoter accounts only for restricted onboarding.
- Preserves operational blocks until approval.
- Moves rejected companies to correction mode.
- Blocks passwordless privileged accounts pending signed reinvitation.
- Adds accepted timestamps to valid legacy memberships.
- Canonicalizes employee permissions.
- Suspends assignments for unverified drivers.
- Repairs phone and onboarding states.
- Forces administrators without real encrypted MFA secrets through setup.
- Hashes/removes legacy plaintext invitation tokens.

Reconcile every migrated pending, rejected, verified, passwordless, driver, and administrator record before production traffic.

## 11. Release commands

```bash
npm ci
npm run migrate:auth-onboarding
npm run check:auth-onboarding
npm run check:auth-pure
npm run verify:bus
npm run verify
npm audit --omit=dev
npm run launch:check
```

## 12. Verification status for this archive

Executed:

- Auth/onboarding structural gate: **130/130 passed**.
- Dependency-free auth behavior gate: **11/11 passed**.
- Canonical bus gate: **81/81 passed**.
- JavaScript parser: **470 files checked, 0 failures**.
- Architecture/security, route-security, entity/relationship UI, dashboard-scope, and static dashboard-route gates: passed.
- Package/lockfile root metadata: consistent.
- Cleanup scan: passed.

Not executed in the offline artifact environment:

- Jest runtime/integration suite.
- Full application boot against a MongoDB replica set.
- Live email, SMS, Google OAuth, and payment-provider certification.
- Current npm advisory audit.
- Load, concurrency, DAST, and penetration testing.

These remain mandatory in connected CI/staging before production deployment.
