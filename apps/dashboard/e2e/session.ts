const session = { client: { apiBase: window.location.origin, hasBearer: false, apiFetch: (path: string, init?: RequestInit) => fetch(path, init) }, state: { status: 'signed-in', mode: 'direct', storeDomains: ['shop.example'] } };
export const useSession = () => session;
