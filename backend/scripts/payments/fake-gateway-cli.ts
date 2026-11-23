import { FakeSslcommerz } from './fake-sslcommerz.js';

/**
 * Runs the fake gateway so checkout can be tried locally with no sandbox account
 * (`npm run payments:fake-gateway`). No money moves. Add the printed lines to `backend/.env` and
 * restart the API.
 *
 * Reads `process.env` directly and does not load the application's env validation, so that it
 * stays independent of the API's configuration.
 */
const port = Number(process.env.FAKE_GATEWAY_PORT ?? 4100);
const storeId = 'local-fake-store';
const storePassword = 'local-fake-password';

const gateway = new FakeSslcommerz({ storeId, storePassword, port, autoIpn: true });

await gateway.start();

process.stdout.write(
  [
    `Fake SSLCOMMERZ gateway listening on ${gateway.baseUrl}`,
    'Add to backend/.env, then restart the API:',
    `  SSLCOMMERZ_BASE_URL=${gateway.baseUrl}`,
    `  SSLCOMMERZ_STORE_ID=${storeId}`,
    `  SSLCOMMERZ_STORE_PASSWORD=${storePassword}`,
    '',
  ].join('\n'),
);
