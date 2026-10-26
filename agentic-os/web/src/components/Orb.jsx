import { useEffect, useRef } from 'react';

// The voice orb. Three distinct looks:
//   idle      — calm blue, slow breathing pulse
//   listening — green, swells with your microphone level
//   speaking  — violet, ripples with the assistant's voice
// levelRef.current (0..1) is written by the voice hook from live audio analysers.
const PALETTES = {
  idle: [[96, 165, 250], [59, 130, 246], [30, 58, 138]],
  connecting: [[125, 180, 255], [80, 140, 240], [40, 60, 150]],
  listening: [[110, 231, 160], [34, 197, 94], [6, 78, 59]],
  speaking: [[196, 160, 255], [139, 92, 246], [59, 25, 125]],
  error: [[252, 165, 165], [239, 68, 68], [90, 20, 30]],
};

const lerp = (a, b, t) => a + (b - a) * t;
const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

export default function Orb({ state = 'idle', levelRef, size = 300 }) {
  const canvasRef = useRef(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = size * 1.7;
    canvas.width = W * dpr;
    canvas.height = W * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${W}px`;
    ctx.scale(dpr, dpr);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let raf;
    let level = 0;
    let colors = PALETTES.idle.map((c) => [...c]);
    const start = performance.now();
    const cx = W / 2;
    const cy = W / 2;
    const R = size * 0.36;

    function blob(t, radius, wobble, phase) {
      const N = 120;
      ctx.beginPath();
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2;
        const r = radius * (1
          + wobble * 0.55 * Math.sin(a * 3 + t * 1.1 + phase)
          + wobble * 0.35 * Math.sin(a * 5 - t * 1.7 + phase * 2)
          + wobble * 0.2 * Math.sin(a * 2 + t * 0.6));
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
    }

    function frame(now) {
      const t = ((now - start) / 1000) * (reduced ? 0.35 : 1);
      const s = stateRef.current;
      const target = PALETTES[s] ?? PALETTES.idle;
      colors = colors.map((c, i) => c.map((v, j) => lerp(v, target[i][j], 0.06)));

      const breathing = (Math.sin(t * 1.25) + 1) / 2; // 0..1
      const live = Math.min(1, Math.max(0, levelRef?.current ?? 0));
      const want = s === 'listening' || s === 'speaking' ? Math.max(live, 0.04) : s === 'connecting' ? 0.12 + 0.1 * breathing : 0.05 * breathing;
      level = lerp(level, want, want > level ? 0.35 : 0.12);

      ctx.clearRect(0, 0, W, W);
      const radius = R * (1 + level * 0.22 + (s === 'idle' ? 0.025 * breathing : 0));

      // Outer glow
      const glow = ctx.createRadialGradient(cx, cy, radius * 0.4, cx, cy, radius * (1.9 + level * 0.6));
      glow.addColorStop(0, rgba(colors[1], 0.42 + level * 0.25));
      glow.addColorStop(0.45, rgba(colors[1], 0.12 + level * 0.1));
      glow.addColorStop(1, rgba(colors[2], 0));
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, W);

      // Two soft ribbons behind the core, blended with "screen" for a luminous edge
      ctx.globalCompositeOperation = 'screen';
      const wob = 0.025 + level * 0.12;
      for (let k = 0; k < 2; k++) {
        blob(t * (0.8 + k * 0.3), radius * (1.04 + k * 0.03), wob * (1.2 + k), k * 2.1);
        const g = ctx.createRadialGradient(cx - radius * 0.3, cy - radius * 0.4, radius * 0.1, cx, cy, radius * 1.1);
        g.addColorStop(0, rgba(colors[0], 0.0));
        g.addColorStop(0.7, rgba(colors[k === 0 ? 0 : 1], 0.28));
        g.addColorStop(1, rgba(colors[2], 0.0));
        ctx.fillStyle = g;
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';

      // Core sphere
      blob(t, radius, wob * 0.7, 0.7);
      const core = ctx.createRadialGradient(cx - radius * 0.35, cy - radius * 0.42, radius * 0.05, cx, cy, radius * 1.05);
      core.addColorStop(0, rgba([255, 255, 255], 0.95));
      core.addColorStop(0.18, rgba(colors[0], 0.95));
      core.addColorStop(0.6, rgba(colors[1], 0.92));
      core.addColorStop(1, rgba(colors[2], 0.95));
      ctx.fillStyle = core;
      ctx.fill();

      // Glass highlight
      const hl = ctx.createRadialGradient(cx - radius * 0.3, cy - radius * 0.5, 0, cx - radius * 0.3, cy - radius * 0.5, radius * 0.55);
      hl.addColorStop(0, 'rgba(255,255,255,0.35)');
      hl.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = hl;
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 0.98, 0, Math.PI * 2);
      ctx.fill();

      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [size, levelRef]);

  return <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none select-none" />;
}
