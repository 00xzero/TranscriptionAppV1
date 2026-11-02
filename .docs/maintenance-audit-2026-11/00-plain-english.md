# Maintenance audit — plain English

A product-level reading of the November 2026 maintenance audit of `main` @ `b57889b`. The engineering detail, with evidence for every point, is in [README.md](README.md) and the eight domain reports beside it. Codes such as `recording-1` refer to findings in those reports.

## The short version

The app is in good shape where it matters most. The parts that protect people's recordings and edits are careful and well tested, and all 2,935 automated tests pass. Three things need attention before real users arrive.

- **Nothing is watching for problems.** No checks run automatically when the code changes, and when something breaks for a user, nobody is told.
- **It was built with small accounts in mind.** Recordings several hours long, and people with hundreds of transcripts, will make parts of the app slow. A few long-recording cases fail outright.
- **Recovering from a failure is weaker than the normal path.** If the network drops or an outside service is slow at the wrong moment, a few flows end at a dead end.

> Nothing is on fire. There are no users yet, so nobody is affected today. This is a list of what to fix before launch, ordered by how much each item would hurt.

## How each part of the app is doing

### Sign-in and accounts — Good

*Signing in, staying signed in, and keeping accounts separate when someone switches account in another tab.*

Solid and well tested. One edge case: when you sign out in one tab, your other tabs are meant to pause and let you copy any unsaved text. Sometimes the sign-in system sends that tab to the login page first, and the unsaved text is lost.

### Transcription — Needs attention

*Everything after the audio is uploaded: sending it to Deepgram, Soniox or AssemblyAI, getting the text back, and saving it.*

Very carefully built, with one serious gap. Recordings longer than about 2½ hours always fail on Deepgram, our default service. We still pay Deepgram, and the user only sees “timed out”. There is also a rare case where a retry can save a finished transcript again from scratch and wipe the user's edits.

### Recording and upload — Needs attention

*Recording in the browser, uploading files, and getting a recording back after the browser crashes.*

Getting a recording back after a browser crash works well. The weak spot is a failed upload: pressing Retry can fail every time, and the only other button deletes the recording. Very long recordings are also held in the browser's memory, which can crash the tab on phones and iPads.

### Editor — Will get slow

*Where people read, correct and play back a transcript.*

Edits are very well protected against loss. But the page redraws far more than it needs to. On a transcript a few hours long, typing and playback will lag, and Replace All can freeze the page for several seconds.

### Database — Solid but hard to change

*Where everything is stored, and the rules for who can see what.*

The security rules are sound. But the database's setup is spread over 45 separate change files, so every future change carries more risk than it should. One rule also makes opening any transcript slower the more transcripts the person has in total.

### Library, projects, people and tags — Will get slow

*The lists and tools people use to organise their transcripts.*

Fine with dozens of transcripts. With hundreds or thousands, these pages will load slowly and feel sluggish. The app loads and draws every item at once, and reloads every tag each time you come back to the tab.

### App frame, design and exports — Needs a safety net

*Navigation, page layout, shared buttons and dialogs, and Word and subtitle exports.*

If a page crashes, nobody finds out. On most pages the crash also takes down the whole app frame, including the protection around a recording in progress. Some grey text is too faint to meet accessibility standards. Exports cope well with long transcripts.

### Engineering setup — Missing the basics

*The tooling around the code: automatic checks, outside libraries, scripts and documentation.*

The code is tidy and the tests are thorough, but nothing runs those tests automatically when the code changes. A security update for Next.js, the framework the app is built on, has been available for a while without anyone noticing.

## Six problems that show up everywhere

### Nobody is watching

There are no automatic checks when the code changes, no crash reports from people's browsers, and no alerts about security updates. Problems are found only if someone happens to look.

**Fixing it:** Set up the standard safety net: automatic checks on every change, crash reporting and security alerts. That's a few days of work, and it protects everything that comes after it.

### Built for a small account

Most screens load everything at once and draw everything at once. That's fine for a test account. It slows down with hundreds of transcripts, or with one transcript several hours long.

**Fixing it:** Load items in batches and only draw what's on screen. One shared approach fixes the library, tags, people and the editor.

### The screen redraws too often

Some screens repaint far more than they need to. During playback the editor repaints every visible paragraph ten times a second. The recording dialog repaints the whole dialog on every tick of the microphone meter.

**Fixing it:** Only update the part of the screen that changed. The app already does this in one place, the highlighted word during playback, so the pattern already exists in the code.

### Long recordings haven't been tested end to end

Several separate limits kick in for long recordings. Deepgram fails above about 2½ hours. Soniox turns down files over 5 hours, but only after they've been uploaded. The system also stops waiting after 45 minutes, even for a 10-hour file.

**Fixing it:** Test 1, 3, 5 and 10-hour recordings on every service, publish the real limits, and warn people before a recording runs past them.

### Recovering from failures is the weak spot

When everything goes right, the app is very reliable. When something fails partway through, such as a network drop or a slow service, several flows end at a dead end or show a confusing technical error.

**Fixing it:** Walk through every “what if it fails here?” moment and make sure there's always a clear way forward that never loses the user's work.

### The code's internal organisation has drifted

The codebase has rules about which code goes where. Nothing enforces them, and some have been broken. A few parts are also more complicated than an app at this stage needs.

**Fixing it:** Move the misplaced code, add automatic rule checks so it stays tidy, and simplify the over-built parts. Every future feature then gets cheaper to build.

## The ten things to fix first

1. **Turn on automatic checks**
   - What a user notices: Nothing directly. It stops broken changes from going out, and catches security problems early.
   - How often: Protects every future release.
   - Size of the fix: 1–2 days
   - Engineering refs: `platform-1`, `platform-4`
2. **Install the Next.js security update**
   - What a user notices: Nothing. It closes known security holes in the framework, including one that could let someone overload sign-in.
   - How often: One-off.
   - Size of the fix: Under half a day
   - Engineering refs: `platform-2`
3. **Fix the Retry button on failed uploads**
   - What a user notices: On a patchy connection, Retry fails over and over, and the only way out deletes the recording.
   - How often: Uncommon, but the recording is lost when it happens.
   - Size of the fix: Under half a day
   - Engineering refs: `recording-1`
4. **Set and enforce limits for long recordings**
   - What a user notices: A Deepgram recording over about 2½ hours fails with “timed out”, and we're charged for it. A Soniox recording over 5 hours fails after uploading.
   - How often: Every time, at those lengths.
   - Size of the fix: Under half a day for the limits
   - Engineering refs: `pipeline-1`, `recording-4`
5. **Stop a rare re-save from wiping edits**
   - What a user notices: A finished transcript the person has already edited suddenly goes back to the original text.
   - How often: Rare. It needs a retry at an unlucky moment.
   - Size of the fix: Under half a day
   - Engineering refs: `pipeline-3`
6. **Add crash reporting and keep crashes contained**
   - What a user notices: A crash on one page can blank the whole app and switch off the protection around a recording in progress. Today we would never hear about it.
   - How often: Whenever any page has a bug.
   - Size of the fix: About a day
   - Engineering refs: `shell-1`, `shell-2`
7. **Make the editor fast on long transcripts**
   - What a user notices: Typing lags and Replace All freezes on transcripts several hours long.
   - How often: Every long transcript.
   - Size of the fix: 1–3 days
   - Engineering refs: `editor-1`, `editor-2`, `editor-3`
8. **Keep transcripts quick to open as libraries grow**
   - What a user notices: Opening any transcript gets slower the more transcripts someone has.
   - How often: Grows with every transcript added.
   - Size of the fix: 2–3 days, after the database clean-up
   - Engineering refs: `data-1`
9. **Keep lists and tags fast for big libraries**
   - What a user notices: The library, tags and people pages get slow with hundreds of items.
   - How often: Heavy users.
   - Size of the fix: 2–3 days
   - Engineering refs: `organise-1`, `organise-2`
10. **Protect unsaved typing when signing out in another tab**
   - What a user notices: Unsaved text in a background tab can be lost when you sign out somewhere else.
   - How often: Rare.
   - Size of the fix: 1–2 days
   - Engineering refs: `auth-1`

## Five decisions for you

### Remove the “too many attempts” limiter?

The app has a limiter meant to stop people hammering sign-in and transcription. On our hosting it barely works, because each server keeps its own separate count.

**Suggestion:** Remove it. Use the hosting provider's built-in protection for sign-in, and add a per-person cap on transcriptions kept in the database, which also caps cost.

### Start the database from a clean slate?

The database is defined by 45 step-by-step change files written over four months. With no users yet, these can be merged into one clean starting point that's easy to read.

**Suggestion:** Yes, and do it before any other database change.

### What should happen to long Deepgram recordings?

For long recordings, Deepgram's results are too big for our hosting to receive. We can either cap Deepgram at about 2 hours and send longer recordings to AssemblyAI, which handles up to 10 hours, or move that one piece to different hosting.

**Suggestion:** Cap Deepgram and send longer recordings to AssemblyAI for now. Revisit if Deepgram's quality matters for long files.

### Keep the test login in the project files?

The test account's email and password are written in two files stored with the code.

**Suggestion:** That's fine if the code repository is private and the account is only used for testing. Otherwise move them out and change the password.

### Which crash-reporting service?

We need a service that tells us when the app breaks for someone.

**Suggestion:** Sentry is the usual choice, unless you already use another one.

## What to do, and roughly how long

**First, about one working week**

1. **Safety net** (2–3 days). Automatic checks, the security update, crash reporting.
2. **Quick fixes** (About 2 days). The Retry button, long-recording limits, the edit-wipe guard, and about ten small tidy-ups.

**Then, one at a time**

1. **Database clean slate.** Merge the 45 change files into one, and add automatic tests that run against a real database.
2. **Big accounts.** Make every list, tag and transcript fast with hundreds or thousands of items.
3. **Long recordings.** Test real 1–10 hour files on every service and set clear limits.
4. **Screen speed.** Stop the unnecessary redrawing in the editor, recording dialog and lists.
5. **Failure recovery.** Every “what if it fails here?” path ends somewhere safe.
6. **Tidy-up and simplification.** Enforce where code lives, and simplify the over-built parts.

Each of the six later pieces is roughly 3–5 days of focused work. These are rough estimates.

## Glossary

| Term | Meaning |
|---|---|
| P1 / P2 / P3 | How soon it matters. P1 will hurt soon, P2 is worth scheduling, P3 is nice to have. |
| Scores 1–5 | A reviewer's judgement for that area. 2 is weak, 3 adequate, 4 strong. |
| CI | Continuous integration: checks that run automatically every time the code changes. |
| Advisory | A published warning about a security problem in an outside library we use. |
| RLS | Row-level security: rules inside the database that decide which records each person can see. |
| Migration | A file that changes the database's structure. They run one after another, in order. |
| RPC / database function | A small program that runs inside the database, so the database itself enforces the rule. |
| Idempotent | Safe to repeat. Doing it twice has the same effect as doing it once, so a retry can't create duplicates. |
| Pagination | Loading a long list in batches instead of all at once. |
| Virtualisation | Only drawing the items currently on screen. |
| Re-render | The browser redrawing part of the page. |
| Webhook / callback | The message a service like Deepgram sends us when it has finished a job. |
| Inngest | The service that runs our background jobs, such as the steps of a transcription. |
