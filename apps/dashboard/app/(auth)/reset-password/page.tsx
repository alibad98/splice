import { Suspense } from 'react';
import { ResetPasswordForm } from './ResetPasswordForm';

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="h-48 animate-pulse rounded-xl bg-secondary/30" />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
