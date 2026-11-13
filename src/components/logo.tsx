/* eslint-disable @next/next/no-img-element -- static vector logo; next/image adds nothing for an SVG */

/**
 * The Solution Roofing logo (turtle + wordmark), straight from the brand guide's vector file.
 * Brand rules: always on cream or white, never stretched, recolored or retyped,
 * and at least 60px tall on screen.
 */
export function Logo({ height = 96, className }: { height?: number; className?: string }) {
  return (
    <img src="/brand/sr-logo.svg" alt="Solution Roofing" height={height} width={Math.round(height * 1.0997)}
      className={className ? `logo ${className}` : 'logo'} />
  );
}

/** Two-beat brand tagline: setup in green, payoff in orange. */
export function Tagline({ className }: { className?: string }) {
  return (
    <p className={className ? `tagline ${className}` : 'tagline'}>
      Turtle-Tough Roofs. <span>Honest Answers.</span>
    </p>
  );
}
