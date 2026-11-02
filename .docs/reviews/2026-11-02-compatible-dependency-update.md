# Compatible dependency update — 2 November 2026

## Scope

The preceding security update was committed as `64bbab3` before this batch.
This batch updates 38 existing direct dependencies within their current major
versions and adds one explicit development dependency. Existing exact/caret
constraints are preserved, with their lower bounds updated to the tested
versions. No application logic, database migration, Docker image, local
Node runtime, or global tool version changed.

## Direct version changes

| Package | Before | After |
| --- | --- | --- |
| `@radix-ui/react-accordion` | 1.2.20 | 1.3.1 |
| `@radix-ui/react-alert-dialog` | 1.1.23 | 1.2.1 |
| `@radix-ui/react-dialog` | 1.1.23 | 1.3.1 |
| `@radix-ui/react-dropdown-menu` | 2.1.24 | 2.2.1 |
| `@radix-ui/react-label` | 2.1.15 | 2.1.17 |
| `@radix-ui/react-popover` | 1.1.23 | 1.3.1 |
| `@radix-ui/react-progress` | 1.1.16 | 1.2.1 |
| `@radix-ui/react-radio-group` | 1.4.7 | 1.5.1 |
| `@radix-ui/react-select` | 2.3.7 | 2.4.1 |
| `@radix-ui/react-separator` | 1.1.15 | 1.2.0 |
| `@radix-ui/react-switch` | 1.3.7 | 1.4.1 |
| `@radix-ui/react-tabs` | 1.1.21 | 1.2.1 |
| `@radix-ui/react-toast` | 1.2.23 | 1.3.1 |
| `@radix-ui/react-toggle` | 1.1.18 | 1.2.1 |
| `@radix-ui/react-tooltip` | 1.2.16 | 1.4.1 |
| `@supabase/supabase-js` | 2.112.3 | 2.118.0 |
| `@workos-inc/authkit-nextjs` | 4.5.0 | 4.6.2 |
| `docx` | 9.7.1 | 9.15.1 |
| `inngest` | 4.18.1 | 4.26.2 |
| `lucide-react` | 1.31.0 | 1.66.0 |
| `react` | 19.2.8 | 19.3.1 |
| `react-dom` | 19.2.8 | 19.3.1 |
| `react-virtuoso` | 4.18.11 | 4.18.20 |
| `tailwind-merge` | 3.5.0 | 3.7.0 |
| `@testing-library/dom` | 10.4.1 | 10.4.2 |
| `@testing-library/react` | 16.3.2 | 16.3.3 |
| `@testing-library/user-event` | 14.6.1 | 14.6.8 |
| `@types/node` | 26.2.0 | 26.6.6 |
| `@types/react` | 19.2.18 | 19.3.0 |
| `@types/react-dom` | 19.2.4 | 19.3.0 |
| `baseline-browser-mapping` | 2.11.14 | 2.11.34 |
| `fake-indexeddb` | 6.2.5 | 6.2.7 |
| `jest` | 30.4.2 | 30.5.2 |
| `jest-environment-jsdom` | 30.4.1 | 30.5.2 |
| `pg` | 8.23.0 | 8.23.1 |
| `postcss` | 8.5.26 | 8.5.32 |
| `tsx` | 4.23.13 | 4.23.15 |
| `typescript` | 6.0.2 | 6.0.3 |

## Export-test dependency correction

The first typecheck found `TS2307` for the existing direct `jszip` import in
`frontend/__tests__/exports.test.ts`. DOCX 9.15.1 uses fflate instead of JSZip,
so it no longer provides that transitive package. Added JSZip 3.10.2 explicitly
to `devDependencies`; the previous lockfile held JSZip 3.10.1 transitively.
The export tests continue to independently inspect the generated DOCX ZIP/XML.
Typecheck passed after the declaration was added.

## Deferred major upgrades

| Package | Installed | Latest major |
| --- | --- | --- |
| @workos-inc/node | 10.14.0 | 12.1.0 |
| iron-session | 8.0.4 | 9.0.1 |
| eslint | 9.39.5 | 10.14.0 |
| typescript | 6.0.3 | 7.0.2 |

The registry lists no newer WorkOS Node 10 release. TypeScript 6.0.3 is the
latest 6.x patch, compatible with the installed typescript-eslint range
`>=4.8.4 <6.1.0`. AuthKit 4.6.2 supports the retained WorkOS Node 10 SDK.
`npm outdated --json` lists only these four deliberately deferred majors.

## Validation

- `npm run test:ci`: passed in one full run, 226 suites / 2,935 tests /
  7 snapshots. Local networking was enabled for the auth outage mock server.
  Jest emitted signal-listener and delayed-exit warnings but exited with code 0.
- `npm run typecheck`: passed after declaring JSZip.
- `npm run lint`: passed, 0 errors / 58 warnings.
- `npm run build`: passed with Next.js 16.4.4 and Turbopack, including
  compilation, TypeScript, and static generation.
- `npm ls --depth=0`: passed after installation.
- Lockfile review confirmed that all 38 existing direct package updates
  stay within their prior major version and that the preceding transitive
  security fixes remain installed.
- `git diff --check`: passed.

## Production-browser checks

Started the production build on the configured localhost:3000 origin in an
isolated browser context, using the documented development account:

- Email/password sign-in completed through `/auth/finish`, and the library
  loaded existing project and transcript data.
- Opened the Capture dialog and its project picker. Escape closed the picker
  first and returned focus to its trigger; a second Escape closed Capture
  and returned focus to the capture button. No capture was started.
- Opened an existing transcript. Audio playback advanced beyond 11 seconds
  with `readyState=4` and no media error, then was paused.
- An authenticated request to the transcript DOCX export route returned
  HTTP 200, the Word document content type, and 17,651 bytes beginning with
  the expected ZIP signature `50 4b 03 04`. Unit tests also inspect DOCX XML.

No transcripts, tags, projects, or recordings were created, edited, or deleted.
The temporary production server was stopped and the normal updated development
frontend restored on port 3000.

## Audit results and limits

Affected package entries include inherited dependency chains and do not
represent independently exploitable flaws in every listed package.

| Scope | Before this batch | After |
| --- | --- | --- |
| All dependencies | 40: 0 critical, 3 high, 34 moderate, 3 low | 40: 0 critical, 3 high, 36 moderate, 1 low |
| Excluding dev dependencies | 7: 0 critical, 2 high, 5 moderate | 7: 0 critical, 2 high, 5 moderate |

The underlying advisory subjects remain Zod 3, glob, minimatch, and the
development-only deepmerge. The inherited development-tool entry severities
changed with Jest’s dependency tree. See the security-update report for the
upstream version constraints; this batch does not force incompatible overrides.

The configured hosted Supabase project still reports missing `tags` and
`transcript_tags` tables (`PGRST205`/404), as observed before this batch. Its
existing tag migration remains unapplied by this task. All observed browser
console errors during the production smoke check concerned that known gap.

The temporary local production server also warned that Inngest cloud mode
has no signing key in the existing environment. No new job/provider callback
was exercised there. The actual SDK auth outage contract and pipeline tests
passed; hosted configuration, live transcription recovery, OAuth provider
journeys, Safari/mobile, and database tag behavior were not reverified.

## Maintainer release references

- [React 19.3](https://react.dev/blog/2026/09/09/react-19-3)
- [Supabase JS 2.118.0](https://github.com/supabase/supabase-js/releases/tag/v2.118.0)
- [Inngest 4.26.2](https://github.com/inngest/inngest-js/releases/tag/inngest%404.26.2)
- [AuthKit releases](https://github.com/workos/authkit-nextjs/releases)
