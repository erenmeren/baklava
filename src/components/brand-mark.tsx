interface BrandMarkProps {
  className?: string;
  size?: number;
}

export function BrandMark({ className, size = 22 }: BrandMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 22 22"
      fill="none"
      aria-hidden
      className={className}
    >
      <path
        d="M11 1L21 11L11 21L1 11Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
        opacity="0.45"
      />
      <path
        d="M11 5.2L16.8 11L11 16.8L5.2 11Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
        opacity="0.75"
      />
      <path d="M11 8.6L13.4 11L11 13.4L8.6 11Z" fill="currentColor" />
    </svg>
  );
}
