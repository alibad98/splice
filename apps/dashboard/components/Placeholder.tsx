import Link from 'next/link';
import { getMessages } from '../i18n/messages';
import { getLocale } from '../i18n/server';

export async function Placeholder() {
  const messages = getMessages(await getLocale());
  return (
    <section className="flex flex-col items-start gap-4">
      <h1 className="text-display">{messages.placeholder.title}</h1>
      <p className="max-w-prose text-body-lg text-muted-foreground">{messages.placeholder.body}</p>
      <Link href="/" className="inline-flex min-h-11 items-center gap-2 rounded-pill bg-primary px-6 font-semibold text-primary-foreground">
        {messages.placeholder.back}
      </Link>
    </section>
  );
}
