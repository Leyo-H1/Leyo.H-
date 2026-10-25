"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { createInteractionSound, type FeedbackKind } from "@/lib/portfolio/interaction-sound";

const selector = 'button:not(:disabled),a[href],[role="button"],[role="slider"],[data-interactive]';

export function useInteractionSound(root: RefObject<HTMLElement | null>, enabled: boolean, pageKey: string, quiet: boolean) {
  const [soundOn, setSoundOn] = useState(true);
  const engine = useRef<ReturnType<typeof createInteractionSound> | null>(null);
  const settings = useRef({ soundOn, quiet });
  const previousPage = useRef(pageKey);
  const feedback = useCallback((kind: FeedbackKind) => engine.current?.play(kind), []);
  const motion = useCallback((velocity: number) => engine.current?.motion(velocity), []);
  const endMotion = useCallback(() => engine.current?.endMotion(), []);
  useEffect(() => { settings.current = { soundOn, quiet }; engine.current?.configure(!soundOn, quiet); }, [soundOn, quiet]);
  useEffect(() => {
    const element = root.current;
    if (!enabled || !element) return;
    const audio = createInteractionSound((kind, state) => {
      element.dataset.soundLast = kind;
      element.dataset.soundState = state;
      element.dataset.soundCount = String(Number(element.dataset.soundCount ?? 0) + 1);
      const key = `sound${kind[0].toUpperCase()}${kind.slice(1)}`;
      element.dataset[key] = String(Number(element.dataset[key] ?? 0) + 1);
    });
    engine.current = audio;
    audio.configure(!settings.current.soundOn, settings.current.quiet);
    let hoverTimer: ReturnType<typeof setTimeout> | undefined;
    let lastTarget: Element | null = null;
    const interactive = (target: EventTarget | null) => {
      if (!(target instanceof Element) || !element.contains(target) || target.closest('[inert]')) return null;
      return target.closest(selector) ?? (target.tagName === "CANVAS" && getComputedStyle(target).cursor === "pointer" ? target : null);
    };
    const unlock = (event: Event) => {
      if (event.type === "pointerdown" && hoverTimer) clearTimeout(hoverTimer);
      if (event.isTrusted) audio.unlock();
    };
    const point = (event: PointerEvent) => {
      if (event.pointerType === "touch" || event.buttons) return;
      const target = interactive(event.target);
      if (target === lastTarget) return;
      lastTarget = target;
      if (hoverTimer) clearTimeout(hoverTimer);
      if (target) hoverTimer = setTimeout(() => audio.play("hover"), 85);
    };
    const leave = () => { lastTarget = null; if (hoverTimer) clearTimeout(hoverTimer); };
    const click = (event: MouseEvent) => {
      const target = interactive(event.target);
      if (target && !target.hasAttribute("data-sound-handled") && target.getAttribute("role") !== "slider") audio.play("click");
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") audio.play("click");
    };
    const focus = (event: FocusEvent) => { if (interactive(event.target)) audio.play("hover"); };
    const visibility = () => { if (document.hidden) audio.suspend(); else audio.resume(); };
    const onFrameTransition = () => audio.play("transition");
    element.addEventListener("pointerdown", unlock, true);
    element.addEventListener("pointerup", unlock, true);
    element.addEventListener("keydown", unlock, true);
    element.addEventListener("pointermove", point, { passive: true });
    element.addEventListener("pointerleave", leave);
    element.addEventListener("click", click, true);
    element.addEventListener("keydown", key);
    element.addEventListener("focusin", focus);
    window.addEventListener("portfolio-view-transition", onFrameTransition);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      if (hoverTimer) clearTimeout(hoverTimer);
      element.removeEventListener("pointerdown", unlock, true); element.removeEventListener("pointerup", unlock, true);
      element.removeEventListener("keydown", unlock, true); element.removeEventListener("keydown", key);
      element.removeEventListener("pointermove", point); element.removeEventListener("pointerleave", leave);
      element.removeEventListener("click", click, true);
      element.removeEventListener("focusin", focus);
      window.removeEventListener("portfolio-view-transition", onFrameTransition);
      document.removeEventListener("visibilitychange", visibility);
      audio.destroy(); engine.current = null;
    };
  }, [root, enabled]);
  useEffect(() => {
    if (previousPage.current === pageKey) return;
    previousPage.current = pageKey;
    const timer = setTimeout(() => engine.current?.play("transition"), 110);
    return () => clearTimeout(timer);
  }, [pageKey]);
  const toggle = useCallback(() => {
    const next = !settings.current.soundOn;
    engine.current?.configure(!next, settings.current.quiet);
    if (next) engine.current?.unlock();
    setSoundOn(next);
  }, []);
  return { soundOn, toggle, feedback, motion, endMotion };
}
