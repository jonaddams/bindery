'use client';

import { type ReactNode, useState } from 'react';
import { BI } from '@/components/bindery/icons';

type RailSectionProps = {
  title: string;
  count?: number;
  /** Drop the body padding, for rows that run edge to edge. */
  flush?: boolean;
  /** Pass both to control the section from outside; omit them to let it fold itself. */
  open?: boolean;
  onToggle?: () => void;
  children: ReactNode;
};

export function RailSection({ title, count, flush, open, onToggle, children }: RailSectionProps) {
  const [ownOpen, setOwnOpen] = useState(true);
  const isOpen = open ?? ownOpen;
  const toggle = onToggle ?? (() => setOwnOpen((current) => !current));

  return (
    <section className={`bnd-sec ${isOpen ? 'open' : ''}`}>
      <button type="button" className="bnd-sec-h" aria-expanded={isOpen} onClick={toggle}>
        {title}
        {count !== undefined && <span className="n">{count}</span>}
        <span className="chev">{BI.down(15)}</span>
      </button>
      {isOpen && <div className={`bnd-sec-b ${flush ? 'flush' : ''}`}>{children}</div>}
    </section>
  );
}
