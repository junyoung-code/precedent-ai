/**
 * Decides whether this request may spend money on a model.
 *
 * There are no accounts and no payments yet. What exists here is the one place
 * that decision is made, so when accounts arrive only the inside of this
 * function changes — not the route, not the client, not the screen.
 *
 * The gate matters more than the blur it drives. A screen that hides text the
 * server already generated costs exactly as much as showing it and comes apart
 * in the network tab. When this returns false the model is never called, so the
 * hidden sentences were never written.
 */
export const ANALYSIS_LOCKED_REASON = "ANALYSIS_REQUIRES_PLAN";

export function resolveEntitlement({ env = process.env } = {}) {
  if (env.ANALYSIS_PAYWALL !== "true") return { analysis: true, reason: null };
  return { analysis: false, reason: ANALYSIS_LOCKED_REASON };
}
