'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { BinderyLogo } from '@/components/bindery/logo';
import { signIn, useSession } from '@/lib/auth-client';
import { PRODUCT_NAME } from '@/lib/product';
import { PROGRAM_LEGAL_URLS } from '@/lib/sms-program';

// Force dynamic rendering to prevent static generation issues
export const dynamic = 'force-dynamic';

const GoogleG = () => (
  <svg width={18} height={18} viewBox="0 0 48 48" aria-hidden="true">
    <path
      fill="#EA4335"
      d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
    />
    <path
      fill="#4285F4"
      d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
    />
    <path
      fill="#FBBC05"
      d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
    />
    <path
      fill="#34A853"
      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
    />
  </svg>
);

const MicrosoftLogo = () => (
  <svg width={17} height={17} viewBox="0 0 21 21" aria-hidden="true">
    <rect x="0" y="0" width="10" height="10" fill="#F25022" />
    <rect x="11" y="0" width="10" height="10" fill="#7FBA00" />
    <rect x="0" y="11" width="10" height="10" fill="#00A4EF" />
    <rect x="11" y="11" width="10" height="10" fill="#FFB900" />
  </svg>
);

const PROVIDERS = [
  { id: 'google', name: 'Google', label: 'Sign in with Google', logo: <GoogleG /> },
  { id: 'microsoft', name: 'Microsoft', label: 'Sign in with Microsoft', logo: <MicrosoftLogo /> },
] as const;

type ProviderId = (typeof PROVIDERS)[number]['id'];

export default function SignIn() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [redirecting, setRedirecting] = useState<ProviderId | null>(null);

  useEffect(() => {
    if (session) {
      router.push('/dashboard');
    }
  }, [session, router]);

  // On success the browser navigates away, so the busy state is only ever
  // cleared when the sign-in failed to start.
  const startSignIn = async (provider: ProviderId) => {
    setRedirecting(provider);
    try {
      await signIn.social({ provider, callbackURL: '/dashboard' });
    } catch {
      setRedirecting(null);
    }
  };

  if (isPending || session) {
    return (
      <AuthShell>
        <span className="bnd-spin lg" role="status" aria-label="Loading" />
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="bnd-auth-card">
        <BinderyLogo href={null} size={28} fontSize={19} />
        <div>
          <h1 className="bnd-h1">Sign in to {PRODUCT_NAME}</h1>
          <p className="bnd-sub">Upload, review and process documents with your team.</p>
        </div>
        <div className="bnd-stack" style={{ gap: 10 }}>
          {PROVIDERS.map((provider) => (
            <button
              key={provider.id}
              type="button"
              className="bnd-oauth"
              disabled={redirecting !== null}
              onClick={() => startSignIn(provider.id)}
            >
              {redirecting === provider.id ? (
                <>
                  <span className="bnd-spin" /> Redirecting to {provider.name}…
                </>
              ) : (
                <>
                  {provider.logo} {provider.label}
                </>
              )}
            </button>
          ))}
        </div>
        <p className="bnd-auth-foot">
          By continuing you agree to the <a href={PROGRAM_LEGAL_URLS.terms}>Terms of Service</a> and{' '}
          <a href={PROGRAM_LEGAL_URLS.privacy}>Privacy Policy</a>.
        </p>
      </div>
    </AuthShell>
  );
}
