/**
 * Types for shared/untrusted.js — bounding and labelling untrusted text.
 */

/** Marker opening the fence. */
export const UNTRUSTED_FENCE_OPEN: string;
/** Marker closing the fence. */
export const UNTRUSTED_FENCE_CLOSE: string;
/** How much of an interpolated error message reaches the context. */
export const ERROR_TEXT_BUDGET: number;
/** How much constant injected content is sent. */
export const STATIC_TEXT_BUDGET: number;

/** Truncate to `budget` characters, saying so when it did. */
export function clampText(value: unknown, budget: number): string;
/** Wrap in a fence labelled as untrusted data. */
export function fenceUntrusted(value: unknown, budget?: number): string;