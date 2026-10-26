"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { PlayerOrigin } from "../PortfolioDialog";
import styles from "./CurvedGallery.module.css";

type Props = {
  images: string[];
  labels: string[];
  portrait: boolean;
  paused: boolean;
  reducedMotion: boolean;
  onSelect: (index: number, origin: PlayerOrigin) => void;
  onFeedback: (kind: "click") => void;
  onMotion: (velocity: number) => void;
  onMotionEnd: () => void;
};

const slots = Array.from({ length: 11 }, (_, index) => index);
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
    float innerRim = (1.0 - smoothstep(.001, .004, abs(d + .014))) * .2;
    float bevelLight = .5 + .5 * dot(normalize(p + vec2(.0001)), normalize(vec2(-.6, .8)));
    color = mix(color, vec3(.98, .99, .985), rim * (.36 + .24 * bevelLight + .16 * uHover));
    color *= 1.0 - innerRim * (1.0 - bevelLight);
    color += uHover * lens * .022;
    gl_FragColor = vec4(color, mask * uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
const shadowFragment = `
  uniform float uOpacity;
  uniform float uAspect;
  varying vec2 vUv;
  void main() {
    vec2 p = (vUv - .5) * vec2(uAspect, 1.0);
    vec2 q = abs(p) - vec2(uAspect, 1.0) * .5 + .065;
    float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - .035;
    float alpha = (1.0 - smoothstep(-.025, .035, d)) * .13 * uOpacity;
    gl_FragColor = vec4(.2, .26, .22, alpha);
    #include <colorspace_fragment>
  }
`;

type Drag = {
  id: number; kind: "gallery" | "slider"; startX: number; startY: number;
  anchor: number; slot: number; moved: boolean; lastX: number; lastTime: number; velocity: number; travel: number;
};

export function CurvedGallery({ images, labels, portrait, paused, reducedMotion, onSelect, onFeedback, onMotion, onMotionEnd }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const caption = useRef<HTMLDivElement>(null);
  const slider = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLSpanElement>(null);
  const options = useRef({ paused, reducedMotion, onSelect, onFeedback, onMotion, onMotionEnd });
  const controls = useRef({ target: 0, position: 0, hover: -1, pointerSlot: -1, hoverLockUntil: 0, focus: -1, lastInput: 0, motionInput: false, drag: null as Drag | null });
  const origins = useRef<(PlayerOrigin & { index: number })[]>([]);
  const select = useRef<(slot: number) => void>(() => {});
  const [hovered, setHovered] = useState<number | null>(null);
  const [fallback, setFallback] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => { options.current = { paused, reducedMotion, onSelect, onFeedback, onMotion, onMotionEnd }; }, [paused, reducedMotion, onSelect, onFeedback, onMotion, onMotionEnd]);
  useEffect(() => {
    if (!paused) {
      controls.current.hover = -1;
      controls.current.pointerSlot = -1;
      controls.current.hoverLockUntil = 0;
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
      const id = requestAnimationFrame(() => setFallback(true));
      return () => cancelAnimationFrame(id);
    }
    let disposed = false, frame = 0, last = 0, width = 1, height = 1, speed = 0, scale = 1;
    let sampledTime = 0, sampledFrames = 0, slowFrames = 0, namedIndex = -1;
    let dirty = true, userMotion = false;
    const state = controls.current;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, .1, 30000);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0xffffff, 0);
    renderer.domElement.setAttribute("aria-hidden", "true");
    host.appendChild(renderer.domElement);
    // Same projection as the approved standalone film, expressed in scene units.
    const cardWidth = portrait ? 248 : 420;
    const cardHeight = portrait ? 440 : 236.25;
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
      dirty = true;
      if (++settled === images.length) setLoaded(true);
    }, undefined, () => {
      if (!disposed) { setFallback(true); cancelAnimationFrame(frame); }
    }));
    const meshes = slots.map(() => {
      const material = new THREE.ShaderMaterial({
        vertexShader: vertexShader.replace("lens * 0.065", "lens * 5.5"), fragmentShader,
        transparent: true, side: THREE.DoubleSide,
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
    const shadows = meshes.map(() => {
      const material = new THREE.ShaderMaterial({vertexShader, fragmentShader: shadowFragment,
        transparent:true, depthWrite:false, uniforms:{uOpacity:{value:0},uAspect:{value:cardWidth/cardHeight},
          uBend:{value:-.000045},uHover:{value:0},uPointer:{value:new THREE.Vector2(.5,.5)}}});
      const mesh = new THREE.Mesh(geometry, material);
      scene.add(mesh);
      return mesh;
    });
    const corner = new THREE.Vector3();
    const localCorners = [[-1, 1], [1, 1], [1, -1], [-1, -1]];
    const resize = () => {
      width = element.clientWidth;
      height = element.clientHeight;
      scale = width < 700 ? Math.min(width / 700, height / 650) : Math.min(width / 1440, height / 656, 1.2);
      const distance = 1100 * scale;
      camera.position.z = distance;
      camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(height / (2 * distance)));
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix(); camera.updateMatrixWorld();
      renderer.setSize(width, height);
      dirty = true;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element); resize();
    select.current = slot => {
      const source = origins.current[slot];
      if (!source || options.current.paused) return;
      state.target = state.position;
      state.hover = slot;
      options.current.onFeedback("click");
      options.current.onSelect(source.index, source);
    };
    const tick = (time: number) => {
      frame = requestAnimationFrame(tick);
      const elapsed = time - (last || time);
      const dt = Math.min(elapsed / 1000, .04);
      last = time;
      if (document.hidden || (options.current.paused && !dirty)) return;
      sampledTime += elapsed; sampledFrames++;
      if (elapsed > 34) slowFrames++;
      if (sampledTime >= 2000) {
        element.dataset.frameMs = (sampledTime / sampledFrames).toFixed(2);
        element.dataset.slowFrames = `${slowFrames}/${sampledFrames}`;
        sampledTime = 0; sampledFrames = 0; slowFrames = 0;
      }
      if (state.motionInput) { userMotion = true; state.motionInput = false; }
      const previousPosition = state.position;
      if (!options.current.paused) {
        if (!state.drag && state.pointerSlot >= 0 && time > state.hoverLockUntil && Math.abs(state.target - state.position) < .008) {
          state.hover = state.pointerSlot;
        }
        const resting = state.hover < 0 && state.focus < 0 && !state.drag && time - state.lastInput > 1400;
        speed = THREE.MathUtils.damp(speed, resting && !options.current.reducedMotion ? .1 : 0, 6, dt);
        if (!state.drag) state.target += speed * dt;
        const rate = state.drag ? 42 : 11;
        state.position = options.current.reducedMotion ? state.target : THREE.MathUtils.damp(state.position, state.target, rate, dt);
      }
      // Track the rendered travel, including damped settling and release inertia.
      // End user ownership before automatic idle rotation resumes.
      if (!state.drag && time - state.lastInput > 1200 && Math.abs(state.target - state.position) < .002) userMotion = false;
      const velocity = userMotion && !options.current.paused && dt > 0 ? (state.position - previousPosition) / dt : 0;
      options.current.onMotion(velocity);
      element.dataset.motionVelocity = velocity.toFixed(3);
      const base = Math.floor(state.position);
      const rect = element.getBoundingClientRect();
      meshes.forEach((mesh, slot) => {
        const sequence = base + slot - 5;
        const offset = sequence - state.position;
        const index = wrap(sequence, images.length);
        const material = mesh.material;
        const active = !state.drag && (state.hover === slot || state.focus === slot);
        material.uniforms.uHover.value = THREE.MathUtils.damp(material.uniforms.uHover.value, active ? 1 : 0, 8, dt);
        const pointer = material.uniforms.uPointer.value as THREE.Vector2;
        const follow = material.uniforms.uHover.value;
        const depth = 1100 * .18 * offset * offset;
        const a = portrait ? 308 : 480, b = portrait ? .184 : .23;
        const screenX = a * offset / (1 + b * Math.abs(offset));
        const perspective = 1100 / (1100 + depth);
        mesh.scale.setScalar(scale);
        mesh.position.set((screenX / perspective + (pointer.x - .5) * follow * 9) * scale,
          height * .025 + (pointer.y - .5) * follow * 6 * scale, (-depth + follow * 5) * scale);
        mesh.rotation.set((pointer.y - .5) * follow * .012, Math.atan(offset * .29) + (pointer.x - .5) * follow * .02, 0);
        material.uniforms.uBend.value = -.000045;
        material.uniforms.uMap.value = textures[index] ?? blank;
        material.uniforms.uReady.value = THREE.MathUtils.damp(material.uniforms.uReady.value, textures[index] ? 1 : 0, 10, dt);
        const edge = 1 - THREE.MathUtils.smoothstep(Math.abs(offset), 3.05, 3.65);
        material.uniforms.uOpacity.value = edge;
        mesh.visible = edge > .001;
        const shadow = shadows[slot];
        shadow.visible = mesh.visible;
        shadow.position.copy(mesh.position);
        shadow.position.y -= 5 * scale;
        shadow.position.z -= 3 * scale;
        shadow.rotation.copy(mesh.rotation);
        shadow.scale.setScalar(scale * 1.035);
        shadow.material.uniforms.uOpacity.value = edge;
        mesh.updateMatrixWorld();
        const corners = localCorners.map(([x, y]) => {
          corner.set(x * cardWidth / 2, y * cardHeight / 2, material.uniforms.uBend.value * cardWidth * cardWidth / 4);
          corner.applyMatrix4(mesh.matrixWorld).project(camera);
          return { x: (corner.x * .5 + .5) * width, y: (-corner.y * .5 + .5) * height };
        });
        const left = Math.min(...corners.map(p => p.x)), top = Math.min(...corners.map(p => p.y));
        const w = Math.max(...corners.map(p => p.x)) - left, h = Math.max(...corners.map(p => p.y)) - top;
        origins.current[slot] = { index, left: left + rect.left, top: top + rect.top, width: w, height: h,
          corners: corners.map(p => ({ x: p.x + rect.left, y: p.y + rect.top })) };
        const button = buttons.current[slot];
        if (button) {
          button.style.transform = `translate3d(${left}px,${top}px,0)`;
          button.style.width = `${w}px`; button.style.height = `${h}px`;
          button.style.clipPath = `polygon(${corners.map(p => `${(p.x - left) / w * 100}% ${(p.y - top) / h * 100}%`).join(",")})`;
          button.style.zIndex = String(Math.round(100 - Math.abs(offset) * 10));
          const visible = edge > .1 && left + w > 0 && left < width;
          button.style.visibility = visible ? "visible" : "hidden";
          button.tabIndex = visible ? 0 : -1;
          if (button.dataset.projectIndex !== String(index)) {
            button.setAttribute("aria-label", `播放${labels[index]}`);
            button.dataset.projectIndex = String(index);
          }
        }
      });
      const namedSlot = state.drag ? -1 : state.hover >= 0 ? state.hover : state.focus >= 0 && state.focus < slots.length ? state.focus : -1;
      const source = origins.current[namedSlot];
      const nextName = source?.index ?? -1;
      if (nextName !== namedIndex) { namedIndex = nextName; setHovered(nextName >= 0 ? nextName : null); }
      if (source && caption.current) {
        const x = THREE.MathUtils.clamp(source.left + source.width / 2 - rect.left, 80, width - 80);
        caption.current.style.left = `${x}px`;
        caption.current.style.top = `${source.top + source.height - rect.top + 16}px`;
      }
      const progress = wrap(state.position, images.length) / images.length;
      if (thumb.current && slider.current) {
        const travel = slider.current.clientWidth - 36;
        thumb.current.style.transform = `translate3d(${progress * travel}px,0,0)`;
        slider.current.setAttribute("aria-valuenow", (progress * images.length).toFixed(2));
        slider.current.setAttribute("aria-valuetext", labels[wrap(Math.round(state.position), images.length)]);
      }
      element.dataset.position = state.position.toFixed(4);
      element.dataset.target = state.target.toFixed(4);
      element.dataset.dragging = state.drag?.kind ?? "false";
      renderer.render(scene, camera);
      dirty = false;
    };
    frame = requestAnimationFrame(tick);
    const wheel = (event: WheelEvent) => {
      if (options.current.paused) return;
      event.preventDefault();
      if (state.drag) return;
      const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      state.target += THREE.MathUtils.clamp(delta * multiplier, -180, 180) / 400;
      state.lastInput = performance.now();
      state.hover = -1; state.hoverLockUntil = state.lastInput + 180;
      userMotion = true;
    };
    const down = (event: PointerEvent) => {
      if (options.current.paused || event.button !== 0 || !event.isPrimary || state.drag) return;
      const target = event.target as HTMLElement;
      const onSlider = !!target.closest('[data-curve-slider]');
      const hit = target.closest<HTMLButtonElement>('[data-curve-slot]');
      event.preventDefault();
      const now = performance.now();
      state.target = state.position;
      state.focus = -1; state.hover = -1; state.lastInput = now; speed = 0;
      state.hoverLockUntil = Infinity;
      const travel = (slider.current?.clientWidth ?? 180) - 36;
      if (onSlider && slider.current) {
        userMotion = true;
        slider.current.focus({ preventScroll: true });
        const r = slider.current.getBoundingClientRect();
        const thumbLeft = wrap(state.position, images.length) / images.length * travel;
        const x = event.clientX - r.left;
        if (x < thumbLeft || x > thumbLeft + 36) {
          state.target = Math.floor(state.position / images.length) * images.length + THREE.MathUtils.clamp((x - 18) / travel, 0, 1) * images.length;
        }
      }
      state.drag = { id: event.pointerId, kind: onSlider ? "slider" : "gallery", startX: event.clientX, startY: event.clientY,
        anchor: state.target, slot: hit ? Number(hit.dataset.curveSlot) : -1, moved: false,
        lastX: event.clientX, lastTime: now, velocity: 0, travel };
      element.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      const drag = state.drag;
      if (drag && drag.id === event.pointerId) {
        const dx = event.clientX - drag.startX, dy = event.clientY - drag.startY;
        if (Math.hypot(dx, dy) > 5) drag.moved = true;
        if (!drag.moved) return;
        event.preventDefault();
        const now = performance.now();
        if (drag.kind === "slider") {
          const cycle = Math.floor(drag.anchor / images.length) * images.length;
          state.target = THREE.MathUtils.clamp(drag.anchor + dx / drag.travel * images.length, cycle, cycle + images.length - .0001);
        } else {
          const perWork = Math.max(135, (portrait ? 275 : 380) * scale);
          state.target = drag.anchor - dx / perWork;
          const velocity = -(event.clientX - drag.lastX) / perWork / Math.max(.008, (now - drag.lastTime) / 1000);
          drag.velocity = drag.velocity * .55 + velocity * .45;
        }
        drag.lastX = event.clientX; drag.lastTime = now; state.lastInput = now;
        userMotion = true;
        return;
      }
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-curve-slot]');
      if (!button) return;
      const slot = Number(button.dataset.curveSlot), r = button.getBoundingClientRect();
      (meshes[slot].material.uniforms.uPointer.value as THREE.Vector2).set(
        THREE.MathUtils.clamp((event.clientX - r.left) / r.width, 0, 1),
        1 - THREE.MathUtils.clamp((event.clientY - r.top) / r.height, 0, 1));
    };
    const finish = (event: PointerEvent) => {
      const drag = state.drag;
      if (!drag || drag.id !== event.pointerId) return;
      state.drag = null;
      state.lastInput = performance.now();
      state.hoverLockUntil = state.lastInput + 150;
      if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
      if (event.type !== "pointerup") return;
      if (drag.kind === "gallery" && drag.moved) {
        const fresh = performance.now() - drag.lastTime < 90;
        if (fresh && !options.current.reducedMotion) state.target += THREE.MathUtils.clamp(drag.velocity * .15, -.7, .7);
      } else if (drag.kind === "gallery" && drag.slot >= 0) select.current(drag.slot);
    };
    const lost = () => { state.drag = null; state.lastInput = performance.now(); state.hoverLockUntil = state.lastInput + 150; };
    element.addEventListener("wheel", wheel, { passive: false });
    element.addEventListener("pointerdown", down);
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", finish);
    element.addEventListener("pointercancel", finish);
    element.addEventListener("lostpointercapture", lost);
    const contextLost = (event: Event) => { options.current.onMotionEnd(); event.preventDefault(); setFallback(true); cancelAnimationFrame(frame); };
    renderer.domElement.addEventListener("webglcontextlost", contextLost);
    return () => {
      disposed = true; options.current.onMotionEnd(); cancelAnimationFrame(frame); observer.disconnect();
      if (state.drag && element.hasPointerCapture(state.drag.id)) element.releasePointerCapture(state.drag.id);
      state.drag = null;
      element.removeEventListener("wheel", wheel); element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointermove", move); element.removeEventListener("pointerup", finish);
      element.removeEventListener("pointercancel", finish); element.removeEventListener("lostpointercapture", lost);
      renderer.domElement.removeEventListener("webglcontextlost", contextLost);
      meshes.forEach(mesh => mesh.material.dispose()); shadows.forEach(mesh => mesh.material.dispose()); textures.forEach(texture => texture?.dispose());
      geometry.dispose(); blank.dispose(); renderer.dispose(); renderer.domElement.remove();
    };
  }, [images, labels, portrait]);

  return <div ref={root} className={styles.gallery} data-ready={loaded} data-curved-gallery role="region" aria-label="横向曲面作品预览"
    onKeyDown={event => {
      if (event.target === slider.current) return;
      if (["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "PageDown", "PageUp"].includes(event.key)) {
        event.preventDefault();
        controls.current.target += ["ArrowDown", "ArrowRight", "PageDown"].includes(event.key) ? 1 : -1;
        controls.current.lastInput = performance.now(); controls.current.motionInput = true;
      }
    }}>
    <div ref={canvasHost} className={styles.canvas} />
    {!fallback && <div className={styles.hits}>{slots.map(slot => <button key={slot}
      ref={node => { buttons.current[slot] = node; }} className={styles.hit} data-curve-slot={slot} data-sound-handled
      aria-label="浏览作品" onClick={event => { if (event.detail === 0) select.current(slot); }}
      onPointerEnter={event => {
        if (event.pointerType === "touch") return;
        controls.current.pointerSlot = slot;
        const now = performance.now();
        if (controls.current.drag || now < controls.current.hoverLockUntil || (now - controls.current.lastInput < 1000 && Math.abs(controls.current.target - controls.current.position) > .008)) return;
        controls.current.hover = slot; controls.current.target = controls.current.position;
      }} onPointerLeave={() => { controls.current.hover = -1; controls.current.pointerSlot = -1; }}
      onFocus={event => { if (!controls.current.drag && event.currentTarget.matches(':focus-visible')) { controls.current.focus = slot; controls.current.target = controls.current.position; } }}
      onBlur={() => { controls.current.focus = -1; }}
    />)}</div>}
    <div ref={caption} className={styles.name} aria-live="polite" data-visible={hovered !== null}>{hovered !== null ? labels[hovered] : ""}</div>
    {!fallback && <div className={styles.sliderWrap}><div ref={slider} className={styles.slider} data-curve-slider
      role="slider" tabIndex={0} aria-label="横向浏览作品" aria-valuemin={0} aria-valuemax={images.length} aria-valuenow={0}
      onFocus={() => { controls.current.focus = 99; }} onBlur={() => { controls.current.focus = -1; }}
      onKeyDown={event => {
        const state = controls.current;
        if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          if (event.key === "Home") state.target = Math.floor(state.position / images.length) * images.length;
          else if (event.key === "End") state.target = Math.floor(state.position / images.length) * images.length + images.length - 1;
          else state.target += event.key === "ArrowRight" || event.key === "ArrowUp" ? 1 : -1;
          state.lastInput = performance.now(); state.motionInput = true;
        }
      }}><span className={styles.track} /><span ref={thumb} className={styles.thumb} /></div></div>}
    {fallback && <div className={styles.fallback}>{images.map((src, index) => <button key={src} onClick={event => onSelect(index, event.currentTarget.getBoundingClientRect())}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={labels[index]} draggable={false} /><span>{labels[index]}</span>
    </button>)}</div>}
  </div>;
}
