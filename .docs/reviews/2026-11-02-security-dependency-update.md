# Security dependency update — 2 November 2026

## Changes

Only these installed direct package versions changed:

| Package | Before | After |
| --- | --- | --- |
| next | 16.3.1 | 16.4.4 |
| eslint-config-next | 16.3.1 | 16.4.4 |
| zod | 4.3.6 | 4.6.7 |

Next's matching SWC, environment, and ESLint packages changed with it. The
lockfile also refreshes compatible transitive security fixes:

| Package | Before | After |
| --- | --- | --- |
| sharp | 0.35.3 | 0.35.5 |
| @grpc/grpc-js | 1.14.4 | 1.14.7 |
| systeminformation | 5.33.1 | 5.33.19 |
| source-map-js | 1.2.1 | 1.2.2 |
| brace-expansion, 1.x copies | 1.1.18 | 1.1.21 |
| brace-expansion, 2.x copy | 2.1.4 | 2.1.7 |
| brace-expansion, 5.x copy | 5.0.9 | 5.0.12 |
| js-yaml, 3.x copy | 3.15.1 | 3.15.2 |
| js-yaml, 4.x copy | 4.3.1 | 4.3.2 |

Sharp's native packages/libvips changed with Sharp; fastq moved from 1.20.1
to 1.20.3 during the transitive refresh. No dependency overrides, forced
upgrades, or changes to application logic were needed. React, WorkOS,
Supabase, Inngest, Jest, ESLint, and TypeScript direct versions were preserved.

## Audit results

These are npm's affected package-entry counts, including inherited advisory
chains; they do not count distinct independently exploitable vulnerabilities.

| Scope | Before | After |
| --- | --- | --- |
| All dependencies | 47: 1 critical, 9 high, 34 moderate, 3 low | 40: 0 critical, 3 high, 34 moderate, 3 low |
| Excluding dev dependencies | 13: 1 critical, 7 high, 5 moderate | 7: 0 critical, 2 high, 5 moderate, 0 low |

The remaining production entries represent two underlying advisory paths:

- `inngest@4.18.1 → zod@3.25.76`: the Zod advisory lists versions below
  4.6.6 as affected. Inngest requires `^3.25.0`. Registry metadata for the
  newer Inngest 4.26.2 still requires that range, and 3.25.76 is the latest
  published Zod 3 release. Updating the app's Zod does not replace this copy.
  Replacing it with Zod 4 would violate the SDK's dependency range.
- `inngest → @opentelemetry/auto-instrumentations-node →
  @opentelemetry/resource-detector-gcp → gcp-metadata → gaxios → rimraf →
  glob → minimatch`: gaxios 7.1.3 requires rimraf 5, and rimraf 5.0.10
  requires glob 10. The advisory fixes require glob >=14.0.2 and
  minimatch >=11.0.1, outside the installed parents' supported ranges.
  Even the current rimraf release's queried metadata requires glob 13.

Development tooling also retains glob/minimatch and deepmerge advisory
chains. Jest 30.5.2's metadata still requires glob 13 and deepmerge 4.3.1;
deepmerge 4.3.1 is the current published release. ESLint 9.39.5 and several
Next lint plugins require minimatch 3. A blanket override would cross major
API changes, especially minimatch's function export used by older consumers.

`npm audit fix --force` was not used: its suggestions include downgrading
Jest to 25.1.0, ESLint to 4.0.0, and Inngest to 0.3.0. The residual
advisories need upstream fixes or a separately reviewed migration, rather
than treating an empty audit as a reason to install incompatible versions.

## Validation

- `npm run typecheck`: passed.
- `npm run lint`: passed, 0 errors / 58 warnings.
- `npm run test:ci`: 225 suites and 2,927 tests passed, with 7 snapshots;
  the auth outage suite could not start its local HTTP mock because the
  sandbox denied `listen(127.0.0.1)` with `EPERM`.
- `npm run test:ci -- --runTestsByPath __tests__/authkitOutageContract.test.ts`
  outside the sandbox: passed, 1 suite / 8 tests. Combined: all 226 suites /
  2,935 tests passed. No tests were skipped to work around the restriction.
- `npm run build`: passed outside the sandbox with Next.js 16.4.4 and
  Turbopack, including compilation, TypeScript, and static generation.
  The initial sandboxed build stalled and was stopped before retrying.
- Sharp 0.35.5 created and encoded a small PNG successfully.
- `npm ls --depth=0`: passed; `git diff --check`: passed.
- The production server started successfully on temporary port 3001 and
  rendered sign-in. Its configured auth origin points to localhost:3000,
  so the complete sign-in journey was checked there after restarting the
  existing frontend, which still had Next.js 16.3.1 loaded.
- In an isolated browser context on the updated localhost:3000 frontend:
  email/password sign-in, session completion, library loading, opening an
  existing transcript, and audio playback passed. Playback advanced beyond
  12 seconds with no media error and was then paused. No transcript edits,
  recording, deletion, or new transcription was performed.

## Environment limits and follow-up

The browser uses the Supabase project configured by the existing local
environment. That hosted project returns `PGRST205`, reporting that
`public.tags` is absent from its schema cache; requests for `tags` and
`transcript_tags` return 404. Other library data and transcript playback
load successfully. The repository already contains the corresponding
`infra/supabase/migrations/20261101000000_transcript_tags.sql` migration,
and its changelog entry records that hosted application is pending. No
database migration or environment change was made during this dependency
update. Tag behavior therefore remains unverified against that project.

The temporary production server was stopped, and the updated development
frontend remains available on port 3000. Docker images, Supabase services,
local Node.js 24.12.0, and globally installed tools were not upgraded.
Hosted deployment, provider callbacks, new transcription processing, and
Safari/mobile browser behavior were not exercised.

## Advisory references

- [Next.js October security release](https://nextjs.org/blog/nextjs-security-update-october-14-2026)
- [Zod memory exhaustion](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)
- [Glob cancellation bypass](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4)
- [Minimatch pattern amplification](https://github.com/advisories/GHSA-g3hv-75wg-m249)
- [Deepmerge prototype poisoning](https://github.com/advisories/GHSA-gcqx-w48m-w2h4)
