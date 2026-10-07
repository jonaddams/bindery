'use client';

import Link from 'next/link';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Avatar } from '@/components/bindery/avatar';
import { BI } from '@/components/bindery/icons';
import { BinderyLogo } from '@/components/bindery/logo';
import { RoleSwitcher } from '@/components/role-switcher';
import { SignOutButton } from '@/components/sign-out-button';
import { ThemeToggle } from '@/components/theme-toggle';
import type { SessionUser } from '@/lib/auth';
import { onUnreadMentions } from '@/lib/unread-mentions';

export type FrameSection = 'dashboard' | 'inbox' | 'settings' | 'upload' | 'document';

type AppFrameProps = {
  user: SessionUser;
  active: FrameSection;
  children: ReactNode;
};

type NavItem = {
  id: FrameSection;
  href: string;
  label: string;
  icon: (size?: number) => ReactNode;
};

const DOCUMENTS: NavItem = {
  id: 'dashboard',
  href: '/dashboard',
  label: 'Documents',
  icon: BI.docs,
};
const INBOX: NavItem = { id: 'inbox', href: '/inbox', label: 'Inbox', icon: BI.inbox };
// Reachable from every page on purpose: the A2P filing tells a carrier reviewer
// to open Settings → Notifications, so the route has to be findable without
// knowing the URL.
const SETTINGS: NavItem = {
  id: 'settings',
  href: '/settings',
  label: 'Settings',
  icon: BI.settings,
};
const UPLOAD: NavItem = { id: 'upload', href: '/upload', label: 'Upload', icon: BI.upload };

const MAIN_NAV = [DOCUMENTS, INBOX, SETTINGS];
const TAB_NAV = [DOCUMENTS, UPLOAD, INBOX, SETTINGS];

const useUnreadMentions = (): number => {
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/mentions')
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { unread?: number } | null) => {
        if (!cancelled && typeof body?.unread === 'number') setUnread(body.unread);
      })
      // A missing badge is the right failure for a secondary count.
      .catch(() => undefined);
    // The feed announces the new count when mentions are marked read.
    const stopListening = onUnreadMentions(setUnread);
    return () => {
      cancelled = true;
      stopListening();
    };
  }, []);

  return unread;
};

// A document is reached from the list, so the list stays lit while reading one.
const isActive = (item: NavItem, active: FrameSection): boolean =>
  item.id === active || (item.id === 'dashboard' && active === 'document');

const navLabel = (item: NavItem, unread: number): string | undefined =>
  item.id === 'inbox' && unread > 0 ? `${item.label}, ${unread} unread` : undefined;

function AccountMenu({ user }: { user: SessionUser }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const displayName = user.name || user.email;

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (ref.current && event.target instanceof Node && !ref.current.contains(event.target)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="bnd-pop" ref={ref}>
      <button
        className="bnd-avbtn"
        type="button"
        aria-label="Account"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Avatar id={user.id} name={displayName} />
      </button>
      {open && (
        <div className="bnd-menu" role="menu">
          <div className="who">
            <Avatar id={user.id} name={displayName} />
            <div style={{ minWidth: 0 }}>
              <b>{displayName}</b>
              {user.name && <span>{user.email}</span>}
            </div>
          </div>
          <RoleSwitcher />
          <hr />
          <Link href="/settings" className="mi" role="menuitem" onClick={() => setOpen(false)}>
            {BI.settings(15)} Settings
          </Link>
          <hr />
          <SignOutButton className="mi" role="menuitem" icon={BI.signout(15)} />
        </div>
      )}
    </div>
  );
}

export function AppFrame({ user, active, children }: AppFrameProps) {
  const unread = useUnreadMentions();

  const renderLink = (item: NavItem, withIcon: boolean) => (
    <Link
      key={item.id}
      href={item.href}
      className={isActive(item, active) ? 'on' : ''}
      aria-current={isActive(item, active) ? 'page' : undefined}
      aria-label={navLabel(item, unread)}
    >
      {withIcon && item.icon(20)}
      {withIcon ? <span>{item.label}</span> : item.label}
      {item.id === 'inbox' && unread > 0 && (
        <span className="bnd-count" aria-hidden="true">
          {unread}
        </span>
      )}
    </Link>
  );

  return (
    <div className="bnd">
      <header className="bnd-top">
        <div className="bnd-top-in">
          <BinderyLogo />
          <nav className="bnd-nav" aria-label="Main">
            {MAIN_NAV.map((item) => renderLink(item, false))}
          </nav>
          <div className="bnd-top-r">
            {active !== 'upload' && (
              <Link href="/upload" className="btn sm bnd-hide-m">
                {BI.plus(14)} Upload
              </Link>
            )}
            <ThemeToggle />
            <AccountMenu user={user} />
          </div>
        </div>
      </header>
      <main className="bnd-main">{children}</main>
      <nav className="bnd-tabs" aria-label="Primary">
        {TAB_NAV.map((item) => renderLink(item, true))}
      </nav>
    </div>
  );
}
