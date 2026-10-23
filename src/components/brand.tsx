import Link from "next/link";
import { Activity } from "lucide-react";

/** Solid blue mark, no gradient. */
export function Brand({ href = "/", label }: { href?: string; label?: string }) {
  return (
    <Link
      className="brand"
      href={href}
      aria-label={label ?? "Trainer Prescription, início"}
    >
      <span className="brand-symbol">
        <Activity size={22} strokeWidth={2.6} />
      </span>
      <span className="brand-name">
        trainer<span className="brand-subtitle">PRESCRIPTION</span>
      </span>
    </Link>
  );
}
