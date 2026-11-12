import Link from 'next/link';
import { getMessages } from '../i18n/messages';
import { getLocale } from '../i18n/server';

/** The generic "Coming soon" page body. */
export async function Placeholder() {
  const copy = getMessages(await getLocale()).placeholder;
  return (
    <section className="flex flex-col items-start gap-4">
      <h1 className="text-display">{copy.title}</h1>
      <p className="max-w-prose text-body-lg text-muted-foreground">{copy.body}</p>
      <Link href="/" className="inline-flex min-h-11 items-center gap-2 rounded-pill bg-primary px-6 font-semibold text-primary-foreground">
        {copy.back}
      </Link>
    </section>
  );
}
