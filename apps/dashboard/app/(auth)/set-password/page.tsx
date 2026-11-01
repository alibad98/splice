import { Suspense } from 'react';
import { SetPasswordForm } from './SetPasswordForm';

export default function SetPasswordPage() {
  return (
    <Suspense fallback={<div className="h-48 animate-pulse rounded-xl bg-secondary/30" />}>
      <SetPasswordForm />
    </Suspense>
  );
}
