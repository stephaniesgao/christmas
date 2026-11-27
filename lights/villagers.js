import * as THREE from 'three';

// Little villagers who live in the cabins. Each one stays inside until their cabin is
// fully decorated, then steps out onto the porch, waves, and chats when Steph is near.

const KINDS = [
  {
    kind: 'fox',
    name: 'Fern the fox',
    fur: 0xd8742f,
    belly: 0xfff1e0,
    lines: [
      'Oh, it’s beautiful! Thank you!',
      'Psst… some of the big pines hide shiny bulbs. Knock them loose with a snowball (F)!',
      'Glitter bulbs make a whole strand sparkle.',
    ],
  },
  {
    kind: 'bunny',
    name: 'Clover the bunny',
    fur: 0xf1ece6,
    belly: 0xffd9e2,
    lines: [
      'Eee, my house is glowing!',
      'Snowflake bulbs make the lights chase along the wire. So pretty!',
      'There are bulbs frozen in the pond. Go skating!',
    ],
  },
  {
    kind: 'bear',
    name: 'Bramble the bear',
    fur: 0x7a5236,
    belly: 0xc9a27a,
    lines: [
      'Warm and bright at last. Thank you, friend.',
      'Out past the cabins there’s a frozen pond. Bulbs got stuck in the ice!',
      'Want a souvenir? Press P for photo mode.',
    ],
  },
  {
    kind: 'penguin',
    name: 'Pip the penguin',
    fur: 0x23283a,
    belly: 0xf6f6f6,
    lines: [
      'Waddle-wow! Look at those lights!',
      'Snowballs! Press F and aim at a tree. Sometimes a bulb falls out.',
      'When every cabin glows, the sun comes up. I’ve been waiting all night!',
    ],
  },
  {
    kind: 'snowman',
    name: 'Mr. Flurry',
    fur: 0xf4f7ff,
    belly: 0xf4f7ff,
    lines: [
      'Splendid work! Simply splendid.',
      'Take a picture with P. I’ll hold very still. I always do.',
      'Every cabin you light brings the morning a little closer.',
    ],
  },
];

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...extra });

function buildCritter(spec, scarfColor) {
  const root = new THREE.Group();
  const body = new THREE.Group(); // bobs and hops
  root.add(body);
  const fur = mat(spec.fur);
  const belly = mat(spec.belly);
  const dark = mat(0x1b1b22, { roughness: 0.4 });
  const parts = {};

  if (spec.kind === 'snowman') {
    const snow = mat(0xf4f7ff, { roughness: 0.9 });
    const base = new THREE.Mesh(new THREE.SphereGeometry(0.75, 20, 14), snow);
    base.position.y = 0.7;
    const mid = new THREE.Mesh(new THREE.SphereGeometry(0.55, 20, 14), snow);
    mid.position.y = 1.55;
    const head = new THREE.Group();
    head.position.y = 2.2;
    head.add(new THREE.Mesh(new THREE.SphereGeometry(0.42, 20, 14), snow));
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.45, 8), mat(0xf07a24));
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 0, 0.55);
    head.add(nose);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), dark);
      eye.position.set(s * 0.15, 0.1, 0.37);
      head.add(eye);
    }
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.05, 20), dark);
    brim.position.y = 0.36;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.5, 20), dark);
    top.position.y = 0.62;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.285, 0.285, 0.1, 20), mat(scarfColor));
    band.position.y = 0.45;
    head.add(brim, top, band);
    for (let i = 0; i < 3; i++) {
      const btn = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), dark);
      btn.position.set(0, 1.75 - i * 0.22, 0.52 - Math.abs(i - 1) * 0.04);
      body.add(btn);
    }
    body.add(base, mid, head);
    parts.head = head;
    // stick arms
    const stick = mat(0x5a3b28);
    for (const s of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(s * 0.5, 1.65, 0);
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.9, 5), stick);
      st.position.y = 0.4;
      st.rotation.z = -s * 0.2;
      arm.add(st);
      arm.rotation.z = -s * 0.9;
      body.add(arm);
      parts[s < 0 ? 'armR' : 'armL'] = arm;
    }
  } else {
    const isPenguin = spec.kind === 'penguin';
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 0.55, 8, 16), fur);
    torso.position.y = 0.95;
    torso.scale.set(1, 1, 0.9);
    const tummy = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), belly);
    tummy.scale.set(0.9, 1.1, 0.5);
    tummy.position.set(0, 0.9, 0.3);
    body.add(torso, tummy);

    const head = new THREE.Group();
    head.position.y = 1.85;
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 16), fur);
    head.add(skull);
    if (spec.kind === 'fox') {
      const snout = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.45, 12), belly);
      snout.rotation.x = Math.PI / 2;
      snout.position.set(0, -0.08, 0.55);
      head.add(snout);
    } else if (!isPenguin) {
      const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), belly);
      muzzle.scale.set(1.2, 0.85, 0.8);
      muzzle.position.set(0, -0.12, 0.42);
      head.add(muzzle);
    }
    if (isPenguin) {
      const face = new THREE.Mesh(new THREE.SphereGeometry(0.38, 16, 12), belly);
      face.scale.set(1, 0.9, 0.55);
      face.position.set(0, -0.02, 0.26);
      const beak = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.28, 8), mat(0xf2a23a));
      beak.rotation.x = Math.PI / 2;
      beak.position.set(0, -0.08, 0.55);
      head.add(face, beak);
    } else {
      const nose = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), dark);
      nose.position.set(0, -0.06, spec.kind === 'fox' ? 0.78 : 0.58);
      head.add(nose);
    }
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.065, 10, 8), dark);
      eye.position.set(s * 0.17, 0.08, 0.44);
      const shine = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 4), mat(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.6 }));
      shine.position.set(s * 0.17 + 0.02, 0.11, 0.5);
      head.add(eye, shine);
      const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), mat(0xff8f9c, { transparent: true, opacity: 0.6 }));
      cheek.scale.set(1, 0.6, 0.4);
      cheek.position.set(s * 0.3, -0.08, 0.38);
      head.add(cheek);
      // ears
      if (spec.kind === 'fox') {
        const ear = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.4, 4), fur);
        ear.position.set(s * 0.28, 0.45, 0);
        ear.rotation.z = -s * 0.25;
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.16, 4), dark);
        tip.position.set(s * 0.33, 0.6, 0);
        tip.rotation.z = -s * 0.25;
        head.add(ear, tip);
      } else if (spec.kind === 'bunny') {
        const ear = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.55, 6, 10), fur);
        ear.position.set(s * 0.16, 0.72, -0.05);
        ear.rotation.z = -s * 0.15;
        const inner = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.4, 4, 8), belly);
        inner.position.set(s * 0.165, 0.72, 0.03);
        inner.rotation.z = -s * 0.15;
        head.add(ear, inner);
      } else if (spec.kind === 'bear') {
        const ear = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), fur);
        ear.position.set(s * 0.36, 0.38, -0.02);
        head.add(ear);
      }
    }
    body.add(head);
    parts.head = head;

    // scarf in the cabin's door colour
    const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.11, 8, 20), mat(scarfColor));
    scarf.rotation.x = Math.PI / 2;
    scarf.position.y = 1.42;
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.5, 0.08), mat(scarfColor));
    tail.position.set(0.25, 1.18, 0.4);
    tail.rotation.z = 0.2;
    body.add(scarf, tail);

    for (const s of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(s * 0.5, 1.25, 0.05);
      const a = new THREE.Mesh(new THREE.CapsuleGeometry(isPenguin ? 0.09 : 0.12, 0.4, 6, 10), fur);
      a.position.y = -0.28;
      if (isPenguin) a.scale.set(0.6, 1.2, 1.6);
      arm.add(a);
      arm.rotation.z = -s * 0.25;
      body.add(arm);
      parts[s < 0 ? 'armR' : 'armL'] = arm;
      const foot = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8), isPenguin ? mat(0xf2a23a) : fur);
      foot.scale.set(1, 0.55, 1.4);
      foot.position.set(s * 0.22, 0.1, 0.12);
      body.add(foot);
    }
    if (spec.kind === 'fox') {
      const tailG = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.6, 6, 10), fur);
      tailG.position.set(0, 0.6, -0.55);
      tailG.rotation.x = -0.9;
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), belly);
      tip.position.set(0, 0.9, -0.85);
      body.add(tailG, tip);
      parts.tail = tailG;
    }
  }
  root.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  root.scale.setScalar(1.15);
  return { root, body, parts };
}

export function createVillagers(scene, cabins, CABIN, colliders) {
  const bubble = document.getElementById('speech');
  const list = cabins.map((cabin, i) => {
    const spec = KINDS[i % KINDS.length];
    const doorColor = cabin.doorColor ?? 0xc8343c;
    const c = buildCritter(spec, doorColor);
    c.root.visible = false;
    cabin.group.add(c.root);
    return {
      ...c,
      spec,
      cabin,
      state: 'inside', // inside -> stepping -> porch
      t: 0,
      line: 0,
      talking: false,
      hop: 0,
      lookYaw: 0,
      world: new THREE.Vector3(),
    };
  });

  const inside = new THREE.Vector3(0, 0, CABIN.D / 2 - 0.4);
  const porch = new THREE.Vector3(1.6, 0, CABIN.D / 2 + 2.3);
  const tmp = new THREE.Vector3();
  let speaker = null;
  let speakerUntil = 0;

  function say(v, text, now, seconds = 5) {
    speaker = v;
    speakerUntil = now + seconds;
    bubble.innerHTML = `<b>${v.spec.name}</b>${text}`;
    bubble.classList.add('show');
  }

  return {
    list,
    appear(cabin, now) {
      const v = list.find((x) => x.cabin === cabin);
      if (!v || v.state !== 'inside') return;
      v.state = 'stepping';
      v.t = 0;
      v.root.visible = true;
      v.root.position.copy(inside);
      v.greetAt = now + 1.6;
    },
    react(v, now) {
      v.hop = 1;
      say(v, ['Hey! Brrr!', 'Ha! Right on the nose!', 'Oh, it’s ON now.'][Math.floor(Math.random() * 3)], now, 2.5);
    },
    update(dt, t, playerPos, camera, hidden) {
      for (const v of list) {
        if (v.state === 'inside') continue;
        v.t += dt;
        if (v.state === 'stepping') {
          const k = Math.min(1, v.t / 1.4);
          v.root.position.lerpVectors(inside, porch, k * k * (3 - 2 * k));
          v.body.position.y = Math.abs(Math.sin(v.t * 9)) * 0.12;
          if (k >= 1) {
            v.state = 'porch';
            v.cabin.group.localToWorld(v.world.copy(porch));
            colliders.push({ x: v.world.x, z: v.world.z, r: 0.9, br: 0.7, top: 3 });
          }
        }
        if (v.state === 'porch' && v.greetAt && t > v.greetAt) {
          v.greetAt = 0;
          say(v, v.spec.lines[0], t);
          v.line = 1;
        }
        v.cabin.group.localToWorld(v.world.copy(v.root.position));
        const d = Math.hypot(playerPos.x - v.world.x, playerPos.z - v.world.z);
        // turn to face Steph when she's close
        let targetYaw = 0;
        if (d < 14) {
          tmp.copy(playerPos);
          v.cabin.group.worldToLocal(tmp);
          targetYaw = Math.atan2(tmp.x - v.root.position.x, tmp.z - v.root.position.z);
        }
        let dy = targetYaw - v.root.rotation.y;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        v.root.rotation.y += dy * (1 - Math.exp(-dt * 4));
        // idle bob, wave, hop
        v.hop = Math.max(0, v.hop - dt * 1.8);
        if (v.state === 'porch') v.body.position.y = Math.sin(t * 2 + v.cabin.index) * 0.03 + Math.sin(v.hop * Math.PI) * 0.6;
        const waving = d < 10 || (speaker === v && t < speakerUntil);
        const snowman = v.spec.kind === 'snowman';
        const armTarget = waving ? (snowman ? -0.55 : 2.4) + Math.sin(t * 9) * 0.38 : snowman ? -0.9 : -0.25;
        v.parts.armL.rotation.z += (armTarget - v.parts.armL.rotation.z) * (1 - Math.exp(-dt * 8));
        v.parts.head.rotation.z = Math.sin(t * 1.3 + v.cabin.index) * 0.08;
        if (v.parts.tail) v.parts.tail.rotation.z = Math.sin(t * 3) * 0.3;
        // chat when Steph walks up
        if (v.state === 'porch' && d < 7 && !v.talking) {
          v.talking = true;
          say(v, v.spec.lines[v.line % v.spec.lines.length], t, 6);
          v.line += 1;
        } else if (d > 11) {
          v.talking = false;
        }
      }
      // keep the speech bubble over the speaker's head
      if (speaker && t < speakerUntil && !hidden) {
        speaker.cabin.group.localToWorld(tmp.copy(speaker.root.position).add(new THREE.Vector3(0, 3.3, 0)));
        tmp.project(camera);
        const onScreen = tmp.z < 1 && Math.abs(tmp.x) < 1.1 && Math.abs(tmp.y) < 1.1;
        bubble.style.left = `${((tmp.x + 1) / 2) * window.innerWidth}px`;
        bubble.style.top = `${((1 - tmp.y) / 2) * window.innerHeight}px`;
        bubble.classList.toggle('show', onScreen);
      } else {
        bubble.classList.remove('show');
      }
    },
  };
}
