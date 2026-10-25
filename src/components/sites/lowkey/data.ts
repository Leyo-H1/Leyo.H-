// LOWKEY Archive Template — public content model and demo catalogue.
// Replace the demo collections with your own published content. Keep private
// drafts outside this module: everything imported here is shipped to clients.

export type CollectionStatus = 'published' | 'draft' | 'archived';
export type ArtworkFit = 'cover' | 'contain';
export type ArtworkMatte = 'ivory' | 'graphite' | 'transparent';

export interface ArtworkPresentation {
  fit?: ArtworkFit;
  focus?: [number, number];
  matte?: ArtworkMatte;
  zoom?: number;
}

export type FrameThemeMode = 'auto' | 'manual';
export type FrameTrayTone = 'ivory' | 'graphite' | 'clear';
export type FrameHardwareTone = 'silver' | 'gunmetal';

export interface FrameTheme {
  mode: FrameThemeMode;
  edgeColor?: string;
  spineColor?: string;
  trayTone?: FrameTrayTone;
  hardwareTone?: FrameHardwareTone;
  colorIntensity?: number;
}

export interface ResolvedFrameTheme {
  mode: FrameThemeMode;
  edgeColor: string;
  spineColor: string;
  trayTone: FrameTrayTone;
  hardwareTone: FrameHardwareTone;
  colorIntensity: number;
}

export type MaterialPreset =
  | 'clear-acrylic'
  | 'frosted-acrylic'
  | 'smoked-glass'
  | 'amber-resin'
  | 'dichroic-film'
  | 'ice-blue-glass'
  | 'milky-translucent'
  | 'negative-film'
  | 'metal-mesh-inlay'
  | 'pearlescent-film';

export interface Work {
  id: string;
  image: string;
  titleZh: string;
  titleEn: string;
  oneLineZh: string;
  oneLineEn: string;
  storyZh: string;
  storyEn: string;
  year: number;
  medium: string;
  dimensions?: string;
  credits?: string;
  order: number;
  presentation?: ArtworkPresentation;
}

export type VinylVariant = 'archive' | 'reliquary' | 'nocturne' | 'cobalt';

export interface VinylTheme {
  variant?: VinylVariant;
  discColor?: string;
  labelColor?: string;
  labelInk?: string;
  accentColor?: string;
  jewelColor?: string;
  imprint?: string;
  rotationSeconds?: number;
}

export interface SeriesAudio {
  src: string;
  title: string;
  label?: string;
  loop?: boolean;
  volume?: number;
  vinylTheme?: VinylTheme;
}

export type ShellKey =
  | 'clear'
  | 'frosted'
  | 'smoked'
  | 'paleIce'
  | 'ice'
  | 'amber'
  | 'dichroic'
  | 'milky';

export interface Collection {
  videoSrc?: string;
  id: string;
  slug: string;
  titleZh: string;
  titleEn: string;
  year: number;
  category: string;
  medium: string;
  shell: ShellKey;
  palette: [string, string, string];
  materialPreset: MaterialPreset;
  cover: string;
  coverWorkId?: string;
  coverFit?: ArtworkFit;
  coverFocus?: [number, number];
  coverMatte?: ArtworkMatte;
  coverZoom?: number;
  frameTheme?: FrameTheme;
  descriptionZh: string;
  descriptionEn: string;
  status: CollectionStatus;
  order: number;
  seriesStoryZh?: string[];
  seriesStoryEn?: string[];
  processZh?: string;
  processEn?: string;
  audio?: SeriesAudio;
  works: Work[];
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const relativeLuminance = (hex: string): number => {
  const normalized = hex.replace('#', '');
  if (!/^[\da-f]{6}$/i.test(normalized)) return 0.5;
  const channels = [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((channel) => channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
};

export function resolveFrameTheme(collection: Collection): ResolvedFrameTheme {
  const theme = collection.frameTheme;
  const edgeColor = theme?.edgeColor ?? collection.palette[1];
  const spineColor = theme?.spineColor ?? collection.palette[2];
  const paletteIsDark = relativeLuminance(collection.palette[1]) < 0.34;
  return {
    mode: theme?.mode ?? 'auto',
    edgeColor,
    spineColor,
    trayTone: theme?.trayTone ?? (paletteIsDark ? 'graphite' : 'ivory'),
    hardwareTone: theme?.hardwareTone ?? (paletteIsDark ? 'gunmetal' : 'silver'),
    colorIntensity: clamp01(theme?.colorIntensity ?? 0.72),
  };
}

export function getCollectionCoverWork(collection: Collection): Work | null {
  const orderedWorks = collection.works.slice().sort((a, b) => a.order - b.order);
  return orderedWorks.find((item) => item.id === collection.coverWorkId) ?? orderedWorks[0] ?? null;
}

export interface ResolvedCollectionCover {
  image: string;
  workId: string | null;
  fit: ArtworkFit;
  focus: [number, number];
  matte: ArtworkMatte;
  zoom: number;
}

export function resolveCollectionCover(collection: Collection): ResolvedCollectionCover {
  const selectedWork = getCollectionCoverWork(collection);
  const promoteSelectedWork = Boolean(collection.coverWorkId && selectedWork);
  return {
    image: (promoteSelectedWork ? selectedWork?.image : collection.cover) || selectedWork?.image || '',
    workId: promoteSelectedWork ? selectedWork?.id ?? null : null,
    fit: collection.coverFit ?? selectedWork?.presentation?.fit ?? 'cover',
    focus: collection.coverFocus ?? selectedWork?.presentation?.focus ?? [0.5, 0.5],
    matte: collection.coverMatte ?? selectedWork?.presentation?.matte ?? 'transparent',
    zoom: Math.min(3, Math.max(0.65, collection.coverZoom ?? 1)),
  };
}

