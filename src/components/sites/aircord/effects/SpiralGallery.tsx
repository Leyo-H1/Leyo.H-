"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { PlayerOrigin } from "../PortfolioDialog";
import styles from "./SpiralGallery.module.css";

type Props = {
  images: string[];
  labels: string[];
  portrait: boolean;
  paused: boolean;
  reducedMotion: boolean;
  onSelect: (index: number, origin: PlayerOrigin) => void;
};

const slots = Array.from({ length: 15 }, (_, index) => index);
const wrap = (value: number, length: number) => ((value % length) + length) % length;
const vertexShader = `
  varying vec2 vUv;
  uniform float uBend;
  uniform float uHover;
  uniform vec2 uPointer;
  void main() {
    vUv = uv;
    vec3 p = position;
    p.z += uBend * p.x * p.x;
    float lens = exp(-9.0 * dot(uv - uPointer, uv - uPointer));
    p.z += uHover * lens * 0.065;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;
const fragmentShader = `
  uniform sampler2D uMap;
  uniform float uReady;
  uniform float uOpacity;
  uniform float uHover;
  uniform float uAspect;
  uniform vec2 uPointer;
  varying vec2 vUv;
  void main() {
    vec2 p = (vUv - .5) * vec2(uAspect, 1.0);
    vec2 bounds = vec2(uAspect, 1.0) * .5;
    vec2 q = abs(p) - bounds + .035;
    float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - .035;
    float mask = 1.0 - smoothstep(-.002, .002, d);
    if (mask < .01) discard;
    vec2 delta = vUv - uPointer;
    float lens = exp(-12.0 * dot(delta, delta));
    // Local refraction only: the image keeps its colour and overall geometry.
    vec2 uv = clamp(vUv + delta * lens * uHover * .022, .001, .999);
    vec4 photo = texture2D(uMap, uv);
    vec3 color = mix(vec3(.955, .96, .955), photo.rgb, uReady);
    float rim = 1.0 - smoothstep(.002, .012, abs(d));
    color = mix(color, vec3(.96, .975, .97), rim * (.34 + .22 * uHover));
    color += uHover * lens * .022;
    gl_FragColor = vec4(color, mask * uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function SpiralGallery({ images, labels, portrait, paused, reducedMotion, onSelect }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const slider = useRef<HTMLInputElement>(null);
  const options = useRef({ paused, reducedMotion, onSelect });
  const controls = useRef({ target: 0, position: 0, hover: -1, focus: -1, dragging: false, lastInput: 0 });
  const origins = useRef<(PlayerOrigin & { index: number })[]>([]);
  const [hovered, setHovered] = useState<number | null>(null);
  const [fallback, setFallback] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => { options.current = { paused, reducedMotion, onSelect }; }, [paused, reducedMotion, onSelect]);
  useEffect(() => {
    if (!paused) {
      controls.current.hover = -1;
      controls.current.focus = -1;
      controls.current.lastInput = performance.now();
    }
  }, [paused]);

  useEffect(() => {
    const host = canvasHost.current;
    const element = root.current;
    if (!host || !element || !images.length) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
    } catch {
      const fallbackFrame = requestAnimationFrame(() => setFallback(true));
      return () => cancelAnimationFrame(fallbackFrame);
    }
    let disposed = false;
    let frame = 0;
    let last = 0;
    let width = 1;
    let height = 1;
    let speed = 0;
    let sampledTime = 0;
    let sampledFrames = 0;
    let slowFrames = 0;
    let namedIndex = -1;
    const state = controls.current;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, .1, 60);
    camera.position.z = portrait ? 10.2 : 8.5;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0xffffff, 0);
    renderer.domElement.setAttribute("aria-hidden", "true");
    host.appendChild(renderer.domElement);
    const cardWidth = portrait ? 1.72 : 3.15;
    const cardHeight = portrait ? 3.06 : 1.772;
    const pitch = portrait ? 1.16 : .96;
    const geometry = new THREE.PlaneGeometry(cardWidth, cardHeight, 36, 12);
    const blank = new THREE.DataTexture(new Uint8Array([245, 247, 245, 255]), 1, 1);
    blank.needsUpdate = true;
    const textures: (THREE.Texture | null)[] = images.map(() => null);
    let settled = 0;
    const loader = new THREE.TextureLoader();
    images.forEach((src, index) => loader.load(src, texture => {
      if (disposed) { texture.dispose(); return; }
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      textures[index] = texture;
      if (++settled === images.length) setLoaded(true);
    }, undefined, () => {
      if (!disposed && ++settled === images.length) setLoaded(true);
    }));
    const meshes = slots.map(() => {
      const material = new THREE.ShaderMaterial({
        vertexShader, fragmentShader, transparent: true, side: THREE.DoubleSide,
        uniforms: {
          uMap: { value: blank }, uReady: { value: 0 }, uOpacity: { value: 0 },
          uBend: { value: 0 }, uHover: { value: 0 }, uAspect: { value: cardWidth / cardHeight },
          uPointer: { value: new THREE.Vector2(.5, .5) },
        },
      });
      const mesh = new THREE.Mesh(geometry, material);
      scene.add(mesh);
      return mesh;
    });
    const corner = new THREE.Vector3();
    const localCorners = [[-1, 1], [1, 1], [1, -1], [-1, -1]];
    const resize = () => {
      width = element.clientWidth;
      height = element.clientHeight;
      camera.aspect = width / Math.max(1, height);
      camera.position.z = portrait ? 10.2 : 8.5;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      renderer.setSize(width, height);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    const tick = (time: number) => {
      frame = requestAnimationFrame(tick);
      const dt = Math.min((time - (last || time)) / 1000, .04);
      const elapsed = time - (last || time);
      last = time;
      if (document.hidden || options.current.paused) return;
      sampledTime += elapsed;
      sampledFrames++;
      if (elapsed > 34) slowFrames++;
      if (sampledTime >= 2000) {
        element.dataset.frameMs = (sampledTime / sampledFrames).toFixed(2);
        element.dataset.slowFrames = `${slowFrames}/${sampledFrames}`;
        sampledTime = 0; sampledFrames = 0; slowFrames = 0;
      }
      const resting = state.hover < 0 && state.focus < 0 && !state.dragging && time - state.lastInput > 1300;
      speed = THREE.MathUtils.damp(speed, resting && !options.current.reducedMotion ? .105 : 0, 5, dt);
      state.target += speed * dt;
      state.position = options.current.reducedMotion ? state.target : THREE.MathUtils.damp(state.position, state.target, 9, dt);
      const base = Math.floor(state.position);
      const rect = element.getBoundingClientRect();
      meshes.forEach((mesh, slot) => {
        const sequence = base + slot - 7;
        const offset = sequence - state.position;
        const index = wrap(sequence, images.length);
        const theta = offset * .98;
        const front = Math.cos(theta);
        const active = state.hover === slot || state.focus === slot;
        const material = mesh.material;
        material.uniforms.uHover.value = THREE.MathUtils.damp(material.uniforms.uHover.value, active ? 1 : 0, 7, dt);
        const pointer = material.uniforms.uPointer.value as THREE.Vector2;
        const follow = material.uniforms.uHover.value;
        const radius = width < 700 ? (portrait ? 1.35 : 1.65) : (portrait ? 2.3 : 2.95);
        // On phones reduce the footprint as a whole, keeping every card in view.
        const scale = width < 700 ? Math.min(1, camera.aspect / (portrait ? .8 : 1.15)) : 1;
        mesh.scale.setScalar(scale);
        mesh.position.set((Math.sin(theta) * radius + (width > 700 ? .38 : 0) + (pointer.x - .5) * follow * .11) * scale,
          (offset * pitch + (pointer.y - .5) * follow * .08) * scale, (front - 1) * radius + follow * .06);
        mesh.rotation.set((pointer.y - .5) * follow * .025, theta + (pointer.x - .5) * follow * .035, Math.sin(theta) * .035);
        material.uniforms.uBend.value = -.022 - (1 - front) * .045;
        material.uniforms.uMap.value = textures[index] ?? blank;
        material.uniforms.uReady.value = THREE.MathUtils.damp(material.uniforms.uReady.value, textures[index] ? 1 : 0, 9, dt);
        // No blur, pixelation, or dark overlay on the receding works.
        const edge = 1 - THREE.MathUtils.smoothstep(Math.abs(offset), 5.8, 7);
        material.uniforms.uOpacity.value = (.76 + .24 * Math.max(0, front)) * edge;
        mesh.updateMatrixWorld();
        const corners = localCorners.map(([x, y]) => {
          corner.set(x * cardWidth / 2, y * cardHeight / 2, material.uniforms.uBend.value * cardWidth * cardWidth / 4);
          corner.applyMatrix4(mesh.matrixWorld).project(camera);
          return { x: (corner.x * .5 + .5) * width, y: (-corner.y * .5 + .5) * height };
        });
        const left = Math.min(...corners.map(p => p.x));
        const top = Math.min(...corners.map(p => p.y));
        const w = Math.max(...corners.map(p => p.x)) - left;
        const h = Math.max(...corners.map(p => p.y)) - top;
        origins.current[slot] = { index, left: left + rect.left, top: top + rect.top, width: w, height: h,
          corners: corners.map(p => ({ x: p.x + rect.left, y: p.y + rect.top })) };
        const button = buttons.current[slot];
        if (button) {
          button.style.transform = `translate3d(${left}px,${top}px,0)`;
          button.style.width = `${w}px`;
          button.style.height = `${h}px`;
          button.style.clipPath = `polygon(${corners.map(p => `${(p.x - left) / w * 100}% ${(p.y - top) / h * 100}%`).join(",")})`;
          button.style.zIndex = String(Math.round((front + 1) * 100));
          const visible = front > .08 && edge > .1 && top + h > 0 && top < height;
          button.style.visibility = visible ? "visible" : "hidden";
          button.tabIndex = visible ? 0 : -1;
          button.setAttribute("aria-label", `播放${labels[index]}`);
          button.dataset.projectIndex = String(index);
        }
      });
      const namedSlot = state.hover >= 0 ? state.hover : state.focus >= 0 && state.focus < slots.length ? state.focus : -1;
      const nextName = namedSlot >= 0 ? origins.current[namedSlot]?.index ?? -1 : -1;
      if (nextName !== namedIndex) { namedIndex = nextName; setHovered(nextName >= 0 ? nextName : null); }
      if (slider.current && !state.dragging) slider.current.value = String(wrap(state.position, images.length));
      element.dataset.position = state.position.toFixed(4);
      renderer.render(scene, camera);
    };
    frame = requestAnimationFrame(tick);
    const wheel = (event: WheelEvent) => {
      if (options.current.paused) return;
      event.preventDefault();
      const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1;
      state.target += THREE.MathUtils.clamp(event.deltaY * multiplier, -200, 200) / 370;
      state.lastInput = performance.now();
    };
    let touchY: number | null = null;
    const touchStart = (event: TouchEvent) => { touchY = event.touches[0]?.clientY ?? null; };
    const touchMove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY;
      if (y == null || touchY == null || options.current.paused) return;
      event.preventDefault();
      state.hover = -1;
      setHovered(null);
      state.target += (touchY - y) / 240;
      state.lastInput = performance.now();
      touchY = y;
    };
    element.addEventListener("wheel", wheel, { passive: false });
    element.addEventListener("touchstart", touchStart, { passive: true });
    element.addEventListener("touchmove", touchMove, { passive: false });
    const contextLost = (event: Event) => { event.preventDefault(); setFallback(true); };
    renderer.domElement.addEventListener("webglcontextlost", contextLost);
    // DOM hit targets follow the projected cards, so keyboard and pointer select
    // exactly the same work without a second continuously animated DOM gallery.
    const pointerMove = (event: PointerEvent) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-spiral-slot]");
      if (!button) return;
      const slot = Number(button.dataset.spiralSlot);
      const rect = button.getBoundingClientRect();
      (meshes[slot].material.uniforms.uPointer.value as THREE.Vector2).set(
        THREE.MathUtils.clamp((event.clientX - rect.left) / rect.width, 0, 1),
        1 - THREE.MathUtils.clamp((event.clientY - rect.top) / rect.height, 0, 1));
    };
    element.addEventListener("pointermove", pointerMove);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      element.removeEventListener("wheel", wheel);
      element.removeEventListener("touchstart", touchStart);
      element.removeEventListener("touchmove", touchMove);
      element.removeEventListener("pointermove", pointerMove);
      renderer.domElement.removeEventListener("webglcontextlost", contextLost);
      meshes.forEach(mesh => mesh.material.dispose());
      textures.forEach(texture => texture?.dispose());
      geometry.dispose(); blank.dispose(); renderer.dispose(); renderer.domElement.remove();
    };
  }, [images, labels, portrait]);

  const select = (slot: number) => {
    const source = origins.current[slot];
    if (!source) return;
    const state = controls.current;
    state.target = state.position;
    state.hover = slot;
    options.current.onSelect(source.index, source);
  };
  return <div ref={root} className={styles.gallery} data-ready={loaded} role="region" aria-label="纵向螺旋作品预览"
    onKeyDown={event => {
      if (event.target === slider.current) return;
      if (["ArrowDown", "ArrowUp", "PageDown", "PageUp"].includes(event.key)) {
        event.preventDefault();
        controls.current.target += event.key === "ArrowDown" || event.key === "PageDown" ? 1 : -1;
        controls.current.lastInput = performance.now();
      }
    }}>
    <div ref={canvasHost} className={styles.canvas} />
    {!fallback && <div className={styles.hits}>{slots.map(slot => <button key={slot}
      ref={node => { buttons.current[slot] = node; }} className={styles.hit} data-spiral-slot={slot}
      aria-label="浏览作品" onClick={() => select(slot)}
      onPointerEnter={event => {
        if (event.pointerType === "touch") return;
        controls.current.hover = slot;
        controls.current.target = controls.current.position;
        setHovered(origins.current[slot]?.index ?? null);
      }}
      onPointerLeave={() => { controls.current.hover = -1; setHovered(null); }}
      onFocus={() => { controls.current.focus = slot; controls.current.target = controls.current.position; setHovered(origins.current[slot]?.index ?? null); }}
      onBlur={() => { controls.current.focus = -1; setHovered(null); }}
    />)}</div>}
    <div className={styles.name} aria-live="polite" data-visible={hovered !== null}>{hovered !== null ? labels[hovered] : ""}</div>
    {!fallback && <div className={styles.sliderWrap}><input ref={slider} className={styles.slider} type="range"
      aria-label="纵向浏览作品" min={0} max={images.length} step="0.001" defaultValue={0}
      onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); controls.current.dragging = true; }}
      onPointerUp={() => { controls.current.dragging = false; controls.current.lastInput = performance.now(); }}
      onPointerCancel={() => { controls.current.dragging = false; }}
      onFocus={() => { controls.current.focus = 99; }} onBlur={() => { controls.current.focus = -1; }}
      onKeyDown={event => {
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          controls.current.target += event.key === "ArrowUp" ? 1 : -1;
          controls.current.lastInput = performance.now();
        }
      }}
      onChange={event => {
        const state = controls.current;
        state.target = Math.floor(state.position / images.length) * images.length + Number(event.currentTarget.value);
        state.lastInput = performance.now();
      }} /></div>}
    {fallback && <div className={styles.fallback}>{images.map((src, index) => <button key={src} onClick={event => onSelect(index, event.currentTarget.getBoundingClientRect())}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={labels[index]} /><span>{labels[index]}</span>
    </button>)}</div>}
  </div>;
}
