import Link from 'next/link';
import { getMessages } from '../../i18n/messages';
import { getLocale } from '../../i18n/server';
import { CONNECTION_HREF } from '../../lib/shell';
import { getHealth } from '../../lib/health';

export const dynamic = 'force-dynamic';

export default async function MerchantHome() {
  const messages = getMessages(await getLocale());
  const result = await getHealth();
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-display">{messages.home.title}</h1>
      <p className="max-w-prose text-body-lg text-muted-foreground">{messages.home.intro}</p>
      <div>
        <Link href={CONNECTION_HREF} className="inline-flex min-h-11 items-center rounded-pill bg-primary px-6 font-semibold text-primary-foreground">
          {messages.home.nextStep}
        </Link>
      </div>
      <p className="text-small text-muted-foreground">
        {messages.home.apiHealth}: <strong data-testid="api-health">{result.ok ? result.health.status : messages.home.apiUnreachable}</strong>
      </p>
    </section>
  );
}
