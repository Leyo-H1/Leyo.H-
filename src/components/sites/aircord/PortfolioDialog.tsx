"use client";

import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { motion, usePresence, useReducedMotion } from "motion/react";
import styles from "./GlassPlayer.module.css";

export type PlayerOrigin = {
  left: number; top: number; width: number; height: number;
  corners?: { x: number; y: number }[];
};

type Props = {
  label: string;
  onDismiss: () => void;
  children: ReactNode;
  theme?: "light" | "dark";
  origin?: PlayerOrigin | null;
  poster?: string;
  portrait?: boolean;
  aspect?: number;
};

// A planar projective transform keeps a side-facing card attached to the same
// four screen corners while it unfolds into the existing player rectangle.
function sourceTransform(source: PlayerOrigin, destination: DOMRect) {
  const points = source.corners ?? [
    { x: source.left, y: source.top }, { x: source.left + source.width, y: source.top },
    { x: source.left + source.width, y: source.top + source.height }, { x: source.left, y: source.top + source.height },
  ];
  const [p0, p1, p2, p3] = points.map(p => ({ x: p.x - destination.left, y: p.y - destination.top }));
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y;
  const determinant = dx1 * dy2 - dx2 * dy1;
  const g = Math.abs(determinant) > .001 ? (dx3 * dy2 - dx2 * dy3) / determinant : 0;
  const h = Math.abs(determinant) > .001 ? (dx1 * dy3 - dx3 * dy1) / determinant : 0;
  const w = destination.width, height = destination.height;
  return `matrix3d(${(p1.x - p0.x + g * p1.x) / w},${(p1.y - p0.y + g * p1.y) / w},0,${g / w},${(p3.x - p0.x + h * p3.x) / height},${(p3.y - p0.y + h * p3.y) / height},0,${h / height},0,0,1,0,${p0.x},${p0.y},0,1)`;
}

export function PortfolioDialog({ label, onDismiss, children, theme = "dark", origin, poster, portrait = false, aspect = 16 / 9 }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const cover = useRef<HTMLImageElement>(null);
  const reducedMotion = useReducedMotion() ?? false;
  const [isPresent, safeToRemove] = usePresence(theme === "light");
  const initialOrigin = useRef(origin);
  const dismiss = useRef(onDismiss);
  useLayoutEffect(() => { dismiss.current = onDismiss; }, [onDismiss]);
  useLayoutEffect(() => { initialOrigin.current = origin; }, [origin]);

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    return () => { dialog.close(); };
  }, []);

  useLayoutEffect(() => {
    if (theme !== "light") return;
    const dialog = ref.current;
    const content = panel.current;
    const image = cover.current;
    if (!dialog || !content || !image) return;
    const source = initialOrigin.current;
    const video = content.querySelector("video");
    const animations: Animation[] = [];
    const duration = reducedMotion ? 0 : isPresent ? 1080 : 760;
    dialog.dataset.phase = isPresent ? "opening" : "closing";
    const destination = video?.getBoundingClientRect() ?? content.getBoundingClientRect();
    Object.assign(image.style, {
      left: `${destination.left}px`, top: `${destination.top}px`,
      width: `${destination.width}px`, height: `${destination.height}px`,
    });
    const transform = source && source.width > 0 ? sourceTransform(source, destination) : "scale(.96)";
    const identity = "matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)";
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (isPresent) {
      video?.pause();
      animations.push(image.animate([
        { transform, opacity: 1, borderRadius: "9px", offset: 0 },
        { opacity: 1, offset: .63 },
        { transform: identity, opacity: 0, borderRadius: "14px", offset: 1 },
      ], { duration, easing: "cubic-bezier(.3,.05,.15,1)", fill: "both" }));
      animations.push(content.animate([
        { opacity: 0, offset: 0 }, { opacity: 0, offset: .43 }, { opacity: 1, offset: 1 },
      ], { duration, easing: "ease", fill: "both" }));
      timer = setTimeout(() => {
        dialog.dataset.phase = "open";
        void video?.play().catch(() => { /* Native play controls remain available. */ });
      }, duration * .72);
    } else {
      // Shrink the visible video frame, rather than flashing back to its poster.
      if (video && video.readyState >= 2) {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = video.videoWidth; canvas.height = video.videoHeight;
          canvas.getContext("2d")?.drawImage(video, 0, 0);
          image.src = canvas.toDataURL("image/jpeg", .88);
        } catch { /* Keep the supplied local cover if a frame is unavailable. */ }
      }
      video?.pause();
      animations.push(image.animate([
        { transform: identity, opacity: 1, borderRadius: "14px", offset: 0 },
        { opacity: 1, offset: .84 },
        { transform, opacity: 0, borderRadius: "9px", offset: 1 },
      ], { duration, easing: "cubic-bezier(.4,0,.2,1)", fill: "both" }));
      animations.push(content.animate([{ opacity: 1 }, { opacity: 0 }], { duration: duration * .24, fill: "both" }));
      timer = setTimeout(() => safeToRemove?.(), duration);
    }
    return () => { if (timer) clearTimeout(timer); animations.forEach(animation => animation.cancel()); };
  }, [isPresent, theme, reducedMotion, safeToRemove]);

  const style = { "--player-aspect": aspect } as CSSProperties;
  if (theme === "light") return <dialog ref={ref} className={styles.whiteStage} style={style} aria-label={label}
    onCancel={event => { event.preventDefault(); dismiss.current(); }}
    onClick={event => { if (event.target === event.currentTarget) dismiss.current(); }}>
    <div ref={panel} className={`portfolio-dialog ${styles.whiteDialog}`} data-portrait={portrait}>{children}</div>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img ref={cover} className={styles.transitionCover} src={poster} alt="" aria-hidden="true" />
  </dialog>;

  return <motion.dialog ref={ref} className="portfolio-dialog" aria-label={label}
    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reducedMotion ? 0 : .22 }}
    onCancel={event => { event.preventDefault(); onDismiss(); }} onClick={event => {
      if (event.target === event.currentTarget) {
        const box = event.currentTarget.getBoundingClientRect();
        if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onDismiss();
      }
    }}>{children}</motion.dialog>;
}
