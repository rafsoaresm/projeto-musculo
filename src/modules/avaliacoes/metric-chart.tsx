"use client";
import { useRef, useState } from "react";
import { formatCalendarDate } from "@/modules/training/format";
import { chartGeometry } from "./evolution";

const W = 360;
const H = 150;
const AREA = { left: 46, top: 14, width: 296, height: 88 };
const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

/**
 * One measure over time: a thin line, round markers, three recessive guides and a label on the
 * last value only. The drawing is a supplement: every value is also in the table next to it, and
 * the pointer, the keyboard (arrow keys) and focus show the same readout.
 */
export function MetricChart({
  title,
  unit,
  points,
}: {
  title: string;
  unit: string | null;
  points: Array<{ assessedOn: string; value: number; text: string }>;
}) {
  const [active, setActive] = useState<number | null>(null);
  const box = useRef<SVGSVGElement>(null);
  const geometry = chartGeometry(points, AREA);
  const suffix = unit ? ` ${unit}` : "";
  const last = geometry.points[geometry.points.length - 1];
  const shown = active !== null ? geometry.points[active] : null;

  /** The point nearest to the pointer, so the reader aims at a date and not at a 2px line. */
  function nearest(clientX: number) {
    const rect = box.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const x = ((clientX - rect.left) / rect.width) * W;
    let best = 0;
    geometry.points.forEach((point, index) => {
      if (Math.abs(point.x - x) < Math.abs(geometry.points[best].x - x)) best = index;
    });
    setActive(best);
  }
  function onKeyDown(event: React.KeyboardEvent) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    setActive(Math.max(0, Math.min(points.length - 1, (active ?? points.length - 1) + step)));
  }

  return (
    <div
      className="metric-chart"
      role="group"
      aria-label={`Gráfico: ${title}. Use as setas para percorrer as medições.`}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onFocus={() => setActive((current) => current ?? points.length - 1)}
      onBlur={() => setActive(null)}
      onPointerMove={(event) => nearest(event.clientX)}
      onPointerLeave={() => setActive(null)}
    >
      <svg ref={box} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" focusable="false">
        {geometry.ticks.map((tick) => (
          <g key={tick.y}>
            <line x1={AREA.left} x2={AREA.left + AREA.width} y1={tick.y} y2={tick.y} className="chart-grid" />
            <text x={AREA.left - 8} y={tick.y + 4} textAnchor="end" className="chart-tick">
              {number.format(tick.value)}
            </text>
          </g>
        ))}
        <text x={AREA.left} y={H - 8} textAnchor="start" className="chart-tick">
          {formatCalendarDate(points[0].assessedOn)}
        </text>
        <text x={AREA.left + AREA.width} y={H - 8} textAnchor="end" className="chart-tick">
          {formatCalendarDate(points[points.length - 1].assessedOn)}
        </text>
        {shown && (
          <line x1={shown.x} x2={shown.x} y1={AREA.top} y2={AREA.top + AREA.height} className="chart-cross" />
        )}
        <polyline
          points={geometry.points.map((point) => `${point.x},${point.y}`).join(" ")}
          className="chart-line"
        />
        {geometry.points.map((point) => (
          <circle
            key={point.index}
            cx={point.x}
            cy={point.y}
            r={active === point.index ? 5.5 : 4.5}
            className="chart-dot"
          />
        ))}
        <text x={last.x} y={last.y - 10} textAnchor={last.x > W - 60 ? "end" : "middle"} className="chart-end">
          {number.format(points[points.length - 1].value)}
          {suffix}
        </text>
      </svg>
      {active !== null && shown && (
        <div
          className="chart-tip"
          style={{ left: `${Math.min(86, Math.max(14, (shown.x / W) * 100))}%` }}
          role="status"
        >
          <strong>
            {points[active].text}
            {suffix}
          </strong>
          <span>{formatCalendarDate(points[active].assessedOn)}</span>
        </div>
      )}
    </div>
  );
}
