// Sidebar state shared by the server (reads the cookie for the first paint) and the client (writes it).
// Kept out of sidebar.tsx, which is a client module whose exports the server cannot call.

export const SIDEBAR_COOKIE = 'sidebar_state';

/** The saved state from the cookie value: expanded unless explicitly collapsed. */
export const sidebarOpenFromCookie = (value: string | undefined): boolean => value !== 'false';
