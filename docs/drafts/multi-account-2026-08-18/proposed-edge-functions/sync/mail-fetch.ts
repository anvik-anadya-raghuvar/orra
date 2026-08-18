/**
 * Edge Function: sync/mail-fetch
 * Purpose: Sync mail from all active external accounts (Gmail and IMAP)
 * Triggered: By Supabase Cron (default: every 5 minutes)
 * Runtime: Long-running, may take up to 5 minutes
 * Idempotent: Deduplication via gmail_message_id or remote_message_hash
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js";
import { v4 as uuidv4 } from "https://esm.sh/uuid";

interface ExternalAccount {
  id: string;
  user_id: string;
  account_type: string;
  provider: string;
  display_email: string;
  google_user_id?: string;
  imap_host?: string;
  imap_port?: number;
  imap_use_tls?: boolean;
  imap_username?: string;
  last_sync_at?: string;
  sync_interval_minutes: number;
}

Deno.serve(async (req: Request) => {
  // Note: This function runs on a schedule with service_role key
  // No need for user authentication

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );

  try {
    // ═══ Fetch all active accounts ready for sync ═════════════════════════

    const now = new Date().toISOString();
    const { data: accounts, error: fetchError } = await supabase
      .from("external_accounts")
      .select("*")
      .eq("is_active", true)
      .eq("auto_sync", true)
      .or(`last_sync_at.is.null,next_sync_at.lt.${now}`);

    if (fetchError) {
      console.error("Failed to fetch accounts:", fetchError);
      throw fetchError;
    }

    console.log(
      `Mail sync: Found ${accounts?.length || 0} accounts ready to sync`
    );

    if (!accounts || accounts.length === 0) {
      return new Response(
        JSON.stringify({ synced: 0, message: "No accounts ready to sync" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // ═══ Sync each account ═════════════════════════════════════════════════

    const results = [];
    for (const account of accounts as ExternalAccount[]) {
      try {
        if (account.provider === "google") {
          await syncGmailAccount(account, supabase);
        } else if (account.account_type === "imap") {
          await syncImapAccount(account, supabase);
        }
        results.push({ account_id: account.id, status: "success" });
      } catch (error) {
        console.error(`Sync failed for ${account.id}:`, error);
        results.push({
          account_id: account.id,
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return new Response(JSON.stringify({ synced: results.length, results }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Unexpected error in mail-fetch:", error);
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        detail: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

// ═══ Gmail Sync ══════════════════════════════════════════════════════════════

/**
 * Sync Gmail account using Gmail API
 * Uses history ID for incremental sync if available
 */
async function syncGmailAccount(
  account: ExternalAccount,
  supabase: any
): Promise<void> {
  const logId = `sync_${uuidv4().substring(0, 8)}`;
  const startTime = new Date();

  try {
    // Step 1: Get encrypted refresh token from vault
    const { data: credData, error: credError } = await supabase
      .from("account_credentials_vault")
      .select("encrypted_value")
      .eq("account_id", account.id)
      .eq("credential_type", "oauth_refresh_token")
      .single();

    if (credError || !credData) {
      throw new Error("No refresh token found for account");
    }

    // Step 2: Decrypt and refresh access token
    const refreshToken = await decryptSecret(credData.encrypted_value);
    const accessToken = await refreshGoogleToken(refreshToken);

    // Step 3: Fetch messages from Gmail API
    let itemsNew = 0;
    let itemsUpdated = 0;

    // Build query: messages since last sync
    const query = account.last_sync_at
      ? `after:${Math.floor(new Date(account.last_sync_at).getTime() / 1000)}`
      : "in:all";

    const gmailMessages = await fetchGmailMessages(accessToken, query);

    console.log(
      `Gmail ${account.display_email}: Found ${gmailMessages.length} messages`
    );

    // Step 4: Process each message
    for (const msg of gmailMessages) {
      // Check if already synced
      const { data: existing } = await supabase
        .from("mail_items")
        .select("id")
        .eq("gmail_message_id", msg.id)
        .eq("external_account_id", account.id)
        .single();

      if (existing) {
        itemsUpdated++;
        continue;
      }

      // Fetch full message details
      const fullMsg = await fetchGmailMessage(accessToken, msg.id);
      const headers = fullMsg.payload?.headers || [];
      const subject =
        findHeader(headers, "Subject") || "(no subject)";
      const sender = findHeader(headers, "From") || "unknown@example.com";
      const dateStr = findHeader(headers, "Date") || new Date().toISOString();

      // Insert mail item
      const { error: insertError } = await supabase
        .from("mail_items")
        .insert({
          id: `mail_${uuidv4().substring(0, 8)}`,
          external_account_id: account.id,
          account_email: account.display_email,
          gmail_message_id: msg.id,
          sender,
          subject,
          snippet: fullMsg.snippet || "",
          received_at: new Date(dateStr).toISOString(),
          gmail_link: `https://mail.google.com/mail/u/0/#inbox/${msg.id}`,
        });

      if (!insertError) {
        itemsNew++;
      } else {
        console.error(
          `Failed to insert mail item for ${msg.id}:`,
          insertError
        );
      }
    }

    // Step 5: Log sync completion
    await supabase.from("account_sync_logs").insert({
      id: logId,
      account_id: account.id,
      sync_type: "incremental",
      status: "success",
      items_synced: itemsNew + itemsUpdated,
      items_new: itemsNew,
      items_updated: itemsUpdated,
      started_at: startTime.toISOString(),
      completed_at: new Date().toISOString(),
    });

    // Step 6: Update account next_sync_at
    await supabase
      .from("external_accounts")
      .update({
        last_sync_at: new Date().toISOString(),
        next_sync_at: new Date(
          Date.now() + account.sync_interval_minutes * 60000
        ).toISOString(),
        sync_status: "idle",
      })
      .eq("id", account.id);

    console.log(`Gmail ${account.display_email}: Synced ${itemsNew} new items`);
  } catch (error) {
    console.error(`Gmail sync error for ${account.id}:`, error);

    // Log error
    await supabase.from("account_sync_logs").insert({
      id: logId,
      account_id: account.id,
      sync_type: "error",
      status: "error",
      error_message:
        error instanceof Error ? error.message : String(error),
      started_at: startTime.toISOString(),
    });

    // Update account status
    await supabase
      .from("external_accounts")
      .update({
        sync_status: "error",
        last_sync_error: error instanceof Error ? error.message : String(error),
      })
      .eq("id", account.id);

    throw error;
  }
}

// ═══ IMAP Sync ═══════════════════════════════════════════════════════════════

/**
 * Sync IMAP account
 * Uses UID tracking for incremental sync
 */
async function syncImapAccount(
  account: ExternalAccount,
  supabase: any
): Promise<void> {
  const logId = `sync_${uuidv4().substring(0, 8)}`;
  const startTime = new Date();

  try {
    // Step 1: Get encrypted password from vault
    const { data: credData, error: credError } = await supabase
      .from("account_credentials_vault")
      .select("encrypted_value")
      .eq("account_id", account.id)
      .eq("credential_type", "imap_password")
      .single();

    if (credError || !credData) {
      throw new Error("No IMAP password found for account");
    }

    // Step 2: Decrypt password
    const password = await decryptSecret(credData.encrypted_value);

    // Step 3: Connect to IMAP server (placeholder)
    console.log(
      `IMAP ${account.display_email}: Connecting to ${account.imap_host}:${account.imap_port}`
    );

    // TODO: Implement actual IMAP connection and fetch
    // This would use an IMAP library like imap_flow
    // For now, log and skip

    let itemsNew = 0;
    let itemsUpdated = 0;

    // Step 4: Log sync completion
    await supabase.from("account_sync_logs").insert({
      id: logId,
      account_id: account.id,
      sync_type: "incremental",
      status: "success",
      items_synced: itemsNew + itemsUpdated,
      items_new: itemsNew,
      items_updated: itemsUpdated,
      started_at: startTime.toISOString(),
      completed_at: new Date().toISOString(),
    });

    // Step 5: Update account next_sync_at
    await supabase
      .from("external_accounts")
      .update({
        last_sync_at: new Date().toISOString(),
        next_sync_at: new Date(
          Date.now() + account.sync_interval_minutes * 60000
        ).toISOString(),
        sync_status: "idle",
      })
      .eq("id", account.id);

    console.log(`IMAP ${account.display_email}: Synced ${itemsNew} new items`);
  } catch (error) {
    console.error(`IMAP sync error for ${account.id}:`, error);

    // Log error
    await supabase.from("account_sync_logs").insert({
      id: logId,
      account_id: account.id,
      sync_type: "error",
      status: "error",
      error_message:
        error instanceof Error ? error.message : String(error),
      started_at: startTime.toISOString(),
    });

    // Update account status
    await supabase
      .from("external_accounts")
      .update({
        sync_status: "error",
        last_sync_error: error instanceof Error ? error.message : String(error),
      })
      .eq("id", account.id);

    throw error;
  }
}

// ═══ Helper functions ════════════════════════════════════════════════════════

/**
 * Refresh Google OAuth access token using refresh token
 */
async function refreshGoogleToken(refreshToken: string): Promise<string> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(
      `Token refresh failed: ${error.error} - ${error.error_description}`
    );
  }

  const tokens = await response.json();
  return tokens.access_token;
}

/**
 * Fetch message list from Gmail API
 */
async function fetchGmailMessages(
  accessToken: string,
  query: string
): Promise<Array<{ id: string }>> {
  // TODO: Call Gmail API messages.list
  // For now, return empty
  return [];
}

/**
 * Fetch full message details from Gmail API
 */
async function fetchGmailMessage(
  accessToken: string,
  messageId: string
): Promise<any> {
  // TODO: Call Gmail API messages.get
  // For now, return empty
  return { payload: { headers: [] }, snippet: "" };
}

/**
 * Find header value in Gmail message headers
 */
function findHeader(
  headers: Array<{ name: string; value: string }>,
  name: string
): string | null {
  return headers.find((h) => h.name === name)?.value || null;
}

/**
 * Decrypt secret (placeholder)
 */
async function decryptSecret(encrypted: Uint8Array): Promise<string> {
  // TODO: Implement actual decryption with pgsodium/libsodium
  return new TextDecoder().decode(encrypted);
}
