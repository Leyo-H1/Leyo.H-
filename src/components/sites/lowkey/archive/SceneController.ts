// Adapted from lowkey-archive-template, Copyright (c) 2026 The Lowkey Archive Template Contributors, MIT License.
// ============================================================
// SceneController — vanilla THREE port of the skill template.
// Mirrors the initArchive() + tick(now) loop in assets/template.html
// line-for-line (geometry params, materials, timing curves, push/pull
// physics, raycast logic, pointer/wheel/keyboard bindings).
// ============================================================

import * as THREE from 'three';
import { protectPortfolioVideo } from '@/lib/portfolio/media-protection';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  T,
  SHELLS,
  FOG,
  FLOOR_Y,
  RAIL_Y,
  ENTRANCE,
} from './constants';
import type {
  EntrancePhase,
  RailCollection,
  SceneCallbacks,
  SceneOptions,
  SceneStage,
} from './types';

const TYPE = {
  RAIL: 'rail',
  SHELL: 'shell',
  HIT: 'hit',
  ARTWORK: 'artwork'
};

type PickRegion = 'case' | 'artwork';

interface PickTarget {
  index: number;
  region: PickRegion;
}

interface Card {
  root: THREE.Group;
  shell: THREE.Mesh;
  hit: THREE.Mesh;
  doorHit: THREE.Mesh;
  artHit: THREE.Mesh;
  shellMat: THREE.MeshPhysicalMaterial;
  edges: THREE.LineSegments;
  edgeMat: THREE.LineBasicMaterial;
  sheet: THREE.Group;
  backingMat: THREE.MeshPhysicalMaterial;
  artMat: THREE.MeshBasicMaterial;
  spineMat: THREE.MeshStandardMaterial;
  lidPivot: THREE.Group;
  lidMat: THREE.MeshPhysicalMaterial;
  lidHighlightMat: THREE.ShaderMaterial;
  accentMats: THREE.MeshPhysicalMaterial[];
  contactShadow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  artworkImage: HTMLImageElement | null;
  cur: THREE.Vector3;
  curRotY: number;
  curScale: number;
  faceT: number;
  hoverT: number;
  opacity: number;
  data: RailCollection;
  edgeColor: THREE.Color;
  lidColor: THREE.Color;
  baseBackingColor: THREE.Color;
  edgeFade: { value: number };
}

interface ArtworkSource {
  texture: THREE.CanvasTexture;
  image: HTMLImageElement | null;
}

interface Play {
  card: Card;
  t: number;
  dir: 1 | -1;
  stage: 'focus' | 'open';
  // t is bounded by the stage's natural ceiling (focus 0 -> 0.82,
  // open continues 0.82 -> 1.42). The ceiling is recomputed every
  // frame from `stage`, never stored, so the timeline can run
  // continuously through both stages without resetting t.
  from: { pos: THREE.Vector3; rotY: number; scale: number };
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, v: number) => {
  const x = clamp((v - a) / (b - a), 0, 1);
  return x * x * (3 - 2 * x);
};
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

// The closed case is centred around z=0. These boundaries intentionally sum
// to T.THICK so the existing layout, hit testing and release timeline keep
// their exact external envelope while the interior reads as separate parts.
const BACK_Z = -T.THICK / 2 + T.BACK_THICK / 2;
const BACK_FRONT_Z = BACK_Z + T.BACK_THICK / 2;
const TRAY_Z = BACK_FRONT_Z + T.TRAY_THICK / 2;
const TRAY_FRONT_Z = BACK_FRONT_Z + T.TRAY_THICK;
const LID_Z = TRAY_FRONT_Z + T.AIR_GAP + T.LID_THICK / 2;
const SHEET_CLOSED_Z = TRAY_Z;
const OPTICAL_CLEAR = new THREE.Color(0xf8f4ed);
// The broad leaf is expressed by a restrained alpha surface plus the authored
// Fresnel/highlight pass below. Real transmission over the paper backplate
// produced an opaque white slab at grazing open angles; keeping the broad
// face nearly colourless lets the cut edges carry the acrylic colour instead.
const LID_FACE_BLEND = 0.998;
const LID_ALPHA = 0.024;
const SHELL_ALPHA = 0.015;
const ART_WIDTH_FACTOR = 0.890;
const ART_HEIGHT_FACTOR = 0.936;
const WIDE_TILT_LEFT = [0, 0.226, 0.249, 0.154] as const;
const WIDE_TILT_RIGHT = [0, 0.187, 0.243, 0.144] as const;
const WIDE_POSITION_LEFT = [0, -0.028, -0.047, 0.004] as const;
const WIDE_POSITION_RIGHT = [0, -0.018, 0.008, -0.043] as const;
const OPEN_SLOTS = {
  leftWide: [1.75, 2.65, 3.65],
  rightWide: [1.60, 2.60, 3.55],
  leftNarrow: [2.15, 3.05, 4.10],
  rightNarrow: [1.90, 2.95, 4.00],
  leftMobile: [2.50, 3.80, 5.00],
  rightMobile: [2.30, 3.80, 5.00],
} as const;

function frameGeometry(
  width: number,
  height: number,
  barWidth: number,
  depth: number,
  radius: number,
) {
  const verticalHeight = Math.max(barWidth, height);
  const horizontalWidth = Math.max(barWidth, width - barWidth * 2);
  const safeRadius = Math.min(radius, barWidth * 0.46, depth * 0.46);
  const geometries: THREE.BufferGeometry[] = [];

  for (const x of [-width / 2 + barWidth / 2, width / 2 - barWidth / 2]) {
    const geometry = new RoundedBoxGeometry(barWidth, verticalHeight, depth, 3, safeRadius);
    geometry.translate(x, 0, 0);
    geometries.push(geometry);
  }
  for (const y of [-height / 2 + barWidth / 2, height / 2 - barWidth / 2]) {
    const geometry = new RoundedBoxGeometry(horizontalWidth, barWidth, depth, 3, safeRadius);
    geometry.translate(0, y, 0);
    geometries.push(geometry);
  }

  const merged = mergeGeometries(geometries, false);
  geometries.forEach((geometry) => geometry.dispose());
  if (!merged) throw new Error('Unable to build acrylic frame geometry');
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

function themeColour(a: RailCollection, role: 'edge' | 'spine') {
  const value = role === 'edge' ? a.frameTheme.edgeColor : a.frameTheme.spineColor;
  return new THREE.Color(value);
}

function acrylicCutSurface(a: RailCollection, clearMix: number, whiteStage = false) {
  const isAnchor = a.title.trim().toLowerCase() === 'always';
  // Fashion-grade acrylic reads colour through accumulated thickness, not as
  // a uniformly painted rail. Non-anchor cases therefore receive a little
  // more optical clear while ALWAYS keeps the collection's cobalt signature.
  const opticalLift = isAnchor ? 0.035 : 0.045;
  return themeColour(a, 'edge').lerp(
    OPTICAL_CLEAR,
    whiteStage ? clamp(clearMix * 0.48 + 0.025, 0, 0.56) : clamp(acrylicClearMix(a, clearMix) + opticalLift, 0, 0.965),
  );
}

function acrylicClearMix(a: RailCollection, clearMix: number) {
  return clamp(clearMix + (1 - a.frameTheme.colorIntensity) * 0.22, 0, 0.94);
}

function mixHex(left: number, right: number, t: number) {
  const lr = (left >> 16) & 0xff;
  const lg = (left >> 8) & 0xff;
  const lb = left & 0xff;
  const rr = (right >> 16) & 0xff;
  const rg = (right >> 8) & 0xff;
  const rb = right & 0xff;
  return (Math.round(lerp(lr, rr, t)) << 16)
    | (Math.round(lerp(lg, rg, t)) << 8)
    | Math.round(lerp(lb, rb, t));
}

function lidSurfaceColor(a: RailCollection) {
  // Keep the broad face nearly colourless; the recipe tint is carried by
  // attenuation and becomes most visible through the polished cut edge.
  return themeColour(a, 'edge').lerp(OPTICAL_CLEAR, LID_FACE_BLEND);
}

function backingSurfaceColor(a: RailCollection) {
  if (a.frameTheme.trayTone === 'graphite') {
    const spine = Number.parseInt(a.frameTheme.spineColor.replace('#', ''), 16);
    return Number.isFinite(spine) ? mixHex(spine, 0x111315, 0.56) : 0x161817;
  }
  if (a.frameTheme.trayTone === 'ivory') return 0xe7e2da;
  if (a.frameTheme.trayTone === 'clear') return 0xc9c7c1;
  switch (a.shell) {
    case 'smoked': return 0x121614;
    case 'paleIce': return 0xd8e5e4;
    case 'amber': return 0x3a2208;
    case 'ice': return 0x071b4c;
    case 'dichroic': return 0x2a1238;
    case 'clear': return 0xe8e5df;
    default: return 0xc9c6bf;
  }
}

function hardwareSurfaceColor(a: RailCollection) {
  return a.frameTheme.hardwareTone === 'gunmetal' ? 0x596064 : 0xcbd0d1;
}

function canvasTexture(canvas: HTMLCanvasElement, renderer: THREE.WebGLRenderer) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  texture.needsUpdate = true;
  return texture;
}

function drawCoverCrop(
  g: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number,
  focalX = 0.5,
  focalY = 0.5,
  zoom = 1,
) {
  const sourceAspect = image.naturalWidth / image.naturalHeight;
  const targetAspect = width / height;
  let sx = 0;
  let sy = 0;
  let sw = image.naturalWidth;
  let sh = image.naturalHeight;
  if (sourceAspect > targetAspect) {
    sw = image.naturalHeight * targetAspect;
  } else {
    sh = image.naturalWidth / targetAspect;
  }
  const safeZoom = clamp(zoom, 1, 3);
  sw /= safeZoom;
  sh /= safeZoom;
  sx = (image.naturalWidth - sw) * clamp(focalX, 0, 1);
  sy = (image.naturalHeight - sh) * clamp(focalY, 0, 1);
  g.drawImage(image, sx, sy, sw, sh, 0, 0, width, height);
}

function drawContainedArtwork(
  g: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number,
  matte: RailCollection['coverMatte'],
  focalX = 0.5,
  focalY = 0.5,
  zoom = 1,
) {
  const matteColour = matte === 'graphite'
    ? '#171918'
    : matte === 'ivory'
      ? '#e9e3da'
      : '#d7d2ca';
  g.fillStyle = matteColour;
  g.fillRect(0, 0, width, height);
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight) * clamp(zoom, 0.65, 3);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  const x = (width - drawWidth) * clamp(focalX, 0, 1);
  const y = (height - drawHeight) * clamp(focalY, 0, 1);
  g.drawImage(image, x, y, drawWidth, drawHeight);
}

function makeArtwork(a: RailCollection, renderer: THREE.WebGLRenderer): ArtworkSource {
  const canvas = document.createElement('canvas');
  const artworkAspect = (T.CASE_W * ART_WIDTH_FACTOR) / (T.CASE_H * ART_HEIGHT_FACTOR);
  // A ~512 × 910 insert exceeds the on-screen print resolution, without
  // allocating a 768 px procedural painting that is immediately discarded.
  canvas.width = 512;
  canvas.height = Math.round(canvas.width / artworkAspect);
  const context = canvas.getContext('2d')!;
  context.fillStyle = a.coverMatte === 'ivory' ? '#ffffff' : '#000000';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const texture = canvasTexture(canvas, renderer);
  if (!a.cover.startsWith('/') || a.cover.startsWith('//')) return { texture, image: null };

  const image = new Image();
  image.decoding = 'async';
  image.onload = () => {
    context.clearRect(0, 0, canvas.width, canvas.height);
    // Respect the authored crop, focal point, matte and fit; no extra filter,
    // vignette or generated grain is painted over the photographer's cover.
    if (a.coverFit === 'contain') {
      drawContainedArtwork(context, image, canvas.width, canvas.height,
        a.coverMatte, a.coverFocus[0], a.coverFocus[1], a.coverZoom);
    } else {
      drawCoverCrop(context, image, canvas.width, canvas.height,
        a.coverFocus[0], a.coverFocus[1], a.coverZoom);
    }
    texture.needsUpdate = true;
  };
  image.onerror = () => {
    image.onload = null;
    image.onerror = null;
  };
  image.src = a.cover;
  return { texture, image };
}

function makeSpine(a: RailCollection, index: number, renderer: THREE.WebGLRenderer) {
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 1024;
  const g = canvas.getContext('2d')!;
  const isAlways = a.title.trim().toLowerCase() === 'always';
  const coreWidth = isAlways ? 42 : 28;
  const coreX = (160 - coreWidth) / 2;
  g.clearRect(0, 0, 160, 1024);

  // Only the narrow archival label is printed. The transparent canvas around
  // it lets the actual side wall, cut edge and artwork depth remain visible.
  const spineTheme = themeColour(a, 'spine');
  const spineRgb = {
    r: Math.round(spineTheme.r * 255),
    g: Math.round(spineTheme.g * 255),
    b: Math.round(spineTheme.b * 255),
  };
  const core = g.createLinearGradient(coreX, 0, coreX + coreWidth, 0);
  core.addColorStop(0, `rgba(${spineRgb.r},${spineRgb.g},${spineRgb.b},0.62)`);
  core.addColorStop(0.48, `rgba(${spineRgb.r},${spineRgb.g},${spineRgb.b},0.79)`);
  core.addColorStop(1, `rgba(${spineRgb.r},${spineRgb.g},${spineRgb.b},0.64)`);
  g.fillStyle = core;
  g.fillRect(coreX, 24, coreWidth, 976);
  g.strokeStyle = 'rgba(255,255,255,0.15)';
  g.lineWidth = 1;
  g.strokeRect(coreX + 1.5, 26, coreWidth - 3, 972);
  // Hairline rails and registration ticks make the label read as a physical
  // archival spine rather than a dark UI strip.
  g.strokeStyle = 'rgba(255,255,255,0.20)';
  for (const x of [coreX - 4, coreX + coreWidth + 4]) {
    g.beginPath();
    g.moveTo(x, 36);
    g.lineTo(x, 988);
    g.stroke();
  }
  g.strokeStyle = 'rgba(18,18,18,0.28)';
  for (const y of [164, 860]) {
    g.beginPath();
    g.moveTo(coreX + 5, y);
    g.lineTo(coreX + coreWidth - 5, y);
    g.stroke();
  }
  g.fillStyle = 'rgba(248,246,239,0.78)';
  for (const y of [50, 974]) {
    g.beginPath();
    g.arc(80, y, 3.8, 0, Math.PI * 2);
    g.fill();
  }
  g.save();
  g.translate(80, 512);
  g.rotate(-Math.PI / 2);
  g.shadowColor = 'rgba(0,0,0,0.24)';
  g.shadowBlur = 2;
  g.fillStyle = 'rgba(255,255,255,0.88)';
  g.font = '500 18px Arial, Helvetica, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const spineLabel = isAlways
    ? 'ALWAYS / 05 / 06'
    : `${String(index + 1).padStart(2, '0')} / ${a.title.toUpperCase()}`;
  g.fillText(spineLabel, 0, 0, 890);
  g.restore();
  return canvasTexture(canvas, renderer);
}

function makeContactShadow(renderer: THREE.WebGLRenderer, opacity: number, a: RailCollection) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const g = canvas.getContext('2d')!;
  const shadow = g.createRadialGradient(128, 32, 2, 128, 32, 108);
  shadow.addColorStop(0, 'rgba(38,34,31,0.92)');
  shadow.addColorStop(0.22, 'rgba(50,44,40,0.62)');
  shadow.addColorStop(0.58, 'rgba(70,62,57,0.16)');
  shadow.addColorStop(1, 'rgba(70,62,57,0)');
  g.fillStyle = shadow;
  g.fillRect(0, 0, canvas.width, canvas.height);
  // A restrained refraction glint directly beneath the foot sells the
  // pressure of a transparent object resting on a polished acrylic plinth.
  const glint = g.createRadialGradient(128, 31, 0, 128, 31, 38);
  glint.addColorStop(0, 'rgba(255,250,242,0.44)');
  glint.addColorStop(0.38, 'rgba(255,250,242,0.13)');
  glint.addColorStop(1, 'rgba(255,250,242,0)');
  g.fillStyle = glint;
  g.fillRect(82, 24, 92, 16);
  const texture = canvasTexture(canvas, renderer);
  const shadowTint = themeColour(a, 'edge').clone().lerp(new THREE.Color(0x554c46), 0.82);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    color: shadowTint,
    transparent: true,
    opacity,
    depthWrite: false,
    toneMapped: true,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.286, 0.040), material);
  mesh.rotation.x = -Math.PI / 2;
  // Sit one millimetre over the plinth instead of floating on the case. The
  // scale is updated from the case yaw in apply(), so the footprint stays
  // short when edge-on and only widens as the broad face turns to camera.
  mesh.position.set(0, -T.CASE_H / 2 - 0.015, 0.018);
  mesh.renderOrder = 2;
  mesh.raycast = () => {};
  return mesh;
}

function lidMaterial(a: RailCollection, whiteStage = false): THREE.MeshPhysicalMaterial {
  const r = SHELLS[a.shell] || SHELLS.clear;
  const roughness = clamp(r.roughness * 0.34, 0.018, 0.105);
  return new THREE.MeshPhysicalMaterial({
    color: whiteStage ? themeColour(a, 'edge').lerp(OPTICAL_CLEAR, 0.76) : lidSurfaceColor(a),
    metalness: 0,
    roughness: whiteStage ? 0.72 : roughness,
    transmission: 0,
    thickness: T.LID_THICK,
    ior: r.ior,
    // The leaf is a very light optical veil. Depth testing remains enabled,
    // while depth writing is disabled so the third case remains legible
    // through the open door as in the approved museum mock-up.
    transparent: true,
    opacity: whiteStage ? 0.095 : LID_ALPHA,
    clearcoat: whiteStage ? 0 : 1,
    clearcoatRoughness: 0.028,
    envMapIntensity: whiteStage ? 0 : 1.08,
    specularIntensity: whiteStage ? 0 : 1,
    specularColor: new THREE.Color(0xfffbf3),
    iridescence: a.shell === 'dichroic' ? 0.28 : 0,
    iridescenceIOR: 1.32,
    iridescenceThicknessRange: [90, 250],
    side: THREE.DoubleSide,
    depthWrite: false,
    forceSinglePass: true,
  });
}

function lidHighlightMaterial(a: RailCollection, whiteStage = false): THREE.ShaderMaterial {
  const edge = whiteStage
    ? themeColour(a, 'edge').lerp(new THREE.Color(0xc7c8c3), 0.56)
    : acrylicCutSurface(a, 0.82);
  return new THREE.ShaderMaterial({
    uniforms: {
      edgeColour: { value: edge },
      baseAlpha: { value: whiteStage ? 0.10 : 0.0052 },
      edgeAlpha: { value: whiteStage ? 0.12 : 0.084 },
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vViewDirection;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vViewDirection = normalize(-viewPosition.xyz);
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: whiteStage ? `
      varying vec2 vUv;
      uniform vec3 edgeColour;
      uniform float baseAlpha;
      uniform float edgeAlpha;
      void main() {
        float edge = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
        float cut = 1.0 - smoothstep(0.0, 0.014, edge);
        // Uniform faint tint and cut edges reveal the pane without reflections.
        gl_FragColor = vec4(edgeColour, baseAlpha + cut * edgeAlpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    ` : `
      varying vec3 vNormal;
      varying vec3 vViewDirection;
      varying vec2 vUv;
      uniform vec3 edgeColour;
      uniform float baseAlpha;
      uniform float edgeAlpha;
      float microNoise(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }
      void main() {
        float facing = clamp(abs(dot(normalize(vNormal), normalize(vViewDirection))), 0.0, 1.0);
        float fresnel = pow(1.0 - facing, 2.25);
        float nearestEdge = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
        float innerLip = exp(-pow((nearestEdge - 0.031) * 82.0, 2.0));
        float sweepCoordinate = vUv.x * 0.78 + vUv.y * 0.22;
        float studioSweep = exp(-pow((sweepCoordinate - 0.35) * 3.15, 2.0));
        float studioCore = exp(-pow((sweepCoordinate - 0.29) * 7.8, 2.0));
        float returnSweep = exp(-pow((vUv.x * 0.64 - vUv.y * 0.36 - 0.08) * 4.8, 2.0));
        float verticalSoftbox = exp(-pow((vUv.x - 0.16) * 8.5, 2.0)) * smoothstep(0.08, 0.62, vUv.y);
        float sideStrip = exp(-pow((vUv.x - 0.82) * 10.5, 2.0)) * (0.72 + 0.28 * vUv.y);
        float topSheen = exp(-pow((vUv.y - 0.91) * 10.0, 2.0));
        float micro = microNoise(floor(vUv * vec2(960.0, 1180.0))) - 0.5;
        float alpha = baseAlpha
          + fresnel * edgeAlpha * 0.32
          + innerLip * 0.034
          + studioSweep * 0.052
          + studioCore * 0.019
          + returnSweep * 0.018
          + verticalSoftbox * 0.014
          + sideStrip * 0.016
          + topSheen * 0.012
          + micro * 0.0022;
        vec3 colour = mix(vec3(1.0, 0.988, 0.965), edgeColour, fresnel * 0.30 + innerLip * 0.10);
        colour += vec3(0.010, -0.002, -0.008) * fresnel * (vUv.x - 0.5);
        gl_FragColor = vec4(colour, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    forceSinglePass: true,
    toneMapped: true,
  });
}

function trayMaterial(a: RailCollection): THREE.MeshPhysicalMaterial {
  const r = SHELLS[a.shell] || SHELLS.clear;
  return new THREE.MeshPhysicalMaterial({
    color: themeColour(a, 'edge').lerp(OPTICAL_CLEAR, 0.91),
    metalness: 0,
    roughness: clamp(r.roughness * 0.40, 0.020, 0.072),
    // The rear plate is seen from both sides across seven overlapping cases.
    // A restrained optical-alpha layer keeps rear-mounted prints legible;
    // using the full transmission pre-pass here creates a milky slab when
    // viewed through the reverse face on real browsers/GPUs.
    transmission: 0,
    thickness: T.BACK_THICK,
    ior: r.ior,
    transparent: true,
    opacity: SHELL_ALPHA,
    clearcoat: 1,
    clearcoatRoughness: 0.045,
    envMapIntensity: 1.20,
    specularIntensity: 0.90,
    specularColor: new THREE.Color(0xfffcf4),
    side: THREE.DoubleSide,
    depthWrite: false,
    forceSinglePass: true,
  });
}

function createCard(a: RailCollection, index: number, rail: THREE.Group, renderer: THREE.WebGLRenderer, whiteStage = false): Card {
  const cutSurface = (clearMix: number) => acrylicCutSurface(a, clearMix, whiteStage);
  const backingColor = whiteStage
    ? themeColour(a, 'edge').lerp(OPTICAL_CLEAR, 0.46)
    : new THREE.Color(backingSurfaceColor(a));
  const root = new THREE.Group();
  root.userData = { type: TYPE.RAIL, idx: index };
  const accentMats: THREE.MeshPhysicalMaterial[] = [];

  // Layer 1: a translucent structural rear tray. Its flatter bevel keeps the
  // silhouette machined while allowing artwork to read from oblique angles.
  const shellGeo = new RoundedBoxGeometry(T.CASE_W, T.CASE_H, T.BACK_THICK, 4, 0.008);
  const shellMat = trayMaterial(a);
  const shell = new THREE.Mesh(shellGeo, shellMat);
  shell.position.z = BACK_Z;
  shell.castShadow = false;
  shell.receiveShadow = true;
  shell.userData = { type: TYPE.SHELL, idx: index };
  root.add(shell);

  // A fixed structural perimeter gives the case a readable top, side and
  // bottom thickness even when the transparent door is open. All four bars
  // are merged into one mesh: one draw call per body instead of four.
  const isAlwaysCase = a.title.trim().toLowerCase() === 'always';
  const bodyRimColor = cutSurface(isAlwaysCase ? 0.31 : 0.39);
  const bodyRimMat = new THREE.MeshPhysicalMaterial({
    color: bodyRimColor,
    metalness: 0,
    roughness: 0.035,
    transmission: whiteStage ? 0.44 : 0.84,
    thickness: T.THICK,
    ior: (SHELLS[a.shell] || SHELLS.clear).ior,
    transparent: false,
    opacity: 1,
    clearcoat: 1,
    clearcoatRoughness: 0.014,
    envMapIntensity: 1.45,
    specularIntensity: 1,
    attenuationColor: bodyRimColor,
    attenuationDistance: 0.28,
    side: THREE.FrontSide,
    depthWrite: true,
  });
  accentMats.push(bodyRimMat);
  const bodyFrame = new THREE.Mesh(
    frameGeometry(T.CASE_W * 0.992, T.CASE_H * 0.992, 0.0102, T.THICK, 0.0039),
    bodyRimMat,
  );
  bodyFrame.renderOrder = 1;
  root.add(bodyFrame);

  // invisible hit area so the narrow spine is easy to click
  const hit = new THREE.Mesh(
    new THREE.BoxGeometry(T.CASE_W, T.CASE_H, 0.38),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
  );
  hit.userData = { type: TYPE.HIT, idx: index };
  hit.visible = false;
  root.add(hit);

  // Layers 2-4: a removable matte inner tray carries the print and floats in
  // front of the rear acrylic plate. Its outer lip is intentionally separate
  // from both the artwork and body, exposing the air chamber at oblique yaw.
  const sheet = new THREE.Group();
  const backingMat = new THREE.MeshPhysicalMaterial({
    color: backingColor,
    metalness: 0,
    roughness: 0.72,
    transmission: 0,
    clearcoat: 0.08,
    clearcoatRoughness: 0.54,
    envMapIntensity: 0.38,
    transparent: false,
    opacity: 1,
    side: THREE.FrontSide,
    depthWrite: true
  });
  const backing = new THREE.Mesh(
    new RoundedBoxGeometry(T.CASE_W * 0.922, T.CASE_H * 0.958, T.TRAY_THICK, 3, 0.006),
    backingMat
  );
  backing.castShadow = false;
  sheet.add(backing);

  const trayLipColor = cutSurface(0.58);
  const trayLipMat = new THREE.MeshPhysicalMaterial({
    color: trayLipColor,
    metalness: 0,
    roughness: 0.10,
    transmission: 0.28,
    clearcoat: 0.82,
    clearcoatRoughness: 0.07,
    envMapIntensity: 1.05,
    transparent: false,
    opacity: 1,
    depthWrite: true,
  });
  accentMats.push(trayLipMat);
  const trayLip = new THREE.Mesh(
    frameGeometry(T.CASE_W * 0.914, T.CASE_H * 0.950, 0.0072, T.TRAY_THICK * 1.10, 0.0029),
    trayLipMat,
  );
  trayLip.position.z = 0.003;
  trayLip.renderOrder = 2;
  sheet.add(trayLip);

  const artworkSource = makeArtwork(a, renderer);
  const artMat = new THREE.MeshBasicMaterial({
    map: artworkSource.texture,
    color: 0xffffff,
    transparent: false,
    opacity: 1,
    side: THREE.FrontSide,
    depthWrite: true,
    toneMapped: false,
  });
  const artWidth = T.CASE_W * ART_WIDTH_FACTOR;
  const artHeight = T.CASE_H * ART_HEIGHT_FACTOR;
  const art = new THREE.Mesh(new THREE.PlaneGeometry(artWidth, artHeight), artMat);
  art.position.set(0, 0, T.TRAY_THICK / 2 + 0.0024);
  art.receiveShadow = false;
  sheet.add(art);

  // A dedicated work hit target is smaller than the case hit volume. It is
  // only consulted once the door is fully open, giving the interface two
  // unambiguous gestures: click the frame to close; click the mounted work to
  // enter its 6–9 image series viewer.
  const artHit = new THREE.Mesh(
    new THREE.BoxGeometry(artWidth, artHeight, 0.038),
    hit.material,
  );
  artHit.position.z = T.TRAY_THICK / 2 + 0.018;
  artHit.userData = { type: TYPE.ARTWORK, idx: index };
  artHit.visible = false;
  sheet.add(artHit);

  // Archive inserts are printed on both faces. The left half of the rail is
  // viewed through the rear acrylic at its resting yaw; without a rear print
  // those cases collapse into anonymous grey backing boards. Reuse the same
  // local texture on a reversed plane just behind the carrier so both halves
  // of the fan retain the artwork information visible in the approved image.
  const rearArt = new THREE.Mesh(new THREE.PlaneGeometry(artWidth, artHeight), artMat);
  rearArt.position.set(0, 0, -T.TRAY_THICK / 2 - 0.0015);
  rearArt.rotation.y = Math.PI;
  rearArt.receiveShadow = false;
  sheet.add(rearArt);

  // A hairline mount shadow is the only dark edge around the print. It makes
  // the image read as physically seated in a tray without becoming a poster
  // card or a broad black frame.
  const mountShadowMat = new THREE.ShaderMaterial({
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      void main() {
        float nearestEdge = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
        float ao = 1.0 - smoothstep(0.0, 0.035, nearestEdge);
        float lip = exp(-pow((nearestEdge - 0.014) * 85.0, 2.0));
        float alpha = ao * 0.050 + lip * 0.085;
        vec3 colour = mix(vec3(0.018, 0.020, 0.022), vec3(0.88, 0.86, 0.82), lip * 0.92);
        gl_FragColor = vec4(colour, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
  });
  const mountShadow = new THREE.Mesh(new THREE.PlaneGeometry(artWidth, artHeight), mountShadowMat);
  mountShadow.position.z = T.TRAY_THICK / 2 + 0.0032;
  mountShadow.renderOrder = 3;
  sheet.add(mountShadow);

  // A nearly colourless spacer sits inside the air chamber rather than on
  // the print. Its double contour is the visible proof that the artwork is
  // mounted behind the door, not pasted onto a decorative frame.
  const airSpacerMat = new THREE.MeshPhysicalMaterial({
    color: cutSurface(0.86),
    metalness: 0,
    roughness: 0.035,
    transmission: 0.68,
    thickness: 0.010,
    ior: (SHELLS[a.shell] || SHELLS.clear).ior,
    transparent: false,
    clearcoat: 1,
    clearcoatRoughness: 0.012,
    envMapIntensity: 1.35,
    attenuationColor: themeColour(a, 'edge'),
    attenuationDistance: 0.36,
    depthWrite: true,
  });
  accentMats.push(airSpacerMat);
  const airSpacer = new THREE.Mesh(
    frameGeometry(T.CASE_W * 0.900, T.CASE_H * 0.946, 0.0042, 0.010, 0.0020),
    airSpacerMat,
  );
  airSpacer.position.z = T.TRAY_THICK / 2 + T.AIR_GAP * 0.43;
  airSpacer.renderOrder = 4;
  sheet.add(airSpacer);

  sheet.position.z = SHEET_CLOSED_Z;
  // sheet never blocks the wider shell click
  sheet.raycast = () => {};
  root.add(sheet);

  // spine label (visible when the slab is edge-on)
  const spineTexture = makeSpine(a, index, renderer);
  const spineMat = new THREE.MeshStandardMaterial({
    map: spineTexture,
    color: 0xffffff,
    metalness: 0,
    roughness: 0.62,
    transparent: true,
    opacity: 1,
    side: THREE.FrontSide,
    alphaTest: 0.012,
    depthWrite: false
  });
  const spine = new THREE.Mesh(new THREE.PlaneGeometry(T.THICK * 0.93, T.CASE_H * 0.88), spineMat);
  spine.position.set(-T.CASE_W / 2 - 0.007, 0, 0);
  spine.rotation.y = -Math.PI / 2;
  spine.raycast = () => {};
  spine.renderOrder = 3;
  const spineRight = new THREE.Mesh(new THREE.PlaneGeometry(T.THICK * 0.93, T.CASE_H * 0.88), spineMat);
  spineRight.position.set(T.CASE_W / 2 + 0.007, 0, 0);
  spineRight.rotation.y = Math.PI / 2;
  spineRight.raycast = () => {};
  spineRight.renderOrder = 3;
  root.add(spine, spineRight);

  // Layer 3: the transmissive front lid is present in every state. The
  // existing release timeline simply rotates this same physical layer.
  const lidPivot = new THREE.Group();
  lidPivot.position.set(-T.CASE_W / 2, 0, LID_Z);
  const lidMat = lidMaterial(a, whiteStage);
  const lidGeo = new RoundedBoxGeometry(T.CASE_W, T.CASE_H, T.LID_THICK, 4, 0.006);
  const lid = new THREE.Mesh(
    lidGeo,
    lidMat
  );
  lid.position.x = T.CASE_W / 2;
  // The transparent leaf must not cast an opaque slab-shaped shadow.
  lid.castShadow = false;
  lid.receiveShadow = true;
  lid.raycast = () => {};
  lidPivot.add(lid);

  const lidHighlightMat = lidHighlightMaterial(a, whiteStage);
  const lidHighlight = new THREE.Mesh(new THREE.PlaneGeometry(T.CASE_W * 0.965, T.CASE_H * 0.965), lidHighlightMat);
  lidHighlight.position.set(T.CASE_W / 2, 0, T.LID_THICK / 2 + 0.0008);
  lidHighlight.renderOrder = 6;
  lidHighlight.raycast = () => {};
  lidPivot.add(lidHighlight);

  // A dedicated invisible hit volume follows the hinged leaf so clicking the
  // visible open door reverses the same continuous timeline.
  const doorHit = hit.clone();
  doorHit.position.x = T.CASE_W / 2;
  doorHit.userData = { type: TYPE.HIT, idx: index };
  doorHit.visible = false;
  lidPivot.add(doorHit);

  const edgeMat = new THREE.LineBasicMaterial({
    color: cutSurface(0.30),
    transparent: true,
    opacity: 0.075,
    depthWrite: false,
  });
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(lidGeo, 34), edgeMat);
  edges.position.x = T.CASE_W / 2;
  edges.renderOrder = 5;
  lidPivot.add(edges);

  // Two concentric polished frames make the front leaf's double-cut edge.
  // Each frame is one merged geometry, so the added inner bevel costs only
  // one additional draw call instead of four independent rails.
  const rimColor = cutSurface(isAlwaysCase ? 0.30 : 0.36);
  const rimMat = new THREE.MeshPhysicalMaterial({
    color: rimColor,
    metalness: 0,
    roughness: 0.032,
    transmission: whiteStage ? 0.46 : 0.82,
    thickness: T.LID_THICK * 1.8,
    ior: (SHELLS[a.shell] || SHELLS.clear).ior,
    transparent: false,
    opacity: 1,
    clearcoat: 1,
    clearcoatRoughness: 0.012,
    envMapIntensity: 1.52,
    specularIntensity: 1,
    attenuationColor: rimColor,
    attenuationDistance: 0.24,
    depthWrite: true
  });
  accentMats.push(rimMat);
  const outerCutEdge = new THREE.Mesh(
    frameGeometry(T.CASE_W * 0.966, T.CASE_H * 0.970, 0.0060, T.LID_THICK * 1.14, 0.0028),
    rimMat,
  );
  outerCutEdge.position.set(T.CASE_W / 2, 0, 0.006);
  outerCutEdge.renderOrder = 4;
  lidPivot.add(outerCutEdge);

  const innerRimColor = rimColor.clone().lerp(OPTICAL_CLEAR, 0.54);
  const innerRimMat = new THREE.MeshPhysicalMaterial({
    color: innerRimColor,
    metalness: 0,
    roughness: 0.020,
    transmission: 0.78,
    thickness: T.LID_THICK,
    ior: (SHELLS[a.shell] || SHELLS.clear).ior,
    transparent: false,
    opacity: 1,
    clearcoat: 1,
    clearcoatRoughness: 0.008,
    envMapIntensity: 1.72,
    specularIntensity: 1,
    attenuationColor: rimColor,
    attenuationDistance: 0.24,
    depthWrite: true,
  });
  accentMats.push(innerRimMat);
  const innerCutEdge = new THREE.Mesh(
    frameGeometry(T.CASE_W * 0.918, T.CASE_H * 0.944, 0.0038, T.LID_THICK * 0.62, 0.0018),
    innerRimMat,
  );
  innerCutEdge.position.set(T.CASE_W / 2, 0, T.LID_THICK * 0.23);
  innerCutEdge.renderOrder = 5;
  lidPivot.add(innerCutEdge);

  // Four restrained fasteners complete the archival hardware language. One
  // low-poly geometry and one material are shared across all four instances;
  // the closed cylinder has visible caps from either side of the open door.
  const fastenerGeo = new THREE.CylinderGeometry(0.0104, 0.0104, 0.0064, 18, 1, false);
  fastenerGeo.rotateX(Math.PI / 2);
  const fastenerMat = new THREE.MeshPhysicalMaterial({
    color: a.frameTheme.hardwareTone === 'gunmetal' ? 0x353d40 : 0x555d60,
    metalness: 0.90,
    roughness: 0.15,
    emissive: 0x000000,
    emissiveIntensity: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    envMapIntensity: 1.52,
    transparent: false,
    opacity: 1,
    side: THREE.FrontSide,
    depthTest: true,
    depthWrite: true
  });
  accentMats.push(fastenerMat);
  const washerGeo = new THREE.TorusGeometry(0.0176, 0.0018, 6, 18);
  const washerMat = new THREE.MeshPhysicalMaterial({
    color: hardwareSurfaceColor(a),
    metalness: 0.86,
    roughness: 0.14,
    transparent: false,
    opacity: 1,
    clearcoat: 0.65,
    clearcoatRoughness: 0.12,
    envMapIntensity: 1.38,
    depthTest: true,
    depthWrite: true,
  });
  accentMats.push(washerMat);
  const fastenerInsetX = 0.070;
  const fastenerInsetY = 0.072;
  const fasteners = new THREE.InstancedMesh(fastenerGeo, fastenerMat, 4);
  const washers = new THREE.InstancedMesh(washerGeo, washerMat, 4);
  const hardwareTransform = new THREE.Object3D();
  let hardwareIndex = 0;
  for (const x of [fastenerInsetX, T.CASE_W - fastenerInsetX]) {
    for (const y of [-T.CASE_H / 2 + fastenerInsetY, T.CASE_H / 2 - fastenerInsetY]) {
      hardwareTransform.position.set(x, y, T.LID_THICK / 2 + 0.008);
      hardwareTransform.updateMatrix();
      fasteners.setMatrixAt(hardwareIndex, hardwareTransform.matrix);
      hardwareTransform.position.z = T.LID_THICK / 2 + 0.004;
      hardwareTransform.updateMatrix();
      washers.setMatrixAt(hardwareIndex, hardwareTransform.matrix);
      hardwareIndex += 1;
    }
  }
  fasteners.instanceMatrix.needsUpdate = true;
  washers.instanceMatrix.needsUpdate = true;
  fasteners.castShadow = false;
  fasteners.receiveShadow = false;
  fasteners.renderOrder = 8;
  washers.renderOrder = 7;
  lidPivot.add(washers, fasteners);

  // A second, slightly recessed set belongs to the artwork carrier rather
  // than the removable lid. It is hidden behind the closed cover and becomes
  // visible when the door opens, making the print read as a mounted object.
  const trayFasteners = new THREE.InstancedMesh(fastenerGeo, fastenerMat, 4);
  const trayHardwareTransform = new THREE.Object3D();
  let trayHardwareIndex = 0;
  for (const x of [-T.CASE_W * 0.438, T.CASE_W * 0.438]) {
    for (const y of [-T.CASE_H * 0.458, T.CASE_H * 0.458]) {
      trayHardwareTransform.position.set(x, y, T.TRAY_THICK / 2 + 0.006);
      trayHardwareTransform.scale.setScalar(0.62);
      trayHardwareTransform.updateMatrix();
      trayFasteners.setMatrixAt(trayHardwareIndex, trayHardwareTransform.matrix);
      trayHardwareIndex += 1;
    }
  }
  trayFasteners.instanceMatrix.needsUpdate = true;
  trayFasteners.castShadow = false;
  trayFasteners.receiveShadow = false;
  trayFasteners.renderOrder = 4;
  sheet.add(trayFasteners);
  root.add(lidPivot);

  // Two visible hinge barrels remain attached to the case body while the lid
  // pivots around the same left axis. A restrained latch on the opposite edge
  // completes the collectible-object construction.
  const hardwareMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(hardwareSurfaceColor(a)).lerp(themeColour(a, 'edge'), 0.10),
    metalness: 0.76,
    roughness: 0.27,
    transmission: 0,
    transparent: false,
    opacity: 1,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    envMapIntensity: 1.22,
    side: THREE.FrontSide,
    depthWrite: true,
  });
  accentMats.push(hardwareMat);
  const hingeGeo = new THREE.CylinderGeometry(0.0100, 0.0100, 0.082, 16, 1, false);
  for (const y of [-T.CASE_H * 0.29, T.CASE_H * 0.29]) {
    const hinge = new THREE.Mesh(hingeGeo, hardwareMat);
    hinge.position.set(-T.CASE_W / 2 - 0.006, y, LID_Z + 0.006);
    hinge.renderOrder = 7;
    root.add(hinge);
  }
  // Slim polished collars split each barrel into two mechanical knuckles.
  // They share one instanced draw call per case, preserving the render budget
  // while making the hinge read as a real pivot rather than a flat block.
  const hingeCollarGeo = new THREE.TorusGeometry(0.0119, 0.0019, 6, 18);
  const hingeCollars = new THREE.InstancedMesh(hingeCollarGeo, hardwareMat, 4);
  const hingeCollarTransform = new THREE.Object3D();
  let hingeCollarIndex = 0;
  for (const centreY of [-T.CASE_H * 0.29, T.CASE_H * 0.29]) {
    for (const offsetY of [-0.030, 0.030]) {
      hingeCollarTransform.position.set(-T.CASE_W / 2 - 0.006, centreY + offsetY, LID_Z + 0.006);
      hingeCollarTransform.rotation.x = Math.PI / 2;
      hingeCollarTransform.updateMatrix();
      hingeCollars.setMatrixAt(hingeCollarIndex, hingeCollarTransform.matrix);
      hingeCollarIndex += 1;
    }
  }
  hingeCollars.instanceMatrix.needsUpdate = true;
  hingeCollars.castShadow = false;
  hingeCollars.receiveShadow = false;
  hingeCollars.renderOrder = 8;
  root.add(hingeCollars);
  const latch = new THREE.Mesh(
    new RoundedBoxGeometry(0.018, 0.052, 0.027, 3, 0.004),
    hardwareMat,
  );
  latch.position.set(T.CASE_W / 2 + 0.004, 0, LID_Z + 0.004);
  latch.renderOrder = 7;
  root.add(latch);

  const contactShadowOpacity = a.shell === 'clear' || a.shell === 'paleIce'
    ? 0.09
    : a.shell === 'smoked'
      ? 0.13
      : 0.14;
  const contactShadow = makeContactShadow(renderer, contactShadowOpacity, a);
  root.add(contactShadow);

  rail.add(root);

  // Fade the finished colour into the stage while retaining acrylic depth
  // ordering. Preserve each material's original highlight shader hooks.
  const edgeFade = { value: 1 };
  const fadeBackground = { value: renderer.getClearColor(new THREE.Color()).clone() };
  const fadeMaterials = new Set<THREE.Material>();
  root.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => fadeMaterials.add(material));
    }
  });
  for (const material of fadeMaterials) {
    const originalCompile = material.onBeforeCompile.bind(material);
    const originalKey = material.customProgramCacheKey();
    material.onBeforeCompile = (shader, context) => {
      originalCompile(shader, context);
      shader.uniforms.archiveEdgeFade = edgeFade;
      shader.uniforms.archiveFadeBackground = fadeBackground;
      shader.fragmentShader = `uniform float archiveEdgeFade;\nuniform vec3 archiveFadeBackground;\n${shader.fragmentShader}`;
      shader.fragmentShader = shader.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>
        gl_FragColor.rgb = mix(archiveFadeBackground, gl_FragColor.rgb, archiveEdgeFade);
      `);
    };
    material.customProgramCacheKey = () => `${originalKey}-archive-edge-fade-v2`;
  }

  for (const material of accentMats) {
    material.userData.baseOpacity = material.opacity;
    material.userData.baseEnvMapIntensity = material.envMapIntensity;
  }

  return {
    root, shell, hit, doorHit, artHit, shellMat, edges, edgeMat, sheet, backingMat, artMat, spineMat, lidPivot, lidMat,
    lidHighlightMat,
    accentMats,
    contactShadow,
    artworkImage: artworkSource.image,
    cur: new THREE.Vector3(8 + index * T.GAP, 0, 0),
    curRotY: -Math.PI / 2,
    curScale: 1,
    faceT: 0,
    hoverT: 0,
    opacity: 1,
    data: a,
    edgeColor: themeColour(a, 'edge'),
    lidColor: lidMat.color.clone(),
    baseBackingColor: backingColor.clone(),
    edgeFade,
  };
}

export class SceneController {
  private frame: HTMLDivElement;
  private video: HTMLVideoElement | null = null;
  private videoTexture: THREE.VideoTexture | null = null;
  private videoCard: Card | null = null;
  private videoPoster: THREE.Texture | null = null;

  public openCase(index: number) {
    if (!Number.isInteger(index) || index < 0 || index >= this.cards.length) return;
    this.handleClick(index);
  }

  public closeSelected() {
    if (this.play) this.play.dir = -1;
    this.stopVideo();
  }

  public toggleMute() {
    if (!this.video) return;
    this.video.muted = !this.video.muted;
    this.reportVideoState();
  }

  public seekVideo(time: number) {
    if (!this.video || !Number.isFinite(time) || !Number.isFinite(this.video.duration)) return;
    this.video.currentTime = clamp(time, 0, this.video.duration);
    this.reportVideoProgress();
  }

  private reportVideoProgress() {
    this.callbacks.onVideoProgress?.({
      currentTime: this.video?.currentTime ?? 0,
      duration: this.video && Number.isFinite(this.video.duration) ? this.video.duration : 0,
    });
  }

  public togglePlayback() {
    if (!this.video) return;
    if (this.video.paused) void this.video.play().catch(() => this.reportVideoState());
    else this.video.pause();
    this.reportVideoState();
  }

  private reportVideoState() {
    this.callbacks.onVideoState?.(!!this.video && !this.video.paused, this.video?.muted ?? true);
  }

  private startVideo(card: Card) {
    if (!card.data.videoSrc || this.videoCard === card) return;
    this.stopVideo();
    const video = document.createElement('video');
    protectPortfolioVideo(video);
    video.hidden = true;
    video.dataset.archiveVideo = card.data.id;
    video.setAttribute('aria-hidden', 'true');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.src = card.data.videoSrc;
    video.addEventListener('playing', () => this.reportVideoState());
    video.addEventListener('pause', () => this.reportVideoState());
    video.addEventListener('ended', () => this.reportVideoState());
    video.addEventListener('timeupdate', () => this.reportVideoProgress());
    video.addEventListener('loadedmetadata', () => this.reportVideoProgress());
    this.frame.appendChild(video);
    const texture = new THREE.VideoTexture(video);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.video = video;
    this.videoTexture = texture;
    this.videoCard = card;
    this.videoPoster = card.artMat.map;
    video.addEventListener('loadeddata', () => {
      if (this.video !== video || !this.play || this.play.dir < 0) return;
      card.artMat.map = texture;
      card.artMat.needsUpdate = true;
    }, { once: true });
    void video.play().catch(() => this.reportVideoState());
  }

  private stopVideo() {
    if (!this.video) return;
    this.resumeVideoOnActivate = false;
    const video = this.video;
    this.video = null;
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.remove();
    if (this.videoCard) {
      this.videoCard.artMat.map = this.videoPoster;
      this.videoCard.artMat.needsUpdate = true;
    }
    this.videoTexture?.dispose();
    this.videoTexture = null;
    this.videoPoster = null;
    this.videoCard = null;
    this.reportVideoState();
    this.reportVideoProgress();
  }

  private collections: RailCollection[];
  private reducedMotion: boolean;
  private theme: 'dark' | 'light';
  private backgroundColor: THREE.Color;
  private active = true;
  private resumeVideoOnActivate = false;
  private disposed = false;
  private entranceScrubbing = false;
  private pendingEntranceProgress: number | null = null;
  private callbacks: SceneCallbacks;
  private entranceMode: 'standard' | 'unfold';
  private entranceStyle: 'stack' | 'single';

  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private environmentTexture: THREE.Texture | null = null;
  private environmentTarget: THREE.WebGLRenderTarget | null = null;
  private rail!: THREE.Group;
  private displayRailParts: THREE.Object3D[] = [];
  private cards: Card[] = [];
  private order: number[] = [];
  private resizeObserver: ResizeObserver | null = null;

  // state
  private state: 'idle' | 'entering' | 'unfold' | 'unfolding' | 'folding' = 'entering';
  private stateT = 0;
  private entranceProgress = 0;
  private entranceTarget = 0;
  private entrancePhase: EntrancePhase = 'loading';
  private entranceFocus = -1;
  private sceneReadyEmitted = false;
  private rowP = 0;
  private rowTarget = 0;
  private layoutSpread = 1;
  private halfW = 1;
  private rowTilt: number = T.ROW_TILT_NARROW;
  private rowTiltPower: number = T.ROW_TILT_POWER_NARROW;
  private dragUnitsPerPixel = 0.002;
  private viewportAspect = 1;
  private captionTop: number | null = null;
  private focusY: number = T.FOCUS_Y;
  private focusScale = 1;
  private selected = -1;
  private hovered = -1;
  private pushAmt = 0;
  private pushVel = 0;
  private pushX = 0;
  private play: Play | null = null;
  private dragging = false;
  private activePointerId: number | null = null;
  private dragMoved = 0;
  private dragVelocity = 0;
  private lastPointerX = 0;
  private lastPointerTime = 0;
  private wheelSnapTimer: number | null = null;
  private parallaxTarget = 0;
  private parallax = 0;
  private firstFrame = true;
  private prev = 0;
  private rafId = 0;
  // Start unset so the initial settled archive state is emitted once. If this
  // starts as `archive`, the first `maybeEmitStage()` call is suppressed and
  // the host cannot observe that the scene has finished initializing.
  private lastEmittedStage: SceneStage | null = null;
  private lastCenterMetadata = -1;
  private entranceDone = false;

  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private temp = new THREE.Vector3();

  // DOM listeners (so we can remove them)
  private boundOnPointerMove: (e: PointerEvent) => void;
  private boundOnPointerLeave: () => void;
  private boundOnPointerDown: (e: PointerEvent) => void;
  private boundOnPointerUp: (e: PointerEvent) => void;
  private boundOnPointerCancel: (e: PointerEvent) => void;
  private boundOnWheel: (e: WheelEvent) => void;
  private boundOnKey: (e: KeyboardEvent) => void;

  constructor(
    frame: HTMLDivElement,
    collections: RailCollection[],
    reducedMotion: boolean,
    callbacks: SceneCallbacks,
    options: SceneOptions = {},
  ) {
    this.frame = frame;
    this.collections = collections;
    this.reducedMotion = reducedMotion;
    this.theme = options.theme ?? 'dark';
    this.backgroundColor = new THREE.Color(this.theme === 'light' ? 0xffffff : 0x000000);
    this.callbacks = callbacks;
    this.entranceMode = options.entranceMode ?? 'standard';
    this.entranceStyle = options.entranceStyle ?? 'stack';
    if (this.entranceMode === 'unfold') {
      this.state = reducedMotion ? 'unfolding' : 'unfold';
      this.entranceTarget = reducedMotion ? 1 : 0;
      this.entranceProgress = reducedMotion ? 1 : 0;
    }

    this.boundOnPointerMove = (e) => this.onPointerMove(e);
    this.boundOnPointerLeave = () => this.onPointerLeave();
    this.boundOnPointerDown = (e) => this.onPointerDown(e);
    this.boundOnPointerUp = (e) => this.onPointerUp(e);
    this.boundOnPointerCancel = (e) => this.onPointerCancel(e);
    this.boundOnWheel = (e) => this.onWheel(e);
    this.boundOnKey = (e) => this.onKey(e);

    // Keep Always on the optical centre even if the published data order is
    // adjusted later. The current seven-item collection resolves to index 3.
    const alwaysIndex = this.collections.findIndex((item) => item.title.trim().toLowerCase() === 'always');
    const defaultIndex = alwaysIndex >= 0
      ? alwaysIndex
      : Math.min(3, Math.max(0, this.collections.length - 1));
    this.rowP = defaultIndex * T.GAP;
    this.rowTarget = this.rowP;
  }

  // ============================================================
  // lifecycle
  // ============================================================

  start() {
    this.initRenderer();
    this.initScene();
    this.initLights();
    this.initFloor();
    this.initCards();
    this.initResize();
    this.initListeners();

    this.prev = performance.now();
    this.rafId = requestAnimationFrame((t) => this.tick(t));
  }

  public setActive(active: boolean) {
    if (this.disposed || this.active === active) return;
    this.active = active;
    if (!active) {
      if (!this.firstFrame) {
        cancelAnimationFrame(this.rafId);
        this.rafId = 0;
      }
      this.resumeVideoOnActivate = !!this.video && !this.video.paused;
      this.video?.pause();
    } else if (this.renderer && this.rafId === 0) {
      this.prev = performance.now();
      this.rafId = requestAnimationFrame((time) => this.tick(time));
      if (this.resumeVideoOnActivate) {
        this.resumeVideoOnActivate = false;
        void this.video?.play().catch(() => this.reportVideoState());
      }
    }
  }

  /** Caption bounds are measured only when its content or viewport changes. */
  public setCaptionTop(top: number) {
    if (this.disposed || !Number.isFinite(top)) return;
    this.captionTop = top;
    if (this.camera) this.updateFocusLayout();
  }

  private updateFocusLayout() {
    const width = Math.max(1, this.frame.clientWidth);
    const height = Math.max(1, this.frame.clientHeight);
    const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(T.FOV / 2));
    const top = Math.min(64, height * 0.09);
    const bottom = Math.max(top + 40, (this.captionTop ?? height - 248) - 24);
    const availableHeight = bottom - top;
    // Reserve the complete moving door envelope, including its nearest point
    // half way through opening. This keeps the leaf and tray above the copy.
    const depth = this.camera.position.z - T.RAIL_Z - T.FOCUS_Z;
    const doorDepth = T.CASE_W * T.OPEN_SCALE_X + T.THICK;
    const envelopeHeight = T.CASE_H * 1.07;
    const envelopeWidth = T.CASE_W * 2.15;
    const heightScale = availableHeight * 2 * tanHalfFov * depth
      / (envelopeHeight * height + availableHeight * 2 * tanHalfFov * doorDepth);
    const availableWidth = width * 0.90;
    const widthScale = availableWidth * 2 * tanHalfFov * this.viewportAspect * depth
      / (envelopeWidth * width + availableWidth * 2 * tanHalfFov * this.viewportAspect * doorDepth);
    this.focusScale = Math.min(1, heightScale, widthScale) * (this.theme === 'light' ? 0.84 : 1);
    const nearDepth = depth - this.focusScale * doorDepth;
    const centerNdc = 1 - (top + bottom) / height;
    this.focusY = this.camera.position.y + centerNdc * nearDepth * tanHalfFov - RAIL_Y;
    if (this.theme === 'light') {
      // Align the actual door envelope to the copy, rather than centring the
      // conservatively fitted object in a taller reserved rectangle. The
      // latter left a large empty band beneath the white opened frame.
      const captionTop = this.captionTop ?? height - 248;
      const targetBottom = captionTop - clamp(height * 0.047, 32, 46);
      const targetNdcY = 1 - 2 * targetBottom / height;
      const point = new THREE.Vector3();
      const rotation = new THREE.Euler();
      let alignedY = -Infinity;
      const include = (x: number, y: number, z: number) => {
        const vertexDepth = depth - z * this.focusScale;
        alignedY = Math.max(alignedY,
          this.camera.position.y + targetNdcY * vertexDepth * tanHalfFov
            - RAIL_Y - y * this.focusScale);
      };
      // Static carrier, then the same hinged pane transform used in tick().
      for (const x of [-T.CASE_W / 2, T.CASE_W / 2]) {
        for (const y of [-T.CASE_H / 2, T.CASE_H / 2]) {
          for (const z of [-T.THICK / 2, T.THICK / 2]) include(x, y, z);
        }
      }
      for (let step = 0; step <= 16; step++) {
        const open = step / 16;
        rotation.set(T.OPEN_PITCH * open, T.OPEN_ANGLE * open, 0);
        for (const x of [0, T.CASE_W]) {
          for (const y of [-T.CASE_H / 2, T.CASE_H / 2]) {
            for (const z of [-T.LID_THICK / 2, T.LID_THICK / 2]) {
              point.set(x * lerp(1, T.OPEN_SCALE_X, open),
                y * lerp(1, T.OPEN_SCALE_Y, open), z).applyEuler(rotation);
              include(point.x - T.CASE_W / 2 + T.OPEN_HINGE_X * open,
                point.y + T.OPEN_HINGE_Y * open, point.z + LID_Z);
            }
          }
        }
      }
      this.focusY = alignedY;
    }
  }

  public setEntranceProgress(progress: number) {
    if (this.disposed || this.entranceMode !== 'unfold' || !Number.isFinite(progress)) return;
    const value = clamp(progress, 0, 1);
    // A scroll reversal can begin while a case is open. Finish its existing
    // close timeline, then apply the latest requested scroll position.
    if (this.play) {
      if (value < 1 || this.pendingEntranceProgress !== null) {
        this.pendingEntranceProgress = value;
        this.closeSelected();
      }
      return;
    }
    if (value === 1 && this.entranceDone) return;
    this.entranceScrubbing = true;
    this.entranceProgress = value;
    this.entranceTarget = value;
    this.state = 'unfold';
    this.hovered = -1;
    this.dragging = false;
    if (this.activePointerId !== null && this.frame.hasPointerCapture?.(this.activePointerId)) {
      this.frame.releasePointerCapture(this.activePointerId);
    }
    this.activePointerId = null;
    this.rowTarget = this.rowP;
    this.parallaxTarget = 0;
    if (value < 1) {
      this.entranceDone = false;
      this.emitEntrancePhase(value <= 0 ? 'closed' : 'inspecting', -1);
    }
  }

  private emitEntrancePhase(phase: EntrancePhase, index = this.entranceFocus) {
    if (phase === this.entrancePhase && index === this.entranceFocus) return;
    this.entrancePhase = phase;
    this.entranceFocus = index;
    this.frame.dataset.entrancePhase = phase;
    this.callbacks.onEntrancePhaseChange?.(phase, index);
  }

  private beginUnfold(skip = false) {
    if (
      this.entranceMode !== 'unfold'
      || (this.state !== 'unfold' && this.state !== 'unfolding')
    ) return;
    this.entranceScrubbing = false;
    this.state = 'unfolding';
    this.entranceTarget = 1;
    if (skip || this.reducedMotion) this.entranceProgress = 1;
    this.emitEntrancePhase('unfolding', this.entranceFocus);
    this.frame.style.cursor = 'default';
  }

  public startEntrance(skip = false) {
    if (this.entranceMode !== 'unfold' || this.state !== 'unfold') return false;
    this.beginUnfold(skip);
    return true;
  }

  public setEntranceCollection(index: number) {
    if (this.entranceMode !== 'unfold' || this.state !== 'unfold') return false;
    const orderIndex = this.order.indexOf(index);
    if (orderIndex < 0) return false;
    this.rowP = orderIndex * T.GAP;
    this.rowTarget = this.rowP;
    this.entranceFocus = index;
    return true;
  }

  public getEntranceArtworkAnchor(index?: number) {
    if (this.entranceMode !== 'unfold' || this.cards.length === 0 || !this.renderer) return null;
    const card = this.cards[index ?? this.centerIndex()];
    if (!card) return null;

    this.scene.updateMatrixWorld(true);
    this.camera.updateMatrixWorld(true);
    const artWidth = T.CASE_W * ART_WIDTH_FACTOR;
    const artHeight = T.CASE_H * ART_HEIGHT_FACTOR;
    const artZ = T.TRAY_THICK / 2 + 0.0024;
    const corners = [
      new THREE.Vector3(-artWidth / 2, artHeight / 2, artZ),
      new THREE.Vector3(artWidth / 2, artHeight / 2, artZ),
      new THREE.Vector3(-artWidth / 2, -artHeight / 2, artZ),
      new THREE.Vector3(artWidth / 2, -artHeight / 2, artZ),
    ].map((point) => point.applyMatrix4(card.sheet.matrixWorld).project(this.camera));
    if (corners.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return null;

    const canvasRect = this.renderer.domElement.getBoundingClientRect();
    const frameRect = this.frame.getBoundingClientRect();
    const xs = corners.map((point) => canvasRect.left - frameRect.left + (point.x + 1) * 0.5 * canvasRect.width);
    const ys = corners.map((point) => canvasRect.top - frameRect.top + (1 - point.y) * 0.5 * canvasRect.height);
    const left = Math.min(...xs);
    const right = Math.max(...xs);
    const top = Math.min(...ys);
    const bottom = Math.max(...ys);
    return {
      centerX: (left + right) / 2,
      centerY: (top + bottom) / 2,
      width: right - left,
      height: bottom - top,
    };
  }

  private completeEntrance() {
    if (this.entranceDone) return;
    this.entranceDone = true;
    this.entranceProgress = 1;
    this.entranceTarget = 1;
    this.state = 'idle';
    this.setRailReveal(1);
    this.emitEntrancePhase('complete', this.centerIndex());
    this.lastCenterMetadata = this.centerIndex();
    this.callbacks.onStageChange?.('archive', this.lastCenterMetadata);
    this.callbacks.onEntranceComplete?.();
    this.frame.style.cursor = 'grab';
  }

  public resetEntrance() {
    if (
      this.entranceMode !== 'unfold'
      || this.state !== 'idle'
      || this.play
    ) return false;

    this.dragging = false;
    this.activePointerId = null;
    this.dragMoved = 0;
    this.dragVelocity = 0;
    this.selected = -1;
    this.hovered = -1;
    this.entranceFocus = -1;
    this.entranceDone = false;
    this.entranceTarget = 0;
    this.parallaxTarget = 0;
    this.rowTarget = this.rowP;
    this.entranceScrubbing = false;
    this.state = 'folding';
    this.emitEntrancePhase('folding', -1);
    this.frame.style.cursor = 'default';
    return true;
  }

  private setRailReveal(progress: number) {
    if (this.theme === 'light') return;
    if (this.entranceMode !== 'unfold') return;
    const reveal = this.entranceStyle === 'single'
      ? smooth(0.60, 0.97, progress)
      : smooth(ENTRANCE.RAIL_REVEAL_START, 0.94, progress);
    for (const part of this.displayRailParts) {
      part.visible = reveal > 0.001;
      part.scale.y = Math.max(0.001, reveal);
    }
  }

  dispose() {
    this.disposed = true;
    this.active = false;
    this.stopVideo();
    cancelAnimationFrame(this.rafId);

    this.frame.removeEventListener('pointermove', this.boundOnPointerMove);
    this.frame.removeEventListener('pointerleave', this.boundOnPointerLeave);
    this.frame.removeEventListener('pointerdown', this.boundOnPointerDown);
    this.frame.removeEventListener('pointerup', this.boundOnPointerUp);
    this.frame.removeEventListener('pointercancel', this.boundOnPointerCancel);
    this.frame.removeEventListener('lostpointercapture', this.boundOnPointerCancel);
    this.frame.removeEventListener('wheel', this.boundOnWheel);
    this.frame.removeEventListener('keydown', this.boundOnKey);

    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    if (this.wheelSnapTimer !== null) {
      window.clearTimeout(this.wheelSnapTimer);
      this.wheelSnapTimer = null;
    }

    // Stop pending image decodes before disposing their canvas textures.
    for (const c of this.cards) {
      if (c.artworkImage) {
        c.artworkImage.onload = null;
        c.artworkImage.onerror = null;
        c.artworkImage.removeAttribute('src');
      }
    }

    // Dispose each shared geometry, material and texture once. In particular,
    // the artwork texture is both map and emissiveMap, and the rim material is
    // shared by four meshes, so per-mesh disposal would double-dispose them.
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments) {
        geometries.add(obj.geometry);
        const objectMaterials = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const material of objectMaterials) {
          materials.add(material);
          const properties = Object.values(material);
          for (const value of properties) {
            if (value instanceof THREE.Texture) textures.add(value);
          }
        }
      }
    });
    textures.forEach((texture) => texture.dispose());
    materials.forEach((material) => material.dispose());
    geometries.forEach((geometry) => geometry.dispose());

    this.scene.environment = null;
    this.environmentTarget?.dispose();
    this.environmentTarget = null;
    this.environmentTexture = null;
    this.scene.clear();
    this.displayRailParts = [];
    this.cards = [];
    this.order = [];

    if (this.renderer) {
      this.renderer.renderLists.dispose();
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      if (this.renderer.domElement.parentNode) {
        this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
      }
    }
  }

  // ============================================================
  // init
  // ============================================================

  private initRenderer() {
    // The orbit is composited in CSS; do not retain a second GPU copy of every frame.
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    // Acrylic is softly refractive; a half-resolution transmission buffer
    // preserves the visual softness while cutting its full-screen fill cost.
    this.renderer.transmissionResolutionScale = 0.5;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.96;
    this.renderer.setClearColor(this.backgroundColor, 1);
    this.renderer.shadowMap.enabled = false;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.frame.appendChild(this.renderer.domElement);
  }

  private initScene() {
    this.scene = new THREE.Scene();
    // MeshPhysicalMaterial can only refract WebGL content, not the CSS behind
    // an alpha canvas. A matching in-scene paper field gives every acrylic
    // layer a stable warm surface to transmit while preserving the approved
    // radial falloff and restrained fixed grain.
    this.scene.background = this.backgroundColor.clone();
    this.scene.fog = new THREE.Fog(
      this.backgroundColor,
      FOG.near,
      FOG.far,
    );
    this.camera = new THREE.PerspectiveCamera(T.FOV, 1, 0.1, 80);
    this.camera.position.set(0, T.CAMERA_Y, T.CAMERA_Z);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const roomEnvironment = new RoomEnvironment();
    this.environmentTarget = pmrem.fromScene(roomEnvironment, 0.04);
    this.environmentTexture = this.environmentTarget.texture;
    this.scene.environment = this.environmentTexture;
    roomEnvironment.dispose();
    pmrem.dispose();

    const paperBackdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(15.4, 8.8),
      new THREE.ShaderMaterial({
        uniforms: {
          centreColour: { value: this.backgroundColor.clone() },
          middleColour: { value: this.backgroundColor.clone() },
          edgeColour: { value: this.backgroundColor.clone() },
          leftPaper: { value: this.backgroundColor.clone() },
          rightPaper: { value: this.backgroundColor.clone() },
          grainStrength: { value: 0 },
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          varying vec2 vUv;
          uniform vec3 centreColour;
          uniform vec3 middleColour;
          uniform vec3 edgeColour;
          uniform vec3 leftPaper;
          uniform vec3 rightPaper;
          uniform float grainStrength;
          float paperNoise(vec2 p) {
            return fract(sin(dot(floor(p * 1200.0), vec2(12.9898, 78.233))) * 43758.5453);
          }
          void main() {
            vec2 p = vUv - vec2(0.5, 0.57);
            float distanceFromLight = length(vec2(p.x / 0.64, p.y / 0.58));
            vec3 colour = mix(centreColour, middleColour, smoothstep(0.08, 0.56, distanceFromLight));
            colour = mix(colour, edgeColour, smoothstep(0.55, 1.02, distanceFromLight));
            float leftWeight = smoothstep(0.10, 0.42, -p.x) * 0.80;
            float rightWeight = smoothstep(0.10, 0.42, p.x) * 1.00;
            colour = mix(colour, leftPaper, leftWeight);
            colour = mix(colour, rightPaper, rightWeight);
            float grain = (paperNoise(vUv) - 0.5) * grainStrength;
            gl_FragColor = vec4(colour + grain, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }
        `,
        depthWrite: false,
        depthTest: false,
        toneMapped: false,
      }),
    );
    paperBackdrop.position.set(0, 0.1, -6);
    paperBackdrop.renderOrder = -20;
    paperBackdrop.frustumCulled = false;
    paperBackdrop.raycast = () => {};
    this.scene.add(paperBackdrop);

    this.rail = new THREE.Group();
    this.rail.position.set(T.RAIL_X, RAIL_Y, T.RAIL_Z);
    this.scene.add(this.rail);
  }

  private initLights() {
    // A restrained three-card studio rig: the broad warm key reads the front
    // planes, a cool camera-side fill keeps hardware alive, and a rear kicker
    // loads colour into the polished cut edges. Shadows remain texture-based,
    // avoiding a costly full-rail shadow map and transparent-slab artifacts.
    const whiteStage = this.theme === 'light';
    this.scene.add(new THREE.HemisphereLight(0xffffff, whiteStage ? 0xa7a7a3 : 0x786f68, whiteStage ? 0.18 : 0.12));

    const key = new THREE.DirectionalLight(whiteStage ? 0xfffefa : 0xfff0dc, whiteStage ? 1.48 : 1.56);
    key.position.set(-5.2, 7.8, 5.6);
    key.target.position.set(-0.45, -0.12, T.RAIL_Z);
    key.castShadow = false;
    this.scene.add(key, key.target);

    const fill = new THREE.DirectionalLight(whiteStage ? 0xe7ecec : 0xd6e2e6, whiteStage ? 0.31 : 0.25);
    fill.position.set(4.8, 2.9, 4.6);
    fill.target.position.set(0.80, 0.05, T.RAIL_Z + 0.10);
    this.scene.add(fill, fill.target);

    const kicker = new THREE.DirectionalLight(whiteStage ? 0xf1f5f5 : 0xe9f3f5, whiteStage ? 1.52 : 1.42);
    kicker.position.set(3.8, 4.5, -5.6);
    kicker.target.position.set(0, 0.18, T.RAIL_Z);
    this.scene.add(kicker, kicker.target);

    // The broad softbox reflection is authored in the door highlight shader.
    // Keeping the scene to three real lights avoids an extra physical-light
    // shader variant and preserves fast cold starts on 1440/mobile GPUs.
  }

  private initFloor() {
    // The white presentation has no glass plinth beneath the works.
    if (this.theme === 'light') return;
    const whiteStage = false;
    const railMaterial = new THREE.MeshPhysicalMaterial({
      color: whiteStage ? 0xfefdfb : 0xfbf8f3,
      metalness: 0,
      roughness: 0.014,
      // Physical transmission uses the in-scene paper field as the backdrop;
      // alpha stays opaque so the plinth does not disappear in sort overlap.
      transmission: 0.97,
      thickness: 0.052,
      ior: 1.49,
      transparent: false,
      opacity: 1,
      clearcoat: 1,
      clearcoatRoughness: 0.022,
      envMapIntensity: 1.54,
      specularIntensity: 1,
      attenuationColor: new THREE.Color(whiteStage ? 0xfafaf8 : 0xf7f0e9),
      attenuationDistance: 3.4,
      side: THREE.FrontSide,
      depthWrite: true
    });
    const displayRailGeometry = new RoundedBoxGeometry(T.DISPLAY_RAIL_W, 0.018, 0.17, 4, 0.004);
    const displayRail = new THREE.Mesh(
      displayRailGeometry,
      railMaterial
    );
    displayRail.position.set(T.DISPLAY_RAIL_X, FLOOR_Y + T.DISPLAY_RAIL_Y_OFFSET, -0.245);
    displayRail.receiveShadow = true;
    displayRail.renderOrder = 0;
    this.scene.add(displayRail);

    // Outline the complete depth of the slab so its upper edge and tapered
    // ends remain visible while the low-opacity body stays light.
    const railOutline = new THREE.LineSegments(
      new THREE.EdgesGeometry(displayRailGeometry, 28),
      new THREE.LineBasicMaterial({
        color: whiteStage ? 0xaaa9a5 : 0xa8a19b,
        transparent: true,
        opacity: 0.070,
        depthWrite: false
      })
    );
    railOutline.position.copy(displayRail.position);
    railOutline.renderOrder = 0;
    this.scene.add(railOutline);

    const railTop = new THREE.Mesh(
      new RoundedBoxGeometry(T.DISPLAY_RAIL_W * 0.992, 0.0055, 0.15, 3, 0.0025),
      new THREE.MeshBasicMaterial({
        color: whiteStage ? 0xffffff : 0xfffcf7,
        transparent: true,
        opacity: 0.148,
        depthWrite: false
      })
    );
    railTop.position.set(T.DISPLAY_RAIL_X, FLOOR_Y + 0.011, -0.14);
    railTop.renderOrder = 0;
    this.scene.add(railTop);

    const railEdge = new THREE.Mesh(
      new RoundedBoxGeometry(T.DISPLAY_RAIL_EDGE_W, 0.009, 0.038, 3, 0.0045),
      new THREE.MeshPhysicalMaterial({
        color: whiteStage ? 0xdadad7 : 0xd8d3ce,
        roughness: 0.040,
        transmission: 0.94,
        thickness: 0.010,
        ior: 1.49,
        transparent: false,
        opacity: 1,
        clearcoat: 1,
        clearcoatRoughness: 0.04,
        envMapIntensity: 1.08,
        depthWrite: true
      })
    );
    railEdge.position.set(T.DISPLAY_RAIL_X, FLOOR_Y + T.DISPLAY_RAIL_EDGE_Y_OFFSET, -0.220);
    railEdge.renderOrder = 0;
    this.scene.add(railEdge);

    this.displayRailParts = [displayRail, railOutline, railTop, railEdge];
    if (this.entranceMode === 'unfold') this.setRailReveal(0);

  }

  private initCards() {
    this.cards = this.collections.map((a, i) => createCard(a, i, this.rail, this.renderer, this.theme === 'light'));
    this.order = [...this.cards.keys()];
  }

  private initResize() {
    const onResize = () => {
      const w = Math.max(1, this.frame.clientWidth);
      const h = Math.max(1, this.frame.clientHeight);
      this.renderer.setSize(w, h, false);
      const aspect = w / h;
      this.viewportAspect = aspect;
      const wide = smooth(1.05, 1.45, aspect);
      const mobile = 1 - smooth(0.62, 0.82, aspect);

      // Portrait reference panels intentionally keep the original 44% case
      // height. Wide desktop screens move the camera closer so the objects
      // occupy the approved 53-56% of the viewport without stretching their
      // physical geometry.
      this.camera.position.z = lerp(T.CAMERA_Z, T.CAMERA_Z_WIDE, wide);
      this.camera.position.y = lerp(T.CAMERA_Y, T.CAMERA_Y_WIDE, wide);
      this.camera.aspect = aspect;
      this.camera.updateProjectionMatrix();

      const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(T.FOV / 2));
      const cardDepth = this.camera.position.z - T.RAIL_Z;
      this.halfW = cardDepth * tanHalfFov * aspect;

      // Horizontal spacing is derived from camera-visible width, rather than
      // the old 836px wrapper. The outer centres land at 8.4/91.6% on wide
      // screens; mobile intentionally lets the outer pair live off-canvas.
      const outerNdc = mobile > 0.5
        ? 1.44
        : lerp(0.888, 0.833, wide);
      this.layoutSpread = (this.halfW * outerNdc) / (T.GAP * 3);

      this.rowTilt = mobile > 0.5
        ? T.ROW_TILT_MOBILE
        : lerp(T.ROW_TILT_NARROW, T.ROW_TILT_WIDE, wide);
      this.rowTiltPower = lerp(T.ROW_TILT_POWER_NARROW, T.ROW_TILT_POWER_WIDE, wide);

      const pitchFraction = mobile > 0.5 ? 0.24 : lerp(0.148, 0.139, wide);
      this.dragUnitsPerPixel = T.GAP / Math.max(44, w * pitchFraction);

      // The plinth is sized independently from the card slots so its ends
      // stay within roughly half a percent of the viewport at every aspect.
      const railDepth = this.camera.position.z - (-0.22);
      const railVisibleHalfW = railDepth * tanHalfFov * aspect;
      const railCoverage = mobile > 0.5 ? 1.08 : 0.992;
      const railScale = (railVisibleHalfW * 2 * railCoverage) / T.DISPLAY_RAIL_EDGE_W;
      const railNdcY = -1 + 36 / h;
      const railOffsets = [T.DISPLAY_RAIL_Y_OFFSET, T.DISPLAY_RAIL_Y_OFFSET, 0.011, T.DISPLAY_RAIL_EDGE_Y_OFFSET];
      for (let index = 0; index < this.displayRailParts.length; index++) {
        const part = this.displayRailParts[index];
        part.scale.x = railScale;
        part.position.y = this.camera.position.y
          + railNdcY * (this.camera.position.z - part.position.z) * tanHalfFov
          + railOffsets[index];
      }
      this.updateFocusLayout();
    };
    this.resizeObserver = new ResizeObserver(onResize);
    this.resizeObserver.observe(this.frame);
    onResize();
  }

  private initListeners() {
    this.frame.addEventListener('pointermove', this.boundOnPointerMove);
    this.frame.addEventListener('pointerleave', this.boundOnPointerLeave);
    this.frame.addEventListener('pointerdown', this.boundOnPointerDown);
    this.frame.addEventListener('pointerup', this.boundOnPointerUp);
    this.frame.addEventListener('pointercancel', this.boundOnPointerCancel);
    this.frame.addEventListener('lostpointercapture', this.boundOnPointerCancel);
    this.frame.addEventListener('wheel', this.boundOnWheel, { passive: false });
    this.frame.addEventListener('keydown', this.boundOnKey);
  }

  // ============================================================
  // interaction handlers
  // ============================================================

  private updatePointer(e: PointerEvent) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  private pickTarget(e: PointerEvent): PickTarget {
    this.updatePointer(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);

    // The mounted print becomes an intentional, higher-priority target only
    // after the opening timeline has completely settled.
    if (this.play && this.selected >= 0 && this.play.t >= 1.40) {
      const artworkHits = this.raycaster.intersectObject(this.cards[this.selected].artHit, false);
      if (artworkHits.length) return { index: this.selected, region: 'artwork' };
    }

    const hits = this.raycaster.intersectObjects(
      this.cards.flatMap((c) => [c.hit, c.doorHit]),
      false,
    );
    return hits.length
      ? { index: hits[0].object.userData.idx, region: 'case' }
      : { index: -1, region: 'case' };
  }

  private pick(e: PointerEvent): number {
    return this.pickTarget(e).index;
  }

  private onPointerMove(e: PointerEvent) {
    if (!this.active || this.entranceScrubbing && this.state !== 'idle') return;
    this.updatePointer(e);
    const entranceActive = this.entranceMode === 'unfold' && this.state !== 'idle';
    this.parallaxTarget = clamp(this.pointer.x, -1, 1) * T.PARALLAX * (entranceActive ? 1.45 : 1);

    if (entranceActive) {
      if (this.state !== 'unfold') return;
      if (this.dragging && e.pointerId === this.activePointerId) {
        const dx = e.clientX - this.lastPointerX;
        const now = performance.now();
        this.dragMoved += Math.abs(dx);
        this.entranceTarget = clamp(
          this.entranceTarget + Math.abs(dx) / Math.max(260, this.frame.clientWidth * 0.56),
          0,
          1,
        );
        this.lastPointerX = e.clientX;
        this.lastPointerTime = now;
        this.emitEntrancePhase('inspecting', this.entranceFocus);
        if (this.entranceTarget >= ENTRANCE.TRIGGER_PROGRESS) this.beginUnfold();
      } else {
        const nextFocus = this.pick(e);
        this.hovered = nextFocus;
        this.emitEntrancePhase(nextFocus >= 0 ? 'inspecting' : 'closed', nextFocus);
        this.frame.style.cursor = nextFocus >= 0 ? 'pointer' : 'grab';
      }
      return;
    }

    if (this.dragging && e.pointerId === this.activePointerId) {
      const dx = e.clientX - this.lastPointerX;
      const now = performance.now();
      const elapsed = Math.max(8, now - this.lastPointerTime) / 1000;
      this.dragMoved += Math.abs(dx);
      // An open/focusing case owns the composition. Track movement so a drag
      // is not mistaken for a click, but never mutate the hidden rail offset.
      if (!this.play) {
        const worldDelta = -dx * this.dragUnitsPerPixel;
        this.rowTarget += worldDelta;
        this.dragVelocity = lerp(this.dragVelocity, worldDelta / elapsed, 0.34);
      }
      this.lastPointerX = e.clientX;
      this.lastPointerTime = now;
    } else if (this.state === 'idle' && !this.play) {
      this.hovered = this.pick(e);
      this.frame.style.cursor = this.hovered >= 0 ? 'pointer' : 'grab';
    }
  }

  private onPointerLeave() {
    this.hovered = -1;
    this.parallaxTarget = 0;
    if (this.entranceMode === 'unfold' && this.state === 'unfold') {
      this.emitEntrancePhase(this.entranceProgress > 0.001 ? 'inspecting' : 'closed', -1);
    }
  }

  private onPointerDown(e: PointerEvent) {
    if (!this.active || this.entranceScrubbing && this.state !== 'idle') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const entranceInteractive = this.entranceMode === 'unfold' && this.state === 'unfold';
    if (this.activePointerId !== null || (!entranceInteractive && this.state !== 'idle' && !this.play)) return;
    if (this.wheelSnapTimer !== null) {
      window.clearTimeout(this.wheelSnapTimer);
      this.wheelSnapTimer = null;
    }
    this.dragging = true;
    this.frame.dataset.focusSource = 'pointer';
    this.activePointerId = e.pointerId;
    this.dragMoved = 0;
    this.dragVelocity = 0;
    this.lastPointerX = e.clientX;
    this.lastPointerTime = performance.now();
    this.frame.setPointerCapture?.(e.pointerId);
    this.frame.style.cursor = 'grabbing';
    if (entranceInteractive) this.emitEntrancePhase('inspecting', this.entranceFocus);
  }

  private onPointerUp(e: PointerEvent) {
    if (!this.dragging || e.pointerId !== this.activePointerId) return;
    const wasDrag = this.dragging && this.dragMoved >= 6;
    const entranceActive = this.entranceMode === 'unfold' && this.state !== 'idle';
    if (entranceActive) {
      if (!wasDrag) this.beginUnfold();
      else if (this.entranceTarget >= ENTRANCE.TRIGGER_PROGRESS * 0.72) this.beginUnfold();
      this.dragging = false;
      this.activePointerId = null;
      if (this.frame.hasPointerCapture?.(e.pointerId)) this.frame.releasePointerCapture(e.pointerId);
      this.frame.style.cursor = this.state === 'unfold' ? 'grab' : 'default';
      return;
    }
    if (this.dragging && !wasDrag && this.state === 'idle') {
      const picked = this.pickTarget(e);
      if (picked.region === 'artwork' && picked.index === this.selected) {
        this.closeSelected();
      } else {
        this.handleClick(picked.index);
      }
    }
    this.dragging = false;
    this.activePointerId = null;
    if (this.frame.hasPointerCapture?.(e.pointerId)) this.frame.releasePointerCapture(e.pointerId);
    this.frame.style.cursor = this.hovered >= 0 ? 'pointer' : 'grab';
    if (wasDrag && !this.play) {
      const releaseAge = performance.now() - this.lastPointerTime;
      const velocityRetention = clamp(1 - releaseAge / 140, 0, 1);
      this.rowTarget += clamp(this.dragVelocity * velocityRetention * 0.12, -T.GAP * 2.8, T.GAP * 2.8);
      this.snapRowTarget();
    }
  }

  private onPointerCancel(e: PointerEvent) {
    if (e.pointerId !== this.activePointerId) return;
    this.dragging = false;
    this.activePointerId = null;
    this.dragMoved = 0;
    this.dragVelocity = 0;
    if (!this.play && this.state === 'idle') this.snapRowTarget();
    if (this.frame.hasPointerCapture?.(e.pointerId)) this.frame.releasePointerCapture(e.pointerId);
    this.frame.style.cursor = 'grab';
  }

  private onWheel(e: WheelEvent) {
    if (!this.active || (this.entranceScrubbing && this.state !== 'idle')) return;
    e.preventDefault();
    if (this.entranceMode === 'unfold' && this.state === 'unfold') {
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      this.entranceTarget = clamp(this.entranceTarget + Math.abs(delta) * 0.0022, 0, 1);
      this.emitEntrancePhase('inspecting', this.entranceFocus);
      if (this.entranceTarget >= ENTRANCE.TRIGGER_PROGRESS) this.beginUnfold();
      return;
    }
    if (this.state !== 'idle' || this.play) return;
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    this.rowTarget += delta * this.dragUnitsPerPixel * 0.92;
    if (this.wheelSnapTimer !== null) window.clearTimeout(this.wheelSnapTimer);
    this.wheelSnapTimer = window.setTimeout(() => {
      this.wheelSnapTimer = null;
      if (this.state === 'idle' && !this.dragging && !this.play) this.snapRowTarget();
    }, 150);
  }

  private onKey(e: KeyboardEvent) {
    if (!this.active || (this.entranceScrubbing && this.state !== 'idle')) return;
    delete this.frame.dataset.focusSource;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (this.entranceMode === 'unfold' && this.state !== 'idle') {
      if (this.state === 'folding') {
        if (
          ['ArrowLeft', 'ArrowRight', 'Enter', ' ', 'Spacebar', 'Escape', 'Esc'].includes(e.key)
          || e.code === 'Space'
        ) e.preventDefault();
        return;
      }
      if (['ArrowLeft', 'ArrowRight', 'Enter', ' ', 'Spacebar'].includes(e.key) || e.code === 'Space') {
        if (!e.repeat) this.beginUnfold();
        e.preventDefault();
      }
      if (e.key === 'Escape' || e.key === 'Esc') {
        this.beginUnfold(true);
        e.preventDefault();
      }
      return;
    }
    if (this.state !== 'idle' && !this.play) return;
    if (e.key === 'ArrowLeft' && !this.play) {
      this.rowTarget = Math.round(this.rowTarget / T.GAP) * T.GAP - T.GAP;
      e.preventDefault();
    }
    if (e.key === 'ArrowRight' && !this.play) {
      this.rowTarget = Math.round(this.rowTarget / T.GAP) * T.GAP + T.GAP;
      e.preventDefault();
    }
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar' || e.code === 'Space') {
      if (e.repeat) return;
      this.handleClick(this.selected >= 0 ? this.selected : this.centerIndex());
      e.preventDefault();
    }
    if (e.key === 'Escape' || e.key === 'Esc') {
      // Single reverse of the full timeline. The per-frame naturalMax
      // handles the focus / open ceiling switch on its own.
      if (this.play && this.play.dir > 0) {
        this.closeSelected();
      }
      // already reversing or no play: ignore
      e.preventDefault();
    }
  }

  private centerIndex(): number {
    let best = 0;
    let distance = Infinity;
    for (let k = 0; k < this.collections.length; k++) {
      const d = Math.abs(this.rowX(k, this.rowP));
      if (d < distance) { distance = d; best = this.order[k]; }
    }
    return best;
  }

  private snapRowTarget() {
    // Preserve continuous input while the pointer/trackpad is moving, then
    // settle the nearest spine exactly onto the 836 px optical centre.
    this.rowTarget = Math.round(this.rowTarget / T.GAP) * T.GAP;
  }

  // ============================================================
  // row formulas — verbatim from template
  // ============================================================

  private wrappedRowX(k: number, offset: number): number {
    const total = this.collections.length * T.GAP;
    let x = (k * T.GAP - offset) % total;
    if (x > total / 2) x -= total;
    else if (x < -total / 2) x += total;
    return x;
  }

  private rowX(k: number, offset: number): number {
    const x = this.wrappedRowX(k, offset);
    // Slightly compress the two inner intervals while preserving the outer
    // anchors. This matches the measured 836 px rail without crowding the
    // centre hinge or changing the circular browsing topology.
    const normalized = clamp(Math.abs(x) / (T.GAP * 3), 0, 1);
    const factor = 1 - T.ROW_INNER_COMPRESSION * (1 - normalized * normalized);
    const base = x * factor * this.layoutSpread;
    const slot = clamp(Math.abs(x / T.GAP), 0, 3);
    const lowerSlot = Math.min(2, Math.floor(slot));
    const wide = smooth(1.05, 1.45, this.viewportAspect);
    const offsets = x < 0 ? WIDE_POSITION_LEFT : WIDE_POSITION_RIGHT;
    const correction = lerp(offsets[lowerSlot], offsets[lowerSlot + 1], slot - lowerSlot);
    return base + correction * T.GAP * this.layoutSpread * wide;
  }

  private rowRotY(x: number): number {
    const normalized = clamp(x / (T.GAP * 3), -1, 1);
    // Closed cases read as a measured row of spines. The outer cases expose
    // progressively more of their broad face, matching the perspective fan
    // in the approved concept while the centre case stays exactly edge-on.
    const direction = Math.sign(normalized);
    const wide = smooth(1.05, 1.45, this.viewportAspect);
    const slotDistance = clamp(Math.abs(x / T.GAP), 0, 3);
    const samples = direction < 0 ? WIDE_TILT_LEFT : WIDE_TILT_RIGHT;
    const lowerSlot = Math.min(2, Math.floor(clamp(slotDistance, 0, 3)));
    const upperSlot = Math.min(3, lowerSlot + 1);
    const wideAmount = lerp(samples[lowerSlot], samples[upperSlot], slotDistance - lowerSlot);
    const amount = Math.pow(Math.abs(normalized), this.rowTiltPower);
    const genericAmount = amount * this.rowTilt;
    return -Math.PI / 2 + direction * lerp(genericAmount, wideAmount, wide);
  }

  private openRowX(logicalX: number): number {
    const distance = Math.abs(logicalX / T.GAP);
    const slot = clamp(Math.round(distance), 1, 3);
    const wide = smooth(1.05, 1.45, this.viewportAspect);
    const mobile = 1 - smooth(0.62, 0.82, this.viewportAspect);
    const index = slot - 1;
    const isLeft = logicalX < 0;
    const narrowValue = isLeft ? OPEN_SLOTS.leftNarrow[index] : OPEN_SLOTS.rightNarrow[index];
    const wideValue = isLeft ? OPEN_SLOTS.leftWide[index] : OPEN_SLOTS.rightWide[index];
    const mobileValue = isLeft ? OPEN_SLOTS.leftMobile[index] : OPEN_SLOTS.rightMobile[index];
    const slots = mobile > 0.5 ? mobileValue : lerp(narrowValue, wideValue, wide);
    // Additional works retain their spacing outside the calibrated seven
    // slots rather than piling onto the third neighbour during opening.
    const extraSlots = Math.max(0, distance - 3);
    // The focused frame is scaled to reserve its moving door envelope. Keep
    // the white neighbours close, with a small extra allowance on the hinge side.
    const doorClearance = this.theme === 'light' ? (isLeft ? 0.06 : -0.12) : 0;
    return Math.sign(logicalX) * (slots + extraSlots + doorClearance) * T.GAP * this.layoutSpread;
  }

  private setOpacity(c: Card, value: number) {
    const v = clamp(value, 0, 1);
    if (Math.abs(c.opacity - v) < 0.0001) return;
    c.opacity = v;
    // Preserve opaque, depth-writing physical layers while background cards
    // recede through colour and reflected-light contrast rather than alpha.
    const fade = 1 - v;
    c.shellMat.opacity = SHELL_ALPHA * lerp(0.78, 1, v);
    c.shellMat.color.copy(c.edgeColor).lerp(OPTICAL_CLEAR, 0.91).lerp(this.backgroundColor, fade * 0.32);
    c.shellMat.envMapIntensity = lerp(0.72, 1.20, v);
    c.lidMat.opacity = this.theme === 'light' ? 0.095 : LID_ALPHA;
    // Mutate the existing color in place; this runs every animation frame
    // while cards are dimmed, so avoid allocating a new THREE.Color here.
    c.lidMat.color.copy(c.lidColor).lerp(this.backgroundColor, fade * 0.56);
    c.lidMat.envMapIntensity = this.theme === 'light' ? 0 : lerp(0.68, 1.48, v);
    c.lidHighlightMat.uniforms.baseAlpha.value = (this.theme === 'light' ? 0.10 : 0.0052) * lerp(0.72, 1, v);
    c.lidHighlightMat.uniforms.edgeAlpha.value = (this.theme === 'light' ? 0.12 : 0.084) * lerp(0.72, 1, v);
    c.backingMat.opacity = 1;
    c.backingMat.color.copy(c.baseBackingColor).lerp(this.backgroundColor, fade * 0.42);
    c.artMat.opacity = 1;
    c.artMat.color.setScalar(0.30 + 0.70 * v);
    c.spineMat.opacity = lerp(0.72, 1, v);
    c.spineMat.color.setScalar(0.34 + 0.66 * v);
    c.edgeMat.opacity = 0.075 * v;
    for (const material of c.accentMats) {
      const baseOpacity = typeof material.userData.baseOpacity === 'number'
        ? material.userData.baseOpacity
        : 1;
      const baseEnvMapIntensity = typeof material.userData.baseEnvMapIntensity === 'number'
        ? material.userData.baseEnvMapIntensity
        : 1;
      material.opacity = material.transparent
        ? baseOpacity * lerp(0.84, 1, v)
        : 1;
      material.envMapIntensity = lerp(baseEnvMapIntensity * 0.55, baseEnvMapIntensity, v);
    }
  }

  private apply(c: Card) {
    // Both viewport exits and the circular wrap approach zero coverage before
    // changing sides. A wrapped frame therefore never teleports while visible.
    const rowHalfSpan = this.collections.length * T.GAP * this.layoutSpread / 2;
    const edgeDistance = Math.min(this.halfW * 1.05, rowHalfSpan);
    c.edgeFade.value = 1 - smooth(edgeDistance * 0.76, edgeDistance, Math.abs(c.cur.x));
    if (this.state === 'idle' || this.play) c.root.visible = c.edgeFade.value > 0.002;
    c.root.position.copy(c.cur);
    c.root.rotation.y = c.curRotY;
    c.root.scale.setScalar(c.curScale);
    const broadFace = Math.abs(Math.cos(c.curRotY));
    c.contactShadow.scale.set(lerp(0.54, 0.88, broadFace), 1, 1);
    c.contactShadow.material.opacity = lerp(0.072, c.data.shell === 'smoked' ? 0.168 : 0.142, broadFace) * c.opacity;
  }

  // ============================================================
  // click → play state machine
  // ============================================================

  private handleClick(index: number) {
    if (this.state !== 'idle' && !this.play) return;
    if (this.play && this.play.dir < 0) return;
    if (this.play && this.play.dir > 0) {
      // The same active case is a reversible toggle at every point in the
      // continuous focus/open animation. Background and neighbour clicks do
      // not disturb the selected composition.
      if (index === this.selected) this.closeSelected();
      return;
    }
    if (index < 0) return;

    // Freeze the rail on its exact snapped centre before the selected case
    // owns the composition. This prevents neighbours drifting beneath the
    // door while focus/open is running.
    const selectedOrderIndex = this.order.indexOf(index);
    if (selectedOrderIndex < 0) return;
    this.rowTarget = this.rowP + this.wrappedRowX(selectedOrderIndex, this.rowP);
    this.snapRowTarget();
    this.rowP = this.rowTarget;
    // One click starts focus; tick() automatically hands the same timeline to
    // the hinge-open phase at t=0.82 without waiting for another click.
    const c = this.cards[index];
    const selectedRenderOrder = this.collections.length + 2;
    c.root.renderOrder = selectedRenderOrder;
    c.sheet.renderOrder = selectedRenderOrder;
    c.lidPivot.renderOrder = selectedRenderOrder;
    this.play = {
      card: c,
      t: 0,
      dir: 1,
      stage: 'focus',
      from: { pos: c.cur.clone(), rotY: c.curRotY, scale: c.curScale }
    };
    this.selected = index;
  }

  // emit a stage change only when it actually changes
  private maybeEmitStage() {
    let s: SceneStage = 'archive';
    if (this.play?.stage === 'open') s = 'release';
    else if (this.play) s = 'focus';
    else if (!this.play && this.selected >= 0) s = 'selected';
    if (s !== this.lastEmittedStage) {
      this.lastEmittedStage = s;
      const idx = this.play ? this.play.card.root.userData.idx : this.selected;
      this.callbacks.onStageChange?.(s, idx);
    }
  }

  // ============================================================
  // main loop — exact port of the template's tick()
  // ============================================================

  private tick(now: number) {
    if (this.disposed || (!this.active && !this.firstFrame)) return;
    this.rafId = this.active ? requestAnimationFrame((t) => this.tick(t)) : 0;
    const rawDt = Math.max(0, (now - this.prev) / 1000);
    const dt = Math.min(rawDt, 0.05);
    this.prev = now;
    this.stateT += rawDt;

    const rowRate = this.dragging ? 18 : 4.8;
    const dRow = 1 - Math.exp(-dt * (this.reducedMotion ? 30 : rowRate));
    const dCard = 1 - Math.exp(-dt * (this.reducedMotion ? 30 : 10));
    const dFace = 1 - Math.exp(-dt * (this.reducedMotion ? 30 : 9));
    this.rowP = lerp(this.rowP, this.rowTarget, dRow);
    this.parallax = lerp(this.parallax, this.reducedMotion ? 0 : this.parallaxTarget, 1 - Math.exp(-dt * 4));
    this.rail.rotation.y = this.parallax;

    if (this.state === 'unfold' || this.state === 'unfolding' || this.state === 'folding') {
      if (this.entranceScrubbing) {
        this.entranceProgress = this.entranceTarget;
      } else if (this.state === 'unfold') {
        const settle = 1 - Math.exp(-dt * (this.reducedMotion ? 30 : 8));
        this.entranceProgress = lerp(this.entranceProgress, this.entranceTarget, settle);
      } else {
        const timelineDt = Math.min(rawDt, 0.10);
        const direction = this.state === 'folding' ? -1 : 1;
        this.entranceProgress = clamp(
          this.entranceProgress + direction * timelineDt * (this.reducedMotion ? 12 : ENTRANCE.UNFOLD_RATE),
          0,
          1,
        );
      }

      const unfoldProgress = smooth(0, 1, this.entranceProgress);
      const whiteScale = this.theme === 'light' ? 0.84 : 1;
      const centre = (this.collections.length - 1) / 2;
      const introViewportScale = lerp(0.88, 1, smooth(0.72, 1.05, this.viewportAspect));
      for (let i = 0; i < this.collections.length; i++) {
        const c = this.cards[i];
        const offset = i - centre;
        const normalizedOffset = centre > 0 ? offset / centre : 0;
        const curvedOffset = Math.sign(normalizedOffset) * Math.pow(Math.abs(normalizedOffset), 0.78);
        const depthOffset = Math.sign(normalizedOffset) * Math.pow(Math.abs(normalizedOffset), 1.06);
        const depthRank = this.collections.length > 1 ? i / (this.collections.length - 1) : 1;
        // The closed archive is a shallow, hand-curated depth fan instead of
        // an evenly stepped row. Gaps breathe around the centre and tighten
        // toward the ends; the rear cases turn away and recede optically.
        const singleCardEntrance = this.entranceStyle === 'single';
        const whiteSingleEntrance = singleCardEntrance && this.theme === 'light';
        const frontIndex = this.centerIndex();
        const frontOrderIndex = Math.max(0, this.order.indexOf(frontIndex));
        const cardOrderIndex = Math.max(0, this.order.indexOf(i));
        const orderDistance = Math.abs(cardOrderIndex - frontOrderIndex);
        const maxOrderDistance = Math.max(
          1,
          frontOrderIndex,
          this.collections.length - 1 - frontOrderIndex,
        );
        const distanceRank = orderDistance / maxOrderDistance;
        const sequence = 1 - depthRank;
        const cardUnfold = whiteSingleEntrance
          ? smooth(0.32 + distanceRank * 0.16, 1, this.entranceProgress)
          : singleCardEntrance
          ? smooth(
            distanceRank * 0.36,
            0.72 + distanceRank * 0.24,
            this.entranceProgress,
          )
          : easeOut(smooth(
            sequence * 0.16,
            0.84 + sequence * 0.16,
            this.entranceProgress,
          ));
        const startX = singleCardEntrance
          ? this.parallax * 0.2
          : curvedOffset * ENTRANCE.HORIZONTAL_GAP * centre
            + this.parallax * lerp(-1.15, 1.15, depthRank);
        const startY = singleCardEntrance
          ? 0
          : -Math.pow(Math.abs(normalizedOffset), 1.62) * ENTRANCE.VERTICAL_GAP * centre;
        const startZ = singleCardEntrance
          ? (i - frontIndex) * 0.008
          : depthOffset * ENTRANCE.DEPTH_GAP * centre * 1.10;
        const startRotY = singleCardEntrance ? 0 : lerp(0.64, ENTRANCE.INTRO_YAW, depthRank);
        const startScale = singleCardEntrance
          ? ENTRANCE.INTRO_SCALE * introViewportScale * (whiteSingleEntrance ? 0.25 : 0.82)
          : ENTRANCE.INTRO_SCALE * introViewportScale * lerp(0.85, 1, depthRank);
        const startOpacity = singleCardEntrance
          ? (i === frontIndex ? 1 : 0)
          : lerp(0.76, 1, depthRank);
        const logicalX = this.wrappedRowX(i, this.rowTarget);
        const finalX = this.rowX(i, this.rowTarget);
        const finalRotY = this.rowRotY(logicalX);

        c.hoverT = lerp(
          c.hoverT,
          this.state === 'unfold' && c.root.userData.idx === this.hovered ? 1 : 0,
          dFace,
        );
        const inspect = c.hoverT * (1 - unfoldProgress);
        c.cur.set(
          lerp(startX, finalX, cardUnfold),
          lerp(startY, 0, cardUnfold),
          lerp(startZ, 0, cardUnfold) + ENTRANCE.FOCUS_PUSH * inspect,
        );
        c.curRotY = lerp(startRotY, finalRotY, cardUnfold);
        const growth = whiteSingleEntrance ? smooth(0, 0.70, this.entranceProgress) : cardUnfold;
        const transitionScale = lerp(startScale, ENTRANCE.FINAL_SCALE * whiteScale, growth);
        c.curScale = lerp(transitionScale, ENTRANCE.FOCUS_SCALE * introViewportScale * whiteScale, inspect);
        this.setOpacity(c, lerp(startOpacity, 1, cardUnfold));
        c.root.visible = !singleCardEntrance || i === frontIndex || cardUnfold > 0.018;
        this.apply(c);
      }
      this.setRailReveal(this.entranceProgress);

      if ((this.state === 'unfolding' || this.entranceScrubbing) && this.entranceProgress >= 1) {
        this.completeEntrance();
      } else if (this.state === 'folding' && this.entranceProgress <= 0.001) {
        this.entranceProgress = 0;
        this.entranceTarget = 0;
        this.state = 'unfold';
        this.setRailReveal(0);
        this.emitEntrancePhase('closed', -1);
        this.frame.style.cursor = 'grab';
      }
    } else if (this.state === 'entering') {
      const duration = 2.15;
      const stagger = 0.085;
      const accel = 0.018;
      const extra = 3 * T.GAP;
      let done = true;
      for (let i = 0; i < this.collections.length; i++) {
        const c = this.cards[i];
        const tk = clamp((this.stateT - i * stagger) / (duration * (1 - accel * i)), 0, 1);
        const e = easeOut(tk);
        c.cur.x = lerp(7.5 + extra + i * T.GAP, this.rowX(i, this.rowTarget), e);
        c.cur.y = 0;
        c.cur.z = 0;
        c.curRotY = this.rowRotY(this.wrappedRowX(i, this.rowTarget));
        if (this.theme === 'light') c.curScale = 0.84;
        this.apply(c);
        if (tk < 1) done = false;
      }
      if (done) {
        this.state = 'idle';
        if (!this.entranceDone) {
          this.entranceDone = true;
          this.lastCenterMetadata = this.centerIndex();
          this.callbacks.onStageChange?.('archive', this.lastCenterMetadata);
        }
      }
    } else if (this.play) {
      // Single authoritative play loop. The ceiling is recomputed
      // every frame from the current stage so t can flow continuously
      // 0 -> 0.82 (focus) -> 1.42 (open) without ever being clamped
      // back to 0 at the stage boundary.
      const max = this.play.stage === 'focus' ? 0.82 : 1.42;
      const playRate = this.reducedMotion ? 6 : 1.18;
      // Keep interaction timing close to wall-clock time in background or
      // low-refresh tabs. The shorter physics dt above still protects all
      // spring interpolation from large frame jumps.
      const timelineDt = Math.min(rawDt, 0.25);
      this.play.t = clamp(this.play.t + this.play.dir * timelineDt * playRate, 0, max);

      // A single click owns both phases. Crossing the focus ceiling promotes
      // the same play object to open so the next frame continues past 0.82.
      if (this.play.dir > 0 && this.play.stage === 'focus' && this.play.t >= 0.82) {
        this.play.stage = 'open';
      }

      // During reverse, hand the timeline back to the focus portion
      // once t crosses the 0.82 boundary so the unwind can continue
      // all the way to 0.
      if (this.play.dir < 0 && this.play.stage === 'open' && this.play.t <= 0.82) {
        this.play.stage = 'focus';
      }

      const pc = this.play.card;
      if (this.play.dir < 0) this.stopVideo();
      else if (this.play.t >= 1.38) this.startVideo(pc);
      const e1r = smooth(0, 0.58, this.play.t);
      const e1x = smooth(0, 0.80, this.play.t);
      const open = smooth(0.82, 1.15, this.play.t);
      const release = smooth(0.90, 1.38, this.play.t);

      // case root — single write per frame.
      pc.cur.set(
        lerp(this.play.from.pos.x, T.FOCUS_X, e1x),
        lerp(this.play.from.pos.y, this.focusY, e1x),
        lerp(this.play.from.pos.z, T.FOCUS_Z, e1r)
      );
      pc.curRotY = lerp(this.play.from.rotY, 0, e1r);
      pc.curScale = lerp(this.play.from.scale, this.focusScale, e1r);

      // Lid — child of the case root — stays at its identity transform while
      // closed. Open-only projection
      // compensation matches the measured door trapezoid without moving the
      // case root or any neighbouring boxes.
      pc.lidPivot.position.x = -T.CASE_W / 2 + T.OPEN_HINGE_X * open;
      pc.lidPivot.position.y = T.OPEN_HINGE_Y * open;
      pc.lidPivot.scale.x = lerp(1, T.OPEN_SCALE_X, open);
      pc.lidPivot.scale.y = lerp(1, T.OPEN_SCALE_Y, open);
      pc.lidPivot.rotation.x = T.OPEN_PITCH * open;
      pc.lidPivot.rotation.y = T.OPEN_ANGLE * open;

      // sheet — child of case root, only local transform written here.
      pc.sheet.position.x = 0;
      pc.sheet.position.z = SHEET_CLOSED_Z + 0.003 * release;
      pc.sheet.rotation.y = 0;

      this.apply(pc);

      // The remaining archive stays legible and slides aside just enough to
      // make room for the broad case and its open door.
      const spread = smooth(0, 0.82, this.play.t);
      for (let k = 0; k < this.order.length; k++) {
        const c = this.cards[this.order[k]];
        if (c === pc) continue;
        const baseLogical = this.wrappedRowX(k, this.rowP);
        const baseX = this.rowX(k, this.rowP);
        const targetX = lerp(baseX, this.openRowX(baseLogical), spread);
        c.cur.x = lerp(c.cur.x, targetX, dCard);
        c.cur.y = lerp(c.cur.y, 0, dCard);
        c.cur.z = lerp(c.cur.z, 0, dCard);
        c.curRotY = lerp(c.curRotY, this.rowRotY(baseLogical), dCard);
        this.apply(c);
        this.setOpacity(c, 1 - T.BACKGROUND_FADE * spread);
      }

      // End of reverse: full reset (lid, sheet, renderOrder, opacity,
      // selected). The case root position is restored by t=0 lerping
      // back to play.from.pos.
      if (this.play.dir < 0 && this.play.t <= 0.001) {
        pc.lidPivot.position.set(-T.CASE_W / 2, 0, LID_Z);
        pc.lidPivot.scale.set(1, 1, 1);
        pc.lidPivot.rotation.x = 0;
        pc.lidPivot.rotation.y = 0;
        pc.sheet.position.set(0, 0, SHEET_CLOSED_Z);
        pc.sheet.rotation.set(0, 0, 0);
        pc.root.renderOrder = 0;
        pc.sheet.renderOrder = 0;
        pc.lidPivot.renderOrder = 0;
        this.cards.forEach((c) => this.setOpacity(c, 1));
        this.play = null;
        this.selected = -1;
        this.maybeEmitStage();
        if (this.pendingEntranceProgress !== null) {
          const progress = this.pendingEntranceProgress;
          this.pendingEntranceProgress = null;
          this.setEntranceProgress(progress);
        }
      } else {
        this.maybeEmitStage();
      }
    } else {
      let selectedK = -1;
      if (this.selected >= 0) {
        for (let k = 0; k < this.collections.length; k++) {
          if (this.order[k] === this.selected) { selectedK = k; this.pushX = this.rowX(k, this.rowP); break; }
        }
      }
      this.pushVel += ((selectedK >= 0 ? 1 : 0) - this.pushAmt) * 70 * dt;
      this.pushVel *= Math.exp(-10 * dt);
      this.pushAmt += this.pushVel * dt;
      if (this.pushAmt < 0) { this.pushAmt = 0; this.pushVel = 0; }
      if (this.pushAmt > 1) { this.pushAmt = 1; this.pushVel = 0; }

      for (let k = 0; k < this.collections.length; k++) {
        const c = this.cards[this.order[k]];
        const logicalX = this.wrappedRowX(k, this.rowP);
        let x = this.rowX(k, this.rowP);
        if (k !== selectedK && this.pushAmt > 0.001) x += (x < this.pushX ? -1 : 1) * T.PUSH * this.pushAmt;
        this.temp.set(x, 0, 0);
        let rot = this.rowRotY(logicalX);
        c.faceT = lerp(c.faceT, k === selectedK ? 1 : 0, dFace);
        c.hoverT = lerp(c.hoverT, c.root.userData.idx === this.hovered ? 0.12 : 0, dFace);
        if (c.faceT > 0.001) { rot = lerp(rot, 0, c.faceT); this.temp.z += c.faceT * 0.88; }
        this.temp.z += c.hoverT;
        if (Math.abs(this.temp.x - c.cur.x) > this.collections.length * T.GAP * this.layoutSpread / 2) {
          c.cur.x = this.temp.x;
        }
        c.cur.lerp(this.temp, dCard);
        c.curRotY = lerp(c.curRotY, rot, dCard);
        const centerEmphasis = Math.max(0, 1 - Math.abs(x) / (T.GAP * 0.55));
        const baseScale = (this.entranceMode === 'unfold' ? ENTRANCE.FINAL_SCALE : 1)
          * (this.theme === 'light' ? 0.84 : 1);
        c.curScale = lerp(
          c.curScale,
          baseScale * (1 + centerEmphasis * 0.008 + c.hoverT * 0.018),
          dCard,
        );
        this.apply(c);
      }
      const currentCenter = this.centerIndex();
      if (currentCenter !== this.lastCenterMetadata) {
        this.lastCenterMetadata = currentCenter;
        this.callbacks.onStageChange?.('archive', currentCenter);
      }
      this.maybeEmitStage();
    }

    this.renderer.render(this.scene, this.camera);

    if (this.firstFrame) {
      this.firstFrame = false;
      if (!this.sceneReadyEmitted) {
        this.sceneReadyEmitted = true;
        this.callbacks.onSceneReady?.();
        if (this.entranceMode === 'unfold' && !this.reducedMotion && !this.entranceDone) {
          this.emitEntrancePhase(this.entranceProgress > 0 ? 'inspecting' : 'closed', -1);
        }
      }
    }
  }
}
