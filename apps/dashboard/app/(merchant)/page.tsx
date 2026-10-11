import { getHealth } from '../../lib/health';

export const dynamic = 'force-dynamic';

export default async function MerchantHome() {
  const result = await getHealth();
  return (
    <main>
      <h1>Slips</h1>
      <p>
        API health: <strong data-testid="api-health">{result.ok ? result.health.status : 'unreachable'}</strong>
      </p>
      {result.ok ? null : <p>{result.error}</p>}
    </main>
  );
}
