# Full Multi-User RBAC — Design Spec

**Goal:** Turn Baklava from a single shared-password console into a multi-user
system: per-user login, global roles, per-connection access grants, an admin
user-management UI, and a clean migration from the existing single-password
install. The acting user is threaded through sessions, the AI gate, audit, and
connection visibility.

**Status:** approved decisions below; drives the implementation plan.

## Decisions (locked)

1. **User store.** New file `~/.baklava/users.json`, written through
   `writeSecretFileSync` / `readSecretFileSync` (encrypted envelope, same as
   connections.json). Shape:
   ```ts
   interface UserRecord {
     id: string;            // base64url, 12 bytes
     username: string;      // unique, case-insensitive, [a-z0-9._-], 1..64
     passwordHash: string;  // hex scrypt(password, salt), 64 bytes
     salt: string;          // hex, 16 bytes
     role: "admin" | "member";
     disabled: boolean;
     createdAt: number;
     updatedAt: number;
   }
   interface UsersState { version: 1; users: UserRecord[] }
   ```
   Password hashing reuses the exact scrypt scheme already in `auth.json`
   (`scryptSync(pw, salt, 64)`), so migration can move a hash verbatim.

2. **auth.json slims down.** After migration, `auth.json` keeps `version`,
   `secret` (session HMAC key), `enabled`. The legacy `passwordHash`/`salt`/
   `mustChange` fields stay readable for migration but are no longer the source
   of truth. `getAuthSecret()` / `isAuthEnabled()` / `setAuthEnabled()` are
   unchanged.

3. **Roles (global).**
   - `admin`: manage users, toggle the global security gate, see and manage all
     connections, and is implicitly granted `write` access to every connection.
   - `member`: can only see connections they own or that an admin/owner granted
     them; capabilities on each connection are bounded by the grant.

4. **Per-connection access grants (members).** New file
   `~/.baklava/connection-access.json` (encrypted), shape
   `{ version: 1, grants: { [connectionId]: { [userId]: "read" | "write" } } }`.
   - Connection owner (`ownerId`) and admins implicitly have `write`.
   - `read` lets a member view the connection + run read operations + read-only
     AI tools. `write` additionally allows write/destructive (still subject to
     the connection's AI policy + the destructive approval gate).

5. **Connection ownership.** Add optional `ownerId?: string` to
   `ConnectionRecord`. New connections record the creating user as owner.
   `listConnections` gains an optional `viewerUserId` filter:
   - admin → all connections;
   - member → connections where `ownerId === userId` OR a grant exists.
   Legacy connections with no `ownerId` are visible to admins only (and an admin
   can claim/assign them via the access UI).

6. **Sessions carry the user.** `SessionRecord` gains `userId: string`.
   `createSession(userId, userAgent)`. `verifySession` still returns boolean for
   the proxy; a new `getSession(id)` returns the record (with `userId`). Cookie
   format and HMAC are unchanged. Existing sessions without a `userId` are
   treated as belonging to the migrated admin (single-user installs) — but to be
   safe, migration revokes all existing sessions so everyone re-logs in once.

7. **Login.** `POST /api/auth/login { username?, password }`.
   - If `username` omitted AND exactly one (enabled) user exists → use that user
     (password-only back-compat).
   - Otherwise require `username`; resolve case-insensitively; reject disabled.
   - Verify against that user's hash; on success `createSession(user.id, ua)`.
   - Rate limit unchanged (per-IP). Same generic 401 on any failure (no user
     enumeration: identical timing + message for unknown user vs bad password).

8. **Setup (first run).** `POST /api/auth/setup { username, newPassword }`
   creates the first user as `admin`. `needsSetup()` is true when no users exist
   (and no legacy password to migrate). The login page setup form gains a
   username field.

9. **Change password.** `POST /api/auth/change-password` changes the CURRENT
   user's password (verify current, set new, revoke that user's other sessions,
   re-issue). Admins reset OTHER users' passwords via the users API (which
   revokes that user's sessions).

10. **Current-user resolution.** New server helper
    `getCurrentUser(req): Promise<UserRecord | null>` in `src/lib/auth/current-user.ts`
    — reads the cookie, `sessionIdFromToken` → `getSession` → `userId` → user.
    Route handlers that need identity/role call it. A `requireUser` /
    `requireAdmin` pair returns the user or throws a typed 401/403.

11. **AI gate.** `GateContext` gains `userId` and `connectionAccess: "none" |
    "read" | "write"`. Effective permission:
    `isAllowed(category, policy) && accessAllows(category, connectionAccess)`
    where `accessAllows("read", a) = a !== "none"`,
    `accessAllows("write"|"destructive", a) = a === "write"`. Audit entries log
    `userId`. The kill switch, rate limits, and destructive approval are
    unchanged (they still apply on top).

12. **User management API.**
    - `GET /api/users` (admin) → list (no hashes).
    - `POST /api/users` (admin) `{ username, password, role }` → create.
    - `PATCH /api/users/[id]` (admin) `{ role?, disabled?, password? }` → update;
      changing role/disabled/password revokes that user's sessions; an admin
      cannot demote or disable the last remaining admin.
    - `DELETE /api/users/[id]` (admin) → delete + revoke sessions + reassign or
      drop their owned-connection ownership to the acting admin; cannot delete
      the last admin or yourself.
    - `GET /api/users/me` → current user (id, username, role).

13. **Connection access API.**
    - `GET /api/connections/[id]/access` (owner/admin) → owner + grants
      (usernames resolved).
    - `PUT /api/connections/[id]/access` (owner/admin) `{ grants: {userId: level} }`.
    Deleting a connection drops its grants (extend the existing DELETE cascade).

14. **UI.**
    - Login/setup page: add a username field (setup always; login shown when >1
      user exists — when exactly one user exists, keep password-only).
    - Settings: new **Users** tab (admin only) — list users, add user, change
      role, enable/disable, reset password, delete. Reuses Card + Badge + Button.
    - Settings header: show the current user (username + role badge) and keep
      the existing logout control.
    - Connection management (home sheet / settings): an **Access** control on
      each connection (owner/admin) to manage grants. Members see only their
      connections.

15. **Out of scope (YAGNI for this pass):** custom roles beyond admin/member,
    SSO/OAuth, per-row data permissions, audit-log viewer UI, password
    complexity rules (kept absent, matching current product choice).

## Migration (one-time, automatic, idempotent)

On first `getUsers()` after upgrade, if `users.json` is absent:
- If `auth.json` has a non-empty `passwordHash` → create one `admin` user
  `username = "admin"` reusing that `passwordHash` + `salt`. Write `users.json`.
- Revoke all existing sessions (everyone re-logs in once).
- Leave `auth.json.secret` + `enabled` intact.
- If there is no legacy password either → no users; `needsSetup()` true.
Log a one-line notice so the operator knows the admin username is `admin`.

## Security invariants (must hold; reviewers check these)

- Passwords/hashes never leave the server (users API returns no hash).
- No user enumeration on login (uniform failure path + timing).
- A member can never see or act on a connection without a grant/ownership, at
  BOTH the API list layer AND the per-action gate (defense in depth).
- The destructive approval gate, kill switch, and rate limits remain
  non-disableable and apply regardless of role.
- The system can never be left with zero admins.
- All new on-disk files are `0o600` and encrypted via secret-file.

## Testing

Unit (vitest): users store CRUD + uniqueness + last-admin guard; migration from
legacy auth.json; login (username, password-only single-user, disabled, unknown
user uniform failure); current-user resolution; gate effective-permission matrix
(role × grant × category); connection-access store; listConnections filtering.
E2E (playwright): admin creates a member, member logs in and sees only granted
connections, member cannot reach the Users tab, admin resets member password.
