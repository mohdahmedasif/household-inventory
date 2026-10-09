// The palette is defined once, in index.css (:root). These helpers read it back
// so Ant Design and the category colours use the same values without repeating them.

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** A palette colour's value, e.g. token("primary") for --pantry-primary. */
export function token(name: string): string {
  return cssVar(`--pantry-${name}`);
}

/** A translucent version of a palette colour, as a CSS expression. */
export function tint(name: string, percent: number): string {
  return `color-mix(in srgb, var(--pantry-${name}) ${percent}%, transparent)`;
}

let chartCount = 0;

/** The nth chart colour, wrapping around however many --chart-N the stylesheet defines. */
export function chartColor(index: number): string {
  if (!chartCount) {
    while (cssVar(`--chart-${chartCount + 1}`)) chartCount += 1;
  }
  return chartCount ? `var(--chart-${(index % chartCount) + 1})` : "currentColor";
}
