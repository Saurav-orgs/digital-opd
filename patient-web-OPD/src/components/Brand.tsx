/*
 * myDigitalOPD brand assets, drawn as inline SVG.
 *
 * The artwork we were handed is a pair of opaque PNGs (no transparency, a black
 * hairline baked into the edges, and JPEG ringing from a re-compress), so it
 * cannot be laid over the teal hero — it would show as a white box with a dark
 * border. These paths are measured off that artwork instead: the tile is a
 * 128-unit rounded square (r=29, matching the 22.6% corner of the original),
 * the "D" is a stroked outline with a semicircular bowl, and the ECG line is a
 * five-point polyline. Overlaying this on the PNG at 640px lines up.
 *
 * The wordmark is set in the app's own Poppins rather than traced, so it stays
 * crisp at every size and matches the headings beside it.
 */

/** How the mark colours itself for the surface it sits on. */
export type BrandTone =
  /** Teal tile, white glyph — on white or the page background. */
  | 'brand'
  /** White tile, teal glyph — on the teal hero. */
  | 'inverse'
  /** No tile, glyph in currentColor — for tight or single-colour spots. */
  | 'mono';

const TEAL = '#1C7464';

/** The "D" outline and the ECG line, shared by every tone. */
function Glyph({ stroke }: { stroke: string }) {
  return (
    <g
      fill="none"
      stroke={stroke}
      strokeWidth={6.1}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M32.8 102.4 V25.4 H54.5 A35.9 38.5 0 0 1 54.5 102.4 Z" />
      <path d="M36.9 54.8 H41.8 L50.1 40.1 L58.8 80.3 L64.2 54.8 H75.8" />
    </g>
  );
}

/**
 * The app icon on its own — the "D" tile. Used for the favicon, the dashboard
 * header and anywhere the full lockup will not fit.
 */
export function LogoMark({
  size = 32,
  tone = 'brand',
  title = 'myDigitalOPD',
}: {
  size?: number;
  tone?: BrandTone;
  title?: string;
}) {
  const tile = tone === 'brand' ? TEAL : tone === 'inverse' ? '#FFFFFF' : 'none';
  const glyph =
    tone === 'brand' ? '#FFFFFF' : tone === 'inverse' ? TEAL : 'currentColor';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 128 128"
      role="img"
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
    >
      {tone !== 'mono' && <rect width="128" height="128" rx="29" fill={tile} />}
      <Glyph stroke={glyph} />
    </svg>
  );
}

/**
 * The full lockup — mark, wordmark and tagline. The login screens use this;
 * everywhere else uses {@link LogoMark}.
 *
 * `tone="inverse"` flips the wordmark to white for the teal hero; the "OPD"
 * marigold is kept in both, since that is the one colour that carries the brand.
 */
export function LogoFull({
  markSize = 44,
  tagline = true,
  tone = 'brand',
  className = '',
}: {
  markSize?: number;
  tagline?: boolean;
  tone?: Extract<BrandTone, 'brand' | 'inverse'>;
  className?: string;
}) {
  const inverse = tone === 'inverse';
  return (
    <span className={`brand-lockup-full ${inverse ? 'is-inverse' : ''} ${className}`}>
      <LogoMark size={markSize} tone={tone} />
      <span className="brand-words">
        <span className="brand-wordmark" style={{ fontSize: markSize * 0.44 }}>
          <span className="brand-my">my</span>
          <span className="brand-digital">Digital</span>
          <span className="brand-opd">OPD</span>
        </span>
        {tagline && (
          <span className="brand-tagline" style={{ fontSize: markSize * 0.19 }}>
            digitally connected
          </span>
        )}
      </span>
    </span>
  );
}

/**
 * "Powered by ittitude." — the house mark. Kept in its own colours (near-black
 * wordmark, blue dot) because it is a second brand, not an accent of this one.
 *
 * `tone="inverse"` is the one departure, and only where it has to be: the
 * wordmark goes white on a dark ground, where near-black would be invisible.
 * The blue dot survives both, so the mark stays recognisable.
 *
 * The blue is sampled off a 328x84 JPEG, so it is close rather than exact; swap
 * `--ittitude-blue` if the official value turns up.
 */
export function PoweredByIttitude({
  tone = 'brand',
  className = '',
}: {
  tone?: Extract<BrandTone, 'brand' | 'inverse'>;
  className?: string;
}) {
  return (
    <span
      className={`powered-by ${tone === 'inverse' ? 'is-inverse' : ''} ${className}`}
    >
      <span className="powered-by-label">Powered by</span>
      <span className="powered-by-name">
        ittitude<span className="powered-by-dot">.</span>
      </span>
    </span>
  );
}
