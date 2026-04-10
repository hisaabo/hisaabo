// Logo — the Hisaabo mark. Inlined SVG matches public/favicon.svg so offline/first-paint renders work.
// If you change this, update public/favicon.svg too so tab icon and in-app mark stay in sync.
interface LogoProps {
  className?: string;
}

export function Logo({ className }: LogoProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Hisaabo"
      role="img"
    >
      <rect width="32" height="32" rx="6" fill="#5b5bd6" />
      <rect x="5" y="5" width="9.5" height="9.5" rx="2" fill="white" opacity="0.9" />
      <rect x="17.5" y="5" width="9.5" height="9.5" rx="2" fill="white" opacity="0.6" />
      <rect x="5" y="17.5" width="9.5" height="9.5" rx="2" fill="white" opacity="0.6" />
      <rect x="17.5" y="17.5" width="9.5" height="9.5" rx="2" fill="#fbbf24" opacity="0.9" />
    </svg>
  );
}
