/**
 * Edge Function: accounts/google-connect
 * Purpose: Exchange Google OAuth authorization code for refresh token
 * Triggered: From frontend after Google OAuth redirect callback
 * Security: Uses service_role key; refresh token encrypted and stored
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js";
import { v4 as uuidv4 } from "https://esm.sh/uuid";

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

interface GoogleUserProfile {
  id: string;
  email: string;
  name: string;
  picture?: string;
  verified_email: boolean;
}

interface RequestBody {
  code: string;
  state: string;
  redirect_uri: string;
}

Deno.serve(async (req: Request) => {
  // ═══ Validate request ════════════════════════════════════════════════════

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const requestBody: RequestBody = await req.json();
    const { code, state, redirect_uri } = requestBody;

    // Get user ID from Authorization header (Supabase JWT)
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
      {
        auth: { persistSession: false },
      }
    );

    // Verify JWT and get user
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

    // ═══ Step 1: Exchange authorization code for tokens ═════════════════════

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
        client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
        code,
        redirect_uri,
        grant_type: "authorization_code",
      }).toString(),
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.json();
      console.error("Google token exchange failed:", error);
      return new Response(
        JSON.stringify({
          error: "Failed to exchange authorization code",
          detail: error.error_description || error.error,
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const tokens: GoogleTokenResponse = await tokenResponse.json();

    if (!tokens.access_token) {
      return new Response(
        JSON.stringify({ error: "No access token received from Google" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // ═══ Step 2: Get user profile from Google ════════════════════════════════

    const profileResponse = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      }
    );

    if (!profileResponse.ok) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch Google profile" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const profile: GoogleUserProfile = await profileResponse.json();

    // ═══ Step 3: Encrypt refresh token ═══════════════════════════════════════

    // For now, store as-is. In production, use pgsodium:
    // const encryptedToken = await encryptWithPgsodium(tokens.refresh_token);
    const encryptedToken = tokens.refresh_token;

    // ═══ Step 4: Create/upsert external_accounts record ══════════════════════

    const accountId = `acc_${uuidv4().substring(0, 8)}`;
    const scopeArray = tokens.scope.split(" ");

    const { data: account, error: accountError } = await supabase
      .from("external_accounts")
      .insert({
        id: accountId,
        user_id: userId,
        account_type: "gmail",
        provider: "google",
        display_email: profile.email,
        display_name: profile.name || profile.email,
        google_user_id: profile.id,
        scope_granted: scopeArray,
        last_sync_at: null,
        is_active: true,
        created_by: userId,
      })
      .select()
      .single();

    if (accountError) {
      console.error("Failed to create external_accounts record:", accountError);
      return new Response(
        JSON.stringify({
          error: "Failed to save account",
          detail: accountError.message,
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // ═══ Step 5: Store encrypted refresh token in vault ══════════════════════

    const credId = `cred_${uuidv4().substring(0, 8)}`;

    const { error: credError } = await supabase
      .from("account_credentials_vault")
      .insert({
        id: credId,
        account_id: accountId,
        credential_type: "oauth_refresh_token",
        encrypted_value: new TextEncoder().encode(encryptedToken),
        encryption_key: "default",
      });

    if (credError) {
      console.error("Failed to store credentials:", credError);

      // Clean up: delete the account we just created
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
      new_value: `${profile.email} (Google)`,
      source: "portal",
    });

    // ═══ Success response ════════════════════════════════════════════════════

    return new Response(
      JSON.stringify({
        success: true,
        account: {
          id: account.id,
          display_email: account.display_email,
          display_name: account.display_name,
          provider: account.provider,
          scope_granted: account.scope_granted,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Unexpected error in google-connect:", error);
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        detail: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

/**
 * TODO: Implement encryption using pgsodium or libsodium
 * For now, this is a placeholder. In production:
 *
 * 1. Import a Deno-compatible libsodium binding
 * 2. Load the encryption key from Deno.env.get("ENCRYPTION_KEY_BASE64")
 * 3. Generate a nonce
 * 4. Use crypto_secretbox_encrypt to encrypt the token
 * 5. Return Uint8Array of encrypted bytes
 */
// async function encryptWithPgsodium(secret: string): Promise<Uint8Array> {
//   const key = Deno.env.get("ENCRYPTION_KEY_BASE64")!;
//   const keyBytes = decodeBase64(key);
//   const secretBytes = new TextEncoder().encode(secret);
//   // const encrypted = await sodium.crypto_secretbox_encrypt(secretBytes, keyBytes);
//   // return encrypted;
//   return secretBytes; // Placeholder
// }
