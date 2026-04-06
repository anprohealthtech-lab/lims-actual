# Backup / Deprecated File Audit

Date: 2026-04-02
Scope: Scan likely backup, deprecated, duplicate, and legacy implementation files in the current repo.
Goal: Identify what is live, what looks archival, and what needs manual review before deletion.

## Method

I used these checks before classifying anything:

- Routing and page wiring from `src/App.tsx`
- Direct import/reference search across `src`, `supabase`, and repo docs
- File naming patterns such as `_backup`, `_Working`, `_Clean`, `legacy`, `copy`
- Timestamp and size comparison against the current live counterpart
- Git history / notes when available

## High Confidence: Live Files

These are actively wired in `src/App.tsx` and should be treated as current:

- `src/pages/Orders.tsx`
- `src/pages/Tests.tsx`
- `src/pages/Reports.tsx`
- `src/pages/result2.tsx`
- `src/components/Orders/EnhancedOrdersPage.tsx`
- `src/pages/OutsourcedReportsConsoleEnhanced.tsx`

## High Confidence: Archive Candidates

These look like backups or superseded snapshots. I found no runtime references to them.

### 1. `src/pages/Orders_backup_v1.0.13.tsx`

Status: Archive candidate

Why:

- Live route uses `src/pages/Orders.tsx` via `src/App.tsx`
- Filename is explicitly versioned backup
- Much older than live file
- Backup file is smaller and imports the same `EnhancedOrdersPage` pattern as the live orders page
- No runtime references found

Recommended action:

- Move to archive first
- Delete later if no one still uses it for reference

### 2. `src/pages/Results_Backup.tsx`

Status: Archive candidate

Why:

- Live route for old results page is disabled in `src/App.tsx`
- Current results entry route is `/results2` using `src/pages/result2.tsx`
- Filename is explicitly marked backup
- No runtime references found

Recommended action:

- Move to archive
- Do not delete until we confirm nobody still compares behavior against it

### 3. `src/pages/Tests_Working.tsx`

Status: Archive candidate

Why:

- Live route uses `src/pages/Tests.tsx`
- Repo notes reference this as an older main page
- `reflog.txt` includes: route changed from `Tests_Working.tsx` to `Tests.tsx`
- Older and materially smaller than current live `Tests.tsx`

Recommended action:

- Move to archive
- Keep note that some historical docs still mention it

### 4. `src/pages/Tests_Clean.tsx`

Status: Archive candidate

Why:

- Live route uses `src/pages/Tests.tsx`
- Repo docs explicitly describe this as a backup test groups page
- Smaller than both `Tests.tsx` and `Tests_Working.tsx`
- No runtime references found

Recommended action:

- Move to archive

### 5. `src/components/Orders/EnhancedOrdersPage_backup_v1.0.7.tsx`

Status: Archive candidate

Why:

- Live file is `src/components/Orders/EnhancedOrdersPage.tsx`
- Explicit backup naming
- Older and smaller than current file
- No runtime references found

Recommended action:

- Move to archive

### 6. `src/components/Orders/EnhancedOrdersPage_backup_v1.0.8.tsx`

Status: Archive candidate

Why:

- Same reasoning as above
- Appears to be intermediate snapshot on the way to current live component

Recommended action:

- Move to archive

### 7. `src/components/Orders/EnhancedOrdersPage_backup_v1.0.10.tsx`

Status: Archive candidate

Why:

- Same reasoning as above
- Current live component is significantly newer and larger

Recommended action:

- Move to archive

## Keep But Mark Clearly

These are not current primary implementations, but they still have a reason to exist right now.

### 1. `src/pages/OutsourcedReportsConsole.tsx`

Status: Keep for now

Why:

- Still routed in `src/App.tsx` as `/outsourced-reports-legacy`
- Explicitly exposed as a legacy page, which means it is still reachable
- Enhanced replacement exists: `src/pages/OutsourcedReportsConsoleEnhanced.tsx`

Recommended action:

- Keep until product owner confirms legacy route can be removed
- When ready, remove route first, then archive file

### 2. `supabase/functions/pdf-template-copy-paste.js`

Status: Keep for now

Why:

- Not part of main runtime path, but repo docs still explicitly point people to it
- Looks like a helper/template file rather than accidental dead code

Recommended action:

- Keep if the docs are still intended
- Otherwise archive together with the PDF_CO docs package

### 3. `src/schema_checkpoint_backup.md`

Status: Keep for now

Why:

- Looks like documentation / schema snapshot, not runtime code
- Useful as a checkpoint during schema investigation

Recommended action:

- Keep or move under a docs/archive folder

## Duplicate / Old Implementation Findings

These are the main overlapping areas found during the scan.

### 1. Results Entry

Primary live path:

- `src/pages/result2.tsx`
- Routed at `/results2`

Older overlapping implementation:

- `src/pages/Results.tsx`

Notes:

- `src/App.tsx` still imports `Results.tsx`
- The `/results` route is commented out with note: `Hidden - use Results Entry 2`
- This means `Results.tsx` is no longer the active user path, but it is still sitting near the live routing surface

Recommendation:

- Treat `Results.tsx` as superseded but not yet deleted
- When safe, remove dead import from `src/App.tsx`
- Archive `Results.tsx` only after confirming nobody still uses it for internal fallback

### 2. Outsourced Reports

Primary live path:

- `src/pages/OutsourcedReportsConsoleEnhanced.tsx`
- Routed at `/outsourced-reports`

Legacy implementation still reachable:

- `src/pages/OutsourcedReportsConsole.tsx`
- Routed at `/outsourced-reports-legacy`

Recommendation:

- Keep both until business confirms legacy path can go away

### 3. Tests Management

Primary live path:

- `src/pages/Tests.tsx`

Older overlapping implementations:

- `src/pages/Tests_Working.tsx`
- `src/pages/Tests_Clean.tsx`

Recommendation:

- Archive both old files after one final manual check for any unique UI behavior worth porting

### 4. Orders Page / Enhanced Orders Component

Primary live path:

- `src/pages/Orders.tsx`
- `src/components/Orders/EnhancedOrdersPage.tsx`

Older overlapping implementations:

- `src/pages/Orders_backup_v1.0.13.tsx`
- `src/components/Orders/EnhancedOrdersPage_backup_v1.0.7.tsx`
- `src/components/Orders/EnhancedOrdersPage_backup_v1.0.8.tsx`
- `src/components/Orders/EnhancedOrdersPage_backup_v1.0.10.tsx`

Recommendation:

- Archive the old versions together in one cleanup change

## Safe Next Step

Low-risk cleanup plan:

1. Create an archive folder such as `archive/code-snapshots/`
2. Move the seven high-confidence archive candidates there
3. Leave `OutsourcedReportsConsole.tsx`, `pdf-template-copy-paste.js`, and `schema_checkpoint_backup.md` in place for now
4. In a separate commit, remove dead imports and dead routes only after manual confirmation

## Candidate Move List

- `src/pages/Orders_backup_v1.0.13.tsx`
- `src/pages/Results_Backup.tsx`
- `src/pages/Tests_Working.tsx`
- `src/pages/Tests_Clean.tsx`
- `src/components/Orders/EnhancedOrdersPage_backup_v1.0.7.tsx`
- `src/components/Orders/EnhancedOrdersPage_backup_v1.0.8.tsx`
- `src/components/Orders/EnhancedOrdersPage_backup_v1.0.10.tsx`

## Not Moved Yet

This audit does not delete or move files. It is classification only.
