# Member Color List Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show all room members with their selected colors in the top panel when space allows, and expose the complete member/color list through `/members`.

**Architecture:** Reuse the existing `membersByRoom` state and `displayColor` field. Add small formatting helpers in the terminal UI for compact colored member rows, and update the session command formatter for complete member details.

**Tech Stack:** TypeScript, React, Ink, Vitest.

---

### Task 1: Top Panel Member Details

**Files:**
- Modify: `src/ui/App.test.tsx`
- Modify: `src/ui/App.tsx`

**Step 1: Write the failing test**

Add a test that renders `TopInfoPanel` with three members and asserts:

- member names appear
- color names appear
- roles appear
- member name `Text` elements use resolved color values

**Step 2: Run test to verify it fails**

Run: `pnpm test src/ui/App.test.tsx --run`

Expected: FAIL because the current top panel only renders plain member names.

**Step 3: Write minimal implementation**

Export/import `TopInfoPanel` in the test as needed. In `TopInfoPanel`, replace the plain `Members: a, b` line with a fixed member section that renders colored names and `(role, color)` metadata.

**Step 4: Run test to verify it passes**

Run: `pnpm test src/ui/App.test.tsx --run`

Expected: PASS.

### Task 2: Top Panel Overflow Summary

**Files:**
- Modify: `src/ui/App.test.tsx`
- Modify: `src/ui/App.tsx`

**Step 1: Write the failing test**

Add a test with more members than the visible panel budget and assert the rendered text includes `+N more`.

**Step 2: Run test to verify it fails**

Run: `pnpm test src/ui/App.test.tsx --run`

Expected: FAIL because overflow is not summarized yet.

**Step 3: Write minimal implementation**

Add a fixed visible member count for the top panel and append a dim `+N more` summary when members exceed it.

**Step 4: Run test to verify it passes**

Run: `pnpm test src/ui/App.test.tsx --run`

Expected: PASS.

### Task 3: `/members` Complete Color Detail

**Files:**
- Modify: `src/app/chat-session.test.ts`
- Modify: `src/app/chat-session.ts`

**Step 1: Write the failing test**

Update the existing `/members` test to expect color detail, for example `owner:liudong(rose) member:alice(cyan)`.

**Step 2: Run test to verify it fails**

Run: `pnpm test src/app/chat-session.test.ts --run`

Expected: FAIL because `/members` currently omits colors.

**Step 3: Write minimal implementation**

Update the `/members` formatter to include `display_color` for every member, defaulting to `white` when absent.

**Step 4: Run test to verify it passes**

Run: `pnpm test src/app/chat-session.test.ts --run`

Expected: PASS.

### Task 4: Docs And Verification

**Files:**
- Modify: `README.md`

**Step 1: Update docs**

Mention that `/members` shows member role and color.

**Step 2: Run verification**

Run:

```bash
pnpm test --run
pnpm typecheck
```

Expected: both PASS.
