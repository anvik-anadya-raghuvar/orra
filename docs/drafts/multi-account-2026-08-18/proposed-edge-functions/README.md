# Anvik Ops Edge Functions

Supabase Edge Functions for multi-account system, mail sync, and integrations.

## Directory Structure

```
supabase/functions/
├── accounts/
│   ├── google-connect.ts          # Google OAuth token exchange & storage
│   └── imap-connect.ts            # IMAP account validation & storage
├── sync/
│   ├── mail-fetch.ts              # Incremental mail sync (Gmail + IMAP)
│   └── account-health.ts          # Daily account health check
└── README.md                       # This file
```

## Setup

### 1. Environment Variables

Set these in your Supabase project (Project Settings → Edge Functions → Secrets):

```bash
# Google OAuth credentials (from Google Cloud Console)
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxx

# Encryption key for storing IMAP passwords & OAuth tokens (base64-encoded 32-byte key)
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
ENCRYPTION_KEY_BASE64=<base64-encoded key>

# Supabase project details (auto-provided by Supabase)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=xxx
```

### 2. Deploy Functions

```bash
# Deploy all functions
supabase functions deploy

# Deploy a specific function
supabase functions deploy accounts/google-connect
```

### 3. Test Locally

```bash
# Start Supabase locally
supabase start

# Invoke a function
supabase functions invoke accounts/google-connect --local \
  --body '{"code":"auth_code_from_google","state":"xyz","redirect_uri":"http://localhost:5173/auth/callback"}'
```

---

## Functions Overview

### `accounts/google-connect`

**Purpose:** Exchange Google OAuth authorization code for refresh token.

**Triggered by:** Frontend after Google OAuth redirect

**Request:**
```json
{
  "code": "4/0AX4XfWh...",
  "state": "random_state",
  "redirect_uri": "http://localhost:5173/auth/google-callback"
}
```

**Response:**
```json
{
  "success": true,
  "account": {
    "id": "acc_abc123",
    "display_email": "user@gmail.com",
    "display_name": "User Name",
    "provider": "google",
    "scope_granted": ["https://www.googleapis.com/auth/gmail.readonly", ...]
  }
}
```

**Security:**
- Validates JWT from Authorization header
- Exchanges code server-side (code never exposed client-side)
- Encrypts refresh token before storage
- Only owner can re-authenticate

---

### `accounts/imap-connect`

**Purpose:** Validate IMAP credentials and store them encrypted.

**Triggered by:** Frontend IMAP connection form

**Request:**
```json
{
  "provider": "titan",
  "email": "user@titan.email",
  "password": "secure_password",
  "imap_host": "imap.titan.email",
  "imap_port": 993,
  "imap_use_tls": true
}
```

**Response:**
```json
{
  "success": true,
  "account": {
    "id": "acc_def456",
    "display_email": "user@titan.email",
    "provider": "titan",
    "imap_host": "imap.titan.email",
    "imap_port": 993
  }
}
```

**Validation:**
- Tests IMAP connection before storing
- Rejects if credentials fail
- Supports auto-detection for known providers (Titan, Proton, Outlook, Fastmail)

---

### `sync/mail-fetch`

**Purpose:** Incremental mail sync from all active accounts.

**Triggered by:** Supabase Cron (default: every 5 minutes)

**What it does:**
1. Fetches all active accounts ready to sync
2. For Gmail: Calls Gmail API with incremental query (since last sync)
3. For IMAP: Connects to IMAP server and fetches new messages (UID-based)
4. Deduplicates via `gmail_message_id` or `remote_message_hash`
5. Inserts new `mail_items` records
6. Updates `external_accounts.next_sync_at` and `last_sync_at`
7. Logs all operations to `account_sync_logs`

**Idempotency:** Safe to run concurrently; duplicate detection prevents double-syncing.

**Rate limiting:**
- Gmail API: 25 items per request, respects daily quotas
- IMAP: Respects server idle timeout
- Default sync interval: 5 minutes (user-configurable 1–60 minutes)

---

### `sync/account-health` (TODO)

**Purpose:** Daily check that all accounts are still accessible.

**Triggered by:** Supabase Cron (default: 2 AM UTC daily)

**What it does:**
1. For Google accounts: Attempts token refresh
2. For IMAP accounts: Tests connection and login
3. Marks accounts as `error` if authentication fails
4. Notifies user via audit trail

---

## Database Interaction

All functions use the **service_role key** for secure server-side operations:

- Read/write to `external_accounts` (account metadata)
- Read from `account_credentials_vault` (encrypted secrets)
- Write to `account_sync_logs` (sync history)
- Write to `mail_items` (synced mail)
- Write to `audit_trail` (event logging)

**Security:** The vault table has RLS policy `deny_all_client_access`, so only these functions (via service_role) can read encrypted credentials.

---

## Encryption Strategy

### Google Tokens

Stored in `account_credentials_vault` with `credential_type = 'oauth_refresh_token'`.

**Encrypted with:** Supabase `pgsodium` extension (TweetNaCl secretbox)

**Key:** Environment variable `ENCRYPTION_KEY_BASE64` (32-byte key)

**Process:**
1. Frontend calls `/functions/accounts/google-connect` with authorization code
2. Function exchanges code for tokens server-side
3. Refresh token encrypted with `pgsodium.crypto_secretbox_encrypt()`
4. Encrypted bytes stored in vault
5. When syncing, function decrypts with `pgsodium.crypto_secretbox_decrypt()`

### IMAP Passwords

Stored in `account_credentials_vault` with `credential_type = 'imap_password'`.

**Encrypted with:** Same `pgsodium` approach (future implementation)

**Process:**
1. Frontend calls `/functions/accounts/imap-connect` with email + password
2. Function tests IMAP connection
3. Password encrypted with `pgsodium.crypto_secretbox_encrypt()`
4. Encrypted bytes stored in vault
5. When syncing, function decrypts to establish IMAP connection

**Never transmitted in plaintext** after initial validation.

---

## Error Handling

All functions follow this pattern:

1. **Input validation** → 400 Bad Request
2. **Authentication failure** → 401 Unauthorized
3. **Logic error** → Logged to `account_sync_logs` with error message
4. **Credentials issue** → Account marked `sync_status = 'error'`
5. **Infrastructure error** → 500 Internal Server Error + logged

---

## Monitoring & Debugging

### Check sync status

```sql
-- Last 10 sync logs for an account
SELECT * FROM account_sync_logs
WHERE account_id = 'acc_xxx'
ORDER BY created_at DESC
LIMIT 10;

-- Account health
SELECT id, display_email, sync_status, last_sync_error, last_sync_at
FROM external_accounts
ORDER BY last_sync_at DESC;
```

### View audit trail

```sql
-- All account-related events
SELECT * FROM audit_trail
WHERE entity_type = 'external_account'
ORDER BY occurred_at DESC;
```

### Test functions locally

```bash
# Log into Supabase CLI
supabase login

# Start local dev environment
supabase start

# Deploy & test
supabase functions deploy
supabase functions invoke sync/mail-fetch --local
```

---

## Future Enhancements

1. **IMAP library integration** → Use actual IMAP client (currently stubbed)
2. **Calendar sync** → Add Google Calendar events to Anvik Ops calendar
3. **Drive sync** → Index shared Drive files in Knowledge tab
4. **YouTube playlists** → Sync liked videos for song picker
5. **Encryption rotation** → Annual refresh of encryption keys
6. **Webhook notifications** → Realtime updates via Supabase Realtime instead of polling

---

## Troubleshooting

### "Failed to exchange authorization code"

- **Cause:** Redirect URI mismatch between Google Console and frontend
- **Fix:** Ensure `REDIRECT_URI` in frontend matches Google OAuth consent screen settings

### "Token refresh failed"

- **Cause:** Refresh token expired (user revoked access)
- **Fix:** Account needs re-authentication; user clicks "Re-authenticate" in Settings

### "IMAP connection failed"

- **Cause:** Wrong credentials or host unreachable
- **Fix:** Verify email/password and IMAP host settings; test manually with Thunderbird

### "No access token received from Google"

- **Cause:** OAuth flow interrupted or code already used
- **Fix:** User should retry the connection flow

---

## References

- [Supabase Edge Functions](https://supabase.com/docs/guides/functions)
- [Gmail API Documentation](https://developers.google.com/gmail/api/guides)
- [IMAP RFC 3501](https://tools.ietf.org/html/rfc3501)
- [TweetNaCl / Pgsodium](https://github.com/michelson/pgsodium)
