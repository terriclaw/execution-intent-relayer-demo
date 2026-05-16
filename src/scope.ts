// src/scope.ts
// Scope check logic for grant envelope validation.
//
// These checks are offchain/demo-only.
// They verify the proposed execution stays inside the declared grant envelope.
// They are NOT a substitute for onchain delegation verification.

import type { GrantEnvelope, ScopeCheck, ScopeCheckCode } from "./types.js";

export function runScopeChecks(
  grant:       GrantEnvelope,
  execTarget:  string,
  execValue:   bigint,
  signer:      string,
  deadline:    bigint,
): ScopeCheck[] {
  const checks: ScopeCheck[] = [];
  const now = BigInt(Math.floor(Date.now() / 1000));

  // SIGNER_IS_DELEGATE
  checks.push({
    code: "SIGNER_IS_DELEGATE",
    pass: signer.toLowerCase() === grant.delegate.toLowerCase(),
    detail: signer.toLowerCase() === grant.delegate.toLowerCase()
      ? `signer matches delegate`
      : `signer ${signer} does not match delegate ${grant.delegate}`,
  });

  // TARGET_ALLOWED
  if (grant.allowedTargets && grant.allowedTargets.length > 0) {
    const allowed = grant.allowedTargets.map(t => t.toLowerCase());
    const pass = allowed.includes(execTarget.toLowerCase());
    checks.push({
      code:   "TARGET_ALLOWED",
      pass,
      detail: pass
        ? `target ${execTarget} is in allowedTargets`
        : `target ${execTarget} not in allowedTargets`,
    });
  }

  // VALUE_WITHIN_LIMIT
  if (grant.maxValue !== undefined) {
    const max  = BigInt(grant.maxValue);
    const pass = execValue <= max;
    checks.push({
      code:   "VALUE_WITHIN_LIMIT",
      pass,
      detail: pass
        ? `value ${execValue} <= maxValue ${max}`
        : `value ${execValue} exceeds maxValue ${max}`,
    });
  }

  // GRANT_NOT_EXPIRED
  if (grant.expiry !== undefined) {
    const expiry = BigInt(grant.expiry);
    const pass   = now <= expiry;
    checks.push({
      code:   "GRANT_NOT_EXPIRED",
      pass,
      detail: pass
        ? `grant valid until ${expiry}`
        : `grant expired at ${expiry}, now is ${now}`,
    });
  }

  // DEADLINE_WITHIN_GRANT
  if (grant.expiry !== undefined) {
    const expiry = BigInt(grant.expiry);
    const pass   = deadline <= expiry;
    checks.push({
      code:   "DEADLINE_WITHIN_GRANT",
      pass,
      detail: pass
        ? `intent deadline ${deadline} is within grant expiry ${expiry}`
        : `intent deadline ${deadline} exceeds grant expiry ${expiry}`,
    });
  }

  return checks;
}

export function scopeValid(checks: ScopeCheck[]): boolean {
  return checks.every(c => c.pass);
}
