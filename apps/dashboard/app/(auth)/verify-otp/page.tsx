import { Suspense } from 'react';
import { VerifyOtpForm } from './VerifyOtpForm';

export default function VerifyOtpPage() {
  return (
    <Suspense fallback={<div className="h-72 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />}>
      <VerifyOtpForm />
    </Suspense>
  );
}
