import Link from 'next/link';
import { PRODUCT_NAME } from '@/lib/product';

/** The "stitched spine" mark: a bound cover with saddle stitches. */
export function BinderyMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="2" width="18" height="20" rx="3" fill="currentColor" />
      <path
        d="M8.5 4.5v15"
        stroke="var(--bg)"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeDasharray="2.2 2.6"
      />
      <path d="M12 2v20" stroke="var(--bg)" strokeWidth=".9" opacity=".35" />
    </svg>
  );
}

type BinderyLogoProps = {
  href?: string | null;
  size?: number;
  fontSize?: number;
};

export function BinderyLogo({ href = '/dashboard', size = 22, fontSize }: BinderyLogoProps) {
  const inner = (
    <>
      <BinderyMark size={size} />
      <span style={fontSize ? { fontSize } : undefined}>{PRODUCT_NAME}</span>
    </>
  );

  if (!href) {
    return <span className="bnd-logo">{inner}</span>;
  }

  return (
    <Link href={href} className="bnd-logo">
      {inner}
    </Link>
  );
}
