import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// Cabin dimensions (local space: front wall faces +z, toward the plaza).
export const CABIN = { W: 10, H: 5, D: 8, RISE: 3.6, OVER: 0.7 };

const CABIN_STYLES = [
  { name: 'Gingerbread Cottage', wall: 0xa8643a, trim: 0xf4ead8, door: 0x8e1f2b },
  { name: 'Pinecone Lodge', wall: 0x6b4330, trim: 0xe8dcc4, door: 0x2f5d3a },
  { name: 'Hollyberry House', wall: 0x8f2f2f, trim: 0xf7efe2, door: 0x1f3d2b },
  { name: 'Frostwood Cabin', wall: 0x5d6f78, trim: 0xf0f4f7, door: 0xb23a3a },
  { name: 'Cocoa Corner', wall: 0x7a5236, trim: 0xf3e3c9, door: 0x2c4a6e },
];

function rand(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// ---------- painted textures ----------
// Everything is painted onto canvases at startup: soft brushy blotches and strokes
// instead of photo detail, so surfaces read as hand-painted rather than flat or noisy.

// draw a shape at its spot plus its wrapped copies so the texture tiles seamlessly
function wrapDraw(w, h, x, y, rad, fn) {
  for (const ox of [-w, 0, w]) {
    for (const oy of [-h, 0, h]) {
      if (x + ox + rad < 0 || x + ox - rad > w || y + oy + rad < 0 || y + oy - rad > h) continue;
      fn(x + ox, y + oy);
    }
  }
}

function paintSnow(size, seed, { ripples }) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const r = rand(seed);
  g.fillStyle = '#e3eaf6';
  g.fillRect(0, 0, size, size);
  // big soft patches of cool shadow and warm-white highlight
  for (let i = 0; i < 46; i++) {
    const x = r() * size;
    const y = r() * size;
    const rad = size * (0.08 + r() * 0.18);
    const light = r() > 0.45;
    wrapDraw(size, size, x, y, rad, (px, py) => {
      const grad = g.createRadialGradient(px, py, 0, px, py, rad);
      grad.addColorStop(0, light ? 'rgba(250,252,255,0.55)' : 'rgba(184,198,228,0.4)');
      grad.addColorStop(1, light ? 'rgba(250,252,255,0)' : 'rgba(184,198,228,0)');
      g.fillStyle = grad;
      g.fillRect(px - rad, py - rad, rad * 2, rad * 2);
    });
  }
  // wind-swept ripples
  if (ripples) {
    g.lineCap = 'round';
    for (let i = 0; i < 140; i++) {
      const x = r() * size;
      const y = r() * size;
      const len = size * (0.04 + r() * 0.08);
      const bend = (r() - 0.5) * len * 0.5;
      const dark = r() > 0.4;
      g.strokeStyle = dark ? `rgba(165,180,214,${0.2 + r() * 0.2})` : `rgba(255,255,255,${0.35 + r() * 0.3})`;
      g.lineWidth = 1.5 + r() * 2.5;
      wrapDraw(size, size, x, y, len, (px, py) => {
        g.beginPath();
        g.moveTo(px - len / 2, py);
        g.quadraticCurveTo(px, py + bend, px + len / 2, py + bend * 0.3);
        g.stroke();
      });
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

// tiny glints, used as an emissive map so fresh snow catches the light
function paintSparkles(size, seed, count) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const r = rand(seed);
  g.fillStyle = '#000';
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < count; i++) {
    const x = r() * size;
    const y = r() * size;
    const big = r() > 0.85;
    g.fillStyle = `rgba(255,255,255,${0.5 + r() * 0.5})`;
    if (big) {
      // four-point twinkle
      g.beginPath();
      g.moveTo(x, y - 3);
      g.lineTo(x + 0.8, y - 0.8);
      g.lineTo(x + 3, y);
      g.lineTo(x + 0.8, y + 0.8);
      g.lineTo(x, y + 3);
      g.lineTo(x - 0.8, y + 0.8);
      g.lineTo(x - 3, y);
      g.lineTo(x - 0.8, y - 0.8);
      g.fill();
    } else {
      g.fillRect(x, y, 1.2, 1.2);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// brushy pine needles in light neutral tones; instance/material color tints them green
function paintNeedles() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const r = rand(321);
  g.fillStyle = '#b9c6bb';
  g.fillRect(0, 0, size, size);
  g.lineCap = 'round';
  // rows of drooping boughs: a darker shadow band under each row
  for (let row = 0; row < 4; row++) {
    const y = row * (size / 4) + size / 8;
    const grad = g.createLinearGradient(0, y - 18, 0, y + 30);
    grad.addColorStop(0, 'rgba(70,90,78,0)');
    grad.addColorStop(1, 'rgba(70,90,78,0.45)');
    g.fillStyle = grad;
    g.fillRect(0, y - 18, size, 48);
  }
  // needle strokes, mostly pointing down and out
  for (let i = 0; i < 900; i++) {
    const x = r() * size;
    const y = r() * size;
    const len = 8 + r() * 16;
    const ang = Math.PI / 2 + (r() - 0.5) * 0.9;
    const tone = r();
    g.strokeStyle = tone > 0.62 ? `rgba(245,250,240,${0.35 + r() * 0.35})` : `rgba(80,100,88,${0.3 + r() * 0.35})`;
    g.lineWidth = 1.5 + r() * 2;
    wrapDraw(size, size, x, y, len, (px, py) => {
      g.beginPath();
      g.moveTo(px, py);
      g.lineTo(px + Math.cos(ang) * len, py + Math.sin(ang) * len);
      g.stroke();
    });
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 1.5);
  tex.anisotropy = 4;
  return tex;
}

const groundSnowTex = paintSnow(512, 7, { ripples: true });
groundSnowTex.repeat.set(26, 26);
const groundSparkleTex = paintSparkles(512, 8, 260);
groundSparkleTex.repeat.set(26, 26);
const surfaceSnowTex = paintSnow(256, 11, { ripples: false });
const surfaceSparkleTex = paintSparkles(256, 12, 90);
const needleTex = paintNeedles();

// shared look for every snowy surface (roofs, caps, sills, drifts)
function snowMaterial(extra = {}) {
  return new THREE.MeshStandardMaterial({
    map: surfaceSnowTex,
    color: 0xffffff,
    roughness: 0.8,
    emissive: 0xffffff,
    emissiveMap: surfaceSparkleTex,
    emissiveIntensity: 0.5,
    ...extra,
  });
}

let glowTex;
export function getGlowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

// ---------- sky ----------
const SUN_DIR = new THREE.Vector3(0.78, 0.07, -0.62).normalize();
function buildSky(scene) {
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uHorizon: { value: new THREE.Color(0.13, 0.16, 0.32) },
      uTop: { value: new THREE.Color(0.01, 0.02, 0.07) },
      uSun: { value: SUN_DIR.clone() },
      uSunColor: { value: new THREE.Color(1, 0.7, 0.45) },
      uDawn: { value: 0 },
    },
    vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 uHorizon; uniform vec3 uTop; uniform vec3 uSun; uniform vec3 uSunColor; uniform float uDawn;
      varying vec3 vP; void main(){
        float h = clamp(vP.y*0.5+0.5,0.0,1.0);
        vec3 col = mix(uHorizon, uTop, smoothstep(0.45,0.95,h));
        float s = max(dot(normalize(vP), uSun), 0.0);
        col += uSunColor * (pow(s, 6.0) * 0.55 + pow(s, 120.0) * 1.2) * uDawn;
        gl_FragColor = vec4(col,1.0);
      }`,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), skyMat));

  const r = rand(42);
  const count = 1600;
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const theta = r() * Math.PI * 2;
    const phi = Math.acos(0.05 + r() * 0.95);
    pos[i * 3] = 450 * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = 450 * Math.cos(phi);
    pos[i * 3 + 2] = 450 * Math.sin(phi) * Math.sin(theta);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85 });
  scene.add(new THREE.Points(geo, starMat));

  const moonMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff4dc).multiplyScalar(1.4), fog: false, transparent: true });
  const moon = new THREE.Mesh(new THREE.SphereGeometry(14, 24, 16), moonMat);
  moon.position.set(-180, 210, -300);
  scene.add(moon);

  const sunMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.1, 0.7), fog: false, transparent: true, opacity: 0 });
  const sun = new THREE.Mesh(new THREE.SphereGeometry(18, 24, 16), sunMat);
  sun.position.copy(SUN_DIR).multiplyScalar(440).add(new THREE.Vector3(0, -30, 0));
  scene.add(sun);
  return { skyMat, starMat, moonMat, sun, sunMat };
}

// ---------- extra textures ----------
function canvasTex(w, h, draw, repeat = [1, 1]) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  return tex;
}

// bark runs along the log (cylinder v axis), so streak along y
const barkTex = canvasTex(128, 128, (g, w, h) => {
  const r = rand(99);
  g.fillStyle = '#b9b9b9';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 90; i++) {
    const v = 150 + Math.floor(r() * 90);
    g.strokeStyle = `rgba(${v},${v},${v},0.55)`;
    g.lineWidth = 1 + r() * 3;
    const x = r() * w;
    g.beginPath();
    g.moveTo(x, 0);
    g.bezierCurveTo(x + r() * 10 - 5, h * 0.3, x + r() * 10 - 5, h * 0.7, x, h);
    g.stroke();
  }
  for (let i = 0; i < 12; i++) {
    g.fillStyle = 'rgba(70,70,70,0.35)';
    g.beginPath();
    g.ellipse(r() * w, r() * h, 2 + r() * 3, 4 + r() * 6, 0, 0, Math.PI * 2);
    g.fill();
  }
});

const endGrainTex = canvasTex(64, 64, (g) => {
  g.fillStyle = '#d9b688';
  g.fillRect(0, 0, 64, 64);
  for (let r = 4; r < 34; r += 4) {
    g.strokeStyle = r % 8 ? 'rgba(150,100,55,0.45)' : 'rgba(120,75,40,0.6)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(32, 32, r, 0, Math.PI * 2);
    g.stroke();
  }
});

const stoneTex = canvasTex(128, 128, (g, w, h) => {
  const r = rand(5);
  g.fillStyle = '#4b4b52';
  g.fillRect(0, 0, w, h);
  for (let row = 0; row < 5; row++) {
    let x = row % 2 ? -12 : 0;
    while (x < w) {
      const sw = 20 + r() * 18;
      const v = 120 + Math.floor(r() * 60);
      g.fillStyle = `rgb(${v},${v - 4},${v + 6})`;
      g.beginPath();
      g.roundRect(x + 2, row * 26 + 2, sw - 4, 22, 7);
      g.fill();
      x += sw;
    }
  }
});

const plankTex = canvasTex(128, 128, (g, w, h) => {
  g.fillStyle = '#d0d0d0';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 8; i++) {
    const v = 185 + ((i * 53) % 50);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(i * 16 + 1, 0, 14, h);
    g.fillStyle = 'rgba(60,60,60,0.5)';
    g.fillRect(i * 16, 0, 1.5, h);
  }
});

// ---------- stylized pine tiers ----------
// An open cone whose bottom rim zig-zags (branch tips dip down, gaps tuck up), so each
// tier reads as a skirt of boughs instead of a smooth cone.
function tierGeo(radius, height, segs, jag, seed = 1) {
  const r = rand(seed);
  const g = new THREE.ConeGeometry(radius, height, segs, 3, true);
  const pos = g.attributes.position;
  const ringOffsets = Array.from({ length: segs + 1 }, () => 0.85 + r() * 0.3);
  ringOffsets[segs] = ringOffsets[0];
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const level = (y + height / 2) / height; // 0 at rim, 1 at tip
    if (level > 0.999) continue;
    const x = pos.getX(i);
    const z = pos.getZ(i);
    let a = Math.atan2(z, x);
    if (a < 0) a += Math.PI * 2;
    const k = Math.round((a / (Math.PI * 2)) * segs);
    const tip = k % 2 === 0;
    const rim = 1 - level;
    const s = 1 + (tip ? 0.12 : -0.14) * rim * rim + (ringOffsets[k] - 1) * 0.3 * rim;
    pos.setX(i, x * s);
    pos.setZ(i, z * s);
    pos.setY(i, y + (tip ? -jag : jag * 0.7) * rim * rim);
  }
  g.computeVertexNormals();
  return g;
}

// ---------- trees ----------
function buildForest(scene, colliders, avoid) {
  const r = rand(1234);
  const spots = [];
  let tries = 0;
  while (spots.length < 160 && tries < 6000) {
    tries++;
    const a = r() * Math.PI * 2;
    const d = 16 + r() * 66;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (avoid.some((p) => Math.hypot(p.x - x, p.z - z) < p.r)) continue;
    if (spots.some((s) => Math.hypot(s.x - x, s.z - z) < 3.4)) continue;
    if (d < 44 && r() < 0.75) continue;
    // a mix of tall-slim and short-bushy firs
    const s = 0.75 + r() * 0.85;
    spots.push({ x, z, s, sx: s * (0.85 + r() * 0.35), rot: r() * Math.PI * 2, tint: r() });
  }

  const tiers = [
    { r: 2.7, h: 2.7, y: 2.2 },
    { r: 2.25, h: 2.4, y: 3.55 },
    { r: 1.75, h: 2.1, y: 4.8 },
    { r: 1.2, h: 1.9, y: 5.95 },
  ];
  const trunk = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.22, 0.4, 2, 7),
    new THREE.MeshStandardMaterial({ color: 0x5a3b28, map: barkTex, roughness: 1 }),
    spots.length,
  );
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  spots.forEach((t, i) => {
    m.compose(p.set(t.x, 1 * t.s, t.z), q.identity(), sc.set(t.sx, t.s, t.sx));
    trunk.setMatrixAt(i, m);
    // block at the lowest branches, not just the trunk
    colliders.push({ x: t.x, z: t.z, r: 2.3 * t.sx, br: 2.5 * t.sx, top: 7.5 * t.s });
  });
  trunk.castShadow = true;
  scene.add(trunk);
  const tierMeshes = [];

  const greens = [new THREE.Color(0x1d4a36), new THREE.Color(0x2a6045), new THREE.Color(0x335f3a), new THREE.Color(0x1f5246)];
  const needleMat = new THREE.MeshStandardMaterial({ map: needleTex, roughness: 0.85, flatShading: true, side: THREE.DoubleSide });
  const snowMat = snowMaterial({ flatShading: true, side: THREE.DoubleSide });
  const col = new THREE.Color();
  tiers.forEach((tier, ti) => {
    const mesh = new THREE.InstancedMesh(tierGeo(tier.r, tier.h, 14, 0.38, 10 + ti), needleMat, spots.length);
    const snow = new THREE.InstancedMesh(tierGeo(tier.r * 0.6, tier.h * 0.5, 12, 0.22, 30 + ti), snowMat, spots.length);
    spots.forEach((t, i) => {
      q.setFromAxisAngle(up, t.rot + ti * 0.7);
      m.compose(p.set(t.x, tier.y * t.s, t.z), q, sc.set(t.sx, t.s, t.sx));
      mesh.setMatrixAt(i, m);
      // lighter tiers toward the top, plus per-tree hue variety
      col.copy(greens[Math.floor(t.tint * greens.length)]).multiplyScalar(1.15 + ti * 0.1);
      mesh.setColorAt(i, col);
      m.compose(p.set(t.x, (tier.y + tier.h * 0.27) * t.s, t.z), q, sc.set(t.sx, t.s, t.sx));
      snow.setMatrixAt(i, m);
    });
    mesh.castShadow = true;
    scene.add(mesh, snow);
    tierMeshes.push({ mesh, snow, tier });
  });

  // trees remember how to redraw themselves so a snowball can shake one
  const hr = rand(808);
  const trees = spots.map((t, i) => ({ ...t, index: i, shake: 0, snowLeft: 1, hasBulb: hr() < 0.3 }));
  const tm = new THREE.Matrix4();
  const tq = new THREE.Quaternion();
  const tilt = new THREE.Quaternion();
  const tp = new THREE.Vector3();
  const ts = new THREE.Vector3();
  function redraw(t, wobble) {
    tilt.setFromEuler(new THREE.Euler(wobble * 0.6, 0, wobble));
    tierMeshes.forEach(({ mesh, snow, tier }, ti) => {
      tq.setFromAxisAngle(up, t.rot + ti * 0.7).premultiply(tilt);
      // lean the whole tree from its base
      const y = tier.y * t.s;
      tp.set(t.x + wobble * y * 0.6, y, t.z + wobble * 0.6 * y * 0.6);
      tm.compose(tp, tq, ts.set(t.sx, t.s, t.sx));
      mesh.setMatrixAt(t.index, tm);
      const sy = (tier.y + tier.h * 0.27) * t.s;
      tp.set(t.x + wobble * sy * 0.6, sy, t.z + wobble * 0.6 * sy * 0.6);
      const k = Math.max(0.0001, t.snowLeft);
      tm.compose(tp, tq, ts.set(t.sx * k, t.s * k, t.sx * k));
      snow.setMatrixAt(t.index, tm);
      mesh.instanceMatrix.needsUpdate = true;
      snow.instanceMatrix.needsUpdate = true;
    });
  }
  const active = new Set();
  return {
    trees,
    shake(t) {
      t.shake = 1;
      t.snowLeft = 0;
      active.add(t);
    },
    update(dt, time) {
      for (const t of active) {
        t.shake = Math.max(0, t.shake - dt * 1.2);
        t.snowLeft = Math.min(1, t.snowLeft + dt / 25); // snow settles back slowly
        const wobble = Math.sin(time * 22) * 0.05 * t.shake;
        redraw(t, wobble);
        if (t.shake === 0 && t.snowLeft >= 1) active.delete(t);
      }
    },
  };
}

// low snow mounds scattered across the clearing
function buildDrifts(scene, avoid) {
  const r = rand(77);
  const moundGeo = new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  const mounds = new THREE.InstancedMesh(moundGeo, snowMaterial({ color: 0xeef2fa }), 70);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  let placed = 0;
  for (let tries = 0; tries < 2000 && placed < 70; tries++) {
    const a = r() * Math.PI * 2;
    const d = 12 + r() * 70;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (avoid.some((o) => Math.hypot(o.x - x, o.z - z) < o.r - 2)) continue;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28);
    const w = 1.5 + r() * 3.5;
    m.compose(p.set(x, -0.05, z), q, s.set(w, 0.18 + r() * 0.22, w * (0.5 + r() * 0.5)));
    mounds.setMatrixAt(placed++, m);
  }
  mounds.count = placed;
  mounds.receiveShadow = true;
  scene.add(mounds);
}

// ---------- grand tree ----------
function buildGrandTree(scene, colliders) {
  const group = new THREE.Group();
  const tiers = 6;
  const height = 17;
  const baseR = 6;
  const green = new THREE.MeshStandardMaterial({ map: needleTex, color: 0x2a6b4c, roughness: 0.85, flatShading: true, side: THREE.DoubleSide });
  const snowMat = snowMaterial({ flatShading: true, side: THREE.DoubleSide });
  for (let i = 0; i < tiers; i++) {
    const f = i / tiers;
    const r = baseR * (1 - f * 0.8);
    const h = 4.4 - f * 1.6;
    const y = 2 + f * (height - 4) + h / 2;
    const cone = new THREE.Mesh(tierGeo(r, h, 20, 0.5, 50 + i), green);
    cone.position.y = y;
    cone.rotation.y = i * 0.5;
    cone.castShadow = true;
    group.add(cone);
    const cap = new THREE.Mesh(tierGeo(r * 0.58, h * 0.48, 16, 0.3, 70 + i), snowMat);
    cap.position.y = y + h * 0.28;
    cap.rotation.y = i * 0.5 + 0.2;
    group.add(cap);
  }
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.1, 2.6, 10), new THREE.MeshStandardMaterial({ color: 0x5a3b28, map: barkTex }));
  trunk.position.y = 1.3;
  group.add(trunk);

  // star topper
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const rr = i % 2 === 0 ? 1.3 : 0.55;
    const x = Math.cos(a) * rr;
    const y = Math.sin(a) * rr;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  const starMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x6b5a2a) });
  const star = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.3, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 2 }), starMat);
  star.position.set(0, height + 1.4, -0.15);
  group.add(star);

  // spiral of dark bulbs that switch on in the finale
  const bulbs = [];
  const bulbGeo = new THREE.SphereGeometry(0.2, 10, 8);
  const palette = ['#ff5a6e', '#ffd15c', '#6cf0b0', '#6fb8ff', '#f19bff', '#fff1c4'];
  const N = 90;
  for (let k = 0; k < N; k++) {
    const h = k / N;
    const y = 2.4 + h * (height - 3);
    const r = baseR * (1 - ((y - 2) / (height - 2)) * 0.82) * 0.85 + 0.3;
    const a = h * Math.PI * 2 * 6.5;
    const color = new THREE.Color(palette[k % palette.length]);
    const mat = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(0.15) });
    const b = new THREE.Mesh(bulbGeo, mat);
    b.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
    b.userData = { color, phase: Math.random() * 6.28, on: false };
    group.add(b);
    bulbs.push(b);
  }
  const light = new THREE.PointLight(0xffd7a0, 0, 40, 1.2);
  light.position.set(0, 9, 0);
  group.add(light);

  // stone planter ring with a snowy top
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(7.4, 7.8, 0.7, 32, 1, true), new THREE.MeshStandardMaterial({ map: stoneTex, roughness: 1, side: THREE.DoubleSide }));
  ring.material.map = stoneTex.clone();
  ring.material.map.repeat.set(10, 1);
  ring.material.map.needsUpdate = true;
  ring.position.y = 0.35;
  const top = new THREE.Mesh(new THREE.CylinderGeometry(7.45, 7.45, 0.25, 32), snowMaterial());
  top.position.y = 0.72;
  top.receiveShadow = true;
  group.add(ring, top);

  scene.add(group);
  colliders.push({ x: 0, z: 0, r: 7.6, br: 6.2, top: 19 });
  return { group, star, starMat, bulbs, light, lit: false, litAt: 0 };
}

// ---------- cabins ----------
function triangleGeo(w, h) {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0);
  shape.lineTo(w / 2, 0);
  shape.lineTo(0, h);
  shape.closePath();
  const g = new THREE.ShapeGeometry(shape);
  // planar UVs in world units so plank texture tiles evenly
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 2, pos.getY(i) / 2);
  return g;
}

function buildCabin(scene, style, index, position, rotationY) {
  const { W, H, D, RISE, OVER } = CABIN;
  const group = new THREE.Group();
  group.position.copy(position);
  group.rotation.y = rotationY;
  const rnd = rand(500 + index * 31);

  const trimMat = new THREE.MeshStandardMaterial({ color: style.trim, roughness: 0.7 });
  const snowMat = snowMaterial();
  const doorMat = new THREE.MeshStandardMaterial({ color: style.door, map: plankTex, roughness: 0.7 });
  const stoneMat = new THREE.MeshStandardMaterial({ map: stoneTex, roughness: 1 });

  // stone foundation
  const base = new THREE.Mesh(new THREE.BoxGeometry(W + 1, 0.6, D + 1), stoneMat);
  base.position.y = 0.3;
  base.receiveShadow = base.castShadow = true;
  group.add(base);

  // inner core so there are no gaps between logs
  const core = new THREE.Mesh(new THREE.BoxGeometry(W - 0.2, H - 0.5, D - 0.2), new THREE.MeshStandardMaterial({ color: new THREE.Color(style.wall).multiplyScalar(0.55) }));
  core.position.y = 0.6 + (H - 0.6) / 2;
  group.add(core);

  // stacked round logs with interlocking, overhanging corners
  const LR = 0.27;
  const rows = Math.round((H - 0.6) / (LR * 2));
  const logMats = [
    new THREE.MeshStandardMaterial({ map: barkTex, roughness: 0.9 }),
    new THREE.MeshStandardMaterial({ map: endGrainTex, roughness: 0.9 }),
    new THREE.MeshStandardMaterial({ map: endGrainTex, roughness: 0.9 }),
  ];
  const fbLogs = new THREE.InstancedMesh(new THREE.CylinderGeometry(LR, LR, W + 0.8, 12), logMats, rows * 2);
  const sideLogs = new THREE.InstancedMesh(new THREE.CylinderGeometry(LR, LR, D + 0.8, 12), logMats, rows * 2);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const wallCol = new THREE.Color(style.wall);
  const c = new THREE.Color();
  const alongX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
  const alongZ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  let fi = 0;
  let si = 0;
  for (let row = 0; row < rows; row++) {
    const y = 0.6 + LR + row * LR * 2;
    for (const sz of [-1, 1]) {
      m.compose(new THREE.Vector3(0, y, sz * (D / 2)), alongX, one);
      fbLogs.setMatrixAt(fi, m);
      fbLogs.setColorAt(fi++, c.copy(wallCol).multiplyScalar(0.88 + rnd() * 0.24));
    }
    for (const sx of [-1, 1]) {
      m.compose(new THREE.Vector3(sx * (W / 2), y + LR, 0), alongZ, one);
      sideLogs.setMatrixAt(si, m);
      sideLogs.setColorAt(si++, c.copy(wallCol).multiplyScalar(0.88 + rnd() * 0.24));
    }
  }
  fbLogs.castShadow = sideLogs.castShadow = true;
  fbLogs.receiveShadow = sideLogs.receiveShadow = true;
  group.add(fbLogs, sideLogs);

  // board-and-batten gables
  const gableMat = new THREE.MeshStandardMaterial({ map: plankTex, color: new THREE.Color(style.wall).multiplyScalar(0.95), roughness: 0.85, side: THREE.DoubleSide });
  for (const sz of [-1, 1]) {
    const gable = new THREE.Mesh(triangleGeo(W + 0.4, RISE + 0.3), gableMat);
    gable.position.set(0, H - 0.2, sz * (D / 2 + 0.12));
    group.add(gable);
  }

  // roof: dark shingle slab + a thick, rounded blanket of snow
  const half = W / 2 + OVER;
  const slope = Math.hypot(half, RISE);
  const angle = Math.atan2(RISE, half);
  const shingleMat = new THREE.MeshStandardMaterial({ color: 0x3b2a24, roughness: 0.9 });
  for (const side of [-1, 1]) {
    const center = new THREE.Vector3((side * half) / 2, H + RISE / 2 + 0.2, 0);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(slope + 0.1, 0.32, D + OVER * 2), shingleMat);
    roof.position.copy(center);
    roof.rotation.z = -side * angle;
    roof.castShadow = true;
    group.add(roof);
    const normal = new THREE.Vector3(side * Math.sin(angle), Math.cos(angle), 0);
    const snow = new THREE.Mesh(new RoundedBoxGeometry(slope - 0.1, 0.6, D + OVER * 2 + 0.25, 3, 0.25), snowMat);
    snow.position.copy(center).addScaledVector(normal, 0.36);
    snow.rotation.z = -side * angle;
    snow.castShadow = true;
    group.add(snow);
    const fascia = new THREE.Mesh(new THREE.BoxGeometry(slope, 0.22, 0.16), trimMat);
    fascia.position.set((side * half) / 2, H + RISE / 2 + 0.02, D / 2 + OVER + 0.02);
    fascia.rotation.z = -side * angle;
    group.add(fascia);
  }
  const ridge = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, D + OVER * 2 - 0.3, 6, 10), snowMat);
  ridge.rotation.x = Math.PI / 2;
  ridge.position.set(0, H + RISE + 0.45, 0);
  group.add(ridge);

  // icicles along both side eaves
  const icicleGeo = new THREE.ConeGeometry(0.07, 1, 6);
  icicleGeo.rotateX(Math.PI); // tip down
  icicleGeo.translate(0, -0.5, 0); // base at y=0, tip at y=-1
  const icicleMat = new THREE.MeshStandardMaterial({ color: 0xcfeaff, roughness: 0.15, transparent: true, opacity: 0.85, emissive: 0x6aa8d8, emissiveIntensity: 0.15 });
  const icicleCount = 44;
  const icicles = new THREE.InstancedMesh(icicleGeo, icicleMat, icicleCount);
  for (let i = 0; i < icicleCount; i++) {
    const sx = i % 2 ? 1 : -1;
    const z = -D / 2 - OVER + 0.2 + rnd() * (D + OVER * 2 - 0.4);
    const len = 0.25 + Math.pow(rnd(), 2) * 0.9;
    m.compose(new THREE.Vector3(sx * (half - 0.05), H + 0.12, z), new THREE.Quaternion(), new THREE.Vector3(1, len, 1));
    icicles.setMatrixAt(i, m);
  }
  group.add(icicles);

  // stone chimney with a snow cap
  const chimney = new THREE.Mesh(new THREE.BoxGeometry(1.3, 3.4, 1.3), stoneMat);
  chimney.position.set(W / 4, H + RISE * 0.62, -D / 4);
  chimney.castShadow = true;
  const chimTop = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.25, 1.55), stoneMat);
  chimTop.position.set(W / 4, H + RISE * 0.62 + 1.75, -D / 4);
  const chimSnow = new THREE.Mesh(new RoundedBoxGeometry(1.6, 0.35, 1.6, 2, 0.15), snowMat);
  chimSnow.position.set(W / 4, H + RISE * 0.62 + 1.95, -D / 4);
  group.add(chimney, chimTop, chimSnow);
  const chimneyTop = new THREE.Vector3(W / 4, H + RISE * 0.62 + 2.1, -D / 4);

  // front door with frame, step and a little snowy awning
  const zf = D / 2 + LR;
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.9, 3, 0.18), doorMat);
  door.position.set(0, 0.6 + 1.5, zf + 0.05);
  const frameTop = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.22, 0.24), trimMat);
  frameTop.position.set(0, 3.7, zf + 0.08);
  const frameL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 3.1, 0.24), trimMat);
  frameL.position.set(-1.08, 2.15, zf + 0.08);
  const frameR = frameL.clone();
  frameR.position.x = 1.08;
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshStandardMaterial({ color: 0xd9b45a, metalness: 0.6, roughness: 0.3 }));
  knob.position.set(0.65, 2, zf + 0.18);
  const step = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.3, 1.1), stoneMat);
  step.position.set(0, 0.15, zf + 0.6);
  group.add(door, frameTop, frameL, frameR, knob, step);
  for (const side of [-1, 1]) {
    const aw = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.12, 1.2), shingleMat);
    aw.position.set(side * 0.75, 4.15, zf + 0.55);
    aw.rotation.z = -side * 0.42;
    const aws = new THREE.Mesh(new RoundedBoxGeometry(1.7, 0.22, 1.3, 2, 0.1), snowMat);
    aws.position.set(side * 0.72, 4.29, zf + 0.55);
    aws.rotation.z = -side * 0.42;
    group.add(aw, aws);
  }

  // porch lantern beside the door (glows once the cabin has lights)
  const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x3a2a1a) });
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.45, 0.32), lampMat);
  lamp.position.set(1.65, 2.9, zf + 0.25);
  const lampCap = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.2, 4), new THREE.MeshStandardMaterial({ color: 0x222228 }));
  lampCap.position.set(1.65, 3.22, zf + 0.25);
  lampCap.rotation.y = Math.PI / 4;
  group.add(lamp, lampCap);

  // windows: glowing panes, mullions, shutters, snowy sills
  const windowMat = new THREE.MeshStandardMaterial({ color: 0x1a1a24, emissive: 0xffb860, emissiveIntensity: 0.05, roughness: 0.4 });
  const windowGlows = [];
  const shutterMat = new THREE.MeshStandardMaterial({ color: style.door, map: plankTex, roughness: 0.75 });
  const windowSpots = [
    [-3.2, 2.7, zf + 0.04, 0],
    [3.2, 2.7, zf + 0.04, 0],
    [W / 2 + LR + 0.04, 2.7, 0, Math.PI / 2],
    [-(W / 2 + LR + 0.04), 2.7, 0, -Math.PI / 2],
  ];
  for (const [x, y, z, ry] of windowSpots) {
    const wg = new THREE.Group();
    wg.position.set(x, y, z);
    wg.rotation.y = ry;
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.5), windowMat);
    pane.position.z = 0.035; // clear of the frame face so they never z-fight
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.8, 0.1), trimMat);
    frame.position.z = -0.06; // front face at -0.01
    const fv = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.5, 0.08), trimMat);
    const fh = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.1, 0.08), trimMat);
    fv.position.z = fh.position.z = 0.075;
    const sill = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.14, 0.4), trimMat);
    sill.position.set(0, -0.95, 0.15);
    const sillSnow = new THREE.Mesh(new RoundedBoxGeometry(2.05, 0.16, 0.38, 2, 0.07), snowMat);
    sillSnow.position.set(0, -0.83, 0.16);
    wg.add(frame, pane, fv, fh, sill, sillSnow);
    for (const s of [-1, 1]) {
      const sh = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.75, 0.08), shutterMat);
      sh.position.set(s * 1.3, 0, 0.02);
      wg.add(sh);
    }
    // soft warm halo that fades in once the cabin is decorated
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: getGlowTexture(), color: 0xffb35c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    halo.position.z = 0.35;
    halo.scale.set(3.4, 3, 1);
    wg.add(halo);
    windowGlows.push(halo);
    group.add(wg);
  }

  // snow drifts piled against the walls
  for (let i = 0; i < 7; i++) {
    const drift = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), snowMat);
    const corner = i % 4;
    const sx = corner < 2 ? -1 : 1;
    const sz = corner % 2 ? -1 : 1;
    drift.position.set(sx * (W / 2 + 0.4) + (rnd() - 0.5) * 1.5, 0, sz * (D / 2 + 0.4) * (i > 3 ? 0.3 : 1));
    if (Math.abs(drift.position.x) < 2 && sz > 0) drift.position.x += 4 * sx; // keep the doorway clear
    drift.scale.set(1 + rnd() * 1.4, 0.45 + rnd() * 0.5, 0.8 + rnd() * 0.8);
    drift.receiveShadow = true;
    group.add(drift);
  }

  // wreath that appears when the cabin is fully lit
  const wreath = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.18, 8, 20), new THREE.MeshStandardMaterial({ color: 0x1f6b3f, roughness: 0.8, flatShading: true }));
  const bow = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), new THREE.MeshStandardMaterial({ color: 0xd62839 }));
  bow.position.y = -0.5;
  wreath.add(ring, bow);
  for (let i = 0; i < 6; i++) {
    const berry = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 4), new THREE.MeshStandardMaterial({ color: 0xe0203a }));
    const a = (i / 6) * Math.PI * 2;
    berry.position.set(Math.cos(a) * 0.5, Math.sin(a) * 0.5, 0.15);
    wreath.add(berry);
  }
  wreath.position.set(0, 2.55, zf + 0.25);
  wreath.scale.setScalar(0.001);
  wreath.visible = false;
  group.add(wreath);

  // porch light: brightens with each strand
  const light = new THREE.PointLight(0xffc98a, 0, 26, 1.3);
  light.position.set(0, 4, D / 2 + 3);
  group.add(light);

  // chimney smoke puffs (only drift once the cabin is glowing)
  const smoke = [];
  for (let i = 0; i < 7; i++) {
    const puff = new THREE.Sprite(new THREE.SpriteMaterial({ map: getGlowTexture(), color: 0xb8c0d4, transparent: true, opacity: 0, depthWrite: false }));
    puff.position.copy(chimneyTop);
    puff.userData.offset = i / 7;
    group.add(puff);
    smoke.push(puff);
  }

  // ---- hooks (anchor points) ----
  const zF = D / 2 + OVER - 0.05;
  const roofY = (x) => H + RISE * (1 - Math.abs(x) / half) - 0.1;
  const zWall = zf + 0.3;
  const hooks = [];
  const add = (face, x, y, z) => hooks.push({ face, local: new THREE.Vector3(x, y, z) });
  // front roofline
  [-half + 0.15, -half / 2, 0, half / 2, half - 0.15].forEach((x) => add('front', x, roofY(x), zF));
  // front wall
  add('front', -1.3, 3.5, zWall);
  add('front', 1.3, 3.5, zWall);
  add('front', -W / 2 - 0.1, 4.3, zWall);
  add('front', W / 2 + 0.1, 4.3, zWall);
  add('front', -W / 2 - 0.1, 0.9, zWall);
  add('front', W / 2 + 0.1, 0.9, zWall);
  // side walls
  for (const sx of [-1, 1]) {
    const face = sx < 0 ? 'left' : 'right';
    const xe = sx * (half - 0.1);
    [-(D / 2 + OVER - 0.15), 0, D / 2 + OVER - 0.15].forEach((z) => add(face, xe, H - 0.15, z));
    add(face, sx * (W / 2 + LR + 0.3), 0.9, D / 2 - 0.15);
    add(face, sx * (W / 2 + LR + 0.3), 0.9, -D / 2 + 0.15);
  }

  scene.add(group);
  group.updateMatrixWorld(true);
  hooks.forEach((h, i) => {
    h.world = group.localToWorld(h.local.clone());
    h.id = `${index}:${i}`;
  });

  return {
    index,
    name: style.name,
    doorColor: style.door,
    group,
    hooks,
    windowMat,
    windowGlows,
    lampMat,
    light,
    wreath,
    smoke,
    chimneyTop,
    strands: 0,
    complete: false,
  };
}

function updateSmoke(cabins, dt, t) {
  for (const c of cabins) {
    const on = c.strands > 0;
    c.smokeLevel = (c.smokeLevel || 0) + ((on ? 1 : 0) - (c.smokeLevel || 0)) * Math.min(1, dt * 0.8);
    c.lampMat.color.setRGB(0.23 + c.smokeLevel * 2.4, 0.16 + c.smokeLevel * 1.7, 0.1 + c.smokeLevel * 0.8);
    for (const puff of c.smoke) {
      const k = (t * 0.18 + puff.userData.offset) % 1;
      puff.position.set(c.chimneyTop.x + Math.sin(k * 5 + puff.userData.offset * 9) * 0.5 * k, c.chimneyTop.y + k * 6, c.chimneyTop.z - k * 1.2);
      puff.scale.setScalar(0.8 + k * 3.2);
      puff.material.opacity = c.smokeLevel * 0.35 * Math.sin(k * Math.PI);
    }
  }
}


// ---------- frozen pond ----------
const iceTex = canvasTex(512, 512, (g, w, h) => {
  const r = rand(404);
  const grad = g.createRadialGradient(w / 2, h / 2, 20, w / 2, h / 2, w / 2);
  grad.addColorStop(0, '#bfe3f7');
  grad.addColorStop(0.8, '#a6d1ee');
  grad.addColorStop(1, '#e8f4fb');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  // skate scratches
  g.lineCap = 'round';
  for (let i = 0; i < 70; i++) {
    g.strokeStyle = `rgba(255,255,255,${0.15 + r() * 0.3})`;
    g.lineWidth = 0.8 + r() * 1.5;
    const x = r() * w;
    const y = r() * h;
    const len = 40 + r() * 120;
    const a = r() * Math.PI;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a) * len * 0.5 + (r() - 0.5) * 30, y + Math.sin(a) * len * 0.5 + (r() - 0.5) * 30, x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.stroke();
  }
  // a few branching cracks
  for (let c = 0; c < 6; c++) {
    let x = r() * w;
    let y = r() * h;
    let a = r() * Math.PI * 2;
    g.strokeStyle = 'rgba(255,255,255,0.6)';
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 8; k++) {
      a += (r() - 0.5) * 1.2;
      x += Math.cos(a) * 14;
      y += Math.sin(a) * 14;
      g.lineTo(x, y);
    }
    g.stroke();
  }
});

function buildPond(scene, center, radius) {
  const group = new THREE.Group();
  group.position.copy(center);
  const ice = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 48),
    new THREE.MeshStandardMaterial({ map: iceTex, roughness: 0.12, metalness: 0.15, transparent: true, opacity: 0.8, emissive: 0x3a6a8a, emissiveIntensity: 0.25 }),
  );
  ice.rotation.x = -Math.PI / 2;
  ice.position.y = 0.06;
  ice.receiveShadow = true;
  // dark water below so the ice reads as a pond, with frozen bulbs sandwiched between
  const water = new THREE.Mesh(new THREE.CircleGeometry(radius, 48), new THREE.MeshBasicMaterial({ color: 0x0d2235 }));
  water.rotation.x = -Math.PI / 2;
  water.position.y = -0.25;
  const bank = new THREE.Mesh(new THREE.TorusGeometry(radius + 0.2, 0.55, 8, 48), snowMaterial());
  bank.rotation.x = Math.PI / 2;
  bank.scale.z = 0.45;
  bank.position.y = 0.05;
  group.add(water, ice, bank);
  // cattails poking out of the snow at the edge
  const r = rand(77);
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x6b6a3a });
  const headMat = new THREE.MeshStandardMaterial({ color: 0x4a2f1e });
  for (let i = 0; i < 9; i++) {
    const a = 0.4 + r() * 1.6 + (i > 4 ? Math.PI : 0);
    const x = Math.cos(a) * (radius + 0.3);
    const z = Math.sin(a) * (radius + 0.3);
    const h = 1.2 + r() * 0.8;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, h, 5), stemMat);
    stem.position.set(x, h / 2, z);
    stem.rotation.z = (r() - 0.5) * 0.3;
    const head = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.3, 4, 6), headMat);
    head.position.set(x, h - 0.1, z);
    group.add(stem, head);
  }
  scene.add(group);
  return { center: center.clone(), radius };
}

// ---------- lamp posts ----------
function buildLamp(scene, x, z, colliders) {
  const g = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 4, 8), new THREE.MeshStandardMaterial({ color: 0x23242b, roughness: 0.5, metalness: 0.4 }));
  post.position.y = 2;
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.38, 12, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd9a0).multiplyScalar(1.5) }));
  lamp.position.y = 4.2;
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: getGlowTexture(), color: 0xffc27a, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.scale.setScalar(3.5);
  glow.position.y = 4.2;
  g.add(post, lamp, glow);
  g.position.set(x, 0, z);
  post.castShadow = true;
  scene.add(g);
  colliders.push({ x, z, r: 0.5, br: 0.6, top: 4.6 });
}

// ---------- snowfall ----------
function buildSnowfall(scene) {
  const count = 2600;
  const pos = new Float32Array(count * 3);
  const speed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 120;
    pos[i * 3 + 1] = Math.random() * 40;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 120;
    speed[i] = 1.2 + Math.random() * 1.8;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const points = new THREE.Points(
    geo,
    new THREE.PointsMaterial({ color: 0xffffff, size: 0.22, map: getGlowTexture(), transparent: true, depthWrite: false, opacity: 0.9 }),
  );
  points.frustumCulled = false;
  scene.add(points);
  return {
    update(dt, t, center) {
      const a = geo.attributes.position.array;
      for (let i = 0; i < count; i++) {
        let y = a[i * 3 + 1] - speed[i] * dt;
        let x = a[i * 3] + Math.sin(t * 0.6 + i) * 0.4 * dt;
        let z = a[i * 3 + 2];
        if (y < 0) y += 40;
        // wrap around the player so it always snows nearby
        if (x - center.x > 60) x -= 120;
        if (x - center.x < -60) x += 120;
        if (z - center.z > 60) z -= 120;
        if (z - center.z < -60) z += 120;
        a[i * 3] = x;
        a[i * 3 + 1] = y;
        a[i * 3 + 2] = z;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}

// ---------- public ----------
export function buildWorld(scene) {
  scene.fog = new THREE.FogExp2(0x10183a, 0.011);
  const sky = buildSky(scene);

  const hemi = new THREE.HemisphereLight(0x6f84c4, 0x1c2238, 0.9);
  scene.add(hemi);
  const moon = new THREE.DirectionalLight(0xb9caff, 1.1);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  // a tight shadow box that follows Steph keeps shadows crisp
  Object.assign(moon.shadow.camera, { left: -42, right: 42, top: 42, bottom: -42, near: 1, far: 220 });
  moon.shadow.bias = -0.0006;
  moon.shadow.normalBias = 0.04;
  moon.shadow.radius = 3;
  scene.add(moon, moon.target);
  const lightOffset = new THREE.Vector3(-40, 60, -30);
  const snapped = new THREE.Vector3();

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(220, 64),
    new THREE.MeshStandardMaterial({ map: groundSnowTex, color: 0xd3dcee, roughness: 0.95, emissive: 0xffffff, emissiveMap: groundSparkleTex, emissiveIntensity: 0.55 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // trodden plaza path
  const path = new THREE.Mesh(
    new THREE.RingGeometry(10, 15, 64),
    new THREE.MeshStandardMaterial({ color: 0xa9b6cf, roughness: 1, transparent: true, opacity: 0.55 }),
  );
  path.rotation.x = -Math.PI / 2;
  path.position.y = 0.02;
  scene.add(path);

  const colliders = [];
  const tree = buildGrandTree(scene, colliders);

  const cabins = [];
  const R = 32;
  CABIN_STYLES.forEach((style, i) => {
    const a = (i / CABIN_STYLES.length) * Math.PI * 2 + Math.PI / 2;
    const pos = new THREE.Vector3(Math.cos(a) * R, 0, Math.sin(a) * R);
    const rotY = Math.atan2(-pos.x, -pos.z);
    cabins.push(buildCabin(scene, style, i, pos, rotY));
  });

  for (let i = 0; i < 5; i++) {
    const a = ((i + 0.5) / 5) * Math.PI * 2 + Math.PI / 2;
    buildLamp(scene, Math.cos(a) * 19, Math.sin(a) * 19, colliders);
  }

  // a frozen pond out past the cabins, between two of them
  const pondAngle = ((1.5 / 5) * Math.PI * 2 + Math.PI / 2);
  const pondCenter = new THREE.Vector3(Math.cos(pondAngle) * 56, 0, Math.sin(pondAngle) * 56);
  const pond = buildPond(scene, pondCenter, 9);

  const avoid = [{ x: 0, z: 0, r: 17 }, { x: pondCenter.x, z: pondCenter.z, r: 14 }, ...cabins.map((c) => ({ x: c.group.position.x, z: c.group.position.z, r: 13 }))];
  // keep a clear walkway from plaza to each door
  cabins.forEach((c) => {
    const p = c.group.position;
    avoid.push({ x: p.x * 0.6, z: p.z * 0.6, r: 7 });
  });
  const forest = buildForest(scene, colliders, avoid);
  buildDrifts(scene, avoid);

  // time of day: 0 = deep night, 1 = sunrise
  const C = (hex) => new THREE.Color(hex);
  const nightHorizon = C(0x21294f);
  const nightTop = C(0x02040f);
  const preHorizon = C(0x5d4672);
  const preTop = C(0x0f1636);
  const dawnHorizon = C(0xf7a37c);
  const dawnTop = C(0x6d8fc4);
  const mix3 = (a, b, c2, k, out) => (k < 0.5 ? out.copy(a).lerp(b, k * 2) : out.copy(b).lerp(c2, (k - 0.5) * 2));
  const tmpCol = new THREE.Color();
  function setTimeOfDay(k) {
    mix3(nightHorizon, preHorizon, dawnHorizon, k, sky.skyMat.uniforms.uHorizon.value);
    mix3(nightTop, preTop, dawnTop, k, sky.skyMat.uniforms.uTop.value);
    sky.skyMat.uniforms.uDawn.value = Math.max(0, (k - 0.45) / 0.55);
    sky.starMat.opacity = 0.85 * Math.max(0, 1 - k * 1.25);
    sky.moonMat.opacity = Math.max(0, 1 - k * 1.1);
    sky.sunMat.opacity = Math.max(0, (k - 0.6) / 0.4);
    sky.sun.position.y = SUN_DIR.y * 440 - 30 + Math.max(0, k - 0.6) * 90;
    mix3(C(0x10183a), C(0x2c2448), C(0x9b8aa6), k, scene.fog.color);
    hemi.color.copy(C(0x6f84c4)).lerp(C(0xffd2bd), k);
    hemi.groundColor.copy(C(0x1c2238)).lerp(C(0x62607e), k);
    hemi.intensity = 0.9 + k * 0.3;
    moon.color.copy(C(0xb9caff)).lerp(C(0xffc29a), k);
    moon.intensity = 1.1 + k * 0.5;
    tmpCol.copy(SUN_DIR).multiplyScalar(60);
    lightOffset.set(-40, 60, -30).lerp(new THREE.Vector3(SUN_DIR.x * 70, 35, SUN_DIR.z * 70), k);
  }
  setTimeOfDay(0);

  const snow = buildSnowfall(scene);

  return {
    cabins,
    tree,
    colliders,
    worldRadius: 85,
    pond,
    forest,
    setTimeOfDay,
    skyColors: () => ({ horizon: sky.skyMat.uniforms.uHorizon.value, top: sky.skyMat.uniforms.uTop.value, dawn: sky.skyMat.uniforms.uDawn.value }),
    update(dt, t, center) {
      // snap to shadow-map texels so shadows don't shimmer as she walks
      const texel = 84 / 2048;
      snapped.set(Math.round(center.x / texel) * texel, 0, Math.round(center.z / texel) * texel);
      moon.target.position.copy(snapped);
      moon.position.copy(snapped).add(lightOffset);
      snow.update(dt, t, center);
      updateSmoke(cabins, dt, t);
      forest.update(dt, t);
    },
  };
}
