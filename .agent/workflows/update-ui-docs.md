---
description: Update UI Overhaul Documentation after completing a phase
---

This workflow guides you through updating the documentation suite in `.docs/UI Overhaul Documentation` when a project phase changes.

1.  **Identify Context**
    - Find or ask the user which phase was just completed (e.g., "Phase 2").
    - Find or ask the user which phase is starting next (e.g., "Phase 3").
    - Find or ask the user for a brief summary of:
        - Key deliverables completed.
        - Major decisions made (and reasoning).
        - Any "gotchas" or technical debt to note for the next phase.

2.  **Read Documentation Files**
    - Read `UIREFACTOR_README.md`.
    - Read `UIREFACTOR_PHASE_STATUS.md`.
    - Read `UIREFACTOR_PLAN.md`.

3.  **Update `UIREFACTOR_README.md`**
    - In the "Phase-Specific Context" section:
        - Mark the completed phase as `[x]`.

4.  **Update `UIREFACTOR_PHASE_STATUS.md`**
    - **Current Phase Table**: Update "Phase", "Status", and dates.
    - **Phase Progress Table**: Mark the completed phase as `✅ Complete` with today's date. Set the new phase to `🔄 In Progress` or `⏳ Not Started` as appropriate.
    - **Pending Decisions**: Clear any completed checklists for the finished phase.
    - **Phase Handoff Notes**: Fill in the section for the completed phase (e.g., `### Phase X → Phase Y`) with the deliverables, decisions, and gotchas gathered in Step 1.
    - **Key Decisions Log**: Add rows to the table for every significant decision made during the phase, including date, phase, decision, and reasoning.

5.  **Update `UIREFACTOR_PLAN.md`**
    - **Goals / Scope / Gaps**: Update if the phase revealed any changes to the high-level plan.
    - **Phased Execution Plan**: Mark all completed checklist items for the finished phase as `[x]`.
    - **Decisions Made**: (Optional) If this file maintains a separate decision log, update it to match `UIREFACTOR_PHASE_STATUS.md`.

6.  **Verify**
    - Review the changes to ensure all files are consistent.