import { Injectable } from '@nestjs/common';

/**
 * Waits for a given time. A provider rather than a bare setTimeout, so tests
 * can replace it and run without waiting (docs/02 §8, ADR-027).
 */
@Injectable()
export class Sleeper {
  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
