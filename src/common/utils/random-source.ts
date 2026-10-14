/** A source of random numbers in [0, 1), like Math.random. */
export type RandomSource = () => number;

/**
 * Injection token of the RandomSource (Math.random in the worker). Code that
 * draws random numbers injects it, so tests can choose the outcome
 * (docs/02 §8, ADR-027).
 */
export const RANDOM_SOURCE = Symbol('RANDOM_SOURCE');
