/* eslint-disable react-hooks/set-state-in-effect -- Source entrance phases are synchronized to the imperative animation controller. */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';

import {
  resolveCollectionCover,
  resolveFrameTheme,
  type Collection,
} from './data';
import { SceneController } from './archive/SceneController';
import type { EntranceMode, EntrancePhase, RailCollection, SceneStage } from './archive/types';
import styles from './ArchiveScene.module.css';
import { gsap } from 'gsap';
import { VaporType } from './effects/VaporType';
import { createVerticalSwipe } from '@/lib/portfolio/vertical-swipe';

interface Props {
  series: Collection[];
  reducedMotion: boolean;
  onMore: () => void;
  entranceMode?: EntranceMode;
  onEntranceComplete?: () => void;
  narrativeSelection?: boolean;
  theme?: 'dark' | 'light';
}

type OrbitPhase = 'scatter' | 'line' | 'curl' | 'tunnel' | 'forming' | 'restoring' | 'orbit' | 'gathering' | 'materializing' | 'handoff' | 'settling' | 'complete' | 'returning' | 'rematerializing' | 'scrolling';

const ORBIT_FORM_DURATION = 2360;

interface OrbitCardData {
  id: string;
  collectionId: string;
  collectionTitle: string;
  railIndex: number;
  title: string;
  image: string;
  focus: [number, number];
  railCover: string;
  railFocus: [number, number];
}

const DISPLAY_SHELLS: RailCollection['shell'][] = [
  'smoked',
  'paleIce',
  'amber',
  'ice',
  'dichroic',
  'clear',
  'smoked',
];

// The planar index is an editorial selection, not a mirror of the Studio.
// Only distinct, uploaded works are included here. Collections still using a
// repeated case-study placeholder remain available in the acrylic archive,
// but are intentionally omitted from this entrance until their work images
// have been supplied.
const ORBIT_WORK_SELECTION: Record<string, readonly string[]> = {
  'quiet-room': ['qr-1', 'qr-3', 'qr-5'],
  'paper-letters': ['pl-1', 'pl-3', 'pl-5'],
  'manufactured-halo': ['manufactured-halo-01', 'manufactured-halo-04', 'manufactured-halo-07'],
  'low-frequency': ['always-01', 'always-03', 'always-06'],
  'printed-things': ['pr-1', 'pr-2', 'pr-4'],
  'light-out-of-place': ['light-01', 'light-02', 'light-04'],
};

const toRail = (collections: Collection[]): RailCollection[] =>
  collections
    .filter((collection) => collection.status === 'published')
    .slice(0, 7)
    .map((collection, index) => {
      const cover = resolveCollectionCover(collection);
      return {
        index,
        id: collection.id,
        title: collection.titleEn,
        titleZh: collection.titleZh,
        year: String(collection.year),
        medium: collection.medium,
        // `shell` remains the optical surface recipe. Theme colours are
        // carried independently so artwork changes never alter refraction.
        shell: collection.shell ?? DISPLAY_SHELLS[index],
        videoSrc: collection.videoSrc,
        palette: collection.palette,
        cover: cover.image,
        coverWorkId: cover.workId,
        coverFit: cover.fit,
        coverFocus: cover.focus,
        coverMatte: cover.matte,
        coverZoom: cover.zoom,
        frameTheme: resolveFrameTheme(collection),
        works: collection.works
          .slice()
          .sort((a, b) => a.order - b.order)
          .map((work) => ({
            id: work.id,
            title: work.titleEn,
            titleZh: work.titleZh,
            image: work.image,
            year: String(work.year),
            medium: work.medium,
            order: work.order,
            presentation: {
              fit: work.presentation?.fit ?? 'contain',
              focus: work.presentation?.focus ?? [0.5, 0.5],
              matte: work.presentation?.matte ?? 'transparent',
              zoom: work.presentation?.zoom ?? 1,
            },
          })),
        status: collection.status,
      };
    });

export function ArchiveScene({
  series,
  reducedMotion,
  onMore,
  entranceMode = 'standard',
  onEntranceComplete,
  narrativeSelection = false,
  theme = 'dark',
}: Props) {
  const [videoState, setVideoState] = useState({playing:false,muted:true});
  const scrollingRef = useRef(false);
  const phaseRef = useRef<OrbitPhase>('scatter');
  const stageRef = useRef<SceneStage>('archive');
  const scrubProgressRef = useRef(0);
  const [videoProgress, setVideoProgress] = useState({currentTime: 0, duration: 0});
  const scrollCleanup = useRef<(() => void) | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const workInfoRef = useRef<HTMLElement>(null);
  const orbitRef = useRef<HTMLDivElement>(null);
  const orbitPointerRef = useRef<HTMLSpanElement>(null);
  const orbitBoundsRef = useRef<DOMRect | null>(null);
  const orbitRafRef = useRef(0);
  const orbitInteractionRafRef = useRef(0);
  const bridgeAnchorRafRef = useRef(0);
  const orbitAngleRef = useRef(0);
  const orbitVelocityRef = useRef(0.000012);
  const orbitLastTimeRef = useRef(0);
  const orbitFormStartRef = useRef(0);
  const pendingOrbitPointerRef = useRef<{ clientX: number; clientY: number; pointerType: string } | null>(null);
  const hoveredOrbitIndexRef = useRef(-1);
  const orbitTimersRef = useRef<number[]>([]);
  const controllerRef = useRef<SceneController | null>(null);
  const returningToEntranceRef = useRef(false);
  const isOrbitEntrance = entranceMode === 'orbit';
  const [stage, setStage] = useState<SceneStage>('archive');
  const [entrancePhase, setEntrancePhase] = useState<EntrancePhase>(
    entranceMode === 'standard' ? 'complete' : 'loading',
  );
  const [orbitPhase, setOrbitPhase] = useState<OrbitPhase>(isOrbitEntrance ? 'scatter' : 'complete');
  const [selectedOrbitCardId, setSelectedOrbitCardId] = useState<string | null>(null);
  const [metaIndex, setMetaIndex] = useState(3);
  const [ready, setReady] = useState(false);
  const [, setShowHint] = useState(false);
  const [, setShowEntranceHint] = useState(entranceMode === 'unfold');

  const published = useMemo(
    () => series.filter((collection) => collection.status === 'published').slice(0, 7),
    [series],
  );
  const rail = useMemo(() => toRail(published), [published]);
  const orbitCards = useMemo<OrbitCardData[]>(() => {
    const collections = published.map((collection, railIndex) => ({
      collection,
      railIndex,
      cover: resolveCollectionCover(collection),
      works: collection.works
        .filter((work) => {
          const selectedIds = narrativeSelection && collection.id === 'low-frequency'
            ? ['always-01', 'always-02', 'always-06']
            : ORBIT_WORK_SELECTION[collection.id];
          // A new collection should appear in the orbit automatically. The
          // optional map remains available for editorially curated selections.
          return !selectedIds || selectedIds.includes(work.id);
        })
        .sort((a, b) => a.order - b.order),
    })).filter((item) => item.works.length > 0);
    const maximumWorks = Math.max(0, ...collections.map((item) => item.works.length));
    const cards: OrbitCardData[] = [];
    for (let workIndex = 0; workIndex < maximumWorks; workIndex++) {
      collections.forEach(({ collection, railIndex, cover, works }) => {
        const work = works[workIndex];
        if (!work) return;
        cards.push({
          id: `${collection.id}:${work.id}`,
          collectionId: collection.id,
          collectionTitle: collection.titleEn,
          railIndex,
          title: work.titleEn,
          image: work.image,
          focus: work.presentation?.focus ?? [0.5, 0.5],
          railCover: cover.image,
          railFocus: cover.focus,
        });
      });
    }
    return cards;
  }, [published, narrativeSelection]);
  useEffect(() => { phaseRef.current = orbitPhase; stageRef.current = stage; }, [orbitPhase, stage]);
  const previousSoundPhase = useRef(orbitPhase);
  useEffect(() => {
    if (theme === 'light' && previousSoundPhase.current !== orbitPhase && (orbitPhase === 'complete' || orbitPhase === 'restoring')) {
      window.dispatchEvent(new CustomEvent('portfolio-view-transition'));
    }
    previousSoundPhase.current = orbitPhase;
  }, [orbitPhase, theme]);

  const clearOrbitTimers = useCallback(() => {
    orbitTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    orbitTimersRef.current = [];
  }, []);

  const queueOrbitPhase = useCallback((phase: OrbitPhase, delay: number) => {
    const timer = window.setTimeout(() => setOrbitPhase(phase), delay);
    orbitTimersRef.current.push(timer);
  }, []);

  useEffect(() => () => {
    window.cancelAnimationFrame(orbitRafRef.current);
    window.cancelAnimationFrame(orbitInteractionRafRef.current);
    window.cancelAnimationFrame(bridgeAnchorRafRef.current);
    clearOrbitTimers();
  }, [clearOrbitTimers]);

  useEffect(() => {
    clearOrbitTimers();
    setOrbitPhase(isOrbitEntrance ? 'scatter' : 'complete');
    setSelectedOrbitCardId(null);
  }, [clearOrbitTimers, isOrbitEntrance]);

  useEffect(() => {
    if (!isOrbitEntrance || !ready || orbitPhase !== 'scatter') return;
    clearOrbitTimers();
    if (reducedMotion) {
      setOrbitPhase('orbit');
      return;
    }
    queueOrbitPhase('line', 1120);
    queueOrbitPhase('curl', 1940);
    queueOrbitPhase('tunnel', 2420);
    queueOrbitPhase('forming', 2840);
    queueOrbitPhase('orbit', 2840 + ORBIT_FORM_DURATION);
  }, [clearOrbitTimers, isOrbitEntrance, orbitPhase, queueOrbitPhase, ready, reducedMotion]);

  useEffect(() => {
    if (!isOrbitEntrance || !['scatter', 'line', 'curl', 'tunnel', 'forming', 'restoring', 'orbit'].includes(orbitPhase)) return;
    const root = orbitRef.current;
    if (!root) return;
    const cards = Array.from(root.querySelectorAll<HTMLElement>('[data-orbit-card]'));
    if (cards.length === 0) return;
    if (orbitPhase === 'forming') {
      orbitAngleRef.current = 0;
      orbitFormStartRef.current = performance.now();
    }
    if (orbitPhase === 'orbit') orbitLastTimeRef.current = performance.now();
    let rect = root.getBoundingClientRect();
    orbitBoundsRef.current = rect;
    const resizeObserver = new ResizeObserver(() => {
      rect = root.getBoundingClientRect();
      orbitBoundsRef.current = rect;
    });
    resizeObserver.observe(root);

    const placeCards = (time: number) => {
      const mobile = rect.width < 640;
      const ringRadius = mobile
        ? Math.min(rect.width * 0.39, rect.height * 0.18)
        : Math.min(rect.width * 0.175, rect.height * 0.31, 240);
      const lineGap = Math.min(mobile ? 22 : 38, (rect.width * 0.82) / Math.max(cards.length, 1));
      const lineHalfWidth = ((cards.length - 1) * lineGap) / 2;
      if (orbitPhase === 'orbit' && !reducedMotion) {
        const elapsed = Math.min(50, Math.max(0, time - orbitLastTimeRef.current));
        const targetVelocity = hoveredOrbitIndexRef.current >= 0 ? 0.0000035 : 0.000012;
        const response = 1 - Math.exp(-elapsed * 0.012);
        orbitVelocityRef.current += (targetVelocity - orbitVelocityRef.current) * response;
        orbitAngleRef.current += elapsed * orbitVelocityRef.current;
        orbitLastTimeRef.current = time;
      }
      const formProgress = orbitPhase === 'forming'
        ? Math.min(1, Math.max(0, (time - orbitFormStartRef.current) / ORBIT_FORM_DURATION))
        : 0;
      const easedFormProgress = formProgress * formProgress * formProgress
        * (formProgress * (formProgress * 6 - 15) + 10);
      const formRotation = easedFormProgress * Math.PI * 2;
      if (orbitPhase === 'forming') orbitAngleRef.current = formRotation;
      const rotation = orbitPhase === 'forming'
        ? formRotation
        : orbitPhase === 'restoring' || orbitPhase === 'orbit'
          ? orbitAngleRef.current
          : 0;
      cards.forEach((card, index) => {
        let x = 0;
        let y = 0;
        let scale = 1;
        let opacity = 1;
        let blur = 0;
        let cardRotation = 0;
        let orbitZ = 0;
        let rotateX = 0;
        let rotateY = 0;

        if (orbitPhase === 'scatter') {
          const xSeed = ((index * 73 + 17) % 101) / 100;
          const ySeed = ((index * 47 + 11) % 97) / 96;
          x = (xSeed - 0.5) * rect.width * (mobile ? 0.82 : 0.88);
          y = (ySeed - 0.5) * rect.height * (mobile ? 0.46 : 0.62);
          scale = 0.68 + ((index * 19) % 23) / 100;
          opacity = 0.46 + ((index * 13) % 37) / 100;
          blur = 0.7;
          cardRotation = ((index * 29) % 15) - 7;
        } else if (orbitPhase === 'line') {
          x = (index - (cards.length - 1) / 2) * lineGap;
          scale = 0.84;
        } else {
          // The horizontal strip closes at its lower seam before it faces the
          // viewer, matching the reference's film-strip curl through depth.
          const angle = rotation + Math.PI / 2 + ((index + 0.5) / cards.length) * Math.PI * 2;
          if (orbitPhase === 'curl') {
            const curlRadiusX = Math.max(ringRadius * 1.28, lineHalfWidth * 0.88);
            const faceFactor = (1 - Math.sin(angle)) / 2;
            x = Math.cos(angle) * curlRadiusX;
            y = Math.sin(angle) * Math.min(28, ringRadius * 0.15);
            orbitZ = -Math.sin(angle) * 84;
            rotateX = (1 - faceFactor) * 34;
            rotateY = Math.cos(angle) * -72;
            scale = 0.76 + faceFactor * 0.2;
            opacity = 0.56 + faceFactor * 0.44;
          } else if (orbitPhase === 'tunnel') {
            const faceFactor = (1 - Math.sin(angle)) / 2;
            x = Math.cos(angle) * ringRadius * 0.57;
            y = Math.sin(angle) * ringRadius * 0.22;
            orbitZ = -Math.sin(angle) * ringRadius * 0.54;
            rotateX = (1 - faceFactor) * 79;
            rotateY = Math.cos(angle) * -38;
            scale = 0.67 + faceFactor * 0.31;
            opacity = 0.42 + faceFactor * 0.58;
          } else if (orbitPhase === 'forming') {
            const faceFactor = (1 - Math.sin(angle)) / 2;
            const depthEnvelope = 1 - easedFormProgress;
            const waveEnvelope = Math.sin(Math.PI * formProgress) ** 0.72;
            const radiusX = ringRadius * (0.57 + easedFormProgress * 0.43);
            const radiusY = ringRadius * (0.22 + easedFormProgress * 0.78);
            const waveHead = formProgress * cards.length;
            const rawWaveDistance = index - waveHead;
            const waveDistance = ((rawWaveDistance + cards.length / 2) % cards.length + cards.length)
              % cards.length - cards.length / 2;
            const flipWave = Math.exp(-(waveDistance * waveDistance) / 1.55) * waveEnvelope;
            const openingWave = Math.exp(-(waveDistance * waveDistance) / 6.2) * waveEnvelope;
            const radialX = Math.cos(angle);
            const radialY = Math.sin(angle);
            const tangentX = -radialY;
            const tangentY = radialX;
            const waveDirection = waveDistance === 0 ? 0 : Math.sign(waveDistance);
            const radialLift = 18 * flipWave + 4 * openingWave;
            const tangentOpening = waveDirection * 12 * openingWave;
            x = radialX * radiusX + radialX * radialLift + tangentX * tangentOpening;
            y = radialY * radiusY + radialY * radialLift + tangentY * tangentOpening;
            orbitZ = -Math.sin(angle) * ringRadius * 0.54 * depthEnvelope + 28 * flipWave;
            rotateX = (1 - faceFactor) * 79 * depthEnvelope;
            rotateY = Math.cos(angle) * -38 * depthEnvelope
              + (Math.cos(angle) >= 0 ? -1 : 1) * 58 * flipWave;
            scale = (0.67 + faceFactor * 0.31) * depthEnvelope
              + easedFormProgress
              + 0.07 * flipWave;
            opacity = (0.42 + faceFactor * 0.58) * depthEnvelope + easedFormProgress;
          } else {
            x = Math.cos(angle) * ringRadius;
            y = Math.sin(angle) * ringRadius;
          }
          cardRotation = angle * (180 / Math.PI) + 90;
        }

        card.style.setProperty('--orbit-x', `${x}px`);
        card.style.setProperty('--orbit-y', `${y}px`);
        if (orbitPhase !== 'orbit') card.style.setProperty('--orbit-scale', String(scale));
        if (orbitPhase !== 'orbit') card.style.setProperty('--orbit-opacity', String(opacity));
        if (orbitPhase !== 'orbit') card.style.setProperty('--orbit-blur', `${blur}px`);
        card.style.setProperty('--orbit-rotation', `${cardRotation}deg`);
        if (orbitPhase !== 'orbit') card.style.setProperty('--orbit-z', `${orbitZ}px`);
        if (orbitPhase !== 'orbit') card.style.setProperty('--orbit-rotate-x', `${rotateX}deg`);
        if (orbitPhase !== 'orbit') card.style.setProperty('--orbit-rotate-y', `${rotateY}deg`);
        if (orbitPhase !== 'orbit') card.style.zIndex = String(20 + Math.round(orbitZ + 100));
      });
    };

    const animate = (time: number) => {
      placeCards(time);
      if ((orbitPhase === 'forming' || orbitPhase === 'orbit') && !reducedMotion) {
        orbitRafRef.current = window.requestAnimationFrame(animate);
      }
    };
    animate(performance.now());
    return () => {
      resizeObserver.disconnect();
      window.cancelAnimationFrame(orbitRafRef.current);
    };
  }, [isOrbitEntrance, orbitCards.length, orbitPhase, reducedMotion]);

  useEffect(() => {
    const bridgeActive = ['gathering', 'materializing', 'handoff', 'rematerializing'].includes(orbitPhase);
    if (!bridgeActive || !selectedOrbitCardId) return;
    const root = orbitRef.current;
    const frame = frameRef.current;
    const controller = controllerRef.current;
    if (!root || !frame || !controller) return;

    const updateBridgeAnchor = () => {
      const card = root.querySelector<HTMLElement>('[data-orbit-card][data-selected="true"]');
      const anchor = controller.getEntranceArtworkAnchor();
      if (card && anchor && card.offsetWidth > 0 && card.offsetHeight > 0) {
        const rootRect = root.getBoundingClientRect();
        const frameRect = frame.getBoundingClientRect();
        const targetX = frameRect.left - rootRect.left + anchor.centerX;
        const targetY = frameRect.top - rootRect.top + anchor.centerY;
        root.style.setProperty('--bridge-x', `${targetX - card.offsetLeft}px`);
        root.style.setProperty('--bridge-y', `${targetY - card.offsetTop}px`);
        root.style.setProperty('--bridge-width', `${anchor.width}px`);
        root.style.setProperty('--bridge-height', `${anchor.height}px`);
      }
      bridgeAnchorRafRef.current = window.requestAnimationFrame(updateBridgeAnchor);
    };

    updateBridgeAnchor();
    return () => window.cancelAnimationFrame(bridgeAnchorRafRef.current);
  }, [orbitPhase, selectedOrbitCardId]);

  useEffect(() => {
    if (selectedOrbitCardId) return;
    const root = orbitRef.current;
    root?.style.removeProperty('--bridge-x');
    root?.style.removeProperty('--bridge-y');
    root?.style.removeProperty('--bridge-width');
    root?.style.removeProperty('--bridge-height');
  }, [selectedOrbitCardId]);

  useEffect(() => {
    setShowEntranceHint(entranceMode === 'unfold');
    try {
      setShowHint(window.sessionStorage.getItem('lowkey:onboarding-seen') !== 'true');
    } catch {
      setShowHint(true);
    }
  }, [entranceMode]);

  const dismissHint = useCallback(() => {
    setShowHint(false);
    try {
      window.sessionStorage.setItem('lowkey:onboarding-seen', 'true');
    } catch {
      // The visual hint may still be dismissed when storage is unavailable.
    }
  }, []);

  const dismissActiveHint = useCallback(() => {
    if (entranceMode === 'unfold' && entrancePhase !== 'complete') {
      setShowEntranceHint(false);
      return;
    }
    dismissHint();
  }, [dismissHint, entranceMode, entrancePhase]);

  const resetOrbitHover = useCallback(() => {
    const root = orbitRef.current;
    if (!root) return;
    window.cancelAnimationFrame(orbitInteractionRafRef.current);
    orbitInteractionRafRef.current = 0;
    pendingOrbitPointerRef.current = null;
    if (orbitPointerRef.current) orbitPointerRef.current.dataset.visible = 'false';
    root.querySelectorAll<HTMLElement>('[data-orbit-card]').forEach((card) => {
      card.style.setProperty('--hover-x', '0px');
      card.style.setProperty('--hover-y', '0px');
      card.style.setProperty('--hover-z', '0px');
      card.style.setProperty('--hover-scale', '1');
      card.style.setProperty('--hover-yaw', '0deg');
      delete card.dataset.hovered;
    });
    hoveredOrbitIndexRef.current = -1;
  }, []);

  const handleOrbitPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (orbitPhase !== 'orbit') return;
    pendingOrbitPointerRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      pointerType: event.pointerType,
    };
    if (orbitInteractionRafRef.current) return;

    orbitInteractionRafRef.current = window.requestAnimationFrame(() => {
      orbitInteractionRafRef.current = 0;
      const pointer = pendingOrbitPointerRef.current;
      const root = orbitRef.current;
      if (!pointer || !root) return;
      const rootRect = orbitBoundsRef.current ?? root.getBoundingClientRect();
      const mobile = rootRect.width < 640;
      const centreX = rootRect.left + rootRect.width / 2;
      const centreY = rootRect.top + rootRect.height * (mobile ? 0.42 : 0.44);
      const ringRadius = mobile
        ? Math.min(rootRect.width * 0.39, rootRect.height * 0.18)
        : Math.min(rootRect.width * 0.175, rootRect.height * 0.31, 240);
      const pointerX = pointer.clientX - centreX;
      const pointerY = pointer.clientY - centreY;
      const pointerRadius = Math.hypot(pointerX, pointerY);
      const pointerAngle = Math.atan2(pointerY, pointerX);
      const cards = Array.from(root.querySelectorAll<HTMLElement>('[data-orbit-card]'));
      const hitThreshold = mobile ? 62 : 82;
      let closestIndex = -1;
      let closestDistance = Infinity;

      cards.forEach((card, index) => {
        const cardAngle = orbitAngleRef.current + Math.PI / 2
          + ((index + 0.5) / cards.length) * Math.PI * 2;
        const angleDelta = Math.atan2(
          Math.sin(pointerAngle - cardAngle),
          Math.cos(pointerAngle - cardAngle),
        );
        const distance = Math.hypot(angleDelta * ringRadius, pointerRadius - ringRadius);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestIndex = index;
        }
      });
      if (closestDistance > hitThreshold) closestIndex = -1;
      const interactionStrength = closestIndex >= 0
        ? Math.max(0, 1 - closestDistance / hitThreshold)
        : 0;

      cards.forEach((card, index) => {
        const cardAngle = orbitAngleRef.current + Math.PI / 2
          + ((index + 0.5) / cards.length) * Math.PI * 2;
        const radialX = Math.cos(cardAngle);
        const radialY = Math.sin(cardAngle);
        const rawDelta = index - closestIndex;
        const wrappedDelta = closestIndex >= 0
          ? ((rawDelta + cards.length / 2) % cards.length + cards.length) % cards.length - cards.length / 2
          : 0;
        const primaryWave = closestIndex >= 0
          ? Math.exp(-(wrappedDelta * wrappedDelta) / 0.52) * interactionStrength
          : 0;
        const neighbourWave = closestIndex >= 0
          ? Math.max(0, 1 - Math.abs(wrappedDelta) / 3.6) * interactionStrength
          : 0;
        const radialLift = 18 * primaryWave + 4 * neighbourWave;
        const tangentShift = wrappedDelta === 0 ? 0 : Math.sign(wrappedDelta) * 15 * neighbourWave;
        const flipDirection = radialX >= 0 ? -1 : 1;
        const hoverYaw = flipDirection * (52 * primaryWave + 10 * neighbourWave);
        card.style.setProperty('--hover-x', `${radialX * radialLift - radialY * tangentShift}px`);
        card.style.setProperty('--hover-y', `${radialY * radialLift + radialX * tangentShift}px`);
        card.style.setProperty('--hover-z', `${24 * primaryWave}px`);
        card.style.setProperty('--hover-scale', String(1 + 0.07 * primaryWave + 0.018 * neighbourWave));
        card.style.setProperty('--hover-yaw', `${hoverYaw}deg`);
        if (index === closestIndex) card.dataset.hovered = 'true';
        else delete card.dataset.hovered;
      });

      if (orbitPointerRef.current && pointer.pointerType !== 'touch') {
        orbitPointerRef.current.style.setProperty('--pointer-x', `${pointer.clientX - rootRect.left}px`);
        orbitPointerRef.current.style.setProperty('--pointer-y', `${pointer.clientY - rootRect.top}px`);
        orbitPointerRef.current.dataset.visible = 'true';
      }
      if (closestIndex !== hoveredOrbitIndexRef.current) {
        hoveredOrbitIndexRef.current = closestIndex;
      }
    });
  }, [orbitPhase]);

  const startOrbitEntrance = useCallback((card: OrbitCardData) => {
    if (!isOrbitEntrance || orbitPhase !== 'orbit') return;
    clearOrbitTimers();
    resetOrbitHover();
    setSelectedOrbitCardId(card.id);
    controllerRef.current?.setEntranceCollection(card.railIndex);
    setOrbitPhase('gathering');
    if (reducedMotion) {
      setOrbitPhase('handoff');
      controllerRef.current?.startEntrance(true);
      return;
    }
    // Keep the selected artwork visually continuous: first let the planar
    // card reach the optical centre, then grow its acrylic shell while the
    // owning WebGL case fades in underneath it. The scene begins unfolding
    // before the DOM shell has fully disappeared, avoiding a white-frame cut.
    queueOrbitPhase('materializing', 430);
    const handoffTimer = window.setTimeout(() => {
      setOrbitPhase('handoff');
      controllerRef.current?.startEntrance();
    }, 980);
    orbitTimersRef.current.push(handoffTimer);
  }, [clearOrbitTimers, isOrbitEntrance, orbitPhase, queueOrbitPhase, reducedMotion, resetOrbitHover]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || rail.length === 0) return;

    setReady(false);
    const controller = new SceneController(frame, rail, reducedMotion, {
      onStageChange: (nextStage, index) => {
        setStage(nextStage);
        if (index >= 0) setMetaIndex(index);
        if (entranceMode === 'standard' && nextStage === 'archive') setReady(true);
      },
      onVideoState: (playing, muted) => setVideoState({ playing, muted }),
      onVideoProgress: setVideoProgress,
      onSceneReady: () => {
        // The first rendered frame is the reliable readiness signal for every
        // entrance mode. Standard mode previously waited for a later
        // `archive` stage callback, which could be skipped when the controller
        // started with that same stage and left the loading veil visible until
        // the timeout fallback (or a manual refresh).
        setReady(true);
      },
      onEntrancePhaseChange: (nextPhase, index) => {
        setEntrancePhase(nextPhase);
        if (index >= 0) setMetaIndex(index);
        if (nextPhase === 'closed' && returningToEntranceRef.current) {
          returningToEntranceRef.current = false;
          if (isOrbitEntrance) {
            setOrbitPhase('rematerializing');
            queueOrbitPhase('restoring', reducedMotion ? 1 : 360);
            const restoreTimer = window.setTimeout(() => {
              setSelectedOrbitCardId(null);
              setOrbitPhase('orbit');
            }, reducedMotion ? 2 : 1440);
            orbitTimersRef.current.push(restoreTimer);
          } else {
            setShowEntranceHint(true);
          }
        }
      },
      onEntranceComplete: () => {
        if (isOrbitEntrance && !scrollingRef.current && ['gathering', 'materializing', 'handoff'].includes(phaseRef.current)) {
          setOrbitPhase('settling');
          queueOrbitPhase('complete', reducedMotion ? 1 : 140);
        }
        onEntranceComplete?.();
      },
    }, {
      entranceMode: entranceMode === 'orbit' ? 'unfold' : entranceMode,
      entranceStyle: entranceMode === 'orbit' ? 'single' : 'stack',
      theme,
    });
    controllerRef.current = controller;
    controller.start();
    // The scene's archive callback is emitted when the entrance rail has
    // actually settled. Keep a conservative fallback for unusual low-frame
    // environments where that callback may be delayed.
    const readyTimer = window.setTimeout(
      () => setReady(true),
      entranceMode !== 'standard' ? 1200 : 3200,
    );

    return () => {
      window.clearTimeout(readyTimer);
      if (controllerRef.current === controller) controllerRef.current = null;
      controller.dispose();
    };
  }, [entranceMode, isOrbitEntrance, onEntranceComplete, queueOrbitPhase, rail, reducedMotion, theme]);

  useEffect(() => {
    const active = !isOrbitEntrance || !['scatter', 'line', 'curl', 'tunnel', 'forming', 'restoring', 'orbit'].includes(orbitPhase);
    controllerRef.current?.setActive(active);
  }, [isOrbitEntrance, orbitPhase, ready]);

  const returnToEntrance = useCallback(() => {
    window.dispatchEvent(new CustomEvent('portfolio-scroll-return'));
  }, []);

  // Like the reference NarrativeBridge, progress belongs to the input, with a
  // short time-based response. A stopped wheel leaves the camera exactly there.
  const scrubEnabled = isOrbitEntrance && ['orbit', 'scrolling', 'complete'].includes(orbitPhase);
  useEffect(() => {
    if (!scrubEnabled) return;
    const root = orbitRef.current;
    const frame = frameRef.current;
    const controller = controllerRef.current;
    if (!root || !frame || !controller) return;
    let target = phaseRef.current === 'complete' ? 1 : scrubProgressRef.current;
    let current = target;
    let raf = 0;
    let last = 0;
    let timeline: gsap.core.Timeline | null = null;
    const cards = [...root.querySelectorAll<HTMLElement>('[data-orbit-card]')];
    const prepare = () => {
      if (timeline) return;
      resetOrbitHover();
      cancelAnimationFrame(orbitRafRef.current);
      // Animate the original cards. No clone layer means no duplicate images
      // can remain at their starting positions during the radial exit.
      const positions = cards.map(card => ({
        x: parseFloat(card.style.getPropertyValue('--orbit-x')) || 0,
        y: parseFloat(card.style.getPropertyValue('--orbit-y')) || 0,
      }));
      controller.setActive(true);
      // The destination is the entire settled rail, revealed only by opacity.
      // Scrolling no longer unfolds or advances selected pictures in depth.
      controller.setEntranceProgress(theme === 'light' ? (current === 1 ? 1 : Math.max(0, Math.min(1, (current - .08) / .92))) : 1);
      timeline = gsap.timeline({paused: true});
      timeline.set(root, {opacity: 1}, 0);
      cards.forEach((card, index) => {
        const position = positions[index];
        timeline!.fromTo(card, {
          '--orbit-x': `${position.x}px`, '--orbit-y': `${position.y}px`, opacity: 1,
        }, {
          '--orbit-x': `${position.x * 2.65}px`, '--orbit-y': `${position.y * 2.65}px`,
          opacity: 0, duration: .72, ease: 'power1.inOut', immediateRender: false,
        }, 0);
      });
      timeline.fromTo(frame, {opacity: 0}, {
        opacity: 1, duration: theme === 'light' ? .50 : .70, ease: 'power1.inOut', immediateRender: false,
      }, theme === 'light' ? .12 : .30).set(root, {opacity: 0}, 1);
    };
    const tick = (now: number) => {
      const dt = last ? Math.min(50, now - last) : 16;
      last = now;
      current += (target - current) * (reducedMotion ? 1 : 1 - Math.exp(-dt / 65));
      if (Math.abs(target - current) < .0008) current = target;
      scrubProgressRef.current = current;
      timeline?.progress(current);
      if (theme === 'light') controller.setEntranceProgress(current === 1 ? 1 : Math.max(0, Math.min(1, (current - .08) / .92)));

      frame.parentElement?.setAttribute('data-scroll-progress', current.toFixed(4));
      if (current === 0) {
        timeline?.kill(); timeline = null;
        gsap.set(cards, {clearProps: 'opacity'});
        controller.setEntranceProgress(0);
        gsap.set(root, {clearProps: 'opacity,transform'});
        gsap.set(frame, {clearProps: 'opacity'});
        scrollingRef.current = false;
        setSelectedOrbitCardId(null);
        setOrbitPhase('orbit');
        controller.setActive(false);
      } else if (current === 1) {
        scrollingRef.current = false;
        setOrbitPhase('complete');
      }
      if (current !== target) raf = requestAnimationFrame(tick);
      else { raf = 0; last = 0; }
    };
    const change = (next: number) => {
      prepare();
      target = Math.max(0, Math.min(1, next));
      if (target === current && !raf) return;
      scrollingRef.current = true;
      setOrbitPhase('scrolling');
      controller.setActive(true);
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || stageRef.current !== 'archive') return;
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      if (target >= 1 && event.deltaY >= 0 || target <= 0 && event.deltaY <= 0) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1);
      change(target + delta / Math.max(1100, innerHeight * 1.6));
    };
    const onKey = (event: KeyboardEvent) => {
      if (stageRef.current !== 'archive' || event.target instanceof HTMLInputElement) return;
      const direction = event.key === 'ArrowDown' || event.key === 'PageDown' ? 1
        : event.key === 'ArrowUp' || event.key === 'PageUp' ? -1 : 0;
      if (!direction || target === 1 && direction > 0 || target === 0 && direction < 0) return;
      event.preventDefault(); event.stopImmediatePropagation();
      change(target + direction * (event.key.startsWith('Page') ? .35 : .1));
    };
    const swipe = createVerticalSwipe();
    const shell = frame.parentElement;
    let suppressClickUntil = 0;
    const onPointerDown = (event: PointerEvent) => {
      if (!event.isPrimary) { swipe.cancel(); return; }
      if (event.button !== 0 || stageRef.current !== 'archive' || !(event.target instanceof Element) || !shell?.contains(event.target)) return;
      // Keep player controls, navigation and sliders fully native. Orbit cards
      // still support tap-to-open; only an actual vertical drag takes ownership.
      if (event.target.closest('button,a,input,select,textarea,video,[role="slider"]') && !event.target.closest('[data-orbit-card],[data-scroll-cue]')) return;
      swipe.begin(event.pointerId, event.clientX, event.clientY);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (stageRef.current !== 'archive') { swipe.cancel(); return; }
      const delta = swipe.move(event.pointerId, event.clientX, event.clientY);
      if (delta === null) return;
      event.preventDefault(); event.stopImmediatePropagation();
      suppressClickUntil = performance.now() + 450;
      if (shell && !shell.hasPointerCapture(event.pointerId)) shell.setPointerCapture(event.pointerId);
      if (target <= 0 && delta < 0 || target >= 1 && delta > 0) return;
      // A viewport-relative travel keeps short mobile swipes responsive while
      // preserving partial progress and exact reversal on the same gesture.
      const distance = Math.max(320, Math.min(640, innerHeight * .72));
      change(target + delta / distance);
    };
    const onPointerEnd = (event: PointerEvent) => {
      if (!swipe.end(event.pointerId)) return;
      if (shell?.hasPointerCapture(event.pointerId)) shell.releasePointerCapture(event.pointerId);
      event.preventDefault(); event.stopImmediatePropagation();
      suppressClickUntil = performance.now() + 450;
    };
    const onSwipeClick = (event: MouseEvent) => {
      if (event.detail && performance.now() < suppressClickUntil && event.target instanceof Element && shell?.contains(event.target)) {
        if (event.target.closest('button,a,input,select,textarea,[role="slider"]') && !event.target.closest('[data-orbit-card],[data-scroll-cue]')) return;
        event.preventDefault(); event.stopImmediatePropagation();
      }
    };
    const enter = () => change(1);
    const back = () => change(0);
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointermove', onPointerMove, {passive: false, capture: true});
    window.addEventListener('pointerup', onPointerEnd, true);
    window.addEventListener('pointercancel', onPointerEnd, true);
    window.addEventListener('click', onSwipeClick, true);
    window.addEventListener('wheel', onWheel, {passive: false, capture: true});
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('portfolio-scroll-enter', enter);
    window.addEventListener('portfolio-scroll-return', back);
    const cleanup = () => {
      cancelAnimationFrame(raf); timeline?.kill();
      gsap.set(cards, {clearProps: 'opacity'});
      gsap.set(root, {clearProps: 'opacity,transform'});
      gsap.set(frame, {clearProps: 'opacity'});
      swipe.cancel();
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('pointerup', onPointerEnd, true);
      window.removeEventListener('pointercancel', onPointerEnd, true);
      window.removeEventListener('click', onSwipeClick, true);
      window.removeEventListener('wheel', onWheel, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('portfolio-scroll-enter', enter);
      window.removeEventListener('portfolio-scroll-return', back);
    };
    scrollCleanup.current = cleanup;
    return cleanup;
  }, [scrubEnabled, reducedMotion, resetOrbitHover, theme]);

  const currentIndex = Math.min(metaIndex, Math.max(0, published.length - 1));
  const currentCollection = published[currentIndex];
  useEffect(() => {
    const info = workInfoRef.current;
    const frame = frameRef.current;
    if (!info || !frame) return;
    const measure = () => controllerRef.current?.setCaptionTop(info.getBoundingClientRect().top - frame.getBoundingClientRect().top);
    const observer = new ResizeObserver(measure);
    observer.observe(info);
    observer.observe(frame);
    measure();
    return () => observer.disconnect();
  }, [currentIndex, ready]);
  const open = stage === 'release';
  const transitioning = stage === 'focus' || stage === 'selected';
  const canReturnToEntrance = entrancePhase === 'complete' && stage === 'archive' && orbitPhase === 'complete';
  const entranceActive = entranceMode !== 'standard' && entrancePhase !== 'complete';
  return (
    <section
      className={styles.shell}
      data-stage={stage}
      data-theme={theme}
      data-ready={ready}
      data-entrance-mode={entranceMode}
      data-entrance-phase={entrancePhase}
      data-orbit-phase={orbitPhase}
      aria-label="精选影像画框"
    >
      <div
        ref={frameRef}
        className={styles.sceneFrame}
        tabIndex={isOrbitEntrance && orbitPhase !== 'complete' ? -1 : 0}
        role="application"
        aria-label="精选作品陈列，拖动或滚动浏览，点击画框播放"
        onPointerDown={dismissActiveHint}
        onWheel={dismissActiveHint}
        onKeyDown={(event) => {
          if (['ArrowLeft', 'ArrowRight', 'Enter', ' ', 'Spacebar', 'Escape'].includes(event.key)) {
            dismissActiveHint();
          }
        }}
      />

      {isOrbitEntrance && (
        <div
          ref={orbitRef}
          className={styles.orbitEntrance}
          data-phase={orbitPhase}
          aria-hidden={orbitPhase === 'complete'}
          onPointerMove={handleOrbitPointerMove}
          onPointerLeave={resetOrbitHover}
        >
          <span ref={orbitPointerRef} className={styles.orbitPointer} data-visible="false" aria-hidden="true" />
          <div className={styles.orbitCards}>
            {orbitCards.map((card, index) => {
              const selected = card.id === selectedOrbitCardId;
              const selectedIndex = selectedOrbitCardId
                ? orbitCards.findIndex((item) => item.id === selectedOrbitCardId)
                : index;
              const style = {
                '--card-delay': `${(index % 12) * 28}ms`,
                '--fold-delay': `${Math.abs(index - (orbitCards.length - 1) / 2) * 4}ms`,
                '--gather-delay': `${Math.min(Math.abs(index - selectedIndex), 12) * 10}ms`,
                backgroundImage: card.image.startsWith('/') ? `url("${card.image}")` : undefined,
                backgroundPosition: `${card.focus[0] * 100}% ${card.focus[1] * 100}%`,
                backgroundSize: 'cover',
              } as CSSProperties;
              const coverStyle = {
                backgroundImage: card.railCover.startsWith('/') ? `url("${card.railCover}")` : undefined,
                backgroundPosition: `${card.railFocus[0] * 100}% ${card.railFocus[1] * 100}%`,
              } as CSSProperties;
              return (
                <button
                  type="button"
                  key={card.id}
                  className={styles.orbitCard}
                  data-orbit-card
                  data-work-id={card.id}
                  data-orbit-index={index}
                  data-selected={selected ? 'true' : 'false'}
                  style={style}
                  onClick={() => startOrbitEntrance(card)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      startOrbitEntrance(card);
                    }
                  }}
                  disabled={orbitPhase !== 'orbit'}
                  aria-label={`查看精选：${card.title}`}
                >
                  <i style={coverStyle} />
                </button>
              );
            })}
          </div>

          <header className={styles.orbitSlogan}>
            <h1>
              <VaporType text="影像是入口" active={orbitPhase === 'orbit'} />
              <VaporType text="共鸣是延续" active={orbitPhase === 'orbit'} delayMs={180} />
            </h1>
            
          </header>

          <p className={styles.orbitInstruction}>
            <span>{orbitPhase === 'orbit' ? 'SELECT A WORK' : 'FORMING THE ARCHIVE'}</span>
            <b>{String(orbitCards.length).padStart(2, '0')} WORKS &#8599;</b>
          </p>
        </div>
      )}

      <button
        type="button"
        className={styles.returnToEntrance}
        data-visible={canReturnToEntrance ? 'true' : 'false'}
        onClick={returnToEntrance}
        aria-label="返回首页"
        aria-hidden={!canReturnToEntrance}
        tabIndex={canReturnToEntrance ? 0 : -1}
      >
        <span aria-hidden="true">&#8592;</span>
        <b className={styles.returnLong}>返回首页</b>
        <b className={styles.returnShort}>返回</b>
      </button>

      {orbitPhase === 'orbit' && <button className={styles.scrollCue} data-scroll-cue onClick={() => window.dispatchEvent(new CustomEvent('portfolio-scroll-enter'))}>向下滑动 <span>↓</span></button>}
      {orbitPhase === 'complete' && <button className={styles.moreButton} onClick={onMore}>更多 <span>↗</span></button>}
      <nav className={styles.accessibleWorks} aria-label="精选画框作品" inert={orbitPhase !== 'complete'}>{published.map((item,index)=><button key={item.id} onClick={()=>controllerRef.current?.openCase(index)}>打开画框：{item.titleZh}</button>)}</nav>
      <section ref={workInfoRef} className={styles.workInfo} data-open={open ? 'true' : 'false'} aria-hidden={!open} inert={!open}>
        <h1>{currentCollection?.titleZh}</h1>
        <p>{currentCollection?.year}{currentCollection?.medium ? ` ／ ${currentCollection.medium}` : ''}</p>
        {currentCollection?.descriptionZh && <small>{currentCollection.descriptionZh}</small>}
        <div className={styles.frameActions}>
          <button onClick={()=>controllerRef.current?.togglePlayback()}>{videoState.playing ? '暂停' : '播放'}</button>
          <button onClick={()=>controllerRef.current?.toggleMute()}>{videoState.muted ? '开启声音' : '关闭声音'}</button>

        </div>
        <label className={styles.videoTimeline}>
          <span>{Math.floor(videoProgress.currentTime / 60)}:{String(Math.floor(videoProgress.currentTime % 60)).padStart(2, '0')}</span>
          <input type="range" aria-label="影片播放进度" min={0} max={videoProgress.duration || 1} step={0.1}
            value={Math.min(videoProgress.currentTime, videoProgress.duration || 1)} disabled={!videoProgress.duration}
            onChange={event => controllerRef.current?.seekVideo(Number(event.currentTarget.value))} />
          <span>{Math.floor(videoProgress.duration / 60)}:{String(Math.floor(videoProgress.duration % 60)).padStart(2, '0')}</span>
        </label>
      </section>
      <button className={styles.closeFrame} aria-label="关闭影片" hidden={!open} onClick={() => controllerRef.current?.closeSelected()}>×</button>
      <div
        className={styles.loadingVeil}
        data-ready={ready ? 'true' : 'false'}
        aria-hidden="true"
      >

      </div>

      <p className={styles.srOnly} aria-live="polite">
        {currentCollection?.titleZh ?? '精选影像'}，第 {currentIndex + 1} 部，共 {published.length} 部。
        {entranceActive
          ? ' 正在入场。'
          : open
            ? ' 画框已打开。'
            : transitioning
              ? ' 画框展开中。'
              : ' 画框已关闭。'}
      </p>
    </section>
  );
}
