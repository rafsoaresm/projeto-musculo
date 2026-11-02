import type { ReactNode } from "react";
import type { Illustration } from "./contracts";

/**
 * The drawings a model of site comes with in place of a photo: abstract shapes (no people, no faces, no words) in the colors of the site, so they
 * follow the accent, "Minha cor" and the dark look. They are part of the page (no file, no address, nothing to load) and decorative: a photo of
 * the person's own takes their place. The shapes are this fixed table; nothing in them comes from the document.
 */
const SOLID = "var(--site-solid)";
const SOFT = "var(--site-soft)";
const LINE = "var(--site-soft-line, var(--site-line))";
const ACCENT = "var(--site-accent)";
const BG = "var(--site-bg)";

const DRAWINGS: Record<Illustration, ReactNode> = {
  // A heartbeat line over soft circles.
  pulse: (
    <>
      <rect width="400" height="500" fill={SOFT} />
      <circle cx="300" cy="120" r="150" fill={LINE} opacity="0.55" />
      <circle cx="80" cy="420" r="120" fill={SOLID} opacity="0.18" />
      <path d="M20 270 H130 L160 200 L200 340 L240 150 L275 300 L300 270 H380" fill="none" stroke={SOLID} strokeWidth="14" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="240" cy="150" r="16" fill={ACCENT} />
    </>
  ),
  // A dumbbell made of rounded bars.
  weights: (
    <>
      <rect width="400" height="300" fill={SOFT} />
      <circle cx="330" cy="40" r="90" fill={LINE} opacity="0.6" />
      <rect x="95" y="138" width="210" height="24" rx="12" fill={ACCENT} />
      <rect x="60" y="90" width="38" height="120" rx="14" fill={SOLID} />
      <rect x="28" y="110" width="30" height="80" rx="12" fill={SOLID} opacity="0.75" />
      <rect x="302" y="90" width="38" height="120" rx="14" fill={SOLID} />
      <rect x="342" y="110" width="30" height="80" rx="12" fill={SOLID} opacity="0.75" />
    </>
  ),
  // Concentric rings, like a target.
  rings: (
    <>
      <rect width="400" height="500" fill={SOFT} />
      <circle cx="200" cy="250" r="170" fill="none" stroke={LINE} strokeWidth="28" />
      <circle cx="200" cy="250" r="115" fill="none" stroke={SOLID} strokeWidth="24" opacity="0.6" />
      <circle cx="200" cy="250" r="60" fill={SOLID} />
      <circle cx="200" cy="250" r="22" fill={BG} />
    </>
  ),
  // A wide room: a floor line, mats and a window grid.
  studio: (
    <>
      <rect width="640" height="360" fill={SOFT} />
      <rect x="40" y="40" width="200" height="130" rx="12" fill={BG} opacity="0.85" />
      <path d="M140 40 V170 M40 105 H240" stroke={LINE} strokeWidth="8" />
      <rect x="300" y="60" width="300" height="24" rx="12" fill={LINE} />
      <rect x="300" y="100" width="220" height="24" rx="12" fill={LINE} opacity="0.7" />
      <rect x="0" y="270" width="640" height="90" fill={SOLID} opacity="0.2" />
      <rect x="60" y="250" width="150" height="30" rx="15" fill={SOLID} />
      <rect x="250" y="250" width="150" height="30" rx="15" fill={ACCENT} opacity="0.85" />
      <rect x="440" y="250" width="150" height="30" rx="15" fill={SOLID} opacity="0.6" />
    </>
  ),
  // A grid of rounded tiles, a few of them filled.
  grid: (
    <>
      <rect width="300" height="400" fill={SOFT} />
      {[0, 1, 2].flatMap((col) =>
        [0, 1, 2, 3].map((row) => (
          <rect
            key={`${col}-${row}`}
            x={30 + col * 85}
            y={30 + row * 88}
            width="70"
            height="70"
            rx="16"
            fill={(col + row) % 3 === 0 ? SOLID : LINE}
            opacity={(col + row) % 3 === 0 ? 1 : 0.7}
          />
        )),
      )}
    </>
  ),
  // A screen with a play shape and bars: following along from a distance.
  screen: (
    <>
      <rect width="640" height="360" fill={SOFT} />
      <rect x="120" y="40" width="400" height="250" rx="22" fill={BG} stroke={LINE} strokeWidth="10" />
      <path d="M290 125 L370 165 L290 205 Z" fill={SOLID} />
      <rect x="160" y="240" width="320" height="14" rx="7" fill={LINE} />
      <rect x="160" y="240" width="150" height="14" rx="7" fill={ACCENT} />
      <rect x="270" y="300" width="100" height="20" rx="10" fill={SOLID} opacity="0.5" />
    </>
  ),
  // A dotted path that climbs to a mark: steps of a plan.
  path: (
    <>
      <rect width="400" height="300" fill={SOFT} />
      <path d="M40 250 C120 250 120 170 200 170 S280 90 360 70" fill="none" stroke={SOLID} strokeWidth="10" strokeLinecap="round" strokeDasharray="2 22" />
      <circle cx="40" cy="250" r="16" fill={LINE} />
      <circle cx="200" cy="170" r="16" fill={SOLID} opacity="0.6" />
      <circle cx="360" cy="70" r="22" fill={ACCENT} />
    </>
  ),
};
const VIEWBOX: Record<Illustration, string> = {
  pulse: "0 0 400 500",
  weights: "0 0 400 300",
  rings: "0 0 400 500",
  studio: "0 0 640 360",
  grid: "0 0 300 400",
  screen: "0 0 640 360",
  path: "0 0 400 300",
};

/** The drawing, filling its frame (cropped at the centre like a photo would be). Decorative: hidden from assistive technology. */
export function IllustrationView({ name, className }: { name: Illustration; className?: string }) {
  return (
    <svg className={className} viewBox={VIEWBOX[name]} preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false" data-illustration={name}>
      {DRAWINGS[name]}
    </svg>
  );
}
