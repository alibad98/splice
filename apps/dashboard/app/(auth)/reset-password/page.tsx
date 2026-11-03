import { Suspense } from 'react';
import { ResetPasswordForm } from './ResetPasswordForm';

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="h-72 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
