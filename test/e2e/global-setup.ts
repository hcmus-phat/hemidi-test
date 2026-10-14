import { DataSource } from 'typeorm';
import { databaseConfig } from '../../src/config/configuration';
import { buildTypeOrmOptions } from '../../src/database/typeorm.options';
import { assertTestDatabase, loadTestEnv } from './test-env';

/**
 * Jest globalSetup of the e2e tests, run once before all test files:
 * creates the test database if it is missing, then runs the migrations on it
 * with the same options as the TypeORM CLI (npm run migration:run).
 */
export default async function globalSetup(): Promise<void> {
  loadTestEnv();
  const db = databaseConfig();
  const name = assertTestDatabase(db.url);
  await createDatabaseIfMissing(db.url, db.ssl, name);

  const dataSource = new DataSource(buildTypeOrmOptions(db));
  await dataSource.initialize();
  try {
    const migrations = await dataSource.runMigrations();
    if (migrations.length > 0) {
      console.log(`e2e: ran ${migrations.length} migration(s) on ${name}`);
    }
  } finally {
    await dataSource.destroy();
  }
}

/**
 * docker/postgres/init creates the test database, but only when the volume
 * is created. An older volume does not have it: create it here, through the
 * `postgres` maintenance database of the same server.
 */
async function createDatabaseIfMissing(
  databaseUrl: string,
  ssl: boolean,
  name: string,
): Promise<void> {
  const maintenanceUrl = new URL(databaseUrl);
  maintenanceUrl.pathname = '/postgres';
  const admin = new DataSource({
    type: 'postgres',
    url: maintenanceUrl.toString(),
    ssl,
  });
  await admin.initialize();
  try {
    const rows: unknown[] = await admin.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [name],
    );
    if (rows.length === 0) {
      // CREATE DATABASE takes no bind parameter. The name is safe to quote:
      // assertTestDatabase only accepts [a-z0-9_].
      await admin.query(`CREATE DATABASE "${name}"`);
      console.log(`e2e: created database ${name}`);
    }
  } finally {
    await admin.destroy();
  }
}
