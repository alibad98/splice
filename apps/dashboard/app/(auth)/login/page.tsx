import { redirect } from 'next/navigation';
import { getServerSession } from '../../../lib/session/server';
import { LoginForm } from './LoginForm';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string }>;
}) {
  const session = await getServerSession();
  if (session.kind === 'signed-in') {
    redirect('/');
  }

  const { reset } = await searchParams;

  return <LoginForm resetSuccess={reset === 'success'} />;
}
