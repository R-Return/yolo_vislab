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

export interface VisualizationConfig {
  iopThreshold: number; // Changed from iouThreshold
  confThreshold: number;
  styles: {
    tpPred: BoxStyle;
    tpGt: BoxStyle;
    fp: BoxStyle;
    fn: BoxStyle;
  };
  lineWidth: number;
  gridSize: 9 | 16;
  zoomLevel: number;
  viewMode: ViewMode;
}

export interface FileMap {
  [filename: string]: File;
}

export interface ImageItem {
  name: string;
  file: File;
  gtFile?: File;
  predFile?: File;
}

export interface FileCollection {
  id: string;
  name: string;
  type: 'images' | 'labels';
  files: FileMap;
  count: number;
}

export interface Project {
  id: string;
  name: string;
  config: VisualizationConfig;
  // Shared Library References
  imageCollectionId: string | null;
  gtCollectionId: string | null;
  // Project-Specific Data
  predFiles: FileMap;
}

export interface RenderResult {
  stats: {
    tp: number;
    fp: number;
    fn: number;
  };
}