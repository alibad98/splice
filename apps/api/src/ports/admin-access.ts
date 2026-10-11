// Slips Admin access (AD-12). The admin sign-in provider is deferred in the architecture (Epic 7); until a provider
// implements this port every admin request is denied. Merchant sessions are never consulted on admin routes.

export interface AdminPrincipal {
  adminId: string;
}

export interface AdminRequest {
  headers: Readonly<Record<string, string | string[] | undefined>>;
}

/** Admin sessions idle out after 30 minutes (AD-12); the future provider must enforce it. */
export const ADMIN_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

export interface AdminAccess {
  /** The signed-in admin, or undefined (deny). */
  authenticate(req: AdminRequest): Promise<AdminPrincipal | undefined>;
}

export const ADMIN_ACCESS = Symbol('AdminAccess');

/** Default: nobody is an admin. */
export const denyAllAdminAccess: AdminAccess = { authenticate: async () => undefined };
