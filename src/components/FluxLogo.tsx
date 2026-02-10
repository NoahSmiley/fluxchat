export function FluxLogo({ size = 40 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="currentColor"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Ring (filled donut) */}
      <path
        d="M50 26a24 24 0 1 0 0 48a24 24 0 1 0 0-48zm0 10a14 14 0 1 1 0 28a14 14 0 1 1 0-28z"
        fillRule="evenodd"
        stroke="none"
      />
      {/* Top-right arrow */}
      <line x1="68" y1="32" x2="80" y2="20" strokeWidth="3.5" fill="none" />
      <polygon points="74,18 82,18 82,26" stroke="none" />
      {/* Bottom-left arrow */}
      <line x1="32" y1="68" x2="20" y2="80" strokeWidth="3.5" fill="none" />
      <polygon points="18,74 18,82 26,82" stroke="none" />
    </svg>
  );
}
