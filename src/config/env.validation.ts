import {
  plainToInstance,
  Transform,
  TransformFnParams,
} from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsUrl,
  Max,
  Min,
  validateSync,
  ValidationError,
} from 'class-validator';
import { IsGreaterThanOrEqualTo } from '../common/validators/is-greater-than-or-equal-to.decorator';

export enum NodeEnv {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

/**
 * Environment values are always strings. Numeric strings become numbers; anything
 * else (including an empty string) is left untouched so that `@IsInt`/`@IsNumber`
 * reject it with a clear message instead of silently turning '' into 0.
 */
const toNumber = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' && value.trim() !== '' ? Number(value) : value;

/** Only the literal strings 'true' and 'false' are accepted as booleans. */
const toBoolean = ({ value }: TransformFnParams): unknown => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
};

const POSTGRES_URL_OPTIONS = {
  protocols: ['postgres', 'postgresql'],
  require_protocol: true,
  require_tld: false,
  allow_underscores: true,
};

const REDIS_URL_OPTIONS = {
  protocols: ['redis', 'rediss'],
  require_protocol: true,
  require_tld: false,
  allow_underscores: true,
};

/**
 * Every environment variable the API and the worker read (docs/02 §7).
 *
 * A property initializer is the default used when the variable is not set.
 * `DATABASE_URL` and `REDIS_URL` have no default on purpose: a deployment that
 * forgets them must fail at startup instead of silently connecting to localhost.
 */
export class EnvironmentVariables {
  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv = NodeEnv.Development;

  @Transform(toNumber)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT = 3000;

  // --- PostgreSQL -----------------------------------------------------------

  @IsUrl(POSTGRES_URL_OPTIONS, {
    message: 'DATABASE_URL must be a postgres:// or postgresql:// URL',
  })
  DATABASE_URL: string;

  @Transform(toBoolean)
  @IsBoolean()
  DATABASE_SSL = false;

  @Transform(toNumber)
  @IsInt()
  @Min(1)
  DATABASE_POOL_MAX = 10;

  @Transform(toBoolean)
  @IsBoolean()
  DATABASE_LOGGING = false;

  @Transform(toNumber)
  @IsInt()
  @Min(1)
  DB_LOCK_TIMEOUT_MS = 5000;

  // --- Redis / BullMQ -------------------------------------------------------

  @IsUrl(REDIS_URL_OPTIONS, {
    message: 'REDIS_URL must be a redis:// or rediss:// URL',
  })
  REDIS_URL: string;

  @Transform(toNumber)
  @IsInt()
  @Min(1)
  JOB_ATTEMPTS = 4;

  @Transform(toNumber)
  @IsInt()
  @Min(1)
  JOB_BACKOFF_DELAY_MS = 2000;

  @Transform(toNumber)
  @IsInt()
  @Min(1)
  JOB_KEEP_COMPLETED_SECONDS = 604800;

  @Transform(toNumber)
  @IsInt()
  @Min(1)
  JOB_KEEP_FAILED_SECONDS = 1209600;

  // --- Outbox relay (worker) ------------------------------------------------

  @Transform(toNumber)
  @IsInt()
  @Min(1)
  OUTBOX_POLL_INTERVAL_MS = 1000;

  @Transform(toNumber)
  @IsInt()
  @Min(1)
  OUTBOX_BATCH_SIZE = 50;

  @Transform(toNumber)
  @IsInt()
  @Min(1)
  @IsGreaterThanOrEqualTo('OUTBOX_POLL_INTERVAL_MS')
  OUTBOX_MAX_BACKOFF_MS = 30000;

  // --- Worker ---------------------------------------------------------------

  @Transform(toNumber)
  @IsInt()
  @Min(1)
  JOB_PROCESSING_MIN_MS = 3000;

  @Transform(toNumber)
  @IsInt()
  @Min(1)
  @IsGreaterThanOrEqualTo('JOB_PROCESSING_MIN_MS')
  JOB_PROCESSING_MAX_MS = 5000;

  @Transform(toNumber)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(1)
  JOB_FAILURE_RATE = 0.3;

  @Transform(toNumber)
  @IsInt()
  @Min(1)
  WORKER_CONCURRENCY = 5;

  @Transform(toNumber)
  @IsInt()
  @Min(1)
  ORDER_PENDING_TTL_MINUTES = 30;

  @Transform(toNumber)
  @IsInt()
  @Min(1)
  EXPIRE_PENDING_EVERY_MS = 300000;

  @Transform(toNumber)
  @IsInt()
  @Min(1)
  EXPIRE_BATCH_SIZE = 100;

  // --- API docs -------------------------------------------------------------

  @Transform(toBoolean)
  @IsBoolean()
  SWAGGER_ENABLED = true;
}

function formatErrors(errors: ValidationError[]): string {
  return errors
    .map((error) => {
      const messages = Object.values(error.constraints ?? {}).join('; ');
      return `  - ${error.property}: ${messages}`;
    })
    .join('\n');
}

/**
 * Parses and validates environment variables. Throws one error listing every
 * invalid variable, so a misconfigured process stops at startup.
 *
 * Used by `ConfigModule.forRoot({ validate })`, by the config namespaces in
 * configuration.ts and by the TypeORM CLI data source.
 */
export function validateEnv(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const env = plainToInstance(EnvironmentVariables, config);
  const errors = validateSync(env);

  if (errors.length > 0) {
    throw new Error(`Invalid environment variables:\n${formatErrors(errors)}`);
  }
  return env;
}
