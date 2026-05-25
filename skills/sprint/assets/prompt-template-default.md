You are implementing Kanban card {CARD_ID} for {PROJECT_NAME}.

## Your mission
Read the full specification at `docs/kanban/cards/{CARD_ID}.md`.

## Workflow

There is **one** approval gate: after you present the plan in step 2.
Once the user approves, run every step from 3 through 10 in sequence
**without asking for further confirmation** — do not stop to ask
"should I commit?", "should I push?", "ready for the PR?", or "what
next?". Execute the full workflow until the Sprint Summary is printed.
Step 11 (E2E testing) is the only step that requires asking the user.

1. Enter plan mode -- analyze the card scope, touch points, and acceptance criteria
2. Present your implementation plan for approval **(approval gate)**
3. After approval, implement the changes
4. Run the Verification section from the card (browser dev mode + manual steps)
5. Run tests: `{TEST_COMMAND}`
6. Commit with: `feat({LOWER_CARD_ID}): {one-line summary}`
7. Push the branch: `git push -u origin {BRANCH}`
8. Create a Pull Request (see PR section below)
9. Update the board to IN REVIEW (see Board Update section below)
10. Print the Sprint Summary (see Sprint Summary section below)
11. Offer E2E testing (see E2E Testing section below) — the only step where you ask the user

## Ports
This worktree uses custom ports to avoid conflicts with other sprints:
- Backend: port {BACKEND_PORT}
- Frontend: port {FRONTEND_PORT}

## PR creation

After pushing, create a PR using `gh`:

1. Check if a PR already exists for this branch:
   ```bash
   gh pr list --head {BRANCH} --state open --json number --jq '.[0].number'
   ```
   If a PR already exists, skip creation and print the existing PR URL.

2. Extract the **Summary** and **Acceptance criteria** sections from `docs/kanban/cards/{CARD_ID}.md` to build the PR body.

3. Create the PR:
   ```bash
   gh pr create --base {MAIN_BRANCH} --head {BRANCH} \
     --title "feat({LOWER_CARD_ID}): {one-line summary}" \
     --body "$(cat <<'EOF'
   ## Summary
   {bullet points from card summary}

   ## Test plan
   {acceptance criteria from card as checklist}

   ---
   Kanban card: `{CARD_ID}`
   EOF
   )"
   ```

4. If `gh` is not available or the command fails, print the push result and tell the user to create the PR manually. Do not fail the entire workflow.

## Board Update

After the PR is created (or after push if PR creation was skipped):

1. Move the card to IN REVIEW via CLI:
   ```bash
   npx tsx docs/kanban/cli/kanban.ts move {CARD_ID} in-review --json
   ```
   Verify `ok === true` in the response.

2. If `docs/kanban/cards/{CARD_ID}.md` exists, update the status:
   - Replace `**Status**: IN PROGRESS` with `**Status**: IN REVIEW`

3. Commit and push the board change:
   ```bash
   git add docs/kanban/board.json docs/kanban/cards/{CARD_ID}.md
   git commit -m "kanban: review {CARD_ID}"
   git push
   ```

4. If the board update fails, warn the user but do not fail the workflow. The implementation and PR are already done.

## Sprint Summary

After all steps are complete, print a clear summary so the user can understand what happened at a glance (especially if they come back to this terminal later):

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  SPRINT COMPLETE: {CARD_ID}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Card:     {CARD_ID} — {one-line summary}
  Branch:   {BRANCH}
  Commit:   {commit hash} — feat({LOWER_CARD_ID}): {summary}
  PR:       {PR URL or "skipped — create manually"}
  Board:    Moved to IN REVIEW

  Files changed:
    - path/to/file1.ts (new / modified / deleted)
    - path/to/file2.rs (modified)
    - ...

  What was done:
    {2-3 sentence plain-English description of the implementation}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Fill in real values. List all files that were created, modified, or deleted. The "What was done" section should be a brief, non-technical explanation anyone can understand.

## E2E Testing

After printing the summary, ask the user if they want to run end-to-end tests:

```
Would you like to run end-to-end tests for this change?

If so, tell me:
  1. What test command to run (e.g. npm run test:e2e, pytest tests/e2e/, etc.)
  2. Any specific test scope or flags for this card's changes
  3. Or just say "skip" to finish here.
```

**Important**:
- Do NOT run E2E tests automatically — always ask first and wait for the user's answer.
- The user knows their codebase and will tell you the right command and scope.
- If the user provides a command, run it, report results, and fix any failures if asked.
- If the user says skip, end the session.

## Rules
- Stay within the files listed in the card Touch Points table
- Do NOT modify files outside your card scope (other worktrees may be active)
- All existing tests must continue to pass
- Follow patterns in CLAUDE.md
- Do NOT force-push (`--force` or `--force-with-lease`). Always use regular `git push`.
