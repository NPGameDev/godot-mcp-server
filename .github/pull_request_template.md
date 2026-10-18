## Summary

<!--
Show the change in the smallest view that makes the point: pseudocode, a call
tree, a shallow file tree, a Mermaid diagram, or a `diff` sketch of the shape
that changes. Keep prose to a line or two around it, and use the terms in
docs/dev/glossary.md.
-->

## Evidence

<!--
Show that the change works, before and after: test or console output, naming
the test that failed before and passes now (or a screenshot if the change is
visible in a client).
-->

- **Before:**
  **After:**

## Merge Danger

<!--
Door: two-way if a revert undoes it cleanly; one-way if it is hard to walk back
(a contract or wire-format change, a renamed tool or parameter, a published
package change).
Blast Radius: one word for how far a break would reach (e.g. none, docs, tools,
transport, contract), then any ramifications worth flagging.
-->

**Door:**

**Blast Radius:**

## Checklist

- [ ] `npm run build` succeeds
- [ ] `npm run lint` passes
- [ ] `npm run format` passes
- [ ] Smoke test passes (`npm run smoke`)
- [ ] Code follows the [coding standards](https://github.com/NPGameDev/godot-mcp-server/blob/main/docs/dev/code-standards.md)
- [ ] Contract changes are reflected in the [toolkit contract](https://github.com/NPGameDev/godot-mcp-toolkit/blob/main/docs/dev/contract.md)
- [ ] No unrelated changes included
- [ ] Commit message follows [Conventional Commits](https://www.conventionalcommits.org/)
- [ ] CHANGELOG.md updated (if user-facing)
