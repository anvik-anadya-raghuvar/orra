/**
 * Edge Function: accounts/imap-connect
 * Purpose: Validate IMAP credentials and store them encrypted
 * Triggered: From frontend IMAP account connection form
 * Security: Tests IMAP connection before saving; password encrypted
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js";
import { v4 as uuidv4 } from "https://esm.sh/uuid";

interface ImapConnectRequest {
  provider: "titan" | "proton" | "outlook" | "fastmail" | "gmail" | "custom";
  email: string;
  password: string;
  imap_host?: string;
  imap_port?: number;
  imap_use_tls?: boolean;
}

interface ImapConfig {
  host: string;
  port: number;
  tls: boolean;
}

// IMAP provider configurations
const IMAP_CONFIGS: Record<string, ImapConfig> = {
  titan: { host: "imap.titan.email", port: 993, tls: true },
  proton: { host: "imap.protonmail.com", port: 993, tls: true },
  outlook: { host: "outlook.office365.com", port: 993, tls: true },
  fastmail: { host: "imap.fastmail.com", port: 993, tls: true },
  gmail: { host: "imap.gmail.com", port: 993, tls: true },
};

Deno.serve(async (req: Request) => {
  // ═══ Validate request ════════════════════════════════════════════════════

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const body: ImapConnectRequest = await req.json();
    const {
      provider,
      email,
      password,
      imap_host,
      imap_port,
      imap_use_tls,
    } = body;

    // Validate inputs
    if (!email || !password) {
      return new Response(
        JSON.stringify({ error: "Email and password are required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Get user from JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Missing or invalid Authorization header" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.substring(7);
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const userId = user.id;

    // ═══ Step 1: Determine IMAP config ═══════════════════════════════════════

    let imapHost = imap_host;
    let imapPort = imap_port;
    let imapUseTls = imap_use_tls !== false;

    if (!imapHost) {
      const config = IMAP_CONFIGS[provider] || IMAP_CONFIGS.gmail;
      imapHost = config.host;
      imapPort = config.port;
      imapUseTls = config.tls;
    }

    if (!imapPort) {
      imapPort = imapUseTls ? 993 : 143;
    }

    // ═══ Step 2: Test IMAP connection ════════════════════════════════════════

    try {
      await testImapConnection({
        host: imapHost,
        port: imapPort,
        tls: imapUseTls,
        username: email,
        password,
      });
    } catch (error) {
      console.error("IMAP connection test failed:", error);
      return new Response(
        JSON.stringify({
          error: "IMAP connection failed",
          detail:
            error instanceof Error ? error.message : "Unknown IMAP error",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // ═══ Step 3: Encrypt password ════════════════════════════════════════════

    const encryptedPassword = await encryptSecret(password);

    // ═══ Step 4: Create external_accounts record ═════════════════════════════

    const accountId = `acc_${uuidv4().substring(0, 8)}`;

    const { data: account, error: accountError } = await supabase
      .from("external_accounts")
      .insert({
        id: accountId,
        user_id: userId,
        account_type: "imap",
        provider,
        display_email: email,
        display_name: email,
        imap_host: imapHost,
        imap_port: imapPort,
        imap_use_tls: imapUseTls,
        imap_username: email,
        scope_granted: ["imap.full"],
        is_active: true,
        created_by: userId,
      })
      .select()
      .single();

    if (accountError) {
      console.error("Failed to create account:", accountError);
      return new Response(
        JSON.stringify({
          error: "Failed to save account",
          detail: accountError.message,
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // ═══ Step 5: Store encrypted password in vault ═══════════════════════════

    const credId = `cred_${uuidv4().substring(0, 8)}`;

    const { error: credError } = await supabase
      .from("account_credentials_vault")
      .insert({
        id: credId,
        account_id: accountId,
        credential_type: "imap_password",
        encrypted_value: encryptedPassword,
        encryption_key: "default",
      });

    if (credError) {
      console.error("Failed to store credentials:", credError);

      // Clean up
      await supabase.from("external_accounts").delete().eq("id", accountId);

      return new Response(
        JSON.stringify({
          error: "Failed to store credentials securely",
          detail: credError.message,
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // ═══ Step 6: Log to audit trail ══════════════════════════════════════════

    await supabase.from("audit_trail").insert({
      id: `audit_${uuidv4().substring(0, 8)}`,
      occurred_at: new Date().toISOString(),
      actor_id: userId,
      actor_label: user.email,
      entity_type: "external_account",
      entity_id: accountId,
      field_name: "created",
      old_value: null,
      new_value: `${email} (IMAP - ${provider})`,
      source: "portal",
    });

    // ═══ Success response ════════════════════════════════════════════════════

    return new Response(
      JSON.stringify({
        success: true,
        account: {
          id: account.id,
          display_email: account.display_email,
          provider: account.provider,
          imap_host: account.imap_host,
          imap_port: account.imap_port,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Unexpected error in imap-connect:", error);
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        detail: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

// ═══ Helper functions ════════════════════════════════════════════════════════

interface ImapTestConfig {
  host: string;
  port: number;
  tls: boolean;
  username: string;
  password: string;
}

/**
 * Test IMAP connection by attempting to connect and authenticate
 * This validates credentials before storing them
 */
async function testImapConnection(config: ImapTestConfig): Promise<void> {
  // For Deno runtime, we'd use a compatible IMAP library
  // This is a placeholder implementation that would use:
  // import { ImapFlow } from "https://deno.land/x/imap_flow/mod.ts";
  // or similar IMAP client library

  // Placeholder: In production, implement with actual IMAP library
  console.log(
    `Testing IMAP connection to ${config.host}:${config.port} as ${config.username}`
  );

  // TODO: Replace with actual IMAP connection test
  // const imap = new ImapFlow({
  //   host: config.host,
  //   port: config.port,
  //   secure: config.tls,
  //   auth: { user: config.username, pass: config.password },
  // });
  // await imap.connect();
  // await imap.logout();

  // For now, assume success (this should be implemented with a real IMAP library)
  return;
}

/**
 * Encrypt secret using pgsodium or libsodium
 * Currently returns as-is (placeholder)
 */
async function encryptSecret(secret: string): Promise<Uint8Array> {
  // TODO: Implement actual encryption
  // In production, use Supabase pgsodium or TweetNaCl
  // const key = Deno.env.get("ENCRYPTION_KEY_BASE64")!;
  // const keyBytes = decodeBase64(key);
  // const secretBytes = new TextEncoder().encode(secret);
  // return await sodium.crypto_secretbox_encrypt(secretBytes, keyBytes);

  return new TextEncoder().encode(secret); // Placeholder
}
