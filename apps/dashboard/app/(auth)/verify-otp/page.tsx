import { Suspense } from 'react';
import { VerifyOtpForm } from './VerifyOtpForm';

export default function VerifyOtpPage() {
  return (
    <Suspense fallback={<div className="h-48 animate-pulse rounded-xl bg-secondary/30" />}>
      <VerifyOtpForm />
    </Suspense>
  );
}
