/* eslint-disable react-hooks/refs -- User-supplied imperative Three.js animation engine. */
// Liquid Glass Carousel — Originkit

"use client"

import { useEffect, useMemo, useRef } from "react"
import * as THREE from "three"

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

type Ease = (t: number) => number

const outPow =
    (n: number): Ease =>
    (t) =>
        1 - Math.pow(1 - t, n)

const inOutPow =
    (n: number): Ease =>
    (t) =>
        t < 0.5 ? Math.pow(2 * t, n) / 2 : 1 - Math.pow(2 - 2 * t, n) / 2

const OUT3 = outPow(3)
const INOUT2 = inOutPow(2)
const INOUT3 = inOutPow(3)

const EXPO_INOUT: Ease = (t) =>
    t <= 0
        ? 0
        : t >= 1
          ? 1
          : t < 0.5
            ? Math.pow(2, 20 * t - 10) / 2
            : (2 - Math.pow(2, -20 * t + 10)) / 2

export interface FramerTransition {
    type?: string
    duration?: number
    delay?: number
    ease?: string | number[]
    stiffness?: number
    damping?: number
    mass?: number
    bounce?: number
}

function cubicBezier(x1: number, y1: number, x2: number, y2: number): Ease {
    const a = (u: number, v: number) => 1 - 3 * v + 3 * u
    const b = (u: number, v: number) => 3 * v - 6 * u
    const c = (u: number) => 3 * u
    const calc = (t: number, u: number, v: number) =>
        ((a(u, v) * t + b(u, v)) * t + c(u)) * t
    const slope = (t: number, u: number, v: number) =>
        3 * a(u, v) * t * t + 2 * b(u, v) * t + c(u)
    return (p) => {
        if (p <= 0) return 0
        if (p >= 1) return 1
        let t = p
        for (let i = 0; i < 8; i++) {
            const s = slope(t, x1, x2)
            if (Math.abs(s) < 1e-6) break
            t -= (calc(t, x1, x2) - p) / s
        }
        return calc(clamp01(t), y1, y2)
    }
}

const NAMED_EASES: Record<string, [number, number, number, number]> = {
    linear: [0, 0, 1, 1],
    easeIn: [0.42, 0, 1, 1],
    easeOut: [0, 0, 0.58, 1],
    easeInOut: [0.42, 0, 0.58, 1],
    circIn: [0.55, 0, 1, 0.45],
    circOut: [0, 0.55, 0.45, 1],
    circInOut: [0.85, 0, 0.15, 1],
    backIn: [0.36, 0, 0.66, -0.56],
    backOut: [0.34, 1.56, 0.64, 1],
    backInOut: [0.68, -0.6, 0.32, 1.6],
    anticipate: [0.38, -0.4, 0.6, 1],
}

function springCurve(stiffness: number, damping: number, mass: number) {
    const w0 = Math.sqrt(Math.max(stiffness, 1) / Math.max(mass, 0.01))
    const zeta = damping / (2 * Math.sqrt(Math.max(stiffness, 1) * Math.max(mass, 0.01)))
    let at: (t: number) => number
    if (zeta < 1) {
        const wd = w0 * Math.sqrt(1 - zeta * zeta)
        at = (t) =>
            1 -
            Math.exp(-zeta * w0 * t) *
                (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t))
    } else if (zeta === 1) {
        at = (t) => 1 - Math.exp(-w0 * t) * (1 + w0 * t)
    } else {
        const s = w0 * Math.sqrt(zeta * zeta - 1)
        const r1 = -zeta * w0 + s
        const r2 = -zeta * w0 - s
        at = (t) => 1 - (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r2 - r1)
    }

    let duration = 6
    for (let t = 0.02; t <= 6; t += 0.02) {
        if (Math.abs(1 - at(t)) < 0.004) {
            duration = t
            break
        }
    }
    return { at, duration }
}

const transitionCache = new Map<string, { duration: number; ease: Ease; delay: number }>()

function resolveTransition(t: FramerTransition | undefined, unit: number) {
    const key = `${unit}:${JSON.stringify(t ?? null)}`
    const hit = transitionCache.get(key)
    if (hit) return hit

    let duration = unit
    let ease: Ease = OUT3
    const delay = typeof t?.delay === "number" ? t.delay : -1

    const isSpring =
        t?.type === "spring" ||
        (t != null && t.type == null && (t.stiffness != null || t.bounce != null))

    if (isSpring && t) {
        if (t.bounce != null && t.duration != null) {
            const zeta = clamp(1 - t.bounce, 0.05, 1.5)
            const d = Math.max(0.05, t.duration)
            const w0 = 8 / d
            const curve = springCurve(w0 * w0, 2 * zeta * w0, 1)
            duration = curve.duration

            ease = (u) => (u >= 1 ? 1 : curve.at(u * duration))
        } else {
            const curve = springCurve(
                t.stiffness ?? 300,
                t.damping ?? 30,
                t.mass ?? 1
            )
            duration = curve.duration

            ease = (u) => (u >= 1 ? 1 : curve.at(u * duration))
        }
    } else if (t) {
        if (typeof t.duration === "number" && t.duration > 0) duration = t.duration
        const e = t.ease
        if (Array.isArray(e) && e.length === 4) {
            ease = cubicBezier(e[0], e[1], e[2], e[3])
        } else if (typeof e === "string" && NAMED_EASES[e]) {
            const p = NAMED_EASES[e]
            ease = cubicBezier(p[0], p[1], p[2], p[3])
        }
    }

    const out = { duration: clamp(duration, 0.05, 20), ease, delay }

    if (transitionCache.size > 64) transitionCache.clear()
    transitionCache.set(key, out)
    return out
}

type NumBag = Record<string, number>

const bag = (a: number[]) => a as unknown as NumBag

interface Track {
    obj: NumBag
    key: string
    from: number | null
    to: number
    dur: number
    at: number
    ease: Ease
}

class Timeline {
    private tracks: Track[] = []
    private calls: { at: number; fn: () => void; fired: boolean }[] = []
    private time: number
    private dead = false

    constructor(delay = 0) {
        this.time = -delay
    }

    to(
        obj: NumBag,
        key: string | number,
        to: number,
        dur: number,
        ease: Ease,
        at = 0
    ) {
        this.tracks.push({
            obj,
            key: String(key),
            from: null,
            to,
            dur: Math.max(0.0001, dur),
            at,
            ease,
        })
        return this
    }

    call(fn: () => void, at: number) {
        this.calls.push({ at, fn, fired: false })
        return this
    }

    step(dt: number) {
        if (this.dead) return
        this.time += dt
        for (const tr of this.tracks) {
            const u = (this.time - tr.at) / tr.dur
            if (u < 0) continue
            if (tr.from === null) tr.from = tr.obj[tr.key] ?? 0
            tr.obj[tr.key] = tr.from + (tr.to - tr.from) * tr.ease(clamp01(u))
        }
        for (const c of this.calls) {
            if (!c.fired && this.time >= c.at) {
                c.fired = true
                c.fn()
            }
        }
    }

    kill() {
        this.dead = true
        this.tracks.length = 0
        this.calls.length = 0
    }
}

const lensVertexShader =  `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`

const lensFragmentShader =  `
  #define PI 3.14159265
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uTex;
  uniform vec2  uRes;
  uniform vec2  uCenter;
  uniform float uSizeX;
  uniform float uSizeY;
  uniform float uAspect;
  uniform float uZoom;
  uniform float uDispersion;
  uniform float uBlur;
  uniform float uGlow;
  uniform float uWhiteGlow;
  uniform float uNovaSize;
  uniform float uBlueRing;
  uniform float uRingRadius;
  uniform float uRingWidth;
  uniform float uShimmer;
  uniform float uShimmerFreq;
  uniform float uShimmerSpeed;
  uniform float uShimmerDepth;
  uniform float uTime;
  uniform float uRimStart;
  uniform float uRimTangential;
  uniform float uRimInward;
  uniform float uRimFreq1;
  uniform float uRimFreq2;
  uniform vec3  uBlueColor;
  uniform float uRimLine;
  uniform float uRimLinePos;
  uniform float uRimLineWidth;
  uniform float uVignette;
  uniform float uVignetteSize;
  uniform float uShape;
  uniform float uSquareRound;
  uniform float uRotation;
  uniform int   uSamples;

  const int MAX_SAMPLES = 16;

  float sdRoundBox(vec2 p, vec2 b, float r){
    vec2 q = abs(p) - b + r;
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
  }

  vec3 discLens(vec2 center, float aspectCorrect, out float outA) {
    vec2 p = (vUv - center);
    p.x *= aspectCorrect;

    float ca = cos(uRotation), sa = sin(uRotation);
    p = mat2(ca, -sa, sa, ca) * p;
    vec2 halfSize = vec2(uSizeX, uSizeY);

    float dist = length(p / halfSize);
    outA = 0.0;

    float maskND;
    if (uShape > 0.5) {
      float corner = min(uSizeX, uSizeY) * clamp(uSquareRound, 0.0, 1.0);
      float sd = sdRoundBox(p, halfSize, corner);
      maskND = 1.0 + sd / min(uSizeX, uSizeY);
    } else {
      maskND = dist;
    }
    if (maskND > 1.0) return vec3(0.0);

    float shapeND = clamp(maskND, 0.0, 1.0);

    float nd = clamp(dist, 0.0, 1.0);
    vec2  offset = vUv - center;
    vec2  radialDir = normalize(offset + 1e-6);
    vec2  tangentDir = vec2(-radialDir.y, radialDir.x);

    float angle = atan(p.y, p.x);

    float pull = uZoom * 0.30 * (nd * nd);
    float rimStrength = smoothstep(uRimStart, 1.0, nd);
    float fluidWave = sin(angle * uRimFreq1) * 0.55 + sin(angle * uRimFreq2) * 0.25;
    float rScreen = (uSizeX + uSizeY) * 0.5;
    vec2  rimOff = tangentDir * fluidWave * rimStrength * rScreen * uRimTangential;
    vec2  rimPull = -radialDir * rimStrength * rScreen * uRimInward;

    vec2 baseUV = center + offset * (1.0 - pull) + rimOff + rimPull;

    float rimMask = smoothstep(0.55, 1.0, nd);
    vec2  dispDir = offset * uDispersion * 0.004 * rimMask;
    int N = uSamples;
    if (N < 2) N = 2;
    if (N > MAX_SAMPLES) N = MAX_SAMPLES;
    vec3 col = vec3(0.0);

    if (uDispersion < 0.01) {
      col = texture2D(uTex, baseUV).rgb;
    } else {
      vec3 caW = vec3(0.0);
      for (int i = 0; i < MAX_SAMPLES; i++) {
        if (i >= N) break;
        float t = float(i) / float(N - 1);
        vec2 sUV = baseUV + dispDir * (t - 0.5);
        vec3 s = texture2D(uTex, sUV).rgb;
        vec3 w = vec3(
          exp(-pow((t - 0.00) / 0.38, 2.0)),
          exp(-pow((t - 0.50) / 0.38, 2.0)),
          exp(-pow((t - 1.00) / 0.38, 2.0))
        );
        col += s * w;
        caW += w;
      }
      col /= max(caW, vec3(0.001));
    }

    float blurFade = 1.0 - smoothstep(0.72, 0.98, nd);
    if (uBlur > 0.01 && blurFade > 0.01) {
      vec2 blurRad = vec2(uBlur) / uRes * blurFade;
      vec3 bcol = vec3(0.0);
      float btw = 0.0;
      for (float a = 0.0; a < PI * 2.0; a += PI * 2.0 / 6.0) {
        for (float rr = 0.4; rr <= 1.001; rr += 0.3) {
          vec2 o = vec2(cos(a), sin(a)) * blurRad * rr;
          float w = 1.0 - rr * 0.38;
          bcol += texture2D(uTex, baseUV + o).rgb * w;
          btw += w;
        }
      }
      col = mix(bcol / btw, col, rimMask);
    }

    col *= mix(0.91, 1.0, smoothstep(0.0, 0.38, shapeND));

    float r2 = shapeND * shapeND * 0.25;
    float gs = max(uNovaSize * uGlow * 0.003, 0.004);
    float nova = exp(-r2 / gs) + exp(-r2 / (gs * 7.0)) * 0.18;
    nova *= uWhiteGlow * (uGlow / 17.0) * 1.15;
    col += vec3(nova);

    float dC = shapeND * 0.5;
    float tR = clamp(uRingRadius, 0.1, 0.49);
    float rW = max(uRingWidth, 0.003);
    float ring = exp(-pow((dC - tR) / rW, 2.0));
    ring *= uBlueRing * (uGlow / 17.0) * 1.8;
    if (uShimmer > 0.5) ring *= sin(angle * uShimmerFreq + uTime * uShimmerSpeed) * uShimmerDepth + (1.0 - uShimmerDepth);

    float ringAura = exp(-pow((dC - tR) / (rW * 4.0), 2.0)) * 0.2 * uBlueRing * (uGlow / 17.0);
    col += uBlueColor * (ring + ringAura);

    vec3 edgeCol = mix(vec3(1.0), uBlueColor, 0.55);
    col += edgeCol * (exp(-pow((dC - uRimLinePos) / max(uRimLineWidth, 0.0001), 2.0)) * uRimLine);

    outA = smoothstep(1.0, 0.93, maskND);
    return col;
  }

  void main(){
    vec3 base = texture2D(uTex, vUv).rgb;
    vec3 outc = base;

    float a = 0.0;
    vec3 c = discLens(uCenter, uAspect, a);
    outc = mix(outc, c, a);

    if (uVignette > 0.001) {
      vec2 vc = vUv - 0.5;
      vc.x *= uAspect;
      float d = length(vc) / max(uVignetteSize, 0.0001);
      float vig = 1.0 - uVignette * smoothstep(0.5, 1.0, d);
      outc *= clamp(vig, 0.0, 1.0);
    }

    gl_FragColor = vec4(outc, 1.0);
  }
`

interface EntryOffset {
    x: number
    y: number
}

type EntryPattern = (index: number, count: number, slot: number) => EntryOffset

const FROM_BOTTOM: EntryOffset = { x: 0, y: -1 }
const FROM_TOP: EntryOffset = { x: 0, y: 1 }

const ENTRY_PATTERNS: Record<string, EntryPattern> = {
    bottom: () => FROM_BOTTOM,
    top: () => FROM_TOP,

    alternate: (index) => (index % 2 === 0 ? FROM_TOP : FROM_BOTTOM),
}

interface CardScale {
    w: number
    h: number
}

type CardSizing = (index: number) => CardScale

const UNIFORM: CardScale = { w: 1, h: 1 }

const ALTERNATE_NARROW = 0.62

const hash01 = (n: number) => {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
    return x - Math.floor(x)
}

const SIZE_MODES: Record<string, CardSizing> = {
    same: () => UNIFORM,
    alternate: (i) => (i % 2 === 0 ? UNIFORM : { w: ALTERNATE_NARROW, h: 1 }),
    random: (i) => ({
        w: 0.6 + 0.4 * hash01(i),
        h: 0.7 + 0.3 * hash01(i + 97),
    }),

    image: () => UNIFORM,
}

type ImageValue = string | { src?: string } | null | undefined

export interface CarouselItem {
    image?: ImageValue
    offsetY?: number
}

type ItemValue = CarouselItem | ImageValue

const isItemObject = (v: ItemValue): v is CarouselItem =>
    typeof v === "object" && v !== null && ("image" in v || "offsetY" in v)

const imageOf = (v: ItemValue): ImageValue => (isItemObject(v) ? v.image : v)

const offsetOf = (v: ItemValue): number => {
    if (!isItemObject(v)) return 0
    return typeof v.offsetY === "number" ? v.offsetY : 0
}

export interface LensSettings {
    shape?: "circle" | "square"
    width?: number
    height?: number
    rotation?: number
    dispersion?: number
    ringColor?: string
}

export interface MotionSettings {
    sensitivity?: number
    glide?: number
    snap?: boolean
}

export interface EntrySettings {
    enabled?: boolean
    transition?: FramerTransition
    enterFrom?: string
}

export interface InteractionSettings {
    wheel?: boolean
    drag?: boolean
    clickToFocus?: boolean
    focusTransition?: FramerTransition
}

export interface LiquidGlassCarouselProps {
    labels?: string[]
    onSelect?: (index: number, origin: { left: number; top: number; width: number; height: number }) => void
    reducedMotion?: boolean
    items?: ItemValue[]
    background?: string
    sizeMode?: string
    cardWidth?: number
    cardHeight?: number

    panelHeight?: number
    gap?: number
    lens?: LensSettings
    motion?: MotionSettings
    entry?: EntrySettings
    interaction?: InteractionSettings
    style?: React.CSSProperties
}

const srcOf = (v: ImageValue): string =>
    typeof v === "string" ? v : typeof v?.src === "string" ? v.src : ""

function alphaOf(css: string): number {
    const rgba = /rgba?\(([^)]+)\)/i.exec(css)
    if (rgba) {
        const parts = rgba[1].split(/[\s,/]+/).filter(Boolean)
        return parts.length >= 4 ? clamp01(parseFloat(parts[3])) : 1
    }
    const hex = css.trim()
    if (/^#[0-9a-f]{8}$/i.test(hex)) return parseInt(hex.slice(7, 9), 16) / 255
    if (/^#[0-9a-f]{4}$/i.test(hex)) return parseInt(hex[4] + hex[4], 16) / 255
    return 1
}

function makeParams(p: LiquidGlassCarouselProps) {
    const m = p.motion ?? {}
    const e = p.entry ?? {}
    const it = p.interaction ?? {}
    const l = p.lens ?? {}

    const sens = clamp(m.sensitivity ?? 5, 0.2, 10)
    const glide = clamp(m.glide ?? 5, 0, 10)

    const et = resolveTransition(e.transition, 1.0)
    const ts = et.duration / 1.0
    const ft = resolveTransition(it.focusTransition, 0.7)
    const fs = ft.duration / 0.7

    const lensAlpha = alphaOf(l.ringColor ?? "#009dff")

    const ease = clamp(0.18 * Math.pow(0.5, glide / 5), 0.02, 0.4)

    return {
        onSelect: p.onSelect,
        labels: p.labels ?? [],
        reducedMotion: p.reducedMotion ?? false,
        itemOffsets: (p.items ?? []).filter(Boolean).map(offsetOf),
        panelH: clamp(p.cardHeight ?? p.panelHeight ?? 450, 60, 1200),
        cardW: clamp(p.cardWidth ?? 340, 40, 1600),
        sizeMode: SIZE_MODES[p.sizeMode ?? "same"] ? p.sizeMode ?? "same" : "same",
        gap: clamp(p.gap ?? 12, 0, 200),
        shrinkMax: 0.25,
        shrinkSpeed: 60,
        shrinkAttack: 0.25,
        shrinkDecay: 0.06,

        ease,
        snapEase: ease * 0.56,
        wheelSpeed: 0.28 * sens,
        dragSpeed: 0.32 * sens,
        touchDrag: 1.0,
        touchEase: 0.22,
        friction: 0.865,
        snap: m.snap !== false,
        snapIdleMs: 120,
        clickSlop: 6,
        touchClickSlop: 12,
        flickIdleMs: 90,

        wheel: it.wheel !== false,
        drag: it.drag !== false,
        clickToFocus: it.clickToFocus !== false,

        focus: {
            cardDuration: ft.duration,
            focusDuration: 0.9 * fs,
            stagger: 0.06 * fs,
            dropDist: 1.4,
            centerScale: 1.18,
            lensFade: 0.85 * fs,
            ease: ft.ease,
        },

        entry: {
            enabled: e.enabled !== false,
            delay: et.delay >= 0 ? et.delay : 0.5 * ts,
            startH: 80,
            riseDuration: et.duration,
            ease: et.ease,
            stagger: 0.07 * ts,
            travel: 0.9,

            pattern:
                ENTRY_PATTERNS[e.enterFrom ?? "bottom"] ?? ENTRY_PATTERNS.bottom,
            growDelay: 0.25 * ts,
            growDuration: 2.15 * ts,
            growStagger: 0.085 * ts,
            outward: false,
            lensBloom: 1.4 * ts,
        },

        lens: {
            enabled: true,
            square: l.shape === "square",
            round: 0,
            sizeX: clamp(l.width ?? 0.565, 0.05, 3),
            sizeY: clamp(l.height ?? 1, 0.05, 3),
            posX: 0.5,
            posY: 0.5,
            rotation: l.rotation ?? 65,
            spin: 0,
            zoom: 0,
            dispersion: clamp(l.dispersion ?? 11, 0, 60),
            blur: 0,
            glow: 3,
            whiteGlow: 0.08,
            novaSize: 12,
            ring: 1 * lensAlpha,
            ringRadius: 0.49,
            ringWidth: 0.014,
            ringColor: l.ringColor ?? "#009dff",
            shimmer: !p.reducedMotion,
            shimmerFreq: 12,
            shimmerSpeed: 3.5,
            shimmerDepth: 0.12,
            rimStart: 0.578,
            rimTangential: 0.6,
            rimInward: 0,
            rimFreq1: 2,
            rimFreq2: 1,
            rimLine: 0,
            rimLinePos: 0.488,
            rimLineWidth: 0.003,
            vignette: 0,
            vignetteSize: 0.3,
            samples: 16,
        },

        background: p.background ?? "#000000",
        cardColor: "#262626",
    }
}

type Params = ReturnType<typeof makeParams>

const PLACEHOLDER_ASPECTS = [1.5, 0.78, 1.33, 1.0, 1.62, 0.72, 1.2, 1.45, 0.86, 1.7]

function placeholderTexture(index: number, aspect: number, color: string) {
    const h = 320
    const w = Math.max(1, Math.round(h * aspect))
    const canvas = document.createElement("canvas")
    canvas.width = w
    canvas.height = h
    const g = canvas.getContext("2d")
    if (g) {
        g.fillStyle = color
        g.fillRect(0, 0, w, h)
        const grad = g.createLinearGradient(0, 0, w, h)
        grad.addColorStop(0, "rgba(255,255,255,0.16)")
        grad.addColorStop(0.55, "rgba(255,255,255,0.02)")
        grad.addColorStop(1, "rgba(255,255,255,0.1)")
        g.fillStyle = grad
        g.fillRect(0, 0, w, h)
        g.fillStyle = "rgba(255,255,255,0.6)"
        g.font = `500 ${Math.round(h * 0.14)}px ui-sans-serif, system-ui, -apple-system, sans-serif`
        g.textAlign = "center"
        g.textBaseline = "middle"
        g.fillText(String(index + 1).padStart(2, "0"), w / 2, h / 2)
    }
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.minFilter = THREE.LinearMipmapLinearFilter
    tex.magFilter = THREE.LinearFilter
    tex.generateMipmaps = true
    return tex
}

const REPEATS = 4

interface EngineItem {
    src: string
    aspect: number | null
}

interface Source {
    tex: THREE.Texture | null
    aspect: number
    locked: boolean
    ph: boolean
}

interface Panel {
    mesh: THREE.Mesh
    mat: THREE.MeshBasicMaterial
    srcIndex: number
    bound: boolean
}

interface PanelRect {
    left: number
    right: number
    top: number
    bottom: number
    poolIdx: number
    srcIndex: number
    centerX: number
}

function createEngine(mount: HTMLElement, getParams: () => Params) {
    let pp = getParams()
    const still = false
    let disposed = false

    let W = Math.max(1, mount.clientWidth)
    let H = Math.max(1, mount.clientHeight)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })

    renderer.setPixelRatio(still ? 1 : Math.min(window.devicePixelRatio || 1, 2))
    renderer.setSize(W, H)

    const clearColor = new THREE.Color()
    let clearKey = ""
    function applyClear() {
        if (pp.background === clearKey) return
        clearKey = pp.background
        try {
            clearColor.set(pp.background)
        } catch {
            clearColor.set("#ffffff")
        }
        renderer.setClearColor(clearColor, 1)
    }
    applyClear()

    const el = renderer.domElement
    el.style.position = "absolute"
    el.style.left = "0"
    el.style.top = "0"
    el.style.display = "block"

    el.style.touchAction = "none"
    el.style.userSelect = "none"
    el.style.setProperty("-webkit-user-select", "none")
    el.style.setProperty("-webkit-touch-callout", "none")
    el.style.setProperty("-webkit-tap-highlight-color", "transparent")
    mount.appendChild(el)

    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(
        -W / 2,
        W / 2,
        H / 2,
        -H / 2,
        -100,
        100
    )
    camera.position.z = 10

    const loader = new THREE.TextureLoader()
    loader.setCrossOrigin("anonymous")

    let sources: Source[] = []
    let pool: Panel[] = []
    const caption = document.createElement("div")
    caption.className = "liquid-carousel-caption"
    caption.setAttribute("role", "status")
    caption.setAttribute("aria-live", "polite")
    mount.appendChild(caption)
    let owned: THREE.Texture[] = []
    let offsets: number[] = []
    let totalWidth = 0

    function panelHeight() {
        return Math.min(pp.panelH, Math.max(40, H * 0.86))
    }

    function sizing(srcIndex: number) {
        return (SIZE_MODES[pp.sizeMode] ?? SIZE_MODES.same)(srcIndex)
    }

    function cardHeight(srcIndex: number) {
        return panelHeight() * sizing(srcIndex).h
    }

    function widthAt(srcIndex: number, h: number) {
        if (pp.sizeMode === "image") return sources[srcIndex].aspect * h
        const rest = cardHeight(srcIndex)
        return pp.cardW * sizing(srcIndex).w * (rest > 0 ? h / rest : 1)
    }

    function slotWidth(srcIndex: number) {
        return widthAt(srcIndex, cardHeight(srcIndex)) + pp.gap
    }

    function coverWindow(srcIndex: number) {
        const h = cardHeight(srcIndex)
        const card = h > 0 ? widthAt(srcIndex, h) / h : 1
        const art = sources[srcIndex].aspect || 1
        if (Math.abs(card - art) < 1e-6) return { rx: 1, ox: 0, ry: 1, oy: 0 }
        if (card > art) {
            const ry = art / card
            return { rx: 1, ox: 0, ry, oy: (1 - ry) / 2 }
        }
        const rx = card / art
        return { rx, ox: (1 - rx) / 2, ry: 1, oy: 0 }
    }

    function recomputeTotal() {
        offsets = []
        let acc = 0
        for (let i = 0; i < sources.length; i++) {
            offsets.push(acc)
            acc += slotWidth(i)
        }
        totalWidth = acc
    }

    function centerForIndex(idx: number) {
        const N = sources.length
        if (!N) return 0
        const loop = Math.floor(idx / N)
        const s = ((idx % N) + N) % N
        return offsets[s] + slotWidth(s) / 2 - pp.gap / 2 + loop * totalWidth
    }

    function nearestIndex(value: number) {
        const N = sources.length
        if (!totalWidth || !N) return 0
        let best = 0
        let bestDist = Infinity
        for (let i = 0; i < N; i++) {
            const center = offsets[i] + slotWidth(i) / 2 - pp.gap / 2
            const k = Math.round((value - center) / totalWidth)
            const dist = Math.abs(center + k * totalWidth - value)
            if (dist < bestDist) {
                bestDist = dist
                best = i + k * N
            }
        }
        return best
    }

    function centerIndex(value: number) {
        if (!totalWidth || !sources.length) return 0
        let bestI = 0
        let bestDist = Infinity
        for (let i = 0; i < sources.length; i++) {
            const center = offsets[i] + slotWidth(i) / 2 - pp.gap / 2
            const k = Math.round((value - center) / totalWidth)
            const dist = Math.abs(center + k * totalWidth - value)
            if (dist < bestDist) {
                bestDist = dist
                bestI = i
            }
        }
        return bestI
    }

    let scroll = 0
    let target = 0
    let velocity = 0
    let prevScroll = 0
    let scrollEnergy = 0
    let pendingFocus: { srcIndex: number } | null = null
    let lastInput = performance.now()
    let snapped = false

    const focusState = {
        active: false,
        srcIndex: -1,
        poolIdx: -1,
        lensFx: 1,
    }
    const focusZoom = { v: 1 }
    let drop: number[] = []
    let pEntry: number[] = []
    let growArr: number[] = []
    let lastCenterX: (number | undefined)[] = []
    let entryActive = false
    let entrySettled = false
    let closing = false
    let focusTl: Timeline | null = null
    let entryTl: Timeline | null = null

    const dpr = renderer.getPixelRatio()
    const rt = new THREE.WebGLRenderTarget(
        Math.max(1, Math.round(W * dpr)),
        Math.max(1, Math.round(H * dpr))
    )
    const lensScene = new THREE.Scene()
    const lensCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    const lensU = {
        uTex: { value: rt.texture as THREE.Texture },
        uRes: { value: new THREE.Vector2(W * dpr, H * dpr) },
        uCenter: { value: new THREE.Vector2(0.5, 0.5) },
        uSizeX: { value: 0.565 },
        uSizeY: { value: 1 },
        uShape: { value: 0 },
        uSquareRound: { value: 0 },
        uRotation: { value: 0 },
        uAspect: { value: W / H },
        uZoom: { value: 0 },
        uDispersion: { value: 11 },
        uBlur: { value: 0 },
        uGlow: { value: 4.2 },
        uWhiteGlow: { value: 0.24 },
        uNovaSize: { value: 12 },
        uBlueRing: { value: 6 },
        uRingRadius: { value: 0.49 },
        uRingWidth: { value: 0.014 },
        uShimmer: { value: 1 },
        uShimmerFreq: { value: 12 },
        uShimmerSpeed: { value: 3.5 },
        uShimmerDepth: { value: 0.12 },
        uTime: { value: 0 },
        uRimStart: { value: 0.578 },
        uRimTangential: { value: 0.6 },
        uRimInward: { value: 0 },
        uRimFreq1: { value: 2 },
        uRimFreq2: { value: 1 },
        uBlueColor: { value: new THREE.Color("#009dff") },
        uRimLine: { value: 1.4 },
        uRimLinePos: { value: 0.488 },
        uRimLineWidth: { value: 0.003 },
        uVignette: { value: 0 },
        uVignetteSize: { value: 0.3 },
        uSamples: { value: 16 },
    }
    const lensMat = new THREE.ShaderMaterial({
        uniforms: lensU,
        vertexShader: lensVertexShader,
        fragmentShader: lensFragmentShader,
    })
    const lensQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), lensMat)
    lensScene.add(lensQuad)

    try {
        renderer.compile(lensScene, lensCam)
    } catch {}

    let ringKey = ""
    function syncLens(now: number) {
        const L = pp.lens
        const rad = (a: number) => (a * Math.PI) / 180
        lensU.uCenter.value.set(L.posX, L.posY)
        lensU.uAspect.value = W / H
        lensU.uTime.value = now * 0.001
        lensU.uRotation.value = rad(L.rotation) + rad(L.spin) * (now * 0.001)
        lensU.uSizeX.value = L.sizeX
        lensU.uSizeY.value = L.sizeY
        lensU.uShape.value = L.square ? 1 : 0
        lensU.uSquareRound.value = L.round
        lensU.uBlur.value = L.blur
        lensU.uGlow.value = L.glow
        lensU.uWhiteGlow.value = L.whiteGlow
        lensU.uNovaSize.value = L.novaSize
        lensU.uRingRadius.value = L.ringRadius
        lensU.uRingWidth.value = L.ringWidth
        lensU.uShimmer.value = L.shimmer ? 1 : 0
        lensU.uShimmerFreq.value = L.shimmerFreq
        lensU.uShimmerSpeed.value = L.shimmerSpeed
        lensU.uShimmerDepth.value = L.shimmerDepth
        lensU.uRimStart.value = L.rimStart
        lensU.uRimFreq1.value = L.rimFreq1
        lensU.uRimFreq2.value = L.rimFreq2
        lensU.uRimLinePos.value = L.rimLinePos
        lensU.uRimLineWidth.value = L.rimLineWidth
        lensU.uVignetteSize.value = L.vignetteSize
        lensU.uSamples.value = L.samples
        if (L.ringColor !== ringKey) {
            ringKey = L.ringColor
            try {
                lensU.uBlueColor.value.set(/^#[0-9a-f]{8}$/i.test(L.ringColor) ? L.ringColor.slice(0, 7) : L.ringColor)
            } catch {
                lensU.uBlueColor.value.set("#009dff")
            }
        }

        const fx = focusState.lensFx
        lensU.uDispersion.value = L.dispersion * fx
        lensU.uBlueRing.value = L.ring * fx
        lensU.uRimLine.value = L.rimLine * fx
        lensU.uVignette.value = L.vignette * fx
        lensU.uZoom.value = L.zoom * fx
        lensU.uRimTangential.value = L.rimTangential * fx
        lensU.uRimInward.value = L.rimInward * fx
    }

    function disposeContent() {
        pool.forEach((p) => {
            scene.remove(p.mesh)
            p.mesh.geometry.dispose()
            p.mat.dispose()
        })
        pool = []
        owned.forEach((t) => t.dispose())
        owned = []
        sources = []
    }

    let generation = 0

    let ready = false
    let awaiting = 0
    let bootTimer: ReturnType<typeof setTimeout> | null = null

    function boot() {
        if (disposed || ready) return
        if (bootTimer !== null) {
            clearTimeout(bootTimer)
            bootTimer = null
        }
        ready = true
        recomputeTotal()

        scroll = centerForIndex(nearestIndex(scroll))
        target = scroll
        prevScroll = scroll
        if (!still && pp.entry.enabled) playEntry()
        else {
            entryActive = false
            entrySettled = false
        }
        if (still) frame()
    }

    function setItems(list: EngineItem[]) {
        if (disposed) return
        pp = getParams()
        disposeContent()
        const gen = ++generation
        ready = false
        if (bootTimer !== null) clearTimeout(bootTimer)
        awaiting = list.filter((item) => !!item.src).length

        bootTimer =
            awaiting > 0 ? setTimeout(boot, 6000) : null

        sources = list.map((item, i) => {
            const s: Source = {
                tex: null,
                aspect: item.aspect || 1,
                locked: item.aspect != null,
                ph: false,
            }
            if (!item.src) {
                s.ph = true
                s.tex = placeholderTexture(i, s.aspect, pp.cardColor)
                owned.push(s.tex)
                return s
            }
            loader.load(
                item.src,
                (tex) => {
                    if (disposed || gen !== generation) {
                        tex.dispose()
                        return
                    }

                    tex.minFilter = THREE.LinearMipmapLinearFilter
                    tex.magFilter = THREE.LinearFilter
                    tex.generateMipmaps = true
                    tex.anisotropy = renderer.capabilities.getMaxAnisotropy()
                    tex.colorSpace = THREE.SRGBColorSpace
                    if (!s.locked && tex.image)
                        s.aspect = tex.image.width / tex.image.height
                    s.tex = tex
                    owned.push(tex)

                    try {
                        renderer.initTexture(tex)
                    } catch {}
                    recomputeTotal()
                    if (--awaiting <= 0) boot()
                    else if (still) frame()
                },
                undefined,
                () => {
                    if (disposed || gen !== generation) return
                    s.ph = true
                    s.tex = placeholderTexture(i, s.aspect, pp.cardColor)
                    owned.push(s.tex)
                    if (--awaiting <= 0) boot()
                    else if (still) frame()
                }
            )
            return s
        })

        for (let r = 0; r < REPEATS; r++) {
            for (let i = 0; i < sources.length; i++) {
                const mat = new THREE.MeshBasicMaterial({
                    color: 0xdddddd,
                    transparent: true,
                })
                const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 1, 1), mat)
                mesh.visible = false
                scene.add(mesh)
                pool.push({ mesh, mat, srcIndex: i, bound: false })
            }
        }

        recomputeTotal()
        cardKey = pp.cardColor
        const n = pool.length
        drop = new Array(n).fill(0)
        pEntry = new Array(n).fill(1)
        growArr = new Array(n).fill(1)
        lastCenterX = new Array(n)
        focusState.active = false
        focusState.srcIndex = -1
        focusState.poolIdx = -1
        focusState.lensFx = 1
        focusZoom.v = 1
        velocity = 0
        scroll = centerForIndex(0)
        target = scroll
        prevScroll = scroll

        if (focusTl) focusTl.kill()
        focusTl = null
        if (entryTl) entryTl.kill()
        entryTl = null

        if (awaiting <= 0) boot()
    }

    function syncWindows() {
        for (let i = 0; i < sources.length; i++) {
            const tex = sources[i].tex
            if (!tex) continue
            const base = coverWindow(i)
            const t = clamp((pp.itemOffsets[i] ?? 0) / 250, -1, 1)
            const slack = 1 - base.ry
            tex.repeat.set(base.rx, base.ry)

            tex.offset.set(base.ox, slack * (0.5 + 0.5 * t))
        }
    }

    let cardKey = ""
    function syncCardColor() {
        if (pp.cardColor === cardKey) return
        cardKey = pp.cardColor
        sources.forEach((s, i) => {
            if (!s.ph) return
            const old = s.tex
            s.tex = placeholderTexture(i, s.aspect, pp.cardColor)
            owned.push(s.tex)
            if (old) {
                owned = owned.filter((t) => t !== old)
                old.dispose()
            }
            pool.forEach((p) => {
                if (p.srcIndex !== i) return
                p.mat.map = s.tex
                p.mat.needsUpdate = true
            })
        })
    }

    let panelRects: PanelRect[] = []
    let centeredPanel: {
        srcIndex: number
        centerX: number
        wPx: number
        h: number
        poolIdx: number
    } | null = null

    function layout() {
        panelRects = []
        centeredPanel = null
        let centeredDist = Infinity
        const N = sources.length
        if (!N || !totalWidth || !ready) {
            for (const p of pool) p.mesh.visible = false
            return
        }
        const half = W / 2
        const panelH = panelHeight()
        const buffer = panelH
        const E = pp.entry

        pool.forEach((p, poolIdx) => {
            const rep = Math.floor(poolIdx / N)
            const i = p.srcIndex
            const src = sources[i]

            const slotCenterInLoop = offsets[i] + slotWidth(i) / 2 - pp.gap / 2
            let x = slotCenterInLoop - scroll
            x = ((x % totalWidth) + totalWidth) % totalWidth
            x += (rep - Math.floor(REPEATS / 2)) * totalWidth
            if (x > half + totalWidth) x -= totalWidth * REPEATS

            const centerX = x
            const inEntry = entryActive || entrySettled
            if (!inEntry && (centerX < -half - buffer || centerX > half + buffer)) {
                p.mesh.visible = false
                lastCenterX[poolIdx] = undefined
                return
            }
            lastCenterX[poolIdx] = centerX

            const shrink = 1 - pp.shrinkMax * scrollEnergy
            const h = cardHeight(i) * shrink
            const wPx = widthAt(i, h)

            if (src.tex && !p.bound) {
                p.mat.map = src.tex
                p.mat.color.set(0xffffff)
                p.mat.needsUpdate = true
                p.bound = true
            }

            let y = 0

            const isFocused = focusState.active && focusState.poolIdx === poolIdx
            const d = drop[poolIdx] || 0
            let drawW = wPx
            let drawH = h
            if (isFocused) {
                drawW = wPx * focusZoom.v
                drawH = h * focusZoom.v
            } else if (d > 0) {
                y -= d * H * pp.focus.dropDist
            }

            p.mesh.visible = true

            let finalX = centerX
            let finalY = y
            let finalW = drawW
            let finalH = drawH

            if (inEntry) {
                const pe = pEntry[poolIdx] || 0
                const g = growArr[poolIdx] || 0

                const startH = Math.min(E.startH, panelH * 0.5)
                const curH = startH + (drawH - startH) * g
                finalH = curH
                finalW = widthAt(i, curH)

                const midRep = Math.floor(REPEATS / 2)
                if (rep !== midRep) {
                    p.mesh.visible = false
                    lastCenterX[poolIdx] = undefined
                    return
                }
                const cSrc = centerIndex(scroll)
                let di = i - cSrc
                if (di > N / 2) di -= N
                if (di < -N / 2) di += N
                const slotH = (s: number) => {
                    const gg = growArr[midRep * N + s] || 0
                    return startH + (cardHeight(s) - startH) * gg
                }
                let off = 0
                if (di > 0) {
                    for (let k = 0; k < di; k++) {
                        const sa = (((cSrc + k) % N) + N) % N
                        const sb = (((cSrc + k + 1) % N) + N) % N
                        off +=
                            (widthAt(sa, slotH(sa)) + widthAt(sb, slotH(sb))) /
                                2 +
                            pp.gap
                    }
                } else if (di < 0) {
                    for (let k = 0; k < -di; k++) {
                        const sa = (((cSrc - k) % N) + N) % N
                        const sb = (((cSrc - k - 1) % N) + N) % N
                        off -=
                            (widthAt(sa, slotH(sa)) + widthAt(sb, slotH(sb))) /
                                2 +
                            pp.gap
                    }
                }
                finalX = off
                if (finalX < -half - buffer || finalX > half + buffer) {
                    p.mesh.visible = false
                    lastCenterX[poolIdx] = undefined
                    return
                }

                const dir = E.pattern(i, N, di)
                const fromX = finalX + dir.x * W * E.travel
                const fromY = dir.y * H * E.travel
                finalX = fromX + (finalX - fromX) * pe
                finalY = fromY + (y - fromY) * pe
            }

            p.mesh.position.set(finalX, finalY, 0)
            p.mesh.scale.set(Math.max(1, finalW), Math.max(1, finalH), 1)

            const sx = centerX + W / 2
            const sy = H / 2 - y
            panelRects.push({
                left: sx - drawW / 2,
                right: sx + drawW / 2,
                top: sy - drawH / 2,
                bottom: sy + drawH / 2,
                poolIdx,
                srcIndex: i,
                centerX,
            })

            if (Math.abs(centerX) < centeredDist) {
                centeredDist = Math.abs(centerX)
                centeredPanel = { srcIndex: i, centerX, wPx, h, poolIdx }
            }
        })
    }

    function syncCaption() {
        const title = centeredPanel ? pp.labels[centeredPanel.srcIndex] ?? "" : ""
        if (caption.textContent !== title) caption.textContent = title
        caption.style.opacity = entryActive || entrySettled ? "0" : "1"
    }

    function panelAtPointer(px: number, py: number) {
        for (let i = 0; i < panelRects.length; i++) {
            const r = panelRects[i]
            if (px >= r.left && px <= r.right && py >= r.top && py <= r.bottom)
                return r
        }
        return null
    }

    let bounds = mount.getBoundingClientRect()
    const readBounds = () => {
        bounds = mount.getBoundingClientRect()
    }

    let dragging = false
    let dragPointerId: number | null = null
    let dragLastX = 0
    let dragDist = 0
    let dragVel = 0
    let dragMoveT = 0
    let suppressClick = false
    let dragPointerType = "mouse"
    let lastPointerX = NaN
    let lastPointerY = NaN
    let pointerInside = false
    let lastPointerType = "mouse"

    let hoverPanel = false
    let hoverFocused = false

    let cursorNow = ""
    function setCursor(v: string) {
        if (v === cursorNow) return
        cursorNow = v
        el.style.cursor = v
    }

    function updateCursor() {
        if (entryActive || entrySettled) return setCursor("")

        if (focusState.active) {
            return setCursor(hoverFocused ? "" : "zoom-out")
        }
        if (dragging) return setCursor("grabbing")
        if (!hoverPanel) return setCursor("")
        if (pp.drag) return setCursor("grab")
        return setCursor(pp.clickToFocus ? "pointer" : "")
    }

    function setHover(on: boolean) {
        hoverPanel = on
        updateCursor()
    }

    function refreshHover() {
        if (!pointerInside || lastPointerType !== "mouse") return
        if (!Number.isFinite(lastPointerX)) return
        if (focusState.active) {
            const on = panelAtPointer(lastPointerX, lastPointerY)
            hoverFocused = !!on && on.poolIdx === focusState.poolIdx
            setHover(false)
            return
        }
        hoverFocused = false
        setHover(panelAtPointer(lastPointerX, lastPointerY) !== null)
    }

    function inputLocked() {
        return focusState.active || entryActive || entrySettled
    }

    function onWheel(e: WheelEvent) {
        if (!pp.wheel) return
        e.preventDefault()
        if (inputLocked()) return
        pendingFocus = null
        target += (e.deltaY || e.deltaX) * pp.wheelSpeed
        lastInput = performance.now()
        snapped = false
    }

    function onPointerDown(e: PointerEvent) {
        suppressClick = false
        readBounds()
        if (!pp.drag || inputLocked()) return
        if (dragging) return
        if (e.button !== 0 && e.pointerType === "mouse") return
        dragging = true
        dragPointerId = e.pointerId
        dragPointerType = e.pointerType || "mouse"
        try {
            el.setPointerCapture(e.pointerId)
        } catch {}
        dragLastX = e.clientX
        lastPointerX = e.clientX - bounds.left
        lastPointerY = e.clientY - bounds.top
        dragDist = 0
        dragVel = 0
        dragMoveT = performance.now()
        updateCursor()
        velocity = 0
        pendingFocus = null
        snapped = false
        lastInput = dragMoveT
    }

    function onPointerMove(e: PointerEvent) {
        if (dragging && e.pointerId === dragPointerId) {
            const sens =
                dragPointerType === "mouse" ? pp.dragSpeed : pp.touchDrag
            const dx = e.clientX - dragLastX
            dragLastX = e.clientX
            dragDist += Math.abs(dx)
            target -= dx * sens

            dragVel = dragVel * 0.6 + -dx * sens * 0.4
            dragMoveT = performance.now()
            lastInput = dragMoveT
            snapped = false
        }
        lastPointerX = e.clientX - bounds.left
        lastPointerY = e.clientY - bounds.top
        lastPointerType = e.pointerType || "mouse"
        pointerInside = true

        if (e.pointerType !== "mouse") return
        if (focusState.active) {
            setHover(false)
            return
        }
        setHover(panelAtPointer(lastPointerX, lastPointerY) !== null)
    }

    function onPointerUp(e?: PointerEvent) {
        if (!dragging) return

        if (e && dragPointerId !== null && e.pointerId !== dragPointerId) return
        dragging = false
        if (dragPointerId !== null) {
            try {
                el.releasePointerCapture(dragPointerId)
            } catch {}
            dragPointerId = null
        }

        velocity =
            performance.now() - dragMoveT > pp.flickIdleMs ? 0 : dragVel
        dragVel = 0
        lastInput = performance.now()
        snapped = false
        suppressClick =
            dragDist >
            (dragPointerType === "mouse" ? pp.clickSlop : pp.touchClickSlop)
        if (dragPointerType === "mouse")
            setHover(panelAtPointer(lastPointerX, lastPointerY) !== null)
        else updateCursor()
    }

    function onEnter(e: PointerEvent) {
        pointerInside = true
        lastPointerType = e.pointerType || "mouse"
        readBounds()
    }

    function onLeave() {
        pointerInside = false
        setHover(false)
    }

    function onKeyDown(e: KeyboardEvent) {
        if (document.activeElement !== mount || inputLocked()) return
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
            e.preventDefault()
            target = centerForIndex(nearestIndex(target) + (e.key === "ArrowRight" ? 1 : -1))
            snapped = true
            return
        }
        if ((e.key === "Enter" || e.key === " ") && centeredPanel && pp.onSelect) {
            e.preventDefault()
            const hit = panelRects.find(r => r.poolIdx === centeredPanel?.poolIdx)
            if (hit) pp.onSelect(hit.srcIndex, { left: bounds.left + hit.left, top: bounds.top + hit.top, width: hit.right - hit.left, height: hit.bottom - hit.top })
            return
        }
        if (e.key !== "Escape" || !focusState.active) return
        e.preventDefault()
        closeFocus()
    }

    function onClick(e: MouseEvent) {
        if (!pp.clickToFocus) return
        if (suppressClick) {
            suppressClick = false
            return
        }

        if (focusState.active) {
            const on = panelAtPointer(
                e.clientX - bounds.left,
                e.clientY - bounds.top
            )
            if (!on || on.poolIdx !== focusState.poolIdx) closeFocus()
            return
        }
        if (inputLocked()) return
        const hit = panelAtPointer(e.clientX - bounds.left, e.clientY - bounds.top)
        if (!hit) return
        if (pp.onSelect) {
            velocity = 0
            target = scroll
            pp.onSelect(hit.srcIndex, { left: bounds.left + hit.left, top: bounds.top + hit.top, width: hit.right - hit.left, height: hit.bottom - hit.top })
            return
        }

        if (centeredPanel && hit.poolIdx === centeredPanel.poolIdx) {
            pendingFocus = null
            openFocus()
            return
        }
        velocity = 0
        target = centerForIndex(nearestIndex(scroll + hit.centerX))
        snapped = true
        pendingFocus = { srcIndex: hit.srcIndex }
        updateCursor()
    }

    function openFocus() {
        if (focusState.active || !centeredPanel) return
        const F = pp.focus
        const panel = centeredPanel
        const src = sources[panel.srcIndex]
        if (!src || !src.tex) return

        focusState.active = true
        closing = false
        focusState.srcIndex = panel.srcIndex
        focusState.poolIdx = panel.poolIdx

        target = centerForIndex(nearestIndex(scroll))

        const focusX = lastCenterX[panel.poolIdx] || 0
        const others = pool
            .map((p, idx) => ({ idx, x: lastCenterX[idx] }))
            .filter((o) => o.idx !== panel.poolIdx && o.x !== undefined)
            .map((o) => ({ idx: o.idx, dist: Math.abs((o.x as number) - focusX) }))
            .sort((a, b) => a.dist - b.dist)

        let rank = 0
        let prevDist = -1
        const ranked = others.map((o) => {
            if (prevDist >= 0 && o.dist - prevDist > 1) rank++
            prevDist = o.dist
            return { idx: o.idx, rank }
        })

        if (focusTl) focusTl.kill()
        const tl = new Timeline()
        tl.to(focusState as unknown as NumBag, "lensFx", 0, F.lensFade, OUT3, 0)
        tl.to(focusZoom, "v", F.centerScale, F.focusDuration, F.ease, 0)
        ranked.forEach((o) => {
            tl.to(bag(drop), o.idx, 1, F.cardDuration, F.ease, o.rank * F.stagger)
        })
        focusTl = tl

        updateCursor()
    }

    function closeFocus() {
        if (!focusState.active || closing) return
        closing = true
        const F = pp.focus
        if (focusTl) focusTl.kill()

        const focusX = lastCenterX[focusState.poolIdx] || 0
        const others = pool
            .map((p, idx) => ({ idx, x: lastCenterX[idx] }))
            .filter((o) => o.x !== undefined && (drop[o.idx] || 0) > 0)
            .map((o) => ({ idx: o.idx, dist: Math.abs((o.x as number) - focusX) }))
            .sort((a, b) => b.dist - a.dist)

        let rank = 0
        let prevDist = -1
        const ranked = others.map((o) => {
            if (prevDist >= 0 && prevDist - o.dist > 1) rank++
            prevDist = o.dist
            return { idx: o.idx, rank }
        })

        const tl = new Timeline()
        tl.to(
            focusState as unknown as NumBag,
            "lensFx",
            1,
            F.lensFade * 0.8,
            INOUT3,
            0
        )
        tl.to(focusZoom, "v", 1, F.focusDuration * 0.85, F.ease, 0)
        let end = Math.max(F.lensFade * 0.8, F.focusDuration * 0.85)
        ranked.forEach((o) => {
            const at = o.rank * F.stagger * 0.7
            end = Math.max(end, at + F.cardDuration * 0.85)
            tl.to(bag(drop), o.idx, 0, F.cardDuration * 0.85, F.ease, at)
        })
        tl.call(() => {
            focusState.active = false
            focusState.srcIndex = -1
            focusState.poolIdx = -1
            closing = false
            updateCursor()
        }, end)
        focusTl = tl
    }

    function playEntry() {
        if (!sources.length) return
        const E = pp.entry
        if (entryTl) entryTl.kill()
        const N = sources.length
        for (let k = 0; k < pEntry.length; k++) pEntry[k] = 0
        for (let k = 0; k < growArr.length; k++) growArr[k] = 0
        entryActive = true
        entrySettled = false
        focusState.lensFx = 0

        target = centerForIndex(nearestIndex(scroll))
        scroll = target
        velocity = 0
        snapped = true

        layout()
        const visible: number[] = []
        for (let k = 0; k < lastCenterX.length; k++) {
            if (lastCenterX[k] !== undefined) visible.push(k)
        }

        const tl = new Timeline(E.delay)

        const spread = E.stagger * Math.max(visible.length - 1, 1)
        let lastRiseEnd = 0
        visible.forEach((idx) => {
            const at = Math.random() * spread
            lastRiseEnd = Math.max(lastRiseEnd, at + E.riseDuration)
            tl.to(bag(pEntry), idx, 1, E.riseDuration, E.ease, at)
        })

        tl.call(() => {
            entryActive = false
            entrySettled = true
        }, lastRiseEnd)

        const cSrcG = centerIndex(scroll)
        const midRepG = Math.floor(REPEATS / 2)
        const growList: { idx: number; rank: number }[] = []
        let maxRank = 0
        for (let k = 0; k < lastCenterX.length; k++) {
            if (lastCenterX[k] === undefined) continue
            if (Math.floor(k / N) !== midRepG) continue
            let di = (k % N) - cSrcG
            if (di > N / 2) di -= N
            if (di < -N / 2) di += N
            const r = Math.abs(di)
            maxRank = Math.max(maxRank, r)
            growList.push({ idx: k, rank: r })
        }

        const growStart = lastRiseEnd + E.growDelay
        let growEnd = growStart

        tl.to(
            focusState as unknown as NumBag,
            "lensFx",
            1,
            E.lensBloom,
            INOUT2,
            growStart
        )

        growList.forEach((o) => {
            const rank = E.outward ? o.rank : maxRank - o.rank
            const at = growStart + rank * E.growStagger
            growEnd = Math.max(growEnd, at + E.growDuration)
            tl.to(bag(growArr), o.idx, 1, E.growDuration, EXPO_INOUT, at)
        })

        tl.call(() => {
            entrySettled = false
            for (let k = 0; k < growArr.length; k++) growArr[k] = 1
            updateCursor()
        }, growEnd)
        entryTl = tl
    }

    let raf = 0
    let lastT = performance.now()

    function step(dt: number) {
        pp = getParams()
        applyClear()
        const now = performance.now()

        const f = clamp(dt * 60, 0.1, 4)
        const lerp = (k: number) => 1 - Math.pow(1 - clamp01(k), f)

        if (entryTl) entryTl.step(dt)
        if (focusTl) focusTl.step(dt)

        if (!dragging) {
            target += velocity * f
            velocity *= Math.pow(pp.friction, f)
            if (Math.abs(velocity) < 0.05) velocity = 0

            if (
                pp.snap &&
                !snapped &&
                !focusState.active &&
                now - lastInput > pp.snapIdleMs
            ) {
                target = centerForIndex(nearestIndex(scroll))
                snapped = true
            }
        }

        const base =
            dragging && dragPointerType !== "mouse"
                ? pp.touchEase
                : snapped && !pendingFocus
                  ? pp.snapEase
                  : pp.ease
        scroll += (target - scroll) * lerp(base)

        const rawSpeed = (scroll - prevScroll) / f
        prevScroll = scroll
        const norm = Math.min(1, Math.abs(rawSpeed) / Math.max(1, pp.shrinkSpeed))
        const k = norm > scrollEnergy ? pp.shrinkAttack : pp.shrinkDecay
        scrollEnergy += (norm - scrollEnergy) * lerp(k)

        syncCardColor()
        syncWindows()
        layout()
        refreshHover()

        if (pendingFocus && !focusState.active) {
            if (Math.abs(target - scroll) < 0.5) {
                const pf = pendingFocus
                pendingFocus = null
                if (centeredPanel && centeredPanel.srcIndex === pf.srcIndex)
                    openFocus()
            }
        }

        syncCaption()
        syncLens(now)
        draw()
    }

    function draw() {
        if (pp.lens.enabled) {
            renderer.setRenderTarget(rt)
            renderer.render(scene, camera)
            renderer.setRenderTarget(null)
            renderer.render(lensScene, lensCam)
        } else {
            renderer.setRenderTarget(null)
            renderer.render(scene, camera)
        }
    }

    let frameReq = 0
    function paintOnce() {
        if (disposed) return
        pp = getParams()
        applyClear()
        syncCardColor()
        syncWindows()
        layout()
        syncCaption()
        syncLens(performance.now())
        draw()
    }
    function frame() {
        if (disposed || !still) return
        if (frameReq) return
        frameReq = requestAnimationFrame(() => {
            frameReq = 0
            paintOnce()
        })
    }

    function tick(t: number) {
        raf = requestAnimationFrame(tick)
        const dt = Math.min(0.05, Math.max(0, (t - lastT) / 1000))
        lastT = t
        step(dt)
    }

    function resize() {
        const nw = Math.max(1, mount.clientWidth)
        const nh = Math.max(1, mount.clientHeight)
        if (nw === W && nh === H) return
        W = nw
        H = nh
        renderer.setSize(W, H)
        camera.left = -W / 2
        camera.right = W / 2
        camera.top = H / 2
        camera.bottom = -H / 2
        camera.updateProjectionMatrix()
        rt.setSize(Math.max(1, Math.round(W * dpr)), Math.max(1, Math.round(H * dpr)))
        lensU.uRes.value.set(W * dpr, H * dpr)
        readBounds()
    }

    const ro = new ResizeObserver(() => {
        resize()
        if (still) frame()
    })
    ro.observe(mount)

    if (!still) {
        el.addEventListener("wheel", onWheel, { passive: false })
        el.addEventListener("pointerdown", onPointerDown)
        el.addEventListener("pointermove", onPointerMove)
        el.addEventListener("pointerup", onPointerUp)
        el.addEventListener("pointercancel", onPointerUp)
        el.addEventListener("pointerenter", onEnter)
        el.addEventListener("pointerleave", onLeave)
        el.addEventListener("click", onClick)
        window.addEventListener("keydown", onKeyDown)
        window.addEventListener("scroll", readBounds, { passive: true })
        window.addEventListener("resize", readBounds)
        raf = requestAnimationFrame(tick)
    }

    function destroy() {
        disposed = true
        if (bootTimer !== null) clearTimeout(bootTimer)
        if (frameReq) cancelAnimationFrame(frameReq)
        cancelAnimationFrame(raf)
        ro.disconnect()
        caption.remove()
        el.removeEventListener("wheel", onWheel)
        el.removeEventListener("pointerdown", onPointerDown)
        el.removeEventListener("pointermove", onPointerMove)
        el.removeEventListener("pointerup", onPointerUp)
        el.removeEventListener("pointercancel", onPointerUp)
        el.removeEventListener("pointerenter", onEnter)
        el.removeEventListener("pointerleave", onLeave)
        el.removeEventListener("click", onClick)
        window.removeEventListener("keydown", onKeyDown)
        window.removeEventListener("scroll", readBounds)
        window.removeEventListener("resize", readBounds)
        if (focusTl) focusTl.kill()
        if (entryTl) entryTl.kill()
        disposeContent()
        rt.dispose()
        lensQuad.geometry.dispose()
        lensMat.dispose()

        renderer.dispose()
        renderer.forceContextLoss()
        if (el.parentNode) el.parentNode.removeChild(el)
    }

    return { setItems, closeFocus, replayEntry: playEntry, frame, destroy }
}

type Engine = ReturnType<typeof createEngine>

interface ResolvedItem {
    src: string
    aspect: number | null
}

function resolveItems(items?: ItemValue[]): ResolvedItem[] {
    const list = (items ?? []).filter(Boolean)
    if (!list.length) {
        return PLACEHOLDER_ASPECTS.map((a) => ({ src: "", aspect: a }))
    }
    return list.map((it, i) => {
        const src = srcOf(imageOf(it))
        return {
            src,

            aspect: src ? null : PLACEHOLDER_ASPECTS[i % PLACEHOLDER_ASPECTS.length],
        }
    })
}

function BaseLiquidGlassCarousel(props: LiquidGlassCarouselProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const engineRef = useRef<Engine | null>(null)

    const paramsRef = useRef<Params>(makeParams(props))
    paramsRef.current = makeParams(props)

    const itemsKey = (props.items ?? [])
        .map((it) => srcOf(imageOf(it)))
        .join("~")
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const items = useMemo(() => resolveItems(props.items), [itemsKey])

    useEffect(() => {
        const container = containerRef.current
        if (!container) return
        let engine: Engine | null = null
        try {
            engine = createEngine(container, () => paramsRef.current)
        } catch {
            return
        }
        engineRef.current = engine
        return () => {
            engineRef.current = null
            engine?.destroy()
        }
    }, [])

    useEffect(() => {
        engineRef.current?.setItems(
            items.map((i) => ({ src: i.src, aspect: i.aspect }))
        )
    }, [items])

    const entryArmed = useRef(false)
    useEffect(() => {
        if (!entryArmed.current) {
            entryArmed.current = true
            return
        }
        if (props.entry?.enabled !== false) engineRef.current?.replayEntry()
    }, [props.entry?.enabled])

    useEffect(() => {
        engineRef.current?.frame()
    })

    return (
        <div
            ref={containerRef}
            role="region"
            aria-label="作品液态玻璃轮播，左右方向键浏览，回车播放"
            tabIndex={0}
            style={{
                position: "relative",
                width: "100%",
                height: "100%",
                overflow: "hidden",

                touchAction: "none",
                background: paramsRef.current.background,
                ...props.style,
            }}
        >
        </div>
    )
}

LiquidGlassCarousel.displayName = "Liquid Glass Carousel"

const __originkitPresetProps = {
  "background": "#FFFFFF00"
};

export default function LiquidGlassCarousel(props: LiquidGlassCarouselProps) {
  return <BaseLiquidGlassCarousel {...(__originkitPresetProps as Record<string, unknown>)} {...props} />;
}