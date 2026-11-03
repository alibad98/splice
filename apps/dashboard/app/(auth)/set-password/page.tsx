import { Suspense } from 'react';
import { SetPasswordForm } from './SetPasswordForm';

export default function SetPasswordPage() {
  return (
    <Suspense fallback={<div className="h-72 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />}>
      <SetPasswordForm />
    </Suspense>
  );
}
