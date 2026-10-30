import type { SiteModel } from "./page-models";

/**
 * A drawing of what each site model starts with: boxes in the proportions of the page, no words and no photo (nothing here claims anything about
 * the person). It is a picture for the eye, so reading aids skip it: the name and the hint of the model are the text of the choice. The colors are
 * the tool's own (see `.model-thumb` in globals.css), not the page's.
 */
export function SiteModelThumb({ model }: { model: SiteModel }) {
  return (
    <svg className="model-thumb" data-model={model} viewBox="0 0 160 120" aria-hidden="true" focusable="false">
      <rect className="t-page" x="0.5" y="0.5" width="159" height="119" rx="6" />
      <rect className="t-ink" x="8" y="8" width="30" height="5" rx="2" />
      {[100, 116, 132].map((x) => (
        <rect key={x} className="t-muted" x={x} y="8.5" width="10" height="4" rx="2" />
      ))}
      {model === "single" && (
        <>
          <rect className="t-ink" x="12" y="34" width="70" height="10" rx="3" />
          <rect className="t-muted" x="12" y="50" width="50" height="5" rx="2" />
          <rect className="t-accent" x="12" y="62" width="28" height="9" rx="4.5" />
          <rect className="t-soft" x="12" y="90" width="136" height="18" rx="5" />
          <rect className="t-accent" x="20" y="95" width="22" height="8" rx="4" />
        </>
      )}
      {model === "complete" && (
        <>
          <rect className="t-ink" x="12" y="26" width="80" height="8" rx="3" />
          <rect className="t-muted" x="12" y="40" width="56" height="4" rx="2" />
          <rect className="t-accent" x="12" y="49" width="24" height="8" rx="4" />
          {[12, 60, 108].map((x) => (
            <g key={x}>
              <rect className="t-soft" x={x} y="70" width="40" height="34" rx="4" />
              <rect className="t-ink" x={x + 6} y="77" width="22" height="4" rx="2" />
              <rect className="t-muted" x={x + 6} y="86" width="28" height="3" rx="1.5" />
              <rect className="t-muted" x={x + 6} y="92" width="20" height="3" rx="1.5" />
            </g>
          ))}
        </>
      )}
      {model === "athlete" && (
        <>
          <rect className="t-ink" x="10" y="22" width="56" height="9" rx="3" />
          <rect className="t-muted" x="10" y="35" width="40" height="4" rx="2" />
          <rect className="t-accent" x="10" y="44" width="22" height="8" rx="4" />
          <rect className="t-pic" x="84" y="20" width="66" height="36" rx="5" />
          <rect className="t-soft" x="10" y="62" width="140" height="12" rx="4" />
          {[28, 62, 96, 130].map((x) => (
            <rect key={x} className="t-ink" x={x - 7} y="66" width="14" height="4" rx="2" />
          ))}
          <rect className="t-pic" x="10" y="80" width="42" height="22" rx="4" />
          <rect className="t-soft" x="56" y="80" width="48" height="22" rx="4" />
          <rect className="t-pic" x="108" y="80" width="42" height="22" rx="4" />
          <rect className="t-accent" x="10" y="106" width="140" height="10" rx="4" />
        </>
      )}
      {model === "trainer" && (
        <>
          <rect className="t-pic" x="10" y="20" width="50" height="38" rx="5" />
          <rect className="t-ink" x="68" y="26" width="60" height="9" rx="3" />
          <rect className="t-muted" x="68" y="39" width="44" height="4" rx="2" />
          <rect className="t-accent" x="68" y="47" width="22" height="8" rx="4" />
          <rect className="t-accent" x="10" y="64" width="140" height="10" rx="4" />
          {[20, 46, 72, 98, 124].map((x) => (
            <rect key={x} className="t-page-fill" x={x} y="67.5" width="14" height="3" rx="1.5" />
          ))}
          <rect className="t-accent" x="10" y="80" width="42" height="22" rx="4" />
          <rect className="t-ink" x="56" y="80" width="42" height="22" rx="4" />
          <rect className="t-outline" x="102" y="80" width="48" height="22" rx="4" />
          <rect className="t-accent" x="10" y="106" width="140" height="10" rx="4" />
        </>
      )}
    </svg>
  );
}
