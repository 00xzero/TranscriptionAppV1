# WorkOS Node 12 update — 2 November 2026

## Change

`@workos-inc/node` moves from 10.14.0 to 12.1.0. The lockfile changes only
that package and the root declaration. AuthKit remains 4.6.2, iron-session
remains 8.0.4, and npm confirms one deduplicated WorkOS 12 SDK used by both
the app and AuthKit. No application auth logic, environment files, database
schema, or grants changed.

The SDK returns user timestamps as Date objects. AuthKit already handles
sealing and reviving them. The existing installed-AuthKit contract probe now
uses realistic API timestamps and string-valued timestamps in its initial
sealed cookie. Two new checks require valid Date values for createdAt,
updatedAt, and lastSignInAt after both an existing-cookie read and a successful
expired-token refresh. These run the real installed AuthKit and SDK against a
local mock WorkOS endpoint, rather than replacing the SDK with a Jest mock.

## Automated validation

| Check | Result |
| --- | --- |
| Final full Jest run | 226 suites, 2,937 tests, 7 snapshots passed |
| Typecheck, including the added checks | Passed |
| Full lint | Passed: 0 errors, 58 warnings |
| Targeted lint on the contract test/probe | Passed |
| Production build | Passed with Next.js 16.4.4 and Turbopack |
| WorkOS/AuthKit/iron-session dependency tree | Valid; no peer conflict |
| Diff whitespace checks | Passed |
| npm audit | Unchanged: 0 critical, 3 high, 36 moderate, 1 low affected package entries |

The suite retains the prior signal-listener/delayed-exit warnings. Tests exited
successfully. Existing outage cases also pass: unreachable signing keys,
transient refresh-service failure, refused refresh, invalid JWT, unreadable
cookie, wrong sealing password, and successful refresh. Outages preserve the
session cookie; terminal failures in the proxy contract clear it.

The production build completed before the final fixture/test-only additions;
final typecheck, targeted lint, and the full Jest run cover those additions.
No application source changed after the successful build.

## Live environment and safeguards

Browser tests used the updated production build on localhost:3000 against the
existing WorkOS staging environment and configured hosted Supabase project.
The WorkOS key was checked to be a staging key without exposing it. Inngest
development mode was set only on the temporary server process.

A disposable mailbox was created through [Mail.tm](https://mail.tm/), and the
app created its corresponding disposable staging user. That account started
with no transcripts or projects. No records, files, tags, or recordings were
created through the app beyond the authentication fixtures.

The protected account's current hosted baseline was captured before testing:
68 transcript ID/owner rows, with a SHA-256 comparison of the sorted rows.
This is a fresh environment-specific snapshot, not the older local baseline
from previous auth testing. Its WorkOS identity, app-user ID, row count, and
ID/ownership hash matched after testing and cleanup. Its password was never
changed, and its browser sign-in was restored after provider checks.

Google and Microsoft provider identities were explicitly approved by the user
for this run. Neither provider identity nor its app-user mapping was deleted.

## Live results

| Flow | Observed result |
| --- | --- |
| Existing pre-upgrade session | Existing regular-profile session opened the library with SDK 12 |
| Signup | Created the disposable user through the app |
| Verification delivery | Actual staging verification email arrived in the disposable inbox |
| Incorrect verification code | Inline invalid-code message; verification step remained usable |
| Resend | A new code/email arrived; superseded code was rejected |
| Correct verification | Signed in through /auth/finish and preserved the requested projects destination |
| Account isolation | Disposable account showed an empty library, rather than protected-account data |
| Wrong password | Inline credential mismatch, preserving the password step |
| Forgot password | Neutral confirmation and actual reset email delivery |
| Reset link routing | Emailed link opened the app's reset-password form |
| Weak reset password | Provider strength feedback; token remained usable |
| Successful reset | Saved the new disposable password and signed in |
| Reset replay | Used token rejected with the expired/already-used message |
| Password replacement | Old password rejected; new password signed in |
| Active refresh | Invoked the built AuthKit refresh server action in the authenticated browser: HTTP 200, same user, then page reload retained the session |
| Sign-out | Returned to /auth; protected projects URL required sign-in |
| Google OAuth | Existing cached test identity selected; callback returned to the requested people destination and the account menu showed the correct email |
| Microsoft OAuth | User completed Microsoft's identity verification; callback returned to the requested projects destination and the account menu showed the correct email |
| Protected password sign-in | Original documented test account signed in and its existing library loaded |

The active-refresh check invoked AuthKit's built refreshAuthAction through the
same-origin Server Action transport. It did not wait for natural JWT expiry
or add a temporary application route. Token values were not printed or saved.

## Session revocation observation

Only the disposable user's active session was revoked through the staging SDK.
The provider confirmed zero active sessions. Explicitly invoking AuthKit's
refresh action then returned a terminal TokenRefreshError caused by
invalid_grant (session ended), represented by HTTP 500 in that direct Server
Action call. An immediate navigation initially still accepted the existing,
unexpired JWT. Later session checks returned the browser to /auth and kept
the protected destination in next.

Immediate global revocation is therefore not a guarantee of the current
JWT-based setup. The unchanged AuthKit refreshSession implementation wraps
provider failures as TokenRefreshError, and the proxy verifies JWTs/renews
them rather than introspecting each live provider session. No new SDK-12
regression was established by this observation. This test does not claim
that the browser became signed out synchronously with the revocation API call.

## Cleanup

The disposable WorkOS user, empty app-user row, and mailbox were deleted and
verified absent. The hosted service role intentionally lacks DELETE on
app_users and SELECT on tags. Cleanup therefore verified tags through the
disposable user's own RLS-protected session, then used a guarded transaction
through the linked admin SQL connection to remove the one empty app-user row.
The linked project matched the app host. The transaction required its exact
WorkOS ID, excluded the protected owner, checked for zero transcripts/projects/
tags, and required exactly one deletion. No database permissions were changed.

Temporary credentials and test helper state were removed after cleanup. The
temporary production server was stopped, the provider-test tab was closed,
and the updated normal development server restored on port 3000.

The pre-existing changelog edit about the hosted tag migration was preserved.
It is separate from this SDK update. No automatic commit or push was made.

## Limits

- Google used cached credentials; fresh password, consent, and MFA were not rerun.
- Microsoft required a user-completed verification step; the exact credential
  method was not inspected. New consent, denial, and MFA coverage is not claimed.
- Live provider outages, replayed provider callbacks, deliberate concurrent
  account switching, and natural long-lived expiry were not rerun. Existing
  automated tests continue to cover their supported cases.
- Public hosted HTTPS/proxy/cookie behavior, Safari/mobile, new transcription
  jobs, and recording interruptions were not tested in this update.
- This SDK bump does not resolve the previously documented upstream Zod 3,
  glob/minimatch, or development-tool advisory chains.
