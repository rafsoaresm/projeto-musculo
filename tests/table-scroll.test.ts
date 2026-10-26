import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// A table wider than its panel scrolls inside the panel. Visually hidden text (position: absolute) in
// a header cell is only clipped by that scrolling box when the box is positioned; otherwise it sits at
// the right edge of the overflowing table and stretches the whole page past the window (seen in CI as
// "span.sr-only → 1282px of 1280px" on the managers table). Checked in a browser by reproducing it.
const css = readFileSync("src/app/globals.css", "utf8");
const ruleOf = (selector: string) => {
  const start = css.indexOf(`${selector} {`);
  expect(start, `rule ${selector}`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", start));
};

describe("scrolling tables", () => {
  it("keeps the scrolling box positioned and scrolling", () => {
    const rule = ruleOf(".schedule-table-wrap");
    expect(rule).toMatch(/overflow-x:\s*auto/);
    expect(rule).toMatch(/position:\s*relative/);
  });

  it("applies the same rule to .table-wrap, which shares it", () => {
    expect(css).toMatch(/\.table-wrap,\s*\.schedule-table-wrap\s*\{/);
  });

  it("still hides the text of a header cell with an absolute position", () => {
    expect(ruleOf(".sr-only")).toMatch(/position:\s*absolute/);
  });
});
