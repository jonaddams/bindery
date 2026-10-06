type AvatarProps = {
  /** Stable key for the colour, so a person keeps their colour across pages. */
  id: string;
  name: string;
  size?: 'sm' | 'lg';
};

const initialsOf = (name: string): string =>
  name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

const hueOf = (id: string): number =>
  [...id].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 360, 7);

export function Avatar({ id, name, size }: AvatarProps) {
  return (
    <span
      className={`bnd-avatar ${size ?? ''}`}
      style={{ background: `oklch(0.56 0.11 ${hueOf(id)})` }}
      title={name}
      aria-hidden="true"
    >
      {initialsOf(name)}
    </span>
  );
}
