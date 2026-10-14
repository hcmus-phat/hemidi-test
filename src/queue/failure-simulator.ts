import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import {
  RANDOM_SOURCE,
  type RandomSource,
} from '../common/utils/random-source';
import { workerConfig } from '../config/configuration';

/** The error of a simulated failure. BullMQ retries the job after it. */
export class SimulatedFailureError extends Error {
  override readonly name = 'SimulatedFailureError';
}

/**
 * Simulates the random failures of an external system while an order is
 * processed (FR-Q03), so retries and the final-attempt handling can be seen.
 */
@Injectable()
export class FailureSimulator {
  constructor(
    @Inject(workerConfig.KEY)
    private readonly config: ConfigType<typeof workerConfig>,
    @Inject(RANDOM_SOURCE) private readonly random: RandomSource,
  ) {}

  /**
   * Throws with probability JOB_FAILURE_RATE: never with 0, always with 1
   * (the random number is in [0, 1)).
   */
  maybeFail(): void {
    if (this.random() < this.config.failureRate) {
      throw new SimulatedFailureError('Simulated random processing failure');
    }
  }
}
