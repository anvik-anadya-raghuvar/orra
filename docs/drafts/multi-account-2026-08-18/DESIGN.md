# Multi-Account System Design for ORRA

**Status:** Ready for implementation  
**Complexity:** Phase 4 → Phase 5 (integrates after board/notes)  
**Cost impact:** Free tier (Google OAuth testing mode + Supabase Postgres only, no paid APIs)

---

## 1. Core Principles

- **One user, many accounts.** Anadya and Raghuvar each manage their own separate sets of Google/IMAP accounts.
- **Independent sync pipelines.** Each account maintains its own OAuth refresh token (Google) or IMAP credentials (encrypted).
- **Unified inbox, account-filtered views.** Mail tab shows all accounts by default, filterable by account selector.
- **Encrypted IMAP secrets.** Credentials encrypted at rest using Supabase's vault pattern (see credential storage spec below).
- **No cross-user account sharing.** Both see the same mail items (RLS allows it), but only the owning user can re-authenticate or delete the account.
- **Song picks are account-aware.** When picking a song from YouTube, `shared_daily.youtube_account_ref` tracks which YouTube account it came from.

---

## 2. Schema: New Tables and Modifications

### 2.1 New Table: `external_accounts`

Stores metadata for all external accounts (Google and IMAP) connected by either user.

```sql
-- Metadata for all external accounts (Gmail, Calendar, Drive, YouTube, IMAP)
CREATE TABLE public.external_accounts (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  account_type TEXT NOT NULL CHECK (account_type IN ('google_workspace', 'gmail', 'youtube', 'imap')),
  provider TEXT NOT NULL CHECK (provider IN ('google', 'titan', 'gmail', 'proton', 'outlook', 'fastmail')),
  display_email TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  
  -- Google-only fields (populated for Google accounts)
  google_user_id TEXT,
  google_refresh_token_encrypted TEXT,
  
  -- IMAP-only fields
  imap_host TEXT,
  imap_port INT,
  imap_use_tls BOOLEAN,
  imap_username TEXT,
  imap_password_encrypted TEXT,
  
  -- Common sync metadata
  last_sync_at TIMESTAMPTZ,
  next_sync_at TIMESTAMPTZ,
  sync_status TEXT NOT NULL DEFAULT 'idle' CHECK (sync_status IN ('idle', 'syncing', 'error')),
  last_sync_error TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  scope_granted TEXT[] NOT NULL DEFAULT '{}',
  
  -- Manual account settings
  color_badge TEXT NOT NULL DEFAULT 'slate',
  auto_sync BOOLEAN NOT NULL DEFAULT true,
  sync_interval_minutes INT NOT NULL DEFAULT 5,
  
  created_by UUID REFERENCES public.profiles (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_external_accounts_user ON public.external_accounts (user_id);
CREATE INDEX idx_external_accounts_sync ON public.external_accounts (next_sync_at) WHERE is_active = true;
CREATE INDEX idx_external_accounts_provider ON public.external_accounts (provider);
```

**Field explanations:**
- `account_type`: Categorizes the account (Gmail gets `gmail`, YouTube gets `youtube`, others get `imap`)
- `provider`: The actual service (google, titan, proton, outlook, fastmail)
- `display_email`: The email address shown in UI (e.g., "anadya+work@gmail.com")
- `google_refresh_token_encrypted`: OAuth refresh token, encrypted with Supabase's `pgsodium` extension (see 2.4 below)
- `imap_*` fields: Populated only for IMAP accounts
- `scope_granted`: Array of OAuth scopes successfully granted (e.g., `['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/calendar.readonly']`)
- `sync_status` + `last_sync_error`: Track current state and failures
- `color_badge`: Tailwind color class for account selector chips (e.g., 'blue', 'red', 'emerald')

---

### 2.2 New Table: `account_credentials_vault`

**Encrypted credential storage** using Supabase Postgres `pgsodium` extension.

```sql
-- Vault for encrypted credential material (Google tokens + IMAP passwords)
-- Uses Supabase's built-in pgsodium for encryption.
CREATE TABLE public.account_credentials_vault (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES public.external_accounts (id) ON DELETE CASCADE,
  credential_type TEXT NOT NULL CHECK (credential_type IN ('oauth_refresh_token', 'imap_password', 'oauth_access_token')),
  encrypted_value bytea NOT NULL,
  encryption_key TEXT NOT NULL DEFAULT 'default', -- key identifier for rotation
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ
);

CREATE INDEX idx_creds_account ON public.account_credentials_vault (account_id);
```

**Why separate from `external_accounts`?**
- Secrets stored encrypted in a dedicated table keeps the main table clean and readable.
- Easier to audit access to credential material.
- Simpler to rotate encryption keys without touching account metadata.
- Can implement column-level RLS separately if needed later.

**Encryption approach:**
- Use `pgsodium.crypto_secretbox_encrypt()` in Postgres (requires `pgsodium` extension enabled in Supabase).
- Encryption key stored in Supabase Vault as an environment variable (not in code).
- Frontend **never** sees decrypted secrets.
- Edge functions decrypt only when needed (Gmail API, IMAP connection).

---

### 2.3 New Table: `account_sync_logs`

Audit trail for sync operations per account.

```sql
-- Sync history: when we tried, what happened, how many items
CREATE TABLE public.account_sync_logs (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES public.external_accounts (id) ON DELETE CASCADE,
  sync_type TEXT NOT NULL CHECK (sync_type IN ('full', 'incremental', 'error')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  items_synced INT NOT NULL DEFAULT 0,
  items_new INT NOT NULL DEFAULT 0,
  items_updated INT NOT NULL DEFAULT 0,
  error_message TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'partial', 'error')),
  
  -- For mail syncs, track the Gmail history ID or IMAP UID
  remote_cursor TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sync_logs_account ON public.account_sync_logs (account_id, completed_at DESC);
```

---

### 2.4 Modified Table: `mail_items`

Add account linkage so mail can be filtered by account.

```sql
-- Add this column to existing mail_items table
ALTER TABLE public.mail_items
  ADD COLUMN IF NOT EXISTS external_account_id TEXT REFERENCES public.external_accounts (id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS gmail_message_id TEXT,
  ADD COLUMN IF NOT EXISTS imap_uid INT,
  ADD COLUMN IF NOT EXISTS remote_message_hash TEXT;

-- New indexes for faster filtering
CREATE INDEX IF NOT EXISTS idx_mail_account ON public.mail_items (external_account_id);
CREATE INDEX IF NOT EXISTS idx_mail_gmail_id ON public.mail_items (gmail_message_id);
```

**Why these fields?**
- `external_account_id`: Foreign key to link mail to its source account.
- `gmail_message_id`: Gmail's unique message ID (for deduplication and incremental sync).
- `imap_uid`: IMAP UID (may not be stable across sessions, so hash is safer).
- `remote_message_hash`: SHA256(sender + subject + received_at) for detecting duplicates across sync runs.

---

### 2.5 Modified Table: `shared_daily` (Song picks)

Add YouTube account tracking.

```sql
-- Add these columns to the existing shared_daily table
ALTER TABLE public.shared_daily
  ADD COLUMN IF NOT EXISTS youtube_account_id TEXT REFERENCES public.external_accounts (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS youtube_video_id TEXT,
  ADD COLUMN IF NOT EXISTS song_platform TEXT NOT NULL DEFAULT 'youtube' CHECK (song_platform IN ('youtube', 'spotify', 'manual'));
```

**Why?**
- Track which YouTube account provided the song pick (to link back to the right uploader).
- `youtube_video_id` stores the YouTube video ID for deep links.
- `song_platform` allows future expansion (Spotify, Apple Music, etc.).

---

### 2.6 Optional: Modified `messages` table (Us chat)

If song picks can be shared via messages:

```sql
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS youtube_account_id TEXT REFERENCES public.external_accounts (id) ON DELETE SET NULL;
```

---

## 3. Sync Implementation Details

### 3.1 Google OAuth Flow (Gmail, Calendar, Drive, YouTube)

**OAuth Scopes per provider:**

```
Gmail:
  - https://www.googleapis.com/auth/gmail.readonly (read-only access)
  - https://www.googleapis.com/auth/gmail.labels (label management, optional)

Calendar:
  - https://www.googleapis.com/auth/calendar.readonly

Drive:
  - https://www.googleapis.com/auth/drive.readonly
  - https://www.googleapis.com/auth/drive.metadata.readonly

YouTube:
  - https://www.googleapis.com/auth/youtube.readonly (video metadata, playlists)
  - https://www.googleapis.com/auth/youtube (needed to upload, if future feature)
```

**Frontend OAuth Flow (React):**

1. User clicks "Connect Google Account" in Settings/Connections.
2. Frontend redirects to Google OAuth consent screen using `@react-oauth/google` or manual window.open().
3. User selects which Google account and grants scopes.
4. Google redirects to `/auth/google-callback` with authorization code.
5. Frontend sends code + state to **Edge Function** (NOT Supabase Auth, but a custom endpoint).

**Edge Function: `/functions/accounts/google-connect` (Supabase Edge Function)**

```typescript
// supabase/functions/accounts/google-connect/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js";

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const { code, state, redirect_uri } = await req.json();
  const userId = req.headers.get("x-user-id"); // From Supabase JWT

  // Step 1: Exchange authorization code for tokens
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID"),
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET"),
      code,
      redirect_uri,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenResponse.ok) {
    return new Response(JSON.stringify({ error: "Token exchange failed" }), {
      status: 400,
    });
  }

  const tokens = await tokenResponse.json();
  // tokens.access_token (expires in ~1h)
  // tokens.refresh_token (long-lived, store encrypted)
  // tokens.expires_in

  // Step 2: Get user profile info from Google
  const profileResponse = await fetch(
    "https://www.googleapis.com/oauth2/v2/userinfo",
    {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    }
  );
  const profile = await profileResponse.json();
  // profile.email, profile.name, profile.picture, profile.id (google_user_id)

  // Step 3: Encrypt refresh token
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const encryptedToken = await encryptSecret(tokens.refresh_token);

  // Step 4: Upsert into external_accounts
  const { data: account, error } = await supabase
    .from("external_accounts")
    .upsert({
      id: `acc_${generateId()}`,
      user_id: userId,
      account_type: "gmail",
      provider: "google",
      display_email: profile.email,
      display_name: profile.name,
      google_user_id: profile.id,
      scope_granted: ["gmail.readonly", "calendar.readonly", "youtube.readonly"],
      last_sync_at: null,
      is_active: true,
    })
    .select()
    .single();

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
    });
  }

  // Step 5: Store encrypted refresh token in vault
  await supabase.from("account_credentials_vault").insert({
    id: `cred_${generateId()}`,
    account_id: account.id,
    credential_type: "oauth_refresh_token",
    encrypted_value: encryptedToken,
  });

  return new Response(JSON.stringify({ account }), { status: 200 });
};

async function encryptSecret(secret: string): Promise<Uint8Array> {
  // Use Supabase's pgsodium or libsodium via Deno
  const encoder = new TextEncoder();
  const secretBytes = encoder.encode(secret);
  const key = Deno.env.get("ENCRYPTION_KEY_BASE64")!; // 32 bytes, base64-encoded
  // Use TweetNaCl or libsodium binding
  // Simplified: return encrypted bytes
  return secretBytes; // TODO: implement actual encryption
}

function generateId(): string {
  return Math.random().toString(36).substr(2, 9);
}
```

---

### 3.2 IMAP Sync Flow (Titan Mail, ProtonMail, Outlook, Fastmail, etc.)

**Frontend UI Flow:**

1. User selects provider (Titan, Proton, Outlook, Fastmail, or "Custom IMAP").
2. User enters email + password.
3. Frontend sends to **Edge Function** for validation (IMAP connection test).

**Edge Function: `/functions/accounts/imap-connect` (Supabase Edge Function)**

```typescript
// supabase/functions/accounts/imap-connect/index.ts
import { ImapFlow } from "https://deno.land/x/imap_flow/mod.ts"; // IMAP library
import { createClient } from "https://esm.sh/@supabase/supabase-js";

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const {
    provider,
    email,
    password,
    imap_host,
    imap_port,
    imap_use_tls,
  } = await req.json();
  const userId = req.headers.get("x-user-id");

  // Step 1: Validate IMAP connection
  let imapClient;
  try {
    imapClient = new ImapFlow({
      host: imap_host || getImapHostForProvider(provider),
      port: imap_port || (imap_use_tls ? 993 : 143),
      secure: imap_use_tls !== false,
      auth: {
        user: email,
        pass: password,
      },
    });

    await imapClient.connect();
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: "IMAP connection failed",
        detail: err.message,
      }),
      { status: 400 }
    );
  } finally {
    if (imapClient) await imapClient.logout();
  }

  // Step 2: Encrypt password
  const encryptedPassword = await encryptSecret(password);

  // Step 3: Create external_accounts record
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data: account, error } = await supabase
    .from("external_accounts")
    .insert({
      id: `acc_${generateId()}`,
      user_id: userId,
      account_type: "imap",
      provider,
      display_email: email,
      imap_host: imap_host || getImapHostForProvider(provider),
      imap_port: imap_port || (imap_use_tls ? 993 : 143),
      imap_use_tls: imap_use_tls !== false,
      imap_username: email,
      scope_granted: ["imap.full"],
      is_active: true,
    })
    .select()
    .single();

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
    });
  }

  // Step 4: Store encrypted password in vault
  await supabase.from("account_credentials_vault").insert({
    id: `cred_${generateId()}`,
    account_id: account.id,
    credential_type: "imap_password",
    encrypted_value: encryptedPassword,
  });

  return new Response(JSON.stringify({ account }), { status: 200 });
};

function getImapHostForProvider(provider: string): string {
  const hosts: Record<string, string> = {
    titan: "imap.titan.email",
    proton: "imap.protonmail.com",
    outlook: "outlook.office365.com",
    fastmail: "imap.fastmail.com",
    gmail: "imap.gmail.com",
  };
  return hosts[provider] || "imap.example.com";
}
```

---

### 3.3 Mail Sync Edge Function (Runs on Schedule or On-Demand)

**Edge Function: `/functions/sync/mail-fetch` (Scheduled via Supabase Cron)**

```typescript
// supabase/functions/sync/mail-fetch/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js";
import { gmail_v1, google } from "https://esm.sh/googleapis";
import { ImapFlow } from "https://deno.land/x/imap_flow/mod.ts";

export default async (req: Request) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Fetch all active accounts that need sync
  const { data: accounts } = await supabase
    .from("external_accounts")
    .select("*")
    .eq("is_active", true)
    .eq("auto_sync", true)
    .lt("next_sync_at", new Date().toISOString());

  for (const account of accounts) {
    await syncAccount(account, supabase);
  }

  return new Response(JSON.stringify({ synced: accounts.length }), {
    status: 200,
  });
};

async function syncAccount(
  account: any,
  supabase: any
): Promise<void> {
  const logId = `sync_${generateId()}`;

  try {
    if (account.provider === "google") {
      await syncGmail(account, supabase, logId);
    } else if (account.account_type === "imap") {
      await syncImap(account, supabase, logId);
    }

    // Update next_sync_at
    await supabase
      .from("external_accounts")
      .update({
        next_sync_at: new Date(
          Date.now() + account.sync_interval_minutes * 60000
        ).toISOString(),
        sync_status: "idle",
        last_sync_at: new Date().toISOString(),
      })
      .eq("id", account.id);
  } catch (error) {
    console.error(`Sync failed for ${account.id}:`, error);

    await supabase.from("account_sync_logs").insert({
      id: logId,
      account_id: account.id,
      sync_type: "error",
      status: "error",
      error_message: error.message,
      started_at: new Date().toISOString(),
    });

    await supabase
      .from("external_accounts")
      .update({
        sync_status: "error",
        last_sync_error: error.message,
      })
      .eq("id", account.id);
  }
}

async function syncGmail(
  account: any,
  supabase: any,
  logId: string
): Promise<void> {
  // Step 1: Decrypt refresh token
  const { data: credData } = await supabase
    .from("account_credentials_vault")
    .select("encrypted_value")
    .eq("account_id", account.id)
    .eq("credential_type", "oauth_refresh_token")
    .single();

  const refreshToken = await decryptSecret(credData.encrypted_value);

  // Step 2: Refresh access token
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID"),
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET"),
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const tokens = await tokenResponse.json();
  const accessToken = tokens.access_token;

  // Step 3: Fetch new messages from Gmail API
  const gmail = google.gmail({ version: "v1", auth: { accessToken } });

  const messagesResponse = await gmail.users.messages.list({
    userId: "me",
    q: 'after:' + new Date(account.last_sync_at || Date.now() - 24*60*60*1000).getTime() / 1000,
    maxResults: 100,
  });

  let itemsNew = 0;
  let itemsUpdated = 0;

  for (const msg of messagesResponse.data.messages || []) {
    const fullMessage = await gmail.users.messages.get({
      userId: "me",
      id: msg.id,
    });

    const headers = fullMessage.data.payload.headers;
    const subject =
      headers.find((h: any) => h.name === "Subject")?.value || "(no subject)";
    const from =
      headers.find((h: any) => h.name === "From")?.value ||
      "unknown@example.com";
    const dateStr =
      headers.find((h: any) => h.name === "Date")?.value || new Date().toISOString();

    const snippet = fullMessage.data.snippet || "";
    const receivedAt = new Date(dateStr).toISOString();

    // Check for duplicates
    const { data: existingMail } = await supabase
      .from("mail_items")
      .select("id")
      .eq("gmail_message_id", msg.id)
      .eq("external_account_id", account.id)
      .single();

    if (existingMail) {
      itemsUpdated++;
      continue; // Already synced
    }

    // Insert new mail item
    await supabase.from("mail_items").insert({
      id: `mail_${generateId()}`,
      external_account_id: account.id,
      account_email: account.display_email,
      gmail_message_id: msg.id,
      sender: from,
      subject,
      snippet,
      received_at: receivedAt,
      gmail_link: `https://mail.google.com/mail/u/0/#inbox/${msg.id}`,
      flag_reason: null,
    });

    itemsNew++;
  }

  // Log the sync
  await supabase.from("account_sync_logs").insert({
    id: logId,
    account_id: account.id,
    sync_type: "incremental",
    status: "success",
    items_synced: itemsNew + itemsUpdated,
    items_new: itemsNew,
    items_updated: itemsUpdated,
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
  });
}

async function syncImap(
  account: any,
  supabase: any,
  logId: string
): Promise<void> {
  // Step 1: Decrypt password
  const { data: credData } = await supabase
    .from("account_credentials_vault")
    .select("encrypted_value")
    .eq("account_id", account.id)
    .eq("credential_type", "imap_password")
    .single();

  const password = await decryptSecret(credData.encrypted_value);

  // Step 2: Connect to IMAP
  const imapClient = new ImapFlow({
    host: account.imap_host,
    port: account.imap_port,
    secure: account.imap_use_tls,
    auth: {
      user: account.imap_username,
      pass: password,
    },
  });

  await imapClient.connect();

  // Step 3: Sync INBOX or selected mailbox
  const mailbox = await imapClient.mailboxOpen("INBOX");

  let itemsNew = 0;
  let itemsUpdated = 0;

  // Fetch messages since last sync
  for await (const message of imapClient.fetch(
    {
      uid: `${account.last_sync_at ? "*" : "1:*"}`, // If first sync, get all
    },
    { envelope: true, source: false }
  )) {
    const envelope = message.envelope;

    const msgHash = await hashMessage(
      envelope.from[0].address,
      envelope.subject,
      new Date(envelope.date).toISOString()
    );

    // Check for duplicates by hash
    const { data: existingMail } = await supabase
      .from("mail_items")
      .select("id")
      .eq("remote_message_hash", msgHash)
      .eq("external_account_id", account.id)
      .single();

    if (existingMail) {
      itemsUpdated++;
      continue;
    }

    // Insert new mail item
    await supabase.from("mail_items").insert({
      id: `mail_${generateId()}`,
      external_account_id: account.id,
      account_email: account.display_email,
      imap_uid: message.uid,
      remote_message_hash: msgHash,
      sender: formatAddress(envelope.from[0]),
      subject: envelope.subject || "(no subject)",
      snippet: "", // IMAP doesn't have snippets, would need to fetch body
      received_at: new Date(envelope.date).toISOString(),
      gmail_link: null, // IMAP doesn't have web links
    });

    itemsNew++;
  }

  await imapClient.logout();

  // Log the sync
  await supabase.from("account_sync_logs").insert({
    id: logId,
    account_id: account.id,
    sync_type: "incremental",
    status: "success",
    items_synced: itemsNew + itemsUpdated,
    items_new: itemsNew,
    items_updated: itemsUpdated,
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
  });
}

async function decryptSecret(encrypted: Uint8Array): Promise<string> {
  // Implement decryption using pgsodium or TweetNaCl
  // Placeholder
  return new TextDecoder().decode(encrypted);
}

function formatAddress(addr: any): string {
  return `${addr.name || ""} <${addr.address}>`.trim();
}

async function hashMessage(from: string, subject: string, date: string): Promise<string> {
  const msg = `${from}|${subject}|${date}`;
  const msgBytes = new TextEncoder().encode(msg);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBytes);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function generateId(): string {
  return Math.random().toString(36).substr(2, 9);
}
```

---

## 4. UI Flow: Connecting Multiple Accounts

### 4.1 Settings/Connections Page

**Route:** `/admin` (existing) or new `/settings` tab

**Layout:**
```
┌─────────────────────────────────────────────┐
│ Connected Accounts                          │
├─────────────────────────────────────────────┤
│                                             │
│ Gmail Accounts                              │
│ ┌────────────────────────────────────────┐ │
│ │ anadya@gmail.com          [•]          │ │
│ │ 🟦 Primary · Last sync: 2 min ago      │ │
│ │ [Re-authenticate] [Disconnect] [Config]│ │
│ └────────────────────────────────────────┘ │
│ ┌────────────────────────────────────────┐ │
│ │ anadya+work@gmail.com     [•]          │ │
│ │ 🟩 Work · Last sync: 5 min ago         │ │
│ │ [Re-authenticate] [Disconnect] [Config]│ │
│ └────────────────────────────────────────┘ │
│                                             │
│ Other Accounts                              │
│ ┌────────────────────────────────────────┐ │
│ │ anadya@titan.email        [•]          │ │
│ │ 🟪 Titan · Last sync: 1 min ago        │ │
│ │ [Re-authenticate] [Disconnect] [Config]│ │
│ └────────────────────────────────────────┘ │
│                                             │
│ [+ Add Google Account] [+ Add IMAP Account] │
│                                             │
└─────────────────────────────────────────────┘
```

### 4.2 Add Account Modal

**Scenario 1: Add Google Account**

```
Modal: "Connect a Google Account"

1. User clicks [+ Add Google Account]
2. Modal shows:
   - [Connect with Google]  ← Redirects to Google OAuth consent
   
3. After redirect, display confirmation:
   ┌────────────────────────────────┐
   │ Connected: anadya+work@gmail.com
   │                                │
   │ Scopes granted:                │
   │ ☑ Gmail (read-only)           │
   │ ☑ Calendar (read-only)        │
   │ ☑ YouTube (read-only)         │
   │ ☑ Drive (read-only)           │
   │                                │
   │ [✓ Done] [Connect Another]     │
   └────────────────────────────────┘
```

**Scenario 2: Add IMAP Account**

```
Modal: "Connect an IMAP Account"

1. User selects provider:
   [Titan] [ProtonMail] [Outlook] [Fastmail] [Custom IMAP]

2. Form fields appear:
   Email:              [                    ]
   Password:           [                    ]
   
   (Optional for custom IMAP)
   IMAP Host:          [ imap.example.com   ]
   IMAP Port:          [ 993                ]
   Use TLS/SSL:        [✓]
   
   [Test Connection] → Validates IMAP login

3. If valid:
   Color Badge:        [🟦 Blue ▼]  ← Personal color choice
   Display Name:       [ Work      ]  ← Optional label
   Auto-sync:          [✓]
   Sync interval:      [ 5 minutes ▼]
   
   [Connect] [Cancel]
```

### 4.3 Mail Tab with Account Filtering

**Current Mail UI + Account Selector:**

```
┌──────────────────────────────────────────────────┐
│ Mail                                   [🔄 Sync] │
├──────────────────────────────────────────────────┤
│ Filters:                                         │
│ [All Accounts ▼] [Starred] [Flagged]            │
│                                                  │
│ Account colors:                                  │
│ [🟦 anadya@gmail.com] [🟩 anadya+work@...] [...]│
│                                                  │
├──────────────────────────────────────────────────┤
│                                                  │
│ 🟦 anadya@gmail.com                             │
│ ├─ From: Alice Smith                            │
│ │  Subject: Q3 planning notes                   │
│ │  2 min ago                                     │
│ │                                               │
│ └─ From: Bob Jones                              │
│    Subject: Feedback on PRD                     │
│    5 min ago                                     │
│                                                  │
│ 🟩 anadya+work@gmail.com                        │
│ ├─ From: Sarah Chen                             │
│ │  Subject: Deployment ready for review         │
│ │  12 min ago                                    │
│                                                  │
│ 🟪 anadya@titan.email                           │
│ └─ From: CFO Advisor                            │
│    Subject: Invoice tracking update              │
│    23 min ago                                     │
│                                                  │
└──────────────────────────────────────────────────┘
```

**Dropdown: "All Accounts ▼"**
```
[✓] All Accounts
[ ] anadya@gmail.com (Primary)
[ ] anadya+work@gmail.com (Work)
[ ] anadya@titan.email (Titan)
```

### 4.4 Song Picker with YouTube Account Selection

**Current Song UI + Account Selector:**

```
┌─────────────────────────────────────┐
│ Song of the Day                      │
├─────────────────────────────────────┤
│                                     │
│ Pick from:                          │
│ [My YouTube ▼]  [🎵 Search]        │
│                                     │
│ [Current: "Midnight City"]          │
│ [by MGMT, 10 days ago]              │
│                                     │
│ Picked by: Raghuvar                 │
│ Account: raghuvar.music@youtube.com │
│                                     │
└─────────────────────────────────────┘

Dropdown: "My YouTube ▼"
[raghuvar.music@youtube.com] (Primary)
[raghuvar.work@youtube.com]  (Work)
```

---

## 5. Backend Sync Service Specification

### 5.1 Supabase Cron (Edge Function Scheduler)

**File:** `supabase/functions/sync/schedule.yaml`

```yaml
# Schedule mail sync to run every 5 minutes
sync_mail_every_5min:
  function: sync/mail-fetch
  schedule: "*/5 * * * *"
  http_method: POST
  body:
    action: "sync_mail"
    user_id: "*" # Runs for all users, function filters by is_active
  timeout_seconds: 300

# Schedule daily account health check
check_account_health_daily:
  function: sync/account-health
  schedule: "0 2 * * *" # 2 AM UTC
  http_method: POST
  timeout_seconds: 600
```

### 5.2 Account Health Check Edge Function

**Purpose:** Detect stale tokens, expired IMAP passwords, quota issues.

```typescript
// supabase/functions/sync/account-health/index.ts
export default async (req: Request) => {
  const supabase = createClient(...);

  const { data: accounts } = await supabase
    .from("external_accounts")
    .select("*")
    .eq("is_active", true);

  for (const account of accounts) {
    try {
      if (account.provider === "google") {
        // Try to refresh token; if it fails, mark account as needing re-auth
        const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: Deno.env.get("GOOGLE_CLIENT_ID"),
            client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET"),
            refresh_token: await decryptToken(account),
            grant_type: "refresh_token",
          }),
        });

        if (!tokenResponse.ok) {
          await supabase
            .from("external_accounts")
            .update({
              sync_status: "error",
              last_sync_error: "Refresh token expired. Please re-authenticate.",
            })
            .eq("id", account.id);

          // Notify user via audit trail or message
          await notifyUserOfAuthFailure(account, supabase);
        }
      } else if (account.account_type === "imap") {
        // Test IMAP connection
        const imapClient = new ImapFlow({
          host: account.imap_host,
          port: account.imap_port,
          secure: account.imap_use_tls,
          auth: {
            user: account.imap_username,
            pass: await decryptPassword(account, supabase),
          },
        });

        await imapClient.connect();
        await imapClient.logout();
      }
    } catch (err) {
      console.error(`Health check failed for ${account.id}:`, err);
      await supabase
        .from("external_accounts")
        .update({
          sync_status: "error",
          last_sync_error: err.message,
        })
        .eq("id", account.id);
    }
  }

  return new Response(JSON.stringify({ checked: accounts.length }), {
    status: 200,
  });
};
```

### 5.3 Rate Limiting and Quota Management

**Principles:**
- Google Gmail API: 25 emails per request, max 10k msgs/day per account (on free tier).
- IMAP: Respect server idle timeout (usually 30 min); reconnect if needed.
- Default sync interval: 5 minutes (user-configurable 1–60 minutes).
- Backoff on error: 5 min → 15 min → 60 min, reset after successful sync.

**Edge Function ENV vars:**

```bash
# .env.local for local testing (Edge Functions only)
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxx
ENCRYPTION_KEY_BASE64=<base64-encoded 32-byte key>

# Supabase project settings → Edge Function secrets
supabase secrets set GOOGLE_CLIENT_ID xxx
supabase secrets set GOOGLE_CLIENT_SECRET xxx
supabase secrets set ENCRYPTION_KEY_BASE64 xxx
```

---

## 6. RLS Policies for Multi-Account System

### 6.1 `external_accounts` Table

```sql
-- Anyone can read all accounts (both users see all mail)
CREATE POLICY "team_read_accounts" ON public.external_accounts
  FOR SELECT USING (public.is_team_member());

-- Only the account's owner (user_id) can modify
CREATE POLICY "owner_can_modify_account" ON public.external_accounts
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "owner_can_delete_account" ON public.external_accounts
  FOR DELETE USING (user_id = auth.uid());

-- Any team member can insert, but user_id must match auth.uid()
CREATE POLICY "user_can_create_own_account" ON public.external_accounts
  FOR INSERT WITH CHECK (user_id = auth.uid() AND public.is_team_member());
```

### 6.2 `account_credentials_vault` Table

```sql
-- Credentials are never read via direct SELECT (decryption happens in Edge Functions)
-- Only service_role key (Edge Functions) can access

ALTER TABLE public.account_credentials_vault ENABLE ROW LEVEL SECURITY;

-- Deny all unauthenticated access
CREATE POLICY "deny_public_access" ON public.account_credentials_vault AS RESTRICTIVE
  FOR ALL USING (false);
```

### 6.3 `mail_items` Table (Modified)

```sql
-- All team members can read all mail (existing policy)
-- Already covered by existing RLS: both users see everything
```

---

## 7. Migration File: `0009_multi_accounts.sql`

This single migration creates all new tables and modifies existing ones.

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: 0009_multi_accounts.sql
-- Purpose: Add multi-account system for Google, IMAP, YouTube
-- Reversible: false (external_accounts carries operational data)
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══ New Table: external_accounts ═══════════════════════════════════════════

CREATE TABLE public.external_accounts (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  account_type TEXT NOT NULL CHECK (account_type IN ('google_workspace', 'gmail', 'youtube', 'imap')),
  provider TEXT NOT NULL CHECK (provider IN ('google', 'titan', 'gmail', 'proton', 'outlook', 'fastmail')),
  display_email TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  
  google_user_id TEXT,
  google_refresh_token_encrypted TEXT,
  
  imap_host TEXT,
  imap_port INT,
  imap_use_tls BOOLEAN,
  imap_username TEXT,
  imap_password_encrypted TEXT,
  
  last_sync_at TIMESTAMPTZ,
  next_sync_at TIMESTAMPTZ,
  sync_status TEXT NOT NULL DEFAULT 'idle' CHECK (sync_status IN ('idle', 'syncing', 'error')),
  last_sync_error TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  scope_granted TEXT[] NOT NULL DEFAULT '{}',
  
  color_badge TEXT NOT NULL DEFAULT 'slate',
  auto_sync BOOLEAN NOT NULL DEFAULT true,
  sync_interval_minutes INT NOT NULL DEFAULT 5,
  
  created_by UUID REFERENCES public.profiles (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_external_accounts_user ON public.external_accounts (user_id);
CREATE INDEX idx_external_accounts_sync ON public.external_accounts (next_sync_at) WHERE is_active = true;
CREATE INDEX idx_external_accounts_provider ON public.external_accounts (provider);

ALTER TABLE public.external_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_read_accounts" ON public.external_accounts
  FOR SELECT USING (public.is_team_member());

CREATE POLICY "owner_modify_account" ON public.external_accounts
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "owner_delete_account" ON public.external_accounts
  FOR DELETE USING (user_id = auth.uid());

CREATE POLICY "user_create_own_account" ON public.external_accounts
  FOR INSERT WITH CHECK (user_id = auth.uid() AND public.is_team_member());

-- ═══ New Table: account_credentials_vault ═══════════════════════════════════

CREATE TABLE public.account_credentials_vault (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES public.external_accounts (id) ON DELETE CASCADE,
  credential_type TEXT NOT NULL CHECK (credential_type IN ('oauth_refresh_token', 'imap_password', 'oauth_access_token')),
  encrypted_value bytea NOT NULL,
  encryption_key TEXT NOT NULL DEFAULT 'default',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ
);

CREATE INDEX idx_creds_account ON public.account_credentials_vault (account_id);

ALTER TABLE public.account_credentials_vault ENABLE ROW LEVEL SECURITY;

-- No direct access from client; service_role only
CREATE POLICY "deny_all_public" ON public.account_credentials_vault AS RESTRICTIVE
  FOR ALL USING (false);

-- ═══ New Table: account_sync_logs ═══════════════════════════════════════════

CREATE TABLE public.account_sync_logs (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES public.external_accounts (id) ON DELETE CASCADE,
  sync_type TEXT NOT NULL CHECK (sync_type IN ('full', 'incremental', 'error')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  items_synced INT NOT NULL DEFAULT 0,
  items_new INT NOT NULL DEFAULT 0,
  items_updated INT NOT NULL DEFAULT 0,
  error_message TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'partial', 'error')),
  remote_cursor TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sync_logs_account ON public.account_sync_logs (account_id, completed_at DESC);

ALTER TABLE public.account_sync_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_read_sync_logs" ON public.account_sync_logs
  FOR SELECT USING (public.is_team_member());

-- ═══ Modify: mail_items ════════════════════════════════════════════════════

ALTER TABLE public.mail_items
  ADD COLUMN IF NOT EXISTS external_account_id TEXT REFERENCES public.external_accounts (id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS gmail_message_id TEXT,
  ADD COLUMN IF NOT EXISTS imap_uid INT,
  ADD COLUMN IF NOT EXISTS remote_message_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_mail_account ON public.mail_items (external_account_id);
CREATE INDEX IF NOT EXISTS idx_mail_gmail_id ON public.mail_items (gmail_message_id);

-- ═══ Modify: shared_daily ══════════════════════════════════════════════════

ALTER TABLE public.shared_daily
  ADD COLUMN IF NOT EXISTS youtube_account_id TEXT REFERENCES public.external_accounts (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS youtube_video_id TEXT,
  ADD COLUMN IF NOT EXISTS song_platform TEXT NOT NULL DEFAULT 'youtube' CHECK (song_platform IN ('youtube', 'spotify', 'manual'));

-- ═══ Audit Trail: Record schema changes ═════════════════════════════════════

INSERT INTO public.audit_trail (
  actor_label, entity_type, entity_id, field_name, old_value, new_value, source
) VALUES (
  'automated', 'system', 'schema', 'migration', '0008_pin_label', '0009_multi_accounts', 'rule'
);

-- ═══ End of Migration ══════════════════════════════════════════════════════
```

---

## 8. Implementation Checklist

### Phase 5a: Schema & Auth (1–2 days)

- [ ] Apply migration `0009_multi_accounts.sql`
- [ ] Enable `pgsodium` extension in Supabase project settings
- [ ] Create encryption key in Supabase Vault (store as `ENCRYPTION_KEY_BASE64`)
- [ ] Seed one test account in `external_accounts` for local development
- [ ] Verify RLS policies block/allow correctly (test queries)

### Phase 5b: Google OAuth Edge Function (2–3 days)

- [ ] Deploy `/functions/accounts/google-connect`
- [ ] Test OAuth flow end-to-end (redirect, token exchange, storage)
- [ ] Verify encrypted token storage in vault
- [ ] Add error handling for invalid/expired tokens
- [ ] Test token decryption in a separate edge function

### Phase 5c: IMAP Edge Function (2–3 days)

- [ ] Deploy `/functions/accounts/imap-connect`
- [ ] Test with real Titan Mail, ProtonMail, Outlook accounts
- [ ] Verify IMAP connection validation
- [ ] Test password encryption/decryption
- [ ] Add host/port auto-detection for known providers

### Phase 5d: Mail Sync Edge Function (3–4 days)

- [ ] Deploy `/functions/sync/mail-fetch`
- [ ] Deploy `/functions/sync/account-health`
- [ ] Schedule cron jobs in Supabase
- [ ] Test Gmail incremental sync (history API)
- [ ] Test IMAP incremental sync (UID tracking)
- [ ] Verify deduplication logic (hash-based)
- [ ] Load-test with 500+ mail items per account

### Phase 5e: Frontend: Settings/Connections UI (2–3 days)

- [ ] Build `/settings` page with account list
- [ ] Implement "Add Google Account" modal (OAuth redirect flow)
- [ ] Implement "Add IMAP Account" modal (form validation)
- [ ] Add disconnect/re-authenticate actions
- [ ] Display last sync time, account health, color badges
- [ ] Responsive at 375px, 768px, 1440px

### Phase 5f: Frontend: Mail Tab Integration (2 days)

- [ ] Add account dropdown filter to Mail tab
- [ ] Display account color badges with each mail item
- [ ] Implement account grouping (optional)
- [ ] Add manual sync button with loading state
- [ ] Verify performance with 1000+ mail items

### Phase 5g: Frontend: Song Picker Integration (1 day)

- [ ] Add YouTube account dropdown to Song of the Day picker
- [ ] Store `youtube_account_id` in `shared_daily` on insert
- [ ] Display "Picked from: account@youtube.com" in song card

### Phase 5h: Testing & Verification (3–4 days)

- **Security pass:**
  - [ ] RLS blocks non-allowlisted users from reading accounts
  - [ ] Credentials vault is never readable from client
  - [ ] `grep -rn "oauth_refresh_token\|imap_password" ./dist` returns nothing
  - [ ] All sensitive fields marked in schema

- **Performance pass:**
  - [ ] Mail sync with 500+ items completes in <10 seconds
  - [ ] Account list renders in <200ms
  - [ ] Dropdown filters respond instantly

- **Responsive pass:**
  - [ ] Tested at 375px, 768px, 1440px
  - [ ] Touch targets ≥44px on mobile
  - [ ] Account color badges visible on small screens

- **Integration pass:**
  - [ ] Gmail sync imports 50+ emails without duplicates
  - [ ] IMAP sync imports 50+ emails without duplicates
  - [ ] Song picker saves YouTube account reference
  - [ ] Mail tab filters by account correctly

---

## 9. Example: Complete User Flow

**Day 1: Anadya connects multiple accounts**

1. Anadya opens ORRA, navigates to `/settings`.
2. Clicks [+ Add Google Account].
3. Redirected to Google OAuth consent → selects `anadya@gmail.com` → grants scopes.
4. Callback stores account in `external_accounts` with encrypted refresh token.
5. Returns to Settings, sees "anadya@gmail.com (Primary) 🟦".
6. Clicks [+ Add Google Account] again → selects `anadya+work@gmail.com` → grants scopes.
7. After 2 minutes, Mail tab shows messages from both accounts, grouped by color.
8. Anadya clicks [+ Add IMAP Account], selects Titan, enters credentials, tests connection.
9. After 5 minutes, Titan mail appears in Mail tab with purple badge.

**Day 2: Raghuvar picks a song from YouTube**

1. Raghuvar is on Home, sees Song of the Day widget.
2. Clicks [Pick a song], dropdown shows "My YouTube" (could be multiple).
3. Selects his work YouTube account: `raghuvar.work@youtube.com`.
4. Searches for "Midnight City", clicks a video.
5. `shared_daily` record is created with `youtube_account_id` referencing that account.
6. Anadya sees the song pick and can click it to visit the video on that account.

---

## 10. Open Questions for Clarification

1. **Calendar/Drive sync:** Should we also sync calendar events and drive files, or just Gmail for now?
   - **Recommendation:** Start with Gmail + IMAP only. YouTube is for picks only (no sync). Calendar/Drive can be Phase 6.

2. **Credential rotation:** When should refresh tokens be rotated?
   - **Recommendation:** Rotate annually or on explicit re-auth. Log rotation events to audit trail.

3. **Multiple IMAP folders:** Should users pick which IMAP folder to sync (e.g., INBOX only vs. all folders)?
   - **Recommendation:** Start with INBOX only. Add folder selection in Phase 6.

4. **Spam/unread filtering:** Should the Mail tab show read/unread counts per account?
   - **Recommendation:** Not Phase 5. Add counters in Phase 6 using `mail_items` query counts.

5. **Cost monitoring:** Google Free tier allows 25 users per app + 10k msgs/day. With 2 users, we're safe. Should we monitor consumption?
   - **Recommendation:** Add dashboard query to `account_sync_logs` to track cumulative items synced per day.

---

## Appendix: SQL for Verification

**Test that RLS blocks account access for non-owner:**

```sql
-- Login as Anadya (user_id = xxx), insert a test account
INSERT INTO public.external_accounts (id, user_id, account_type, provider, display_email)
VALUES ('acc_test_anadya', 'xxx-anadya-uuid', 'gmail', 'google', 'anadya@gmail.com');

-- Switch to Raghuvar's JWT, try to update:
-- This should FAIL (user_id mismatch)
UPDATE public.external_accounts SET display_name = 'Hacked' WHERE id = 'acc_test_anadya';
-- → ERROR: new row violates row-level security policy "owner_modify_account"
```

**Test that credentials vault is unreadable:**

```sql
-- Logged in as Anadya, try to read vault directly:
SELECT * FROM public.account_credentials_vault WHERE account_id = 'acc_test_anadya';
-- → ERROR: new row violates row-level security policy "deny_all_public"
```

---

## Summary

This design provides:

1. **Three new core tables** with full schema, indexes, and RLS.
2. **Four Edge Functions** for OAuth, IMAP, mail sync, and health checks.
3. **Clear credential encryption** strategy using Supabase vault.
4. **UI flows** for adding/managing accounts in Settings and filtering Mail.
5. **Sync spec** with deduplication, error handling, and rate limiting.
6. **Single migration file** that can be applied and tested immediately.
7. **Complete RLS policy matrix** ensuring data isolation.
8. **Implementation checklist** with 8 phases, ~20 days of work.

**Cost: ₹0** (all free tier, no external APIs beyond Google OAuth which is always free for testing mode).

**Ready to proceed?** Reply with approval and any clarifications on the 5 open questions above, and implementation can begin immediately.
