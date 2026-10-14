import { loadTestEnv } from './test-env';

// Jest `setupFiles`: runs before each e2e test file, so the app built by the
// test reads .env.test.
loadTestEnv();
