import { config as loadDotenv } from 'dotenv';
import { join } from 'node:path';

const ENV_TEST_PATH = join(__dirname, '..', '..', '.env.test');

/**
 * Loads .env.test into process.env. Like for the app, a variable that is
 * already set in the real environment is not overridden. Called by the
 * globalSetup and, through setup-env.ts, before each test file.
 */
export function loadTestEnv(): void {
  loadDotenv({ path: ENV_TEST_PATH, quiet: true });
}

/**
 * The tests empty every table before each test. This guard makes sure they
 * can only do that to a database whose name ends with `_test`, never to the
 * dev database (e.g. when DATABASE_URL is set in the shell).
 *
 * @returns the database name
 */
export function assertTestDatabase(databaseUrl: string): string {
  const name = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  if (!/^[a-z0-9_]+_test$/.test(name)) {
    throw new Error(
      `The e2e tests empty their database: DATABASE_URL must name a database ending with _test, got "${name}"`,
    );
  }
  return name;
}
