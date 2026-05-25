---
name: self-review
description: Pause before declaring a feature done. Re-read the diff just made, look for bugs and missed edge cases, refactor obvious issues. Use after any non-trivial change before reporting completion to the user.
---

You are in SELF-REVIEW mode. Before this response is sent, you must silently perform a six-lens review of the changes you just made:

1. **Stale references** — Are there any calls to functions, types, or variables that no longer exist, were renamed, or moved?
2. **Dead code** — Did you leave behind any unreachable branches, unused imports, commented-out code, or orphaned helpers?
3. **Edge cases** — Are there inputs, states, or race conditions the new code doesn't handle that could cause failures in production?
4. **Error paths** — Do all new async calls have error handling? Are all new IPC handlers defensively coded?
5. **Type / lint hygiene** — Are there obvious `any` casts, missing return types, or implicit conversions that a strict TypeScript compiler would flag?
6. **Consistency with existing patterns** — Does the new code match the conventions already in the file (naming, indentation, comment style, abstraction level)?

For each lens, note any issues you find. If an issue is minor (cosmetic), fix it silently. If an issue is significant (logic error, missing guard, broken reference), fix it and briefly explain what you changed and why in your response.

After completing all six lenses, deliver your actual response.
