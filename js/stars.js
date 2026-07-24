// Port of BooksPro's 10-star rating system to the web.
// Scale: 0.25 .. 10, snapping to 0.25. Displayed as "X / 10".

export function formatRating(rating) {
  if (rating === Math.round(rating)) return String(Math.round(rating));
  let s = String(rating);
  if (s.endsWith('0')) s = s.slice(0, -1);
  return s;
}

// green for loved, gold for liked, red for suffered — one scale everywhere.
export function ratingColor(rating) {
  if (rating >= 8) return 'var(--green)';
  if (rating >= 5) return 'var(--gold)';
  return 'var(--red)';
}

// The word for a rating. With 10+ shelfRatings it ranks against the user's own
// history (midrank percentile, ties count half); otherwise absolute words.
export function ratingLabel(rating, shelfRatings = []) {
  if (shelfRatings.length >= 10) {
    let below = 0;
    for (const r of shelfRatings) {
      if (r < rating) below += 1;
      else if (r === rating) below += 0.5;
    }
    const p = below / shelfRatings.length;
    if (p >= 0.90) return 'An all-time favorite';
    if (p >= 0.72) return 'Among your favorites';
    if (p >= 0.55) return 'Loved more than most';
    if (p >= 0.38) return 'Middle of your shelf';
    if (p >= 0.18) return 'Liked less than most';
    return 'Bottom of your shelf';
  }
  if (rating >= 9.75) return 'Masterpiece';
  if (rating >= 9) return 'Amazing';
  if (rating >= 8) return 'Great';
  if (rating >= 7) return 'Good';
  if (rating >= 6) return 'Decent';
  if (rating >= 5) return 'Mid';
  if (rating >= 4) return 'Meh';
  if (rating >= 3) return 'Weak';
  if (rating >= 2) return 'Bad';
  return 'Awful';
}

// Build the five-pointed star path in a 100x100 box (matches BooksPro geometry).
const STAR_PATH = (() => {
  const c = 50, outer = 46, inner = outer * 0.46;
  let d = '';
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = (c + r * Math.cos(a)).toFixed(2);
    const y = (c + r * Math.sin(a)).toFixed(2);
    d += (i === 0 ? 'M' : 'L') + x + ' ' + y + ' ';
  }
  return d + 'Z';
})();

let _uid = 0;
// One star SVG with fractional horizontal fill (0..1) and optional glow.
function starSVG(fill, size, glow) {
  const id = 'st' + _uid++;
  const w = Math.max(0, Math.min(1, fill)) * 100;
  const glowFilter = glow && fill > 0
    ? `<filter id="g${id}"><feGaussianBlur stdDeviation="2.2"/></filter>`
    : '';
  const glowPath = glow && fill > 0
    ? `<path d="${STAR_PATH}" fill="var(--gold)" opacity="0.45" filter="url(#g${id})"/>`
    : '';
  return `<svg class="star" width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true">
    <defs>
      <clipPath id="c${id}"><rect x="0" y="0" width="${w}" height="100"/></clipPath>
      <linearGradient id="l${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ecc178"/><stop offset="1" stop-color="#c98f3c"/>
      </linearGradient>
      ${glowFilter}
    </defs>
    <path d="${STAR_PATH}" fill="none" stroke="rgba(255,255,255,0.16)" stroke-width="5" stroke-linejoin="round"/>
    <g clip-path="url(#c${id})">
      ${glowPath}
      <path d="${STAR_PATH}" fill="url(#l${id})" stroke="url(#l${id})" stroke-width="9" stroke-linejoin="round"/>
    </g>
  </svg>`;
}

// Read-only row of 10 stars for a rating.
export function starRow(rating, size = 15) {
  let html = `<span class="stars" style="gap:${(size * 0.14).toFixed(1)}px">`;
  for (let i = 0; i < 10; i++) html += starSVG(rating - i, size, false);
  return html + '</span>';
}

// Rating chip: "8.5 / 10" tinted by score.
export function ratingChip(rating) {
  const c = ratingColor(rating);
  return `<span class="chip" style="color:${c};border-color:color-mix(in srgb, ${c} 35%, transparent);background:color-mix(in srgb, ${c} 12%, transparent)">${formatRating(rating)}<span class="den">/10</span></span>`;
}

// Interactive input. Returns an element; read/observe value via callbacks.
// opts: { value=0, onChange(v) }
export function starInput({ value = 0, onChange } = {}) {
  const el = document.createElement('div');
  el.className = 'star-input stars';
  el.style.gap = '4px';
  let current = value;

  const width = () => el.clientWidth || 280;
  function render() {
    const size = (width() - 4 * 9) / 10;
    let html = '';
    for (let i = 0; i < 10; i++) html += starSVG(current - i, size, true);
    el.innerHTML = html;
  }
  function setFromX(clientX) {
    const rect = el.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const v = Math.max(0.25, Math.min(10, Math.round((frac * 10) / 0.25) * 0.25));
    if (v !== current) {
      current = v;
      render();
      if (navigator.vibrate) navigator.vibrate(3);
      onChange && onChange(current);
    }
  }
  let dragging = false;
  el.addEventListener('pointerdown', (e) => { dragging = true; el.setPointerCapture(e.pointerId); setFromX(e.clientX); });
  el.addEventListener('pointermove', (e) => { if (dragging) setFromX(e.clientX); });
  el.addEventListener('pointerup', () => { dragging = false; });
  el.addEventListener('pointercancel', () => { dragging = false; });

  el.getValue = () => current;
  el.setValue = (v) => { current = v; render(); };
  // Render once mounted (needs width). Caller should call el.refresh() after insert.
  el.refresh = render;
  requestAnimationFrame(render);
  return el;
}
