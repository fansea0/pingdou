import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../../../server/passwords.js';

describe('passwords', () => {
  it('hashPassword returns a scrypt-prefixed string with two hex parts', () => {
    const h = hashPassword('fansea0117');
    expect(h.startsWith('scrypt$')).toBe(true);
    const rest = h.slice('scrypt$'.length);
    const parts = rest.split('$');
    expect(parts.length).toBe(2);
    expect(parts[0].length).toBeGreaterThan(0);
    expect(parts[1].length).toBeGreaterThan(0);
  });

  it('verifyPassword accepts the correct plain', () => {
    const h = hashPassword('hello-world');
    expect(verifyPassword('hello-world', h)).toBe(true);
  });

  it('verifyPassword rejects the wrong plain', () => {
    const h = hashPassword('hello-world');
    expect(verifyPassword('goodbye', h)).toBe(false);
  });

  it('verifyPassword returns false for malformed stored hash', () => {
    expect(verifyPassword('anything', 'not-scrypt-format')).toBe(false);
    expect(verifyPassword('anything', 'scrypt$$')).toBe(false);
    expect(verifyPassword('anything', 'scrypt$aa$bb$cc')).toBe(false);
  });

  it('two hashes of the same password differ (random salt)', () => {
    expect(hashPassword('same')).not.toBe(hashPassword('same'));
  });
});
