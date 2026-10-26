// Adapted from lowkey-archive-template, Copyright (c) 2026 The Lowkey Archive Template Contributors, MIT License.
// data shape consumed by the rail scene (after the page-level adapter
// strips the published-only filter and projects the right fields)

import type {
  ArtworkFit,
  ArtworkMatte,
  ArtworkPresentation,
  ResolvedFrameTheme,
  ShellKey,
} from '../data';

export interface RailWork {
  id: string;
  title: string;
  titleZh: string;
  image: string;
  year: string;
  medium: string;
  order: number;
  presentation: Required<ArtworkPresentation>;
}

export interface RailCollection {
  index: number;            // position in the rail, 0..N-1
  id: string;               // stable kebab-case (for click → series)
  title: string;            // English title (skill template uses `title`)
  titleZh: string;
  year: string;             // string for the template's 4-digit-or-'—' format
  medium: string;           // category
  shell: ShellKey;
  palette: [string, string, string];
  videoSrc?: string;
  cover: string;           // artwork insert used inside the acrylic case
  coverWorkId: string | null;
  coverFit: ArtworkFit;
  coverFocus: [number, number]; // normalized focal point for local cover cropping
  coverMatte: ArtworkMatte;
  coverZoom: number;
  frameTheme: ResolvedFrameTheme;
  works: RailWork[];
  status: 'published' | 'draft' | 'archived';
}

// Scene state reported to React. `focus` is used only while reversing the
// continuous open animation; the user-facing flow is archive → release.
export type SceneStage = 'archive' | 'selected' | 'focus' | 'release' | 'series';

export type EntranceMode = 'standard' | 'unfold' | 'orbit';
export type EntranceStyle = 'stack' | 'single';
export type EntrancePhase = 'loading' | 'closed' | 'inspecting' | 'unfolding' | 'folding' | 'complete';

export interface SceneOptions {
  theme?: 'dark' | 'light';
  entranceMode?: Exclude<EntranceMode, 'orbit'>;
  entranceStyle?: EntranceStyle;
}

export interface SceneCallbacks {
  onFeedback?: (kind: 'click' | 'hover') => void;
  onMotion?: (velocity: number) => void;
  onStageChange?: (stage: SceneStage, index: number) => void;
  onEnterSeries?: (id: string) => void;
  onSceneReady?: () => void;
  onVideoState?: (playing: boolean, muted: boolean) => void;
  onVideoProgress?: (progress: { currentTime: number; duration: number }) => void;
  onEntrancePhaseChange?: (phase: EntrancePhase, index: number) => void;
  onEntranceComplete?: () => void;
}
