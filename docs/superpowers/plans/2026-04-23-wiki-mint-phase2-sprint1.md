# wiki-mint Phase 2 Sprint 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add x-thread, substack HTML, date-range filtering, and Cockpit integration scaffolding to `wiki-mint` without weakening the existing publish-safety gates.

**Architecture:** Keep the current parse → scan → render → write → register pipeline. Add one shared entry-selection helper and one format-dispatch layer, then layer each new format on top with focused tests.

**Tech Stack:** Node.js CommonJS, built-in `node:test`, existing `src/lib/runner.js` CLI framework, no new dependencies.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/runner.js` | `wiki-mint` parser, selector, scanner, renderer dispatch, report shape, optional Cockpit hook |
| `tests/cli.test.js` | Regression coverage for format generation, date filtering, idempotence, and blocked paths |
| `README.md` | Top-level command examples and current format support |
| `docs/wiki/Command-Reference.md` | Detailed `wiki-mint` behavior |
| `docs/wiki/Install-and-Run.md` | Operator run examples |
| `docs/wiki/Cockpit-Integration-Handoff.md` | AG-facing starter contract for `sih-core` Cockpit integration |

---

## Task 1: Shared selected-entry foundation

**Files:**
- Modify: `src/lib/runner.js`
- Modify: `tests/cli.test.js`

- [ ] **Step 1: Add failing test for rendered count**

Add a test proving `wiki-mint` reports both parsed entries and rendered entries when a registry contains prior auto-generated mint entries.

Expected:

```js
assert.equal(report.entryCount, 3);
assert.equal(report.renderedEntryCount, 2);
```

- [ ] **Step 2: Run the focused test**

Run:

```powershell
node --test tests/cli.test.js --test-name-pattern "rendered count"
```

Expected: fail because `renderedEntryCount` does not exist.

- [ ] **Step 3: Implement `getWikiMintRenderableEntries(entries, flags)`**

Add helper that:

- removes only auto-generated mint audit entries
- returns unfiltered entries when no date filter is active
- is reused by every renderer

- [ ] **Step 4: Add `renderedEntryCount` to report**

Set:

```js
report.renderedEntryCount = renderableEntries.length;
```

- [ ] **Step 5: Verify**

Run:

```powershell
npm test
npm run build
```

Expected: all tests pass.

---

## Task 2: Date-range filter

**Files:**
- Modify: `src/lib/runner.js`
- Modify: `tests/cli.test.js`
- Modify: `README.md`
- Modify: `docs/wiki/Command-Reference.md`
- Modify: `docs/wiki/Install-and-Run.md`

- [ ] **Step 1: Add failing tests**

Add tests for:

- `--from` only
- `--to` only
- inclusive `--from` + `--to`
- invalid date rejects
- missing/invalid `recordedAt` excluded only when date filters are active

- [ ] **Step 2: Run focused date tests**

Run:

```powershell
node --test tests/cli.test.js --test-name-pattern "wiki-mint.*date"
```

Expected: fail.

- [ ] **Step 3: Implement date parsing**

Rules:

- accept only `YYYY-MM-DD`
- normalize dates to UTC date-only timestamps
- reject invalid dates before writing

- [ ] **Step 4: Apply filtering in selected-entry helper**

Use `entry.recordedAt` date portion.

- [ ] **Step 5: Update docs**

Document:

```powershell
--from YYYY-MM-DD
--to YYYY-MM-DD
```

- [ ] **Step 6: Verify**

Run:

```powershell
npm test
npm run build
```

---

## Task 3: x-thread renderer

**Files:**
- Modify: `src/lib/runner.js`
- Modify: `tests/cli.test.js`
- Modify: `README.md`
- Modify: `docs/wiki/Command-Reference.md`
- Modify: `docs/wiki/Install-and-Run.md`

- [ ] **Step 1: Add failing generation test**

Expected default output:

```text
docs/wiki/BUILD_THREAD.md
```

Expected content:

- `1/N`
- entry title
- entry summary
- source metadata

- [ ] **Step 2: Add 280-char warning test**

Create an entry whose rendered block exceeds 280 chars.

Expected:

```js
assert.match(report.warnings.join("\n"), /280/);
```

- [ ] **Step 3: Implement output filename**

Add:

```js
x-thread -> BUILD_THREAD.md
```

- [ ] **Step 4: Implement renderer**

Minimal format:

```text
1/N <title>
<summary>
Files: a, b
```

- [ ] **Step 5: Auto-register**

Expected title:

```text
Knowledge Mint: x-thread generated
```

- [ ] **Step 6: Verify**

Run:

```powershell
npm test
npm run build
```

---

## Task 4: substack HTML renderer

**Files:**
- Modify: `src/lib/runner.js`
- Modify: `tests/cli.test.js`
- Modify: `README.md`
- Modify: `docs/wiki/Command-Reference.md`
- Modify: `docs/wiki/Install-and-Run.md`

- [ ] **Step 1: Add failing HTML generation test**

Expected default output:

```text
docs/wiki/BUILD_SUBSTACK.html
```

- [ ] **Step 2: Add HTML escaping test**

Registry values containing `<`, `>`, `&`, and quotes must be escaped.

- [ ] **Step 3: Implement output filename**

Add:

```js
substack -> BUILD_SUBSTACK.html
```

- [ ] **Step 4: Implement renderer**

Use dependency-free HTML:

```html
<h1>Project Build Showcase</h1>
<section>
  <h2>Entry title</h2>
  <blockquote>Summary</blockquote>
  <ul>...</ul>
</section>
```

- [ ] **Step 5: Auto-register**

Expected title:

```text
Knowledge Mint: substack generated
```

- [ ] **Step 6: Verify**

Run:

```powershell
npm test
npm run build
```

---

## Task 5: Cockpit integration starter contract

**Files:**
- Create: `docs/wiki/Cockpit-Integration-Handoff.md`
- Modify: `docs/wiki/Roadmap.md`

- [ ] **Step 1: Write Cockpit handoff**

Include:

- current partial state in `sih-core`
- duplicate `registerMintedAsset()` finding
- canonical payload shape
- badge behavior
- Supabase insert/upsert strategy
- verification checklist

- [ ] **Step 2: Update roadmap**

Add Phase 2 Sprint 1 items and note that Cockpit implementation belongs to the AG lane after PR merge.

- [ ] **Step 3: Verify docs**

Run:

```powershell
node .\src\cli.js wiki-audit . --template cli --report-json
```

Expected: pass.

---

## Task 6: Final verification and review

**Files:**
- Read/check all changed files

- [ ] **Step 1: Run full verification**

Run:

```powershell
npm test
npm run build
node .\src\cli.js wiki-audit . --template cli --report-json
```

- [ ] **Step 2: Request code review**

Use `superpowers:requesting-code-review` against the complete Sprint 1 implementation.

- [ ] **Step 3: Fix review findings**

Fix Critical and Important issues before merge.

- [ ] **Step 4: Record completion**

Use `wiki-register` to record changed files and verification commands.
