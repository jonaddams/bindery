import { render as rtlRender, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PROGRAM_LEGAL_URLS } from '@/lib/sms-program';

const social = vi.fn();
const useSession = vi.fn();

vi.mock('@/lib/auth-client', () => ({
  signIn: { social: (...args: unknown[]) => social(...args) },
  useSession: () => useSession(),
}));

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const { default: SignIn } = await import('@/app/auth/signin/page');
const { ThemeProvider } = await import('@/components/providers/theme-provider');

// The page carries the theme toggle, which reads the theme from context.
const render = (ui: ReactElement) => rtlRender(<ThemeProvider>{ui}</ThemeProvider>);

beforeEach(() => {
  social.mockReset();
  push.mockReset();
  useSession.mockReset().mockReturnValue({ data: null, isPending: false });
});

describe('Signing in', () => {
  it('offers both Google and Microsoft', () => {
    render(<SignIn />);

    expect(screen.getByRole('button', { name: /google/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /microsoft/i })).toBeInTheDocument();
  });

  it('starts a Google sign-in when the Google button is used', async () => {
    render(<SignIn />);

    await userEvent.click(screen.getByRole('button', { name: /google/i }));

    expect(social).toHaveBeenCalledWith({ provider: 'google', callbackURL: '/dashboard' });
  });

  it('starts a Microsoft sign-in when the Microsoft button is used', async () => {
    render(<SignIn />);

    await userEvent.click(screen.getByRole('button', { name: /microsoft/i }));

    expect(social).toHaveBeenCalledWith({ provider: 'microsoft', callbackURL: '/dashboard' });
  });

  it('sends an already-signed-in person to the dashboard', () => {
    useSession.mockReturnValue({ data: { user: { id: 'user_1' } }, isPending: false });

    render(<SignIn />);

    expect(push).toHaveBeenCalledWith('/dashboard');
  });

  it('shows nothing actionable while the session is still loading', () => {
    useSession.mockReturnValue({ data: null, isPending: true });

    render(<SignIn />);

    expect(screen.queryByRole('button', { name: /google/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /microsoft/i })).not.toBeInTheDocument();
  });

  it('shows that it is redirecting, and blocks a second click, while the sign-in starts', async () => {
    social.mockReturnValue(new Promise(() => {}));
    render(<SignIn />);

    await userEvent.click(screen.getByRole('button', { name: /google/i }));

    expect(screen.getByRole('button', { name: /redirecting to google/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /microsoft/i })).toBeDisabled();
  });

  it('offers the buttons again when the sign-in could not start', async () => {
    social.mockRejectedValue(new Error('network'));
    render(<SignIn />);

    await userEvent.click(screen.getByRole('button', { name: /google/i }));

    expect(await screen.findByRole('button', { name: /sign in with google/i })).toBeEnabled();
  });

  it('links the terms and the privacy policy', () => {
    render(<SignIn />);

    expect(screen.getByRole('link', { name: /terms/i })).toHaveAttribute(
      'href',
      PROGRAM_LEGAL_URLS.terms
    );
    expect(screen.getByRole('link', { name: /privacy/i })).toHaveAttribute(
      'href',
      PROGRAM_LEGAL_URLS.privacy
    );
  });
});
