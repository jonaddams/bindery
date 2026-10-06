'use client';

import { useEffect, useState } from 'react';
import { BI } from '@/components/bindery/icons';
import { useTheme } from '@/components/providers/theme-provider';

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Don't render until mounted to avoid hydration mismatch
  if (!mounted) {
    return <span className="bnd-ib" aria-hidden="true" />;
  }

  const label = `Switch to ${theme === 'light' ? 'dark' : 'light'} mode`;

  return (
    <button type="button" onClick={toggleTheme} className="bnd-ib" aria-label={label} title={label}>
      {theme === 'light' ? BI.moon(16) : BI.sun(16)}
    </button>
  );
}
