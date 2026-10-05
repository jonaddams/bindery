import type { ReactNode } from 'react';
import { ThemeToggle } from '@/components/theme-toggle';

/** Full-screen frame for the signed-out pages: theme toggle on top, content centred. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="bnd bnd-auth">
      <div className="bnd-auth-top">
        <span />
        <ThemeToggle />
      </div>
      <main className="bnd-auth-mid">{children}</main>
    </div>
  );
}
