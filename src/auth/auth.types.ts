/**
 * Shape of the JWT payload signed by shophub-auth-service for access tokens.
 * `sub` is the user id (standard JWT subject claim).
 */
export interface JwtPayload {
  sub: string;
  email?: string;
  walletAddress?: string;
}

/**
 * Authenticated principal attached to the request by {@link JwtStrategy}
 * and exposed to controllers via the `@CurrentUser()` decorator.
 */
export interface AuthUser {
  userId: string;
  email?: string;
  walletAddress?: string;
}
