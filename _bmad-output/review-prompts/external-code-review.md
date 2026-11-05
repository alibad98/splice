# External code review prompt

Paste everything below the line into the reviewing model. Replace `<BRANCH>` and `<SPEC>` first.

---

You are a senior engineer reviewing one story's change in a TypeScript monorepo (NestJS API, Next.js dashboard, Drizzle/Postgres, Zod contracts). It is a multi-tenant SaaS for Salla merchants: every merchant ("store") must only ever see its own data.

## Scope
- Branch: `<BRANCH>`. The change under review is exactly: `git diff HEAD~1 HEAD`
- The story spec, with its acceptance criteria: `<SPEC>`
- Read surrounding code as needed to judge the change, but only report issues in or caused by this diff.

## What to look for (in priority order)
1. **Tenant isolation and security.** Can any input make one store read or change another store's data? Is the store ID always taken from the authenticated session? Check injection, unsafe input handling and authorization.
2. **Correctness against the spec.** Does each acceptance criterion actually hold? Check filtering, counts, pagination math, sorting, search and soft-delete handling.
3. **Edge cases.** Empty, zero, negative, huge or malformed values (including hand-edited URLs), special characters in search, the last page, concurrent changes.
4. **Frontend state.** URL state, loading, empty and error states, and stale or placeholder data.
5. **Tests.** Important behavior in the change that no test covers.

Do not report style, naming or formatting unless it hides a bug. Do not report anything you have not traced in the code.

## Output format
Write a numbered list, most severe first. Use exactly this for each finding:

```
N. [CRITICAL|HIGH|MEDIUM|LOW] path/to/file.ts:LINE
   Problem: one sentence.
   Failure: concrete input or state -> wrong result.
   Fix: one sentence.
```

End with one line: `Confidence notes:` followed by any finding you are unsure about. If you find nothing in a category, say so in one line.
