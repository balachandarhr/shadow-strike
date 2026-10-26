// SHADOW STRIKE – World Warfare (web demo). Fictional arcade combat. Three.js r186, no build step.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

const V3 = THREE.Vector3;
const $ = (id) => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------- platform / quality
const isTouch = (matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0) && ('ontouchstart' in window);
if (isTouch) document.body.classList.add('touch');
const Q = isTouch
  ? { prMax: Math.min(devicePixelRatio, 1.5), shadow: 1024, maxAlive: 40, particles: 1600, enemyShadows: false, lights: 2, antialias: false }
  : { prMax: Math.min(devicePixelRatio, 2), shadow: 2048, maxAlive: 130, particles: 3600, enemyShadows: true, lights: 4, antialias: true };
Q.pr = Q.prMax; Q.baseAlive = Q.maxAlive;
// graphics presets (Low disables all heavy passes)
const PRESETS = {
  low: { env: false, pr: isTouch ? 1.25 : 1.25, shadow: 1024, shadows: true, post: false, bloomRes: 0.5, fxaa: false, ca: 0, fx: 0.5, shafts: false, lights: 1, alive: isTouch ? 36 : 100 },
  medium: { env: true, pr: isTouch ? 1.25 : 1.5, shadow: isTouch ? 1024 : 2048, shadows: true, post: true, bloomRes: 0.5, fxaa: true, ca: 0.0012, fx: 0.75, shafts: true, lights: 2, alive: isTouch ? 40 : 120 },
  high: { env: true, pr: 2, shadow: 2048, shadows: true, post: true, bloomRes: 1, fxaa: true, ca: 0.0022, fx: 1, shafts: true, lights: 4, alive: isTouch ? 48 : 130 },
};
const QORDER = ['low', 'medium', 'high'];
// settings
const SET_KEY = 'shadowstrike_settings_v1';
const settings = Object.assign({ quality: 'auto', sens: 1, smooth: isTouch ? 0.45 : 0.15, autoFire: true, assist: true, haptic: true, invert: false, fps: false },
  (() => { try { return JSON.parse(localStorage.getItem(SET_KEY) || '{}'); } catch (e) { return {}; } })());
function persistSettings() { try { localStorage.setItem(SET_KEY, JSON.stringify(settings)); } catch (e) { /* private mode */ } }
const URLQ = (location.search.match(/[?&]q=(low|medium|high)/) || [])[1];
function autoLevel() { return isTouch ? 'low' : 'high'; }
let qDowngrades = 0;
let lastBuzz = 0;
function buzz(ms, force) {
  if (!isTouch || !settings.haptic || !navigator.vibrate) return;
  const n = performance.now(); if (!force && n - lastBuzz < 70) return; lastBuzz = n;
  try { navigator.vibrate(ms); } catch (e) { /* unsupported */ }
}

// ---------------------------------------------------------------- save
const SAVE_KEY = 'shadowstrike_save_v1';
const save = Object.assign({ unlocked: 1, coins: 0, dmg: 0, rel: 0, armor: 0, drone: false, best: 0, cleared: {} },
  (() => { try { return JSON.parse(localStorage.getItem(SAVE_KEY) || '{}'); } catch (e) { return {}; } })());
function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* private mode */ } }

// ---------------------------------------------------------------- audio (generated WebAudio)
const Sfx = {
  ctx: null, master: null, noise: null, last: {},
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    try { this.ctx = new AC(); } catch (e) { return; }
    this.master = this.ctx.createGain(); this.master.gain.value = 0.45;
    const comp = this.ctx.createDynamicsCompressor(); this.master.connect(comp); comp.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 2, b = this.ctx.createBuffer(1, len, this.ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = b;
  },
  ok(k, ms) { if (!this.ctx) return false; const n = performance.now(); if (this.last[k] && n - this.last[k] < ms) return false; this.last[k] = n; return true; },
  nz(dur, freq, q, vol, type = 'lowpass', to = 0) {
    const c = this.ctx, t = c.currentTime, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noise; f.type = type; f.frequency.setValueAtTime(freq, t); if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
    f.Q.value = q; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  },
  tn(freq, dur, vol, type = 'square', to = 0, delay = 0) {
    const c = this.ctx, t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t); if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  },
  shot(w) {
    if (w === 0) { if (!this.ok('mg', 50)) return; this.nz(0.1, 3000, 0.8, 0.35, 'lowpass', 300); this.tn(150, 0.05, 0.12, 'square', 60); }
    else if (w === 1) { if (!this.ok('rf', 100)) return; this.nz(0.3, 4000, 0.7, 0.55, 'lowpass', 200); this.tn(110, 0.12, 0.25, 'sawtooth', 40); }
    else if (w === 2) { if (!this.ok('rk', 100)) return; this.nz(0.7, 600, 1.2, 0.45, 'bandpass', 2500); this.tn(200, 0.3, 0.1, 'sawtooth', 80); }
    else if (w === 3) { if (!this.ok('dr', 90)) return; this.tn(1200, 0.05, 0.05, 'square', 500); }
  },
  boom(big) { if (!this.ok('boom', 55)) return; this.nz(big ? 1.6 : 1.0, 1000, 0.5, big ? 1 : 0.7, 'lowpass', 35); this.tn(70, 0.6, 0.45, 'sine', 25); },
  enemyShot() { if (!this.ok('es', 65)) return; this.nz(0.08, 1600, 1, 0.07, 'bandpass', 500); },
  hit(kill) { if (!this.ok('hit', 35)) return; this.tn(kill ? 900 : 1500, kill ? 0.12 : 0.04, 0.08, 'square', kill ? 400 : 1000); },
  hurt() { if (!this.ok('hurt', 160)) return; this.tn(170, 0.16, 0.2, 'sawtooth', 80); },
  reload() { if (!this.ctx) return; this.tn(500, 0.05, 0.1, 'square'); this.tn(850, 0.05, 0.1, 'square', 0, 0.2); },
  ui() { if (!this.ctx) return; this.tn(700, 0.07, 0.08, 'triangle', 1100); },
  coin() { if (!this.ok('coin', 60)) return; this.tn(1300, 0.08, 0.06, 'triangle', 1800); },
  alarm() { if (!this.ctx) return; for (let i = 0; i < 3; i++) this.tn(420, 0.3, 0.12, 'sawtooth', 840, i * 0.4); },
  jet() { if (!this.ctx) return; this.nz(2.2, 300, 0.6, 0.5, 'bandpass', 2400); },
  shield() { if (!this.ctx) return; this.tn(300, 0.5, 0.15, 'sine', 900); },
  dash() { if (!this.ok('dash', 120)) return; this.nz(0.25, 800, 1, 0.35, 'bandpass', 3000); this.tn(300, 0.15, 0.06, 'sine', 900); },
  jump() { if (!this.ctx) return; this.tn(220, 0.12, 0.06, 'sine', 420); },
  combo(n) { if (!this.ctx) return; for (let i = 0; i < Math.min(n, 5); i++) this.tn(600 + i * 180, 0.09, 0.07, 'triangle', 0, i * 0.05); },
  win() { if (!this.ctx) return; [523, 659, 784, 1046].forEach((f, i) => this.tn(f, 0.25, 0.12, 'triangle', 0, i * 0.12)); },
  lose() { if (!this.ctx) return; [400, 300, 200].forEach((f, i) => this.tn(f, 0.4, 0.15, 'sawtooth', 0, i * 0.25)); },
};

// ---------------------------------------------------------------- renderer / scene
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: Q.antialias, powerPreference: 'high-performance' });
renderer.setPixelRatio(Q.pr);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(66, innerWidth / innerHeight, 0.1, 500);
scene.fog = new THREE.Fog(0xcdb898, 45, 230);

// post-processing chain: render -> bloom -> output (tone map + sRGB) -> grade (vignette / chromatic aberration / motion / grain) -> FXAA
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
const bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.65, 0.35, 2.0);
{ const bs = bloomPass.setSize.bind(bloomPass); bloomPass.setSize = (w, h) => bs(Math.max(64, Math.round(w * (Q.bloomRes || 0.5))), Math.max(64, Math.round(h * (Q.bloomRes || 0.5)))); }
const outputPass = new OutputPass();
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uVig: { value: 1 }, uCA: { value: 0.0015 }, uMotion: { value: 0 }, uHurt: { value: 0 }, uGrain: { value: 0.035 }, uShield: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, uVig, uCA, uMotion, uHurt, uGrain, uShield; varying vec2 vUv;
float h21(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  vec2 d = vUv - 0.5; float r = length(d);
  float ca = uCA * (0.35 + r * 2.0) + uMotion * 0.006;
  vec3 col;
  if (uMotion > 0.02) {
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 6; i++) { float s = 1.0 - float(i) * 0.014 * uMotion; vec2 u = 0.5 + d * s;
      acc += vec3(texture2D(tDiffuse, u + d * ca).r, texture2D(tDiffuse, u).g, texture2D(tDiffuse, u - d * ca).b); }
    col = acc / 6.0;
  } else col = vec3(texture2D(tDiffuse, vUv + d * ca).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - d * ca).b);
  float v = smoothstep(0.95, 0.3, r * uVig); col *= mix(0.5, 1.0, v);
  col = mix(col, col * vec3(1.35, 0.45, 0.5) + vec3(0.08, 0.0, 0.0), uHurt * smoothstep(0.25, 0.75, r));
  col = mix(col, col * vec3(0.7, 1.05, 1.35), uShield * smoothstep(0.3, 0.8, r) * 0.6);
  col += (h21(vUv * 1024.0 + fract(uTime) * 61.0) - 0.5) * uGrain;
  gl_FragColor = vec4(col, 1.0);
}`,
};
const gradePass = new ShaderPass(GradeShader);
const fxaaPass = new ShaderPass(FXAAShader);
composer.addPass(renderPass); composer.addPass(bloomPass); composer.addPass(outputPass); composer.addPass(gradePass); composer.addPass(fxaaPass);
const HDR = (hex, k) => new THREE.Color(hex).multiplyScalar(k);
const neon = (hex, k = 3) => new THREE.MeshBasicMaterial({ color: HDR(hex, k), toneMapped: false });
const NEON = { c: neon(0x29f0ff, 4.5), m: neon(0xff2bd6, 4.5), r: neon(0xff2848, 5), a: neon(0xffc94a, 3.5), cDim: neon(0x29f0ff, 2) };

function gradTex(stops) {
  const c = document.createElement('canvas'); c.width = 4; c.height = 256;
  const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
  stops.forEach(([p, col]) => gr.addColorStop(p, col)); g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const THEMES = [
  { name: 'DAY', sky: gradTex([[0, '#4f86c6'], [0.55, '#a9c6e0'], [1, '#e6d3b3']]), fog: 0xd8c9ad, sun: 0xfff1d6, sunI: 2.6, hemiS: 0xdfeaff, hemiG: 0x6e5a3c, hemiI: 1.1, sunPos: [40, 70, 25] },
  { name: 'DUSK', sky: gradTex([[0, '#2a2f5c'], [0.5, '#c4626a'], [0.8, '#f2a25a'], [1, '#f6c27a']]), fog: 0xd9946a, sun: 0xffb070, sunI: 2.4, hemiS: 0xffc8a0, hemiG: 0x4a3328, hemiI: 0.9, sunPos: [-60, 30, 30] },
  { name: 'OVERCAST', sky: gradTex([[0, '#59636d'], [0.6, '#98a3ab'], [1, '#b9bdb8']]), fog: 0xa9aeb0, sun: 0xe8eef5, sunI: 1.6, hemiS: 0xd0d8e0, hemiG: 0x55524a, hemiI: 1.3, sunPos: [20, 80, -30] },
  { name: 'NIGHT OPS', sky: gradTex([[0, '#05070f'], [0.6, '#1b1630'], [0.9, '#5a1f1f'], [1, '#8a3320']]), fog: 0x2a1c22, sun: 0x8fa8ff, sunI: 1.2, hemiS: 0x5060a0, hemiG: 0x2a1a14, hemiI: 0.7, sunPos: [30, 60, -40] },
];

const hemi = new THREE.HemisphereLight(0xdfeaff, 0x6e5a3c, 1.1); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1d6, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(Q.shadow, Q.shadow);
const sc = sun.shadow.camera; sc.left = -75; sc.right = 75; sc.top = 75; sc.bottom = -75; sc.near = 1; sc.far = 260;
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
scene.add(sun); scene.add(sun.target);
const sunDir = new V3();
const pmrem = new THREE.PMREMGenerator(renderer);
const envCache = [];
function envFor(i) {
  if (envCache[i]) return envCache[i];
  const t = THEMES[i], es = new THREE.Scene();
  es.add(new THREE.Mesh(new THREE.SphereGeometry(50, 24, 12), new THREE.MeshBasicMaterial({ map: t.sky, side: THREE.BackSide })));
  const g = new THREE.Mesh(new THREE.CircleGeometry(50, 24), new THREE.MeshBasicMaterial({ color: t.hemiG })); g.rotation.x = -Math.PI / 2; g.position.y = -2; es.add(g);
  const s = new THREE.Mesh(new THREE.SphereGeometry(4, 12, 8), new THREE.MeshBasicMaterial({ color: HDR(t.sun, 6) })); s.position.set(...t.sunPos).normalize().multiplyScalar(40); es.add(s);
  for (const [c, a] of [[0x29f0ff, 0], [0xff2bd6, 2.1], [0x29f0ff, 4.2]]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(20, 3), new THREE.MeshBasicMaterial({ color: HDR(c, 0.9), side: THREE.DoubleSide })); p.position.set(Math.sin(a) * 40, 6, Math.cos(a) * 40); p.lookAt(0, 6, 0); es.add(p); }
  envCache[i] = pmrem.fromScene(es, 0.04).texture;
  return envCache[i];
}
let curTheme = 0;
function setTheme(i) {
  const t = THEMES[i % THEMES.length];
  curTheme = i; scene.background = t.sky; scene.environment = Q.env === false ? null : envFor(i % THEMES.length); scene.environmentIntensity = i === 3 ? 0.4 : 0.5;
  if (typeof shafts !== 'undefined') shafts.forEach((s) => s.material.color.setHex(i === 3 ? 0x6080ff : t.sun)); scene.fog.color.setHex(t.fog);
  sun.color.setHex(t.sun); sun.intensity = t.sunI; sun.position.set(...t.sunPos).normalize().multiplyScalar(120);
  hemi.color.setHex(t.hemiS); hemi.groundColor.setHex(t.hemiG); hemi.intensity = t.hemiI * (Q.env === false ? 1.15 : 0.5);
  baseLight.intensity = i === 3 ? 30 : 0;
  sunDir.copy(sun.position);
}

// ---------------------------------------------------------------- textures / materials
function canvasTex(size, draw, rep = 1) {
  const c = document.createElement('canvas'); c.width = c.height = size; draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rep, rep); t.anisotropy = 4; return t;
}
const groundTex = canvasTex(512, (g, s) => {
  g.fillStyle = '#9c8a68'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 9000; i++) { const v = rand(-30, 30); g.fillStyle = `rgba(${120 + v},${105 + v},${78 + v},0.35)`; g.fillRect(Math.random() * s, Math.random() * s, rand(1, 4), rand(1, 4)); }
  for (let i = 0; i < 30; i++) { g.fillStyle = 'rgba(70,60,40,0.10)'; g.beginPath(); g.arc(Math.random() * s, Math.random() * s, rand(10, 60), 0, 7); g.fill(); }
  g.strokeStyle = 'rgba(60,50,35,0.25)'; g.lineWidth = 2; g.strokeRect(0, 0, s, s);
}, 36);
const crateTex = canvasTex(256, (g, s) => {
  g.fillStyle = '#6b5a35'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 6; i++) { g.fillStyle = i % 2 ? '#75633c' : '#665531'; g.fillRect(0, i * s / 6, s, s / 6 - 3); }
  g.strokeStyle = '#3e3320'; g.lineWidth = 14; g.strokeRect(7, 7, s - 14, s - 14);
  g.beginPath(); g.moveTo(10, 10); g.lineTo(s - 10, s - 10); g.stroke();
  g.fillStyle = 'rgba(0,0,0,.25)'; g.font = 'bold 40px Arial'; g.fillText('S-7', s * 0.55, s * 0.32);
});
const concreteTex = canvasTex(256, (g, s) => {
  g.fillStyle = '#8d8d86'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 4000; i++) { const v = rand(-25, 25); g.fillStyle = `rgba(${140 + v},${140 + v},${132 + v},.4)`; g.fillRect(Math.random() * s, Math.random() * s, 2, 2); }
  g.fillStyle = '#d8b030'; for (let i = 0; i < 8; i++) { g.save(); g.translate(i * 40 - 20, s - 34); g.transform(1, 0, -1, 1, 0, 0); g.fillRect(0, 0, 20, 34); g.restore(); }
  g.fillStyle = '#2b2b2b'; for (let i = 0; i < 8; i++) { g.save(); g.translate(i * 40, s - 34); g.transform(1, 0, -1, 1, 0, 0); g.fillRect(0, 0, 20, 34); g.restore(); }
});
const wallTex = canvasTex(256, (g, s) => {
  g.fillStyle = '#7d7a70'; g.fillRect(0, 0, s, s);
  g.strokeStyle = 'rgba(40,40,35,.5)'; g.lineWidth = 3; for (let x = 0; x <= s; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, s); g.stroke(); }
  for (let i = 0; i < 3000; i++) { const v = rand(-25, 25); g.fillStyle = `rgba(${120 + v},${118 + v},${108 + v},.4)`; g.fillRect(Math.random() * s, Math.random() * s, 2, 2); }
});
wallTex.repeat.set(12, 1);
const scorchTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 4, 64, 64, 64); gr.addColorStop(0, 'rgba(10,8,6,.9)'); gr.addColorStop(0.6, 'rgba(20,15,10,.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c);
})();

const std = (color, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.8, metalness: 0.05 }, o));
const M = {
  ground: std(0xffffff, { map: groundTex, roughness: 0.86, metalness: 0.08 }),
  crate: std(0xffffff, { map: crateTex }),
  concrete: std(0xffffff, { map: concreteTex, roughness: 0.95 }),
  wall: std(0xffffff, { map: wallTex, roughness: 0.95 }),
  metal: std(0x6f7a82, { metalness: 0.6, roughness: 0.4 }),
  darkMetal: std(0x3a4047, { metalness: 0.55, roughness: 0.42 }),
  sand: std(0xa38f63, { roughness: 1 }),
  barrel: std(0xb3261e, { metalness: 0.3, roughness: 0.5 }),
  hq: std(0x5d6b4c, { roughness: 0.7 }), hqDark: std(0x3d4734, { roughness: 0.7 }),
  glass: std(0x3fb3ff, { emissive: 0x29d0ff, emissiveIntensity: 2.2, roughness: 0.1, metalness: 0.6 }),
  pad: std(0x161c26, { metalness: 0.75, roughness: 0.28 }),
  pOlive: std(0x4d5c36), pVest: std(0x8b7a52), pSkin: std(0xc69468), pDark: std(0x2a2e33, { metalness: 0.25, roughness: 0.55 }),
  eUni: std(0x2e2a2c), eRed: std(0x7a1d18), eSkin: std(0x8a6a50), eVisor: neon(0xff2a10, 4),
  hUni: std(0x3b2d22), hArmor: std(0x5a6068, { metalness: 0.3, roughness: 0.5 }),
  vBody: std(0x3e4630, { metalness: 0.3, roughness: 0.6 }), vTire: std(0x161616, { roughness: 0.9 }),
  boss: std(0x5d646e, { metalness: 0.6, roughness: 0.35 }), bossRed: std(0x8c1a12, { metalness: 0.5, roughness: 0.4, emissive: 0xff1020, emissiveIntensity: 1.2 }),
  flash: new THREE.MeshBasicMaterial({ color: 0xffffff }),
  heal: std(0x2fd060, { emissive: 0x2fff80, emissiveIntensity: 2.5 }),
  mountain: std(0x7a6a52, { roughness: 1, flatShading: true }),
};
const G = { box: new THREE.BoxGeometry(1, 1, 1), sph: new THREE.SphereGeometry(1, 14, 10), cyl: new THREE.CylinderGeometry(1, 1, 1, 14) };
function part(geo, mat, sx, sy, sz, x, y, z, parent, cast = true) {
  const m = new THREE.Mesh(geo, mat); m.scale.set(sx, sy, sz); m.position.set(x, y, z); m.castShadow = cast; parent.add(m); return m;
}

// ---------------------------------------------------------------- world
const ARENA = 58;
const colliders = []; // {x,z,hx,hz,h}
const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), M.ground);
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

function addBlock(x, z, w, d, h, mat, collide = true) {
  const m = part(G.box, mat, w, h, d, x, h / 2, z, scene); m.receiveShadow = true;
  if (collide) colliders.push({ x, z, hx: w / 2, hz: d / 2, h });
  return m;
}
// command center (index 0 collider)
const base = new THREE.Group(); scene.add(base);
colliders.push({ x: 0, z: 0, hx: 4.5, hz: 4.5, h: 6, isBase: true });
part(G.box, M.hq, 9, 3.6, 9, 0, 1.8, 0, base).receiveShadow = true;
part(G.box, M.hqDark, 6, 2, 6, 0, 4.6, 0, base);
part(G.box, M.glass, 6.05, 0.5, 6.05, 0, 4.6, 0, base, false);
part(G.box, M.hqDark, 2.4, 2.2, 0.3, 0, 1.1, 4.55, base);
part(G.cyl, M.metal, 0.08, 4, 0.08, 2, 7.6, 2, base);
const dish = part(G.sph, M.metal, 1.1, 0.35, 1.1, -1.8, 6.1, -1.6, base); dish.rotation.z = 0.5;
const flag = part(G.box, M.eRed, 1.4, 0.8, 0.04, 2.7, 9, 2, base, false); flag.material = std(0x2f6fd0);
const baseLight = new THREE.PointLight(0x80c0ff, 0, 30, 1.5); baseLight.position.set(0, 7, 0); scene.add(baseLight);
const pad = new THREE.Mesh(new THREE.CylinderGeometry(11.5, 11.8, 0.08, 6), M.pad); pad.position.y = 0.04; pad.receiveShadow = true; scene.add(pad);
for (const [r0, r1, mat] of [[10.2, 10.4, NEON.cDim], [8.6, 8.72, NEON.cDim]]) { const rg = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 6, 1), mat); rg.rotation.x = -Math.PI / 2; rg.rotation.z = Math.PI / 6; rg.position.y = 0.09; scene.add(rg); }
for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + Math.PI / 6; part(G.box, NEON.m, 0.12, 0.02, 2.2, Math.sin(a) * 9.9, 0.1, Math.cos(a) * 9.9, scene, false).rotation.y = a; }
part(G.box, NEON.c, 9.06, 0.08, 0.08, 0, 3.62, 4.52, base, false); part(G.box, NEON.c, 9.06, 0.08, 0.08, 0, 3.62, -4.52, base, false);
part(G.box, NEON.c, 0.08, 0.08, 9.06, 4.52, 3.62, 0, base, false); part(G.box, NEON.c, 0.08, 0.08, 9.06, -4.52, 3.62, 0, base, false);
const holo = new THREE.Mesh(new THREE.TorusGeometry(3.6, 0.05, 6, 64), new THREE.MeshBasicMaterial({ color: HDR(0x29f0ff, 2.5), transparent: true, opacity: 0.8, toneMapped: false, depthWrite: false })); holo.position.y = 7.2; holo.rotation.x = Math.PI / 2; scene.add(holo);
const holo2 = holo.clone(); holo2.scale.setScalar(0.7); holo2.position.y = 8.2; scene.add(holo2);
const beamTex = (() => { const c = document.createElement('canvas'); c.width = 64; c.height = 256; const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.7, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,.9)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 256); const hg = g.createLinearGradient(0, 0, 64, 0); hg.addColorStop(0, 'rgba(0,0,0,1)'); hg.addColorStop(0.5, 'rgba(0,0,0,0)'); hg.addColorStop(1, 'rgba(0,0,0,1)'); g.globalCompositeOperation = 'destination-out'; g.fillStyle = hg; g.fillRect(0, 0, 64, 256); return new THREE.CanvasTexture(c); })();
const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.6, 26, 16, 1, true), new THREE.MeshBasicMaterial({ map: beamTex, color: HDR(0x29f0ff, 1.2), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false }));
beam.position.y = 13 + 5; beam.userData.deco = true; scene.add(beam);
// sandbag ring
for (let i = 0; i < 16; i++) { if (i === 4) continue; const a = (i / 16) * Math.PI * 2; const b = part(G.box, M.sand, 2.4, 0.9, 1, Math.sin(a) * 7.5, 0.45, Math.cos(a) * 7.5, scene); b.rotation.y = a; b.receiveShadow = true; }

// deterministic cover layout
let seed = 7; const srand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const coverSpots = [];
for (let tries = 0; coverSpots.length < 26 && tries < 600; tries++) {
  const a = srand() * Math.PI * 2, r = 13 + srand() * 38;
  const x = Math.sin(a) * r, z = Math.cos(a) * r;
  if (coverSpots.some((p) => Math.hypot(p.x - x, p.z - z) < 7)) continue;
  coverSpots.push({ x, z });
}
coverSpots.forEach((p, i) => {
  const k = i % 3;
  if (k === 0) { addBlock(p.x, p.z, 2.4, 2.4, 2.4, M.crate); if (i % 2) addBlock(p.x + 2.4, p.z, 2.4, 2.4, 1.6, M.crate); }
  else if (k === 1) { const horiz = i % 2; addBlock(p.x, p.z, horiz ? 5 : 1.1, horiz ? 1.1 : 5, 1.7, M.concrete); part(G.box, i % 4 === 1 ? NEON.c : NEON.m, horiz ? 5.02 : 0.06, 0.06, horiz ? 0.06 : 5.02, p.x + (horiz ? 0 : 0.56), 1.62, p.z + (horiz ? 0.56 : 0), scene, false); part(G.box, i % 4 === 1 ? NEON.c : NEON.m, horiz ? 5.02 : 0.06, 0.06, horiz ? 0.06 : 5.02, p.x - (horiz ? 0 : 0.56), 1.62, p.z - (horiz ? 0.56 : 0), scene, false); }
  else { addBlock(p.x, p.z, 3, 3, 3.2, M.metal); part(G.box, M.darkMetal, 3.1, 0.3, 3.1, p.x, 3.2, p.z, scene); for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) part(G.box, i % 2 ? NEON.c : NEON.m, 0.07, 3.0, 0.07, p.x + sx * 1.53, 1.6, p.z + sz * 1.53, scene, false); }
});
// perimeter walls + towers
for (const [x, z, w, d] of [[0, ARENA + 2, 124, 2], [0, -ARENA - 2, 124, 2], [ARENA + 2, 0, 2, 124], [-ARENA - 2, 0, 2, 124]]) {
  const m = part(G.box, M.wall, w, 5, d, x, 2.5, z, scene); m.receiveShadow = true;
  const ix = x === 0 ? 0 : -Math.sign(x) * 1.02, iz = z === 0 ? 0 : -Math.sign(z) * 1.02;
  part(G.box, NEON.c, w > 2 ? w : 0.05, 0.1, d > 2 ? d : 0.05, x + ix, 4.3, z + iz, scene, false);
  part(G.box, NEON.m, w > 2 ? w : 0.05, 0.05, d > 2 ? d : 0.05, x + ix, 0.5, z + iz, scene, false);
}
const beacons = [];
for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
  const g = new THREE.Group(); g.position.set(x * (ARENA + 1), 0, z * (ARENA + 1)); scene.add(g);
  for (const [lx, lz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) part(G.box, M.darkMetal, 0.3, 11, 0.3, lx * 1.4, 5.5, lz * 1.4, g);
  part(G.box, M.hqDark, 4, 2, 4, 0, 11.5, 0, g); part(G.box, M.darkMetal, 4.6, 0.3, 4.6, 0, 12.6, 0, g);
  part(G.box, NEON.c, 4.62, 0.06, 4.62, 0, 10.5, 0, g, false);
  const bm = new THREE.MeshBasicMaterial({ color: HDR(0xff2848, 4), toneMapped: false }); beacons.push(bm);
  part(G.sph, bm, 0.28, 0.28, 0.28, 0, 13.1, 0, g, false);
}
// explosive barrels (shootable)
const barrels = [];
for (let i = 0; i < 10; i++) {
  const a = i * 2.39 + 0.5, r = 18 + (i * 7) % 30;
  const x = Math.sin(a) * r, z = Math.cos(a) * r;
  if (colliders.some((c) => Math.abs(x - c.x) < c.hx + 1.5 && Math.abs(z - c.z) < c.hz + 1.5)) continue;
  const m = part(G.cyl, M.barrel, 0.55, 1.3, 0.55, x, 0.65, z, scene);
  barrels.push({ x, z, mesh: m, hp: 30, alive: true });
}
// distant mountains
for (let i = 0; i < 26; i++) {
  const a = (i / 26) * Math.PI * 2 + rand(-0.1, 0.1), r = rand(170, 220), h = rand(25, 60);
  const m = new THREE.Mesh(new THREE.ConeGeometry(rand(30, 50), h, 6), M.mountain);
  m.position.set(Math.sin(a) * r, h / 2 - 2, Math.cos(a) * r); m.rotation.y = rand(0, 3); scene.add(m);
}
const SPAWNS = []; for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + Math.PI / 8; SPAWNS.push([Math.sin(a) * 54, Math.cos(a) * 54]); }
const gates = [];
const gateMat = new THREE.MeshBasicMaterial({ color: HDR(0xff2848, 2.6), toneMapped: false, transparent: true, opacity: 0.9 });
const gateDisc = new THREE.MeshBasicMaterial({ color: HDR(0xff2848, 1.5), transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
for (const [x, z] of SPAWNS) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.lookAt(0, 0, 0); scene.add(g);
  const t = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.09, 6, 40, Math.PI), gateMat); t.position.y = 0.05; g.add(t);
  const d = new THREE.Mesh(new THREE.CircleGeometry(3.2, 32), gateDisc); d.userData.deco = true; d.rotation.x = -Math.PI / 2; d.position.y = 0.06; g.add(d);
  gates.push(g);
}
// volumetric-looking light shafts (additive gradient cards aligned with the sun)
const shaftTex = (() => { const c = document.createElement('canvas'); c.width = 64; c.height = 256; const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.35, 'rgba(255,255,255,.7)'); gr.addColorStop(0.8, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 256); g.globalCompositeOperation = 'destination-in'; const hg = g.createLinearGradient(0, 0, 64, 0); hg.addColorStop(0, 'rgba(0,0,0,0)'); hg.addColorStop(0.5, 'rgba(0,0,0,1)'); hg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = hg; g.fillRect(0, 0, 64, 256);
  return new THREE.CanvasTexture(c); })();
const shafts = [];
for (let i = 0; i < 7; i++) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: shaftTex, color: 0xfff1d6, transparent: true, opacity: 0.075, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  m.userData.off = new V3(rand(-30, 30), 0, rand(-30, 30)); m.userData.w = rand(3, 8); m.renderOrder = 4; m.frustumCulled = false; scene.add(m); shafts.push(m);
}
const _sy = new V3(), _sz = new V3(), _sx = new V3(), _sm = new THREE.Matrix4();
function updateShafts(cx, cz) {
  if (!shafts[0].visible) return;
  _sy.copy(sunDir).normalize();
  for (const s of shafts) {
    const L = 70; s.position.set(cx + s.userData.off.x, 0, cz + s.userData.off.z).addScaledVector(_sy, L * 0.5);
    _sz.subVectors(camera.position, s.position); _sz.addScaledVector(_sy, -_sz.dot(_sy)).normalize(); _sx.crossVectors(_sy, _sz);
    _sm.makeBasis(_sx, _sy, _sz); s.quaternion.setFromRotationMatrix(_sm); s.scale.set(s.userData.w, L, 1);
  }
}

// ---------------------------------------------------------------- collision helpers
function pushOut(p, r, skipBase = false) {
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i]; if (skipBase && c.isBase) continue;
    const cx = clamp(p.x, c.x - c.hx, c.x + c.hx), cz = clamp(p.z, c.z - c.hz, c.z + c.hz);
    const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    if (d2 > 1e-6) { const d = Math.sqrt(d2); p.x = cx + (dx / d) * r; p.z = cz + (dz / d) * r; }
    else {
      const o1 = p.x - (c.x - c.hx), o2 = c.x + c.hx - p.x, o3 = p.z - (c.z - c.hz), o4 = c.z + c.hz - p.z, m = Math.min(o1, o2, o3, o4);
      if (m === o1) p.x = c.x - c.hx - r; else if (m === o2) p.x = c.x + c.hx + r; else if (m === o3) p.z = c.z - c.hz - r; else p.z = c.z + c.hz + r;
    }
  }
  for (let i = 0; i < barrels.length; i++) {
    const b = barrels[i]; if (!b.alive) continue; const dx = p.x - b.x, dz = p.z - b.z, d = Math.hypot(dx, dz), m = r + 0.55;
    if (d < m && d > 1e-4) { p.x = b.x + dx / d * m; p.z = b.z + dz / d * m; }
  }
  p.x = clamp(p.x, -ARENA + r, ARENA - r); p.z = clamp(p.z, -ARENA + r, ARENA - r);
}
function pointInBox(p) {
  for (const c of colliders) if (p.y < c.h && Math.abs(p.x - c.x) < c.hx && Math.abs(p.z - c.z) < c.hz) return c;
  return null;
}
function camBlocked(p) {
  if (pointInBox(p)) return true;
  for (const b of barrels) if (b.alive && p.y < 2.6 && Math.hypot(p.x - b.x, p.z - b.z) < 0.95) return true;
  return false;
}
function rayBox(o, d, c, maxT) {
  let tmin = 0, tmax = maxT;
  const mins = [c.x - c.hx, 0, c.z - c.hz], maxs = [c.x + c.hx, c.h, c.z + c.hz], os = [o.x, o.y, o.z], ds = [d.x, d.y, d.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(ds[i]) < 1e-8) { if (os[i] < mins[i] || os[i] > maxs[i]) return -1; continue; }
    let t1 = (mins[i] - os[i]) / ds[i], t2 = (maxs[i] - os[i]) / ds[i];
    if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
    if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) return -1;
  }
  return tmin;
}
function rayCyl(o, d, x, z, r, y0, h) {
  const ox = o.x - x, oz = o.z - z, a = d.x * d.x + d.z * d.z; if (a < 1e-8) return -1;
  const b = 2 * (ox * d.x + oz * d.z), c = ox * ox + oz * oz - r * r, disc = b * b - 4 * a * c; if (disc < 0) return -1;
  const s = Math.sqrt(disc); let t = (-b - s) / (2 * a); if (t < 0) t = (-b + s) / (2 * a); if (t < 0) return -1;
  const y = o.y + d.y * t; if (y < y0 || y > y0 + h) return -1; return t;
}
const _seg = new V3();
function lineOfSight(a, b, ignoreBase) {
  _seg.subVectors(b, a); const L = _seg.length(); _seg.divideScalar(L);
  for (const c of colliders) { if (ignoreBase && c.isBase) continue; const t = rayBox(a, _seg, c, L); if (t >= 0 && t < L - 0.3) return false; }
  return true;
}

// ---------------------------------------------------------------- particles
const PVS = `attribute float psize; attribute float palpha; attribute vec3 pcolor; uniform float uScale; uniform float uMax;
varying float vA; varying vec3 vC;
void main(){ vC = pcolor; vec4 mv = modelViewMatrix * vec4(position, 1.0); float z = max(0.1, -mv.z);
 vA = palpha * smoothstep(1.0, 4.5, z);
 gl_PointSize = min(psize * uScale / z, uMax); gl_Position = projectionMatrix * mv; }`;
const PFS = `varying float vA; varying vec3 vC; uniform float uBoost;
void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c); if (d > 0.5) discard;
 float a = smoothstep(0.5, 0.05, d) * vA; gl_FragColor = vec4(vC * uBoost, a); }`;
class Particles {
  constructor(max, additive) {
    this.max = max; this.i = 0;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3); this.size = new Float32Array(max); this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max); this.grow = new Float32Array(max); this.grav = new Float32Array(max); this.drag = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('psize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('palpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({ uniforms: { uScale: { value: 400 }, uMax: { value: 200 }, uBoost: { value: 1 } }, vertexShader: PVS, fragmentShader: PFS, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    this.pts = new THREE.Points(g, this.mat); this.pts.frustumCulled = false; this.pts.renderOrder = additive ? 3 : 2; scene.add(this.pts); this.geo = g; this.active = 0;
  }
  spawn(x, y, z, vx, vy, vz, life, size, grow, r, g, b, grav = 0, drag = 0) {
    const i = this.i; this.i = (this.i + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b;
    this.life[i] = this.maxLife[i] = life; this.s0[i] = size; this.grow[i] = grow; this.grav[i] = grav; this.drag[i] = drag;
  }
  update(dt) {
    let any = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { if (this.alpha[i] !== 0) { this.alpha[i] = 0; this.size[i] = 0; } continue; }
      any++;
      const l = (this.life[i] -= dt); const k = i * 3;
      if (l <= 0) { this.alpha[i] = 0; this.size[i] = 0; continue; }
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[k] *= dr; this.vel[k + 1] = this.vel[k + 1] * dr - this.grav[i] * dt; this.vel[k + 2] *= dr;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      if (this.pos[k + 1] < 0.05) { this.pos[k + 1] = 0.05; this.vel[k + 1] *= -0.3; }
      const t = l / this.maxLife[i];
      this.alpha[i] = Math.min(1, t * 1.6); this.size[i] = this.s0[i] + this.grow[i] * (1 - t);
    }
    if (any || this.active) {
      for (const n of ['position', 'pcolor', 'psize', 'palpha']) this.geo.attributes[n].needsUpdate = true;
    }
    this.active = any;
  }
}
const fire = new Particles(Math.floor(Q.particles * 0.6), true);
const smoke = new Particles(Math.floor(Q.particles * 0.4), false);

// tracers
const tracerGeo = new THREE.BoxGeometry(1, 1, 1); tracerGeo.translate(0, 0, 0.5);
const TM = [[0xffd27a, 3], [0xff3048, 3], [0x29f0ff, 3]].map(([c, k]) => new THREE.MeshBasicMaterial({ color: HDR(c, k), transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
const tracers = [];
for (let i = 0; i < 90; i++) { const m = new THREE.Mesh(tracerGeo, TM[0]); m.visible = false; scene.add(m); tracers.push({ m, life: 0 }); }
let tracerI = 0;
function tracer(a, b, kind = 0, w = 0.05) {
  const t = tracers[tracerI]; tracerI = (tracerI + 1) % tracers.length;
  t.m.material = TM[kind]; t.m.position.copy(a); t.m.lookAt(b); const L = a.distanceTo(b);
  t.m.scale.set(w, w, L); t.m.visible = true; t.life = 0.07;
}
// pooled point lights
const flashLights = [];
for (let i = 0; i < Q.lights; i++) { const l = new THREE.PointLight(0xffa040, 0, 26, 1.6); scene.add(l); flashLights.push({ l, life: 0, max: 1, peak: 0 }); }
let flI = 0;
function flashLight(p, peak, life, color = 0xffa040) {
  const f = flashLights[flI]; flI = (flI + 1) % Math.max(1, Math.min(flashLights.length, Q.lightsUse || flashLights.length));
  f.l.position.copy(p); f.l.position.y += 1.5; f.l.color.setHex(color); f.peak = peak; f.life = f.max = life;
}
// scorch decals
const decals = [];
const decalMat = new THREE.MeshBasicMaterial({ map: scorchTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
for (let i = 0; i < 28; i++) { const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), decalMat); m.rotation.x = -Math.PI / 2; m.visible = false; scene.add(m); decals.push(m); }
let decalI = 0;
function decal(x, z, r) { const m = decals[decalI]; decalI = (decalI + 1) % decals.length; m.position.set(x, 0.03 + decalI * 0.001, z); m.scale.set(r * 2, r * 2, 1); m.rotation.z = rand(0, 6); m.visible = true; }
// warning rings
const ringGeo = new THREE.RingGeometry(0.85, 1, 40); ringGeo.rotateX(-Math.PI / 2);
const rings = [];
for (let i = 0; i < 12; i++) { const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xff3020, transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false })); m.visible = false; scene.add(m); rings.push({ m, life: 0 }); }
function ring(x, z, r, life, color = 0xff3020) {
  const o = rings.find((q) => q.life <= 0) || rings[0];
  o.m.position.set(x, 0.08, z); o.m.scale.set(r, 1, r); o.m.material.color.setHex(color).multiplyScalar(2.5); o.life = life; o.m.visible = true; return o;
}
// shockwaves + fireball flashes + debris
const swGeo = new THREE.RingGeometry(0.7, 1, 48); swGeo.rotateX(-Math.PI / 2);
const waves = [];
for (let i = 0; i < 10; i++) { const m = new THREE.Mesh(swGeo, new THREE.MeshBasicMaterial({ color: HDR(0xffb060, 2.5), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide })); m.visible = false; scene.add(m); waves.push({ m, life: 0, max: 1, r: 1 }); }
const balls = [];
for (let i = 0; i < 8; i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), new THREE.MeshBasicMaterial({ color: HDR(0xffa040, 3), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })); m.visible = false; scene.add(m); balls.push({ m, life: 0, max: 1, r: 1 }); }
let waveI = 0, ballI = 0;
function shockwave(p, r, color = 0xffb060, life = 0.55) {
  const w = waves[waveI]; waveI = (waveI + 1) % waves.length; w.m.position.set(p.x, 0.15, p.z); w.m.material.color.setHex(color).multiplyScalar(2.5); w.life = w.max = life; w.r = r; w.m.visible = true;
  const b = balls[ballI]; ballI = (ballI + 1) % balls.length; b.m.position.set(p.x, Math.max(0.6, p.y), p.z); b.life = b.max = 0.28; b.r = r * 0.55; b.m.visible = true;
}
const DEBRIS = 140;
const debrisMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), std(0x3a3430, { roughness: 0.9 }), DEBRIS);
debrisMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); debrisMesh.frustumCulled = false; debrisMesh.castShadow = false; scene.add(debrisMesh);
const deb = []; for (let i = 0; i < DEBRIS; i++) deb.push({ p: new V3(0, -50, 0), v: new V3(), r: new THREE.Euler(), w: new V3(), s: 0.1, life: 0 });
let debI = 0; const _dq = new THREE.Quaternion(), _dm = new THREE.Matrix4(), _ds = new V3();
function debris(p, n, sp) {
  for (let i = 0; i < n; i++) { const d = deb[debI]; debI = (debI + 1) % DEBRIS; const a = rand(0, 6.283);
    d.p.set(p.x + rand(-0.5, 0.5), Math.max(0.3, p.y), p.z + rand(-0.5, 0.5)); d.v.set(Math.cos(a) * rand(2, sp), rand(4, sp * 1.4), Math.sin(a) * rand(2, sp)); d.w.set(rand(-12, 12), rand(-12, 12), rand(-12, 12)); d.s = rand(0.08, 0.28); d.life = rand(1.5, 2.6); }
}
function updateDebris(dt) {
  let any = false;
  for (let i = 0; i < DEBRIS; i++) { const d = deb[i];
    if (d.life <= 0) continue; any = true; d.life -= dt;
    d.v.y -= 22 * dt; d.p.addScaledVector(d.v, dt);
    if (d.p.y < d.s * 0.5) { d.p.y = d.s * 0.5; d.v.y *= -0.35; d.v.x *= 0.6; d.v.z *= 0.6; d.w.multiplyScalar(0.6); }
    d.r.x += d.w.x * dt; d.r.y += d.w.y * dt; d.r.z += d.w.z * dt;
    const s = d.life <= 0 ? 0 : d.s * Math.min(1, d.life * 2);
    _dq.setFromEuler(d.r); _ds.set(s, s, s); _dm.compose(d.p, _dq, _ds); debrisMesh.setMatrixAt(i, _dm);
  }
  if (any || debrisMesh.userData.any) debrisMesh.instanceMatrix.needsUpdate = true; debrisMesh.userData.any = any;
}
for (let i = 0; i < DEBRIS; i++) { _dm.makeScale(0, 0, 0); debrisMesh.setMatrixAt(i, _dm); }

let shake = 0;
function explosionFx(p, r, big) {
  const n = Math.round((big ? 80 : 46) * (isTouch ? 0.5 : 1) * (Q.fx || 1));
  shockwave(p, r * 1.6, big ? 0xffb060 : 0xff8040, big ? 0.6 : 0.45);
  debris(p, Math.round((big ? 14 : 7) * (Q.fx || 1)), big ? 9 : 6);
  for (let i = 0; i < n * 0.5; i++) fire.spawn(p.x, p.y + 0.4, p.z, rand(-18, 18), rand(4, 20), rand(-18, 18), rand(0.3, 0.9), rand(0.08, 0.16), 0, 1, rand(0.7, 0.95), 0.5, 26, 0.6);
  for (let i = 0; i < n; i++) {
    const a = rand(0, 6.283), e = rand(0.1, 1.4), s = rand(3, 13) * (r / 5);
    fire.spawn(p.x, p.y + 0.5, p.z, Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s, Math.sin(a) * Math.cos(e) * s, rand(0.3, 0.8), rand(1.2, 2.6) * (r / 5), rand(1, 3), 1, rand(0.45, 0.8), rand(0.1, 0.3), -1.5, 3);
  }
  for (let i = 0; i < n / 2; i++) {
    fire.spawn(p.x, p.y + 0.5, p.z, rand(-14, 14), rand(6, 18), rand(-14, 14), rand(0.5, 1.1), 0.25, 0, 1, 0.8, 0.4, 20, 0.5);
  }
  for (let i = 0; i < n * 0.6; i++) {
    const g = rand(0.12, 0.25);
    smoke.spawn(p.x + rand(-1, 1) * r * 0.4, p.y + rand(0.5, 2), p.z + rand(-1, 1) * r * 0.4, rand(-2, 2), rand(2, 6), rand(-2, 2), rand(1.2, 2.6), rand(1.5, 3) * (r / 5), rand(3, 6), g, g * 0.95, g * 0.9, -0.8, 1.2);
  }
  flashLight(p, big ? 60 : 38, 0.35);
  decal(p.x, p.z, r * 0.7);
  if (big) buzz(45);
  const d = camera.position.distanceTo(p); shake = Math.min(1.2, shake + (big ? 1.2 : 0.7) * clamp(1 - d / 60, 0, 1));
  Sfx.boom(big);
}
function impactFx(p, n, r, g, b) {
  for (let i = 0; i < n; i++) fire.spawn(p.x, p.y, p.z, rand(-6, 6), rand(1, 8), rand(-6, 6), rand(0.15, 0.4), rand(0.08, 0.18), 0, r, g, b, 22, 1);
  fire.spawn(p.x, p.y, p.z, 0, 0, 0, 0.06, 0.5, 0.4, r, g, b);
  smoke.spawn(p.x, p.y, p.z, rand(-0.5, 0.5), rand(0.5, 1.5), rand(-0.5, 0.5), 0.6, 0.6, 1.4, 0.55, 0.5, 0.42, 0, 1);
}

// ---------------------------------------------------------------- player
const player = {
  pos: new V3(0, 0, 12), vel: new V3(), yaw: Math.PI, pitch: 0.08, hp: 100, maxHp: 100, alive: true,
  weapon: 0, ammo: [40, 12, 4], reloading: 0, reloadTotal: 1, fireCd: 0, shieldT: 0, shieldCd: 0, airCd: 0, hurtT: 0, walk: 0, ads: false,
  y: 0, vy: 0, grounded: true, dashT: 0, dashCd: 0, dashX: 0, dashZ: 0, bloom: 0, sprinting: false,
};
const DASH_CD = 1.4;
const WEAPONS = [
  { name: 'M4 MACHINE GUN', short: 'MG', dmg: 14, rate: 0.085, mag: 40, reload: 1.7, spread: 0.02, shake: 0.05, recoil: 0.006 },
  { name: 'DMR RIFLE', short: 'RIFLE', dmg: 60, rate: 0.33, mag: 12, reload: 1.4, spread: 0.002, shake: 0.14, recoil: 0.025 },
  { name: 'ROCKET LAUNCHER', short: 'ROCKET', dmg: 190, splash: 6.5, rate: 0.9, mag: 4, reload: 2.4, spread: 0, shake: 0.25, recoil: 0.04, rocket: true },
];
const pm = new THREE.Group(); scene.add(pm);
const pLegL = new THREE.Group(), pLegR = new THREE.Group(); pLegL.position.set(-0.15, 0.85, 0); pLegR.position.set(0.15, 0.85, 0); pm.add(pLegL, pLegR);
part(G.box, M.pOlive, 0.24, 0.85, 0.28, 0, -0.42, 0, pLegL); part(G.box, M.pDark, 0.26, 0.15, 0.36, 0, -0.78, -0.04, pLegL);
part(G.box, M.pOlive, 0.24, 0.85, 0.28, 0, -0.42, 0, pLegR); part(G.box, M.pDark, 0.26, 0.15, 0.36, 0, -0.78, -0.04, pLegR);
part(G.box, M.pOlive, 0.58, 0.68, 0.34, 0, 1.2, 0, pm);
part(G.box, M.pVest, 0.62, 0.5, 0.4, 0, 1.22, 0, pm);
part(G.box, M.pOlive, 0.4, 0.5, 0.22, 0, 1.25, 0.3, pm); // backpack
part(G.sph, M.pSkin, 0.17, 0.19, 0.17, 0, 1.7, 0, pm);
part(G.sph, M.pOlive, 0.21, 0.13, 0.22, 0, 1.79, 0.01, pm);
part(G.box, NEON.c, 0.3, 0.05, 0.04, 0, 1.72, -0.175, pm, false);
part(G.box, NEON.cDim, 0.04, 0.4, 0.02, 0.12, 1.25, 0.415, pm, false); part(G.box, NEON.cDim, 0.04, 0.4, 0.02, -0.12, 1.25, 0.415, pm, false);
part(G.box, NEON.m, 0.64, 0.04, 0.42, 0, 1.0, 0, pm, false);
const pArmR = part(G.box, M.pOlive, 0.16, 0.16, 0.55, 0.3, 1.32, -0.25, pm);
part(G.box, M.pOlive, 0.16, 0.16, 0.55, -0.18, 1.3, -0.3, pm).rotation.y = -0.5;
const pGun = new THREE.Group(); pGun.position.set(0.2, 1.3, -0.5); pm.add(pGun);
const gunParts = [
  [part(G.box, M.pDark, 0.09, 0.14, 0.85, 0, 0, -0.2, pGun), part(G.box, M.pDark, 0.07, 0.2, 0.08, 0, -0.14, -0.05, pGun), part(G.box, NEON.c, 0.095, 0.02, 0.6, 0, 0.03, -0.25, pGun, false)],
  [part(G.box, M.metal, 0.08, 0.1, 1.2, 0, 0, -0.35, pGun), part(G.cyl, M.pDark, 0.05, 0.35, 0.05, 0, 0.11, -0.2, pGun), part(G.box, NEON.m, 0.085, 0.02, 0.9, 0, -0.04, -0.35, pGun, false)],
  [part(G.cyl, M.hqDark, 0.13, 1.3, 0.13, 0, 0.05, -0.2, pGun), part(G.box, M.pDark, 0.08, 0.2, 0.1, 0, -0.14, 0, pGun), part(G.cyl, NEON.a, 0.135, 0.06, 0.135, 0, 0.05, -0.75, pGun, false)],
];
gunParts[2][2].rotation.x = Math.PI / 2;
gunParts[2][0].rotation.x = Math.PI / 2;
const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.02, -0.9); pGun.add(muzzle);
const flashMesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), new THREE.MeshBasicMaterial({ color: HDR(0xffc060, 5), transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
flashMesh.scale.set(1, 1, 2.2); flashMesh.visible = false; muzzle.add(flashMesh);
const muzzleLight = new THREE.PointLight(0xffb050, 0, 12, 2); scene.add(muzzleLight);
const shieldMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1.3, 2), new THREE.MeshBasicMaterial({ color: HDR(0x29b8ff, 2.2), wireframe: true, transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
shieldMesh.add(new THREE.Mesh(new THREE.SphereGeometry(1.28, 24, 16), new THREE.MeshBasicMaterial({ color: 0x1a70c0, transparent: true, opacity: 0.08, depthWrite: false, toneMapped: false })));
shieldMesh.visible = false; scene.add(shieldMesh);
pm.traverse((o) => { if (o.isMesh) o.castShadow = true; });
function setWeapon(i) {
  if (i === player.weapon && game.state === 'play') return;
  player.weapon = i; player.reloading = 0; player.fireCd = 0.2;
  gunParts.forEach((g, k) => g.forEach((m) => (m.visible = k === i)));
  muzzle.position.z = i === 1 ? -1.0 : i === 2 ? -0.9 : -0.65;
  document.querySelectorAll('.tw').forEach((b) => b.classList.toggle('on', +b.dataset.w === i));
  buildPips(); Sfx.ui();
}

// drone
const drone = new THREE.Group(); scene.add(drone); drone.visible = false;
part(G.box, M.darkMetal, 0.5, 0.18, 0.5, 0, 0, 0, drone);
part(G.sph, NEON.c, 0.1, 0.1, 0.1, 0, -0.08, -0.25, drone); part(G.box, NEON.c, 0.52, 0.03, 0.03, 0, 0.0, 0.26, drone, false);
const rotors = [];
for (const [x, z] of [[0.38, 0.38], [-0.38, 0.38], [0.38, -0.38], [-0.38, -0.38]]) { part(G.cyl, M.metal, 0.04, 0.12, 0.04, x, 0.08, z, drone); rotors.push(part(G.box, M.pDark, 0.5, 0.02, 0.06, x, 0.15, z, drone)); }
const droneS = { cd: 0, pos: new V3() };

// ---------------------------------------------------------------- enemies
const ETYPES = {
  soldier: { hp: 40, speed: 3.6, range: 22, dmg: 2.4, rate: 1.4, r: 0.5, h: 1.85, coins: 2, score: 100 },
  heavy: { hp: 180, speed: 2.3, range: 17, dmg: 5.5, rate: 1.6, r: 0.75, h: 2.45, coins: 6, score: 250 },
  vehicle: { hp: 340, speed: 5.4, range: 26, dmg: 9, rate: 1.2, r: 1.7, h: 2.0, coins: 12, score: 500 },
  boss: { hp: 4200, speed: 2.0, range: 45, dmg: 16, rate: 1.7, r: 2.4, h: 6.2, coins: 250, score: 8000 },
};
function buildSoldier(heavy) {
  const g = new THREE.Group(); const S = heavy ? 1.32 : 1; const uni = heavy ? M.hUni : M.eUni;
  const inner = new THREE.Group(); inner.scale.setScalar(S); g.add(inner);
  const lL = new THREE.Group(), lR = new THREE.Group(); lL.position.set(-0.14, 0.85, 0); lR.position.set(0.14, 0.85, 0); inner.add(lL, lR);
  part(G.box, uni, 0.22, 0.85, 0.26, 0, -0.42, 0, lL); part(G.box, uni, 0.22, 0.85, 0.26, 0, -0.42, 0, lR);
  part(G.box, uni, 0.55, 0.66, 0.32, 0, 1.2, 0, inner);
  part(G.box, M.eRed, 0.57, 0.12, 0.34, 0, 1.0, 0, inner);
  part(G.sph, M.eSkin, 0.16, 0.18, 0.16, 0, 1.68, 0, inner);
  part(G.sph, heavy ? M.hArmor : M.darkMetal, 0.2, 0.13, 0.21, 0, 1.78, 0, inner);
  part(G.box, M.eVisor, 0.26, 0.05, 0.04, 0, 1.7, 0.16, inner, false);
  part(G.box, uni, 0.15, 0.15, 0.5, 0.3, 1.3, 0.22, inner); part(G.box, uni, 0.15, 0.15, 0.5, -0.2, 1.28, 0.25, inner).rotation.y = 0.5;
  part(G.box, M.pDark, heavy ? 0.16 : 0.08, heavy ? 0.18 : 0.1, heavy ? 1.0 : 0.75, 0.18, 1.3, 0.5, inner);
  if (heavy) { part(G.box, M.hArmor, 0.3, 0.2, 0.42, 0.38, 1.55, 0, inner); part(G.box, M.hArmor, 0.3, 0.2, 0.42, -0.38, 1.55, 0, inner); part(G.box, M.hArmor, 0.6, 0.5, 0.4, 0, 1.25, 0.02, inner); }
  return { g, legs: [lL, lR], muzzleY: 1.3 * S, muzzleZ: 0.9 * S };
}
function buildVehicle() {
  const g = new THREE.Group(); const inner = new THREE.Group(); g.add(inner);
  part(G.box, M.vBody, 2.2, 0.8, 3.6, 0, 0.9, 0, inner); part(G.box, M.vBody, 1.9, 0.7, 1.6, 0, 1.6, -0.5, inner);
  part(G.box, M.glass, 1.7, 0.4, 0.05, 0, 1.65, 0.31, inner, false); part(G.box, M.eRed, 2.25, 0.12, 3.65, 0, 0.75, 0, inner);
  const wheels = [];
  for (const [x, z] of [[1.05, 1.2], [-1.05, 1.2], [1.05, -1.2], [-1.05, -1.2]]) { const w = part(G.cyl, M.vTire, 0.48, 0.35, 0.48, x, 0.48, z, inner); w.rotation.z = Math.PI / 2; wheels.push(w); }
  const tur = new THREE.Group(); tur.position.set(0, 2.05, -0.4); inner.add(tur);
  part(G.cyl, M.darkMetal, 0.4, 0.35, 0.4, 0, 0, 0, tur); const b = part(G.cyl, M.darkMetal, 0.07, 1.4, 0.07, 0, 0.05, 0.7, tur); b.rotation.x = Math.PI / 2;
  return { g, wheels, tur, muzzleY: 2.1, muzzleZ: 1.4 };
}
function buildBoss() {
  const g = new THREE.Group(); const inner = new THREE.Group(); g.add(inner);
  const lL = new THREE.Group(), lR = new THREE.Group(); lL.position.set(-1.1, 3.0, 0); lR.position.set(1.1, 3.0, 0); inner.add(lL, lR);
  for (const l of [lL, lR]) { part(G.box, M.boss, 0.8, 3.0, 1.0, 0, -1.5, 0, l); part(G.box, M.darkMetal, 1.2, 0.4, 1.8, 0, -2.9, 0.2, l); }
  part(G.box, M.boss, 3.4, 2.2, 2.6, 0, 4.1, 0, inner); part(G.box, M.bossRed, 3.5, 0.3, 2.7, 0, 3.2, 0, inner);
  part(G.box, M.darkMetal, 1.4, 0.9, 1.2, 0, 5.5, 0.5, inner); part(G.box, M.eVisor, 1.0, 0.18, 0.05, 0, 5.55, 1.11, inner, false);
  for (const s of [-1, 1]) {
    part(G.box, M.boss, 0.9, 0.9, 1.2, s * 2.15, 4.6, 0, inner);
    const c = part(G.cyl, M.darkMetal, 0.32, 2.4, 0.32, s * 2.2, 4.1, 1.0, inner); c.rotation.x = Math.PI / 2;
    part(G.box, M.bossRed, 0.9, 0.7, 1.0, s * 1.2, 5.6, -0.8, inner);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { g, legs: [lL, lR], muzzleY: 4.1, muzzleZ: 2.3 };
}
// dissolve shader (world-space noise burn with glowing edge) for enemy deaths
const DIS_VS = (s) => 'varying vec3 vDP;\n' + s.replace('#include <begin_vertex>', '#include <begin_vertex>\n vDP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
const DIS_FS = (s) => `uniform float uDis; uniform vec3 uEdge; varying vec3 vDP;
float dH(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float dN(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
 return mix(mix(mix(dH(i), dH(i + vec3(1,0,0)), f.x), mix(dH(i + vec3(0,1,0)), dH(i + vec3(1,1,0)), f.x), f.y),
            mix(mix(dH(i + vec3(0,0,1)), dH(i + vec3(1,0,1)), f.x), mix(dH(i + vec3(0,1,1)), dH(i + vec3(1,1,1)), f.x), f.y), f.z); }
` + s.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
 float dn = dN(vDP * 3.2) * 0.65 + dN(vDP * 9.0) * 0.35; if (dn < uDis) discard; float dEdge = (1.0 - smoothstep(0.0, 0.08, dn - uDis)) * step(0.001, uDis);`)
  .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += uEdge * dEdge * 6.0;');
const disPool = [];
for (let i = 0; i < 28; i++) {
  const m = new THREE.MeshStandardMaterial({ color: 0x2b2c32, roughness: 0.55, metalness: 0.4 });
  m.userData.u = { uDis: { value: 0 }, uEdge: { value: new THREE.Color(1, 0.35, 0.08) } };
  m.onBeforeCompile = (sh) => { Object.assign(sh.uniforms, m.userData.u); sh.vertexShader = DIS_VS(sh.vertexShader); sh.fragmentShader = DIS_FS(sh.fragmentShader); };
  m.customProgramCacheKey = () => 'ss-dissolve'; m.userData.free = true; disPool.push(m);
}
function setDissolve(e) {
  const m = disPool.find((q) => q.userData.free); if (!m) return;
  m.userData.free = false; m.userData.u.uDis.value = 0; e.dmat = m;
  if (e.type === 'vehicle' || e.type === 'boss') m.userData.u.uEdge.value.setRGB(1, 0.45, 0.1); else m.userData.u.uEdge.value.setRGB(0.25, 0.9, 1);
  e.g.traverse((o) => { if (o.isMesh && o.userData.m) o.material = m; });
}
function clearDissolve(e) { if (!e.dmat) return; e.dmat.userData.free = true; e.dmat = null; e.g.traverse((o) => { if (o.isMesh && o.userData.m) o.material = o.userData.m; }); }
const pools = { soldier: [], heavy: [], vehicle: [] };
const enemies = [];
function makeEnemy(type) {
  const b = type === 'vehicle' ? buildVehicle() : type === 'boss' ? buildBoss() : buildSoldier(type === 'heavy');
  b.g.traverse((o) => { if (o.isMesh) { o.userData.m = o.material; if (type !== 'boss') o.castShadow = Q.enemyShadows && o.castShadow; } });
  b.g.visible = false; scene.add(b.g);
  return { type, ...b, pos: new V3(), vel: new V3(), hp: 1, maxHp: 1, dying: false, dieT: 0, cd: 0, flashT: 0, strafe: 1, strafeT: 0, phase: 1, t: 0, special: 0, special2: 0, stuckT: 0, dmat: null, kv: new V3(), spin: new V3(), dnT: 0, dnAcc: 0 };
}
function spawnEnemy(type, x, z, hpMul) {
  const e = type === 'boss' ? makeEnemy('boss') : (pools[type].pop() || makeEnemy(type));
  const T = ETYPES[type];
  e.pos.set(x, 0, z); e.vel.set(0, 0, 0); e.hp = e.maxHp = T.hp * hpMul; e.dying = false; e.dieT = 0; e.cd = rand(0.5, 2); e.flashT = 0;
  e.strafe = Math.random() < 0.5 ? -1 : 1; e.strafeT = rand(1, 3); e.t = rand(0, 10); e.phase = 1; e.special = 4; e.special2 = 8;
  e.g.visible = true; e.g.rotation.set(0, 0, 0); e.g.position.copy(e.pos); if (e.dmat) clearDissolve(e);
  enemies.push(e); return e;
}
function setFlash(e, on) { if (e.dmat) return; e.g.traverse((o) => { if (o.isMesh && o.userData.m) o.material = on ? M.flash : o.userData.m; }); }
function releaseEnemy(i) {
  const e = enemies[i]; e.g.visible = false; if (e.dmat) clearDissolve(e); else if (e.flashT > 0) setFlash(e, false); e.flashT = 0;
  enemies[i] = enemies[enemies.length - 1]; enemies.pop();
  if (e.type === 'boss') { scene.remove(e.g); } else pools[e.type].push(e);
}
function prewarm() {
  const n = { soldier: Math.min(Q.maxAlive, 60), heavy: 12, vehicle: 6 };
  for (const k in n) while (pools[k].length < n[k]) pools[k].push(makeEnemy(k));
}

// ---------------------------------------------------------------- game state
const game = {
  state: 'menu', mode: 'campaign', level: 1, wave: 0, waves: 0, queue: [], spawnT: 0, between: 0, kills: 0, score: 0, coinsRun: 0,
  baseHp: 1000, baseMax: 1000, hpMul: 1, boss: null, bossDone: false, isBossLevel: false, alive: 0, endT: 0, endWin: false, endReason: '', time: 0,
  strikes: [], regenT: 0, comboN: 0, comboT: 0, bestCombo: 0, waveTotal: 1,
};
let timeScale = 1, slowT = 0, slowTarget = 1;
function slowMo(s, dur) { slowTarget = Math.min(slowTarget, s); slowT = Math.max(slowT, dur); }
const LEVEL_NAMES = ['Boot Camp', 'First Contact', 'Supply Run', 'Night Raid', 'Steel Rain', 'Crossfire', 'Iron Wall', 'Blitz', 'Last Stand', 'Iron Goliath'];
function levelConfig(L) { return { waves: Math.min(2 + Math.floor((L - 1) / 2), 6), boss: L % 10 === 0, hpMul: 1 + (L - 1) * 0.08, theme: L === 10 ? 3 : Math.floor((L - 1) / 3) % 3 }; }
function waveList(L, w, survival) {
  const count = survival ? 8 + w * 5 : 5 + L * 3 + w * 3;
  const heavyF = survival ? Math.min(0.05 + w * 0.02, 0.25) : L >= 3 ? Math.min(0.06 + L * 0.015, 0.22) : 0;
  const vehF = survival ? (w >= 3 ? Math.min(0.03 + w * 0.01, 0.12) : 0) : L >= 5 ? Math.min(0.03 + (L - 5) * 0.012, 0.1) : 0;
  const list = [];
  for (let i = 0; i < count; i++) { const r = Math.random(); list.push(r < vehF ? 'vehicle' : r < vehF + heavyF ? 'heavy' : 'soldier'); }
  return list;
}
function startWave(w) {
  game.wave = w; game.queue = waveList(game.level, w, game.mode === 'survival');
  if (game.mode === 'survival') game.hpMul = 1 + (w - 1) * 0.07;
  game.waveGates = [Math.floor(Math.random() * 8), Math.floor(Math.random() * 8), Math.floor(Math.random() * 8)]; game.waveTotal = game.queue.length;
  showBanner(`WAVE ${w}`, game.mode === 'survival' ? 'SURVIVE' : `${game.queue.length} HOSTILES INBOUND`, 2);
  Sfx.alarm();
}

// ---------------------------------------------------------------- combat
const HIT = { t: 0, e: null, barrel: null, box: null, head: false };
function castRay(o, d, maxT, minT, extraR = 0) {
  let best = maxT; HIT.e = HIT.barrel = HIT.box = null; HIT.head = false; HIT.ground = false;
  if (d.y < -1e-4) { const t = -o.y / d.y; if (t > minT && t < best) { best = t; HIT.ground = true; } }
  for (const c of colliders) { const t = rayBox(o, d, c, best); if (t > minT && t < best) { best = t; HIT.box = c; HIT.ground = false; } }
  let be = null;
  for (const e of enemies) {
    if (e.dying) continue; const T = ETYPES[e.type];
    const t = rayCyl(o, d, e.pos.x, e.pos.z, T.r + extraR, 0, T.h);
    if (t > minT && t < best) { best = t; be = e; HIT.head = e.type !== 'vehicle' && o.y + d.y * t > T.h * 0.84; }
  }
  if (be) { HIT.e = be; HIT.box = null; HIT.ground = false; }
  for (const b of barrels) {
    if (!b.alive) continue; const t = rayCyl(o, d, b.x, b.z, 0.6, 0, 1.3);
    if (t > minT && t < best) { best = t; HIT.barrel = b; HIT.e = null; HIT.box = null; HIT.ground = false; }
  }
  HIT.t = best; return HIT;
}
let hitTimer = null;
function hitMarker(kill, head) {
  const h = $('hitmarker'); h.classList.remove('show'); void h.offsetWidth; h.classList.add('show'); h.classList.toggle('kill', !!kill); h.classList.toggle('head', !!head && !kill);
  clearTimeout(hitTimer); hitTimer = setTimeout(() => h.classList.remove('show', 'kill', 'head'), kill ? 240 : 120);
  Sfx.hit(kill);
}
const dmgMul = () => 1 + save.dmg * 0.15;
let dmgSrc = 'MG', dmgHead = false;
// floating damage numbers (DOM pool, projected each frame)
const DN = [];
{ const box = $('dmgNums'); for (let i = 0; i < 28; i++) { const el = document.createElement('div'); el.className = 'dn'; box.appendChild(el); DN.push({ el, p: new V3(), life: 0, vx: 0 }); } }
let dnI = 0; const _pj = new V3();
function dmgNumber(x, y, z, v, cls) {
  const d = DN[dnI]; dnI = (dnI + 1) % DN.length;
  d.p.set(x + rand(-0.7, 0.7), y + rand(0, 0.6), z + rand(-0.7, 0.7)); d.life = 0.9; d.vx = rand(-40, 40); d.el.textContent = Math.round(v); d.el.className = 'dn' + (cls ? ' ' + cls : '');
}
function updateDmgNumbers(dt) {
  for (const d of DN) {
    if (d.life <= 0) continue; d.life -= dt;
    if (d.life <= 0) { d.el.style.opacity = '0'; continue; }
    _pj.copy(d.p); _pj.y += (0.9 - d.life) * 1.6; _pj.project(camera);
    if (_pj.z > 1) { d.el.style.opacity = '0'; continue; }
    const t = 0.9 - d.life, sx = (_pj.x * 0.5 + 0.5) * innerWidth + d.vx * t, sy = (-_pj.y * 0.5 + 0.5) * innerHeight;
    const sc = t < 0.12 ? 1.6 - t * 5 : 1;
    d.el.style.transform = `translate3d(${sx.toFixed(1)}px,${sy.toFixed(1)}px,0) translate(-50%,-50%) scale(${sc.toFixed(2)})`;
    d.el.style.opacity = String(Math.min(1, d.life * 3).toFixed(2));
  }
}
// kill feed
const KF_NAMES = { soldier: 'SOLDIER', heavy: 'HEAVY', vehicle: 'ARMOR', boss: 'IRON GOLIATH' };
function killFeed(e, src, head) {
  const kf = $('killfeed'); const el = document.createElement('div'); el.className = 'kf';
  el.innerHTML = `${src}<b>▸</b>${KF_NAMES[e.type]}${head ? ' <span class="hs">◉ HEADSHOT</span>' : ''}`;
  kf.prepend(el); while (kf.children.length > 5) kf.lastChild.remove();
  setTimeout(() => el.classList.add('out'), 2800); setTimeout(() => el.remove(), 3300);
}
const COMBO = ['', '', 'DOUBLE KILL', 'TRIPLE KILL', 'QUAD KILL', 'MULTI KILL', 'RAMPAGE', 'MEGA KILL', 'UNSTOPPABLE', 'GODLIKE'];
let comboShown = 0;
function comboPopup(n) {
  const c = $('combo'); $('comboT').textContent = COMBO[Math.min(n, COMBO.length - 1)]; const bonus = n * 50; game.score += bonus;
  $('comboS').textContent = `x${n} COMBO · +${bonus}`; c.classList.remove('show'); void c.offsetWidth; c.classList.add('show'); Sfx.combo(n); buzz(25, true);
  if (n === 5 || n === 10 || n === 15) slowMo(0.3, 0.55);
}
function damageEnemy(e, dmg, byPlayerDirect) {
  if (e.dying) return false;
  e.hp -= dmg; if (e.flashT <= 0) setFlash(e, true); e.flashT = 0.07;
  const T = ETYPES[e.type];
  // aggregate rapid hits so numbers stay readable
  e.dnAcc += dmg; if (game.time - e.dnT > 0.09 || e.hp <= 0) { dmgNumber(e.pos.x, T.h + 0.3, e.pos.z, e.dnAcc, dmgHead ? 'crit' : dmg >= 150 ? 'big' : ''); e.dnAcc = 0; e.dnT = game.time; }
  if (e.hp <= 0) { killEnemy(e); if (byPlayerDirect) hitMarker(true); return true; }
  if (byPlayerDirect) hitMarker(false, dmgHead);
  return false;
}
function killEnemy(e) {
  const T = ETYPES[e.type];
  e.dying = true; e.dieT = 0; game.kills++; game.score += T.score; game.coinsRun += T.coins; Sfx.coin();
  const p = new V3(e.pos.x, 1, e.pos.z);
  // ragdoll-ish fling away from the player
  const dx = e.pos.x - player.pos.x, dz = e.pos.z - player.pos.z, dl = Math.hypot(dx, dz) || 1, f = dmgSrc === 'ROCKET' || dmgSrc === 'AIRSTRIKE' || dmgSrc === 'BARREL' ? 9 : 4;
  e.kv.set(dx / dl * rand(f * 0.6, f), e.type === 'vehicle' ? rand(5, 8) : rand(2, f * 0.8), dz / dl * rand(f * 0.6, f));
  e.spin.set(rand(3, 7) * (Math.random() < 0.5 ? -1 : 1), rand(-4, 4), rand(-3, 3));
  if (e.type === 'boss') { e.kv.set(0, 0, 0); }
  if (e.type === 'vehicle') { explosionFx(p, 5, true); splash(p, 4.5, 60, true, e); }
  else { for (let i = 0; i < 14; i++) fire.spawn(p.x, 1.2, p.z, rand(-3, 3), rand(1, 5), rand(-3, 3), 0.45, rand(0.12, 0.25), 0, 0.2, 0.85, 1, 12, 1); }
  if (e.type === 'boss') { showBanner('TARGET DOWN', 'IRON GOLIATH DESTROYED', 2.5); slowMo(0.2, 2.2); }
  if (e.type !== 'boss' && Math.random() < 0.06) spawnPickup(e.pos.x, e.pos.z);
  if (game.state === 'play') {
    killFeed(e, dmgSrc, dmgHead);
    game.comboN = game.comboT > 0 ? game.comboN + 1 : 1; game.comboT = 1.6; game.bestCombo = Math.max(game.bestCombo, game.comboN);
    if (game.comboN >= 2) comboPopup(game.comboN);
  }
  buzz(14);
}
function splash(p, r, dmg, byPlayer, skip) {
  if (byPlayer) {
    let hits = 0, kills = 0;
    for (const e of enemies) {
      if (e.dying || e === skip) continue; const T = ETYPES[e.type];
      const d = Math.hypot(e.pos.x - p.x, e.pos.z - p.z) - T.r; if (d > r) continue;
      dmgHead = false; hits++; if (damageEnemy(e, dmg * (1 - clamp(d / r, 0, 1) * 0.6), false)) kills++;
    }
    if (hits) hitMarker(kills > 0);
  } else {
    const d = Math.hypot(player.pos.x - p.x, player.pos.z - p.z);
    if (d < r && p.y < 4 + player.y) hurtPlayer(dmg * (1 - d / r * 0.5), p.x, p.z);
    const bd = Math.hypot(Math.max(0, Math.abs(p.x) - 4.5), Math.max(0, Math.abs(p.z) - 4.5));
    if (bd < r) hurtBase(dmg * 0.6);
  }
  for (const b of barrels) if (b.alive && Math.hypot(b.x - p.x, b.z - p.z) < r) { b.hp -= dmg; if (b.hp <= 0) setTimeout(() => blowBarrel(b), 120); }
}
function blowBarrel(b) {
  if (!b.alive) return; b.alive = false; b.mesh.visible = false;
  const p = new V3(b.x, 0.8, b.z); explosionFx(p, 6, true); const s0 = dmgSrc; dmgSrc = 'BARREL'; splash(p, 6, 220, true); dmgSrc = s0;
  setTimeout(() => { b.alive = true; b.hp = 30; b.mesh.visible = true; }, 25000);
}
const DD = [];
{ const box = $('dmgDir'); for (let i = 0; i < 6; i++) { const el = document.createElement('div'); el.className = 'dd'; box.appendChild(el); DD.push({ el, x: 0, z: 0, life: 0 }); } }
let ddI = 0;
function hurtDir(x, z) {
  let d = DD.find((q) => q.life > 0 && Math.hypot(q.x - x, q.z - z) < 4); if (!d) { d = DD[ddI]; ddI = (ddI + 1) % DD.length; }
  d.x = x; d.z = z; d.life = 1.2;
}
function updateHurtDirs(dt) {
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw), rx = Math.cos(player.yaw), rz = -Math.sin(player.yaw);
  for (const d of DD) {
    if (d.life <= 0) continue; d.life -= dt;
    const dx = d.x - player.pos.x, dz = d.z - player.pos.z, a = Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz);
    d.el.style.transform = `rotate(${a.toFixed(3)}rad)`; d.el.style.opacity = String(Math.max(0, Math.min(1, d.life * 1.5)).toFixed(2));
  }
}
function hurtPlayer(d, sx, sz) {
  if (!player.alive || game.state !== 'play') return;
  if (player.dashT > 0) return;
  if (player.shieldT > 0) { shieldMesh.material.opacity = 0.9; return; }
  if (sx !== undefined) hurtDir(sx, sz);
  player.hp -= d; player.hurtT = 0.4; game.regenT = 4; Sfx.hurt(); buzz(35); shake = Math.min(1, shake + 0.12);
  if (player.hp <= 0) { player.hp = 0; player.alive = false; pm.rotation.x = -Math.PI / 2; explosionFx(player.pos.clone(), 3, false); endGame(false, 'You were eliminated'); }
}
function hurtBase(d) {
  if (game.state !== 'play') return; game.baseHp -= d;
  if (game.baseHp <= 0) { game.baseHp = 0; for (let i = 0; i < 5; i++) setTimeout(() => explosionFx(new V3(rand(-4, 4), 3, rand(-4, 4)), 7, true), i * 200); endGame(false, 'Command center destroyed'); }
}

// projectiles
const projs = [];
const rocketGeo = new THREE.CylinderGeometry(0.09, 0.12, 0.8, 8); rocketGeo.rotateX(Math.PI / 2);
const rocketMats = [std(0x9aa29a, { emissive: 0x332200 }), std(0xff3010, { emissive: 0xff2000, emissiveIntensity: 2 })];
function spawnProj(p, v, o) {
  let pr = projs.find((q) => !q.on);
  if (!pr) { const m = new THREE.Mesh(rocketGeo, rocketMats[0]); scene.add(m); pr = { m, pos: new V3(), vel: new V3() }; projs.push(pr); }
  pr.on = true; pr.pos.copy(p); pr.vel.copy(v); pr.m.visible = true; pr.m.material = rocketMats[o.byPlayer ? 0 : 1];
  pr.m.scale.setScalar(o.scale || 1);
  Object.assign(pr, { dmg: o.dmg, splash: o.splash, byPlayer: o.byPlayer, grav: o.grav || 0, life: o.life || 4, ring: o.ring || null, big: o.big });
  return pr;
}
const _tmp = new V3(), _tmp2 = new V3(), _dir = new V3(), _fwd = new V3(), _right = new V3();
function updateProjs(dt) {
  for (const pr of projs) {
    if (!pr.on) continue;
    pr.vel.y -= pr.grav * dt; pr.pos.addScaledVector(pr.vel, dt); pr.life -= dt;
    pr.m.position.copy(pr.pos); _tmp.copy(pr.pos).add(pr.vel); pr.m.lookAt(_tmp);
    for (let k = 0; k < 2; k++) { const bt = k * 0.5 * dt; smoke.spawn(pr.pos.x - pr.vel.x * bt, pr.pos.y - pr.vel.y * bt, pr.pos.z - pr.vel.z * bt, rand(-0.4, 0.4), rand(0, 0.6), rand(-0.4, 0.4), rand(0.9, 1.6), 0.4, 2.0, 0.78, 0.76, 0.74, -0.3, 1.2); }
    fire.spawn(pr.pos.x, pr.pos.y, pr.pos.z, 0, 0, 0, 0.1, 0.7, 0, 1, 0.55, 0.15);
    fire.spawn(pr.pos.x, pr.pos.y, pr.pos.z, rand(-1, 1), rand(-1, 1), rand(-1, 1), 0.25, 0.12, 0, 1, 0.8, 0.4, 2, 1);
    let hit = pr.pos.y <= 0.05 || pr.life <= 0 || !!pointInBox(pr.pos) || Math.abs(pr.pos.x) > ARENA + 2 || Math.abs(pr.pos.z) > ARENA + 2;
    if (!hit && pr.byPlayer) {
      for (const e of enemies) { if (e.dying) continue; const T = ETYPES[e.type]; if (pr.pos.y < T.h && Math.hypot(e.pos.x - pr.pos.x, e.pos.z - pr.pos.z) < T.r + 0.3) { hit = true; dmgSrc = 'ROCKET'; dmgHead = false; damageEnemy(e, pr.dmg * 0.4, true); break; } }
      for (const b of barrels) if (b.alive && pr.pos.y < 1.4 && Math.hypot(b.x - pr.pos.x, b.z - pr.pos.z) < 0.8) hit = true;
    } else if (!hit && !pr.byPlayer) {
      if (player.alive && pr.pos.y < 2.2 + player.y && pr.pos.y > player.y - 0.3 && Math.hypot(player.pos.x - pr.pos.x, player.pos.z - pr.pos.z) < 0.9) hit = true;
    }
    if (hit) {
      pr.on = false; pr.m.visible = false; if (pr.ring) pr.ring.life = 0;
      pr.pos.y = Math.max(pr.pos.y, 0.2);
      explosionFx(pr.pos, pr.splash, pr.big); if (pr.byPlayer) dmgSrc = 'ROCKET'; splash(pr.pos, pr.splash, pr.dmg, pr.byPlayer);
    }
  }
}

// pickups
const pickups = [];
function spawnPickup(x, z) {
  let p = pickups.find((q) => !q.on);
  if (!p) { const m = new THREE.Group(); part(G.box, M.heal, 0.7, 0.7, 0.7, 0, 0, 0, m); part(G.box, M.flash, 0.72, 0.18, 0.5, 0, 0, 0, m, false); part(G.box, M.flash, 0.18, 0.72, 0.5, 0, 0, 0, m, false); scene.add(m); p = { m }; pickups.push(p); }
  p.on = true; p.x = x; p.z = z; p.t = 20; p.m.visible = true; p.m.position.set(x, 0.8, z);
}

// player firing
function startReload() {
  const w = WEAPONS[player.weapon];
  if (player.reloading > 0 || player.ammo[player.weapon] >= w.mag) return;
  player.reloadTotal = player.reloading = w.reload / (1 + save.rel * 0.15); Sfx.reload();
}
let firing = false;
function fireWeapon() {
  const wi = player.weapon, w = WEAPONS[wi];
  if (player.reloading > 0 || player.fireCd > 0 || !player.alive) return;
  if (player.ammo[wi] <= 0) { startReload(); return; }
  player.ammo[wi]--; player.fireCd = w.rate;
  camera.getWorldDirection(_dir);
  const sp = w.spread * (player.ads ? 0.4 : 1) * (player.moving ? 1.4 : 1) * (1 + player.bloom * 0.04) * (player.grounded ? 1 : 1.6);
  _dir.x += rand(-sp, sp); _dir.y += rand(-sp, sp); _dir.z += rand(-sp, sp); _dir.normalize();
  const minT = camera.position.distanceTo(player.pos) - 1.2;
  const h = castRay(camera.position, _dir, 220, minT, isTouch ? 0.35 : 0);
  const aim = _tmp2.copy(camera.position).addScaledVector(_dir, h.t);
  pm.updateMatrixWorld(true); muzzle.getWorldPosition(_tmp);
  flashMesh.visible = true; flashMesh.rotation.z = rand(0, 3); flashMesh.scale.set(rand(0.8, 1.3), rand(0.8, 1.3), wi === 2 ? 3 : 2.2);
  muzzleLight.position.copy(_tmp); muzzleLight.intensity = wi === 0 ? 14 : 22; muzzleFlashT = 0.045;
  shake = Math.min(1, shake + w.shake); player.pitch += w.recoil; player.yaw += rand(-w.recoil, w.recoil) * 0.4;
  player.bloom = Math.min(22, player.bloom + [3.2, 9, 12][wi]); camKick = Math.min(0.5, camKick + w.shake * 0.6);
  flashLight(_tmp, wi === 2 ? 40 : 18, 0.06, 0xffb050);
  Sfx.shot(wi); buzz(wi === 0 ? 8 : wi === 1 ? 22 : 40);
  dmgSrc = WEAPONS[wi].short;
  smoke.spawn(_tmp.x, _tmp.y, _tmp.z, rand(-0.3, 0.3), 0.6, rand(-0.3, 0.3), 0.5, 0.25, 0.8, 0.7, 0.7, 0.7, -0.4, 1);
  if (w.rocket) {
    const v = aim.clone().sub(_tmp).normalize().multiplyScalar(55);
    spawnProj(_tmp.clone(), v, { dmg: w.dmg * dmgMul(), splash: w.splash, byPlayer: true, life: 3 });
  } else {
    tracer(_tmp, aim, 0, wi === 1 ? 0.07 : 0.045);
    if (h.e) { dmgHead = h.head; const he = h.e; damageEnemy(he, w.dmg * dmgMul() * (h.head ? 2 : 1), true); impactFx(aim, h.head ? 9 : 5, h.head ? 1 : 0.3, h.head ? 0.3 : 0.9, h.head ? 0.9 : 1); dmgHead = false; }
    else if (h.barrel) { h.barrel.hp -= w.dmg; impactFx(aim, 5, 1, 0.7, 0.3); if (h.barrel.hp <= 0) blowBarrel(h.barrel); }
    else if (h.t < 219) impactFx(aim, 4, 1, 0.8, 0.45);
  }
  if (player.ammo[wi] <= 0) startReload();
}
let muzzleFlashT = 0;

// abilities
const jet = new THREE.Group(); scene.add(jet); jet.visible = false;
part(G.box, M.darkMetal, 1.2, 0.9, 7, 0, 0, 0, jet); part(G.box, M.darkMetal, 9, 0.15, 2.4, 0, 0, 0.6, jet); part(G.box, M.darkMetal, 3.4, 0.15, 1.2, 0, 0.2, 3.1, jet); part(G.box, M.darkMetal, 0.15, 1.8, 1.2, 0, 1, 3.1, jet);
const jetFlame = part(G.sph, new THREE.MeshBasicMaterial({ color: HDR(0xffa040, 4), toneMapped: false }), 0.4, 0.4, 1, 0, 0, 3.8, jet, false);
function airstrike() {
  if (player.airCd > 0 || !player.alive) return;
  camera.getWorldDirection(_dir);
  const h = castRay(camera.position, _dir, 90, camera.position.distanceTo(player.pos) - 1);
  const p = camera.position.clone().addScaledVector(_dir, h.t);
  if (!(h.ground || h.box || h.e || h.barrel)) { p.copy(player.pos).addScaledVector(_fwd.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw)), 30); }
  p.x = clamp(p.x, -ARENA + 3, ARENA - 3); p.z = clamp(p.z, -ARENA + 3, ARENA - 3);
  player.airCd = 25; buzz(30, true); popAb('abAir');
  const r = ring(p.x, p.z, 8, 2.4, 0xffb020);
  const bombs = []; for (let i = 0; i < 9; i++) bombs.push({ t: 1.6 + i * 0.09, x: p.x + rand(-6, 6), z: p.z + rand(-6, 6) });
  const a = Math.atan2(p.x - player.pos.x, p.z - player.pos.z) + Math.PI / 2;
  game.strikes.push({ t: 0, x: p.x, z: p.z, bombs, ringO: r, ang: a });
  showBanner('AIRSTRIKE INBOUND', '', 1.2); Sfx.ui(); setTimeout(() => Sfx.jet(), 600);
}
function shieldUp() { if (player.shieldCd > 0 || !player.alive) return; player.shieldT = 6; player.shieldCd = 20; Sfx.shield(); buzz(30, true); popAb('abShield'); shockwave(player.pos, 3, 0x29b8ff, 0.5); }
function popAb(id) { const el = $(id); if (!el) return; el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
function dash() {
  if (player.dashCd > 0 || !player.alive || game.state !== 'play') return;
  let mx = input.mx, mz = input.mz;
  if (!isTouch) { mx = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0); mz = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0); }
  if (Math.hypot(mx, mz) < 0.2) { mx = 0; mz = 1; }
  const l = Math.hypot(mx, mz); mx /= l; mz /= l;
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw), rx = Math.cos(player.yaw), rz = -Math.sin(player.yaw);
  player.dashX = fx * mz + rx * mx; player.dashZ = fz * mz + rz * mx; player.dashT = 0.2; player.dashCd = DASH_CD;
  Sfx.dash(); buzz(20, true); popAb('abDash');
}
function jump() {
  if (!player.grounded || !player.alive || game.state !== 'play') return;
  player.vy = 8.5; player.grounded = false; Sfx.jump(); buzz(12, true);
}
function updateStrikes(dt) {
  for (let i = game.strikes.length - 1; i >= 0; i--) {
    const s = game.strikes[i]; s.t += dt;
    const jt = (s.t - 0.6) / 2.0;
    if (jt > 0 && jt < 1) { jet.visible = true; const dx = Math.sin(s.ang), dz = Math.cos(s.ang); jet.position.set(s.x + dx * lerp(-120, 120, jt), 30, s.z + dz * lerp(-120, 120, jt)); jet.lookAt(jet.position.x - dx, 30, jet.position.z - dz); jetFlame.scale.z = rand(0.8, 1.6); }
    for (const b of s.bombs) if (!b.done && s.t >= b.t) { b.done = true; const p = new V3(b.x, 0.3, b.z); explosionFx(p, 6, true); dmgSrc = 'AIRSTRIKE'; splash(p, 6.5, 260 * dmgMul(), true); }
    if (jt > 0 && jt < 1) smoke.spawn(jet.position.x, 30, jet.position.z, 0, 0, 0, 1.6, 0.8, 2.5, 0.9, 0.9, 0.95, 0, 0.5);
    if (s.t > 3) { jet.visible = false; game.strikes.splice(i, 1); }
  }
}

// ---------------------------------------------------------------- enemy AI
const _m = new V3();
function updateEnemies(dt) {
  let alive = 0;
  const playerTargetable = player.alive;
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i]; const T = ETYPES[e.type];
    if (e.flashT > 0) { e.flashT -= dt; if (e.flashT <= 0) setFlash(e, false); }
    if (e.dying) {
      e.dieT += dt;
      if (e.flashT > 0) { e.flashT = 0; setFlash(e, false); }
      if (e.type === 'boss') { updateBossDeath(e, dt); if (e.dieT > 2.0 && !e.dmat) setDissolve(e); if (e.dmat) e.dmat.userData.u.uDis.value = clamp((e.dieT - 2.0) / 1.2, 0, 1); if (e.dieT > 3.3) releaseEnemy(i); continue; }
      // ragdoll-ish tumble: ballistic fling, spin, bounce, then dissolve
      e.kv.y -= 20 * dt; e.pos.x += e.kv.x * dt; e.pos.z += e.kv.z * dt; let gy = e.g.position.y + e.kv.y * dt;
      if (gy < 0) { gy = 0; e.kv.y *= -0.25; e.kv.x *= 0.5; e.kv.z *= 0.5; e.spin.multiplyScalar(0.5); }
      pushOut(e.pos, ETYPES[e.type].r * 0.6);
      e.g.position.set(e.pos.x, gy, e.pos.z);
      if (e.type === 'vehicle') { e.g.rotation.x += e.spin.x * dt * 0.35; e.g.rotation.z += e.spin.z * dt * 0.5; if (Math.random() < 0.4) smoke.spawn(e.pos.x, 1.5 + gy, e.pos.z, rand(-.5, .5), 3, rand(-.5, .5), 1.5, 1.2, 3, 0.1, 0.1, 0.1, -1, 0.5); if (Math.random() < 0.3) fire.spawn(e.pos.x, 1.2 + gy, e.pos.z, rand(-1, 1), rand(1, 3), rand(-1, 1), 0.4, 0.5, 0.5, 1, 0.5, 0.1, -1, 1); }
      else {
        const fall = Math.min(1, e.dieT * 2.6); e.g.rotation.x = lerp(e.g.rotation.x, -Math.PI / 2 * Math.sign(e.spin.x || 1), fall * 0.25); e.g.rotation.y += e.spin.y * dt * (1 - fall * 0.7); e.g.rotation.z += e.spin.z * dt * 0.3 * (1 - fall);
        if (e.legs) { e.legs[0].rotation.x = Math.sin(e.dieT * 18) * 0.9 * (1 - fall); e.legs[1].rotation.x = -e.legs[0].rotation.x; }
      }
      if (e.dieT > 0.45 && !e.dmat) setDissolve(e);
      if (e.dmat) { const k = clamp((e.dieT - 0.45) / 1.0, 0, 1); e.dmat.userData.u.uDis.value = k * 1.02; if (Math.random() < 0.5 * (Q.fx || 1)) { const c = e.dmat.userData.u.uEdge.value; fire.spawn(e.pos.x + rand(-0.5, 0.5), gy + rand(0.2, 1.4), e.pos.z + rand(-0.5, 0.5), rand(-0.3, 0.3), rand(0.8, 2), rand(-0.3, 0.3), 0.5, 0.14, 0, c.r, c.g, c.b, -1, 1); } }
      if (e.dieT > 1.6 || (e.dieT > 0.45 && !e.dmat && e.dieT > 1.2)) releaseEnemy(i);
      continue;
    }
    alive++;
    if (e.type === 'boss') { updateBoss(e, dt); continue; }
    e.t += dt;
    const dpx = player.pos.x - e.pos.x, dpz = player.pos.z - e.pos.z, dP = Math.hypot(dpx, dpz);
    const bx = clamp(e.pos.x, -4.5, 4.5), bz = clamp(e.pos.z, -4.5, 4.5), dB = Math.hypot(e.pos.x - bx, e.pos.z - bz);
    const tp = playerTargetable && (dP < 26 || dP < dB);
    const tx = tp ? player.pos.x : bx, tz = tp ? player.pos.z : bz, dist = tp ? dP : dB;
    let mx = (tx - e.pos.x) / (dist || 1), mz = (tz - e.pos.z) / (dist || 1);
    let spd = T.speed;
    if (dist < T.range * 0.7) {
      e.strafeT -= dt; if (e.strafeT <= 0) { e.strafe *= -1; e.strafeT = rand(1.5, 3.5); }
      const sx = -mz * e.strafe, sz = mx * e.strafe; mx = sx * 0.6 + mx * (dist < 6 ? -0.4 : 0); mz = sz * 0.6 + mz * (dist < 6 ? -0.4 : 0);
      spd *= e.type === 'vehicle' ? 0.5 : 0.7;
    }
    // obstacle avoidance
    for (const c of colliders) {
      const cx = clamp(e.pos.x, c.x - c.hx, c.x + c.hx), cz = clamp(e.pos.z, c.z - c.hz, c.z + c.hz);
      const ox = e.pos.x - cx, oz = e.pos.z - cz, od = Math.hypot(ox, oz), lim = T.r + 1.6;
      if (od < lim && od > 1e-4 && !(c.isBase && !tp)) {
        const w = (lim - od) / lim; mx += (ox / od) * w * 1.2; mz += (oz / od) * w * 1.2;
        mx += (-oz / od) * w * e.strafe; mz += (ox / od) * w * e.strafe; // slide around
      }
    }
    // separation
    for (let j = 0; j < enemies.length; j++) {
      const o = enemies[j]; if (o === e || o.dying) continue;
      const sx = e.pos.x - o.pos.x, sz = e.pos.z - o.pos.z; const md = T.r + ETYPES[o.type].r + 0.3;
      if (Math.abs(sx) > md || Math.abs(sz) > md) continue; const d = Math.hypot(sx, sz);
      if (d < md && d > 1e-4) { const w = (md - d) / md; mx += (sx / d) * w * 1.5; mz += (sz / d) * w * 1.5; }
    }
    const ml = Math.hypot(mx, mz); if (ml > 1) { mx /= ml; mz /= ml; }
    e.vel.x = lerp(e.vel.x, mx * spd, Math.min(1, dt * 4)); e.vel.z = lerp(e.vel.z, mz * spd, Math.min(1, dt * 4));
    e.pos.x += e.vel.x * dt; e.pos.z += e.vel.z * dt; pushOut(e.pos, T.r);
    e.g.position.set(e.pos.x, 0, e.pos.z);
    const face = e.type === 'vehicle' ? Math.atan2(e.vel.x, e.vel.z) : Math.atan2(tx - e.pos.x, tz - e.pos.z);
    let dr = face - e.g.rotation.y; dr = Math.atan2(Math.sin(dr), Math.cos(dr)); e.g.rotation.y += dr * Math.min(1, dt * 8);
    const sp = Math.hypot(e.vel.x, e.vel.z);
    if (e.legs) { const s = Math.sin(e.t * 9) * 0.6 * Math.min(1, sp / 2); e.legs[0].rotation.x = s; e.legs[1].rotation.x = -s; }
    if (e.wheels) { for (const w of e.wheels) w.rotation.x += sp * dt * 2; e.tur.rotation.y = Math.atan2(tx - e.pos.x, tz - e.pos.z) - e.g.rotation.y; }
    // shooting
    e.cd -= dt;
    if (e.cd <= 0 && dist < T.range && game.state === 'play') {
      e.cd = T.rate * rand(0.8, 1.3);
      const fy = e.g.rotation.y + (e.tur ? e.tur.rotation.y : 0);
      _tmp.set(e.pos.x + Math.sin(fy) * e.muzzleZ, e.muzzleY, e.pos.z + Math.cos(fy) * e.muzzleZ);
      _tmp2.set(tx, tp ? 1.2 + player.y : 2.5, tz);
      if (lineOfSight(_tmp, _tmp2, !tp)) {
        if (e.type === 'vehicle') {
          const v = _tmp2.clone().sub(_tmp).normalize().multiplyScalar(32);
          spawnProj(_tmp.clone(), v, { dmg: T.dmg * 2, splash: 3, byPlayer: false, life: 2.5, scale: 1.2 });
          Sfx.enemyShot();
        } else {
          let acc = clamp(0.65 - dist / 55, 0.2, 0.65) * (player.moving ? 0.7 : 1) * (isTouch ? 0.75 : 1);
          const hit = Math.random() < acc;
          if (!hit) { _tmp2.x += rand(-1.5, 1.5); _tmp2.y += rand(-0.5, 1.5); _tmp2.z += rand(-1.5, 1.5); }
          tracer(_tmp, _tmp2, 1, e.type === 'heavy' ? 0.07 : 0.04);
          fire.spawn(_tmp.x, _tmp.y, _tmp.z, 0, 0, 0, 0.06, 0.7, 0, 1, 0.5, 0.2);
          Sfx.enemyShot();
          if (hit) { if (tp) hurtPlayer(T.dmg, e.pos.x, e.pos.z); else hurtBase(T.dmg); }
        }
      } else e.cd *= 0.4;
    }
  }
  game.alive = alive;
}

// boss
function updateBoss(e, dt) {
  const T = ETYPES.boss; e.t += dt;
  const f = e.hp / e.maxHp; const ph = f > 0.66 ? 1 : f > 0.33 ? 2 : 3;
  if (ph !== e.phase) {
    e.phase = ph; Sfx.alarm(); shake = 1; shockwave(e.pos, 14, 0xff2bd6, 0.8); slowMo(0.45, 0.6);
    showBanner(`PHASE ${ph}`, ph === 2 ? 'MISSILE BARRAGE · REINFORCEMENTS' : 'ENRAGED', 2, true);
    const n = ph === 2 ? 6 : 8; for (let i = 0; i < n; i++) { const s = SPAWNS[(i * 3) % 8]; spawnEnemy(i < 2 && ph === 3 ? 'vehicle' : 'soldier', s[0] + rand(-3, 3), s[1] + rand(-3, 3), game.hpMul); }
  }
  const tx = player.alive ? player.pos.x : 0, tz = player.alive ? player.pos.z : 0;
  const dx = tx - e.pos.x, dz = tz - e.pos.z, d = Math.hypot(dx, dz);
  const spd = T.speed * (ph === 3 ? 1.6 : 1);
  if (d > 12) { e.vel.set(dx / d * spd, 0, dz / d * spd); } else e.vel.multiplyScalar(0.9);
  e.pos.addScaledVector(e.vel, dt); pushOut(e.pos, T.r);
  e.g.position.set(e.pos.x, 0, e.pos.z);
  let dr = Math.atan2(dx, dz) - e.g.rotation.y; dr = Math.atan2(Math.sin(dr), Math.cos(dr)); e.g.rotation.y += dr * Math.min(1, dt * 2.5);
  const moving = e.vel.length() > 0.3; const s = Math.sin(e.t * 3.5) * 0.45 * (moving ? 1 : 0.1);
  e.legs[0].rotation.x = s; e.legs[1].rotation.x = -s;
  if (moving && Math.abs(Math.sin(e.t * 3.5)) > 0.98) shake = Math.max(shake, 0.25 * clamp(1 - d / 40, 0, 1));
  // cannons
  e.cd -= dt;
  if (e.cd <= 0 && game.state === 'play') {
    e.cd = ph === 3 ? 0.55 : ph === 2 ? 0.95 : 1.3;
    const side = (e.special2 = -e.special2 || 1) > 0 ? 1 : -1; const ry = e.g.rotation.y;
    _tmp.set(e.pos.x + Math.cos(ry) * 2.2 * side + Math.sin(ry) * 2.4, 4.1, e.pos.z - Math.sin(ry) * 2.2 * side + Math.cos(ry) * 2.4);
    _tmp2.set(tx + player.vel.x * 0.5, 1, tz + player.vel.z * 0.5);
    spawnProj(_tmp.clone(), _tmp2.sub(_tmp).normalize().multiplyScalar(30), { dmg: 14, splash: 3.5, byPlayer: false, life: 3, scale: 2 });
    fire.spawn(_tmp.x, _tmp.y, _tmp.z, 0, 0, 0, 0.1, 2, 0, 1, 0.4, 0.1); Sfx.shot(1);
  }
  // missile barrage
  if (ph >= 2) {
    e.special -= dt;
    if (e.special <= 0 && game.state === 'play') {
      e.special = ph === 3 ? 5 : 7.5;
      for (let i = 0; i < 6; i++) {
        const gx = clamp(tx + rand(-7, 7), -ARENA, ARENA), gz = clamp(tz + rand(-7, 7), -ARENA, ARENA);
        const from = new V3(e.pos.x + rand(-1, 1), 6.2, e.pos.z + rand(-1, 1)); const Tt = 2 + i * 0.12, g = 14;
        const v = new V3((gx - from.x) / Tt, (0 - from.y + 0.5 * g * Tt * Tt) / Tt, (gz - from.z) / Tt);
        spawnProj(from, v, { dmg: 18, splash: 4, byPlayer: false, grav: g, life: Tt + 0.5, ring: ring(gx, gz, 4, Tt), scale: 1.4 });
      }
      Sfx.shot(2);
    }
  }
  if (ph === 3 && d < 8) {
    e.slam = (e.slam || 0) - dt;
    if (e.slam <= 0 && game.state === 'play') { e.slam = 3; const p = e.pos.clone(); explosionFx(p, 8, true); shockwave(p, 16, 0xff2bd6, 0.7); splash(p, 9, 28, false); }
  }
}
function updateBossDeath(e, dt) {
  e.boomT = (e.boomT || 0) - dt;
  if (e.boomT <= 0 && e.dieT < 2.3) { e.boomT = 0.18; explosionFx(new V3(e.pos.x + rand(-2.5, 2.5), rand(1, 6), e.pos.z + rand(-2.5, 2.5)), 4, false); }
  e.g.position.y = -Math.max(0, e.dieT - 1.2) * 2; e.g.rotation.z = Math.min(0.5, e.dieT * 0.2);
  if (e.dieT > 2.2 && !e.bigBoom) { e.bigBoom = true; explosionFx(new V3(e.pos.x, 3, e.pos.z), 10, true); }
}

// ---------------------------------------------------------------- input
const keys = {};
const input = { mx: 0, mz: 0 };
let locked = false, wasLocked = false, mouseDown = false;
const SENS = 0.0024;
const aimPend = { x: 0, y: 0 };
function addAim(dx, dy) { aimPend.x += dx * settings.sens; aimPend.y += dy * settings.sens * (settings.invert ? -1 : 1); }
let autoFireOn = false, camKick = 0, adsToggle = false;
addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (game.state === 'play') {
    if (e.code === 'Space' || e.code === 'ControlLeft' || e.code === 'ControlRight') e.preventDefault();
    if (e.repeat) return;
    if (e.code === 'Digit1') setWeapon(0); else if (e.code === 'Digit2') setWeapon(1); else if (e.code === 'Digit3') setWeapon(2);
    else if (e.code === 'KeyR') startReload(); else if (e.code === 'KeyQ') airstrike(); else if (e.code === 'KeyE') shieldUp();
    else if (e.code === 'Space' || e.code === 'ControlLeft' || e.code === 'ControlRight') dash();
    else if (e.code === 'KeyC') jump();
    else if (e.code === 'KeyP' || e.code === 'Escape') pauseGame();
  } else if (game.state === 'paused' && (e.code === 'KeyP')) resumeGame();
});
addEventListener('wheel', (e) => { if (game.state !== 'play' || isTouch) return; setWeapon((player.weapon + (e.deltaY > 0 ? 1 : 2)) % 3); }, { passive: true });
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; firing = false; if (game.state === 'play') pauseGame(); });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('mousedown', (e) => {
  if (game.state !== 'play' || isTouch) return;
  Sfx.init();
  if (!locked && canvas.requestPointerLock) { try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (err) { /* ignore */ } }
  if (e.button === 0) { firing = true; mouseDown = true; } else if (e.button === 2) player.ads = true;
});
addEventListener('mouseup', (e) => { if (e.button === 0) { firing = false; mouseDown = false; } else if (e.button === 2) player.ads = false; });
addEventListener('mousemove', (e) => {
  if (game.state !== 'play' || isTouch) return;
  if (locked || mouseDown) { const s = SENS * (player.ads ? 0.55 : 1); addAim(-e.movementX * s, -e.movementY * s); }
});
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  if (locked) wasLocked = true;
  else if (wasLocked && game.state === 'play') { wasLocked = false; pauseGame(); }
});

// touch
const joy = { id: null, ox: 0, oy: 0 }, aimT = { id: null, x: 0, y: 0 };
const joyBase = $('joyBase'), joyKnob = $('joyKnob');
const TOUCH_SENS = 0.0065;
function joyReset() { joy.id = null; input.mx = input.mz = 0; input.sprint = false; joyBase.style.left = '60px'; joyBase.style.top = ''; joyBase.style.bottom = '40px'; joyKnob.style.transform = ''; joyBase.classList.remove('act', 'sprint'); $('joyHint').style.opacity = '1'; }
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' || game.state !== 'play') return;
  Sfx.init(); e.preventDefault();
  if (e.clientX < innerWidth * 0.45 && joy.id === null) {
    joy.id = e.pointerId; joy.ox = e.clientX; joy.oy = e.clientY;
    joyBase.style.left = (e.clientX - 68) + 'px'; joyBase.style.top = (e.clientY - 68) + 'px'; joyBase.style.bottom = 'auto'; joyBase.classList.add('act'); $('joyHint').style.opacity = '0'; buzz(6, true);
  } else if (aimT.id === null) { aimT.id = e.pointerId; aimT.x = e.clientX; aimT.y = e.clientY; }
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
});
function touchMove(e) {
  if (e.pointerId === joy.id) {
    let dx = e.clientX - joy.ox, dy = e.clientY - joy.oy; const d = Math.hypot(dx, dy), R = 56;
    // floating: if the thumb drags far past the rim, the base follows it
    if (d > R * 1.6) { const k = (d - R * 1.6) / d; joy.ox += dx * k; joy.oy += dy * k; joyBase.style.left = (joy.ox - 68) + 'px'; joyBase.style.top = (joy.oy - 68) + 'px'; dx = e.clientX - joy.ox; dy = e.clientY - joy.oy; }
    const d2 = Math.hypot(dx, dy); if (d2 > R) { dx = dx / d2 * R; dy = dy / d2 * R; }
    joyKnob.style.transform = `translate(${dx}px,${dy}px)`; input.mx = dx / R; input.mz = -dy / R;
    const spr = Math.hypot(input.mx, input.mz) > 0.93 && input.mz > 0.5; if (spr !== input.sprint) { input.sprint = spr; joyBase.classList.toggle('sprint', spr); if (spr) buzz(10, true); }
  } else if (e.pointerId === aimT.id) {
    addAim(-(e.clientX - aimT.x) * TOUCH_SENS, -(e.clientY - aimT.y) * TOUCH_SENS * 0.8); aimT.lastMove = performance.now();
    aimT.x = e.clientX; aimT.y = e.clientY;
  }
}
function touchEnd(e) {
  if (e.pointerId === joy.id) joyReset();
  if (e.pointerId === aimT.id) { aimT.id = null; if (fireBtnId === e.pointerId) { firing = false; fireBtnId = null; $('tFire').classList.remove('on'); } }
}
canvas.addEventListener('pointermove', touchMove); canvas.addEventListener('pointerup', touchEnd); canvas.addEventListener('pointercancel', touchEnd);
let fireBtnId = null;
const tFire = $('tFire');
tFire.addEventListener('pointerdown', (e) => {
  e.preventDefault(); e.stopPropagation(); Sfx.init(); if (game.state !== 'play') return;
  firing = true; fireBtnId = e.pointerId; tFire.classList.add('on');
  if (aimT.id === null) { aimT.id = e.pointerId; aimT.x = e.clientX; aimT.y = e.clientY; }
  try { tFire.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
});
tFire.addEventListener('pointermove', touchMove);
tFire.addEventListener('pointerup', (e) => { firing = false; fireBtnId = null; tFire.classList.remove('on'); if (aimT.id === e.pointerId) aimT.id = null; });
tFire.addEventListener('pointercancel', (e) => { firing = false; fireBtnId = null; tFire.classList.remove('on'); if (aimT.id === e.pointerId) aimT.id = null; });
const tap = (id, fn) => $(id).addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); Sfx.init(); if (game.state === 'play') fn(); });
tap('tReload', startReload); tap('tAir', airstrike); tap('tShield', shieldUp); tap('tDash', dash); tap('tJump', jump);
tap('tAds', () => { adsToggle = !adsToggle; player.ads = adsToggle; $('tAds').classList.toggle('on', adsToggle); if (adsToggle) assistSnap(0.2, 0.8); buzz(8, true); });
document.querySelectorAll('.tw').forEach((b) => b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); if (game.state === 'play') setWeapon(+b.dataset.w); }));
$('pauseBtn').addEventListener('click', () => { if (game.state === 'play') pauseGame(); });

// ---------------------------------------------------------------- player update / camera
const camOff = new V3();
function updatePlayer(dt) {
  player.pitch = clamp(player.pitch, -0.75, 0.85);
  let mx = input.mx, mz = input.mz;
  if (!isTouch) { mx = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0); mz = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0); const l = Math.hypot(mx, mz); if (l > 1) { mx /= l; mz /= l; } }
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw), rx = Math.cos(player.yaw), rz = -Math.sin(player.yaw);
  // aim smoothing (consumes pending look input exponentially)
  const sk = settings.smooth > 0.01 ? 1 - Math.exp(-dt * (1 - settings.smooth) * 42) : 1;
  player.yaw += aimPend.x * sk; player.pitch += aimPend.y * sk; aimPend.x *= 1 - sk; aimPend.y *= 1 - sk;
  const wantSprint = (isTouch ? input.sprint : (keys.ShiftLeft || keys.ShiftRight)) && mz > 0.3 && !firing && !player.ads;
  player.sprinting = wantSprint && player.alive;
  const sprint = wantSprint ? 1.5 : 1;
  const speed = 7.2 * sprint * (player.ads ? 0.6 : 1);
  const tvx = (fx * mz + rx * mx) * speed, tvz = (fz * mz + rz * mx) * speed;
  const accel = player.grounded ? 12 : 4;
  player.vel.x = lerp(player.vel.x, tvx, Math.min(1, dt * accel)); player.vel.z = lerp(player.vel.z, tvz, Math.min(1, dt * accel));
  if (player.dashT > 0) {
    player.dashT -= dt; player.vel.x = player.dashX * 26; player.vel.z = player.dashZ * 26;
    if (Math.random() < 0.9) fire.spawn(player.pos.x + rand(-0.3, 0.3), player.y + rand(0.3, 1.7), player.pos.z + rand(-0.3, 0.3), 0, rand(0, 0.5), 0, 0.35, rand(0.25, 0.45), 0, 0.15, 0.85, 1, 0, 2);
    if (player.dashT <= 0) { player.vel.x *= 0.35; player.vel.z *= 0.35; }
  }
  player.dashCd = Math.max(0, player.dashCd - dt);
  if (player.alive) { player.pos.x += player.vel.x * dt; player.pos.z += player.vel.z * dt; pushOut(player.pos, 0.45); }
  // jump / gravity
  if (!player.grounded) { player.vy -= 24 * dt; player.y += player.vy * dt; if (player.y <= 0) { player.y = 0; player.vy = 0; player.grounded = true; shake = Math.min(1, shake + 0.08); } }
  player.bloom = Math.max(0, player.bloom - dt * (firing ? 18 : 40));
  // touch auto-fire + light aim assist
  autoFireOn = false;
  if (isTouch && game.state === 'play' && player.alive) {
    if (settings.assist) assistSnap(0.075, (aimT.id !== null || Math.hypot(mx, mz) > 0.1) ? 2.4 : 1.1, dt);
    if (settings.autoFire && player.weapon !== 2 && player.reloading <= 0) {
      camera.getWorldDirection(_dir); const h = castRay(camera.position, _dir, 75, camera.position.distanceTo(player.pos) - 1.2, 0.35);
      autoFireOn = !!h.e;
    }
  }
  const sp = Math.hypot(player.vel.x, player.vel.z); player.moving = sp > 1;
  player.walk += dt * sp * 1.6;
  const s = Math.sin(player.walk) * 0.7 * Math.min(1, sp / 4);
  pLegL.rotation.x = s; pLegR.rotation.x = -s;
  pm.position.set(player.pos.x, player.y, player.pos.z); if (player.alive) { pm.rotation.set(player.dashT > 0 ? -0.25 : 0, player.yaw, 0); }
  if (!player.grounded) { pLegL.rotation.x = 0.6; pLegR.rotation.x = -0.3; }
  pGun.rotation.x = player.pitch * 0.9; pArmR.rotation.x = player.pitch * 0.6;
  // timers
  player.fireCd -= dt; player.airCd = Math.max(0, player.airCd - dt); player.shieldCd = Math.max(0, player.shieldCd - dt);
  player.shieldT = Math.max(0, player.shieldT - dt); player.hurtT = Math.max(0, player.hurtT - dt);
  if (player.reloading > 0) { player.reloading -= dt; if (player.reloading <= 0) { player.reloading = 0; player.ammo[player.weapon] = WEAPONS[player.weapon].mag; } }
  game.regenT -= dt; if (game.regenT <= 0 && player.alive && player.hp < player.maxHp) player.hp = Math.min(player.maxHp, player.hp + 8 * dt);
  if ((firing || autoFireOn) && game.state === 'play') fireWeapon();
  if (muzzleFlashT > 0) { muzzleFlashT -= dt; if (muzzleFlashT <= 0) { flashMesh.visible = false; muzzleLight.intensity = 0; } }
  shieldMesh.visible = player.shieldT > 0; shieldMesh.position.set(player.pos.x, 1.1 + player.y, player.pos.z);
  shieldMesh.material.opacity = lerp(shieldMesh.material.opacity, 0.3 + Math.sin(game.time * 8) * 0.08, Math.min(1, dt * 6)); shieldMesh.rotation.y += dt * 0.8;
  // pickups
  for (const p of pickups) {
    if (!p.on) continue; p.t -= dt; p.m.rotation.y += dt * 2; p.m.position.y = 0.8 + Math.sin(game.time * 3) * 0.15;
    if (p.t <= 0) { p.on = false; p.m.visible = false; continue; }
    if (Math.hypot(p.x - player.pos.x, p.z - player.pos.z) < 1.6 && player.alive) { p.on = false; p.m.visible = false; player.hp = Math.min(player.maxHp, player.hp + 35); Sfx.coin(); showBanner('+35 HP', '', 0.8); }
  }
  // drone
  drone.visible = save.drone;
  if (save.drone) {
    _tmp.set(player.pos.x - rx * 1.1 - fx * 0.6, 2.7 + Math.sin(game.time * 2.5) * 0.15, player.pos.z - rz * 1.1 - fz * 0.6);
    drone.position.lerp(_tmp, Math.min(1, dt * 5)); for (const r of rotors) r.rotation.y += dt * 40;
    droneS.cd -= dt;
    let best = null, bd = 34;
    for (const e of enemies) { if (e.dying) continue; const d = e.pos.distanceTo(drone.position); if (d < bd) { bd = d; best = e; } }
    if (best) {
      drone.rotation.y = Math.atan2(best.pos.x - drone.position.x, best.pos.z - drone.position.z) + Math.PI;
      if (droneS.cd <= 0 && game.state === 'play') {
        droneS.cd = 0.32; _tmp2.set(best.pos.x, ETYPES[best.type].h * 0.6, best.pos.z);
        if (lineOfSight(drone.position, _tmp2)) { tracer(drone.position, _tmp2, 2, 0.04); dmgSrc = 'DRONE'; dmgHead = false; damageEnemy(best, 9 * dmgMul(), false); Sfx.shot(3); impactFx(_tmp2, 2, 0.3, 0.9, 1); }
      }
    }
  }
}
const _aa = new V3();
function assistSnap(cone, rate, dt = 1) {
  // find enemy closest to the crosshair inside the cone and nudge aim toward its chest
  camera.getWorldDirection(_dir); let best = null, ba = cone;
  for (const e of enemies) {
    if (e.dying) continue; const T = ETYPES[e.type];
    _aa.set(e.pos.x, T.h * 0.6, e.pos.z).sub(camera.position); const L = _aa.length(); if (L > 70 || L < 2) continue;
    const a = Math.acos(clamp(_aa.dot(_dir) / L, -1, 1)); if (a < ba) { ba = a; best = e; }
  }
  if (!best) return;
  const T = ETYPES[best.type]; _aa.set(best.pos.x, T.h * 0.6, best.pos.z).sub(camera.position);
  const ty = Math.atan2(-_aa.x, -_aa.z), tp = Math.asin(clamp(_aa.y / _aa.length(), -1, 1));
  let dy = ty - player.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  const k = Math.min(1, rate * dt) * (1 - ba / cone * 0.5);
  player.yaw += dy * k; player.pitch += (tp - player.pitch) * k;
}
const camPos = new V3(); let camInit = true, fovKick = 0;
function updateCamera(dt) {
  const ads = player.ads;
  fovKick = lerp(fovKick, player.dashT > 0 ? 12 : player.sprinting ? 6 : 0, Math.min(1, dt * 8));
  const tf = (ads ? (player.weapon === 1 ? 30 : 46) : 66) + fovKick;
  if (Math.abs(camera.fov - tf) > 0.01) { camera.fov = lerp(camera.fov, tf, Math.min(1, dt * 12)); camera.updateProjectionMatrix(); setScale(); }
  const cp = Math.cos(player.pitch), sp = Math.sin(player.pitch);
  _fwd.set(-Math.sin(player.yaw) * cp, sp, -Math.cos(player.yaw) * cp);
  _right.set(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
  const back = ads ? 2.6 : 4.4, side = ads ? 0.75 : 1.1;
  const head = _tmp.set(player.pos.x, 1.75 + player.y, player.pos.z);
  camOff.copy(_right).multiplyScalar(side).addScaledVector(_fwd, -back); camOff.y += 0.35;
  // camera collision: shorten offset if inside a box
  let k = 1; for (let i = 1; i <= 8; i++) { const t = i / 8; _tmp2.copy(head).addScaledVector(camOff, t); if (camBlocked(_tmp2)) { k = Math.max(0.15, (i - 1) / 8); break; } }
  const kr = k; if (k < 0.6) k = 0.6;
  _tmp2.copy(head).addScaledVector(camOff, k);
  if (kr < 0.6) _tmp2.y += (0.6 - kr) * 3;
  if (_tmp2.y < 0.4) _tmp2.y = 0.4;
  // smooth follow (snaps when the smoothed point would be inside geometry)
  if (camInit) { camPos.copy(_tmp2); camInit = false; } else { camPos.lerp(_tmp2, 1 - Math.exp(-dt * 20)); if (camBlocked(camPos)) camPos.copy(_tmp2); }
  camera.position.copy(camPos);
  camKick = Math.max(0, camKick - dt * 4); camera.position.addScaledVector(_fwd, -camKick * 0.5);
  let roll = 0;
  if (shake > 0) { const t = game.time * 38, s = shake * shake * 0.45; camera.position.x += Math.sin(t * 1.1) * s; camera.position.y += Math.sin(t * 1.7 + 1) * s; camera.position.z += Math.sin(t * 1.3 + 2) * s; roll = Math.sin(t * 0.9) * shake * 0.03; shake = Math.max(0, shake - dt * 2.4); }
  _tmp2.copy(camera.position).add(_fwd); camera.lookAt(_tmp2); if (roll) camera.rotateZ(roll);
}

// ---------------------------------------------------------------- HUD
let bannerTimer = null;
function showBanner(t, s, dur, red) {
  $('bannerT').textContent = t; $('bannerS').textContent = s || ''; const b = $('banner');
  b.classList.add('show'); b.classList.toggle('red', !!red); clearTimeout(bannerTimer); bannerTimer = setTimeout(() => b.classList.remove('show'), dur * 1000);
}
const hudCache = {};
function setText(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; } }
function setStyle(id, prop, v) { const k = id + prop; if (hudCache[k] !== v) { hudCache[k] = v; $(id).style[prop] = v; } }
function setCls(el, cls, on) { const k = (el.id || el.className) + '.' + cls; if (hudCache[k] !== on) { hudCache[k] = on; el.classList.toggle(cls, on); } }
const radar = $('radar'), rctx = radar.getContext('2d');
const RC = 163.4, TC = 169.6;
let radarTick = 0, aimTick = 0, aimOnEnemy = false;
function buildPips() {
  const w = WEAPONS[player.weapon]; if (!w) return;
  $('pips').innerHTML = '<i></i>'.repeat(w.mag); hudCache.pa = -1;
}
const el = { hpSeg: document.querySelector('.seg.hp'), reticle: $('reticle'), scope: $('scope'), autoTag: $('autoTag'), ammo: $('ammoTxt'),
  abAir: $('abAir'), abShield: $('abShield'), abDash: $('abDash'), abDrone: $('abDrone'), tAir: $('tAir'), tShield: $('tShield'), tDash: $('tDash'), fps: $('fpsTxt') };
function updateHUD(dt) {
  const hpF = clamp(player.hp / player.maxHp, 0, 1);
  const hpW = (hpF * 100).toFixed(1) + '%'; setStyle('hpFill', 'width', hpW); setStyle('hpGhost', 'width', hpW);
  setText('hpTxt', String(Math.max(0, Math.ceil(player.hp)))); setCls(el.hpSeg, 'low', hpF < 0.3);
  setStyle('shFill', 'width', (player.shieldT / 6 * 100).toFixed(1) + '%');
  setText('shTxt', player.shieldT > 0 ? player.shieldT.toFixed(1) : player.shieldCd > 0 ? Math.ceil(player.shieldCd) + 's' : 'RDY');
  const bF = clamp(game.baseHp / game.baseMax, 0, 1); setStyle('baseFill', 'width', (bF * 100).toFixed(1) + '%'); setText('baseTxt', Math.ceil(bF * 100) + '%');
  // reticle arcs: left = health, right = magazine / reload progress
  const w = WEAPONS[player.weapon], am = player.ammo[player.weapon];
  const magF = player.reloading > 0 ? 1 - player.reloading / player.reloadTotal : am / w.mag;
  setStyle('arcHp', 'strokeDashoffset', (100 * (1 - hpF)).toFixed(1)); setStyle('arcSh', 'strokeDashoffset', (100 * (1 - magF)).toFixed(1));
  const left = game.queue.length + game.alive;
  setText('waveTxt', game.mode === 'survival' ? `SURVIVAL · WAVE ${game.wave}` : (game.boss && !game.boss.dying ? `LEVEL ${game.level} · BOSS` : `LEVEL ${game.level} · WAVE ${game.wave}/${game.waves}`));
  setText('leftTxt', `HOSTILES ${left}`);
  setStyle('waveFill', 'width', (game.boss && !game.boss.dying ? 100 * (1 - game.boss.hp / game.boss.maxHp) : 100 * (1 - left / Math.max(1, game.waveTotal))).toFixed(1) + '%');
  setText('scoreTxt', game.score.toLocaleString()); setText('coinTxt', '◆ ' + (save.coins + game.coinsRun));
  setText('wpnTxt', w.name); setText('ammoTxt', player.reloading > 0 ? 'RLD' : String(am)); setText('magTxt', '/ ' + w.mag);
  setCls(el.ammo, 'low', player.reloading <= 0 && am <= Math.ceil(w.mag * 0.25));
  if (hudCache.pa !== am) { hudCache.pa = am; const ps = $('pips').children; for (let i = 0; i < ps.length; i++) ps[i].className = i < am ? '' : 'e'; }
  setStyle('reloadBar', 'visibility', player.reloading > 0 ? 'visible' : 'hidden');
  setStyle('reloadFill', 'width', player.reloading > 0 ? ((1 - player.reloading / player.reloadTotal) * 100).toFixed(0) + '%' : '0%');
  // ability cooldown rings
  const airF = player.airCd / 25, shF = player.shieldT > 0 ? 0 : player.shieldCd / 20, daF = player.dashCd / DASH_CD;
  setStyle('rgAir', 'strokeDashoffset', (RC * airF).toFixed(1)); setStyle('rgShield', 'strokeDashoffset', (RC * shF).toFixed(1)); setStyle('rgDash', 'strokeDashoffset', (RC * daF).toFixed(1));
  setText('cdtAir', player.airCd > 0 ? Math.ceil(player.airCd) + 's' : ''); setText('cdtShield', player.shieldT > 0 ? 'ON' : player.shieldCd > 0 ? Math.ceil(player.shieldCd) + 's' : '');
  setCls(el.abAir, 'ready', airF <= 0); setCls(el.abShield, 'ready', shF <= 0); setCls(el.abDash, 'ready', daF <= 0);
  setCls(el.abDrone, 'off', !save.drone); setCls(el.abDrone, 'ready', !!save.drone);
  if (isTouch) {
    setStyle('rgTAir', 'strokeDashoffset', (TC * airF).toFixed(1)); setStyle('rgTShield', 'strokeDashoffset', (TC * shF).toFixed(1)); setStyle('rgTDash', 'strokeDashoffset', (TC * daF).toFixed(1));
    setStyle('rgFire', 'strokeDashoffset', player.reloading > 0 ? (TC * player.reloading / player.reloadTotal).toFixed(1) : String(TC));
    setCls(el.tAir, 'cool', airF > 0); setCls(el.tShield, 'cool', shF > 0); setCls(el.tDash, 'cool', daF > 0);
    setCls(el.autoTag, 'on', autoFireOn);
  }
  const hurt = Math.max(player.hurtT * 1.6, player.alive ? (1 - hpF) * 0.45 : 0.8);
  setStyle('dmgVig', 'opacity', String((Q.post ? hurt * 0.45 : hurt).toFixed(2)));
  setStyle('shieldVig', 'opacity', player.shieldT > 0 ? '1' : '0');
  gradePass.uniforms.uHurt.value = Math.min(1, player.hurtT * 2 + (hpF < 0.3 && player.alive ? (0.3 - hpF) * 2 * (0.6 + 0.4 * Math.sin(game.time * 6)) : 0));
  gradePass.uniforms.uShield.value = player.shieldT > 0 ? 1 : 0;
  const b = game.boss && !game.boss.dying;
  if (hudCache.bb !== b) { hudCache.bb = b; $('bossBar').classList.toggle('hidden', !b); }
  if (b) { const bw = (game.boss.hp / game.boss.maxHp * 100).toFixed(1) + '%'; setStyle('bossFill', 'width', bw); setStyle('bossGhost', 'width', bw); setText('bossPhase', 'PHASE ' + game.boss.phase); }
  // dynamic crosshair (spreads with movement / recoil bloom)
  if ((aimTick = (aimTick + 1) % 3) === 0 && !isTouch) { camera.getWorldDirection(_dir); aimOnEnemy = !!castRay(camera.position, _dir, 120, camera.position.distanceTo(player.pos) - 1.2).e; }
  const sp = Math.max(0, (player.moving ? 4 : 0) + (player.sprinting ? 6 : 0) + (player.grounded ? 0 : 7) + player.bloom * 0.9 - (player.ads ? 3 : 0));
  if (Math.abs((hudCache.sp || 0) - sp) > 0.25) { hudCache.sp = sp; el.reticle.style.setProperty('--sp', sp.toFixed(1)); }
  setCls(el.reticle, 'ads', player.ads); setCls(el.reticle, 'on', isTouch ? autoFireOn : aimOnEnemy);
  setCls(el.scope, 'on', player.ads && player.weapon === 1);
  if (settings.fps) setText('fpsTxt', Math.round(perf.fps) + ' FPS · ' + curQ.toUpperCase());
  if ((radarTick = (radarTick + 1) % 3) === 0) drawRadar();
}
function drawRadar() {
  const W = 160, c = W / 2, R = 76, S = R / 55;
  rctx.clearRect(0, 0, W, W);
  const g = rctx.createRadialGradient(c, c, 4, c, c, R); g.addColorStop(0, 'rgba(10,30,50,.75)'); g.addColorStop(1, 'rgba(4,10,22,.6)');
  rctx.fillStyle = g; rctx.beginPath(); rctx.arc(c, c, R, 0, 7); rctx.fill();
  rctx.strokeStyle = 'rgba(41,240,255,.22)'; rctx.lineWidth = 1;
  for (const k of [0.33, 0.66]) { rctx.beginPath(); rctx.arc(c, c, R * k, 0, 7); rctx.stroke(); }
  rctx.beginPath(); rctx.moveTo(c - R, c); rctx.lineTo(c + R, c); rctx.moveTo(c, c - R); rctx.lineTo(c, c + R); rctx.stroke();
  rctx.strokeStyle = 'rgba(41,240,255,.65)'; rctx.lineWidth = 1.5; rctx.beginPath(); rctx.arc(c, c, R - 1, 0, 7); rctx.stroke();
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw), rx = Math.cos(player.yaw), rz = -Math.sin(player.yaw);
  const plot = (x, z, col, r, glow) => {
    const dx = x - player.pos.x, dz = z - player.pos.z; let lx = (dx * rx + dz * rz) * S, ly = -(dx * fx + dz * fz) * S; const d = Math.hypot(lx, ly);
    if (d > R - 4) { lx = lx / d * (R - 4); ly = ly / d * (R - 4); }
    rctx.shadowColor = col; rctx.shadowBlur = glow; rctx.fillStyle = col; rctx.beginPath(); rctx.arc(c + lx, c + ly, r, 0, 7); rctx.fill();
  };
  plot(0, 0, '#ffc94a', 5, 10);
  for (const e of enemies) if (!e.dying) plot(e.pos.x, e.pos.z, e.type === 'boss' ? '#ff2bd6' : '#ff3d5a', e.type === 'soldier' ? 2.2 : e.type === 'boss' ? 5 : 3.6, 6);
  rctx.shadowBlur = 0;
  // view cone
  rctx.fillStyle = 'rgba(41,240,255,.12)'; rctx.beginPath(); rctx.moveTo(c, c); rctx.arc(c, c, R * 0.6, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55); rctx.fill();
  rctx.fillStyle = '#29f0ff'; rctx.shadowColor = '#29f0ff'; rctx.shadowBlur = 8; rctx.beginPath(); rctx.moveTo(c, c - 7); rctx.lineTo(c - 5, c + 5); rctx.lineTo(c + 5, c + 5); rctx.fill(); rctx.shadowBlur = 0;
}

// ---------------------------------------------------------------- flow
const screens = ['menu', 'levels', 'shop', 'settings', 'help', 'pause', 'end'];
function show(id) { screens.forEach((s) => $(s).classList.toggle('hidden', s !== id)); document.body.classList.toggle('inmenu', ['menu', 'levels', 'shop', 'settings', 'help'].includes(id)); }
function resetWorld() {
  for (let i = enemies.length - 1; i >= 0; i--) releaseEnemy(i);
  for (const p of projs) { p.on = false; p.m.visible = false; }
  for (const p of pickups) { p.on = false; p.m.visible = false; }
  for (const r of rings) { r.life = 0; r.m.visible = false; }
  for (const d of decals) d.visible = false;
  for (const b of barrels) { b.alive = true; b.hp = 30; b.mesh.visible = true; }
  game.strikes.length = 0; jet.visible = false;
}
function startLevel(mode, level = 1) {
  Sfx.init(); resetWorld();
  game.mode = mode; game.level = level; game.kills = 0; game.score = 0; game.coinsRun = 0; game.boss = null; game.bossDone = false; game.time = 0;
  const cfg = mode === 'survival' ? { waves: Infinity, boss: false, hpMul: 1, theme: 1 } : levelConfig(level);
  game.waves = cfg.waves; game.isBossLevel = cfg.boss; game.hpMul = cfg.hpMul; game.baseMax = game.baseHp = 900 + level * 120 + (mode === 'survival' ? 600 : 0);
  setTheme(cfg.theme);
  player.maxHp = 100 + save.armor * 20; player.hp = player.maxHp; player.alive = true; player.pos.set(0, 0, 11); player.vel.set(0, 0, 0);
  player.yaw = Math.PI; player.pitch = 0.05; player.ammo = WEAPONS.map((w) => w.mag); player.reloading = 0; player.airCd = 0; player.shieldCd = 0; player.shieldT = 0; player.ads = false;
  pm.rotation.set(0, player.yaw, 0); firing = false; game.regenT = 0;
  player.weapon = -1; setWeapon(0);
  game.state = 'play'; show(null); $('hud').classList.remove('hidden'); $('touch').classList.toggle('hidden', !isTouch);
  joyReset(); aimT.id = null; aimPend.x = aimPend.y = 0; adsToggle = false; $('tAds').classList.remove('on');
  player.y = 0; player.vy = 0; player.grounded = true; player.dashT = 0; player.dashCd = 0; player.bloom = 0; player.sprinting = false;
  camInit = true; game.comboN = 0; game.comboT = 0; game.bestCombo = 0; timeScale = 1; slowT = 0; slowTarget = 1; jet.visible = false;
  $('killfeed').innerHTML = ''; DN.forEach((d) => { d.life = 0; d.el.style.opacity = '0'; }); DD.forEach((d) => { d.life = 0; d.el.style.opacity = '0'; });
  const fo = $('flashOv'); fo.classList.remove('go'); void fo.offsetWidth; fo.classList.add('go');
  game.between = 0; game.queue = []; startWave(1);
  if (mode === 'campaign') showBanner(`LEVEL ${level}`, LEVEL_NAMES[level - 1].toUpperCase() + (cfg.boss ? ' · BOSS' : ''), 2.2, cfg.boss);
  if (isTouch) { try { const el = document.documentElement; if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen().then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {})).catch(() => {}); } catch (e) { /* ignore */ } }
}
function updateWaves(dt) {
  if (game.state !== 'play') return;
  if (game.queue.length) {
    game.spawnT -= dt;
    for (let n = 0; n < 3 && game.queue.length && game.spawnT <= 0 && game.alive < Q.maxAlive; n++) {
      game.spawnT += isTouch ? 0.35 : 0.12;
      const type = game.queue.shift(); const g = SPAWNS[game.waveGates[Math.floor(Math.random() * 3)]];
      spawnEnemy(type, g[0] + rand(-4, 4), g[1] + rand(-4, 4), game.hpMul);
      game.alive++;
    }
    if (game.spawnT < -1) game.spawnT = 0;
    return;
  }
  if (game.alive > 0) return;
  if (game.between > 0) { game.between -= dt; if (game.between <= 0) startWave(game.wave + 1); return; }
  if (game.boss) { if (game.boss.dying && !game.bossDone) { game.bossDone = true; endGame(true, 'Boss destroyed'); } return; }
  if (game.wave < game.waves) {
    game.between = 3; game.score += 500; showBanner('WAVE CLEARED', `+500 · NEXT WAVE IN 3`, 2.5);
    if (game.mode === 'survival' && game.wave % 5 === 0) { player.airCd = 0; player.shieldCd = 0; }
  } else if (game.isBossLevel) {
    const g = SPAWNS[Math.floor(Math.random() * 8)];
    game.boss = spawnEnemy('boss', g[0] * 0.9, g[1] * 0.9, game.hpMul); game.alive++;
    showBanner('WARNING', 'IRON GOLIATH APPROACHING', 3, true); Sfx.alarm(); shake = 0.6;
  } else endGame(true, 'All waves eliminated');
}
function endGame(win, reason) {
  if (game.state !== 'play') return;
  game.state = 'ending'; game.endWin = win; game.endReason = reason; game.endT = win ? 2.2 : 2.0; firing = false;
  if (document.pointerLockElement) { wasLocked = false; document.exitPointerLock(); }
  if (win) Sfx.win(); else Sfx.lose();
  showBanner(win ? 'MISSION COMPLETE' : 'MISSION FAILED', reason.toUpperCase(), 2, !win);
}
function finishEnd() {
  game.state = 'end'; const win = game.endWin;
  let bonus = 0, extra = '';
  if (game.mode === 'campaign') {
    if (win) {
      bonus = 40 + game.level * 25; save.cleared[game.level] = true; save.unlocked = Math.max(save.unlocked, Math.min(10, game.level + 1));
      if (game.level >= 3 && !save.drone) { save.drone = true; extra = '<br><b>COMBAT DRONE UNLOCKED!</b>'; }
    }
  } else { if (game.score > save.best) { save.best = game.score; extra = '<br><b>NEW BEST SCORE!</b>'; } }
  save.coins += game.coinsRun + bonus; persist();
  $('endTitle').textContent = win ? 'MISSION COMPLETE' : (game.mode === 'survival' ? 'SURVIVAL OVER' : 'MISSION FAILED');
  $('endTitle').style.color = win ? '#ffc440' : '#ff5a4a';
  $('endStats').innerHTML = `${game.endReason}<br>Score <b>${game.score.toLocaleString()}</b> · Kills <b>${game.kills}</b>` + (game.mode === 'survival' ? ` · Wave <b>${game.wave}</b>` : '') + (game.bestCombo > 1 ? ` · Best combo <b>x${game.bestCombo}</b>` : '') +
    `<br>Credits earned <b>◆ ${game.coinsRun + bonus}</b>${bonus ? ` (incl. ${bonus} mission bonus)` : ''}${extra.replace('<br><b>', '<br><b class="unlock">')}`;
  $('bNext').classList.toggle('hidden', !(win && game.mode === 'campaign' && game.level < 10));
  $('hud').classList.add('hidden'); $('touch').classList.add('hidden'); show('end');
}
function pauseGame() { if (game.state !== 'play') return; game.state = 'paused'; firing = false; show('pause'); if (document.pointerLockElement) { wasLocked = false; document.exitPointerLock(); } }
function resumeGame() { if (game.state !== 'paused') return; game.state = 'play'; show(null); Sfx.init(); }
function toMenu() { resetWorld(); menuJet = 3; game.state = 'menu'; $('hud').classList.add('hidden'); $('touch').classList.add('hidden'); setTheme(0); refreshMenu(); show('menu'); }
function refreshMenu() { $('menuCoins').textContent = '◆ ' + save.coins; $('menuBest').textContent = save.best.toLocaleString(); $('menuQ').textContent = (settings.quality === 'auto' && !URLQ ? 'AUTO · ' : '') + curQ.toUpperCase(); }
const THEME_BG = ['linear-gradient(160deg,#2b6cb0,#c9a46a)', 'linear-gradient(160deg,#3b2a6b,#e2725b)', 'linear-gradient(160deg,#4a5866,#9aa6ad)', 'linear-gradient(160deg,#0b0b1e,#5a1f3f)'];
const THEME_NM = ['DAY', 'DUSK', 'OVERCAST', 'NIGHT OPS'];
function buildLevels() {
  const grid = $('levelGrid'); grid.innerHTML = '';
  for (let L = 1; L <= 10; L++) {
    const cfg = levelConfig(L), lockedL = L > save.unlocked;
    const b = document.createElement('button'); b.className = 'card' + (cfg.boss ? ' boss' : ''); b.disabled = lockedL;
    b.style.setProperty('--cbg', THEME_BG[cfg.theme]); b.style.animationDelay = (L * 0.035) + 's';
    const chip = lockedL ? '<span class="chip">🔒 LOCKED</span>' : save.cleared[L] ? '<span class="chip ok">✓ CLEARED</span>' : cfg.boss ? '<span class="chip boss">☠ BOSS</span>' : '';
    b.innerHTML = `${chip}<span class="num">${String(L).padStart(2, '0')}</span><span class="nm">${LEVEL_NAMES[L - 1].toUpperCase()}</span><span class="meta">${cfg.waves} WAVES${cfg.boss ? ' + BOSS' : ''} · ${THEME_NM[cfg.theme]}</span>`;
    b.onclick = () => { Sfx.ui(); startLevel('campaign', L); }; grid.appendChild(b);
  }
}
// ---------------------------------------------------------------- armory (3D weapon preview)
const SHOP = [
  { k: 'dmg', ic: '✸', name: 'WEAPON DAMAGE', desc: '+15% damage per level', max: 10 },
  { k: 'rel', ic: '⟳', name: 'RELOAD SPEED', desc: '+15% reload speed per level', max: 10 },
  { k: 'armor', ic: '⬢', name: 'BODY ARMOR', desc: '+20 max HP per level', max: 10 },
  { k: 'drone', ic: '◆', name: 'COMBAT DRONE', desc: 'Auto-targets nearby enemies (free after level 3)', max: 1, cost: 400 },
];
const PV_ITEMS = [
  { name: 'M4 MACHINE GUN', st: [14 / 60, 1, 1, 0.75] }, { name: 'DMR RIFLE', st: [1, 0.26, 0.3, 0.9] },
  { name: 'ROCKET LAUNCHER', st: [1, 0.1, 0.1, 0.5] }, { name: 'COMBAT DRONE', st: [0.18, 0.7, 1, 1] },
];
let pv = null, pvIdx = 0, pvSpin = 0;
function pvBuild() {
  const cv = $('pv');
  const r = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
  r.setPixelRatio(Math.min(devicePixelRatio, 2)); r.toneMapping = THREE.ACESFilmicToneMapping; r.outputColorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Scene(), cam = new THREE.PerspectiveCamera(32, 1, 0.1, 50); cam.position.set(0, 0.9, 4.2); cam.lookAt(0, 0.1, 0);
  s.add(new THREE.HemisphereLight(0xbfe8ff, 0x201030, 1.4));
  const k = new THREE.DirectionalLight(0xffffff, 2.2); k.position.set(2, 3, 2); s.add(k);
  const c1 = new THREE.PointLight(0x29f0ff, 14, 8); c1.position.set(-2, 1, 1); s.add(c1);
  const c2 = new THREE.PointLight(0xff2bd6, 14, 8); c2.position.set(2, -0.5, -1); s.add(c2);
  const plat = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.02, 6, 80), NEON.c); plat.rotation.x = Math.PI / 2; plat.position.y = -0.55; s.add(plat);
  const plat2 = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.012, 6, 80), NEON.m); plat2.rotation.x = Math.PI / 2; plat2.position.y = -0.55; s.add(plat2);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1.3, 48), new THREE.MeshBasicMaterial({ color: 0x29f0ff, transparent: true, opacity: 0.08, side: THREE.DoubleSide })); disc.rotation.x = -Math.PI / 2; disc.position.y = -0.56; s.add(disc);
  const models = [];
  const mk = (f) => { const g = new THREE.Group(); f(g); g.visible = false; s.add(g); models.push(g); };
  mk((g) => { part(G.box, M.pDark, 0.14, 0.2, 1.3, 0, 0, 0, g); part(G.box, M.pDark, 0.1, 0.34, 0.12, 0, -0.24, 0.15, g); part(G.box, M.metal, 0.12, 0.14, 0.4, 0, -0.03, 0.75, g); part(G.cyl, M.metal, 0.05, 0.5, 0.05, 0, 0.02, -0.85, g).rotation.x = Math.PI / 2; part(G.box, NEON.c, 0.145, 0.025, 1.0, 0, 0.05, -0.05, g, false); part(G.box, M.metal, 0.06, 0.24, 0.1, 0, -0.2, -0.2, g); });
  mk((g) => { part(G.box, M.metal, 0.12, 0.16, 1.8, 0, 0, 0, g); part(G.cyl, M.pDark, 0.08, 0.55, 0.08, 0, 0.17, 0.05, g).rotation.x = Math.PI / 2; part(G.box, M.pDark, 0.1, 0.3, 0.1, 0, -0.2, 0.35, g); part(G.box, NEON.m, 0.125, 0.025, 1.4, 0, -0.06, -0.1, g, false); part(G.sph, NEON.c, 0.07, 0.07, 0.07, 0, 0.17, -0.24, g, false); });
  mk((g) => { part(G.cyl, M.hqDark, 0.22, 1.9, 0.22, 0, 0, 0, g).rotation.x = Math.PI / 2; part(G.box, M.pDark, 0.12, 0.3, 0.14, 0, -0.24, 0.15, g); part(G.cyl, NEON.a, 0.23, 0.08, 0.23, 0, 0, -0.95, g, false).rotation.x = Math.PI / 2; part(G.cyl, NEON.m, 0.23, 0.04, 0.23, 0, 0, 0.6, g, false).rotation.x = Math.PI / 2; part(G.box, M.metal, 0.08, 0.12, 0.3, 0, 0.18, -0.2, g); });
  mk((g) => { const d = drone.clone(); d.position.set(0, 0, 0); d.rotation.set(0, 0, 0); d.scale.setScalar(2.2); g.add(d); });
  pv = { r, s, cam, models, plat, plat2 };
}
function pvShow(i) {
  pvIdx = (i + PV_ITEMS.length) % PV_ITEMS.length; const it = PV_ITEMS[pvIdx];
  if (pv) pv.models.forEach((m, j) => { m.visible = j === pvIdx; if (j === pvIdx) m.scale.setScalar(0.6); });
  $('pvName').textContent = it.name;
  const lbl = ['DAMAGE', 'FIRE RATE', 'MAGAZINE', 'HANDLING'];
  const dm = 1 + save.dmg * 0.15;
  $('pvStats').innerHTML = it.st.map((v, j) => `<div class="stat">${lbl[j]}<div><i style="width:${Math.round(clamp(j === 0 ? v * Math.min(dm, 2) / 1.2 : v, 0.04, 1) * 100)}%"></i></div></div>`).join('');
}
function pvResize() { if (!pv) return; const cv = $('pv'), w = cv.clientWidth || 300, h = cv.clientHeight || 220; pv.r.setSize(w, h, false); pv.cam.aspect = w / h; pv.cam.updateProjectionMatrix(); }
function pvFrame(dt) {
  if (!pv || $('shop').classList.contains('hidden')) return;
  pvSpin += dt * 0.7; const m = pv.models[pvIdx]; m.rotation.set(0.15 + Math.sin(pvSpin * 0.7) * 0.08, pvSpin, 0); m.position.y = 0.1 + Math.sin(pvSpin * 1.6) * 0.05;
  const sc = lerp(m.scale.x, 1, Math.min(1, dt * 8)); m.scale.setScalar(sc);
  pv.plat.rotation.z += dt * 0.5; pv.plat2.rotation.z -= dt * 0.8;
  pv.r.render(pv.s, pv.cam);
}
$('pvPrev').onclick = () => { Sfx.ui(); pvShow(pvIdx - 1); };
$('pvNext').onclick = () => { Sfx.ui(); pvShow(pvIdx + 1); };
function buildShop() {
  $('shopCoins').textContent = '◆ ' + save.coins; const list = $('shopList'); list.innerHTML = '';
  for (const it of SHOP) {
    const lv = it.k === 'drone' ? (save.drone ? 1 : 0) : save[it.k]; const cost = it.cost || 80 + lv * 70; const maxed = lv >= it.max;
    const row = document.createElement('div'); row.className = 'item';
    const pips = it.max > 1 ? `<div class="lvl">${Array.from({ length: it.max }, (_, j) => `<i class="${j < lv ? 'on' : ''}"></i>`).join('')}</div>` : '';
    row.innerHTML = `<div class="ic">${it.ic}</div><div class="tx"><b>${it.name}${it.max > 1 ? ` · LV ${lv}/${it.max}` : ''}</b><small>${it.desc}</small>${pips}</div>`;
    const b = document.createElement('button'); b.className = 'buy'; b.textContent = maxed ? (it.k === 'drone' ? 'OWNED' : 'MAX') : `◆ ${cost}`; b.disabled = maxed || save.coins < cost;
    b.onclick = (ev) => { ev.stopPropagation(); if (save.coins < cost) return; save.coins -= cost; if (it.k === 'drone') save.drone = true; else save[it.k]++; persist(); Sfx.coin(); buildShop(); };
    if (it.k === 'drone') row.onclick = () => pvShow(3); else if (it.k === 'dmg') row.onclick = () => pvShow(pvIdx === 3 ? 0 : pvIdx);
    row.appendChild(b); list.appendChild(row);
  }
  if (!pv) { try { pvBuild(); } catch (e) { console.warn('preview unavailable', e); } }
  pvShow(pvIdx); requestAnimationFrame(pvResize);
}
// ---------------------------------------------------------------- settings
let settingsFrom = 'menu';
const TOGS = { sAuto: 'autoFire', sAssist: 'assist', sHaptic: 'haptic', sInvert: 'invert', sFps: 'fps' };
function buildSettings() {
  document.querySelectorAll('#sQuality button').forEach((b) => b.classList.toggle('on', b.dataset.v === settings.quality));
  $('sSens').value = settings.sens; $('sSensV').textContent = (+settings.sens).toFixed(1);
  $('sSmooth').value = settings.smooth; $('sSmoothV').textContent = (+settings.smooth).toFixed(2);
  for (const id in TOGS) $(id).classList.toggle('on', !!settings[TOGS[id]]);
  $('fpsTxt').classList.toggle('hidden', !settings.fps);
}
document.querySelectorAll('#sQuality button').forEach((b) => (b.onclick = () => {
  Sfx.ui(); settings.quality = b.dataset.v; persistSettings(); qDowngrades = 0; perf.slow = 0;
  applyQuality(settings.quality === 'auto' ? autoLevel() : settings.quality); buildSettings(); refreshMenu();
}));
$('sSens').oninput = () => { settings.sens = +$('sSens').value; persistSettings(); buildSettings(); };
$('sSmooth').oninput = () => { settings.smooth = +$('sSmooth').value; persistSettings(); buildSettings(); };
for (const id in TOGS) $(id).onclick = () => { Sfx.ui(); settings[TOGS[id]] = !settings[TOGS[id]]; persistSettings(); buildSettings(); if (id === 'sHaptic' && settings.haptic) buzz(30, true); };

$('bCampaign').onclick = () => { Sfx.init(); Sfx.ui(); buildLevels(); show('levels'); };
$('bSurvival').onclick = () => { Sfx.ui(); startLevel('survival', 1); };
$('bShop').onclick = () => { Sfx.init(); Sfx.ui(); show('shop'); buildShop(); };
$('bHelp').onclick = () => { Sfx.init(); Sfx.ui(); show('help'); };
$('bSettings').onclick = () => { Sfx.init(); Sfx.ui(); settingsFrom = 'menu'; buildSettings(); show('settings'); };
$('bPSettings').onclick = () => { Sfx.ui(); settingsFrom = 'pause'; buildSettings(); show('settings'); };
document.querySelectorAll('.back').forEach((b) => (b.onclick = () => { Sfx.ui(); refreshMenu(); show('menu'); }));
$('setBack').onclick = () => { Sfx.ui(); refreshMenu(); show(settingsFrom === 'pause' && game.state === 'paused' ? 'pause' : 'menu'); };
$('bResume').onclick = resumeGame;
$('bRestart').onclick = () => startLevel(game.mode, game.level);
$('bQuit').onclick = toMenu;
$('bNext').onclick = () => startLevel('campaign', Math.min(10, game.level + 1));
$('bRetry').onclick = () => startLevel(game.mode, game.level);
$('bEndMenu').onclick = toMenu;
document.querySelectorAll('.btn,.card,.buy,.ghostBtn').forEach((b) => b.addEventListener('pointerenter', () => Sfx.ctx && Sfx.tn && Sfx.tn(1400, 0.03, 0.015, 'sine')));

// ---------------------------------------------------------------- resize / quality
function setScale() { const h = renderer.getDrawingBufferSize(new THREE.Vector2()).y; const s = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)); fire.mat.uniforms.uScale.value = s; smoke.mat.uniforms.uScale.value = s; fire.mat.uniforms.uMax.value = smoke.mat.uniforms.uMax.value = h * 0.22; }
function onResize() {
  renderer.setPixelRatio(Q.pr); renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  composer.setPixelRatio(Q.pr); composer.setSize(innerWidth, innerHeight);
  fxaaPass.material.uniforms.resolution.value.set(1 / (innerWidth * Q.pr), 1 / (innerHeight * Q.pr));
  setScale(); pvResize();
}
addEventListener('resize', onResize);
let curQ = 'high';
function applyQuality(lv) {
  const P = PRESETS[lv] || PRESETS.medium; curQ = lv;
  Q.pr = Math.min(Q.prMax, P.pr); Q.post = P.post; Q.bloomRes = P.bloomRes; Q.fx = P.fx; Q.lightsUse = Math.max(1, Math.min(Q.lights, P.lights));
  bloomPass.enabled = P.post; fxaaPass.enabled = P.fxaa; gradePass.uniforms.uCA.value = P.ca;
  if (renderer.shadowMap.enabled !== P.shadows) { renderer.shadowMap.enabled = P.shadows; scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => (m.needsUpdate = true)); }); }
  if (sun.shadow.mapSize.x !== P.shadow) { sun.shadow.mapSize.set(P.shadow, P.shadow); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
  shafts.forEach((s) => (s.visible = P.shafts));
  scene.traverse((o) => { if (o.userData.deco) o.visible = P.env; });
  let relink = false;
  if (Q.env !== P.env) { Q.env = P.env; scene.environment = P.env ? envFor(curTheme % THEMES.length) : null; hemi.intensity = THEMES[curTheme % THEMES.length].hemiI * (P.env ? 0.5 : 1.15); relink = true; }
  flashLights.forEach((f, j) => { const v = j < Q.lightsUse; if (f.l.visible !== v) { f.l.visible = v; relink = true; } });
  if (relink) scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => (m.needsUpdate = true)); });
  Q.maxAlive = Math.min(Q.baseAlive, P.alive);
  fire.mat.uniforms.uBoost.value = P.post ? 1.5 : 1.1;
  onResize(); if ($('menuQ')) refreshMenu();
}
const perf = { frames: 0, t: 0, fps: 60, slow: 0 };
function autoQuality(dt) {
  perf.frames++; perf.t += dt; if (perf.t < 2) return;
  perf.fps = perf.frames / perf.t; perf.frames = 0; perf.t = 0;
  if (game.state !== 'play' || NOAUTO || URLQ || settings.quality !== 'auto') { perf.slow = 0; return; }
  const i = QORDER.indexOf(curQ);
  if (perf.fps < 30) {
    if (++perf.slow < 2) return; perf.slow = 0;
    if (i > 0) { qDowngrades++; applyQuality(QORDER[i - 1]); }
    else if (Q.pr > 0.75) { Q.pr = Math.max(0.75, Q.pr - 0.25); onResize(); }
    else Q.maxAlive = Math.max(24, Q.maxAlive - 10);
  } else {
    perf.slow = 0;
    if (perf.fps > 58 && qDowngrades === 0 && i < (isTouch ? 1 : 2)) applyQuality(QORDER[i + 1]);
  }
}

// ---------------------------------------------------------------- main loop
let lastT = performance.now();
const NOAUTO = /[?&]noauto/.test(location.search);
// menu: cinematic camera fly-through around the base + periodic jet flybys
const menuPath = new THREE.CatmullRomCurve3([
  new V3(34, 13, 30), new V3(8, 5, 26), new V3(-22, 9, 18), new V3(-30, 16, -14), new V3(-6, 6, -30), new V3(24, 4, -20), new V3(40, 11, 4),
], true, 'catmullrom', 0.5);
const menuLook = new V3(0, 3, 0), _ml = new V3();
let menuT = 0, menuJet = 4;
function updateMenu(dt) {
  menuT = (menuT + dt * 0.012) % 1; menuPath.getPointAt(menuT, camera.position);
  _ml.set(Math.sin(game.time * 0.2) * 4, 3 + Math.sin(game.time * 0.3), Math.cos(game.time * 0.17) * 4); menuLook.lerp(_ml, Math.min(1, dt));
  camera.lookAt(menuLook);
  if (Math.abs(camera.fov - 58) > 0.01) { camera.fov = 58; camera.updateProjectionMatrix(); setScale(); }
  if (game.state === 'menu' && !game.strikes.length) {
    menuJet -= dt;
    if (menuJet < 0) { const jt = -menuJet / 3.2, a = 0.7; if (jt < 1) { jet.visible = true; const dx = Math.sin(a), dz = Math.cos(a); jet.position.set(dx * lerp(-140, 140, jt), 24, dz * lerp(-140, 140, jt) - 10); jet.lookAt(jet.position.x - dx, 24, jet.position.z - dz); jetFlame.scale.z = rand(0.8, 1.6); if (Math.random() < 0.6) smoke.spawn(jet.position.x, 24, jet.position.z, 0, 0, 0, 1.4, 0.7, 2.2, 0.9, 0.9, 0.95, 0, 0.5); } else { jet.visible = false; menuJet = rand(7, 11); } }
  }
}
const beaconBase = HDR(0xff2848, 4);
const gateBase = HDR(0xff2848, 2.6);
function updateFx(dt) {
  fire.update(dt); smoke.update(dt);
  for (const t of tracers) if (t.life > 0) { t.life -= dt; if (t.life <= 0) t.m.visible = false; }
  for (const f of flashLights) if (f.life > 0) { f.life -= dt; f.l.intensity = Math.max(0, f.life / f.max) * f.peak; }
  for (const r of rings) if (r.life > 0) { r.life -= dt; r.m.material.opacity = 0.4 + Math.abs(Math.sin(game.time * 10)) * 0.5; if (r.life <= 0) r.m.visible = false; }
  for (const w of waves) if (w.life > 0) { w.life -= dt; const k = 1 - w.life / w.max, e = 1 - (1 - k) * (1 - k); const s = w.r * (0.15 + e); w.m.scale.set(s, 1, s); w.m.material.opacity = (1 - k) * 0.95; if (w.life <= 0) w.m.visible = false; }
  for (const b of balls) if (b.life > 0) { b.life -= dt; const k = 1 - b.life / b.max; b.m.scale.setScalar(b.r * (0.35 + k * 0.9)); b.m.material.opacity = (1 - k) * 0.85; if (b.life <= 0) b.m.visible = false; }
  updateDebris(dt);
  const pulse = 0.5 + 0.5 * Math.sin(game.time * 4);
  for (const bm of beacons) bm.color.copy(beaconBase).multiplyScalar(0.2 + pulse * 0.8);
  gateMat.color.copy(gateBase).multiplyScalar(0.6 + 0.4 * Math.sin(game.time * 3));
  holo.rotation.z += dt * 0.8; holo2.rotation.z -= dt * 1.3; holo.position.y = 7.2 + Math.sin(game.time * 1.5) * 0.15;
  beam.material.opacity = 0.28 + Math.sin(game.time * 2.2) * 0.07; beam.rotation.y += dt * 0.4;
  flag.rotation.y = Math.sin(game.time * 2) * 0.2;
  dish.rotation.y += dt * 0.6;
}
let motion = 0;
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now(); const rdt = Math.min((now - lastT) / 1000, 0.05); lastT = now;
  autoQuality(rdt);
  if (slowT > 0) { slowT -= rdt; if (slowT <= 0) slowTarget = 1; }
  timeScale = lerp(timeScale, slowTarget, 1 - Math.exp(-rdt * (slowTarget < timeScale ? 16 : 3)));
  if (game.state !== 'play' && game.state !== 'ending') { timeScale = 1; slowT = 0; slowTarget = 1; }
  const dt = rdt * timeScale;
  if (game.state === 'play' || game.state === 'ending') {
    game.time += dt;
    if (game.comboT > 0) { game.comboT -= dt; if (game.comboT <= 0) game.comboN = 0; }
    updatePlayer(dt); updateCamera(rdt); updateEnemies(dt); updateProjs(dt); updateStrikes(dt); updateWaves(dt); updateFx(dt);
    updateHUD(rdt); updateDmgNumbers(rdt); updateHurtDirs(rdt);
    sun.target.position.set(player.pos.x, 0, player.pos.z); sun.position.copy(sun.target.position).add(_tmp.copy(sunDir));
    updateShafts(player.pos.x, player.pos.z);
    motion = lerp(motion, (player.dashT > 0 ? 1 : player.sprinting ? 0.22 : 0) + (1 - timeScale) * 0.7, Math.min(1, rdt * 10));
    if (game.state === 'ending') { game.endT -= rdt; if (game.endT <= 0) finishEnd(); }
  } else if (game.state === 'menu' || game.state === 'end') {
    game.time += rdt; updateMenu(rdt);
    updateFx(rdt); if (game.state === 'end') updateEnemies(rdt);
    sun.target.position.set(0, 0, 0); sun.position.copy(sunDir); updateShafts(0, 0);
    pm.position.set(0, 0, 11); pm.rotation.set(0, Math.PI, 0); pLegL.rotation.x = pLegR.rotation.x = 0;
    motion = lerp(motion, 0, Math.min(1, rdt * 6));
  }
  gradePass.uniforms.uTime.value = now / 1000; gradePass.uniforms.uMotion.value = motion;
  if (Q.post) composer.render(rdt); else renderer.render(scene, camera);
  pvFrame(rdt);
}
window.addEventListener('error', (e) => console.error('Runtime error:', e.message));

// boot
prewarm();
setTheme(0);
{ // dissolve shader warm-up mesh (hidden under the base) so the first kill doesn't hitch
  const wm = disPool[disPool.length - 1]; const dm = new THREE.Mesh(G.box, new THREE.MeshStandardMaterial()); dm.material = wm.clone(); dm.material.userData = { u: wm.userData.u }; dm.material.onBeforeCompile = wm.onBeforeCompile; dm.material.customProgramCacheKey = wm.customProgramCacheKey;
  dm.position.set(0, -6, 0); dm.scale.setScalar(0.1); scene.add(dm);
}
applyQuality(URLQ || (settings.quality === 'auto' ? autoLevel() : settings.quality));
buildSettings();
Object.defineProperty(window, 'SS', { value: { game, player, enemies, Q, save, settings, startLevel, perf, renderer, composer, scene, shafts, setWeapon, airstrike, shieldUp, dash, jump, slowMo, applyQuality, castRay, camera, HIT,
  quality: () => curQ, timeScale: () => timeScale, killAll: () => enemies.forEach((e) => { if (!e.dying) killEnemy(e); }) } });
setScale(); refreshMenu(); show('menu');
player.weapon = -1; setWeapon(0);
try { renderer.compile(scene, camera); } catch (e) { /* ignore */ }
frame();
