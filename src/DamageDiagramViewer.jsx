/** Read-only vehicle damage diagram — markers (X) and draw strokes, matching the member portal. */

import { resolveDamageDiagramFromDamage } from './memberSubmissionUtils.js';

export const VEHICLE_DAMAGE_DIAGRAM_SRC = '/vehicle-damage-diagram.png';
export const VEHICLE_DAMAGE_DIAGRAM_FALLBACK = '/vehicle-damage-diagram.svg';

export function resolveDamageDiagram(damage) {
  const { markers, strokes } = resolveDamageDiagramFromDamage(damage);
  return { markers, strokes };
}

function StatBadge({ label, value }) {
  return (
    <div className="rounded-lg border border-zinc-200/90 bg-zinc-50 px-3 py-2 text-center shadow-inner">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-zinc-900">{value}</p>
    </div>
  );
}

export function DamageDiagramViewer({ damage, title = 'Damage diagram (as submitted)', className = '' }) {
  const { markers, strokes } = resolveDamageDiagram(damage);
  const markerCount = markers.length;
  const strokeCount = strokes.length;

  return (
    <section className={`overflow-hidden rounded-xl border border-zinc-200/90 bg-white shadow-inner ${className}`}>
      <div className="border-b border-zinc-100 bg-zinc-50/50 px-4 py-3 sm:px-5">
        <h3 className="text-[13px] font-semibold text-zinc-900">{title}</h3>
        <p className="mt-1 text-2xs leading-relaxed text-zinc-500">
          Red X marks and drawn lines from the member&apos;s damage step — same view as the claim portal.
        </p>
      </div>
      <div className="space-y-4 px-4 py-4 sm:px-5">
        <div className="grid grid-cols-3 gap-2 sm:max-w-md">
          <StatBadge label="Markers" value={markerCount} />
          <StatBadge label="Drawings" value={strokeCount} />
          <StatBadge label="Total" value={markerCount + strokeCount} />
        </div>

        <div className="relative mx-auto w-full max-w-4xl overflow-hidden rounded-lg border border-zinc-200 bg-white">
          <img
            src={VEHICLE_DAMAGE_DIAGRAM_SRC}
            alt="Vehicle diagram with member damage markings"
            className="pointer-events-none block h-auto max-h-[min(70vh,680px)] w-full object-contain select-none"
            draggable={false}
            onError={(e) => {
              const img = e.currentTarget;
              if (!img.dataset.fallbackTried) {
                img.dataset.fallbackTried = '1';
                img.src = VEHICLE_DAMAGE_DIAGRAM_FALLBACK;
              }
            }}
          />
          <svg
            viewBox="0 0 100 100"
            className="pointer-events-none absolute inset-0 h-full w-full"
            preserveAspectRatio="none"
            aria-hidden
          >
            {strokes.map((stroke) => (
              <polyline
                key={stroke.id || stroke.points.map((p) => `${p.x},${p.y}`).join('-')}
                fill="none"
                stroke="#b91c1c"
                strokeWidth="0.85"
                strokeLinecap="round"
                strokeLinejoin="round"
                points={(stroke.points || []).map((pt) => `${pt.x},${pt.y}`).join(' ')}
              />
            ))}
            {markers.map((point, index) => (
              <g key={`${point.x}-${point.y}-${index}`} transform={`translate(${point.x},${point.y})`}>
                <circle r="2.35" fill="rgba(255,255,255,0.95)" stroke="#fecaca" strokeWidth="0.4" />
                <line x1="-1.5" y1="-1.5" x2="1.5" y2="1.5" stroke="#dc2626" strokeWidth="0.5" strokeLinecap="round" />
                <line x1="1.5" y1="-1.5" x2="-1.5" y2="1.5" stroke="#dc2626" strokeWidth="0.5" strokeLinecap="round" />
              </g>
            ))}
          </svg>
        </div>

        {markerCount === 0 && strokeCount === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 px-3 py-4 text-center text-sm text-zinc-500">
            No damage markers or drawings were placed on the diagram.
          </p>
        ) : null}
      </div>
    </section>
  );
}

/** HTML snippet for printable export (browser print / PDF fallback). */
export function damageDiagramExportHtml(damage) {
  const { markers, strokes } = resolveDamageDiagram(damage);
  const strokePolylines = strokes
    .map(
      (stroke) =>
        `<polyline fill="none" stroke="#b91c1c" stroke-width="0.85" stroke-linecap="round" stroke-linejoin="round" points="${(stroke.points || [])
          .map((pt) => `${pt.x},${pt.y}`)
          .join(' ')}" />`,
    )
    .join('');
  const markerGroups = markers
    .map(
      (point, index) =>
        `<g transform="translate(${point.x},${point.y})">
          <circle r="2.35" fill="rgba(255,255,255,0.95)" stroke="#fecaca" stroke-width="0.4" />
          <line x1="-1.5" y1="-1.5" x2="1.5" y2="1.5" stroke="#dc2626" stroke-width="0.5" />
          <line x1="1.5" y1="-1.5" x2="-1.5" y2="1.5" stroke="#dc2626" stroke-width="0.5" />
        </g>`,
    )
    .join('');

  return `
    <section class="section">
      <h2>Damage diagram (member markings)</h2>
      <p class="meta">Markers: ${markers.length} · Drawings: ${strokes.length}</p>
      <div style="position:relative;max-width:900px;margin:12px 0;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;background:#fff;">
        <img src="${VEHICLE_DAMAGE_DIAGRAM_SRC}" alt="Vehicle damage diagram" style="display:block;width:100%;height:auto;" />
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;">
          ${strokePolylines}
          ${markerGroups}
        </svg>
      </div>
    </section>`;
}
