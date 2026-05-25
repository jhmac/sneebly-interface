---
name: self-review
description: Pause before declaring a feature done. Re-read the diff just made, look for bugs and missed edge cases (especially concurrency and async state), refactor obvious issues. Use after any non-trivial change before reporting completion to the user.
---

You are in SELF-REVIEW mode. Before this response is sent, silently perform a seven-lens review of the changes you just made.

## The lenses

### 1. Stale references
- Calls to functions, types, or variables that were renamed, moved, or removed in this turn.
- Imports of things that no longer exist.
- Comments or docstrings that describe behavior the code no longer matches.

### 2. Dead code
- Variables, functions, parameters, or props you added then didn't end up using.
- Branches that can no longer trigger.
- Stale `// BUG-FIX:` or `// TODO:` comments referring to fixes that are now just normal behavior.

### 3. Edge cases
- Empty / null / undefined inputs.
- File or path not existing, wrong permissions, symlinked.
- Network timeout, API failure, user offline.
- Double-click / rapid repeat invocations.

### 4. Error paths
- Every `try` block: what does the user see on the `catch`? Is the error swallowed silently?
- Every IPC handler: what happens if the projectId / sessionId / path doesn't exist?
- Every fs operation: what if the file is locked or outside the expected folder?

### 5. Type / lint hygiene
- Run `npx tsc --noEmit` and report errors before declaring done.
- Look for `any` casts or `// @ts-ignore` you added — were they necessary?
- New code violates any rule the project already enforces?

### 6. Consistency with existing patterns
- New naming conventions that conflict with what's already in the codebase.
- Bypassing an existing utility or helper.
- Different state-management or IPC pattern than the rest of the project uses.

### 7. Interaction with concurrent state (most important — the one most often missed)
- **Trace what happens if another user action arrives mid-async.** Does state get corrupted? Are two operations racing on the same store, file, database row, cache key, session, or registry entry?
- **Trace what happens if the change is invoked twice in quick succession.** Double-Save? Rapid retry? Mounted twice? Are the operations idempotent?
- **Trace cross-function interactions.** If two functions both write to the same shared state (any kind — global, store, file, DB row, in-memory cache), does the order matter? Is one function's effect observable to the other before it completes?
- **Trace failure mid-async.** If the operation fails halfway, is the state left consistent? Will retries make it worse?
- A function reviewed in isolation can look correct while its INTEGRATION with another function is broken. This lens forces the cross-function trace.

## How to deliver the review

Report findings as a short list before any commit:

```
Self-review:
1. [Lens] — [Finding] → [Fix applied / Won't fix because X]
2. ...

Type-check: clean.
Ready to commit.
```

If you find issues, **fix them in the same turn** before declaring done. Don't make the user do a separate "now fix these" round-trip.

## What "done" means

The feature isn't done until the seven-lens review passes (or every issue found is explicitly fixed). The commit happens *after* the review, not before.

## Anti-patterns

- Don't review with vague affirmation ("looks good to me"). Each lens gets a specific note or an explicit "nothing flagged."
- Don't introduce new features during review. Refactor and bug-fix only.
- Don't skip review on trivial changes (single-line fix, typo, config tweak). The discipline is the value; theater is worse than nothing.
- Don't skip the type-check at the end.
- For Lens 7: if you can't think of an interaction, force yourself. *"If the user clicks twice in 100ms, what happens?" "If a background task fires while the user is mid-action?"* Hard cases are where bugs hide.
