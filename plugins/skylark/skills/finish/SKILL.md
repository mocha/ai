---
name: finish
description: Use when implementation is complete, all tests pass, and you need to decide how to integrate the work. Guides completion by verifying tests, presenting structured options (merge/PR/keep/discard), updating Linear, writing session notes, checking architecture docs, cleaning up worktrees, and recommending next work. The closing ceremony that ensures nothing is left dangling.
---

# Finishing Development Work

Guide completion of development work by presenting clear options and handling the chosen workflow, then closing the loop on Linear, documentation, and cleanup.

**Core principle:** Verify tests → Verify ACs → Present options → Execute choice → Linear → Session notes → Architecture check → Clean up → Recommend next.

**Announce at start:** "I'm using the finish skill to complete this work."

## When to Use

- After `/skylark:implement` completes all tasks
- After any chunky development work, even outside the pipeline
- When you're done with a branch and need to clean up
- User says "finish up", "wrap this", "close this out"

**Called by:**
- `/skylark:implement` — after all develop tasks complete
- User directly — for work done outside the pipeline

## The Process

### Step 1: Verify Tests

**Before anything else, verify tests pass:**

```bash
# Run project's test suite
pnpm test  # or whatever the sub-repo CLAUDE.md specifies
```

**If tests fail:**
```
Tests failing (N failures). Must fix before completing:

[Show failures]

Cannot proceed with merge/PR until tests pass.
```

Stop. Don't proceed to Step 2.

**If tests pass:** Continue to Step 2.

### Step 2: Verify Acceptance Criteria

Walk each AC from the issue or spec against the implementation:
- **Met** — AC is satisfied, point to the code/test that proves it
- **Deviated** — implemented differently than specified, document why
- **Not met** — AC was not addressed, flag it

If any ACs are not met, surface to the user before proceeding. The user decides whether to address them now or proceed with partial completion.

### Step 3: Determine Base Branch

```bash
# Try common base branches
git merge-base HEAD main 2>/dev/null || git merge-base HEAD master 2>/dev/null
```

Or ask: "This branch split from main — is that correct?"

### Step 4: Present Options

Present exactly these 4 options. **Don't add explanation** — keep options concise.

```
Implementation complete. All tests pass. What would you like to do?

1. Merge back to <base-branch> locally
2. Push and create a Pull Request
3. Keep the branch as-is (I'll handle it later)
4. Discard this work

Which option?
```

### Step 5: Execute Choice

#### Option 1: Merge Locally

```bash
# Switch to base branch
git checkout <base-branch>

# Pull latest
git pull

# Merge feature branch
git merge <feature-branch>

# Verify tests on merged result
pnpm test

# If tests pass
git branch -d <feature-branch>
```

Then: Cleanup worktree (Step 9)

#### Option 2: Push and Create PR

```bash
# Push branch
git push -u origin <feature-branch>

# Create PR
gh pr create --title "<title>" --body "$(cat <<'EOF'
## Summary
- [bullet points from AC verification in Step 2]

## Test plan
- [verification steps]

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

Then: Cleanup worktree (Step 9) — **but keep the branch** since PR is open.

#### Option 3: Keep As-Is

Report: "Keeping branch `<name>`. Worktree preserved at `<path>`."

**Don't cleanup worktree.** Skip to Step 6 (Linear).

#### Option 4: Discard

**Confirm first — show what will be lost:**
```
This will permanently delete:
- Branch: <name>
- Commits: <commit list with messages>
- Worktree: <path>

Type 'discard' to confirm.
```

Wait for exact typed confirmation.

If confirmed:
```bash
git checkout <base-branch>
git branch -D <feature-branch>
```

Then: Cleanup worktree (Step 9)

### Step 6: Update Linear

If a Linear issue is associated:
- Move issue to **Done** (Options 1, 2) or leave as-is (Options 3, 4)
- Post closing comment:
  ```
  [FINISH] Complete.
  PR: [link] (if Option 2)
  Merged: locally (if Option 1)
  Kept: branch [name] (if Option 3)
  Discarded (if Option 4)

  ACs: [met/deviated/not-met summary]
  Deviations: [brief notes on any deviations from plan]
  ```
- Comment on related/blocked issues with relevant context:
  ```
  [CONTEXT] ENG-XXX is now complete.
  Relevant for this issue: [brief note about what changed or gotchas]
  ```

### Step 7: Write Session Notes

For standard+ risk work, create `docs/notes/YYYY-MM-DD-<slug>.md`:

```yaml
---
title: Session Notes — [issue/feature title]
type: notes
issue: ENG-XXX
parent: docs/specs/... or issue ID
created: YYYY-MM-DD
---
```

Body:
- **What shipped** — brief summary
- **Decisions that deviated from plan** — why and what changed
- **Codebase discoveries** — things learned that aren't obvious from the code
- **Deferred questions** — things punted for later
- **Process observations** — what worked well, what was friction

Skip session notes for trivial work unless something surprising was discovered.

### Step 8: Check Architecture Docs

For elevated+ risk:
- Check if the project's architecture docs need updates (new services, changed data flows, new integrations)
- Check if CLAUDE.md conventions need updating
- Check for stale references in architecture specs that this work invalidated

For critical risk, this check is **mandatory** — do not skip.

### Step 9: Cleanup Worktree

**For Options 1, 4:** Remove worktree and branch.
**For Option 2:** Remove worktree, keep branch (PR is open).
**For Option 3:** Keep everything.

```bash
# Check if in worktree
git worktree list | grep $(git branch --show-current)

# If yes (and not Option 3):
git worktree remove <worktree-path>
```

After cleanup:
```bash
git checkout main  # or base branch
git pull
git status  # Verify clean tree
```

### Step 10: Recommend Next

Suggest 1-2 candidates for next work:
- Issues newly unblocked by this completion (check blocking relations in Linear)
- Same-project siblings (other tasks in the same plan)
- Backlog top (highest priority unstarted issue)

## Quick Reference

| Option | Merge | Push | PR | Keep Worktree | Delete Branch | Linear Status |
|--------|-------|------|----|--------------|---------------|---------------|
| 1. Merge locally | yes | no | no | no | yes (safe) | Done |
| 2. Create PR | no | yes | yes | no | no | Done |
| 3. Keep as-is | no | no | no | yes | no | In Progress |
| 4. Discard | no | no | no | no | yes (force) | — |

## Common Mistakes

**Skipping test verification**
- **Problem:** Merge broken code, create failing PR
- **Fix:** Always verify tests before offering options

**Open-ended questions**
- **Problem:** "What should I do next?" — ambiguous, wastes a turn
- **Fix:** Present exactly 4 structured options, no explanation

**Automatic worktree cleanup**
- **Problem:** Remove worktree when user might need it (Option 3)
- **Fix:** Only cleanup for Options 1, 2, and 4. Option 3 keeps everything.

**No confirmation for discard**
- **Problem:** Accidentally delete work
- **Fix:** Require typed "discard" confirmation, show exactly what will be lost

**Skipping Linear updates**
- **Problem:** Issue left in wrong state, blocked issues never notified
- **Fix:** Always update Linear status and comment on related issues

**Skipping session notes**
- **Problem:** Decisions and discoveries lost across session boundaries
- **Fix:** Always write notes for standard+ risk work

## Red Flags

**Never:**
- Proceed with failing tests
- Merge without verifying tests on the merged result
- Delete work without typed confirmation showing what will be lost
- Force-push without explicit user request
- Skip Linear updates when an issue exists
- Skip session notes for elevated+ work

**Always:**
- Verify tests before offering options
- Present exactly 4 options, concisely
- Get typed confirmation for Option 4
- Clean up worktree appropriately per option
- Post Linear closing comment with AC summary
- Recommend next work
