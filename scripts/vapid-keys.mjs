/**
 * Generate a VAPID key pair for Web Push.
 *
 *   node scripts/vapid-keys.mjs
 *
 * VAPID is how a push service knows a notification really came from this app.
 * The public key is public by design — it ships in the browser bundle and is
 * handed to the push service on subscribe. The private key signs the request
 * and must live only in Supabase's function secrets, never in the repo, never
 * in an env file that reaches the client.
 *
 * Run this once. Rotating the pair invalidates every existing subscription,
 * so both of you would have to turn notifications on again on every device.
 */
import { generateKeyPairSync } from 'node:crypto';

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pub = publicKey.export({ format: 'jwk' });
const priv = privateKey.export({ format: 'jwk' });

const b64u = (s) => Buffer.from(s, 'base64url');
// The uncompressed EC point the push spec wants: 0x04 || X || Y.
const publicKeyB64 = Buffer.concat([Buffer.from([4]), b64u(pub.x), b64u(pub.y)]).toString('base64url');

console.log(`
Public key  (Vercel env + .env as VITE_VAPID_PUBLIC_KEY):

  ${publicKeyB64}

Private key (Supabase secret — never commit, never put in .env):

  ${priv.d}

Then:

  npx supabase secrets set \\
    VAPID_PUBLIC_KEY=${publicKeyB64} \\
    VAPID_PRIVATE_KEY=${priv.d} \\
    VAPID_SUBJECT=mailto:anvik.anadya@gmail.com

  npx supabase functions deploy push
`);
