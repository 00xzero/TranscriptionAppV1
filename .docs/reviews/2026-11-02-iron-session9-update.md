# iron-session 9 update — 2 November 2026

## Change

The preceding WorkOS Node 12 update was committed as `06e880e`.
The app's direct iron-session dependency now moves from 8.0.4 to 9.0.1.
Its dependency chain uses cookie 2.0.1, iron-webcrypto 2.0.0, and
uint8array-extras 1.6.0. The repository's Node 24 requirement satisfies
iron-session 9's Node >=22.13.0 requirement.

AuthKit 4.6.2 still declares iron-session 8, so npm retains its own nested
8.0.4 installation with cookie 0.7.2 and iron-webcrypto 1.2.1. There are no
overrides. Application auth code, environment files, database schema, and
permissions are unchanged.

The updated packages use ESM. Jest now adjusts the resolved next/jest
transform-ignore patterns to transform these sealing packages while
preserving Next's other defaults. Two existing tamper tests altered the
unsigned `~version` suffix; they now alter the authenticated MAC. A new test
checks that changing that marker cannot reinterpret the authenticated attempt.
The real installed-library contract probe checks both existing v8 seals read
by v9 and v9 seals read by v8 for rollback compatibility, using the app's
plain JSON attempt shape. This is not a guarantee for arbitrary serialized
objects or historical formats the app does not use.

## Automated validation

| Check | Result |
| --- | --- |
| Final full Jest run (`npm run test:ci`) | 226 suites, 2,939 tests, 7 snapshots passed |
| Typecheck | Passed |
| Full lint | 0 errors, 58 existing warnings |
| Callback test lint after its final adjustment | Passed |
| Production build | Passed |
| Installed dependency tree | Valid; direct v9 and AuthKit's nested v8 retained |
| Diff whitespace checks | Passed |
| Full npm audit | Unchanged: 0 critical, 3 high, 36 moderate, 1 low affected package entries |
| Production-only npm audit | Unchanged: 0 critical, 2 high, 5 moderate affected package entries |

The first full test run exposed the second old version-suffix tamper assertion
in the callback test. Correcting it to corrupt the MAC produced the final
passing run above. The production build preceded this final test-only edit;
final typecheck, callback lint, and the full suite cover that edit. No
application source changed after the build. The suite retains its existing
signal-listener/delayed-exit warnings and exited successfully.

The installed AuthKit outage/refresh contract still covers unreachable signing
keys, transient refresh failure, refused refresh, invalid JWT, unreadable
cookie, wrong sealing password, and successful refresh, along with SDK 12
timestamp revival. Outages retain the cookie; terminal failures in the proxy
contract clear it.

## Live auth results

Tests used the updated production build on localhost:3000, WorkOS staging,
and the configured hosted Supabase project. The staging key was checked
without printing it. Inngest development mode was set only on the temporary
production server process. A disposable mailbox was created through
[Mail.tm](https://mail.tm/); no protected account password was changed.

| Flow | Observed result |
| --- | --- |
| Existing session | Regular-profile pre-upgrade session opened the protected library |
| Signup | Disposable account created through the app |
| Verification | Actual email delivered; invalid and superseded codes rejected; latest code succeeded |
| Destination | Signup preserved the requested projects destination through /auth/finish |
| Account isolation | Disposable account had an empty library |
| Wrong password | Inline mismatch; form remained usable |
| Reset delivery | Neutral forgot-password response and actual reset email |
| Weak reset password | Strength feedback; link remained usable |
| Successful reset | New password saved and automatic sign-in succeeded |
| Used link | Replay rejected as expired/already used |
| Password replacement | Old password rejected and new password signed in, including a fresh browser context after the test session resumed |
| Active refresh | Built AuthKit refresh server action returned HTTP 200 and the expected user; subsequent navigation retained sign-in |
| Sign-out | Returned to auth and protected navigation required sign-in |
| Google | Approved cached identity returned to requested people destination; account email matched |
| Microsoft | Approved cached identity returned to requested projects destination; account email matched |
| Protected account | Original account signed in again and its populated library loaded |

Initial verification email delivery was delayed and messages arrived out of
order. The latest code succeeded; an older resend code was rejected. No
application defect was established. No browser warnings/errors were recorded
after successful disposable sign-in.

The refresh check invoked the built same-origin AuthKit refresh server action,
without adding an application route or printing/saving access tokens. It did
not wait for natural JWT expiry. Google and Microsoft used cached provider
credentials in this run; neither required a new password, consent, or MFA.

## Cleanup and data safeguards

The protected account's starting hosted snapshot contained 68 transcript
ID/owner rows. Its WorkOS ID, app-user ID, count, and SHA-256 hash of those
sorted rows matched after testing and cleanup. This verifies transcript IDs
and ownership, not a complete content/storage backup.

Cleanup checked the exact disposable WorkOS identity and verified zero owned
transcripts, projects, and tags through its own RLS-protected session. The
linked project matched the configured app host. A guarded admin SQL transaction
removed exactly its empty app-user row, excluded the protected owner, and
checked emptiness again. This avoids changing the service role's deliberately
restricted permissions. The disposable WorkOS identity and mailbox were then
deleted and verified. Provider accounts were retained.

Temporary credential/helper files were removed. Test browser tabs were closed,
the original regular-profile account was restored, and the normal development
server resumed on port 3000 after stopping the temporary production server.
The unrelated existing changelog edit about the hosted tag migration remains
preserved. This iron-session batch is uncommitted; no push was made.

## Limits

- Fresh Google/Microsoft password, consent, denial, and MFA were not rerun.
- Live outages, concurrent account switching, replayed provider callbacks,
  and natural long-lived expiry were not rerun; existing automated coverage
  remains in place.
- The previously documented JWT revocation/renewal limitation is unchanged;
  immediate global revocation is not claimed or retested here.
- Public HTTPS/proxy behavior, Safari/mobile, recording interruptions, and
  new transcription jobs were not tested.
- Existing upstream advisory chains remain; this bump does not resolve them.
