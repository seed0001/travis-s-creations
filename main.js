/* ============================================================
   main.js — 6 distinct Three.js worlds
   Outer Galaxy → Solar System → Earth Orbit →
   City Grid → Living Cell → Molecule

   Each world is a self-contained Three.js Group with its own
   geometry, materials, and update loop.
   Cinematic black-cut transitions between worlds.
   ============================================================ */

'use strict';

// ─────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────
const GH_USER = 'seed0001';
const GH_API  = `https://api.github.com/users/${GH_USER}/repos?sort=updated&per_page=100`;
const LANG_COLOR = {
  Python:'#3b82f6', TypeScript:'#8b5cf6', JavaScript:'#f59e0b',
  Rust:'#f97316', Go:'#22d3ee', 'C++':'#ef4444', C:'#ef4444',
  Shell:'#22c55e', HTML:'#f97316', default:'#6b7280',
};
const lc = l => LANG_COLOR[l] || LANG_COLOR.default;

const SCALE_LABELS = [
  { num: '~100,000',  unit: 'light years' },
  { num: '~8',        unit: 'light minutes' },
  { num: '~400',      unit: 'km altitude' },
  { num: '~50',       unit: 'km overhead' },
  { num: '~0.01',     unit: 'mm scale' },
  { num: '~0.1',      unit: 'nanometers' },
];

// ─────────────────────────────────────────────────────────────
// SHARED SHADERS
// ─────────────────────────────────────────────────────────────
const PARTICLE_VERT = `
  attribute float aSize;
  attribute vec3  aColor;
  varying   vec3  vColor;
  varying   float vAlpha;
  
  uniform   float uTime;
  uniform   float uPR;
  uniform   float uScene;       // 0.0 for Galaxy, 1.0 for others
  uniform   vec3  uMousePos;    // 3D projected mouse position
  uniform   float uMouseActive; // 1.0 if mouse is on screen

  void main() {
    vColor = aColor;
    vec3 pos = position;

    // 1. Orbit for Galaxy (Scene 0) - Constant speed to preserve spiral and prevent ring shearing
    if (uScene == 0.0) {
      float r = length(pos.xz);
      if (r > 0.1) {
        float initAngle = atan(pos.z, pos.x);
        float speed = 0.065;
        // Wrap angle using modulo to prevent float precision quantization spokes
        float currentAngle = mod(initAngle + uTime * speed, 6.2831853);
        
        pos.x = cos(currentAngle) * r;
        pos.z = sin(currentAngle) * r;
      }
    }

    // 2. Mouse Gravity Interaction (displacement force)
    if (uMouseActive == 1.0) {
      float d = distance(pos, uMousePos);
      if (d < 5.5) {
        float force = pow(1.0 - d / 5.5, 2.0) * 1.5;
        vec3 dir = normalize(pos - uMousePos);
        pos += dir * force;
      }
    }

    float twinkle = 0.65 + sin(uTime * 1.6 + pos.x * 9.3 + pos.z * 7.1) * 0.35;
    vAlpha = twinkle;

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = clamp(aSize * uPR * (280.0 / -mv.z), 0.5, 14.0);
    gl_Position  = projectionMatrix * mv;
  }
`;
const PARTICLE_FRAG = `
  varying vec3  vColor;
  varying float vAlpha;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    // Smoothly fade alpha to exactly 0.0 at d=0.5 to eliminate square quad border grids
    float cutoff = smoothstep(0.5, 0.42, d);
    float a = exp(-d * 9.0) * cutoff * vAlpha;
    if (a < 0.005) discard;
    gl_FragColor = vec4(vColor, a);
  }
`;

// ─────────────────────────────────────────────────────────────
// THREE.JS CORE & INTERACTION STATE
// ─────────────────────────────────────────────────────────────
let renderer, scene, camera, clock;
let sharedUniforms;

let mouseNDX = 0, mouseNDY = 0;
const camTargetPos  = new THREE.Vector3();
const camTargetLook = new THREE.Vector3();

// Camera Orbit Dragging state
let dragTheta = 0;
let dragPhi = 0;
let isDragging = false;
let startX = 0, startY = 0;

// Mouse Raycast projection (for particle gravity physics)
const raycaster = new THREE.Raycaster();
const mouse2D   = new THREE.Vector2();
const planeXZ   = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); // Flat plane at y=0
const mouse3D   = new THREE.Vector3();
let mouseActive = 0.0;

function initThree() {
  const canvas = document.getElementById('c');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x030305, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  scene = new THREE.Scene();
  clock = new THREE.Clock();

  camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.01, 5000);

  sharedUniforms = {
    uTime:        { value: 0 },
    uPR:          { value: Math.min(window.devicePixelRatio, 2) },
    uMousePos:    { value: mouse3D },
    uMouseActive: { value: 0.0 },
    uScene:       { value: 1.0 }, // default: non-galaxy (static)
  };

  // Resize listener
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    sharedUniforms.uPR.value = Math.min(window.devicePixelRatio, 2);
  });

  // Track Mouse movement for parallax & raycasting
  document.addEventListener('mousemove', e => {
    mouseNDX = (e.clientX / window.innerWidth - 0.5) * 2;
    mouseNDY = (e.clientY / window.innerHeight - 0.5) * 2;

    mouse2D.x = mouseNDX;
    mouse2D.y = -mouseNDY;
    raycaster.setFromCamera(mouse2D, camera);
    raycaster.ray.intersectPlane(planeXZ, mouse3D);
    mouseActive = 1.0;
  });

  document.addEventListener('mouseleave', () => {
    mouseActive = 0.0;
  });

  // Mouse Drag Camera Orbit interaction
  window.addEventListener('mousedown', e => {
    if (e.target.closest('#ui') || e.target.closest('#modal')) return;
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
  });

  window.addEventListener('mousemove', e => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    dragTheta -= dx * 0.005;
    dragPhi   = Math.max(-1.3, Math.min(1.3, dragPhi + dy * 0.005));

    startX = e.clientX;
    startY = e.clientY;
  });

  window.addEventListener('mouseup',    () => isDragging = false);
  window.addEventListener('mouseleave', () => isDragging = false);
}

// ─────────────────────────────────────────────────────────────
// WORLD MANAGER
// ─────────────────────────────────────────────────────────────
const worlds = [];

class World {
  constructor(name, camPos, camLook, fogColor, fogDensity) {
    this.name      = name;
    this.camPos    = camPos;
    this.camLook   = camLook;
    this.fogColor  = fogColor;
    this.fogDensity= fogDensity;
    this.group     = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
  }
  build()      {}   // override
  tick(t, dt)  {}   // override
}

let currentWorld = -1;
let transitioning = false;
const tOverlay = document.getElementById('tOverlay');

async function showWorld(idx) {
  if (idx === currentWorld || transitioning) return;
  transitioning = true;

  // Fade to black
  tOverlay.classList.add('on');
  await sleep(600);

  // Hide old
  if (currentWorld >= 0) worlds[currentWorld].group.visible = false;

  // Reset drag variables on world shift
  dragTheta = 0;
  dragPhi = 0;

  // Switch
  currentWorld = idx;
  const w = worlds[idx];
  w.group.visible = true;

  // Set immediate targets (hidden by overlay) so the camera doesn't wildly snap from the previous section
  const basePos = w.camPos;
  const look = w.camLook;
  camTargetPos.set(basePos.x, basePos.y, basePos.z);
  camTargetLook.set(look.x, look.y, look.z);
  camera.position.copy(camTargetPos);
  camera.lookAt(camTargetLook);

  // Fog
  if (w.fogColor && w.fogDensity) {
    scene.fog = new THREE.FogExp2(w.fogColor, w.fogDensity);
  } else {
    scene.fog = null;
  }

  // Update scale label
  const sl = SCALE_LABELS[idx];
  document.getElementById('slNum').textContent  = sl.num;
  document.getElementById('slUnit').textContent = sl.unit;

  // Update nav
  document.querySelectorAll('.ns').forEach((b,i) => b.classList.toggle('active', i === idx));
  document.querySelectorAll('.dot').forEach((d,i) => d.classList.toggle('active', i === idx));

  // Update panels
  document.querySelectorAll('.panel').forEach((p,i) => p.classList.toggle('active', i === idx));

  // Trigger per-section behaviors
  if (idx === 1) triggerCounters();
  if (idx === 2) triggerSkillBars();
  if (idx === 3) triggerProjects();

  // Fade back in
  await sleep(80);
  tOverlay.classList.remove('on');
  transitioning = false;
}

// ─────────────────────────────────────────────────────────────
// WORLD 0 — OUTER GALAXY
// ─────────────────────────────────────────────────────────────
// Helper to generate a procedural radial gradient for volumetric core glows
function createCoreGlowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  
  const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
  grad.addColorStop(0.15, 'rgba(255, 210, 150, 0.85)');
  grad.addColorStop(0.4, 'rgba(217, 70, 239, 0.25)'); // Magenta halo
  grad.addColorStop(0.7, 'rgba(59, 130, 246, 0.05)');  // Blue outer halo
  grad.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
  
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  
  const tex = new THREE.CanvasTexture(canvas);
  return tex;
}

function buildGalaxy() {
  const w = new World('Galaxy',
    { x:0,  y:12,  z:48 }, { x:0, y:0, z:0 },
    0x030305, 0.004
  );

  const ARMS = 3;
  const R = 25;

  // 1. LAYER 1: STARS (100,000 sharp, bright particles)
  const STAR_COUNT = 100000;
  const starPos = new Float32Array(STAR_COUNT * 3);
  const starCol = new Float32Array(STAR_COUNT * 3);
  const starSiz = new Float32Array(STAR_COUNT);

  const cCore   = new THREE.Color(0xfff5e0); // Cream
  const cInner  = new THREE.Color(0xff7c43); // Warm Orange
  const cMid    = new THREE.Color(0xd946ef); // Magenta
  const cOuter  = new THREE.Color(0x3b82f6); // Blue
  const cEdge   = new THREE.Color(0x0a0f2d); // Dark Navy

  for (let i = 0; i < STAR_COUNT; i++) {
    const isCore = i < STAR_COUNT * 0.12;
    let radius, angle;

    if (isCore) {
      radius = Math.pow(Math.random(), 2.2) * 3.5;
      angle = Math.random() * Math.PI * 2;
    } else {
      radius = Math.pow(Math.random(), 1.0) * R;
      const spinAngle = radius * 1.05;
      const armIndex = i % ARMS;
      const branchAngle = (armIndex / ARMS) * Math.PI * 2;
      angle = branchAngle + spinAngle;
    }

    const power = 2.2; // Widen arms and increase randomization (less line-like)
    const spreadRadius = isCore ? 0.0 : Math.pow(Math.random(), power) * 0.45 * (radius + 1.2);
    const spreadAngle  = Math.random() * Math.PI * 2;

    const x = Math.cos(angle) * radius + (isCore ? (Math.random() - 0.5) * radius : Math.cos(spreadAngle) * spreadRadius);
    const y = isCore ? (Math.random() - 0.5) * radius * 0.6 : Math.pow(Math.random(), power) * (Math.random() < 0.5 ? 1 : -1) * 0.22 * (radius + 1.2);
    const z = Math.sin(angle) * radius + (isCore ? (Math.random() - 0.5) * radius : Math.sin(spreadAngle) * spreadRadius);

    starPos[i * 3]     = x;
    starPos[i * 3 + 1] = y;
    starPos[i * 3 + 2] = z;

    // Color gradient
    const t = isCore ? (radius / 3.5) * 0.15 : radius / R;
    let color;
    if (t < 0.15) color = cCore.clone().lerp(cInner, t / 0.15);
    else if (t < 0.45) color = cInner.clone().lerp(cMid, (t - 0.15) / 0.30);
    else if (t < 0.8) color = cMid.clone().lerp(cOuter, (t - 0.45) / 0.35);
    else color = cOuter.clone().lerp(cEdge, (t - 0.8) / 0.20);

    const noise = Math.random();
    let brightness = 0.5 + noise * 0.5;

    // Spiral dust lane simulation (corrected phase to prevent concentric rings)
    if (!isCore) {
      const theta = Math.atan2(z, x);
      const spiralPhase = Math.sin((theta - radius * 1.05) * ARMS);
      if (spiralPhase > 0.45 && spiralPhase < 0.75) {
        brightness *= 0.15;
      }
    }

    starCol[i * 3]     = color.r * brightness;
    starCol[i * 3 + 1] = color.g * brightness;
    starCol[i * 3 + 2] = color.b * brightness;

    starSiz[i] = Math.random() < 0.03 ? 1.4 + Math.random() * 1.6 : 0.22 + Math.random() * 0.40;
  }

  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  starGeo.setAttribute('aColor',   new THREE.BufferAttribute(starCol, 3));
  starGeo.setAttribute('aSize',    new THREE.BufferAttribute(starSiz, 1));

  const starMat = new THREE.ShaderMaterial({
    vertexShader:   PARTICLE_VERT,
    fragmentShader: PARTICLE_FRAG,
    uniforms:       { ...sharedUniforms, uScene: { value: 0.0 } },
    transparent:    true,
    depthWrite:     false,
    blending:       THREE.AdditiveBlending,
  });

  const stars = new THREE.Points(starGeo, starMat);
  w.group.add(stars);


  // 2. LAYER 2: VOLUMETRIC NEBULA GAS (50,000 large, ultra-faint particles)
  const GAS_COUNT = 50000;
  const gasPos = new Float32Array(GAS_COUNT * 3);
  const gasCol = new Float32Array(GAS_COUNT * 3);
  const gasSiz = new Float32Array(GAS_COUNT);

  const cGasCore  = new THREE.Color(0xff8c55); // Orange/coral
  const cGasMid   = new THREE.Color(0xec4899); // Pink
  const cGasOuter = new THREE.Color(0x6366f1); // Indigo

  for (let i = 0; i < GAS_COUNT; i++) {
    const radius = Math.pow(Math.random(), 1.2) * R;
    const spinAngle = radius * 1.05;
    const armIndex = i % ARMS;
    const branchAngle = (armIndex / ARMS) * Math.PI * 2;
    const angle = branchAngle + spinAngle;

    // Wider circular scatter for gas than stars to create soft volumetric backing
    const power = 2.2;
    const spreadRadius = Math.pow(Math.random(), power) * 0.75 * (radius + 1.5);
    const spreadAngle  = Math.random() * Math.PI * 2;

    const x = Math.cos(angle) * radius + Math.cos(spreadAngle) * spreadRadius;
    const y = Math.pow(Math.random(), power) * (Math.random() < 0.5 ? 1 : -1) * 0.35 * (radius + 1.5);
    const z = Math.sin(angle) * radius + Math.sin(spreadAngle) * spreadRadius;

    gasPos[i * 3]     = x;
    gasPos[i * 3 + 1] = y;
    gasPos[i * 3 + 2] = z;

    // Soft gas color transitions
    const t = radius / R;
    let color;
    if (t < 0.3) color = cGasCore.clone().lerp(cGasMid, t / 0.3);
    else color = cGasMid.clone().lerp(cGasOuter, (t - 0.3) / 0.7);

    // Dynamic gas density falloff
    let density = (1.0 - t) * 0.016; // Extremely faint per-particle so they merge smoothly
    if (Math.random() < 0.1) density *= 0.5; // add patchiness

    gasCol[i * 3]     = color.r * density;
    gasCol[i * 3 + 1] = color.g * density;
    gasCol[i * 3 + 2] = color.b * density;

    // Gas particles are physically massive but scaled down to sharpen arms
    gasSiz[i] = 3.5 + Math.random() * 4.5;
  }

  const gasGeo = new THREE.BufferGeometry();
  gasGeo.setAttribute('position', new THREE.BufferAttribute(gasPos, 3));
  gasGeo.setAttribute('aColor',   new THREE.BufferAttribute(gasCol, 3));
  gasGeo.setAttribute('aSize',    new THREE.BufferAttribute(gasSiz, 1));

  const gasMat = new THREE.ShaderMaterial({
    vertexShader:   PARTICLE_VERT,
    fragmentShader: PARTICLE_FRAG,
    uniforms:       { ...sharedUniforms, uScene: { value: 0.0 } },
    transparent:    true,
    depthWrite:     false,
    blending:       THREE.AdditiveBlending,
  });

  const gasClouds = new THREE.Points(gasGeo, gasMat);
  w.group.add(gasClouds);


  // 3. LAYER 3: VOLUMETRIC CORE GLOW BILLBOARD
  const coreGlowGeo = new THREE.PlaneGeometry(10, 10);
  const coreGlowMat = new THREE.MeshBasicMaterial({
    color:       0xffba90,
    transparent: true,
    opacity:     0.18,
    blending:    THREE.AdditiveBlending,
    depthWrite:  false,
    map:         createCoreGlowTexture(),
  });
  const coreGlow = new THREE.Mesh(coreGlowGeo, coreGlowMat);
  w.group.add(coreGlow);

  // Background stars
  addBackgroundStars(w.group, 5000, 50, 250);

  w.build = () => {};
  w.tick = (t) => {
    // Independent orbital winding
    stars.rotation.y = t * 0.008;
    gasClouds.rotation.y = t * 0.008;
    
    // Core glow faces camera dynamically
    coreGlow.lookAt(camera.position);
  };
  worlds.push(w);
}

// ─────────────────────────────────────────────────────────────
// WORLD 1 — SOLAR SYSTEM (Shaders & Generation)
// ─────────────────────────────────────────────────────────────
const SUN_VERT = `
  varying vec2 vUv;
  varying vec3 vNormal;
  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const SUN_FRAG = `
  varying vec2 vUv;
  varying vec3 vNormal;
  uniform float uTime;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    vec2 shift = vec2(100.0);
    mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
    for (int i = 0; i < 4; ++i) {
      v += a * noise(p);
      p = rot * p * 2.0 + shift;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    // 1. Base solar plasma swirls (FBM)
    vec2 uv = vUv * 8.0;
    float n1 = fbm(uv + vec2(uTime * 0.15, uTime * 0.10));
    float n2 = fbm(uv - vec2(uTime * 0.08, -uTime * 0.12));
    float plasmaNoise = (n1 + n2) * 0.5;

    vec3 cRed    = vec3(0.55, 0.02, 0.0);
    vec3 cOrange = vec3(1.0, 0.35, 0.0);
    vec3 cYellow = vec3(1.0, 0.82, 0.0);
    vec3 cWhite  = vec3(1.0, 1.0, 0.90);

    vec3 plasmaColor;
    if (plasmaNoise < 0.35) {
      plasmaColor = mix(cRed, cOrange, plasmaNoise / 0.35);
    } else if (plasmaNoise < 0.65) {
      plasmaColor = mix(cOrange, cYellow, (plasmaNoise - 0.35) / 0.30);
    } else {
      plasmaColor = mix(cYellow, cWhite, (plasmaNoise - 0.65) / 0.35);
    }

    // 2. Distinct, sharp sunspot umbra cavities
    // Lower frequency noise for larger blotches
    vec2 spotUv = vUv * 3.2;
    float spotNoise = fbm(spotUv + vec2(uTime * 0.05, uTime * 0.03));
    
    // Create sharp umbra borders
    float spotMask = smoothstep(0.36, 0.22, spotNoise); 

    // Deep black-brown sunspot color
    vec3 cSunspot = vec3(0.015, 0.003, 0.0);
    
    // Mix sunspots over the swirling plasma
    vec3 color = mix(plasmaColor, cSunspot, spotMask * 0.92);

    // 3. Edge fresnel glow
    vec3 view = normalize(vec3(0, 0, 1));
    float rim = 1.0 - abs(dot(vNormal, view));
    rim = pow(rim, 3.0);
    color += cOrange * rim * 1.1;

    gl_FragColor = vec4(color, 1.0);
  }
`;

const CORONA_VERT = `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vPosition;
  uniform float uTime;

  float hash(vec3 p) {
    p = fract(p * vec3(443.8975, 397.2973, 491.1871));
    p += dot(p.xyz, p.yzx + 19.19);
    return fract(p.x * p.y * p.z);
  }
  float noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), u.x),
          mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), u.x), u.y),
      mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), u.x),
          mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), u.x), u.y),
      u.z
    );
  }
  float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int k = 0; k < 3; k++) {
      v += a * noise(p);
      p *= 2.0;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    vPosition = position;

    // Displace vertices along normal to physically model solar flares shooting out
    float disp = fbm(position * 1.0 + vec3(0.0, 0.0, uTime * 0.85)) * 0.68;
    vec3 newPos = position + normal * disp;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(newPos, 1.0);
  }
`;

const CORONA_FRAG = `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vPosition;
  uniform float uTime;

  float hash(vec3 p) {
    p = fract(p * vec3(443.8975, 397.2973, 491.1871));
    p += dot(p.xyz, p.yzx + 19.19);
    return fract(p.x * p.y * p.z);
  }
  float noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), u.x),
          mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), u.x), u.y),
      mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), u.x),
          mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), u.x), u.y),
      u.z
    );
  }
  float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int k = 0; k < 3; k++) {
      v += a * noise(p);
      p *= 2.0;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    // Generate soft, licking fire shapes
    float n = fbm(vPosition * 2.0 + vec3(0.0, 0.0, -uTime * 0.65));

    // Fresnel fade so it's transparent in the middle, glowing at the silhouette
    vec3 view = normalize(vec3(0, 0, 1));
    float rim = 1.0 - abs(dot(vNormal, view));
    rim = pow(rim, 2.0);

    float alpha = n * rim * 2.4;
    alpha = smoothstep(0.18, 0.62, alpha);

    vec3 cOrange = vec3(1.0, 0.30, 0.0);
    vec3 cYellow = vec3(1.0, 0.85, 0.0);
    vec3 color = mix(cOrange, cYellow, n);

    if (alpha < 0.01) discard;

    gl_FragColor = vec4(color, alpha * 0.68);
  }
`;

function createProceduralPlanetTexture(name, colorHex) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  
  const baseColor = new THREE.Color(colorHex);
  ctx.fillStyle = '#' + baseColor.getHexString();
  ctx.fillRect(0, 0, 256, 128);
  
  if (name === 'Mercury') {
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    for (let i = 0; i < 40; i++) {
      const x = Math.random() * 256;
      const y = Math.random() * 128;
      const r = 3 + Math.random() * 8;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.stroke();
    }
  } else if (name === 'Venus') {
    for (let i = 0; i < 20; i++) {
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,240,200,0.16)' : 'rgba(160,130,80,0.12)';
      const h = 4 + Math.random() * 12;
      const y = Math.random() * 128;
      ctx.fillRect(0, y, 256, h);
    }
  } else if (name === 'Earth') {
    // continents
    ctx.fillStyle = '#22953a';
    for (let i = 0; i < 8; i++) {
      ctx.beginPath();
      ctx.arc(Math.random()*256, Math.random()*128, 12 + Math.random()*22, 0, Math.PI*2);
      ctx.fill();
    }
    // cloud overlay
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    for (let i = 0; i < 6; i++) {
      ctx.fillRect(Math.random()*256, Math.random()*128, 45, 6);
    }
  } else if (name === 'Mars') {
    ctx.fillStyle = 'rgba(70,25,8,0.3)';
    for (let i = 0; i < 9; i++) {
      ctx.beginPath();
      ctx.arc(Math.random()*256, Math.random()*128, 15 + Math.random()*25, 0, Math.PI*2);
      ctx.fill();
    }
    // polar caps
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(0, 0, 256, 8);
    ctx.fillRect(0, 120, 256, 8);
  } else if (name === 'Jupiter') {
    for (let y = 0; y < 128; y += 4) {
      const c = Math.sin(y * 0.12) * 0.5 + 0.5;
      ctx.fillStyle = c > 0.6 ? 'rgba(120,60,30,0.38)' : c > 0.3 ? 'rgba(180,120,80,0.25)' : 'rgba(235,185,140,0.12)';
      ctx.fillRect(0, y, 256, 4);
    }
    // Great Red Spot
    ctx.fillStyle = 'rgba(190,40,20,0.85)';
    ctx.beginPath();
    ctx.ellipse(150, 85, 16, 9, 0, 0, Math.PI*2);
    ctx.fill();
  } else if (name === 'Saturn') {
    for (let y = 0; y < 128; y += 6) {
      ctx.fillStyle = y % 12 === 0 ? 'rgba(145,115,70,0.25)' : 'rgba(225,195,145,0.12)';
      ctx.fillRect(0, y, 256, 6);
    }
  }
  
  const tex = new THREE.CanvasTexture(canvas);
  return tex;
}

function buildSolarSystem() {
  const w = new World('Solar',
    { x:0, y:18, z:40 }, { x:0, y:0, z:0 },
    0x020204, 0.003
  );

  // SUN — Swirling Noise Surface Material
  const sunGeo  = new THREE.SphereGeometry(2.4, 48, 48);
  const sunMat  = new THREE.ShaderMaterial({
    vertexShader:   SUN_VERT,
    fragmentShader: SUN_FRAG,
    uniforms:       { uTime: sharedUniforms.uTime },
  });
  const sun = new THREE.Mesh(sunGeo, sunMat);
  w.group.add(sun);

  // Nested Corona Flame Shells (physically deforming noise shells)
  const coronaGeo1 = new THREE.SphereGeometry(2.44, 64, 64);
  const coronaMat1 = new THREE.ShaderMaterial({
    vertexShader:   CORONA_VERT,
    fragmentShader: CORONA_FRAG,
    uniforms:       { uTime: sharedUniforms.uTime },
    transparent:    true,
    depthWrite:     false,
    blending:       THREE.AdditiveBlending,
    side:           THREE.DoubleSide,
  });
  const corona1 = new THREE.Mesh(coronaGeo1, coronaMat1);
  w.group.add(corona1);

  const coronaGeo2 = new THREE.SphereGeometry(2.55, 64, 64);
  const coronaMat2 = new THREE.ShaderMaterial({
    vertexShader:   CORONA_VERT,
    fragmentShader: CORONA_FRAG,
    uniforms:       { uTime: sharedUniforms.uTime },
    transparent:    true,
    depthWrite:     false,
    blending:       THREE.AdditiveBlending,
    side:           THREE.DoubleSide,
  });
  const corona2 = new THREE.Mesh(coronaGeo2, coronaMat2);
  w.group.add(corona2);

  // Point light + Ambient light to brighten planets
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.48);
  w.group.add(ambientLight);
  const sunLight = new THREE.PointLight(0xffddaa, 6.5, 300);
  w.group.add(sunLight);


  // SOLAR FLARE PARTICLES (dynamic emission from surface)
  const FLARE_COUNT = 1500;
  const flarePos  = new Float32Array(FLARE_COUNT * 3);
  const flareCol  = new Float32Array(FLARE_COUNT * 3);
  const flareSiz  = new Float32Array(FLARE_COUNT);
  const flareData = [];
  
  for (let i = 0; i < FLARE_COUNT; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi   = Math.acos((Math.random() * 2) - 1);
    const dir   = new THREE.Vector3(
      Math.sin(phi) * Math.cos(theta),
      Math.sin(phi) * Math.sin(theta),
      Math.cos(phi)
    );
    const speed = 0.35 + Math.random() * 0.45;
    const phase = Math.random() * 1.5;
    const size  = 0.5 + Math.random() * 1.5;
    
    flareData.push({ dir, speed, phase, size });
    
    flarePos[i * 3]     = dir.x * 2.4;
    flarePos[i * 3 + 1] = dir.y * 2.4;
    flarePos[i * 3 + 2] = dir.z * 2.4;
    
    flareCol[i * 3]     = 1.0;
    flareCol[i * 3 + 1] = 0.5;
    flareCol[i * 3 + 2] = 0.1;
    
    flareSiz[i]         = size;
  }
  
  const flareGeo = new THREE.BufferGeometry();
  flareGeo.setAttribute('position', new THREE.BufferAttribute(flarePos, 3));
  flareGeo.setAttribute('aColor',   new THREE.BufferAttribute(flareCol, 3));
  flareGeo.setAttribute('aSize',    new THREE.BufferAttribute(flareSiz, 1));
  
  const flareMat = new THREE.ShaderMaterial({
    vertexShader:   PARTICLE_VERT,
    fragmentShader: PARTICLE_FRAG,
    uniforms:       { ...sharedUniforms, uScene: { value: 1.0 } },
    transparent:    true,
    depthWrite:     false,
    blending:       THREE.AdditiveBlending,
  });
  
  const flares = new THREE.Points(flareGeo, flareMat);
  w.group.add(flares);


  // Planets: [ name, radius, orbitR, speed, color, rings? ]
  const planets = [
    { name:'Mercury', r:.28, orbit:5.5,  speed:.7,   col:0xb0a090 },
    { name:'Venus',   r:.5,  orbit:7.5,  speed:.45,  col:0xe8d08a },
    { name:'Earth',   r:.55, orbit:10,   speed:.32,  col:0x4488ff },
    { name:'Mars',    r:.35, orbit:13,   speed:.22,  col:0xd4522a },
    { name:'Jupiter', r:1.1, orbit:17.5, speed:.12,  col:0xd4a070 },
    { name:'Saturn',  r:.9,  orbit:22,   speed:.08,  col:0xe8d090, rings:true },
  ];

  const planetMeshes = [];

  planets.forEach(p => {
    // Orbit ring
    const oGeo = new THREE.RingGeometry(p.orbit - .03, p.orbit + .03, 100);
    const oMat = new THREE.MeshBasicMaterial({
      color:0xffffff, transparent:true, opacity:.08,
      side:THREE.DoubleSide, depthWrite:false,
    });
    const orbit = new THREE.Mesh(oGeo, oMat);
    orbit.rotation.x = Math.PI / 2;
    w.group.add(orbit);

    // Planet with procedural 3D map + bump map for topography
    const pGeo = new THREE.SphereGeometry(p.r, 24, 24);
    const tex  = createProceduralPlanetTexture(p.name, p.col);
    const pMat = new THREE.MeshStandardMaterial({
      map:       tex,
      roughness: 0.8,
      metalness: 0.1,
    });
    if (p.name === 'Mercury' || p.name === 'Mars') {
      pMat.bumpMap = tex;
      pMat.bumpScale = 0.02;
    }
    const planet = new THREE.Mesh(pGeo, pMat);
    planet.userData = { orbit: p.orbit, speed: p.speed, angle: Math.random() * Math.PI * 2 };
    w.group.add(planet);
    planetMeshes.push(planet);

    // Saturn rings
    if (p.rings) {
      const rGeo = new THREE.RingGeometry(p.r*1.4, p.r*2.2, 64);
      const rMat = new THREE.MeshBasicMaterial({
        color:0xd4c090, transparent:true, opacity:.45,
        side:THREE.DoubleSide, depthWrite:false,
      });
      const ring = new THREE.Mesh(rGeo, rMat);
      ring.rotation.x = Math.PI / 2.5;
      planet.add(ring);
    }
  });

  // ASTEROID BELT (Between Mars and Jupiter)
  const ASTEROID_COUNT = 3000;
  const astPos = new Float32Array(ASTEROID_COUNT * 3);
  const astCol = new Float32Array(ASTEROID_COUNT * 3);
  const astSiz = new Float32Array(ASTEROID_COUNT);
  
  const cAst1 = new THREE.Color(0x8a8279);
  const cAst2 = new THREE.Color(0x5a5550);
  
  for (let i = 0; i < ASTEROID_COUNT; i++) {
    // Distribute between Mars (13) and Jupiter (17.5)
    const radius = 14.2 + Math.random() * 1.8;
    const angle  = Math.random() * Math.PI * 2;
    
    const x = Math.cos(angle) * radius;
    const y = (Math.random() - 0.5) * 0.35;
    const z = Math.sin(angle) * radius;
    
    astPos[i * 3]     = x;
    astPos[i * 3 + 1] = y;
    astPos[i * 3 + 2] = z;
    
    const col = cAst1.clone().lerp(cAst2, Math.random());
    astCol[i * 3]     = col.r;
    astCol[i * 3 + 1] = col.g;
    astCol[i * 3 + 2] = col.b;
    
    astSiz[i]         = 0.2 + Math.random() * 0.45;
  }
  
  const astGeo = new THREE.BufferGeometry();
  astGeo.setAttribute('position', new THREE.BufferAttribute(astPos, 3));
  astGeo.setAttribute('aColor',   new THREE.BufferAttribute(astCol, 3));
  astGeo.setAttribute('aSize',    new THREE.BufferAttribute(astSiz, 1));
  
  const astMat = new THREE.ShaderMaterial({
    vertexShader:   PARTICLE_VERT,
    fragmentShader: PARTICLE_FRAG,
    uniforms:       { ...sharedUniforms, uScene: { value: 1.0 } },
    transparent:    true,
    depthWrite:     false,
    blending:       THREE.AdditiveBlending,
  });
  
  const asteroids = new THREE.Points(astGeo, astMat);
  w.group.add(asteroids);

  // Background stars
  addBackgroundStars(w.group, 4000, 60, 300);

  w.tick = (t) => {
    // Update flares positions and colors dynamically
    const fPosAttr = flareGeo.getAttribute('position');
    const fColAttr = flareGeo.getAttribute('aColor');
    
    for (let i = 0; i < FLARE_COUNT; i++) {
      const fd = flareData[i];
      const life = ((t * fd.speed + fd.phase) % 1.5) / 1.5;
      const dist = 2.4 + life * 1.8;
      
      const swirlX = Math.sin(t * 6.0 + fd.phase * 10.0) * 0.16 * life;
      const swirlY = Math.cos(t * 6.0 + fd.phase * 10.0) * 0.16 * life;
      
      fPosAttr.setXYZ(i,
        fd.dir.x * dist + swirlX,
        fd.dir.y * dist + swirlY,
        fd.dir.z * dist
      );
      
      let r, g, b;
      if (life < 0.2) {
        r = 1.0; g = 0.95; b = 0.6;
      } else if (life < 0.6) {
        r = 1.0; g = 0.45; b = 0.08;
      } else {
        r = 0.8 * (1.0 - life); g = 0.12 * (1.0 - life); b = 0.0;
      }
      fColAttr.setXYZ(i, r, g, b);
    }
    fPosAttr.needsUpdate = true;
    fColAttr.needsUpdate = true;

    // Orbit planets
    planetMeshes.forEach(pm => {
      const ud = pm.userData;
      ud.angle += ud.speed * 0.004;
      pm.position.x = Math.cos(ud.angle) * ud.orbit;
      pm.position.z = Math.sin(ud.angle) * ud.orbit;
      pm.rotation.y += 0.008;
    });

    // Slow orbital rotation of asteroid belt
    asteroids.rotation.y = t * 0.0012;
  };

  worlds.push(w);
}

// ─────────────────────────────────────────────────────────────
// WORLD 2 — EARTH FROM ORBIT
// ─────────────────────────────────────────────────────────────
const EARTH_VERT = `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vPosition;
  varying float vHeight;
  uniform float uTime;

  float hash(vec3 p) {
    p = fract(p * vec3(443.8975, 397.2973, 491.1871));
    p += dot(p.xyz, p.yzx + 19.19);
    return fract(p.x * p.y * p.z);
  }
  float noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), u.x),
          mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), u.x), u.y),
      mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), u.x),
          mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), u.x), u.y),
      u.z
    );
  }
  float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int k = 0; k < 4; k++) {
      v += a * noise(p);
      p *= 2.1;
      a *= 0.48;
    }
    return v;
  }

  void main() {
    vUv = uv;
    vPosition = position;
    
    // Large landmass patterns + fine rocky ridges
    float baseHeight = fbm(position * 0.38);
    float fineDetail = fbm(position * 1.8) * 0.15;
    float height = baseHeight + fineDetail;
    vHeight = height;

    // Displace landmasses significantly along normal to match the bumpy reference image
    float disp = 0.0;
    if (height > 0.45) {
      disp = (height - 0.45) * 0.85; // Exaggerated displacement (bumpy planet)
    }
    vec3 newPos = position + normal * disp;

    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(newPos, 1.0);
  }
`;
const EARTH_FRAG = `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vPosition;
  varying float vHeight;
  uniform float uTime;

  void main() {
    float height = vHeight;

    // Direct color matching to the user's reference image
    vec3 cDeepOcean    = vec3(0.06, 0.28, 0.45); // Dark blue ocean depth
    vec3 cShallowOcean = vec3(0.25, 0.74, 0.83); // Bright cyan/teal waters
    vec3 cCoast        = vec3(0.89, 0.86, 0.72); // Creamy white sandy beach
    vec3 cLowland      = vec3(0.46, 0.72, 0.42); // Mossy green lowland
    vec3 cMidland      = vec3(0.36, 0.58, 0.30); // Darker forest green
    vec3 cMountain     = vec3(0.37, 0.36, 0.35); // Bumpy slate grey rock
    vec3 cSnow         = vec3(0.90, 0.95, 0.92); // White snowy mountain peaks

    vec3 col;
    if (height < 0.42) {
      col = mix(cDeepOcean, cShallowOcean, height / 0.42);
    } else if (height < 0.45) {
      col = mix(cShallowOcean, cCoast, (height - 0.42) / 0.03);
    } else if (height < 0.56) {
      col = mix(cCoast, cLowland, (height - 0.45) / 0.11);
    } else if (height < 0.68) {
      col = mix(cLowland, cMountain, (height - 0.56) / 0.12);
    } else {
      col = mix(cMountain, cSnow, (height - 0.68) / 0.32);
    }

    // Dynamic solar lighting
    vec3 lightDir = normalize(vec3(1.2, 0.4, 0.8));
    float diff = max(dot(vNormal, lightDir), 0.0);
    float amb = 0.22; // Brighter ambient to lighten up the planet details
    col = col * (amb + diff * 0.78);

    gl_FragColor = vec4(col, 1.0);
  }
`;
const ATM_FRAG = `
  varying vec3 vNormal;
  varying vec2 vUv;
  uniform float uTime;
  void main() {
    // Soft, volumetric white/grey atmospheric rim glow (matching the reference image)
    vec3 view = normalize(vec3(0,0,1));
    float rim = 1.0 - abs(dot(vNormal, view));
    rim = pow(rim, 3.2);
    
    vec3 atmCol = vec3(0.85, 0.88, 0.92); // Soft misty white-grey halo
    float alpha = rim * 0.48;
    
    gl_FragColor = vec4(atmCol, alpha);
  }
`;
const CLOUD_VERT = `
  varying vec3 vPosition;
  void main() {
    vPosition = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const CLOUD_FRAG = `
  varying vec3 vPosition;
  uniform float uTime;

  float hash(vec3 p) {
    p = fract(p * vec3(443.8975, 397.2973, 491.1871));
    p += dot(p.xyz, p.yzx + 19.19);
    return fract(p.x * p.y * p.z);
  }
  float noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), u.x),
          mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), u.x), u.y),
      mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), u.x),
          mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), u.x), u.y),
      u.z
    );
  }
  float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int k = 0; k < 4; k++) {
      v += a * noise(p);
      p *= 2.0;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    // Scroll clouds slowly in 3D space
    vec3 scroll = vPosition + vec3(uTime * 0.04, uTime * 0.02, 0.0);
    float n = fbm(scroll * 1.6);
    
    // Create sharp, puffy cloud clumps
    float alpha = smoothstep(0.46, 0.54, n);
    if (alpha < 0.01) discard;
    
    // Soft, transparent white clouds
    gl_FragColor = vec4(1.0, 1.0, 1.0, alpha * 0.78);
  }
`;

function buildEarth() {
  const w = new World('Earth',
    { x:0, y:3, z:18 }, { x:0, y:0, z:0 },
    0x000510, 0.006
  );

  // Earth sphere (high-segments geometry for detailed 3D displacements)
  const eGeo = new THREE.SphereGeometry(5, 120, 120);
  const eMat = new THREE.ShaderMaterial({
    vertexShader:   EARTH_VERT,
    fragmentShader: EARTH_FRAG,
    uniforms:       { uTime: sharedUniforms.uTime },
  });
  const earth = new THREE.Mesh(eGeo, eMat);
  w.group.add(earth);

  // Clouds layer
  const cGeo = new THREE.SphereGeometry(5.12, 64, 64);
  const cMat = new THREE.ShaderMaterial({
    vertexShader:   CLOUD_VERT,
    fragmentShader: CLOUD_FRAG,
    uniforms:       { uTime: sharedUniforms.uTime },
    transparent:    true,
    depthWrite:     false,
  });
  const clouds = new THREE.Mesh(cGeo, cMat);
  w.group.add(clouds);

  // Atmosphere (BackSide rendering for volumetric halo bleed)
  const aGeo = new THREE.SphereGeometry(5.42, 48, 48);
  const aMat = new THREE.ShaderMaterial({
    vertexShader:   EARTH_VERT,
    fragmentShader: ATM_FRAG,
    uniforms:       { uTime: sharedUniforms.uTime },
    transparent:    true,
    depthWrite:     false,
    side:           THREE.BackSide,
    blending:       THREE.AdditiveBlending,
  });
  const atmosphere = new THREE.Mesh(aGeo, aMat);
  w.group.add(atmosphere);

  // Satellites (particle ring orbiting)
  const SAT = 80;
  const sPos = new Float32Array(SAT * 3);
  const sCol = new Float32Array(SAT * 3);
  const sSiz = new Float32Array(SAT);
  for (let i = 0; i < SAT; i++) {
    const a = (i / SAT) * Math.PI * 2;
    const h = 6.5 + (Math.random() - .5) * 1.5;
    const tilt = (Math.random() - .5) * .6;
    sPos[i*3]   = Math.cos(a) * h;
    sPos[i*3+1] = tilt;
    sPos[i*3+2] = Math.sin(a) * h;
    sCol[i*3]=1; sCol[i*3+1]=1; sCol[i*3+2]=.9;
    sSiz[i] = .4 + Math.random() * .5;
  }
  const sGeo = new THREE.BufferGeometry();
  sGeo.setAttribute('position', new THREE.BufferAttribute(sPos,3));
  sGeo.setAttribute('aColor',   new THREE.BufferAttribute(sCol,3));
  sGeo.setAttribute('aSize',    new THREE.BufferAttribute(sSiz,1));
  const satMat = new THREE.ShaderMaterial({
    vertexShader:PARTICLE_VERT, fragmentShader:PARTICLE_FRAG,
    uniforms: sharedUniforms,
    transparent:true, depthWrite:false, blending:THREE.AdditiveBlending,
  });
  const sats = new THREE.Points(sGeo, satMat);
  w.group.add(sats);

  addBackgroundStars(w.group, 3000, 30, 200);

  // Sun light on Earth
  const sl = new THREE.DirectionalLight(0xfff5e0, 2.5);
  sl.position.set(20, 5, 15);
  w.group.add(sl);
  w.group.add(new THREE.AmbientLight(0x112233, 0.5));

  w.tick = (t) => {
    earth.rotation.y = t * 0.04;
    clouds.rotation.y = t * 0.048;
    sats.rotation.y  = t * 0.06;
    sats.rotation.x  = Math.sin(t*.08)*.1;
  };
  worlds.push(w);
}

// ─────────────────────────────────────────────────────────────
// WORLD 3 — CITY GRID (aerial view)
// ─────────────────────────────────────────────────────────────
const CROWD_VERT = `
  attribute float aType;  // 0.0 for roads, 1.0 for buildings
  attribute vec3  aDir;   // velocity vector
  attribute float aPhase;
  varying vec3    vColor;
  varying float   vAlpha;
  uniform float   uTime;
  uniform float   uPR;

  void main() {
    vec3 pos = position;

    if (aType == 0.0) {
      // Flow along roads, wrapping city bounds (-20.0 to 20.0)
      pos += aDir * uTime;
      pos.x = mod(pos.x + 20.0, 40.0) - 20.0;
      pos.z = mod(pos.z + 20.0, 40.0) - 20.0;
    } else {
      // Gentle breathing vibration inside buildings
      pos.y += sin(uTime * 1.5 + aPhase) * 0.08;
    }

    // Colors: cyan/yellow headlights on streets, warm orange/amber inside structures
    if (aType == 0.0) {
      vColor = (aDir.x + aDir.z > 0.0) ? vec3(0.2, 0.7, 1.0) : vec3(1.0, 0.85, 0.4);
    } else {
      vColor = vec3(1.0, 0.55, 0.2);
    }

    vAlpha = 0.5 + sin(uTime * 4.0 + aPhase) * 0.45;

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    // Tiny pinpoint size
    gl_PointSize = clamp(1.3 * uPR * (150.0 / -mv.z), 0.5, 4.0);
    gl_Position  = projectionMatrix * mv;
  }
`;
const CROWD_FRAG = `
  varying vec3  vColor;
  varying float vAlpha;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;
    float cutoff = smoothstep(0.5, 0.35, d);
    gl_FragColor = vec4(vColor, cutoff * vAlpha * 0.88);
  }
`;

function buildCity() {
  const w = new World('City',
    { x:0, y:22, z:18 }, { x:0, y:0, z:0 },
    0x010108, 0.012
  );

  // Grid of buildings using InstancedMesh (steel-blue base color for visibility)
  const ROWS = 18, COLS = 18;
  const SPACING = 2.2;
  const bGeo = new THREE.BoxGeometry(1, 1, 1);
  const bMat = new THREE.MeshStandardMaterial({
    color: 0x64748b, emissive: 0x1e293b, emissiveIntensity: 0.55,
    roughness: 0.8, metalness: 0.3,
  });
  const iMesh = new THREE.InstancedMesh(bGeo, bMat, ROWS * COLS);
  const dummy = new THREE.Object3D();

  const buildingData = [];

  let idx = 0;
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      // Skip some for roads
      const isRoad = (row % 4 === 0) || (col % 4 === 0);
      if (isRoad) { dummy.scale.set(0,.001,0); dummy.updateMatrix(); iMesh.setMatrixAt(idx++, dummy.matrix); continue; }

      const h = 0.5 + Math.pow(Math.random(), 2) * 8;
      const x = (col - COLS/2) * SPACING;
      const z = (row - ROWS/2) * SPACING;

      dummy.position.set(x, h/2 - 0.5, z);
      dummy.scale.set(.95, h, .95);
      dummy.updateMatrix();
      iMesh.setMatrixAt(idx, dummy.matrix);

      // Emissive color per building
      const hue = Math.random();
      const emC = hue < .3
        ? new THREE.Color(0x2244ff)
        : hue < .6 ? new THREE.Color(0xffaa22)
        : new THREE.Color(0x22ffcc);
      iMesh.setColorAt(idx, emC.multiplyScalar(.08 + Math.random()*.12));

      buildingData.push({ idx, x, z, h, phase: Math.random()*Math.PI*2, rate: .3+Math.random()*.7 });
      idx++;
    }
  }
  iMesh.instanceMatrix.needsUpdate = true;
  if (iMesh.instanceColor) iMesh.instanceColor.needsUpdate = true;
  w.group.add(iMesh);

  // Ground plane
  const gGeo = new THREE.PlaneGeometry(60, 60, 1, 1);
  const gMat = new THREE.MeshStandardMaterial({ color: 0x050510, roughness: 1 });
  const ground = new THREE.Mesh(gGeo, gMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -.5;
  w.group.add(ground);

  // Road grid glow lines
  const linePts = [];
  for (let r = 0; r <= ROWS; r++) {
    if (r % 4 !== 0) continue;
    const z = (r - ROWS/2) * SPACING;
    linePts.push((-COLS/2)*SPACING, .01, z);
    linePts.push(( COLS/2)*SPACING, .01, z);
  }
  for (let c = 0; c <= COLS; c++) {
    if (c % 4 !== 0) continue;
    const x = (c - COLS/2) * SPACING;
    linePts.push(x, .01, (-ROWS/2)*SPACING);
    linePts.push(x, .01, ( ROWS/2)*SPACING);
  }
  const lGeo = new THREE.BufferGeometry();
  lGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(linePts), 3));
  const lMat = new THREE.LineBasicMaterial({ color: 0x2244bb, transparent:true, opacity:.35, blending:THREE.AdditiveBlending });
  w.group.add(new THREE.LineSegments(lGeo, lMat));


  // 200,000 NPC CROWDS (headlights flowing along roads, windows twinkling)
  const NPC_COUNT = 200000;
  const npcPos   = new Float32Array(NPC_COUNT * 3);
  const npcDir   = new Float32Array(NPC_COUNT * 3);
  const npcType  = new Float32Array(NPC_COUNT);
  const npcPhase = new Float32Array(NPC_COUNT);

  // Road coordinates cache
  const roadRows = [];
  const roadCols = [];
  for (let r = 0; r < ROWS; r++) { if (r % 4 === 0) roadRows.push((r - ROWS/2) * SPACING); }
  for (let c = 0; c < COLS; c++) { if (c % 4 === 0) roadCols.push((c - COLS/2) * SPACING); }

  for (let i = 0; i < NPC_COUNT; i++) {
    const isRoadNPC = Math.random() < 0.75;
    
    if (isRoadNPC) {
      npcType[i] = 0.0;
      npcPhase[i] = Math.random() * 100.0;
      
      const isHorizontal = Math.random() < 0.5;
      if (isHorizontal) {
        const z = roadRows[Math.floor(Math.random() * roadRows.length)];
        const x = (Math.random() - 0.5) * 40.0;
        npcPos[i * 3]     = x;
        npcPos[i * 3 + 1] = -0.42; // slightly above ground
        npcPos[i * 3 + 2] = z;
        
        const speed = 0.8 + Math.random() * 1.5;
        npcDir[i * 3]     = Math.random() < 0.5 ? speed : -speed;
        npcDir[i * 3 + 1] = 0.0;
        npcDir[i * 3 + 2] = 0.0;
      } else {
        const x = roadCols[Math.floor(Math.random() * roadCols.length)];
        const z = (Math.random() - 0.5) * 40.0;
        npcPos[i * 3]     = x;
        npcPos[i * 3 + 1] = -0.42;
        npcPos[i * 3 + 2] = z;
        
        const speed = 0.8 + Math.random() * 1.5;
        npcDir[i * 3]     = 0.0;
        npcDir[i * 3 + 1] = 0.0;
        npcDir[i * 3 + 2] = Math.random() < 0.5 ? speed : -speed;
      }
    } else {
      npcType[i] = 1.0;
      npcPhase[i] = Math.random() * 10.0;
      
      const b = buildingData[Math.floor(Math.random() * buildingData.length)];
      if (b) {
        const wFactor = 0.8;
        npcPos[i * 3]     = b.x + (Math.random() - 0.5) * wFactor;
        npcPos[i * 3 + 1] = Math.random() * b.h - 0.5;
        npcPos[i * 3 + 2] = b.z + (Math.random() - 0.5) * wFactor;
      } else {
        npcPos[i * 3]     = 0;
        npcPos[i * 3 + 1] = 0;
        npcPos[i * 3 + 2] = 0;
      }
      npcDir[i * 3]     = 0;
      npcDir[i * 3 + 1] = 0;
      npcDir[i * 3 + 2] = 0;
    }
  }

  const npcGeo = new THREE.BufferGeometry();
  npcGeo.setAttribute('position', new THREE.BufferAttribute(npcPos, 3));
  npcGeo.setAttribute('aDir',     new THREE.BufferAttribute(npcDir, 3));
  npcGeo.setAttribute('aType',    new THREE.BufferAttribute(npcType, 1));
  npcGeo.setAttribute('aPhase',   new THREE.BufferAttribute(npcPhase, 1));

  const npcMat = new THREE.ShaderMaterial({
    vertexShader:   CROWD_VERT,
    fragmentShader: CROWD_FRAG,
    uniforms:       { ...sharedUniforms, uScene: { value: 3.0 } },
    transparent:    true,
    depthWrite:     false,
    blending:       THREE.AdditiveBlending,
  });

  const npcSystem = new THREE.Points(npcGeo, npcMat);
  w.group.add(npcSystem);


  // Ambient + directional (brightened sky-lit values)
  w.group.add(new THREE.AmbientLight(0xdbe5f0, 1.8));
  const dl = new THREE.DirectionalLight(0xfff5e0, 2.5);
  dl.position.set(10, 30, 10);
  w.group.add(dl);

  w.tick = (t) => {
    // Pulse building emissive
    bMat.emissiveIntensity = 0.3 + Math.sin(t * 0.5) * 0.15;
  };
  worlds.push(w);
}

// ─────────────────────────────────────────────────────────────
// WORLD 4 — LIVING CELL
// ─────────────────────────────────────────────────────────────
function buildCell() {
  const w = new World('Cell',
    { x:0, y:1, z:14 }, { x:0, y:0, z:0 },
    0x000302, 0.025
  );

  // Cell membrane — large semi-transparent sphere
  const memGeo = new THREE.SphereGeometry(5.5, 32, 32);
  const memMat = new THREE.MeshPhongMaterial({
    color: 0x22ff88, emissive: 0x004422, emissiveIntensity: 0.3,
    transparent:true, opacity:.12, side:THREE.DoubleSide,
    shininess: 60, specular: 0x44ffaa,
  });
  w.group.add(new THREE.Mesh(memGeo, memMat));

  // Membrane wireframe overlay
  const wfMat = new THREE.MeshBasicMaterial({
    color:0x22ff88, wireframe:true, transparent:true, opacity:.06,
  });
  w.group.add(new THREE.Mesh(memGeo, wfMat));

  // Nucleus — large glowing sphere
  const nGeo = new THREE.SphereGeometry(1.8, 24, 24);
  const nMat = new THREE.MeshPhongMaterial({
    color:0xff8844, emissive:0xaa3311, emissiveIntensity:0.8,
    transparent:true, opacity:.85, shininess:80,
  });
  const nucleus = new THREE.Mesh(nGeo, nMat);
  w.group.add(nucleus);

  // Nucleus glow
  const ngGeo = new THREE.SphereGeometry(2.2, 16, 16);
  const ngMat = new THREE.MeshBasicMaterial({
    color:0xff6622, transparent:true, opacity:.08, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.BackSide,
  });
  w.group.add(new THREE.Mesh(ngGeo, ngMat));

  // Organelles (mitochondria, ribosomes, vesicles)
  const organelleData = [
    { pos:[ 2.5,  .8, 1.2], scale:[.9,.45,.45], col:0x44aaff },
    { pos:[-2.8,  .5,-.9],  scale:[.7,.35,.35], col:0x44aaff },
    { pos:[ 1.2,-1.8, 2.0], scale:[.6,.3,.3],   col:0x44aaff },
    { pos:[-1.5, 2.0,.8],   scale:[.5,.25,.25], col:0x44aaff },
    { pos:[ 3.0,-1.2,-.8],  scale:[.4,.2,.2],   col:0xffaa44 },
    { pos:[-2.0,-2.0, 1.5], scale:[.35,.35,.35],col:0xffaa44 },
    { pos:[ .8,  3.0,-.8],  scale:[.3,.3,.3],   col:0xffaa44 },
    { pos:[-3.0,  .8, 2.0], scale:[.3,.3,.3],   col:0xffaa44 },
  ];
  const organelles = [];
  organelleData.forEach(od => {
    const geo = new THREE.SphereGeometry(1, 16, 16);
    const mat = new THREE.MeshPhongMaterial({
      color: od.col, emissive: od.col, emissiveIntensity:.35,
      transparent:true, opacity:.8, shininess:60,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(...od.pos);
    mesh.scale.set(...od.scale);
    mesh.userData = { basePos: [...od.pos], phase: Math.random()*Math.PI*2 };
    w.group.add(mesh);
    organelles.push(mesh);
  });

  // DNA double helix
  const HELIX_TURNS = 4;
  const HELIX_H = 6;
  const HELIX_R = .55;
  const STRAND_SEGS = 80;

  [0, Math.PI].forEach(offset => {
    const pts = [];
    for (let i = 0; i <= STRAND_SEGS; i++) {
      const t = i / STRAND_SEGS;
      const a = t * Math.PI * 2 * HELIX_TURNS + offset;
      pts.push(new THREE.Vector3(
        Math.cos(a) * HELIX_R - 2.5,
        (t - .5) * HELIX_H,
        Math.sin(a) * HELIX_R
      ));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const tGeo  = new THREE.TubeGeometry(curve, 120, .045, 6, false);
    const tMat  = new THREE.MeshPhongMaterial({
      color: offset===0 ? 0x44ffaa : 0xff4488,
      emissive: offset===0 ? 0x22aa66 : 0xaa2255,
      emissiveIntensity: .5, shininess: 80,
    });
    const tube = new THREE.Mesh(tGeo, tMat);
    w.group.add(tube);
  });

  // Helix rungs
  for (let i = 0; i < STRAND_SEGS; i += 5) {
    const t = i / STRAND_SEGS;
    const a = t * Math.PI * 2 * HELIX_TURNS;
    const p1 = new THREE.Vector3(Math.cos(a)*HELIX_R-2.5, (t-.5)*HELIX_H, Math.sin(a)*HELIX_R);
    const p2 = new THREE.Vector3(Math.cos(a+Math.PI)*HELIX_R-2.5, (t-.5)*HELIX_H, Math.sin(a+Math.PI)*HELIX_R);
    const rGeo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
    const rMat = new THREE.LineBasicMaterial({ color:0xaaffdd, transparent:true, opacity:.4 });
    w.group.add(new THREE.LineSegments(rGeo, rMat));
  }

  // Floating protein dots inside cell
  const DOTS = 300;
  const dPos = new Float32Array(DOTS*3);
  const dCol = new Float32Array(DOTS*3);
  const dSiz = new Float32Array(DOTS);
  for (let i = 0; i < DOTS; i++) {
    const r = Math.random() * 4.5;
    const t = Math.random()*Math.PI, p = Math.random()*Math.PI*2;
    dPos[i*3]=Math.sin(t)*Math.cos(p)*r; dPos[i*3+1]=Math.cos(t)*r; dPos[i*3+2]=Math.sin(t)*Math.sin(p)*r;
    const c = Math.random()<.5 ? [.2,.9,.5] : [1,.5,.2];
    dCol[i*3]=c[0]; dCol[i*3+1]=c[1]; dCol[i*3+2]=c[2];
    dSiz[i] = .3 + Math.random()*.5;
  }
  const dGeo = new THREE.BufferGeometry();
  dGeo.setAttribute('position', new THREE.BufferAttribute(dPos,3));
  dGeo.setAttribute('aColor',   new THREE.BufferAttribute(dCol,3));
  dGeo.setAttribute('aSize',    new THREE.BufferAttribute(dSiz,1));
  const proteinPts = new THREE.Points(dGeo, new THREE.ShaderMaterial({
    vertexShader:PARTICLE_VERT, fragmentShader:PARTICLE_FRAG,
    uniforms:sharedUniforms, transparent:true, depthWrite:false, blending:THREE.AdditiveBlending,
  }));
  w.group.add(proteinPts);

  w.group.add(new THREE.AmbientLight(0x112233, 1.2));
  const pl = new THREE.PointLight(0x44ffaa, 2, 20); pl.position.set(0,0,8); w.group.add(pl);

  const cellGroup = w.group; // reference for tick
  w.tick = (t) => {
    cellGroup.rotation.y = t * 0.08;
    nucleus.material.emissiveIntensity = .6 + Math.sin(t*1.2)*.25;
    organelles.forEach(o => {
      const bp = o.userData.basePos;
      const ph = o.userData.phase;
      o.position.y = bp[1] + Math.sin(t*.8 + ph)*.25;
    });
    proteinPts.rotation.y = -t * 0.06;
  };
  worlds.push(w);
}

// ─────────────────────────────────────────────────────────────
// WORLD 5 — MOLECULAR STRUCTURE
// ─────────────────────────────────────────────────────────────
function buildMolecule() {
  const w = new World('Molecule',
    { x:0, y:2, z:10 }, { x:0, y:0, z:0 },
    0x010005, 0.04
  );

  const molGroup = new THREE.Group();
  w.group.add(molGroup);

  // Helper: add atom
  const addAtom = (pos, r, col, emI = .5) => {
    const geo = new THREE.SphereGeometry(r, 24, 24);
    const mat = new THREE.MeshPhongMaterial({
      color:col, emissive:col, emissiveIntensity:emI,
      shininess:120, specular:0xffffff, transparent:true, opacity:.92,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(...pos);
    molGroup.add(mesh);
    // Glow shell
    const gGeo = new THREE.SphereGeometry(r*1.35, 12, 12);
    const gMat = new THREE.MeshBasicMaterial({ color:col, transparent:true, opacity:.06, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.BackSide });
    const gMesh = new THREE.Mesh(gGeo, gMat);
    gMesh.position.set(...pos);
    molGroup.add(gMesh);
    return mesh;
  };

  // Helper: add bond
  const addBond = (p1, p2, col = 0xddddff) => {
    const a = new THREE.Vector3(...p1);
    const b = new THREE.Vector3(...p2);
    const dir = new THREE.Vector3().subVectors(b,a);
    const len = dir.length();
    const mid = new THREE.Vector3().addVectors(a,b).multiplyScalar(.5);
    const geo = new THREE.CylinderGeometry(.07, .07, len, 8, 1);
    const mat = new THREE.MeshPhongMaterial({ color:col, emissive:col, emissiveIntensity:.12, shininess:60, transparent:true, opacity:.75 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(mid);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), dir.normalize());
    molGroup.add(mesh);
  };

  // Helper: electron ring
  const addRing = (r, axis, col) => {
    const geo = new THREE.TorusGeometry(r, .025, 8, 80);
    const mat = new THREE.MeshBasicMaterial({ color:col, transparent:true, opacity:.3, blending:THREE.AdditiveBlending, depthWrite:false });
    const mesh = new THREE.Mesh(geo, mat);
    if (axis==='x') mesh.rotation.x = Math.PI/2;
    if (axis==='z') mesh.rotation.z = Math.PI/4;
    molGroup.add(mesh);
    return mesh;
  };

  // Build a water molecule-inspired organic structure (more complex)
  // Central carbon atom
  const center = [0,0,0];
  addAtom(center, .55, 0xff5522, .6);

  // 4 outer atoms (tetrahedral arrangement)
  const d = 2.0;
  const s = d / Math.sqrt(3);
  const outerAtoms = [
    [ s,  s,  s],
    [-s, -s,  s],
    [-s,  s, -s],
    [ s, -s, -s],
  ];
  const outerCols = [0x3399ff, 0x33ffaa, 0xff3399, 0xffcc22];
  outerAtoms.forEach((pos, i) => {
    addAtom(pos, .38, outerCols[i], .5);
    addBond(center, pos);

    // Secondary atoms on each outer
    const dir = new THREE.Vector3(...pos).normalize();
    const p2 = dir.clone().multiplyScalar(3.2);
    addAtom([p2.x,p2.y,p2.z], .22, outerCols[i], .35);
    addBond(pos, [p2.x,p2.y,p2.z]);
  });

  // Floating electrons — animated around center
  const ELEC = 40;
  const ePos = new Float32Array(ELEC*3);
  const eCol = new Float32Array(ELEC*3);
  const eSiz = new Float32Array(ELEC);
  for (let i = 0; i < ELEC; i++) {
    ePos[i*3]=0; ePos[i*3+1]=0; ePos[i*3+2]=0;
    eCol[i*3]=.5; eCol[i*3+1]=.8; eCol[i*3+2]=1;
    eSiz[i] = .3 + Math.random()*.3;
  }
  const eGeo = new THREE.BufferGeometry();
  eGeo.setAttribute('position', new THREE.BufferAttribute(ePos,3));
  eGeo.setAttribute('aColor',   new THREE.BufferAttribute(eCol,3));
  eGeo.setAttribute('aSize',    new THREE.BufferAttribute(eSiz,1));
  const ePts = new THREE.Points(eGeo, new THREE.ShaderMaterial({
    vertexShader:PARTICLE_VERT, fragmentShader:PARTICLE_FRAG,
    uniforms:sharedUniforms, transparent:true, depthWrite:false, blending:THREE.AdditiveBlending,
  }));
  w.group.add(ePts);

  // Electron shell rings
  const rings = [
    addRing(1.4, 'x', 0x4488ff),
    addRing(2.2, 'y', 0x44ffaa),
    addRing(2.8, 'z', 0xff44aa),
  ];

  // Background particle dust (very fine)
  addBackgroundStars(w.group, 2000, 12, 50, .02);

  w.group.add(new THREE.AmbientLight(0x221144, 1.5));
  const pl1 = new THREE.PointLight(0x5566ff, 3, 30); pl1.position.set(5,5,5); w.group.add(pl1);
  const pl2 = new THREE.PointLight(0xff4422, 2, 20); pl2.position.set(-5,-3,-5); w.group.add(pl2);

  w.tick = (t) => {
    molGroup.rotation.y = t * 0.2;
    molGroup.rotation.x = Math.sin(t*.15) * .3;

    // Animate electrons around sphere
    const ePA = eGeo.getAttribute('position');
    for (let i = 0; i < ELEC; i++) {
      const a = (i/ELEC)*Math.PI*2 + t * (i%2===0 ? 1.8 : -1.2);
      const orbit = 1.4 + (i%3)*.7;
      const tilt  = (i/ELEC - .5)*Math.PI;
      ePA.setXYZ(i,
        Math.cos(a)*orbit,
        Math.sin(tilt)*orbit*.5,
        Math.sin(a)*orbit
      );
    }
    ePA.needsUpdate = true;

    rings[0].rotation.z = t * .6;
    rings[1].rotation.x = t * .4;
    rings[2].rotation.y = t * .5;
  };
  worlds.push(w);
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────
function addBackgroundStars(group, count, rMin, rMax, opacity = 1) {
  const pos = new Float32Array(count*3);
  const col = new Float32Array(count*3);
  const siz = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const r = rMin + Math.random()*(rMax-rMin);
    const t = Math.random()*Math.PI, p = Math.random()*Math.PI*2;
    pos[i*3]=r*Math.sin(t)*Math.cos(p); pos[i*3+1]=r*Math.cos(t); pos[i*3+2]=r*Math.sin(t)*Math.sin(p);
    const b = .2+Math.random()*.8;
    col[i*3]=b; col[i*3+1]=b; col[i*3+2]=b*.85+.15;
    siz[i] = .15+Math.random()*.4;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos,3));
  geo.setAttribute('aColor',   new THREE.BufferAttribute(col,3));
  geo.setAttribute('aSize',    new THREE.BufferAttribute(siz,1));
  const mat = new THREE.ShaderMaterial({
    vertexShader:PARTICLE_VERT, fragmentShader:PARTICLE_FRAG,
    uniforms:sharedUniforms, transparent:true, depthWrite:false, blending:THREE.AdditiveBlending,
  });
  group.add(new THREE.Points(geo, mat));
}

// ─────────────────────────────────────────────────────────────
// ANIMATION LOOP
// ─────────────────────────────────────────────────────────────
function animate() {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();
  
  // 1. Update shared uniforms (wrap time to a multiple of 2*PI to preserve float precision in shaders)
  sharedUniforms.uTime.value = t % (Math.PI * 2000);
  sharedUniforms.uMouseActive.value = mouseActive;

  // 2. Smoothly rotate/orbit camera around look target
  if (currentWorld >= 0) {
    const w = worlds[currentWorld];
    const basePos = w.camPos;
    const look = w.camLook;

    // Calculate radius (distance to look target)
    const offset = new THREE.Vector3(basePos.x - look.x, basePos.y - look.y, basePos.z - look.z);
    const radius = offset.length();

    // Base spherical angles
    const baseTheta = Math.atan2(offset.x, offset.z);
    const basePhi   = Math.asin(offset.y / radius);

    // Apply active drag rotation + subtle mouse parallax
    const theta = baseTheta + dragTheta + mouseNDX * 0.05;
    const phi   = Math.max(-1.4, Math.min(1.4, basePhi + dragPhi - mouseNDY * 0.04));

    // Target position in spherical coordinates
    const targetX = look.x + Math.sin(theta) * Math.cos(phi) * radius;
    const targetY = look.y + Math.sin(phi) * radius;
    const targetZ = look.z + Math.cos(theta) * Math.cos(phi) * radius;

    // Smooth camera positioning
    camTargetPos.x += (targetX - camTargetPos.x) * 0.05;
    camTargetPos.y += (targetY - camTargetPos.y) * 0.05;
    camTargetPos.z += (targetZ - camTargetPos.z) * 0.05;

    camTargetLook.x += (look.x - camTargetLook.x) * 0.05;
    camTargetLook.y += (look.y - camTargetLook.y) * 0.05;
    camTargetLook.z += (look.z - camTargetLook.z) * 0.05;

    camera.position.copy(camTargetPos);
    camera.lookAt(camTargetLook);

    // 3. Tick active world animations
    w.tick(t);
  }

  renderer.render(scene, camera);
}

// ─────────────────────────────────────────────────────────────
// NAVIGATION
// ─────────────────────────────────────────────────────────────
let scrollLocked = false;

window.addEventListener('wheel', e => {
  if (scrollLocked || transitioning) return;
  const dir  = e.deltaY > 0 ? 1 : -1;
  const next = Math.max(0, Math.min(worlds.length-1, currentWorld+dir));
  if (next !== currentWorld) {
    scrollLocked = true;
    showWorld(next);
    setTimeout(() => { scrollLocked = false; }, 1400);
  }
}, { passive:true });

let touchY0 = 0;
window.addEventListener('touchstart', e => { touchY0 = e.touches[0].clientY; }, { passive:true });
window.addEventListener('touchend', e => {
  if (transitioning) return;
  const dy = touchY0 - e.changedTouches[0].clientY;
  if (Math.abs(dy) < 50) return;
  showWorld(Math.max(0, Math.min(worlds.length-1, currentWorld + (dy>0?1:-1))));
}, { passive:true });

document.querySelectorAll('.dot, .ns').forEach(b => b.addEventListener('click', () => showWorld(+b.dataset.i)));
document.getElementById('navHome').addEventListener('click',  () => showWorld(0));
document.getElementById('heroCta').addEventListener('click',  () => showWorld(3));

// ─────────────────────────────────────────────────────────────
// GITHUB DATA
// ─────────────────────────────────────────────────────────────
let repos = [], projsDone = false;

async function fetchGitHub() {
  try {
    const r    = await fetch(GH_API, { headers: { Accept: 'application/vnd.github.v3+json' } });
    if (!r.ok) throw 0;
    const data = await r.json();
    repos = data.filter(r=>!r.fork).sort((a,b)=>(b.stargazers_count-a.stargazers_count)||(new Date(b.updated_at)-new Date(a.updated_at)));
    const sc = document.querySelector('[data-target="35"]');
    if (sc) sc.dataset.target = data.length;
  } catch { repos = FALLBACK; }
}

function triggerProjects() {
  if (projsDone) return;
  projsDone = true;
  const grid = document.getElementById('projectsGrid');
  const status = document.getElementById('projStatus');
  status.textContent = repos.length ? `${repos.length} repos · live from GitHub` : 'Featured projects';
  grid.innerHTML = '';
  repos.slice(0,9).forEach((repo,i) => {
    const color = lc(repo.language);
    const card  = document.createElement('div');
    card.className = 'p-card';
    card.tabIndex  = 0;
    card.setAttribute('role','button');
    card.innerHTML = `
      <div class="p-strip" style="background:${color}"></div>
      <div class="p-body">
        <div class="p-head">
          <span class="p-name">${repo.name}</span>
          <div class="p-badge"><span class="p-ldot" style="background:${color};box-shadow:0 0 4px ${color}88"></span>${repo.language||'—'}</div>
        </div>
        <p class="p-desc">${repo.description||'No description.'}</p>
        ${(repo.topics||[]).slice(0,3).length?`<div class="p-topics">${(repo.topics||[]).slice(0,3).map(t=>`<span class="p-topic">${t}</span>`).join('')}</div>`:''}
        <div class="p-foot">
          <div class="p-meta">
            <span class="p-mi"><svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.873 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z"/></svg>${repo.stargazers_count}</span>
            <span class="p-mi">${fmtDate(repo.updated_at)}</span>
          </div>
          <span class="p-more">Details →</span>
        </div>
      </div>`;
    card.addEventListener('click', ()=>openModal(repo));
    card.addEventListener('keydown', e=>{ if(e.key==='Enter') openModal(repo); });
    grid.appendChild(card);
    setTimeout(()=>card.classList.add('in'), 60+i*50);
  });
}

const FALLBACK = [
  { name:'media-network', description:'Python media distribution and streaming network. Real-time routing, node discovery, and load balancing across distributed endpoints.', language:'Python', html_url:'https://github.com/seed0001/media-network', stargazers_count:1, forks_count:0, updated_at:'2026-06-27T22:10:57Z', size:152, open_issues_count:0, topics:['python','networking','media'] },
  { name:'the-biz-app', description:'Full-stack TypeScript business app. REST API, auth, React frontend. Production-grade architecture.', language:'TypeScript', html_url:'https://github.com/seed0001/the-biz-app', stargazers_count:0, forks_count:0, updated_at:'2026-06-25T02:15:55Z', size:166, open_issues_count:0, topics:['typescript','react','api'] },
  { name:'workshop-RT', description:'Multi-agent real-time system. Autonomous agents coordinate over WebSockets with conflict resolution and distributed state.', language:'JavaScript', html_url:'https://github.com/seed0001/workshop-RT', stargazers_count:0, forks_count:1, updated_at:'2026-06-24T21:56:16Z', size:80, open_issues_count:0, topics:['multi-agent','realtime','websockets'] },
  { name:'human-sim', description:'Python simulation of human cognition. Models decision-making, emotional state, and social dynamics for AI research.', language:'Python', html_url:'https://github.com/seed0001/human-sim', stargazers_count:0, forks_count:0, updated_at:'2026-06-23T14:07:40Z', size:490, open_issues_count:0, topics:['simulation','ai','cognition'] },
  { name:'the-foundation', description:'TypeScript framework for scalable multi-service apps. Dependency injection, event bus, and service orchestration.', language:'TypeScript', html_url:'https://github.com/seed0001/the-foundation', stargazers_count:0, forks_count:0, updated_at:'2026-06-21T13:56:36Z', size:112, open_issues_count:0, topics:['typescript','framework','architecture'] },
  { name:'seg-bot', description:'Python ML segmentation pipeline for automated content classification and routing at scale.', language:'Python', html_url:'https://github.com/seed0001/seg-bot', stargazers_count:0, forks_count:0, updated_at:'2026-06-21T18:53:52Z', size:20, open_issues_count:0, topics:['python','ml','bot'] },
  { name:'SeedKG', description:'Knowledge graph engine. Entity extraction, relation mapping, graph traversal, semantic similarity search.', language:'Python', html_url:'https://github.com/seed0001/SeedKG', stargazers_count:0, forks_count:0, updated_at:'2026-06-12T00:00:00Z', size:0, open_issues_count:0, topics:['knowledge-graph','nlp','graphs'] },
  { name:'pressure', description:'Python tooling for stress testing distributed systems. Configurable load profiles, metrics, failure injection.', language:'Python', html_url:'https://github.com/seed0001/pressure', stargazers_count:0, forks_count:0, updated_at:'2026-06-17T08:45:42Z', size:149, open_issues_count:0, topics:['python','testing','devops'] },
  { name:'b-bBros', description:'TypeScript app deployed on GitHub Pages with live CI/CD pipeline and component-driven architecture.', language:'TypeScript', html_url:'https://github.com/seed0001/b-bBros', stargazers_count:0, forks_count:0, updated_at:'2026-06-19T21:19:13Z', size:757, open_issues_count:0, topics:['typescript','github-pages'], has_pages:true },
];

function fmtDate(iso) { return new Date(iso).toLocaleDateString('en-US',{month:'short',year:'numeric'}); }

// ─────────────────────────────────────────────────────────────
// MODAL
// ─────────────────────────────────────────────────────────────
function openModal(repo) {
  const color = lc(repo.language);
  document.getElementById('mLang').innerHTML = `<span class="ml-dot" style="background:${color};box-shadow:0 0 6px ${color}"></span>${repo.language||'?'} · ${fmtDate(repo.updated_at)}`;
  document.getElementById('mTitle').textContent = repo.name;
  document.getElementById('mDesc').textContent  = repo.description || 'No description.';
  document.getElementById('mMeta').innerHTML = [
    `<div class="mm-i">Stars <span>${repo.stargazers_count}</span></div>`,
    `<div class="mm-i">Forks <span>${repo.forks_count||0}</span></div>`,
    repo.size ? `<div class="mm-i">Size <span>${repo.size} KB</span></div>` : '',
    repo.has_pages ? `<div class="mm-i">Deploy <span>GitHub Pages</span></div>` : '',
  ].join('');
  document.getElementById('mTopics').innerHTML = (repo.topics||[]).map(t=>`<span class="mtp-t">${t}</span>`).join('');
  document.querySelector('.modal-box').style.borderColor = color + '44';
  document.getElementById('mLink').href = repo.html_url;
  document.getElementById('modal').classList.add('open');
}
function closeModal() { document.getElementById('modal').classList.remove('open'); }
document.getElementById('modalX').addEventListener('click', closeModal);
document.getElementById('modal').addEventListener('click', e=>{ if(e.target.id==='modal') closeModal(); });
document.addEventListener('keydown', e=>{ if(e.key==='Escape') closeModal(); });

// ─────────────────────────────────────────────────────────────
// SECTION BEHAVIORS
// ─────────────────────────────────────────────────────────────
let countersDone = false, skillsDone = false;

function triggerCounters() {
  if (countersDone) return; countersDone = true;
  document.querySelectorAll('.ss-n[data-target]').forEach(el => {
    const target = parseInt(el.dataset.target);
    let cur = 0;
    const ti = setInterval(()=>{
      cur = Math.min(cur + target/75, target);
      el.textContent = Math.floor(cur);
      if (cur >= target) clearInterval(ti);
    }, 16);
  });
}

function triggerSkillBars() {
  if (skillsDone) return; skillsDone = true;
  setTimeout(()=>{
    document.querySelectorAll('.sk-fill').forEach(f=>f.classList.add('on'));
  }, 300);
}

// ─────────────────────────────────────────────────────────────
// LOADER
// ─────────────────────────────────────────────────────────────
async function runLoader() {
  const fill  = document.getElementById('ldFill');
  const msg   = document.getElementById('ldMsg');
  const steps = [
    [15,  'Spawning particle systems…'],
    [35,  'Building galaxy…'],
    [52,  'Constructing solar system…'],
    [65,  'Generating Earth…'],
    [78,  'Raising city grid…'],
    [88,  'Assembling cell…'],
    [95,  'Synthesizing molecule…'],
    [100, 'Ready.'],
  ];

  const ghFetch = fetchGitHub(); // parallel

  initThree();
  buildGalaxy();
  buildSolarSystem();
  buildEarth();
  buildCity();
  buildCell();
  buildMolecule();
  animate();

  for (const [pct, text] of steps) {
    fill.style.width = pct + '%';
    msg.textContent  = text;
    await sleep(pct === 100 ? 250 : 280);
  }

  await ghFetch;
  await sleep(300);

  document.getElementById('loader').classList.add('out');
  await sleep(900);

  showWorld(0);
}

function sleep(ms) { return new Promise(r=>setTimeout(r,ms)); }

// BOOT
document.addEventListener('DOMContentLoaded', ()=>runLoader());
