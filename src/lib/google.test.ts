import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SCOPES,
  adoptAccountToken,
  extractGmailBodies,
  getAccountToken,
  gmailLink,
  hasLiveAccountToken,
  searchAllDrives,
  toGmailMessage,
  type GmailRawMessage,
} from './google';

const b64url = (value: string) =>
  btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

afterEach(() => vi.unstubAllGlobals());

describe('account token isolation', () => {
  it('never lends one account token to another account or scope', async () => {
    adoptAccountToken('token-account-a', {
      token: 'secret-a',
      expiresAt: Date.now() + 60_000,
      scopes: new Set([SCOPES.gmail]),
    });
    adoptAccountToken('token-account-b', {
      token: 'secret-b',
      expiresAt: Date.now() + 60_000,
      scopes: new Set([SCOPES.drive]),
    });

    expect(await getAccountToken('token-account-a', ['gmail'])).toBe('secret-a');
    expect(await getAccountToken('token-account-b', ['gmail'])).toBeNull();
    expect(hasLiveAccountToken('token-account-a', ['drive'])).toBe(false);
  });

  it('treats expired tokens as reconnect-required', async () => {
    adoptAccountToken('expired-account', {
      token: 'expired-secret',
      expiresAt: Date.now() - 1,
      scopes: new Set([SCOPES.gmail]),
    });
    expect(await getAccountToken('expired-account', ['gmail'])).toBeNull();
  });
});

describe('Gmail MIME handling', () => {
  it('decodes nested text and HTML but never reads attachment bytes', () => {
    const raw: GmailRawMessage = {
      id: 'm1',
      threadId: 't1',
      payload: {
        mimeType: 'multipart/mixed',
        parts: [
          { mimeType: 'text/plain', body: { data: b64url('Order ABC123 shipped') } },
          { mimeType: 'text/html', body: { data: b64url('<p>Arrives <b>tomorrow</b></p>') } },
          {
            mimeType: 'application/pdf',
            filename: 'invoice.pdf',
            body: { data: b64url('DO NOT READ ATTACHMENT'), attachmentId: 'attachment-1' },
          },
        ],
      },
    };
    const bodies = extractGmailBodies(raw);
    expect(bodies.text).toContain('Order ABC123 shipped');
    expect(bodies.html).toContain('Arrives');
    expect(`${bodies.text}${bodies.html}`).not.toContain('DO NOT READ ATTACHMENT');
  });

  it('falls back to HTML text and builds the correct account-specific Gmail URL', () => {
    const raw: GmailRawMessage = {
      id: 'm2',
      threadId: 't2',
      internalDate: '1787101200000',
      payload: {
        headers: [
          { name: 'From', value: 'Shop <orders@shop.example>' },
          { name: 'Subject', value: 'Delivered' },
        ],
        mimeType: 'text/html',
        body: { data: b64url('<div>Your parcel &amp; receipt</div>') },
      },
    };
    expect(extractGmailBodies(raw).text).toBe('Your parcel & receipt');
    expect(toGmailMessage(raw, 'work+orders@example.com').link).toBe(
      gmailLink('work+orders@example.com', 'm2'),
    );
    expect(gmailLink('work+orders@example.com', 'm2')).toContain('authuser=work%2Borders%40example.com');
  });
});

describe('federated Drive search', () => {
  it('returns one account results when another account fails', async () => {
    adoptAccountToken('drive-account-ok', {
      token: 'drive-token-ok',
      expiresAt: Date.now() + 600_000,
      scopes: new Set([SCOPES.drive]),
    });
    adoptAccountToken('drive-account-fail', {
      token: 'drive-token-fail',
      expiresAt: Date.now() + 600_000,
      scopes: new Set([SCOPES.drive]),
    });
    vi.stubGlobal('fetch', vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const auth = String((init?.headers as Record<string, string>)?.Authorization ?? '');
      if (auth.includes('drive-token-fail')) throw new Error('account needs reconnect');
      return new Response(JSON.stringify({
        files: [{ id: 'file-1', name: 'Passport', mimeType: 'application/pdf', webViewLink: 'https://drive.example/file-1', modifiedTime: '2026-08-19T10:00:00Z' }],
      }), { status: 200 });
    }));

    const result = await searchAllDrives([
      { id: 'drive-account-ok', email: 'ok@example.com' },
      { id: 'drive-account-fail', email: 'fail@example.com' },
    ], 'passport');
    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toMatchObject({ accountId: 'drive-account-ok', accountEmail: 'ok@example.com' });
    expect(result.errors).toEqual([{ accountId: 'drive-account-fail', message: 'account needs reconnect' }]);
  });
});
