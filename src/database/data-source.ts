import { config as loadDotenv } from 'dotenv';
import { DataSource } from 'typeorm';
import { databaseConfig } from '../config/configuration';
import { buildTypeOrmOptions } from './typeorm.options';

/**
 * DataSource used only by the TypeORM CLI (migration:run, migration:revert,
 * migration:generate). The Nest app builds its own connection from the same
 * options in AppModule.
 *
 * Like ConfigModule, values from `.env` never override real environment
 * variables, and the environment is validated before connecting.
 */
loadDotenv({ quiet: true });

export default new DataSource(buildTypeOrmOptions(databaseConfig()));
