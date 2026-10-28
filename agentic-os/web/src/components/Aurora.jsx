// Slow, soft aurora behind everything. Pure CSS transforms (cheap to animate at 60fps).
const BLOBS = [
  { c: 'rgba(56,120,255,0.55)', d: '26s', x0: '-25vmax', y0: '-30vmax', x1: '5vmax', y1: '-15vmax' },
  { c: 'rgba(130,80,255,0.45)', d: '32s', x0: '40vmax', y0: '-20vmax', x1: '20vmax', y1: '5vmax' },
  { c: 'rgba(20,200,170,0.32)', d: '38s', x0: '-10vmax', y0: '30vmax', x1: '25vmax', y1: '15vmax' },
  { c: 'rgba(236,72,153,0.18)', d: '44s', x0: '60vmax', y0: '35vmax', x1: '35vmax', y1: '20vmax' },
];

export default function Aurora() {
  return (
    <div className="aurora" aria-hidden="true">
      {BLOBS.map((b, i) => (
        <div key={i} className="blob" style={{ '--c': b.c, '--d': b.d, '--x0': b.x0, '--y0': b.y0, '--x1': b.x1, '--y1': b.y1 }} />
      ))}
    </div>
  );
}
