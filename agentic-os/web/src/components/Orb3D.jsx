import { useEffect, useRef } from 'react';
import * as THREE from 'three';

// The 3D voice orb (WebGL / three.js).
//   - A sphere whose surface flows with 3D noise; the motion grows with the live audio level.
//   - Lit like a glossy glass/plasma ball: soft diffuse, a sharp specular highlight, a fresnel rim.
//   - An orbiting particle halo and an additive glow behind it.
//   - Interactive: tilts toward the cursor, bulges where you hover, drag to spin (with inertia),
//     click to ripple + trigger onActivate (start/stop voice).
// States: idle (blue, breathing), connecting, listening (green), speaking (violet), error.

const PALETTES = {
  idle: ['#cfe3ff', '#3b82f6', '#081a4d'],
  connecting: ['#e0ecff', '#60a5fa', '#0e2466'],
  listening: ['#d4ffe6', '#22c55e', '#03301a'],
  speaking: ['#efe2ff', '#8b5cf6', '#1d0a4f'],
  error: ['#ffd9d9', '#ef4444', '#3d0909'],
};

// 3D simplex noise — Ian McEwan / Ashima Arts (MIT license).
const NOISE = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+10.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);
  const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));
  vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);
  vec3 l=1.0-g;
  vec3 i1=min(g.xyz,l.zxy);
  vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;
  vec3 x2=x0-i2+C.yyy;
  vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;
  vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z);
  vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;
  vec4 y=y_*ns.x+ns.yyyy;
  vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);
  vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;
  vec4 s1=floor(b1)*2.0+1.0;
  vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;
  vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);
  vec3 p1=vec3(a0.zw,h.y);
  vec3 p2=vec3(a1.xy,h.z);
  vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.5-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);
  m=m*m;
  return 105.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
`;

const SPHERE_VERT = /* glsl */ `
uniform float uTime;
uniform float uLevel;
uniform float uHover;
uniform float uRipple;
uniform vec3 uMouse;
varying vec3 vNormal;
varying vec3 vViewPos;
varying vec3 vObj;
varying float vNoise;
${NOISE}
float disp(vec3 p){
  float t = uTime;
  float n = snoise(p * 1.1 + vec3(0.0, t * 0.22, t * 0.17));
  float n2 = snoise(p * 2.6 - vec3(t * 0.45, 0.0, t * 0.32)) * (0.15 + uLevel * 0.6);
  float amp = 0.022 + uLevel * 0.24;
  float d = (n + n2) * amp;
  float md = distance(p, uMouse);
  d += uHover * 0.11 * smoothstep(0.85, 0.0, md);
  if (uRipple >= 0.0) d += 0.07 * sin(md * 11.0 - uRipple * 13.0) * exp(-uRipple * 2.6);
  return d;
}
void main(){
  vec3 p = normalize(position);
  float d = disp(p);
  vec3 P = p * (1.0 + d);
  // Recompute the normal from two nearby displaced points, so lighting follows the waves.
  vec3 up = abs(p.y) > 0.99 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 t1 = normalize(cross(p, up));
  vec3 t2 = normalize(cross(p, t1));
  float e = 0.012;
  vec3 a = normalize(p + t1 * e);
  vec3 b = normalize(p + t2 * e);
  vec3 A = a * (1.0 + disp(a));
  vec3 B = b * (1.0 + disp(b));
  vec3 n = normalize(cross(A - P, B - P));
  if (dot(n, p) < 0.0) n = -n;
  n = normalize(mix(p, n, 0.65)); // keep it glossy-smooth
  vNoise = d / (0.022 + uLevel * 0.24);
  vObj = P;
  vNormal = normalize(normalMatrix * n);
  vec4 mv = modelViewMatrix * vec4(P, 1.0);
  vViewPos = mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

const SPHERE_FRAG = /* glsl */ `
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
uniform float uTime;
uniform float uLevel;
varying vec3 vNormal;
varying vec3 vViewPos;
varying vec3 vObj;
varying float vNoise;
${NOISE}
void main(){
  vec3 N = normalize(vNormal);
  vec3 V = normalize(-vViewPos);
  float ndv = max(dot(N, V), 0.0);
  float fres = pow(1.0 - ndv, 2.4);

  // Plasma inside the ball: two layers of slow swirling noise.
  float sw = snoise(vObj * 1.5 + vec3(uTime * 0.16, -uTime * 0.11, uTime * 0.09)) * 0.5 + 0.5;
  float sw2 = snoise(vObj * 3.2 - vec3(uTime * 0.21)) * 0.5 + 0.5;
  vec3 base = mix(uC2 * 0.55, uC2, smoothstep(0.15, 0.9, sw));
  base = mix(base, uC3, smoothstep(0.55, 1.0, 1.0 - N.y * 0.5 - 0.5) * 0.45);           // deeper toward the bottom
  base += uC1 * pow(sw * sw2, 2.0) * (0.55 + uLevel * 0.9);                              // bright plasma veins
  base += uC1 * smoothstep(0.4, 1.0, vNoise * 0.5 + 0.5) * uLevel * 0.5;

  vec3 L1 = normalize(vec3(-0.55, 0.75, 0.65));
  vec3 L2 = normalize(vec3(0.7, -0.5, 0.4));
  float diff = max(dot(N, L1), 0.0) * 0.45 + max(dot(N, L2), 0.0) * 0.15 + 0.55;

  vec3 col = base * diff;
  col += uC2 * pow(ndv, 3.0) * (0.25 + uLevel * 0.6);            // core glow facing you
  col += mix(uC2, uC1, 0.6) * fres * 1.1;                        // rim light
  col += 0.05 * vec3(sin(fres * 7.0 + uTime), sin(fres * 7.0 + 2.1 + uTime), sin(fres * 7.0 + 4.2 + uTime));
  gl_FragColor = vec4(col, 1.0);
}
`;

const SHELL_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
void main(){
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vV = mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;
const SHELL_FRAG = /* glsl */ `
uniform vec3 uC1;
uniform vec3 uC2;
uniform float uLevel;
varying vec3 vN;
varying vec3 vV;
void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(-vV);
  float ndv = max(dot(N, V), 0.0);
  float fres = pow(1.0 - ndv, 3.0);
  vec3 L = normalize(vec3(-0.55, 0.75, 0.65));
  vec3 H = normalize(L + V);
  float nh = max(dot(N, H), 0.0);
  float spec = pow(nh, 160.0) * 0.75 + pow(nh, 22.0) * 0.16;
  // soft "window" reflection: a studio light streak across the top of the glass
  vec3 R = reflect(-V, N);
  float streak = smoothstep(0.55, 0.85, R.y) * smoothstep(0.9, 0.2, abs(R.x + 0.25)) * 0.22;
  vec3 col = vec3(1.0) * (spec + streak) + mix(uC1, uC2, 0.45) * fres * 0.7;
  float a = clamp(spec + streak + fres * 0.45, 0.0, 1.0);
  gl_FragColor = vec4(col, a);
}
`;

const GLOW_VERT = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const GLOW_FRAG = /* glsl */ `
uniform vec3 uC2;
uniform float uLevel;
uniform float uTime;
varying vec2 vUv;
void main(){
  float r = length(vUv - 0.5) * 2.0;
  float g = pow(max(1.0 - r, 0.0), 2.0) * (1.0 + uLevel * 1.2 + 0.08 * sin(uTime * 1.3));
  gl_FragColor = vec4(uC2 * g, g);
}
`;

const PTS_VERT = /* glsl */ `
attribute vec3 aSeed;
uniform float uTime;
uniform float uLevel;
uniform float uPixel;
varying float vAlpha;
varying float vMix;
void main(){
  float speed = 0.08 + aSeed.x * 0.22;
  float ang = uTime * speed + aSeed.y * 6.2831;
  float c = cos(ang), s = sin(ang);
  vec3 p = position;
  p.xz = mat2(c, -s, s, c) * p.xz;
  float pulse = 1.0 + uLevel * (0.35 + aSeed.z * 0.4) + 0.03 * sin(uTime * 1.7 + aSeed.y * 20.0);
  p *= pulse;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = (2.0 + aSeed.z * 4.0) * uPixel * (6.0 / -mv.z);
  vAlpha = (0.35 + aSeed.x * 0.65) * (0.7 + uLevel * 0.9);
  vMix = aSeed.z;
}
`;
const PTS_FRAG = /* glsl */ `
uniform vec3 uC1;
uniform vec3 uC2;
varying float vAlpha;
varying float vMix;
void main(){
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d) * vAlpha;
  gl_FragColor = vec4(mix(uC2, uC1, vMix) * a, a);
}
`;

export default function Orb3D({ state = 'idle', levelRef, onActivate, size = 340, label = 'Voice orb' }) {
  const mountRef = useRef(null);
  const stateRef = useRef(state);
  const activateRef = useRef(onActivate);
  stateRef.current = state;
  activateRef.current = onActivate;

  useEffect(() => {
    const mount = mountRef.current;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.touchAction = 'none';

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
    camera.position.set(0, 0, 6.2);

    const toVec = (hex) => new THREE.Color(hex);
    const pal = PALETTES[stateRef.current] ?? PALETTES.idle;
    const uniforms = {
      uTime: { value: 0 },
      uLevel: { value: 0 },
      uHover: { value: 0 },
      uRipple: { value: -1 },
      uMouse: { value: new THREE.Vector3(0, 0, 1) },
      uC1: { value: toVec(pal[0]) },
      uC2: { value: toVec(pal[1]) },
      uC3: { value: toVec(pal[2]) },
      uPixel: { value: dpr },
    };

    const group = new THREE.Group();
    scene.add(group);

    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(5.6, 5.6),
      new THREE.ShaderMaterial({ uniforms, vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    glow.position.z = -1.2;
    scene.add(glow);

    const sphere = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1, 48),
      new THREE.ShaderMaterial({ uniforms, vertexShader: SPHERE_VERT, fragmentShader: SPHERE_FRAG }),
    );
    group.add(sphere);

    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(1.06, 96, 64),
      new THREE.ShaderMaterial({ uniforms, vertexShader: SHELL_VERT, fragmentShader: SHELL_FRAG, transparent: true, depthWrite: false, blending: THREE.NormalBlending }),
    );
    scene.add(shell); // not in the rotating group: reflections stay put like real glass

    const COUNT = 900;
    const pos = new Float32Array(COUNT * 3);
    const seed = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const r = 1.32 + Math.pow(Math.random(), 2) * 0.75;
      const k = Math.sqrt(1 - u * u);
      pos.set([Math.cos(th) * k * r, u * r * 0.82, Math.sin(th) * k * r], i * 3);
      seed.set([Math.random(), Math.random(), Math.random()], i * 3);
    }
    const ptsGeo = new THREE.BufferGeometry();
    ptsGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    ptsGeo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
    const points = new THREE.Points(ptsGeo, new THREE.ShaderMaterial({ uniforms, vertexShader: PTS_VERT, fragmentShader: PTS_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    group.add(points);

    // ----- sizing -----
    function resize() {
      const w = mount.clientWidth || size;
      const h = mount.clientHeight || size;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = `${w}px`;
      renderer.domElement.style.height = `${h}px`;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    const ro = new ResizeObserver(resize);
    ro.observe(mount);
    resize();

    // ----- interaction -----
    const ndc = new THREE.Vector2(0, 0);
    const ray = new THREE.Raycaster();
    const ballWorld = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1.05);
    const hitPoint = new THREE.Vector3();
    let pointerInside = false;
    let hovering = false;
    let dragging = false;
    let dragMoved = 0;
    let last = { x: 0, y: 0 };
    let spinVel = 0;
    let spinVelX = 0;
    let spinY = 0;
    let spinX = 0;
    let rippleStart = -1;

    function setPointer(e) {
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    }
    const onMove = (e) => {
      setPointer(e);
      pointerInside = true;
      if (dragging) {
        const dx = e.clientX - last.x;
        const dy = e.clientY - last.y;
        dragMoved += Math.abs(dx) + Math.abs(dy);
        spinVel = dx * 0.006;
        spinVelX = dy * 0.004;
        spinY += spinVel;
        spinX = Math.max(-0.9, Math.min(0.9, spinX + spinVelX));
        last = { x: e.clientX, y: e.clientY };
      }
    };
    const onDown = (e) => {
      setPointer(e);
      dragging = true;
      dragMoved = 0;
      last = { x: e.clientX, y: e.clientY };
      renderer.domElement.setPointerCapture?.(e.pointerId);
    };
    const onUp = (e) => {
      if (dragging && dragMoved < 6 && hovering) {
        rippleStart = clock.getElapsedTime();
        activateRef.current?.();
      }
      dragging = false;
      renderer.domElement.releasePointerCapture?.(e.pointerId);
    };
    const onLeave = () => { pointerInside = false; };
    const el = renderer.domElement;
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointerleave', onLeave);

    // ----- animation -----
    const clock = new THREE.Clock();
    const target = { c1: new THREE.Color(), c2: new THREE.Color(), c3: new THREE.Color() };
    let level = 0;
    let raf;
    let prev = 0;
    function frame() {
      raf = requestAnimationFrame(frame);
      const now = clock.getElapsedTime();
      const dt = Math.min(0.05, now - prev);
      prev = now;
      const t = now * (reduced ? 0.35 : 1);
      const s = stateRef.current;
      const p = PALETTES[s] ?? PALETTES.idle;
      target.c1.set(p[0]); target.c2.set(p[1]); target.c3.set(p[2]);
      uniforms.uC1.value.lerp(target.c1, 0.06);
      uniforms.uC2.value.lerp(target.c2, 0.06);
      uniforms.uC3.value.lerp(target.c3, 0.06);

      const breathing = (Math.sin(t * 1.2) + 1) / 2;
      const live = Math.min(1, Math.max(0, levelRef?.current ?? 0));
      const want = s === 'listening' || s === 'speaking' ? Math.max(live, 0.05) : s === 'connecting' ? 0.15 + 0.12 * breathing : 0.035 * breathing;
      level += (want - level) * (want > level ? 0.3 : 0.08);

      // Hover test against the ball
      ray.setFromCamera(ndc, camera);
      const hit = pointerInside && ray.ray.intersectSphere(ballWorld, hitPoint);
      hovering = !!hit;
      el.style.cursor = hovering ? 'pointer' : dragging ? 'grabbing' : 'default';
      if (hovering) {
        const local = sphere.worldToLocal(hitPoint.clone()).normalize();
        uniforms.uMouse.value.lerp(local, 0.25);
      }
      uniforms.uHover.value += ((hovering ? 1 : 0) - uniforms.uHover.value) * 0.1;

      // Rotation: slow auto-spin + drag inertia + tilt toward the cursor
      if (!dragging) {
        spinVel *= 0.95;
        spinVelX *= 0.92;
        spinY += spinVel + dt * (reduced ? 0.03 : 0.12);
        spinX *= 0.97;
      }
      const tiltX = pointerInside ? -ndc.y * 0.25 : 0;
      const tiltY = pointerInside ? ndc.x * 0.35 : 0;
      group.rotation.y += ((spinY + tiltY) - group.rotation.y) * 0.12;
      group.rotation.x += ((spinX + tiltX) - group.rotation.x) * 0.12;

      const scale = 1 + level * 0.16 + uniforms.uHover.value * 0.035 + (s === 'idle' ? 0.02 * breathing : 0);
      group.scale.setScalar(scale);
      shell.scale.setScalar(scale * (1 + level * 0.12));
      glow.scale.setScalar(0.9 + level * 0.5 + uniforms.uHover.value * 0.06);

      uniforms.uTime.value = t;
      uniforms.uLevel.value = level;
      uniforms.uRipple.value = rippleStart < 0 ? -1 : now - rippleStart;
      if (rippleStart >= 0 && now - rippleStart > 2.5) rippleStart = -1;

      renderer.render(scene, camera);
    }
    frame();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointerleave', onLeave);
      sphere.geometry.dispose(); sphere.material.dispose();
      glow.geometry.dispose(); glow.material.dispose();
      shell.geometry.dispose(); shell.material.dispose();
      ptsGeo.dispose(); points.material.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [levelRef, size]);

  return <div ref={mountRef} role="img" aria-label={label} style={{ width: '100%', height: size }} />;
}
