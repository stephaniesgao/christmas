const MUSIC_SRC = '../src/client/audio/christmas-background-music-436117.mp3';

let ctx;
let master;
let music;
let musicOn = false;

function ac() {
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    ctx = new C();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function bell(freq, when = 0, dur = 1.2, vol = 0.18) {
  const c = ac();
  if (!c) return;
  const t = c.currentTime + when;
  [1, 2.01, 3.03].forEach((mult, i) => {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = i === 0 ? 'sine' : 'triangle';
    o.frequency.value = freq * mult;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol / (i + 1), t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur / (i + 1));
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur);
  });
}

export const sfx = {
  unlock: () => ac(),
  pickup(index) {
    // rising scale as the strand fills
    const scale = [0, 2, 4, 5, 7, 9, 11, 12];
    bell(880 * Math.pow(2, scale[index % 8] / 12), 0, 0.5, 0.1);
  },
  throw() {
    // quick rising whoosh-y glide
    const c = ac();
    if (!c) return;
    const t = c.currentTime;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(330, t);
    o.frequency.exponentialRampToValueAtTime(990, t + 0.35);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 0.45);
  },
  hook() {
    bell(659, 0, 0.4, 0.1);
  },
  hang() {
    [523, 659, 784, 1047].forEach((f, i) => bell(f, i * 0.07, 1.1, 0.12));
  },
  cabinDone() {
    [523, 659, 784, 1047, 1319].forEach((f, i) => bell(f, i * 0.12, 1.6, 0.14));
  },
  finale() {
    [392, 523, 659, 784, 1047, 784, 1047, 1319, 1568].forEach((f, i) => bell(f, i * 0.16, 2, 0.13));
  },
  error() {
    bell(220, 0, 0.3, 0.08);
  },
};

export function setMusic(on) {
  if (!music) {
    music = new Audio(MUSIC_SRC);
    music.loop = true;
    music.volume = 0.3;
  }
  musicOn = on;
  if (on) music.play().catch(() => {});
  else music.pause();
  return musicOn;
}

export function isMusicOn() {
  return musicOn;
}
