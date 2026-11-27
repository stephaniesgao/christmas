import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { buildWorld, CABIN, getGlowTexture } from './world.js';
import { sfx, setMusic, isMusicOn } from './audio.js';
import { createVillagers } from './villagers.js';

// ---------- tuning ----------
const STRAND_SIZE = 8;
const STRANDS_PER_CABIN = 3;
const GROUND_BULBS = 42;
const REACH = 17;
const PALETTE = ['#ff4d63', '#ffcf4a', '#5ef0a6', '#5aaeff', '#f08cff', '#fff0c0', '#ff9a3c'];

// ---------- renderer / scene ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 1200);

// ---------- post-processing ----------
// Multisampled HDR targets (the composer otherwise drops the canvas's anti-aliasing),
// ambient occlusion for contact shadows, bloom for the lights, then a colour grade.
const rtSize = new THREE.Vector2();
renderer.getDrawingBufferSize(rtSize);
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(rtSize.x, rtSize.y, { samples: 4, type: THREE.HalfFloatType }));
composer.addPass(new RenderPass(scene, camera));
const gtao = new GTAOPass(scene, camera, rtSize.x, rtSize.y, undefined, {
  radius: 1.1,
  distanceExponent: 1.4,
  thickness: 1.6,
  scale: 1.1,
  samples: 12,
  distanceFallOff: 1,
  screenSpaceRadius: false,
});
gtao.blendIntensity = 0.85;
// glows, sprites and see-through things shouldn't cast ambient shadows
const baseOverride = gtao.overrideVisibility.bind(gtao);
gtao.overrideVisibility = function () {
  baseOverride();
  this.scene.traverse((o) => {
    if (o.isSprite || (o.material && !Array.isArray(o.material) && (o.material.transparent || o.material.isMeshBasicMaterial))) o.visible = false;
  });
};
composer.addPass(gtao);
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.6, 0.5, 0.86);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const grade = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.38 },
    uRes: { value: new THREE.Vector2(rtSize.x, rtSize.y) },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uVignette; uniform vec2 uRes; varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.22);                 // gentle S-curve
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(vec3(l), c, 1.12);                                  // a touch more colour
      c += vec3(-0.015, 0.0, 0.03) * (1.0 - l) + vec3(0.03, 0.012, -0.02) * l; // cool shadows, warm highlights
      vec2 q = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
      c *= mix(1.0 - uVignette, 1.0, smoothstep(1.05, 0.3, length(q)));
      float n = fract(sin(dot(vUv * uRes + uTime * 61.0, vec2(12.9898, 78.233))) * 43758.5453);
      c += (n - 0.5) * 0.022;                                     // fine film grain
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
});
composer.addPass(grade);

const world = buildWorld(scene);
const { cabins, tree, colliders } = world;

// image-based lighting: a little blurred copy of the sky (plus warm village glows near
// the horizon) lights every surface, so materials pick up colour instead of looking flat
const pmrem = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene();
const envSkyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  uniforms: { uHorizon: { value: new THREE.Color() }, uTop: { value: new THREE.Color() }, uGround: { value: new THREE.Color(0x2a3050) } },
  vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform vec3 uHorizon; uniform vec3 uTop; uniform vec3 uGround; varying vec3 vP;
    void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(uHorizon, uTop, smoothstep(0.0, 0.7, h)) : mix(uHorizon, uGround, smoothstep(0.0, 0.3, -h)); gl_FragColor = vec4(c * 1.6, 1.0); }`,
});
envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), envSkyMat));
for (let i = 0; i < 6; i++) {
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 0.8, 0.35) }));
  const a = (i / 6) * Math.PI * 2;
  glow.position.set(Math.cos(a) * 8, 0.6, Math.sin(a) * 8);
  envScene.add(glow);
}
let envTarget = null;
let envK = -1;
function refreshEnvironment(k) {
  if (Math.abs(k - envK) < 0.06) return;
  envK = k;
  const { horizon, top } = world.skyColors();
  envSkyMat.uniforms.uHorizon.value.copy(horizon);
  envSkyMat.uniforms.uTop.value.copy(top);
  envSkyMat.uniforms.uGround.value.set(0x2a3050).lerp(new THREE.Color(0xb7b2c8), k);
  if (envTarget) envTarget.dispose();
  envTarget = pmrem.fromScene(envScene, 0.04);
  scene.environment = envTarget.texture;
}
refreshEnvironment(0);

// ---------- UI refs ----------
const $ = (id) => document.getElementById(id);
const ui = {
  title: $('title'),
  start: $('start'),
  hud: $('hud'),
  sockets: $('sockets'),
  hint: $('hint'),
  progress: $('progress-dots'),
  progressText: $('progress-text'),
  count: $('strand-count'),
  toast: $('toast'),
  music: $('music-toggle'),
  help: $('help'),
  helpToggle: $('help-toggle'),
  finale: $('finale'),
  finaleClose: $('finale-close'),
  loading: $('loading'),
  photoBtn: $('photo-toggle'),
  snap: $('snap'),
  photoDone: $('photo-done'),
  hideSteph: $('hide-steph'),
  flash: $('flash'),
};

// ---- HUD drawings ----
const SVGNS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs, parent) {
  const el = document.createElementNS(SVGNS, tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(el);
  return el;
}

// the strand bar: a real scalloped wire with C9 bulbs hanging from it
const strandBulbs = [];
{
  const W = 560;
  const gap = W / STRAND_SIZE;
  const svg = svgEl('svg', { viewBox: `0 -4 ${W} 70`, class: 'strand-svg', 'aria-hidden': 'true' }, ui.sockets);
  let d = 'M -6 8';
  for (let i = 0; i < STRAND_SIZE; i++) d += ` Q ${gap * i + gap / 2} 36 ${gap * (i + 1)} 8`;
  d += ` L ${W + 6} 6`;
  svgEl('path', { d, class: 'wire-shadow' }, svg);
  svgEl('path', { d, class: 'wire' }, svg);
  for (let i = 0; i < STRAND_SIZE; i++) {
    const tilt = ((i * 37) % 11) - 5;
    const g = svgEl('g', { class: 'bulb', transform: `translate(${gap * i + gap / 2} 21) rotate(${tilt})` }, svg);
    svgEl('path', { class: 'glass', d: 'M -8 9 C -12 19 -6 33 0 39 C 6 33 12 19 8 9 Z' }, g);
    svgEl('ellipse', { class: 'shine', cx: -3, cy: 18, rx: 1.8, ry: 5 }, g);
    svgEl('rect', { class: 'cap', x: -5.5, y: 0, width: 11, height: 10, rx: 2 }, g);
    svgEl('path', { class: 'cap-line', d: 'M -5.5 4 H 5.5 M -5.5 7 H 5.5' }, g);
    svgEl('path', { class: 'mark', d: 'M 9 12 l 1.6 3.4 3.4 1.6 -3.4 1.6 -1.6 3.4 -1.6 -3.4 -3.4 -1.6 3.4 -1.6 z' }, g);
    strandBulbs.push(g);
  }
}

// little cabin sketches whose windows warm up as each cabin is decorated
cabins.forEach((c) => {
  const svg = svgEl('svg', { viewBox: '0 0 34 32', class: 'cabin-icon' }, ui.progress);
  svgEl('title', {}, svg).textContent = c.name;
  svgEl('path', { class: 'roof', d: 'M 2 15 L 17 3 L 32 15 Z' }, svg);
  svgEl('path', { class: 'roof-snow', d: 'M 4 13.5 L 17 3.2 L 30 13.5 L 27 13 L 17 6 L 7 13 Z' }, svg);
  svgEl('rect', { class: 'walls', x: 7, y: 14, width: 20, height: 15 }, svg);
  svgEl('rect', { class: 'door', x: 15, y: 20, width: 4.5, height: 9 }, svg);
  svgEl('rect', { class: 'win', x: 9.5, y: 18, width: 4, height: 4 }, svg);
  svgEl('rect', { class: 'win', x: 21, y: 18, width: 4, height: 4 }, svg);
  const lights = svgEl('g', { class: 'roof-lights' }, svg);
  ['#ff4d63', '#ffcf4a', '#5ef0a6', '#5aaeff', '#f08cff'].forEach((col, k) => {
    svgEl('circle', { cx: 6 + k * 5.5, cy: 15.5 + (k % 2), r: 1.4, fill: col }, lights);
  });
});

let toastTimer;
function toast(msg) {
  ui.toast.textContent = msg;
  ui.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 2600);
}

// ---------- game state ----------
const state = {
  types: [], // parallel to strand: null, 'glitter' or 'snow'
  timeK: 0,
  photo: false,
  snapRequested: false,
  playing: false,
  strand: [], // colors collected
  firstHook: null, // { cabin, hook }
  usedPairs: new Set(),
  finaleShown: false,
  fullWarned: false,
};

// ---------- player ----------
const player = new THREE.Group();
// spawn on the open side of the plaza (between two cabins), facing the big tree
player.position.set(0, 0, -17);
scene.add(player);
const body = new THREE.Group();
player.add(body);

// ---- skeleton ----
// Steph's GLB is a single unrigged mesh. We give it a skeleton at load time: bones are
// placed from her measured proportions (model units, 1.9 tall, facing +z, her left at
// +x) and every vertex is skinned by region (feet, arms, head, torso) with soft blends
// at the joints. That lets the limbs be posed and animated like a normal rigged model.
let rig = null;
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function rigModel(mesh) {
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const n = pos.count;
  const skinIndex = new Uint16Array(n * 4);
  const skinWeight = new Float32Array(n * 4);
  // bone order: 0 root, 1 hips, 2 chest, 3 head, 4 armL, 5 armR, 6 handL, 7 handR, 8 legL, 9 legR
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const leg = 1 - smooth(0.2, 0.32, y);
    const arm = smooth(0.33, 0.38, Math.abs(x)) * smooth(0.27, 0.31, y) * (1 - smooth(0.58, 0.65, y));
    const head = smooth(0.66, 0.78, y);
    const torso = Math.max(0, 1 - leg - arm - head);
    const hipShare = 1 - smooth(0.32, 0.55, y);
    const left = x > 0;
    const limbBone = arm >= leg ? (left ? 4 : 5) : left ? 8 : 9;
    const w = [torso * hipShare, torso * (1 - hipShare), Math.max(arm, leg), head];
    const sum = w[0] + w[1] + w[2] + w[3] || 1;
    skinIndex.set([1, 2, limbBone, 3], i * 4);
    skinWeight.set([w[0] / sum, w[1] / sum, w[2] / sum, w[3] / sum], i * 4);
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));

  const bone = (x, y, z) => {
    const b = new THREE.Bone();
    b.position.set(x, y, z);
    return b;
  };
  const root = bone(0, 0, 0);
  const hips = bone(0, 0.3, 0.15);
  const chest = bone(0, 0.2, 0); // (0, 0.5, 0.15)
  const head = bone(0, 0.2, -0.02); // neck at (0, 0.7, 0.13)
  const armL = bone(0.38, 0.12, -0.05); // shoulder at (±0.38, 0.62, 0.10)
  const armR = bone(-0.38, 0.12, -0.05);
  const handL = bone(0.025, -0.29, 0.01); // hand at (±0.405, 0.33, 0.11)
  const handR = bone(-0.03, -0.29, 0.01);
  const legL = bone(0.15, -0.02, 0); // hip joint at (±0.15, 0.28, 0.15)
  const legR = bone(-0.16, -0.02, 0);
  root.add(hips);
  hips.add(chest, legL, legR);
  chest.add(head, armL, armR);
  armL.add(handL);
  armR.add(handR);
  const bones = [root, hips, chest, head, armL, armR, handL, handR, legL, legR];

  const skinned = new THREE.SkinnedMesh(geo, mesh.material);
  skinned.position.copy(mesh.position);
  skinned.quaternion.copy(mesh.quaternion);
  skinned.scale.copy(mesh.scale);
  skinned.castShadow = true;
  skinned.frustumCulled = false;
  skinned.add(root);
  mesh.parent.add(skinned);
  mesh.parent.remove(mesh);
  skinned.updateWorldMatrix(true, true);
  skinned.bind(new THREE.Skeleton(bones));
  return { root, hips, chest, head, armL, armR, handL, handR, legL, legR };
}

// throw pose: an underhand toss with the right arm, which stays in front of her
// (her arms are short, so an overhead throw would vanish behind her head)
const throwAnim = { t: 99 };
const RELEASE = 0.22;
function throwArmAngle(t) {
  if (t < RELEASE) return THREE.MathUtils.lerp(0, 1.0, smooth(0, RELEASE, t)); // swing back
  if (t < 0.4) return THREE.MathUtils.lerp(1.0, -1.7, smooth(RELEASE, 0.4, t)); // toss forward and up
  return THREE.MathUtils.lerp(-1.7, 0, smooth(0.4, 0.85, t)); // recover
}

function animateRig(dt, t) {
  if (!rig) return;
  const A = walkAmt;
  const s = Math.sin(walkPhase);
  const breathe = Math.sin(t * 1.7);
  // legs stride; a slight knee-less lift comes from the hip swing
  rig.legL.rotation.x = -s * 0.6 * A;
  rig.legR.rotation.x = s * 0.6 * A;
  rig.hips.rotation.z = s * 0.05 * A;
  rig.hips.rotation.y = -s * 0.08 * A;
  rig.chest.rotation.y = s * 0.12 * A;
  rig.chest.rotation.x = 0.05 * A + breathe * 0.015;
  rig.head.rotation.y = -s * 0.06 * A + Math.sin(t * 0.5) * 0.06 * (1 - A);
  rig.head.rotation.z = Math.sin(t * 0.8) * 0.035;
  rig.head.rotation.x = Math.abs(s) * 0.05 * A;
  // left arm holds the coil out in front, swinging a little
  rig.armL.rotation.x = -1.05 + s * 0.15 * A + breathe * 0.02;
  rig.armL.rotation.z = 0.38;
  // right arm swings opposite the left leg, or throws
  throwAnim.t += dt;
  const throwing = throwAnim.t < 0.85;
  const swing = -s * 0.65 * A + Math.sin(t * 1.3) * 0.04 * (1 - A);
  rig.armR.rotation.x = throwing ? throwArmAngle(throwAnim.t) : swing;
  rig.armR.rotation.z = throwing ? -0.45 * Math.sin(Math.min(1, throwAnim.t / 0.85) * Math.PI) : -0.1;
  if (throwing) rig.chest.rotation.y += (throwAnim.t < RELEASE ? -0.35 : 0.25) * Math.sin(Math.min(1, throwAnim.t / 0.85) * Math.PI);
  // skating: long sideways pushes, free arm out for balance, leaning forward
  skateBlend += ((state.skating ? 1 : 0) - skateBlend) * (1 - Math.exp(-dt * 6));
  if (skateBlend > 0.01) {
    const k = skateBlend;
    const push = Math.sin(walkPhase);
    rig.legL.rotation.x *= 1 - k;
    rig.legR.rotation.x *= 1 - k;
    rig.legL.rotation.z = k * Math.max(0, push) * 0.45 * A;
    rig.legR.rotation.z = -k * Math.max(0, -push) * 0.45 * A;
    rig.hips.rotation.z = k * push * 0.08 * A;
    rig.chest.rotation.x += k * 0.18;
    if (!throwing) {
      rig.armR.rotation.x = THREE.MathUtils.lerp(rig.armR.rotation.x, -0.2, k);
      rig.armR.rotation.z = THREE.MathUtils.lerp(rig.armR.rotation.z, -1.1 + push * 0.15, k);
    }
  } else {
    rig.legL.rotation.z = 0;
    rig.legR.rotation.z = 0;
  }
}
let skateBlend = 0;

function throwHandPosition() {
  if (rig) return rig.handR.getWorldPosition(new THREE.Vector3());
  return player.localToWorld(new THREE.Vector3(-0.7, 1.4, 0.4));
}

// simple stand-in shown while the model loads
const placeholder = new THREE.Group();
{
  const coat = new THREE.Mesh(new THREE.CapsuleGeometry(0.55, 1.3, 8, 16), new THREE.MeshStandardMaterial({ color: 0xd07c30, roughness: 0.6 }));
  coat.position.y = 1.2;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), new THREE.MeshStandardMaterial({ color: 0xffe3cf }));
  head.position.y = 2.5;
  coat.castShadow = head.castShadow = true;
  placeholder.add(coat, head);
}
body.add(placeholder);

new GLTFLoader().load(
  '../src/client/assets/character/steph.glb',
  (gltf) => {
    const model = gltf.scene;
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const scale = 3.1 / size.y;
    model.scale.setScalar(scale);
    model.position.y = -box.min.y * scale;
    let stephMesh = null;
    model.traverse((o) => {
      if (!o.isMesh) return;
      stephMesh = o;
      const mat = o.material;
      // The GLB is authored fully metallic, which renders black without reflections.
      // Make it a soft, matte, slightly self-lit cartoon material instead.
      mat.metalness = 0;
      mat.metalnessMap = null;
      mat.roughness = 0.85;
      mat.emissive = new THREE.Color(0xffffff);
      mat.emissiveMap = mat.map;
      mat.emissiveIntensity = 0.45;
      stephMat = mat;
      mat.needsUpdate = true;
    });
    rig = rigModel(stephMesh);
    // the coil moves from the stand-in spot into her left hand
    rig.handL.add(coil);
    coil.position.set(0, 0, 0);
    coil.scale.setScalar(1 / scale);
    body.remove(placeholder);
    body.add(model);
    ui.loading.classList.add('hidden');
  },
  undefined,
  () => ui.loading.classList.add('hidden'),
);

// warm lantern glow that follows the player so she's visible at night
let stephMat = null;
const lantern = new THREE.PointLight(0xffd6a0, 5, 16, 1.4);
lantern.position.set(0, 3.2, 0.6);
player.add(lantern);

const move = { f: 0, b: 0, l: 0, r: 0, sprint: false };
const vel = new THREE.Vector3();
let vy = 0;
let walkPhase = 0;
let walkAmt = 0;

// ---------- camera ----------
const orbit = { yaw: Math.PI, pitch: 0.42, dist: 15 };
const camTarget = new THREE.Vector3();

// is this point inside a tree's branches or a cabin? Cabins use their real shape (walls,
// overhanging roof, chimney) so the camera never ends up inside one.
const camProbe = new THREE.Vector3();
const camLocal = new THREE.Vector3();
const ROOF_HALF = CABIN.W / 2 + CABIN.OVER;
function insideCabin(cab, p, pad) {
  camLocal.copy(p);
  cab.group.worldToLocal(camLocal);
  const ax = Math.abs(camLocal.x);
  const az = Math.abs(camLocal.z);
  const y = camLocal.y;
  // log walls (plus the door step and awning out front)
  if (ax < CABIN.W / 2 + 0.45 + pad && az < CABIN.D / 2 + 0.45 + pad && y < CABIN.H + 0.2) return true;
  // the roof slab and its snow, leaving the open space under the eaves free
  if (ax < ROOF_HALF + pad && az < CABIN.D / 2 + CABIN.OVER + pad) {
    const roofLine = CABIN.H + CABIN.RISE * (1 - Math.min(ax, ROOF_HALF) / ROOF_HALF);
    if (y > roofLine - 0.45 - pad && y < roofLine + 0.95 + pad) return true;
    if (ax < CABIN.W / 2 + 0.45 + pad && y < roofLine) return true; // attic
  }
  // chimney
  return Math.abs(camLocal.x - CABIN.W / 4) < 1 + pad && Math.abs(camLocal.z + CABIN.D / 4) < 1 + pad && y < CABIN.H + CABIN.RISE + 2.4;
}
function cameraBlocked(p, from) {
  for (const c of colliders) {
    // stop at a tree's dense core; brushing through the outer needles is fine and
    // keeps the camera from getting squeezed against Steph in the woods
    const r = c.br * 0.65 + 0.3;
    if (p.y < c.top && Math.hypot(p.x - c.x, p.z - c.z) < r && Math.hypot(from.x - c.x, from.z - c.z) >= r) return true;
  }
  for (const cab of cabins) if (insideCabin(cab, p, 0.15)) return true;
  return false;
}

let camDist = orbit.dist;
function updateCamera(dt) {
  const target = player.position.clone().add(new THREE.Vector3(0, 2.4, 0));
  camTarget.lerp(target, 1 - Math.exp(-dt * 10));
  const cp = Math.cos(orbit.pitch);
  const dir = new THREE.Vector3(Math.sin(orbit.yaw) * cp, Math.sin(orbit.pitch), Math.cos(orbit.yaw) * cp);
  // pull the camera in front of anything between it and Steph
  let allowed = orbit.dist;
  const STEPS = 28;
  for (let i = 0; i <= STEPS; i++) {
    const d = 0.3 + ((orbit.dist - 0.3) * i) / STEPS;
    camProbe.copy(camTarget).addScaledVector(dir, d);
    if (cameraBlocked(camProbe, camTarget)) {
      allowed = Math.max(0.3, d - (orbit.dist - 0.3) / STEPS - 0.2);
      break;
    }
  }
  // if the camera is squeezed right up against her, hide her rather than show the inside of her head
  body.visible = camDist > 1.6;
  camDist = allowed < camDist ? allowed : camDist + (allowed - camDist) * (1 - Math.exp(-dt * 3));
  camera.position.copy(camTarget).addScaledVector(dir, camDist);
  if (camera.position.y < 0.6) camera.position.y = 0.6;
  camera.lookAt(camTarget);
}

// ---------- collisions ----------
const tmp = new THREE.Vector3();
function resolveCollisions(p) {
  const pr = 0.8;
  for (const c of colliders) {
    const dx = p.x - c.x;
    const dz = p.z - c.z;
    const d = Math.hypot(dx, dz);
    const min = c.r + pr;
    if (d < min && d > 0.0001) {
      p.x = c.x + (dx / d) * min;
      p.z = c.z + (dz / d) * min;
    }
  }
  for (const cab of cabins) {
    tmp.copy(p);
    cab.group.worldToLocal(tmp);
    // a bit wider than the roof overhang so the camera's cabin check never contains her
    const hw = CABIN.W / 2 + CABIN.OVER + 0.3;
    const hd = CABIN.D / 2 + CABIN.OVER + 0.3;
    if (Math.abs(tmp.x) < hw && Math.abs(tmp.z) < hd) {
      const px = hw - Math.abs(tmp.x);
      const pz = hd - Math.abs(tmp.z);
      if (px < pz) tmp.x = Math.sign(tmp.x || 1) * hw;
      else tmp.z = Math.sign(tmp.z || 1) * hd;
      cab.group.localToWorld(tmp);
      p.x = tmp.x;
      p.z = tmp.z;
    }
  }
  const r = Math.hypot(p.x, p.z);
  if (r > world.worldRadius) {
    p.x *= world.worldRadius / r;
    p.z *= world.worldRadius / r;
  }
}

function updatePlayer(dt) {
  const fwd = new THREE.Vector3(-Math.sin(orbit.yaw), 0, -Math.cos(orbit.yaw));
  const right = new THREE.Vector3(Math.cos(orbit.yaw), 0, -Math.sin(orbit.yaw));
  const wish = new THREE.Vector3()
    .addScaledVector(fwd, move.f - move.b)
    .addScaledVector(right, move.r - move.l);
  const moving = wish.lengthSq() > 0 && state.playing && !state.photo;
  const pond = world.pond;
  state.skating = Math.hypot(player.position.x - pond.center.x, player.position.z - pond.center.z) < pond.radius - 0.4;
  const speed = state.skating ? 12 : move.sprint ? 15 : 9;
  if (moving) wish.normalize().multiplyScalar(speed);
  else wish.set(0, 0, 0);
  // on ice she glides: speed builds slowly and carries on after you let go
  vel.lerp(wish, 1 - Math.exp(-dt * (state.skating ? 1.4 : 10)));
  if (state.skating && Math.hypot(vel.x, vel.z) > 5 && Math.random() < dt * 14) {
    burst(player.position.clone().add(new THREE.Vector3(0, 0.15, 0)), iceSpray, 2, 1.6);
  }
  player.position.addScaledVector(vel, dt);

  vy -= 30 * dt;
  player.position.y = Math.max(0, player.position.y + vy * dt);
  if (player.position.y === 0) vy = 0;

  resolveCollisions(player.position);

  const sp = Math.hypot(vel.x, vel.z);
  // face the way she's walking, or turn toward the hook she's throwing at
  let targetRot = null;
  if (sp > 0.5) targetRot = Math.atan2(vel.x, vel.z);
  else if (state.faceTarget) targetRot = Math.atan2(state.faceTarget.x - player.position.x, state.faceTarget.z - player.position.z);
  if (targetRot !== null) {
    let dr = targetRot - player.rotation.y;
    dr = Math.atan2(Math.sin(dr), Math.cos(dr));
    player.rotation.y += dr * (1 - Math.exp(-dt * 12));
  }
  // walk cycle: bones are posed in animateRig; the whole body gets a little bounce
  const amtTarget = player.position.y > 0.01 ? 0 : Math.min(sp / 9, 1);
  walkAmt += (amtTarget - walkAmt) * (1 - Math.exp(-dt * 10));
  walkPhase += dt * Math.max(sp, 0.001) * (state.skating ? 0.45 : 1.15);
  if (walkAmt < 0.02) walkPhase += (Math.round(walkPhase / Math.PI) * Math.PI - walkPhase) * (1 - Math.exp(-dt * 8));
  body.position.y = Math.abs(Math.sin(walkPhase)) * 0.1 * walkAmt;
  body.rotation.x = 0.04 * walkAmt;
}

// where the wire leaves her hand (the top of the coil, where she grips it)
const iceSpray = new THREE.Color(0.85, 0.93, 1);

function handPosition() {
  return coil.localToWorld(new THREE.Vector3(0, 0, 0));
}

// ---------- bulbs on the ground ----------
const bulbGeo = new THREE.SphereGeometry(0.26, 14, 10);
bulbGeo.scale(1, 1.35, 1);
const capGeo = new THREE.CylinderGeometry(0.12, 0.14, 0.18, 8);
const capMat = new THREE.MeshStandardMaterial({ color: 0x3a6b4a, metalness: 0.4, roughness: 0.5 });
const groundBulbs = [];

// sparkly icons that float around special bulbs
function iconTexture(draw) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.translate(32, 32);
  draw(g);
  return new THREE.CanvasTexture(c);
}
const SPECIALS = {
  glitter: {
    color: '#ffd45e',
    label: 'glitter',
    tex: iconTexture((g) => {
      g.fillStyle = '#fff6c8';
      for (const [x, y, r] of [[0, 0, 18], [-17, -14, 7], [16, 15, 8], [18, -16, 5]]) {
        g.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const rr = i % 2 ? r * 0.28 : r;
          g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
        }
        g.fill();
      }
    }),
  },
  snow: {
    color: '#bfe9ff',
    label: 'snowflake',
    tex: iconTexture((g) => {
      g.strokeStyle = '#f2fbff';
      g.lineWidth = 3.5;
      g.lineCap = 'round';
      for (let i = 0; i < 6; i++) {
        g.save();
        g.rotate((i / 6) * Math.PI * 2);
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(0, -24);
        g.moveTo(0, -13);
        g.lineTo(-7, -19);
        g.moveTo(0, -13);
        g.lineTo(7, -19);
        g.stroke();
        g.restore();
      }
    }),
  },
};

function makeBulbMesh(colorHex, scale = 1, type = null) {
  const g = new THREE.Group();
  const color = new THREE.Color(colorHex);
  const mat = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(2.2) });
  const bulb = new THREE.Mesh(bulbGeo, mat);
  const cap = new THREE.Mesh(capGeo, capMat);
  cap.position.y = 0.38;
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: getGlowTexture(), color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  glow.scale.setScalar(1.6);
  g.add(bulb, cap, glow);
  let icon = null;
  if (type) {
    icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: SPECIALS[type].tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.95 }));
    icon.scale.setScalar(1.3);
    g.add(icon);
  }
  g.scale.setScalar(scale);
  g.userData = { color, mat, glow, type, icon };
  return g;
}

function setBulbColor(b, hex) {
  b.userData.color.set(hex);
  b.userData.glow.material.color.set(hex);
}

// ---------- the coil of wire Steph carries ----------
// A bundle of wire loops hanging from her left hand, like a real coiled cord: every
// loop starts and ends at her grip, fanned out a little, and the bundle swings on a
// spring as she walks. Each collected bulb clips onto the next spot along the wire.
const wireMat = new THREE.MeshStandardMaterial({ color: 0x1f3a28, roughness: 0.55 });
const COIL_LOOPS = 4;
const LOOP_R = 0.34;
const coil = new THREE.Group(); // origin = her grip
coil.rotation.order = 'YXZ';
coil.position.set(0.75, 1.15, 0.55); // stand-in spot until her model (and hand bone) loads
body.add(coil);
const swingRig = new THREE.Group(); // the part that swings under the grip
coil.add(swingRig);

function loopFrame(li) {
  const fan = (li - (COIL_LOOPS - 1) / 2) * 0.26;
  return {
    fan,
    ry: LOOP_R * (1.12 + 0.05 * Math.sin(li * 2.1)), // gravity stretches loops a bit
    rz: LOOP_R * (0.95 + 0.06 * Math.cos(li * 1.7)),
    dx: (li - (COIL_LOOPS - 1) / 2) * 0.03,
  };
}
function coilPoint(u, target = new THREE.Vector3()) {
  const f = Math.min(u * COIL_LOOPS, COIL_LOOPS - 1e-6);
  const li = Math.floor(f);
  const a = (f - li) * Math.PI * 2;
  const L = loopFrame(li);
  // a loop hanging from the grip, in her side plane, then fanned around the vertical
  target.set(L.dx * Math.sin(a / 2), -L.ry * (1 - Math.cos(a)), L.rz * Math.sin(a));
  target.applyAxisAngle(new THREE.Vector3(0, 1, 0), L.fan);
  return target;
}
function loopCenter(u) {
  const li = Math.min(Math.floor(u * COIL_LOOPS), COIL_LOOPS - 1);
  const L = loopFrame(li);
  return new THREE.Vector3(0, -L.ry, 0);
}
const coilCurve = new THREE.CatmullRomCurve3(Array.from({ length: 161 }, (_, i) => coilPoint(i / 160)));
swingRig.add(new THREE.Mesh(new THREE.TubeGeometry(coilCurve, 220, 0.028, 5, false), wireMat));
// her fist around the grip: a short wrap of wire
const grip = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.035, 6, 12), wireMat);
grip.rotation.y = Math.PI / 2;
swingRig.add(grip);

const coilSlots = [];
for (let i = 0; i < STRAND_SIZE; i++) {
  const u = (i + 0.5) / STRAND_SIZE;
  const p = coilPoint(u);
  const out = p.clone().sub(loopCenter(u).applyAxisAngle(new THREE.Vector3(0, 1, 0), loopFrame(Math.floor(u * COIL_LOOPS)).fan)).normalize();
  const turn = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), out.clone().negate());
  const socket = new THREE.Mesh(capGeo, capMat);
  socket.position.copy(p).addScaledVector(out, 0.04);
  socket.quaternion.copy(turn);
  socket.scale.setScalar(0.5);
  const bulb = makeBulbMesh('#ffffff', 0.0001);
  bulb.position.copy(p).addScaledVector(out, 0.15);
  bulb.quaternion.copy(turn);
  bulb.userData.glow.scale.setScalar(0.8);
  swingRig.add(socket, bulb);
  coilSlots.push({ bulb, pop: 1, shown: false });
}

// spring-driven swing of the hanging loops
const coilSwing = { x: 0, vx: 0, z: 0, vz: 0, lastYaw: 0 };
const tmpFwd = new THREE.Vector3();
function updateCoil(dt, t) {
  // keep the bundle hanging roughly straight down even as her arm moves
  if (rig) {
    coil.rotation.x = -rig.armL.rotation.x;
    coil.rotation.z = -rig.armL.rotation.z;
  }
  // it lags behind when she speeds up and sways when she turns or steps
  tmpFwd.set(Math.sin(player.rotation.y), 0, Math.cos(player.rotation.y));
  const fwdSpeed = vel.dot(tmpFwd);
  let yawRate = (player.rotation.y - coilSwing.lastYaw) / Math.max(dt, 1e-3);
  yawRate = Math.max(-6, Math.min(6, yawRate));
  coilSwing.lastYaw = player.rotation.y;
  const targetX = fwdSpeed * 0.035 + Math.sin(walkPhase * 2) * 0.06 * walkAmt;
  const targetZ = -yawRate * 0.05 + Math.sin(walkPhase) * 0.08 * walkAmt;
  coilSwing.vx += (-(coilSwing.x - targetX) * 45 - coilSwing.vx * 4.5) * dt;
  coilSwing.vz += (-(coilSwing.z - targetZ) * 45 - coilSwing.vz * 4.5) * dt;
  coilSwing.x += coilSwing.vx * dt;
  coilSwing.z += coilSwing.vz * dt;
  swingRig.rotation.set(coilSwing.x, 0, coilSwing.z);
  coilSlots.forEach((slot, i) => {
    const hex = state.strand[i];
    const show = Boolean(hex) && !live;
    if (show && !slot.shown) {
      setBulbColor(slot.bulb, hex);
      slot.pop = 0;
    }
    slot.shown = show;
    slot.pop = Math.min(1, slot.pop + dt * 4);
    const bounce = 1 + Math.sin(slot.pop * Math.PI) * 0.6;
    slot.bulb.scale.setScalar(show ? 0.45 * slot.pop * bounce : 0.0001);
    const ud = slot.bulb.userData;
    ud.mat.color.copy(ud.color).multiplyScalar((1.7 + 0.1 * Math.sin(t * 1.5 + i)) * night);
    ud.glow.material.opacity = 0.22 * night;
  });
}

function randomSpawn(near) {
  for (let tries = 0; tries < 60; tries++) {
    let x;
    let z;
    if (near && Math.random() < 0.6) {
      const a = Math.random() * Math.PI * 2;
      const d = 6 + Math.random() * 20;
      x = near.x + Math.cos(a) * d;
      z = near.z + Math.sin(a) * d;
    } else {
      const a = Math.random() * Math.PI * 2;
      const d = 9 + Math.random() * 58;
      x = Math.cos(a) * d;
      z = Math.sin(a) * d;
    }
    if (Math.hypot(x, z) > world.worldRadius - 4 || Math.hypot(x, z) < 9) continue;
    if (cabins.some((c) => Math.hypot(c.group.position.x - x, c.group.position.z - z) < 8.5)) continue;
    if (colliders.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + 1)) continue;
    if (Math.hypot(world.pond.center.x - x, world.pond.center.z - z) < world.pond.radius + 2) continue;
    return new THREE.Vector3(x, 0, z);
  }
  return new THREE.Vector3(0, 0, 12);
}

function rollType() {
  const r = Math.random();
  return r < 0.06 ? 'glitter' : r < 0.12 ? 'snow' : null;
}
function spawnGroundBulb(pos, colorHex, type = rollType(), fallFrom = 0) {
  const color = type ? SPECIALS[type].color : colorHex || PALETTE[Math.floor(Math.random() * PALETTE.length)];
  const mesh = makeBulbMesh(color, 1, type);
  mesh.position.copy(pos || randomSpawn(player.position));
  mesh.userData.hex = color;
  mesh.userData.fall = fallFrom; // height it's dropping from (bulbs shaken out of trees)
  mesh.userData.phase = Math.random() * 6.28;
  mesh.userData.baseY = 0.7;
  mesh.userData.spawn = 0;
  scene.add(mesh);
  groundBulbs.push(mesh);
  return mesh;
}
for (let i = 0; i < GROUND_BULBS; i++) spawnGroundBulb(randomSpawn(null));

function updateGroundBulbs(dt, t) {
  const full = state.strand.length >= STRAND_SIZE;
  for (let i = groundBulbs.length - 1; i >= 0; i--) {
    const b = groundBulbs[i];
    const ud = b.userData;
    ud.spawn = Math.min(1, ud.spawn + dt * 2);
    b.scale.setScalar(ud.spawn);
    b.rotation.y += dt;
    const dx = player.position.x - b.position.x;
    const dz = player.position.z - b.position.z;
    const d = Math.hypot(dx, dz);
    if (!full && state.playing && d < 4.5) {
      // magnet toward the player
      const pull = (1 - d / 4.5) * 16 * dt;
      b.position.x += (dx / d) * pull;
      b.position.z += (dz / d) * pull;
      if (d < 1.4) {
        collectBulb(b, i);
        continue;
      }
    } else if (full && d < 2 && !state.fullWarned && state.playing) {
      state.fullWarned = true;
      toast('Your strand is full. Hang it on a cabin!');
    }
    if (ud.fall > 0) {
      ud.fall = Math.max(0, ud.fall - dt * 9);
      b.position.y = ud.baseY + ud.fall;
    } else {
      b.position.y = ud.baseY + Math.sin(t * 2 + ud.phase) * 0.18;
    }
    ud.glow.material.opacity = (0.42 + Math.sin(t * 1.5 + ud.phase) * 0.05) * night;
    ud.mat.color.copy(ud.color).multiplyScalar(2.2 * night);
    if (ud.icon) {
      ud.icon.material.rotation = t * (ud.type === 'snow' ? 0.6 : -1.2);
      ud.icon.material.opacity = 0.7 + Math.sin(t * 4 + ud.phase) * 0.25;
      if (Math.random() < dt * 3) burst(b.position, ud.color, 1, 1.2);
    }
  }
}

function collectBulb(b, i) {
  scene.remove(b);
  groundBulbs.splice(i, 1);
  addToStrand(b.userData.hex, b.userData.type, b.userData.color);
  // keep the snow stocked
  setTimeout(() => spawnGroundBulb(), 900 + Math.random() * 1500);
}

function addToStrand(hex, type, color) {
  state.strand.push(hex);
  state.types.push(type || null);
  if (type) toast(type === 'glitter' ? 'A glitter bulb! This strand will sparkle.' : 'A snowflake bulb! The lights will chase along this strand.');
  sfx.pickup(state.strand.length - 1);
  burst(coilSlots[state.strand.length - 1].bulb.getWorldPosition(new THREE.Vector3()), color, 10, 2);
  updateStrandUI();
  if (state.strand.length === STRAND_SIZE) {
    toast('Strand full! Walk up to a cabin and click a glowing hook.');
    state.fullWarned = false;
  }
}

function dropBulb() {
  if (!state.strand.length || live) return;
  const hex = state.strand.pop();
  const type = state.types.pop();
  const fwd = new THREE.Vector3(Math.sin(player.rotation.y), 0, Math.cos(player.rotation.y));
  const pos = player.position.clone().addScaledVector(fwd, 5.5);
  pos.y = 0;
  spawnGroundBulb(pos, hex, type);
  updateStrandUI();
}

// ---------- bulbs frozen in the pond ----------
const iceBulbs = [];
function freezeBulb() {
  const { center, radius } = world.pond;
  for (let tries = 0; tries < 30; tries++) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.sqrt(Math.random()) * (radius - 1.5);
    const pos = new THREE.Vector3(center.x + Math.cos(a) * d, -0.08, center.z + Math.sin(a) * d);
    if (iceBulbs.some((b) => b.position.distanceTo(pos) < 2)) continue;
    const b = makeBulbMesh(SPECIALS.snow.color, 0.9, 'snow');
    b.position.copy(pos);
    b.rotation.set(Math.PI / 2 - 0.3, 0, Math.random() * 6.28); // lying in the ice
    b.userData.glow.material.opacity = 0.5;
    scene.add(b);
    iceBulbs.push(b);
    return;
  }
}
for (let i = 0; i < 6; i++) freezeBulb();
let nextFreeze = 0;
function updateIceBulbs(dt, t) {
  const full = state.strand.length >= STRAND_SIZE;
  for (let i = iceBulbs.length - 1; i >= 0; i--) {
    const b = iceBulbs[i];
    const ud = b.userData;
    if (ud.icon) ud.icon.material.rotation = t * 0.5;
    ud.mat.color.copy(ud.color).multiplyScalar((1.4 + Math.sin(t * 2 + i) * 0.3) * night);
    if (!state.playing || full) continue;
    if (Math.hypot(b.position.x - player.position.x, b.position.z - player.position.z) < 1.4) {
      // skate over it and it pops out of the ice
      scene.remove(b);
      iceBulbs.splice(i, 1);
      burst(b.position.clone().setY(0.2), iceSpray, 24, 3.2);
      sfx.crack();
      addToStrand(SPECIALS.snow.color, 'snow', ud.color);
    }
  }
  // the pond slowly freezes new ones in
  if (iceBulbs.length < 6 && t > nextFreeze) {
    nextFreeze = t + 35;
    freezeBulb();
  }
}

// ---------- snowballs ----------
const snowballGeo = new THREE.SphereGeometry(0.24, 12, 10);
const snowballMat = new THREE.MeshStandardMaterial({ color: 0xf6f9ff, roughness: 0.9 });
const snowballs = [];
const snowWhite = new THREE.Color(0.95, 0.97, 1);
let snowballReady = 0;
let pendingSnowball = null;
function throwSnowball(t) {
  if (!state.playing || state.photo || t < snowballReady || (live && live.phase !== 'dangling')) return;
  snowballReady = t + 0.45;
  // throw where the camera is looking
  const dir = new THREE.Vector3(-Math.sin(orbit.yaw), 0, -Math.cos(orbit.yaw));
  state.faceTarget = player.position.clone().addScaledVector(dir, 10);
  player.rotation.y = Math.atan2(dir.x, dir.z);
  throwAnim.t = 0;
  pendingSnowball = { at: t + RELEASE, dir };
  sfx.throw();
}
function updateSnowballs(dt, t) {
  if (pendingSnowball && t >= pendingSnowball.at) {
    const m = new THREE.Mesh(snowballGeo, snowballMat);
    m.castShadow = true;
    m.position.copy(throwHandPosition());
    scene.add(m);
    snowballs.push({ m, v: pendingSnowball.dir.clone().multiplyScalar(24).add(new THREE.Vector3(0, 7, 0)), life: 3 });
    pendingSnowball = null;
    if (!live) state.faceTarget = null;
  }
  for (let i = snowballs.length - 1; i >= 0; i--) {
    const sb = snowballs[i];
    sb.v.y -= 20 * dt;
    sb.m.position.addScaledVector(sb.v, dt);
    sb.life -= dt;
    const p = sb.m.position;
    let hit = sb.life <= 0 || p.y < 0.15;
    // trees: shake the snow off, and sometimes a hidden bulb tumbles out
    for (const tree of world.forest.trees) {
      if (hit) break;
      if (p.y < 7.5 * tree.s && Math.hypot(p.x - tree.x, p.z - tree.z) < 2.2 * tree.sx) {
        hit = true;
        world.forest.shake(tree);
        sfx.snowThud();
        for (let k = 0; k < 6; k++) burst(new THREE.Vector3(tree.x + (Math.random() - 0.5) * 3 * tree.sx, (2 + Math.random() * 5) * tree.s, tree.z + (Math.random() - 0.5) * 3 * tree.sx), snowWhite, 10, 2.2);
        if (tree.hasBulb) {
          tree.hasBulb = false;
          const toward = new THREE.Vector3(player.position.x - tree.x, 0, player.position.z - tree.z).normalize();
          const drop = new THREE.Vector3(tree.x, 0, tree.z).addScaledVector(toward, 2.6 * tree.sx + 0.8);
          const type = Math.random() < 0.5 ? 'glitter' : 'snow';
          spawnGroundBulb(drop, null, type, 4.5 * tree.s);
          setTimeout(() => toast(`Something fell out of the tree: a ${SPECIALS[type].label} bulb!`), 350);
        }
      }
    }
    // villagers
    for (const v of villagers.list) {
      if (hit || v.state !== 'porch') continue;
      if (p.distanceTo(v.world) < 1.4 || (Math.hypot(p.x - v.world.x, p.z - v.world.z) < 1 && p.y < 3)) {
        hit = true;
        villagers.react(v, t);
        sfx.snowThud();
      }
    }
    // cabins
    if (!hit) for (const cab of cabins) if (insideCabin(cab, p, 0)) hit = true;
    if (hit) {
      burst(p, snowWhite, 18, 3);
      scene.remove(sb.m);
      snowballs.splice(i, 1);
    }
  }
}

// ---------- villagers ----------
const villagers = createVillagers(scene, cabins, CABIN, colliders);

// ---------- night slowly turning to morning ----------
// 1 at night, easing down to ~0.45 by sunrise: night-time glows fade in daylight
let night = 1;
function updateTimeOfDay(dt) {
  const done = cabins.filter((c) => c.complete).length;
  const target = (done / cabins.length) * 0.8 + (tree.lit ? 0.2 : 0);
  state.timeK += (target - state.timeK) * (1 - Math.exp(-dt * 0.35));
  world.setTimeOfDay(state.timeK);
  refreshEnvironment(state.timeK);
  renderer.toneMappingExposure = 1.05 - state.timeK * 0.08;
  const day = THREE.MathUtils.smoothstep(state.timeK, 0.35, 1);
  night = 1 - day * 0.55;
  if (stephMat) stephMat.emissiveIntensity = 0.45 * (1 - day * 0.85);
  lantern.intensity = 5 * (1 - day * 0.9);
  bloom.strength = 0.6 * (1 - day * 0.6);
  bloom.threshold = 0.86 + day * 0.1;
}

// ---------- photo mode ----------
let photoCount = 0;
function setPhotoMode(on) {
  if (!state.playing) return;
  state.photo = on;
  document.body.classList.toggle('photo-mode', on);
  if (on) {
    cancelLive();
    orbit.prevDist = orbit.dist;
  } else {
    body.visible = true;
    if (orbit.prevDist) orbit.dist = orbit.prevDist;
  }
}
function takePhoto() {
  state.snapRequested = true;
}
function savePhoto() {
  state.snapRequested = false;
  const url = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  photoCount += 1;
  a.href = url;
  a.download = `havenfall-${photoCount}.png`;
  a.click();
  sfx.shutter();
  ui.flash.classList.remove('go');
  void ui.flash.offsetWidth;
  ui.flash.classList.add('go');
}

// ---------- hooks ----------
const hookGeo = new THREE.SphereGeometry(0.22, 12, 10);
const hookHitGeo = new THREE.SphereGeometry(0.85, 8, 6);
const hitMat = new THREE.MeshBasicMaterial({ visible: false });
const hookTargets = [];
cabins.forEach((cabin) => {
  cabin.hooks.forEach((hook) => {
    const mat = new THREE.MeshBasicMaterial({ color: 0xfff2c8, transparent: true, opacity: 0 });
    const mesh = new THREE.Mesh(hookGeo, mat);
    mesh.position.copy(hook.world);
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: getGlowTexture(), color: 0xffe2a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    halo.scale.setScalar(1.6);
    mesh.add(halo);
    const hit = new THREE.Mesh(hookHitGeo, hitMat);
    hit.userData = { cabin, hook };
    mesh.add(hit);
    scene.add(mesh);
    hook.mesh = mesh;
    hook.mat = mat;
    hook.halo = halo;
    hookTargets.push(hit);
  });
});

function hookReachable(hook) {
  return Math.hypot(hook.world.x - player.position.x, hook.world.z - player.position.z) < REACH;
}

function hookValidAsSecond(cabin, hook) {
  const f = state.firstHook;
  if (!f) return false;
  if (f.cabin !== cabin || f.hook === hook || f.hook.face !== hook.face) return false;
  if (f.hook.world.distanceTo(hook.world) < 1.5) return false;
  return !state.usedPairs.has(pairKey(f.hook, hook));
}

function pairKey(a, b) {
  return [a.id, b.id].sort().join('|');
}

let hovered = null;
function updateHooks(t) {
  const ready = state.strand.length >= STRAND_SIZE || state.firstHook;
  for (const cabin of cabins) {
    for (const hook of cabin.hooks) {
      let target = 0;
      if (ready) {
        const near = Math.hypot(hook.world.x - player.position.x, hook.world.z - player.position.z);
        if (state.firstHook) {
          if (hook === state.firstHook.hook) target = 1;
          else if (hookValidAsSecond(cabin, hook)) target = near < REACH ? 0.9 : 0.25;
        } else if (near < REACH + 10) {
          target = near < REACH ? 0.85 : 0.25;
        }
      }
      const isHover = hovered && hovered.hook === hook && target > 0;
      const pulse = 0.75 + Math.sin(t * 4 + hook.world.x) * 0.25;
      hook.mat.opacity += (target - hook.mat.opacity) * 0.2;
      hook.halo.material.opacity = hook.mat.opacity * pulse * (isHover ? 1 : 0.6);
      const s = isHover ? 1.6 : 1;
      hook.mesh.scale.lerp(new THREE.Vector3(s, s, s), 0.25);
      hook.mesh.visible = hook.mat.opacity > 0.02;
    }
  }
}

// ---------- strands ----------
class SagCurve extends THREE.Curve {
  constructor(a, b, sag) {
    super();
    this.a = a;
    this.b = b;
    this.sag = sag;
  }
  getPoint(t, target = new THREE.Vector3()) {
    target.lerpVectors(this.a, this.b, t);
    target.y -= this.sag * 4 * t * (1 - t);
    return target;
  }
}

function sagFor(a, b) {
  const horiz = Math.hypot(b.x - a.x, b.z - a.z);
  return 0.15 + horiz * 0.09;
}

const strands = [];

function bulbCountFor(a, b, colors) {
  return Math.max(colors.length, Math.round(a.distanceTo(b) / 0.8));
}

function placeBulbsOnCurve(bulbs, curve) {
  bulbs.forEach((b, i) => {
    curve.getPoint((i + 0.5) / bulbs.length, b.position);
    b.position.y -= 0.22;
  });
}

function hangStrand(cabin, h1, h2, colors, types = []) {
  const curve = new SagCurve(h1.world.clone(), h2.world.clone(), sagFor(h1.world, h2.world));
  const group = new THREE.Group();
  const wire = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.04, 5, false), wireMat);
  group.add(wire);
  const count = bulbCountFor(h1.world, h2.world, colors);
  const bulbs = [];
  for (let i = 0; i < count; i++) {
    const b = makeBulbMesh(colors[i % colors.length], 0.85, types[i % colors.length] || null);
    b.userData.glow.scale.setScalar(1.3);
    b.userData.phase = Math.random() * 6.28;
    b.userData.delay = i * 0.05;
    group.add(b);
    bulbs.push(b);
  }
  placeBulbsOnCurve(bulbs, curve);
  scene.add(group);
  const glitter = types.includes('glitter');
  const chase = types.includes('snow');
  strands.push({ group, bulbs, born: clock.elapsedTime, cabin, curve, wave: count * 0.05, glitter, chase });
  if (glitter || chase) setTimeout(() => toast(glitter && chase ? 'Glitter and snowflake bulbs: this one sparkles AND chases!' : glitter ? 'This strand sparkles!' : 'Look, the lights chase along this strand!'), 1400);

  state.usedPairs.add(pairKey(h1, h2));
  cabin.strands += 1;
  cabin.pulseAt = clock.elapsedTime;
  cabin.pulseStrength = 1;
  if (!cabin.complete && cabin.strands >= STRANDS_PER_CABIN) {
    cabin.complete = true;
    cabin.completedAt = clock.elapsedTime;
    cabin.wreath.visible = true;
    cabin.pulseStrength = 2.2;
    goldenShower(cabin);
    villagers.appear(cabin, clock.elapsedTime + 1.2);
    sfx.cabinDone();
    toast(`✨ ${cabin.name} is glowing!`);
    fireworks(cabin.group.position.clone().add(new THREE.Vector3(0, 10, 0)), 2);
  } else {
    sfx.hang();
    const left = STRANDS_PER_CABIN - cabin.strands;
    toast(left > 0 ? `Strand hung! ${left} more to light up ${cabin.name}.` : 'Strand hung! Extra sparkle ✨');
  }
  updateProgressUI();
  if (cabins.every((c) => c.complete) && !tree.lit) lightTheTree();
}

const sparkGold = new THREE.Color(1, 0.86, 0.55);
function updateStrands(t) {
  for (const s of strands) {
    const age = t - s.born;
    // a spark runs along the wire just ahead of the light-up wave
    const front = age / s.wave;
    if (front <= 1.05) {
      const p = s.curve.getPoint(Math.min(1, front));
      burst(p, sparkGold, 3, 1.8);
    }
    for (const b of s.bulbs) {
      const ud = b.userData;
      const since = age - ud.delay;
      const k = THREE.MathUtils.clamp(since / 0.3, 0, 1);
      if (k > 0 && !ud.sparked) {
        ud.sparked = true;
        burst(b.position, ud.color, 7, 2.6);
      }
      // a one-time pop and flare as each bulb switches on, then a soft shimmer
      const flare = since > 0 ? Math.exp(-since * 3.5) : 0;
      const pop = since > 0 && since < 0.3 ? Math.sin((since / 0.3) * Math.PI) * 0.45 : 0;
      b.scale.setScalar(0.85 * (1 + pop));
      let tw = 0.93 + 0.07 * Math.sin(t * 1.4 + ud.phase);
      // snowflake bulbs: a soft pulse travels down the strand
      if (s.chase && k >= 1) tw *= 0.55 + 0.75 * Math.pow(Math.max(0, Math.sin(t * 4 - s.bulbs.indexOf(b) * 0.7)), 2);
      // glitter bulbs: random bulbs catch a glint
      if (s.glitter && k >= 1 && Math.random() < 0.012) {
        ud.glint = 1;
        burst(b.position, sparkGold, 3, 1.4);
      }
      ud.glint = Math.max(0, (ud.glint || 0) - 0.06);
      const level = 0.75 + k * 0.45;
      const boost = flare * 1.3 + ud.glint * 1.1;
      ud.mat.color.copy(ud.color).multiplyScalar(1.9 * level * tw * (1 + boost) * night);
      ud.glow.material.opacity = Math.min(1, (0.25 + 0.2 * k) * tw + 0.65 * flare + 0.4 * ud.glint) * night;
      ud.glow.scale.setScalar(1.3 + 1.4 * flare + 0.8 * ud.glint);
      if (ud.icon) ud.icon.material.rotation = t * 0.8;
    }
  }
}

// finishing a cabin: golden sparkles burst up around the roofline, a few at a time
function goldenShower(cabin) {
  const t0 = clock.elapsedTime;
  for (let i = 0; i < 14; i++) {
    const hook = cabin.hooks[Math.floor(Math.random() * cabin.hooks.length)];
    pendingFireworks.push({
      at: t0 + 0.15 + i * 0.09,
      pos: hook.world.clone().add(new THREE.Vector3(0, 0.5, 0)),
      color: i % 3 ? sparkGold : new THREE.Color(PALETTE[i % PALETTE.length]),
      n: 22,
      speed: 4,
    });
  }
}

function updateCabinGlow(dt, t) {
  for (const c of cabins) {
    const level = Math.min(1, c.strands / STRANDS_PER_CABIN);
    const flicker = 0.97 + Math.sin(t * 2.1 + c.index) * 0.015 + Math.sin(t * 3.3 + c.index * 2) * 0.015;
    // a warm swell right after each strand goes up, easing back to the steady glow
    const swell = c.pulseAt !== undefined ? Math.exp(-(t - c.pulseAt) * 1.6) * c.pulseStrength : 0;
    const targetWin = (0.05 + level * 2.4 * flicker + swell * 2.2) * night;
    c.windowMat.emissiveIntensity += (targetWin - c.windowMat.emissiveIntensity) * (1 - Math.exp(-dt * 3));
    const targetLight = ((c.strands > 0 ? 6 + Math.min(c.strands, 4) * 9 : 0) * flicker + swell * 35) * night;
    c.light.intensity += (targetLight - c.light.intensity) * (1 - Math.exp(-dt * 3));
    const haloTarget = Math.min(0.6, level * 0.45 * flicker + swell * 0.25) * night * night;
    for (const halo of c.windowGlows) halo.material.opacity += (haloTarget - halo.material.opacity) * (1 - Math.exp(-dt * 3));
    if (c.wreath.visible) {
      const k = Math.min(1, (t - c.completedAt) / 0.6);
      c.wreath.scale.setScalar(Math.max(0.001, k * (1 + Math.sin(k * Math.PI) * 0.3)));
    }
  }
}

// ---------- the strand in flight ----------
// Phases: throwA (first end flies to hook A, unspooling from the coil) → dangling
// (strand hangs from hook A back to her hand as she walks) → throwB (other end flies
// to hook B) → settle (strand bounces into place) → hung for good.
const THROW_TIME = 0.5;
const SETTLE_TIME = 0.9;
let live = null;

function arc(from, to, k, height) {
  return new THREE.Vector3().lerpVectors(from, to, k).add(new THREE.Vector3(0, Math.sin(k * Math.PI) * height, 0));
}

function setLiveBulbs(n) {
  live.bulbs.forEach((b) => live.group.remove(b));
  live.bulbs = [];
  for (let i = 0; i < n; i++) {
    const b = makeBulbMesh(live.colors[i % live.colors.length], 0.7);
    b.userData.glow.scale.setScalar(1.2);
    // match the strand's "not yet lit" level so the hand-off is seamless
    b.userData.mat.color.copy(b.userData.color).multiplyScalar(1.9 * 0.75);
    b.userData.glow.material.opacity = 0.25;
    live.group.add(b);
    live.bulbs.push(b);
  }
}

function startThrowA(cabin, hook) {
  const group = new THREE.Group();
  scene.add(group);
  live = { cabin, hookA: hook, hookB: null, colors: [...state.strand], types: [...state.types], phase: 'throwA', t: 0, from: throwHandPosition(), group, wire: null, bulbs: [], sag: 0.5 };
  throwAnim.t = 0;
  state.faceTarget = hook.world;
  setLiveBulbs(live.colors.length);
  state.firstHook = { cabin, hook };
  sfx.throw();
  updateHint();
}

function startThrowB(hook) {
  live.hookB = hook;
  live.phase = 'throwB';
  live.t = 0;
  live.from = throwHandPosition();
  live.startSag = live.sag;
  throwAnim.t = 0;
  state.faceTarget = hook.world;
  setLiveBulbs(bulbCountFor(live.hookA.world, hook.world, live.colors));
  sfx.throw();
}

function cancelLive(message) {
  if (!live) return;
  scene.remove(live.group);
  if (live.wire) live.wire.geometry.dispose();
  live = null;
  state.firstHook = null;
  state.faceTarget = null;
  if (message) toast(message);
  updateHint();
}

function updateLive(dt) {
  if (!live) return;
  live.t += dt;
  const hand = handPosition();
  let a;
  let b;
  if (live.phase === 'throwA') {
    // the end stays in her throwing hand through the wind-up, then flies
    if (live.t < RELEASE) live.from = throwHandPosition();
    const k = THREE.MathUtils.clamp((live.t - RELEASE) / THROW_TIME, 0, 1);
    a = arc(live.from, live.hookA.world, 1 - Math.pow(1 - k, 2), 2.4);
    b = hand;
    live.sag = 0.3 + 0.4 * k;
    if (k >= 1) {
      live.phase = 'dangling';
      state.faceTarget = null;
      burst(live.hookA.world, new THREE.Color(0xffe2a0), 14, 2.5);
      sfx.hook();
    }
  } else if (live.phase === 'dangling') {
    a = live.hookA.world;
    b = hand;
    const target = 0.6 + a.distanceTo(b) * 0.07;
    live.sag += (target - live.sag) * (1 - Math.exp(-dt * 6));
    if (Math.hypot(a.x - player.position.x, a.z - player.position.z) > REACH + 10) {
      cancelLive('You walked too far. The strand slipped back into your coil.');
      return;
    }
  } else if (live.phase === 'throwB') {
    if (live.t < RELEASE) live.from = throwHandPosition();
    const k = THREE.MathUtils.clamp((live.t - RELEASE) / THROW_TIME, 0, 1);
    a = live.hookA.world;
    b = arc(live.from, live.hookB.world, 1 - Math.pow(1 - k, 2), 2);
    live.sag = THREE.MathUtils.lerp(live.startSag, sagFor(a, live.hookB.world), k);
    if (k >= 1) {
      live.phase = 'settle';
      state.faceTarget = null;
      live.t = 0;
      burst(live.hookB.world, new THREE.Color(0xffe2a0), 14, 2.5);
      sfx.hook();
    }
  } else {
    // settle: a damped bounce, then hand off to a permanent strand
    a = live.hookA.world;
    b = live.hookB.world;
    const s = live.t;
    live.sag = sagFor(a, b) * (1 + 0.7 * Math.exp(-s * 5) * Math.cos(s * 17));
    if (s >= SETTLE_TIME) {
      const { cabin, hookA, hookB, colors, types } = live;
      cancelLive();
      state.strand = [];
      state.types = [];
      hangStrand(cabin, hookA, hookB, colors, types);
      updateStrandUI();
      return;
    }
  }
  const curve = new SagCurve(a.clone(), b.clone(), live.sag);
  if (live.wire) {
    live.group.remove(live.wire);
    live.wire.geometry.dispose();
  }
  live.wire = new THREE.Mesh(new THREE.TubeGeometry(curve, 32, 0.035, 4, false), wireMat);
  live.group.add(live.wire);
  placeBulbsOnCurve(live.bulbs, curve);
}

// ---------- preview of where the strand will hang ----------
const previewGeo = new THREE.BufferGeometry().setFromPoints(new Array(32).fill(0).map(() => new THREE.Vector3()));
const previewMat = new THREE.LineDashedMaterial({ color: 0xffe0a0, dashSize: 0.35, gapSize: 0.2, transparent: true, opacity: 0.9 });
const preview = new THREE.Line(previewGeo, previewMat);
preview.frustumCulled = false;
preview.visible = false;
scene.add(preview);

function updatePreview() {
  const valid = live && live.phase === 'dangling' && hovered && hookValidAsSecond(hovered.cabin, hovered.hook);
  if (!valid) {
    preview.visible = false;
    return;
  }
  const a = live.hookA.world;
  const b = hovered.hook.world;
  const curve = new SagCurve(a, b, sagFor(a, b));
  const pts = curve.getPoints(31);
  const arr = previewGeo.attributes.position.array;
  pts.forEach((p, i) => {
    arr[i * 3] = p.x;
    arr[i * 3 + 1] = p.y;
    arr[i * 3 + 2] = p.z;
  });
  previewGeo.attributes.position.needsUpdate = true;
  preview.computeLineDistances();
  previewMat.opacity = 0.7;
  preview.visible = true;
}

// ---------- sparkle particles ----------
const SPARKS = 1600;
const sparkPos = new Float32Array(SPARKS * 3);
const sparkCol = new Float32Array(SPARKS * 3);
const sparkVel = new Float32Array(SPARKS * 3);
const sparkLife = new Float32Array(SPARKS);
let sparkHead = 0;
const sparkGeo = new THREE.BufferGeometry();
sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
sparkGeo.setAttribute('color', new THREE.BufferAttribute(sparkCol, 3));
const sparks = new THREE.Points(
  sparkGeo,
  new THREE.PointsMaterial({ size: 0.45, map: getGlowTexture(), vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
);
sparks.frustumCulled = false;
scene.add(sparks);
for (let i = 0; i < SPARKS; i++) sparkPos[i * 3 + 1] = -999;

function burst(pos, color, n, speed, gravity = 6) {
  for (let k = 0; k < n; k++) {
    const i = sparkHead;
    sparkHead = (sparkHead + 1) % SPARKS;
    sparkPos[i * 3] = pos.x;
    sparkPos[i * 3 + 1] = pos.y;
    sparkPos[i * 3 + 2] = pos.z;
    const v = new THREE.Vector3().randomDirection().multiplyScalar(speed * (0.4 + Math.random() * 0.6));
    sparkVel[i * 3] = v.x;
    sparkVel[i * 3 + 1] = v.y + speed * 0.3;
    sparkVel[i * 3 + 2] = v.z;
    sparkLife[i] = 1;
    sparkCol[i * 3] = color.r * 1.5;
    sparkCol[i * 3 + 1] = color.g * 1.5;
    sparkCol[i * 3 + 2] = color.b * 1.5;
  }
  sparks.userData.gravity = gravity;
}
function updateSparks(dt) {
  for (let i = 0; i < SPARKS; i++) {
    if (sparkLife[i] <= 0) continue;
    sparkLife[i] -= dt * 0.9;
    sparkVel[i * 3 + 1] -= 6 * dt;
    sparkPos[i * 3] += sparkVel[i * 3] * dt;
    sparkPos[i * 3 + 1] += sparkVel[i * 3 + 1] * dt;
    sparkPos[i * 3 + 2] += sparkVel[i * 3 + 2] * dt;
    const fade = Math.max(0, sparkLife[i]);
    sparkCol[i * 3] *= 0.985;
    sparkCol[i * 3 + 1] *= 0.985;
    sparkCol[i * 3 + 2] *= 0.985;
    if (fade <= 0) sparkPos[i * 3 + 1] = -999;
  }
  sparkGeo.attributes.position.needsUpdate = true;
  sparkGeo.attributes.color.needsUpdate = true;
}

const pendingFireworks = [];
function fireworks(center, rounds) {
  for (let r = 0; r < rounds * 3; r++) {
    pendingFireworks.push({
      at: clock.elapsedTime + r * 0.45,
      pos: center.clone().add(new THREE.Vector3((Math.random() - 0.5) * 12, Math.random() * 5, (Math.random() - 0.5) * 12)),
      color: new THREE.Color(PALETTE[Math.floor(Math.random() * PALETTE.length)]),
    });
  }
}
function updateFireworks(t) {
  for (let i = pendingFireworks.length - 1; i >= 0; i--) {
    if (pendingFireworks[i].at <= t) {
      const f = pendingFireworks[i];
      burst(f.pos, f.color, f.n || 70, f.speed || 9);
      pendingFireworks.splice(i, 1);
    }
  }
}

// ---------- the grand tree finale ----------
function lightTheTree() {
  tree.lit = true;
  tree.litAt = clock.elapsedTime;
  sfx.finale();
  fireworks(new THREE.Vector3(0, 22, 0), 5);
  setTimeout(() => {
    if (!state.finaleShown) {
      state.finaleShown = true;
      ui.finale.classList.remove('hidden');
    }
  }, 3200);
}
function updateTree(t) {
  if (!tree.lit) return;
  const age = t - tree.litAt;
  tree.bulbs.forEach((b, i) => {
    const on = age > i * 0.03;
    const tw = 0.93 + 0.07 * Math.sin(t * 1.4 + b.userData.phase);
    b.material.color.copy(b.userData.color).multiplyScalar(on ? 2.4 * tw * night : 0.15);
  });
  const k = Math.min(1, Math.max(0, age - 2.5));
  tree.starMat.color.setRGB(3 * k + 0.4, 2.4 * k + 0.35, 0.8 * k + 0.16);
  tree.star.rotation.y = t * 0.6;
  tree.light.intensity = 40 * Math.min(1, age / 3) * night;
}

// ---------- HUD ----------
function updateStrandUI() {
  strandBulbs.forEach((g, i) => {
    const c = state.strand[i];
    g.style.setProperty('--c', c || 'transparent');
    g.classList.toggle('lit', Boolean(c));
    g.classList.toggle('special', Boolean(state.types[i]));
  });
  ui.count.textContent = `${state.strand.length}/${STRAND_SIZE}`;
  updateHint();
}
function updateHint() {
  const n = state.strand.length;
  let text;
  if (state.firstHook) text = 'Now click a second hook on the same side (Esc to reel it back in)';
  else if (n >= STRAND_SIZE) text = "Strand's full! Click a glowing hook on a cabin";
  else if (n === 0) text = 'Walk over the glowing bulbs in the snow';
  else text = `${STRAND_SIZE - n} more bulb${STRAND_SIZE - n === 1 ? '' : 's'} to fill your strand`;
  ui.hint.textContent = text;
}
function updateProgressUI() {
  const done = cabins.filter((c) => c.complete).length;
  ui.progressText.textContent = `${done} of ${cabins.length} cabins lit`;
  [...ui.progress.children].forEach((icon, i) => {
    const c = cabins[i];
    icon.style.setProperty('--glow', Math.min(1, c.strands / STRANDS_PER_CABIN));
    icon.classList.toggle('done', c.complete);
  });
}
updateStrandUI();
updateProgressUI();

// ---------- input ----------
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2(-10, -10);
const drag = { down: false, moved: false, x: 0, y: 0, id: null };

function pickHook() {
  raycaster.setFromCamera(mouse, camera);
  const visibleTargets = hookTargets.filter((h) => h.parent.visible);
  const hit = raycaster.intersectObjects(visibleTargets, false)[0];
  return hit ? hit.object.userData : null;
}

function onClick() {
  if (!state.playing || state.photo) return;
  const target = pickHook();
  if (!target) return;
  const { cabin, hook } = target;
  if (!hookReachable(hook)) {
    toast('Walk a little closer to reach that hook.');
    sfx.error();
    return;
  }
  if (!live) {
    if (state.strand.length < STRAND_SIZE) {
      toast(`Fill your strand first (${state.strand.length}/${STRAND_SIZE}).`);
      sfx.error();
      return;
    }
    startThrowA(cabin, hook);
    return;
  }
  if (live.phase !== 'dangling') return; // a throw is already in the air
  if (hook === live.hookA) {
    cancelHang();
    return;
  }
  if (!hookValidAsSecond(cabin, hook)) {
    sfx.error();
    if (cabin !== state.firstHook.cabin) toast('Both ends need to be on the same cabin.');
    else if (hook.face !== state.firstHook.hook.face) toast('Pick a hook on the same side of the cabin.');
    else toast('A strand already hangs there. Try another pair of hooks.');
    return;
  }
  startThrowB(hook);
}

function cancelHang() {
  if (!live || (live.phase !== 'dangling' && live.phase !== 'throwA')) return;
  cancelLive('Strand reeled back into your coil.');
}

function setMouse(e) {
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  sfx.unlock();
  setMouse(e);
  if (e.button === 2) {
    cancelHang();
    return;
  }
  drag.down = true;
  drag.moved = false;
  drag.x = e.clientX;
  drag.y = e.clientY;
  drag.id = e.pointerId;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  setMouse(e);
  if (!drag.down || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
  if (drag.moved) {
    orbit.yaw -= dx * 0.005;
    orbit.pitch = THREE.MathUtils.clamp(orbit.pitch + dy * 0.004, 0.06, 1.25);
  }
  drag.x = e.clientX;
  drag.y = e.clientY;
});
canvas.addEventListener('pointerup', (e) => {
  if (e.pointerId !== drag.id) return;
  canvas.releasePointerCapture(e.pointerId);
  drag.down = false;
  setMouse(e);
  if (!drag.moved) onClick();
});
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    orbit.dist = THREE.MathUtils.clamp(orbit.dist + e.deltaY * 0.012, state.photo ? 3 : 6, state.photo ? 48 : 32);
  },
  { passive: false },
);

const keyMap = { w: 'f', arrowup: 'f', s: 'b', arrowdown: 'b', a: 'l', arrowleft: 'l', d: 'r', arrowright: 'r' };
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (keyMap[k]) {
    move[keyMap[k]] = 1;
    e.preventDefault();
  } else if (k === 'shift') move.sprint = true;
  else if (k === ' ' && state.playing) {
    if (player.position.y === 0) vy = 10;
    e.preventDefault();
  } else if (k === 'q' && state.playing) dropBulb();
  else if (k === 'escape') {
    if (state.photo) setPhotoMode(false);
    else cancelHang();
  } else if (k === 'm') toggleMusic();
  else if (k === 'f') throwSnowball(clock.elapsedTime);
  else if (k === 'p') setPhotoMode(!state.photo);
  else if (k === 'enter' && state.photo) takePhoto();
});
window.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  if (keyMap[k]) move[keyMap[k]] = 0;
  else if (k === 'shift') move.sprint = false;
});
window.addEventListener('blur', () => Object.assign(move, { f: 0, b: 0, l: 0, r: 0, sprint: false }));

function toggleMusic() {
  const on = setMusic(!isMusicOn());
  ui.music.classList.toggle('off', !on);
  ui.music.setAttribute('aria-pressed', String(on));
}
ui.music.addEventListener('click', toggleMusic);
ui.photoBtn.addEventListener('click', () => setPhotoMode(true));
ui.snap.addEventListener('click', takePhoto);
ui.photoDone.addEventListener('click', () => setPhotoMode(false));
ui.hideSteph.addEventListener('click', () => {
  state.hideSteph = !state.hideSteph;
  ui.hideSteph.textContent = state.hideSteph ? 'Show Steph' : 'Hide Steph';
});
ui.helpToggle.addEventListener('click', () => ui.help.classList.toggle('collapsed'));
ui.finaleClose.addEventListener('click', () => ui.finale.classList.add('hidden'));

ui.start.addEventListener('click', () => {
  sfx.unlock();
  setMusic(true);
  ui.music.classList.remove('off');
  ui.title.classList.add('hidden');
  ui.hud.classList.remove('hidden');
  state.playing = true;
  toast('Collect glowing bulbs to fill your strand.');
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  renderer.getDrawingBufferSize(rtSize);
  grade.uniforms.uRes.value.copy(rtSize);
});

// ---------- loop ----------
const clock = new THREE.Clock();
camTarget.copy(player.position).add(new THREE.Vector3(0, 2.4, 0));

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  if (!state.playing) orbit.yaw += dt * 0.06; // slow drift behind the title screen
  updatePlayer(dt);
  updateCamera(dt);
  hovered = state.playing ? pickHook() : null;
  canvas.style.cursor = hovered && hovered.hook.mesh.visible ? 'pointer' : drag.moved ? 'grabbing' : 'grab';

  updateGroundBulbs(dt, t);
  updateHooks(t);
  updatePreview();
  updateStrands(t);
  updateCabinGlow(dt, t);
  updateLive(dt);
  animateRig(dt, t);
  updateCoil(dt, t);
  updateFireworks(t);
  updateIceBulbs(dt, t);
  updateSnowballs(dt, t);
  villagers.update(dt, t, player.position, camera, state.photo);
  updateTimeOfDay(dt);
  updateSparks(dt);
  updateTree(t);
  world.update(dt, t, player.position);
  if (state.photo && state.hideSteph) body.visible = false;

  grade.uniforms.uTime.value = t % 100;
  composer.render();
  if (state.snapRequested) savePhoto(); // read the canvas right after drawing it
  requestAnimationFrame(frame);
}
frame();

// testing helper: open with ?debug to poke at the game from the console
if (new URLSearchParams(location.search).has('debug')) {
  window.__lights = { state, cabins, player, orbit, camera, renderer, composer, scene, world, updateCamera, updatePlayer, updateHooks, updateGroundBulbs, updateStrands, updateCabinGlow, updateSparks, updateCoil, pickHook, updateStrandUI, hangStrand, get live() { return live; }, get rig() { return rig; }, throwAnim, throwArmAngle, villagers, throwSnowball, setPhotoMode, gtao, grade, bloom, iceBulbs, clock };
}
