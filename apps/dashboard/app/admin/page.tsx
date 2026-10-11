export const metadata = { title: 'Slips Admin', robots: { index: false, follow: false } };

/**
 * Admin sign-in placeholder (AD-12). /admin has its own session type, separate from merchant sessions; the provider
 * is deferred to Epic 7, so nobody can sign in yet and this page shows no admin data. Served with
 * `frame-ancestors 'none'` (proxy.ts).
 */
export default function AdminHome() {
  return (
    <main>
      <h1>Slips Admin</h1>
      <p>Admin sign-in is not available yet. Access is denied by default.</p>
    </main>
  );
}
