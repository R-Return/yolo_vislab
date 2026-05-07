export interface BoundingBox {
  classId: number;
  x: number; // center x (0-1)
  y: number; // center y (0-1)
  w: number; // width (0-1)
  h: number; // height (0-1)
  confidence?: number;
}

export enum BoxType {
  TP_PRED = 'TP_PRED', // True Positive (The Prediction Box)
  TP_GT = 'TP_GT',     // True Positive (The Matched GT Box)
  FP = 'FP',           // False Positive
  FN = 'FN',           // False Negative
}

export interface RenderBox extends BoundingBox {
  type: BoxType;
  color: string;
  dashed: boolean;
}

export interface BoxStyle {
  color: string;
  dashed: boolean;
}

export type ViewMode = 'grid' | 'pr-curve';
export type AspectRatio = '16:9' | '4:3' | '1:1' | 'auto';

/** How prediction–GT box overlap is scored for matching (TP/FP and PR curves). */
export type MatchOverlapMetric = 'iou' | 'iomin';

export interface VisualizationConfig {
  matchOverlapMetric: MatchOverlapMetric;
  /** Minimum overlap score vs. a same-class GT to count as a match (IoU or IoMin, depending on metric). */
  matchOverlapThreshold: number;
  /**
   * Per-class greedy NMS on predictions: boxes with pairwise IoU above this value are suppressed (lower confidence dropped).
   * Applied after the confidence threshold; independent of match overlap metric/threshold vs. ground truth.
   */
  nmsIouThreshold: number;
  confThreshold: number;
  styles: {
    tpPred: BoxStyle;
    tpGt: BoxStyle;
    fp: BoxStyle;
    fn: BoxStyle;
  };
  lineWidth: number;
  labelFontSize: number;
  gridSize: 9 | 16;
  aspectRatio: AspectRatio;
  zoomLevel: number;
  viewMode: ViewMode;
  editHighlightColor?: string;
  audio?: {
    minFreq?: number; // Background filter cutoff
    maxFreq?: number; // Background filter cutoff
    highlightColor?: string; // Box color when playing
    clipSec?: number; // How many seconds the image represents
    strideSec?: number; // How many seconds between images
    playbackSpeed?: number; // Global playback speed multiplier
  };
  showLabels?: boolean;
  showPredictions?: boolean;
}

export interface FileMap {
  [filename: string]: File | FileSystemFileHandle;
}

export interface LabelMap {
  [filename: string]: BoundingBox[];
}

export interface ImageItem {
  name: string;
  file: File | FileSystemFileHandle;
  gtData?: BoundingBox[];
  /** Optional raw primary preds (legacy / render fallback); grid uses `predictions` from loaded sources. */
  predData?: BoundingBox[];
  predictions?: { sourceId: string, boxes: BoundingBox[], color: string, visible: boolean }[];
  isModified?: boolean;
  isSaved?: boolean;
}

export interface FileCollection {
  id: string;
  name: string;
  type: 'images' | 'labels';
  files: FileMap;
  labels?: LabelMap; // Pre-loaded labels
  count: number;
}

export interface PredictionSource {
  id: string;
  name: string;
  path: string;
  color: string;
  visible: boolean;
  labels: LabelMap;
  groupId?: string;
}

export interface Project {
  id: string;
  name: string;
  config: VisualizationConfig;
  // Shared Library References
  imageCollectionId: string | null;
  gtCollectionId: string | null;
  // Project-Specific Data
  predictionSources: PredictionSource[];
  imagePath?: string;
  gtPath?: string;
  audioPath?: string;
}

export interface HitRegion {
  type: BoxType;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RenderResult {
  stats: {
    tp: number;
    fp: number;
    fn: number;
  };
  hitRegions: HitRegion[];
  boxes?: RenderBox[]; // Return boxes for caching
}