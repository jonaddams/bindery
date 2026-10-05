import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FrameSection } from '@/components/app-frame';
import { ThemeProvider } from '@/components/providers/theme-provider';
import type { SessionUser } from '@/lib/auth';

vi.mock('@/lib/auth-client', () => ({ signOut: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/hooks/use-impersonation', () => ({
  useImpersonation: () => ({
    currentMode: 'SELF',
    canImpersonate: false,
    isLoading: false,
    error: null,
    switchMode: vi.fn(),
  }),
}));

const { AppFrame } = await import('@/components/app-frame');

const USER: SessionUser = { id: 'u1', email: 'ada@nutrient.io', name: 'Ada Lovelace' };

const stubMentions = (unread: number) =>
  vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify({ mentions: [], unread }), { status: 200 }));

const renderFrame = (active: FrameSection = 'dashboard') =>
  render(
    <ThemeProvider>
      <AppFrame user={USER} active={active}>
        <p>page body</p>
      </AppFrame>
    </ThemeProvider>
  );

const mainNav = () => within(screen.getByRole('navigation', { name: 'Main' }));

beforeEach(() => {
  stubMentions(0);
});

describe('App frame', () => {
  it('renders the page inside it', () => {
    renderFrame();

    expect(screen.getByText('page body')).toBeInTheDocument();
  });

  it('links to documents, inbox and settings, marking the current page', () => {
    renderFrame('inbox');

    expect(mainNav().getByRole('link', { name: 'Documents' })).toHaveAttribute(
      'href',
      '/dashboard'
    );
    expect(mainNav().getByRole('link', { name: /Inbox/ })).toHaveAttribute('aria-current', 'page');
    expect(mainNav().getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
    expect(mainNav().getByRole('link', { name: 'Documents' })).not.toHaveAttribute('aria-current');
  });

  it('treats a document page as part of Documents', () => {
    renderFrame('document');

    expect(mainNav().getByRole('link', { name: 'Documents' })).toHaveAttribute(
      'aria-current',
      'page'
    );
  });

  it('shows how many mentions are unread next to Inbox', async () => {
    stubMentions(3);
    renderFrame();

    expect(await mainNav().findByRole('link', { name: 'Inbox, 3 unread' })).toBeInTheDocument();
  });

  it('shows no count when nothing is unread', async () => {
    renderFrame();

    expect(await mainNav().findByRole('link', { name: 'Inbox' })).toBeInTheDocument();
  });

  it('offers Upload everywhere except on the upload page', () => {
    const { unmount } = renderFrame('dashboard');
    expect(screen.getAllByRole('link', { name: /Upload/ }).length).toBeGreaterThan(0);
    unmount();

    renderFrame('upload');
    const tabs = within(screen.getByRole('navigation', { name: 'Primary' }));
    expect(screen.getAllByRole('link', { name: /Upload/ })).toEqual([
      tabs.getByRole('link', { name: /Upload/ }),
    ]);
  });

  it('opens an account menu with who is signed in, settings and sign out', async () => {
    renderFrame();

    expect(screen.queryByText('ada@nutrient.io')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Account' }));

    const menu = within(screen.getByRole('menu'));
    expect(menu.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(menu.getByText('ada@nutrient.io')).toBeInTheDocument();
    expect(menu.getByRole('menuitem', { name: /Settings/ })).toHaveAttribute('href', '/settings');
    expect(menu.getByRole('menuitem', { name: /Sign out/ })).toBeInTheDocument();
  });

  it('closes the account menu on Escape', async () => {
    renderFrame();

    await userEvent.click(screen.getByRole('button', { name: 'Account' }));
    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
