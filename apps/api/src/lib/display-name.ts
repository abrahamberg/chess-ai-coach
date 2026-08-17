/** Google's oauth2-proxy integration has no `preferred_username` claim to draw on
 * for personal Gmail accounts (no Workspace domain), so its legacy "User" field —
 * sent as X-Auth-Request-User / X-Forwarded-User — falls back to the numeric
 * Google account id (the OIDC `sub` claim), e.g. "108234821730984723". Surfacing
 * that verbatim is the "weird id as name" users saw after signing in with Google.
 *
 * Resolves an actual username claim when the proxy sent one, skips the legacy
 * field when it looks like an opaque id, and otherwise falls back to the local
 * part of the email address. */
export function resolveDisplayName(options: {
  preferredUsername: string | null;
  legacyUser: string | null;
  email: string;
}): string {
  if (options.preferredUsername) return options.preferredUsername;
  if (options.legacyUser && !looksLikeOpaqueId(options.legacyUser)) return options.legacyUser;
  return emailLocalPart(options.email);
}

/** Google account ids (and similar provider-internal subject ids) are long
 * runs of digits — typically 20+ for Google's `sub` claim. The 15-digit floor
 * is deliberately high: nicknames are user-editable (PATCH /api/users/me), so
 * this doubles as the auto-heal guard in user-profile.ts, and a real person
 * picking an all-digit nickname short enough to plausibly type is far more
 * likely than one that happens to be 15+ digits long. */
export function looksLikeOpaqueId(value: string): boolean {
  return /^\d{15,}$/.test(value);
}

export function emailLocalPart(email: string): string {
  const [localPart] = email.split('@');
  return localPart || email;
}
