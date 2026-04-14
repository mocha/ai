---
name: validate-project
description: Validates a completed project against its acceptance criteria. Triggered when the engineering manager sends a project-complete message. Evaluates whether all criteria are met, updates project status, and sends the result to either PM (validated) or EM (revise).
---

# Validate Project

Validates completed engineering work against project acceptance criteria and routes the result to the appropriate agent.

## Usage

`/validate-project` — triggered by a `project-complete` message in the inbox.

## Workflow

### 1. Read the message

Read the `project-complete` message to extract:
- The project ID (PRJ-NNN)
- The EM's aggregate validation summary (referenced in the message)
- Any notes, concerns, or deviations reported by the EM
- The parent proposal ID

### 2. Read the project file

Read the project file from `docs/projects/` and extract every acceptance criterion. These are the standard — each one is pass/fail.

### 3. Review the EM's aggregate validation

Read the referenced validation summary. The EM has already checked task-level criteria. Your job is to verify at the project level:
- Does the EM's summary claim all project criteria are met?
- Are there any caveats, partial completions, or noted deviations?

### 4. Evaluate acceptance criteria

For each project acceptance criterion:
- **Met:** The EM's evidence clearly demonstrates this criterion is satisfied.
- **Partially met:** Evidence exists but is incomplete or has caveats.
- **Not met:** No evidence, or evidence contradicts the criterion.

Build a scorecard:
```
Criterion 1: MET — [brief evidence]
Criterion 2: MET — [brief evidence]
Criterion 3: NOT MET — [what's missing]
```

### 5. Check the spirit, not just the letter

If all criteria technically pass but the proposal's intent clearly is not achieved, flag it. The criteria may have been underspecified — that is a signal to improve criteria definition for future projects, and also a reason to send the work back.

Read the parent proposal's success criteria to verify alignment. The project should meaningfully advance the proposal's goals, not just check boxes.

### 6a. If all criteria are met — validate

1. **Update project status** to `completed` in the project file frontmatter. Update the `updated` date.

2. **Send project-validated message** to `docs/inbox/product-manager/unread/`:
   - `type`: project-validated (use as the step in the filename)
   - `from`: program-manager
   - `to`: product-manager
   - `disposition`: approved
   - `proposal`: The parent PMD-NNN ID
   - `project`: PRJ-NNN
   - `references`: Path to the project file
   - `urgency`: normal
   - `reason`: Project PRJ-NNN validated — all acceptance criteria met

   **Summary:** What was achieved, which proposal this advances, and any notable observations.
   **Detail:** The full scorecard showing each criterion and its evidence.

3. **Check proposal progress.** If all projects in the proposal are now completed, note this in the message to the PM. Do NOT update the proposal status — that is the PM's authority.

4. **Advance unblocked projects.** After validating a project, check if any other approved projects in the same proposal are now unblocked (their `depends_on` projects are all completed). For each newly unblocked project, immediately send a `project-ready` message to the EM's inbox. Do NOT wait for PM acknowledgment — the projects are already approved. Completing a dependency automatically unblocks the next project in the sequence.

### 6b. If criteria are not met — send back to EM

1. **Send revise message** to `docs/inbox/engineering-manager/unread/`:
   - `type`: feedback
   - `from`: program-manager
   - `to`: engineering-manager
   - `disposition`: revise
   - `project`: PRJ-NNN
   - `references`: Path to the project file
   - `urgency`: normal
   - `reason`: Project PRJ-NNN validation failed — N criteria not met

   **Summary:** Which criteria failed and the overall gap assessment.
   **Detail:** For each failed criterion: what was expected, what was delivered (or not), and what needs to change. Be specific — the EM needs to translate this into corrective tasks.

2. **Do NOT update project status.** It remains `in-progress` until validation passes.

### 7. Move original message to read/

Move the `project-complete` message from `docs/inbox/program-manager/unread/` to `docs/inbox/program-manager/read/`.

### 8. Commit

```
git add docs/projects/ docs/inbox/
git commit -m "validate-project: PRJ-NNN <validated|revise>"
```

## What this skill does NOT do

- Does not run tests or verify code — the EM handles implementation validation
- Does not create corrective tasks — the EM decomposes revise feedback into tasks
- Does not update proposal status — that belongs to the PM
- Does not negotiate — if the EM disagrees with the validation result, it flows through normal revision cycles
