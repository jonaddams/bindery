'use client';

import type { ImpersonationMode } from '@prisma/client';
import { useState } from 'react';
import { useImpersonation } from '@/hooks/use-impersonation';

const MODES: ReadonlyArray<{ mode: ImpersonationMode; label: string }> = [
  { mode: 'ADMIN', label: 'Admin' },
  { mode: 'SELF', label: 'User' },
];

export function RoleSwitcher() {
  const { currentMode, canImpersonate, isLoading, error, switchMode } = useImpersonation();
  const [isSwitching, setIsSwitching] = useState(false);

  const handleModeSwitch = async (newMode: ImpersonationMode) => {
    if (newMode === currentMode || isSwitching) return;

    setIsSwitching(true);
    try {
      await switchMode(newMode);
    } catch (_error) {
      // Handle error silently
    } finally {
      setIsSwitching(false);
    }
  };

  if (!canImpersonate) {
    return null;
  }

  return (
    <div style={{ padding: '4px 10px 8px' }}>
      <div className="bnd-lbl" style={{ marginBottom: 6 }}>
        View as
      </div>
      <div className="bnd-seg full">
        {MODES.map(({ mode, label }) => (
          <button
            key={mode}
            type="button"
            className={currentMode === mode ? 'on' : ''}
            aria-pressed={currentMode === mode}
            onClick={() => handleModeSwitch(mode)}
            disabled={isSwitching || isLoading}
          >
            {label}
          </button>
        ))}
      </div>
      {error && (
        <p className="bnd-hint bad" title={error} style={{ marginTop: 6 }}>
          Error switching roles
        </p>
      )}
    </div>
  );
}
