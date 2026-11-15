import { DrawPath } from "./motion";

// Logistic dose-response curve (log10 dose -1..2, EC50 = 3.2 uM, Hill = 1.4) mapped into the plot box.
function sigmoidPath(): { d: string; points: [number, number][] } {
  const x0 = 40, x1 = 300, y0 = 190, y1 = 30;
  const toX = (l: number) => x0 + ((l + 1) / 3) * (x1 - x0);
  const toY = (r: number) => y0 - r * (y0 - y1);
  const resp = (l: number) => 1 / (1 + Math.pow(10, (Math.log10(3.2) - l) * 1.4));
  let d = "";
  for (let i = 0; i <= 60; i++) {
    const l = -1 + (3 * i) / 60;
    d += `${i ? "L" : "M"}${toX(l).toFixed(1)} ${toY(resp(l)).toFixed(1)} `;
  }
  const points = [-0.8, -0.3, 0.2, 0.5, 0.8, 1.2, 1.6].map((l, i) => {
    const jitter = [0.02, -0.03, 0.04, -0.02, 0.03, -0.01, 0.01][i] ?? 0;
    return [toX(l), toY(Math.min(1, Math.max(0, resp(l) + jitter)))] as [number, number];
  });
  return { d, points };
}

const TRACK =
  "M30 130 C 50 90, 80 120, 92 80 S 140 40, 160 70 S 150 130, 120 140 S 70 150, 64 110 S 110 60, 150 96 S 190 150, 210 120";

/** Decorative "instrument" panel for the hero; values are illustrative. */
export function HeroReadout() {
  const { d, points } = sigmoidPath();
  return (
    <div className="glow relative overflow-hidden rounded-2xl border border-line bg-surface/90 backdrop-blur" aria-hidden>
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="size-2.5 rounded-full bg-danger/70" />
          <span className="size-2.5 rounded-full bg-soon/80" />
          <span className="size-2.5 rounded-full bg-live/80" />
        </div>
        <span className="readout text-[11px] text-subtle">xprism · isolated organ bath · run 07</span>
      </div>
      <div className="grid gap-px bg-line sm:grid-cols-[1.35fr_1fr]">
        <div className="bg-surface p-4">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="readout text-[11px] uppercase tracking-wider text-subtle">dose–response</span>
            <span className="readout text-xs text-accent-ink">EC50 = 3.2 µM</span>
          </div>
          <svg viewBox="0 0 320 215" className="w-full">
            <line x1="40" y1="190" x2="300" y2="190" className="stroke-line-strong" strokeWidth="1" />
            <line x1="40" y1="30" x2="40" y2="190" className="stroke-line-strong" strokeWidth="1" />
            {[0, 1, 2, 3].map((i) => (
              <text key={i} x={40 + (i * 260) / 3} y="206" textAnchor="middle" className="fill-subtle readout" fontSize="9">
                {["0.1", "1", "10", "100"][i]}
              </text>
            ))}
            <text x="300" y="183" textAnchor="end" className="fill-subtle readout" fontSize="8">log [agonist] µM</text>
            <line x1="40" y1="110" x2="300" y2="110" className="stroke-accent/40" strokeDasharray="3 4" />
            <DrawPath d={d} className="fill-none stroke-accent [stroke-width:2.2]" />
            {points.map(([x, y], i) => (
              <g key={i}>
                <line x1={x} x2={x} y1={y - 7} y2={y + 7} className="stroke-muted" strokeWidth="1" />
                <circle cx={x} cy={y} r="3.2" className="fill-surface stroke-fg" strokeWidth="1.4" />
              </g>
            ))}
          </svg>
          <div className="mt-1 grid grid-cols-3 gap-2 text-center">
            {[
              ["Emax", "98.4%"],
              ["Hill", "1.40"],
              ["n", "7 doses"],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg border border-line bg-surface-2 px-2 py-1.5">
                <p className="readout text-[10px] uppercase text-subtle">{k}</p>
                <p className="readout text-sm text-fg">{v}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-surface p-4">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="readout text-[11px] uppercase tracking-wider text-subtle">amaze · open field</span>
            <span className="readout text-xs text-live-ink">tracking</span>
          </div>
          <svg viewBox="0 0 240 200" className="w-full">
            <defs>
              <radialGradient id="heat-a">
                <stop offset="0" stopColor="#F59E0B" stopOpacity="0.7" />
                <stop offset="1" stopColor="#F59E0B" stopOpacity="0" />
              </radialGradient>
              <radialGradient id="heat-b">
                <stop offset="0" stopColor="#7C5CFF" stopOpacity="0.55" />
                <stop offset="1" stopColor="#7C5CFF" stopOpacity="0" />
              </radialGradient>
            </defs>
            <rect x="15" y="20" width="210" height="160" rx="6" className="fill-none stroke-line-strong" strokeWidth="1.5" />
            <rect x="70" y="60" width="100" height="80" rx="4" className="fill-none stroke-accent/50" strokeDasharray="4 4" />
            <circle cx="160" cy="80" r="42" fill="url(#heat-a)" />
            <circle cx="70" cy="125" r="38" fill="url(#heat-b)" />
            <DrawPath d={TRACK} className="fill-none stroke-fg/70 [stroke-width:1.4]" delay={0.4} />
            <circle cx="210" cy="120" r="4" className="fill-live" />
          </svg>
          <div className="mt-1 grid grid-cols-2 gap-2 text-center">
            {[
              ["distance", "18.6 m"],
              ["centre time", "23.4%"],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg border border-line bg-surface-2 px-2 py-1.5">
                <p className="readout text-[10px] uppercase text-subtle">{k}</p>
                <p className="readout text-sm text-fg">{v}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="border-t border-line px-4 py-2 text-right text-[10px] text-subtle">Illustrative output</p>
    </div>
  );
}
