import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { buildWorld, CABIN, getGlowTexture } from './world.js';
import { sfx, setMusic, isMusicOn } from './audio.js';

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

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.6, 0.5, 0.86);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const world = buildWorld(scene);
const { cabins, tree, colliders } = world;

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
  toast: $('toast'),
  music: $('music-toggle'),
  help: $('help'),
  helpToggle: $('help-toggle'),
  finale: $('finale'),
  finaleClose: $('finale-close'),
  loading: $('loading'),
};

for (let i = 0; i < STRAND_SIZE; i++) {
  const s = document.createElement('span');
  s.className = 'socket';
  ui.sockets.appendChild(s);
}
cabins.forEach((c) => {
  const d = document.createElement('span');
  d.className = 'dot';
  d.title = c.name;
  ui.progress.appendChild(d);
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
}

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

// is this point inside a tree's branches or a cabin? (obstacles Steph herself is
// standing inside the margin of are ignored, so the camera doesn't snap in beside them)
const camProbe = new THREE.Vector3();
const camLocal = new THREE.Vector3();
function cameraBlocked(p, from) {
  for (const c of colliders) {
    const r = c.br + 0.4;
    if (p.y < c.top && Math.hypot(p.x - c.x, p.z - c.z) < r && Math.hypot(from.x - c.x, from.z - c.z) >= r) return true;
  }
  for (const cab of cabins) {
    const inBox = (v) => {
      camLocal.copy(v);
      cab.group.worldToLocal(camLocal);
      return Math.abs(camLocal.x) < CABIN.W / 2 + 1.2 && Math.abs(camLocal.z) < CABIN.D / 2 + 1.2 && camLocal.y < CABIN.H + CABIN.RISE + 1;
    };
    if (inBox(p) && !inBox(from)) return true;
  }
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
  for (let i = 1; i <= 16; i++) {
    const d = 3 + ((orbit.dist - 3) * i) / 16;
    camProbe.copy(camTarget).addScaledVector(dir, d);
    if (cameraBlocked(camProbe, camTarget)) {
      allowed = Math.max(3, d - (orbit.dist - 3) / 16);
      break;
    }
  }
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
    const hw = CABIN.W / 2 + pr;
    const hd = CABIN.D / 2 + pr;
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
  const moving = wish.lengthSq() > 0 && state.playing;
  const speed = move.sprint ? 15 : 9;
  if (moving) wish.normalize().multiplyScalar(speed);
  else wish.set(0, 0, 0);
  vel.lerp(wish, 1 - Math.exp(-dt * 10));
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
  walkPhase += dt * Math.max(sp, 0.001) * 1.15;
  if (walkAmt < 0.02) walkPhase += (Math.round(walkPhase / Math.PI) * Math.PI - walkPhase) * (1 - Math.exp(-dt * 8));
  body.position.y = Math.abs(Math.sin(walkPhase)) * 0.1 * walkAmt;
  body.rotation.x = 0.04 * walkAmt;
}

// where the wire leaves her hand (the top of the coil, where she grips it)
function handPosition() {
  return coil.localToWorld(new THREE.Vector3(0, 0, 0));
}

// ---------- bulbs on the ground ----------
const bulbGeo = new THREE.SphereGeometry(0.26, 14, 10);
bulbGeo.scale(1, 1.35, 1);
const capGeo = new THREE.CylinderGeometry(0.12, 0.14, 0.18, 8);
const capMat = new THREE.MeshStandardMaterial({ color: 0x3a6b4a, metalness: 0.4, roughness: 0.5 });
const groundBulbs = [];

function makeBulbMesh(colorHex, scale = 1) {
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
  g.scale.setScalar(scale);
  g.userData = { color, mat, glow };
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
    ud.mat.color.copy(ud.color).multiplyScalar(1.7 + 0.1 * Math.sin(t * 1.5 + i));
    ud.glow.material.opacity = 0.22;
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
    return new THREE.Vector3(x, 0, z);
  }
  return new THREE.Vector3(0, 0, 12);
}

function spawnGroundBulb(pos, colorHex) {
  const color = colorHex || PALETTE[Math.floor(Math.random() * PALETTE.length)];
  const mesh = makeBulbMesh(color);
  mesh.position.copy(pos || randomSpawn(player.position));
  mesh.userData.hex = color;
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
    b.position.y = ud.baseY + Math.sin(t * 2 + ud.phase) * 0.18;
    ud.glow.material.opacity = 0.42 + Math.sin(t * 1.5 + ud.phase) * 0.05;
  }
}

function collectBulb(b, i) {
  scene.remove(b);
  groundBulbs.splice(i, 1);
  state.strand.push(b.userData.hex);
  sfx.pickup(state.strand.length - 1);
  burst(coilSlots[state.strand.length - 1].bulb.getWorldPosition(new THREE.Vector3()), b.userData.color, 10, 2);
  updateStrandUI();
  if (state.strand.length === STRAND_SIZE) {
    toast('Strand full! Walk up to a cabin and click a glowing hook.');
    state.fullWarned = false;
  }
  // keep the snow stocked
  setTimeout(() => spawnGroundBulb(), 900 + Math.random() * 1500);
}

function dropBulb() {
  if (!state.strand.length || live) return;
  const hex = state.strand.pop();
  const fwd = new THREE.Vector3(Math.sin(player.rotation.y), 0, Math.cos(player.rotation.y));
  const pos = player.position.clone().addScaledVector(fwd, 5.5);
  pos.y = 0;
  spawnGroundBulb(pos, hex);
  updateStrandUI();
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

function hangStrand(cabin, h1, h2, colors) {
  const curve = new SagCurve(h1.world.clone(), h2.world.clone(), sagFor(h1.world, h2.world));
  const group = new THREE.Group();
  const wire = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.04, 5, false), wireMat);
  group.add(wire);
  const count = bulbCountFor(h1.world, h2.world, colors);
  const bulbs = [];
  for (let i = 0; i < count; i++) {
    const b = makeBulbMesh(colors[i % colors.length], 0.85);
    b.userData.glow.scale.setScalar(1.3);
    b.userData.phase = Math.random() * 6.28;
    b.userData.delay = i * 0.05;
    group.add(b);
    bulbs.push(b);
  }
  placeBulbsOnCurve(bulbs, curve);
  scene.add(group);
  strands.push({ group, bulbs, born: clock.elapsedTime, cabin });

  state.usedPairs.add(pairKey(h1, h2));
  cabin.strands += 1;
  if (!cabin.complete && cabin.strands >= STRANDS_PER_CABIN) {
    cabin.complete = true;
    cabin.completedAt = clock.elapsedTime;
    cabin.wreath.visible = true;
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

function updateStrands(t) {
  for (const s of strands) {
    const age = t - s.born;
    for (const b of s.bulbs) {
      const ud = b.userData;
      // light-up wave runs down the strand once it's hung, then a soft, slow shimmer
      const k = THREE.MathUtils.clamp((age - ud.delay) / 0.3, 0, 1);
      if (k > 0 && !ud.sparked) {
        ud.sparked = true;
        burst(b.position, ud.color, 3, 2);
      }
      const tw = 0.93 + 0.07 * Math.sin(t * 1.4 + ud.phase);
      const level = 0.75 + k * 0.45;
      ud.mat.color.copy(ud.color).multiplyScalar(1.9 * level * tw);
      ud.glow.material.opacity = (0.25 + 0.2 * k) * tw;
    }
  }
}

function updateCabinGlow(dt, t) {
  for (const c of cabins) {
    const level = Math.min(1, c.strands / STRANDS_PER_CABIN);
    const flicker = 0.97 + Math.sin(t * 2.1 + c.index) * 0.015 + Math.sin(t * 3.3 + c.index * 2) * 0.015;
    const targetWin = 0.05 + level * 2.4 * flicker;
    c.windowMat.emissiveIntensity += (targetWin - c.windowMat.emissiveIntensity) * (1 - Math.exp(-dt * 3));
    const targetLight = (c.strands > 0 ? 6 + Math.min(c.strands, 4) * 9 : 0) * flicker;
    c.light.intensity += (targetLight - c.light.intensity) * (1 - Math.exp(-dt * 3));
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
  live = { cabin, hookA: hook, hookB: null, colors: [...state.strand], phase: 'throwA', t: 0, from: throwHandPosition(), group, wire: null, bulbs: [], sag: 0.5 };
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
      const { cabin, hookA, hookB, colors } = live;
      cancelLive();
      state.strand = [];
      hangStrand(cabin, hookA, hookB, colors);
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
const SPARKS = 900;
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
      burst(f.pos, f.color, 70, 9);
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
    b.material.color.copy(b.userData.color).multiplyScalar(on ? 2.4 * tw : 0.15);
  });
  const k = Math.min(1, Math.max(0, age - 2.5));
  tree.starMat.color.setRGB(3 * k + 0.4, 2.4 * k + 0.35, 0.8 * k + 0.16);
  tree.star.rotation.y = t * 0.6;
  tree.light.intensity = 40 * Math.min(1, age / 3);
}

// ---------- HUD ----------
function updateStrandUI() {
  [...ui.sockets.children].forEach((s, i) => {
    const c = state.strand[i];
    s.style.setProperty('--c', c || 'transparent');
    s.classList.toggle('filled', Boolean(c));
  });
  updateHint();
}
function updateHint() {
  const n = state.strand.length;
  let text;
  if (state.firstHook) text = `Now click a second hook on the same side of ${state.firstHook.cabin.name}. Right-click or Esc to cancel.`;
  else if (n >= STRAND_SIZE) text = 'Strand full! Click a glowing hook on a cabin.';
  else if (n === 0) text = 'Walk over the glowing bulbs in the snow to collect them.';
  else text = `Collect ${STRAND_SIZE - n} more bulb${STRAND_SIZE - n === 1 ? '' : 's'} to fill your strand.`;
  ui.hint.textContent = text;
}
function updateProgressUI() {
  const done = cabins.filter((c) => c.complete).length;
  ui.progressText.textContent = `${done} / ${cabins.length} cabins glowing`;
  [...ui.progress.children].forEach((d, i) => {
    const c = cabins[i];
    d.style.setProperty('--fill', `${Math.min(1, c.strands / STRANDS_PER_CABIN) * 100}%`);
    d.classList.toggle('done', c.complete);
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
  if (!state.playing) return;
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
    orbit.dist = THREE.MathUtils.clamp(orbit.dist + e.deltaY * 0.012, 6, 32);
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
  else if (k === 'escape') cancelHang();
  else if (k === 'm') toggleMusic();
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
  updateSparks(dt);
  updateTree(t);
  world.update(dt, t, player.position);

  composer.render();
  requestAnimationFrame(frame);
}
frame();

// testing helper: open with ?debug to poke at the game from the console
if (new URLSearchParams(location.search).has('debug')) {
  window.__lights = { state, cabins, player, orbit, camera, renderer, composer, scene, world, updateCamera, updatePlayer, updateHooks, updateGroundBulbs, updateStrands, updateCabinGlow, updateSparks, updateCoil, pickHook, updateStrandUI, hangStrand, get live() { return live; }, get rig() { return rig; }, throwAnim, throwArmAngle };
}
