/*
 * myDigitalOPD brand mark — the same traced "D" tile used in patient-web-OPD
 * and admin-OPD (see patient-web-OPD/src/components/Brand.tsx for why it is
 * drawn rather than a PNG). The wordmark is set in Poppins so it stays crisp.
 */
export type BrandTone = 'brand' | 'inverse';

const TEAL = '#1C7464';

export function LogoMark({
  size = 32,
  tone = 'brand',
  title = 'myDigitalOPD',
}: {
  size?: number;
  tone?: BrandTone;
  title?: string;
}) {
  const tile = tone === 'brand' ? TEAL : '#FFFFFF';
  const glyph = tone === 'brand' ? '#FFFFFF' : TEAL;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 128 128"
      role="img"
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="128" height="128" rx="29" fill={tile} />
      <g
        fill="none"
        stroke={glyph}
        strokeWidth={6.1}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M32.8 102.4 V25.4 H54.5 A35.9 38.5 0 0 1 54.5 102.4 Z" />
        <path d="M36.9 54.8 H41.8 L50.1 40.1 L58.8 80.3 L64.2 54.8 H75.8" />
      </g>
    </svg>
  );
}

export function Logo({
  size = 36,
  tone = 'brand',
  className = '',
}: {
  size?: number;
  tone?: BrandTone;
  className?: string;
}) {
  return (
    <span className={`brand ${tone === 'inverse' ? 'is-inverse' : ''} ${className}`}>
      <LogoMark size={size} tone={tone} />
      <span className="brand-wordmark" style={{ fontSize: Math.round(size * 0.56) }}>
        <span className="brand-my">my</span>Digital<span className="brand-opd">OPD</span>
      </span>
    </span>
  );
}

/** "Powered by ittitude." — the house mark, in its own colours. */
export function PoweredByIttitude({ tone = 'brand' }: { tone?: BrandTone }) {
  return (
    <span className={`powered-by ${tone === 'inverse' ? 'is-inverse' : ''}`}>
      <span className="powered-by-label">Powered by</span>
      <span className="powered-by-name">
        ittitude<span className="powered-by-dot">.</span>
      </span>
    </span>
  );
}
