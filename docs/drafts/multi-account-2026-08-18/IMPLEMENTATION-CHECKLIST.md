# Multi-Account System Implementation Checklist

**Status:** Design Complete, Ready for Development  
**Target Duration:** 20–25 days (broken into 8 phases)  
**Cost Impact:** ₹0 (free tiers only)

---

## Quick Reference

**Design Documents:**
- `MULTI-ACCOUNT-DESIGN.md` — Complete system specification
- `supabase/migrations/0009_multi_accounts.sql` — Database schema
- `supabase/functions/README.md` — Edge Functions guide

**Files to review before starting:**
1. `MULTI-ACCOUNT-DESIGN.md` sections 1–3 (principles & schema)
2. `CLAUDE.md` (project constraints & gates)
3. `supabase/migrations/0009_multi_accounts.sql` (schema verification)

---

## Phase Breakdown

### Phase 5a: Database Schema & Infrastructure (1–2 days)

**Deliverable:** Database schema applied, encryption key set up, RLS policies verified.

- [ ] **SQL Migration**
  - Apply `0009_multi_accounts.sql` to Supabase project
  - Verify all tables created:
    - [ ] `external_accounts`
    - [ ] `account_credentials_vault`
    - [ ] `account_sync_logs`
  - Verify column additions to:
    - [ ] `mail_items` (external_account_id, gmail_message_id, imap_uid, remote_message_hash)
    - [ ] `shared_daily` (youtube_account_id, youtube_video_id, song_platform)
    - [ ] `messages` (youtube_account_id)

- [ ] **RLS Policies**
  - Run RLS verification queries from migration file (see §10)
  - Verify `external_accounts` allows team READ, owner UPDATE/DELETE
  - Verify `account_credentials_vault` blocks all client access (RLS RESTRICTIVE policy)

- [ ] **Encryption Setup**
  - Enable `pgsodium` extension in Supabase project
  - Generate 32-byte encryption key: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
  - Store as `ENCRYPTION_KEY_BASE64` in Supabase project settings → Edge Functions → Secrets
  - Test key generation and storage

- [ ] **Test Seed Data**
  - Insert one test account into `external_accounts` (manual INSERT, no UI needed yet)
  - Verify it appears in `external_accounts` query
  - Verify `account_credentials_vault` record can be created for it

**Gate:** All tables present, RLS blocks non-owners, vault is unreadable from client.

---

### Phase 5b: Google OAuth Edge Function (2–3 days)

**Deliverable:** Google account connection workflow end-to-end working.

- [ ] **Deploy `accounts/google-connect`**
  - Set environment variables:
    - [ ] `GOOGLE_CLIENT_ID`
    - [ ] `GOOGLE_CLIENT_SECRET`
    - [ ] `ENCRYPTION_KEY_BASE64`
  - Deploy: `supabase functions deploy accounts/google-connect`
  - Verify deployment logs show no errors

- [ ] **Test OAuth Flow**
  - Start frontend dev server
  - Create test page at `/test/google-connect`
  - Implement "Connect Google Account" button → redirect to Google OAuth
  - Capture authorization code from redirect callback
  - Call Edge Function with code + state + redirect_uri
  - Verify response includes account ID and display_email

- [ ] **Verify Encryption**
  - Query `account_credentials_vault` for inserted token
  - Confirm `encrypted_value` is binary, not plaintext
  - Confirm token not visible in plain text anywhere

- [ ] **Error Handling**
  - Test with invalid/expired auth code → 400
  - Test with missing JWT → 401
  - Test with wrong client secret → 400
  - Verify all errors logged to console, not exposed client-side

- [ ] **RLS Verification**
  - Insert account as Anadya (user_id = anadya_uuid)
  - Switch JWT to Raghuvar
  - Try UPDATE on Anadya's account → Should FAIL with RLS error

**Gate:** Can connect Google account, token encrypted in vault, RLS blocks cross-user modification.

---

### Phase 5c: IMAP Edge Function (2–3 days)

**Deliverable:** IMAP account validation and storage working.

- [ ] **Deploy `accounts/imap-connect`**
  - Deploy: `supabase functions deploy accounts/imap-connect`
  - Verify deployment logs show no errors

- [ ] **IMAP Library Integration**
  - Research Deno-compatible IMAP library (e.g., `imap_flow` from Deno Land)
  - Implement `testImapConnection()` function with real IMAP client
  - Add error handling for:
    - [ ] Wrong host
    - [ ] Wrong port
    - [ ] Wrong username/password
    - [ ] Server not reachable

- [ ] **Test with Real Accounts**
  - Test with Titan Mail (imap.titan.email:993)
  - Test with ProtonMail Bridge (localhost:1143 or imap.protonmail.com)
  - Test with Outlook (outlook.office365.com:993)
  - Verify connection succeeds, credentials stored encrypted

- [ ] **Provider Auto-Detection**
  - Verify that selecting "Titan" auto-fills imap.titan.email:993:true
  - Verify "Custom IMAP" allows manual host entry
  - Test with 3+ different providers

- [ ] **Password Encryption**
  - Verify password stored in vault as encrypted bytes
  - Confirm plaintext password not logged anywhere

**Gate:** Can connect IMAP account (test with real Titan), password encrypted, provider detection works.

---

### Phase 5d: Mail Sync Edge Function (3–4 days)

**Deliverable:** Mail syncs from Gmail and IMAP accounts.

- [ ] **Implement Gmail Sync**
  - Research Gmail API messages.list and messages.get endpoints
  - Implement `fetchGmailMessages()` with query parameter
  - Implement `fetchGmailMessage()` to get full message details
  - Handle incremental sync using last_sync_at
  - Extract headers: Subject, From, Date
  - Implement deduplication via `gmail_message_id`

- [ ] **Implement IMAP Sync**
  - Use Deno-compatible IMAP library
  - Connect with decrypted password
  - Fetch messages from INBOX
  - Track UIDs for incremental sync
  - Implement deduplication via `remote_message_hash` (SHA256)
  - Extract headers: Subject, From, Date

- [ ] **Deploy `sync/mail-fetch`**
  - Deploy: `supabase functions deploy sync/mail-fetch`
  - Verify no errors

- [ ] **Test Gmail Sync**
  - Create test Google account
  - Manually invoke: `supabase functions invoke sync/mail-fetch --local`
  - Verify `mail_items` populated with real messages
  - Verify no duplicates on second run
  - Test with 50+ messages

- [ ] **Test IMAP Sync**
  - Create test Titan account
  - Manually invoke mail-fetch function
  - Verify `mail_items` populated with real IMAP messages
  - Verify no duplicates on second run
  - Test with 50+ messages

- [ ] **Sync Logs & Status**
  - Verify each sync creates entry in `account_sync_logs`
  - Verify `external_accounts.last_sync_at` updated
  - Verify `external_accounts.next_sync_at` set to (now + 5 min)
  - Verify error cases log to `account_sync_logs.error_message`

- [ ] **Performance Test**
  - Sync 500+ mail items
  - Measure time: should complete in <10 seconds
  - Verify no lock contention or N+1 queries

**Gate:** Gmail syncs 50+ items, IMAP syncs 50+ items, no duplicates, performance <10s for 500 items.

---

### Phase 5e: Cron Scheduling (1 day)

**Deliverable:** Mail syncs automatically on schedule.

- [ ] **Configure Supabase Cron**
  - Research Supabase cron trigger format
  - Set up mail-fetch to run every 5 minutes
  - Set up account-health check to run daily at 2 AM UTC
  - Verify functions listed in Supabase project

- [ ] **Test Scheduler**
  - Wait 5 minutes, verify mail-fetch ran automatically
  - Check function logs in Supabase dashboard
  - Verify sync logs recorded
  - Check email counts in `mail_items` table

- [ ] **Account Health Check**
  - Implement `sync/account-health` edge function
  - Test token refresh for Google accounts
  - Test IMAP connection for IMAP accounts
  - Mark accounts `error` if auth fails

**Gate:** Mail syncs automatically every 5 minutes, health check runs daily.

---

### Phase 5f: Frontend: Settings/Connections UI (2–3 days)

**Deliverable:** UI to connect and manage accounts.

- [ ] **Connections Page at `/settings`**
  - New route: `/settings` (or tab on `/admin`)
  - List all connected accounts (both users see all)
  - Display per account:
    - [ ] Account email (display_email)
    - [ ] Account type badge (Gmail, IMAP, YouTube)
    - [ ] Color badge (user-editable)
    - [ ] Last sync time (relative: "2 min ago")
    - [ ] Sync status (idle/syncing/error)
    - [ ] Action buttons: [Re-authenticate] [Config] [Disconnect]

- [ ] **Add Google Account Modal**
  - Button: [+ Add Google Account]
  - Modal: Simple [Connect with Google] button
  - Redirect to Google OAuth consent
  - On callback, show confirmation:
    ```
    ✓ Connected: anadya+work@gmail.com
    Scopes: Gmail, Calendar, YouTube
    [Done] [Connect Another]
    ```

- [ ] **Add IMAP Account Modal**
  - Button: [+ Add IMAP Account]
  - Form fields:
    - [ ] Provider dropdown (Titan, Proton, Outlook, Fastmail, Custom)
    - [ ] Email input
    - [ ] Password input (required)
    - [ ] IMAP Host (auto-filled for known providers, editable for custom)
    - [ ] IMAP Port (auto-filled, editable)
    - [ ] Use TLS checkbox (auto-checked)
  - Actions:
    - [ ] [Test Connection] → calls edge function, shows result
    - [ ] [Connect] → creates account if test passes
    - [ ] [Cancel]

- [ ] **Account Configuration Modal**
  - Triggered by [Config] button
  - Fields:
    - [ ] Display name (free-form, for user's own labels)
    - [ ] Color badge (9-color picker)
    - [ ] Auto-sync toggle (on/off)
    - [ ] Sync interval (1/5/15/30/60 minutes dropdown)
  - Actions: [Save] [Cancel]

- [ ] **Disconnect Action**
  - Confirm: "Permanently disconnect {email}? Synced mail will remain."
  - Delete account from `external_accounts`
  - Cascade-delete from `account_credentials_vault`
  - Log to audit trail

- [ ] **Re-authenticate Action**
  - For Google: Trigger OAuth flow again, update refresh token
  - For IMAP: Show password entry form, test connection, update stored password
  - Show success message: "Account re-authenticated"

- [ ] **Responsive Design**
  - Mobile (375px): Account list as vertical cards, full-width modals
  - Tablet (768px): Account list as cards, centered modals
  - Desktop (1440px): Account list in left column, details in right
  - Touch targets ≥44px

- [ ] **Motion & States**
  - Loading: Show skeleton during connection test
  - Error: Red banner with error message
  - Success: Green checkmark, fade out after 2s
  - Sync indicator: Animated dot while syncing

**Gate:** Can add Google account (real OAuth redirect), add IMAP account (real connection test), disconnect, and see all accounts listed.

---

### Phase 5g: Frontend: Mail Tab Integration (2 days)

**Deliverable:** Mail tab shows all accounts, filterable.

- [ ] **Modify Mail Tab**
  - Add account filter dropdown: "All Accounts" / "anadya@gmail.com" / "anadya+work@gmail.com" / etc.
  - Show account color badges next to each mail item
  - Optional: Group by account (collapsible sections)

- [ ] **Account Selector Dropdown**
  - Checkbox for "All Accounts"
  - Checkboxes for each account
  - Colored dot matching account badge
  - Display email and label (if set)

- [ ] **Mail Item Display**
  - Add small colored badge (🟦, 🟩, 🟪, etc.) to left of sender name
  - Hover shows account email tooltip
  - Click filter icon to show only that account

- [ ] **Manual Sync Button**
  - Button: [🔄 Sync] (or [↻] in compact layout)
  - Call mail-fetch function on demand (not waiting for cron)
  - Show loading spinner during sync
  - Show toast: "Synced X new messages"

- [ ] **Performance**
  - Query: `SELECT * FROM mail_items WHERE external_account_id = ? ORDER BY received_at DESC LIMIT 50`
  - Should render 50 items in <200ms
  - Lazy-load older items on scroll

- [ ] **Responsive**
  - Mobile: Full-width account dropdown, colored badges
  - Tablet: Account chips in filter row
  - Desktop: Account dropdown + grouped layout option

**Gate:** Mail tab shows messages from multiple accounts, can filter by account, manual sync works.

---

### Phase 5h: Frontend: Song Picker Integration (1 day)

**Deliverable:** Song picks can reference YouTube account.

- [ ] **Modify Song of the Day Widget**
  - Add dropdown: "My YouTube" (or select specific YouTube account)
  - Show list of connected YouTube accounts from `external_accounts`
  - When picking song, store `youtube_account_id` in `shared_daily`

- [ ] **Display Song Source**
  - Show "Picked from: account@youtube.com" in song card
  - Link to YouTube video on selected account (if youtube_video_id stored)

- [ ] **Store YouTube Account**
  - When song is picked:
    ```sql
    INSERT INTO shared_daily (
      date, song_title, song_artist, song_url,
      youtube_account_id, youtube_video_id, song_platform, picked_by, created_at
    ) VALUES (...)
    ```

- [ ] **Responsive**
  - Mobile: Account dropdown in song widget
  - Desktop: Account selector in search results

**Gate:** Can pick song from YouTube account, youtube_account_id stored in database.

---

### Phase 5i: Testing & Verification (3–4 days)

**Deliverable:** System passes all gates and is production-ready.

- [ ] **Security Pass**
  - [ ] RLS: Run failing query as non-allowlisted user → rejects
  - [ ] RLS: Try to UPDATE account as wrong user → fails with RLS error
  - [ ] Vault: Direct SELECT from vault as authenticated user → blocked by RESTRICTIVE policy
  - [ ] Tokens: Grep production bundle: `grep -rn "oauth_refresh_token\|imap_password" ./dist` → returns nothing
  - [ ] Secrets: Verify GOOGLE_CLIENT_SECRET not in client-side code
  - [ ] Input validation: Test SQL injection in email field → escapes safely

- [ ] **Performance Pass**
  - [ ] Mail sync: 500 items in <10 seconds
  - [ ] Mail list render: 50 items in <200ms
  - [ ] Account dropdown: Opens instantly
  - [ ] Bundle size: Check `npm run build`, measure dist/ gzip size (should not increase >50 KB)

- [ ] **Responsive Pass**
  - [ ] Tested at 375px, 768px, 1440px
  - [ ] Touch targets ≥44px on mobile
  - [ ] No horizontal scroll on mobile
  - [ ] Account badges visible and legible on small screens
  - [ ] Modal full-screen on mobile, centered on desktop

- [ ] **Motion Pass**
  - [ ] All loading states are skeleton/spinner (no blank screen)
  - [ ] Sync button shows loading state with rotation
  - [ ] Account list items fade in on mount
  - [ ] Filter dropdown animates open/close
  - [ ] `prefers-reduced-motion` respected (no animations)

- [ ] **Integration Pass**
  - [ ] Gmail: Sync 50+ real emails, verify count matches
  - [ ] Gmail: Run sync twice, confirm no duplicates
  - [ ] IMAP (Titan): Sync 50+ real emails
  - [ ] IMAP: Run sync twice, confirm no duplicates
  - [ ] Mail tab: Filter by account, count matches account_sync_logs
  - [ ] Song: Pick from YouTube account, verify youtube_account_id stored
  - [ ] Audit trail: All account actions logged (create, update, delete, sync)

- [ ] **Error Handling**
  - [ ] Google token expired: Try to sync, account marked error, user sees re-auth prompt
  - [ ] IMAP password wrong: Sync fails, account marked error
  - [ ] Network timeout: Sync logs error, doesn't crash app
  - [ ] Invalid account config: Clear error message in UI

- [ ] **Data Integrity**
  - [ ] Delete account: `account_credentials_vault` records auto-deleted (CASCADE)
  - [ ] Delete user: All user's accounts auto-deleted (CASCADE)
  - [ ] Duplicate detection: Same message never appears twice in `mail_items`

**Gate:** All security, performance, responsive, motion checks pass; integration tests all succeed.

---

## Phase Delivery Order

```
Phase 5a (DB)        → Phase 5b (Google)  → Phase 5c (IMAP)     → Phase 5d (Sync)
    ↓                    ↓                    ↓                      ↓
  1-2d                 2-3d                 2-3d                   3-4d
    ↓                    ↓                    ↓                      ↓
  ├────────────────────────────────────────────────────────────────┤
           Phase 5e (Cron)          Phase 5f (Settings UI)
               1d                         2-3d
                  ↓                         ↓
           ├─────────────────────────────────┤
                 Phase 5g (Mail Tab)
                      2d
                       ↓
                ├─────────────┤
               Phase 5h    Phase 5i
            (Song Picker) (Testing)
               1d           3-4d
                ↓            ↓
           ├────────────────────────┤
                    Total: 20-25d
```

**Critical Path:**
- 5a (DB) must complete before 5b, 5c, 5d start
- 5d (Sync) should complete before 5e (Cron)
- 5f (Settings UI) can run in parallel with 5d
- 5g, 5h run after 5f, 5d complete
- 5i (Testing) is final, gates all others

---

## Success Criteria (Phase Gate)

### After Phase 5a
- [ ] `external_accounts`, `account_credentials_vault`, `account_sync_logs` tables exist
- [ ] RLS policies enforced (verified with query tests)
- [ ] Encryption key stored in Supabase Secrets

### After Phase 5b
- [ ] Can connect Google account via OAuth (redirects, token stored)
- [ ] Refresh token is encrypted in vault
- [ ] RLS blocks non-owner from modifying account

### After Phase 5c
- [ ] Can connect IMAP account (tested with real Titan)
- [ ] IMAP password is encrypted in vault
- [ ] Connection validation happens before storing

### After Phase 5d
- [ ] Gmail mail syncs (50+ items, no duplicates)
- [ ] IMAP mail syncs (50+ items, no duplicates)
- [ ] Sync logs recorded in `account_sync_logs`
- [ ] Performance: 500 items in <10 seconds

### After Phase 5e
- [ ] Mail syncs automatically every 5 minutes
- [ ] Account health check runs daily
- [ ] Cron logs in Supabase dashboard

### After Phase 5f
- [ ] Settings page lists all connected accounts
- [ ] Can add Google and IMAP accounts from UI
- [ ] Can disconnect, re-authenticate, configure accounts
- [ ] Responsive at 375px, 768px, 1440px

### After Phase 5g
- [ ] Mail tab filters by account
- [ ] Account badges visible on each mail item
- [ ] Manual sync button works
- [ ] Shows correct count per account

### After Phase 5h
- [ ] Can pick song from YouTube account
- [ ] `youtube_account_id` stored in `shared_daily`
- [ ] Song card displays source account

### After Phase 5i (Final Gate)
- [ ] Security: RLS + vault tested, no secrets in dist/
- [ ] Performance: <300ms mail render, <10s sync
- [ ] Responsive: Verified at all breakpoints
- [ ] Motion: Animations respect prefers-reduced-motion
- [ ] Integration: All workflows end-to-end tested

---

## Commit Strategy

After each phase passes its gate, create a commit:

```bash
git commit -m "Phase 5a: Multi-account database schema

- Create external_accounts, account_credentials_vault, account_sync_logs tables
- Add columns to mail_items, shared_daily, messages
- Configure RLS policies for team access + owner-only modification
- Encryption key setup in Supabase Secrets
- Verify RLS with test queries

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

Similar for 5b, 5c, etc.

**Final commit after Phase 5i:**

```bash
git commit -m "Phase 5: Multi-account system complete

- Google OAuth integration for Gmail, Calendar, Drive, YouTube
- IMAP support for Titan, Proton, Outlook, Fastmail, etc.
- Encrypted credential storage (pgsodium)
- Incremental mail sync (Gmail API, IMAP)
- Scheduled cron jobs (5-min mail sync, daily health check)
- Settings UI for account management
- Mail tab filtering by account
- Song picker YouTube account support
- Security, performance, responsive, motion gates all passing

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Open Questions Requiring Clarification

Before starting Phase 5a, confirm:

1. **Calendar/Drive sync?** Start with Gmail/IMAP only, or also sync Calendar events and Drive files?
   - Recommendation: Gmail + IMAP only in Phase 5. Calendar/Drive are Phase 6.

2. **Credential rotation frequency?** Refresh tokens annually, or on explicit re-auth only?
   - Recommendation: Annual rotation + manual re-auth on access issues.

3. **IMAP folder selection?** Only INBOX, or allow user to pick which folders to sync?
   - Recommendation: INBOX only in Phase 5. Folder selection in Phase 6.

4. **Unread counts?** Show unread/flagged counts per account in mail tab?
   - Recommendation: No counts in Phase 5. Add query counts in Phase 6.

5. **Cost monitoring?** Track API usage against free tier limits?
   - Recommendation: Add optional dashboard in Phase 6. Not blocking.

---

## References

- **Design:** See `MULTI-ACCOUNT-DESIGN.md` for full spec
- **Schema:** See `supabase/migrations/0009_multi_accounts.sql`
- **Functions:** See `supabase/functions/README.md`
- **CLAUDE.md:** Project principles and gates
- **IMPLEMENTATION-PLAN-v2.md:** Overall system architecture

---

Ready to proceed? Confirm answers to the 5 open questions above, and Phase 5a can begin immediately.
