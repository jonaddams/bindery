'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { BI } from '@/components/bindery/icons';
import { BinderyLogo } from '@/components/bindery/logo';

// Force dynamic rendering to prevent static generation issues
export const dynamic = 'force-dynamic';

function ErrorContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get('error');

  const getErrorMessage = (error: string | null) => {
    switch (error) {
      case 'Configuration':
        return 'There is a problem with the server configuration.';
      case 'AccessDenied':
        return 'Access denied. You do not have permission to sign in.';
      case 'Verification':
        return 'The verification token has expired or has already been used.';
      default:
        return 'An error occurred during authentication.';
    }
  };

  return (
    <div className="bnd-auth-card">
      <BinderyLogo href={null} size={28} fontSize={19} />
      <div className="bnd-alert bad" role="alert">
        {BI.xcircle(18)}
        <div>
          <b>Authentication error</b>
          <p>{getErrorMessage(error)}</p>
          {error ? (
            <div className="bnd-mono" style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 6 }}>
              Error: {error}
            </div>
          ) : null}
        </div>
      </div>
      <Link href="/auth/signin" className="btn">
        Try again
      </Link>
    </div>
  );
}

export default function AuthError() {
  return (
    <AuthShell>
      <Suspense fallback={<span className="bnd-spin lg" role="status" aria-label="Loading" />}>
        <ErrorContent />
      </Suspense>
    </AuthShell>
  );
}
