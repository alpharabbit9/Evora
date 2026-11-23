import { describe, expect, it } from 'vitest';

import { cookieTopologyProblem } from '../src/config/deployment.js';

/**
 * The production shapes in which the session cookie reaches both the storefront and the API
 * (ADR 0024). Each refused shape is one that boots fine and then loops every signed-in
 * customer back to sign-in, which is why it is refused at boot instead.
 */
describe('cookie topology', () => {
  it('accepts the API served under the storefront host', () => {
    expect(
      cookieTopologyProblem({
        frontendOrigin: 'https://shop.example.com',
        authUrl: 'https://shop.example.com',
      }),
    ).toBeNull();
  });

  it('accepts sibling subdomains that share AUTH_COOKIE_DOMAIN', () => {
    expect(
      cookieTopologyProblem({
        frontendOrigin: 'https://shop.example.com',
        authUrl: 'https://api.example.com',
        cookieDomain: 'example.com',
      }),
    ).toBeNull();
    expect(
      cookieTopologyProblem({
        frontendOrigin: 'https://example.com',
        authUrl: 'https://api.example.com',
        cookieDomain: '.example.com',
      }),
    ).toBeNull();
  });

  it('refuses two hosts without a shared cookie domain', () => {
    expect(
      cookieTopologyProblem({
        frontendOrigin: 'https://shop.example.com',
        authUrl: 'https://api.example.com',
      }),
    ).toMatch(/different hosts/);
  });

  it('refuses unrelated domains even with a cookie domain', () => {
    expect(
      cookieTopologyProblem({
        frontendOrigin: 'https://evora-shop.com',
        authUrl: 'https://evora-api.herokuapp.com',
        cookieDomain: 'evora-shop.com',
      }),
    ).toMatch(/must contain both/);
  });

  it('does not let a look-alike host pass as a subdomain', () => {
    expect(
      cookieTopologyProblem({
        frontendOrigin: 'https://shop.example.com',
        authUrl: 'https://api.notexample.com',
        cookieDomain: 'example.com',
      }),
    ).toMatch(/must contain both/);
  });

  it('refuses plain http outside a local rehearsal', () => {
    expect(
      cookieTopologyProblem({
        frontendOrigin: 'http://shop.example.com',
        authUrl: 'http://shop.example.com',
      }),
    ).toMatch(/https/);
  });

  it('allows http on localhost, which browsers treat as secure', () => {
    expect(
      cookieTopologyProblem({
        frontendOrigin: 'http://localhost:8080',
        authUrl: 'http://localhost:8080',
      }),
    ).toBeNull();
  });
});
