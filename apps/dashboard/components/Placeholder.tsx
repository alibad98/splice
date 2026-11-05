import Link from 'next/link';
import { getMessages, type Messages } from '../i18n/messages';
import { getLocale } from '../i18n/server';

type Copy = { title: string; body: string; back: string };

interface Props {
  /** Which copy to show: the generic "Coming soon" (default) or the content editor's. */
  variant?: 'page' | 'contentEditor';
}

const pick = (messages: Messages, variant: NonNullable<Props['variant']>): Copy & { href: string } =>
  variant === 'contentEditor' ? { ...messages.content.editor, href: '/content' } : { ...messages.placeholder, href: '/' };

export async function Placeholder({ variant = 'page' }: Props = {}) {
  const copy = pick(getMessages(await getLocale()), variant);
  return (
    <section className="flex flex-col items-start gap-4">
      <h1 className="text-display">{copy.title}</h1>
      <p className="max-w-prose text-body-lg text-muted-foreground">{copy.body}</p>
      <Link href={copy.href} className="inline-flex min-h-11 items-center gap-2 rounded-pill bg-primary px-6 font-semibold text-primary-foreground">
        {copy.back}
      </Link>
    </section>
  );
}
