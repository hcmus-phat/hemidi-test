import { FailureSimulator, SimulatedFailureError } from './failure-simulator';

describe('FailureSimulator', () => {
  function simulator(failureRate: number, randomValue: number) {
    const config = {
      failureRate,
      processingMinMs: 3000,
      processingMaxMs: 5000,
      concurrency: 5,
    };
    return new FailureSimulator(config, () => randomValue);
  }

  it('fails when the random number is below JOB_FAILURE_RATE', () => {
    expect(() => simulator(0.3, 0.29).maybeFail()).toThrow(
      SimulatedFailureError,
    );
    expect(() => simulator(0.3, 0.29).maybeFail()).toThrow(
      'Simulated random processing failure',
    );
  });

  it('succeeds when the random number is at or above JOB_FAILURE_RATE', () => {
    expect(() => simulator(0.3, 0.3).maybeFail()).not.toThrow();
    expect(() => simulator(0.3, 0.99).maybeFail()).not.toThrow();
  });

  it('never fails with a rate of 0 and always fails with a rate of 1', () => {
    expect(() => simulator(0, 0).maybeFail()).not.toThrow();
    expect(() => simulator(1, 0.999999).maybeFail()).toThrow(
      SimulatedFailureError,
    );
  });
});
