/**
 * Passwords guard a console that holds every connection's credentials, so a
 * floor of 12 characters (length beats composition rules). The ceiling keeps
 * scrypt from being fed megabytes. Enforced where a password is *chosen* —
 * setup, user create / reset, change-password — never at login, so an
 * existing shorter password keeps working until it is changed.
 */
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 1024;

/** Why this password can't be used, or null. */
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Use at most ${MAX_PASSWORD_LENGTH} characters.`;
  }
  return null;
}
