import { describe, expect, it } from 'vitest';
import { classifyInstall } from './install';

const base = { standalone: false, hasPrompt: false, touchMac: false };
const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1';
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';
const ANDROID_WEBVIEW =
  'Mozilla/5.0 (Linux; Android 14; SM-S918B; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0 Mobile Safari/537.36';
const IPHONE_INSTAGRAM = `${IPHONE_SAFARI} Instagram 330.0`;

describe('classifyInstall', () => {
  it('knows when ORRA is already on the home screen', () => {
    expect(classifyInstall(ANDROID_CHROME, { ...base, standalone: true })).toBe('installed');
  });
  it('offers one-tap install when the browser gave us a prompt', () => {
    expect(classifyInstall(ANDROID_CHROME, { ...base, hasPrompt: true })).toBe('prompt');
  });
  it('falls back to the menu route on Android without a prompt', () => {
    expect(classifyInstall(ANDROID_CHROME, base)).toBe('android-manual');
  });
  it('sends iPhone Safari to the Share sheet', () => {
    expect(classifyInstall(IPHONE_SAFARI, base)).toBe('ios-safari');
  });
  it('recognises Chrome on iPhone', () => {
    expect(classifyInstall(IPHONE_CHROME, base)).toBe('ios-other');
  });
  it('spots in-app browsers that cannot install', () => {
    expect(classifyInstall(ANDROID_WEBVIEW, base)).toBe('in-app');
    expect(classifyInstall(IPHONE_INSTAGRAM, base)).toBe('in-app');
  });
  it('treats an iPad reporting as a Mac as iOS', () => {
    const ipadAsMac =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
    expect(classifyInstall(ipadAsMac, { ...base, touchMac: true })).toBe('ios-safari');
  });
});
