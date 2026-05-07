import { BoundingBox, BoxType, MatchOverlapMetric, RenderBox, VisualizationConfig, ImageItem } from '../types';

/**
 * Parses a YOLO format string into BoundingBox objects.
 * Format: <class_id> <cx> <cy> <w> <h> [confidence]
 */
export const parseYoloFile = async (file: File | FileSystemFileHandle): Promise<BoundingBox[]> => {
  let text = '';
  if (file instanceof File) {
    text = await file.text();
  } else {
    const f = await (file as FileSystemFileHandle).getFile();
    text = await f.text();
  }

  const lines = text.trim().split('\n');

  return lines
    .map((line): BoundingBox | null => {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 5) return null;
      return {
        classId: parseInt(parts[0], 10),
        x: parseFloat(parts[1]),
        y: parseFloat(parts[2]),
        w: parseFloat(parts[3]),
        h: parseFloat(parts[4]),
        confidence: parts[5] ? parseFloat(parts[5]) : 1.0,
      };
    })
    .filter((box): box is BoundingBox => box !== null);
};

/**
 * Reads all .txt files from a FileMap and parses them into a LabelMap.
 */
export const preloadLabels = async (fileMap: { [name: string]: File | FileSystemFileHandle }): Promise<{ [name: string]: BoundingBox[] }> => {
  const labelMap: { [name: string]: BoundingBox[] } = {};
  await Promise.all(Object.entries(fileMap).map(async ([name, file]) => {
    if (name.endsWith('.txt')) {
      labelMap[name] = await parseYoloFile(file);
    }
  }));
  return labelMap;
};

const intersectAndAreas = (
  pred: BoundingBox,
  gt: BoundingBox
): { intersectionArea: number; predArea: number; gtArea: number } => {
  const b1_x1 = pred.x - pred.w / 2;
  const b1_y1 = pred.y - pred.h / 2;
  const b1_x2 = pred.x + pred.w / 2;
  const b1_y2 = pred.y + pred.h / 2;

  const b2_x1 = gt.x - gt.w / 2;
  const b2_y1 = gt.y - gt.h / 2;
  const b2_x2 = gt.x + gt.w / 2;
  const b2_y2 = gt.y + gt.h / 2;

  const x1 = Math.max(b1_x1, b2_x1);
  const y1 = Math.max(b1_y1, b2_y1);
  const x2 = Math.min(b1_x2, b2_x2);
  const y2 = Math.min(b1_y2, b2_y2);

  const predArea = pred.w * pred.h;
  const gtArea = gt.w * gt.h;

  if (x2 < x1 || y2 < y1) {
    return { intersectionArea: 0, predArea, gtArea };
  }

  const intersectionArea = (x2 - x1) * (y2 - y1);
  return { intersectionArea, predArea, gtArea };
};

/** Standard IoU = intersection / union. */
const calculateIoU = (pred: BoundingBox, gt: BoundingBox): number => {
  const { intersectionArea, predArea, gtArea } = intersectAndAreas(pred, gt);
  const unionArea = predArea + gtArea - intersectionArea;
  if (unionArea <= 0) return 0;
  return intersectionArea / unionArea;
};

/**
 * Greedy per-class NMS: sort by confidence (high first), keep a box unless it has IoU > threshold
 * with any already-kept box of the same class.
 */
export const applyNmsIou = (boxes: BoundingBox[], iouThreshold: number): BoundingBox[] => {
  if (boxes.length === 0) return [];
  const byClass = new Map<number, BoundingBox[]>();
  for (const b of boxes) {
    const list = byClass.get(b.classId) ?? [];
    list.push(b);
    byClass.set(b.classId, list);
  }
  const out: BoundingBox[] = [];
  for (const classBoxes of byClass.values()) {
    const sorted = [...classBoxes].sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
    const kept: BoundingBox[] = [];
    for (const cand of sorted) {
      let suppress = false;
      for (const k of kept) {
        if (calculateIoU(cand, k) > iouThreshold) {
          suppress = true;
          break;
        }
      }
      if (!suppress) kept.push(cand);
    }
    out.push(...kept);
  }
  return out;
};

/**
 * IoMin = intersection / min(Area(Pred), Area(GT)).
 * Penalizes misses less when one box is much larger than the other.
 */
const calculateIoMin = (pred: BoundingBox, gt: BoundingBox): number => {
  const { intersectionArea, predArea, gtArea } = intersectAndAreas(pred, gt);
  const minArea = Math.min(predArea, gtArea);
  if (minArea === 0) return 0;
  return intersectionArea / minArea;
};

const overlapScore = (metric: MatchOverlapMetric, pred: BoundingBox, gt: BoundingBox): number =>
  metric === 'iou' ? calculateIoU(pred, gt) : calculateIoMin(pred, gt);

/**
 * Processes GT and Pred boxes for Visualization (Drawing).
 * * Logic for Visualization:
 * - Predictions above the confidence threshold are deduplicated via per-class greedy NMS (NMS IoU setting).
 * - If a Prediction matches *any* GT (overlap >= match threshold), it is visualized as TP (Green).
 * - If a Prediction matches NO GT, it is FP (Red).
 * - If a GT is matched by at least one Pred, it is TP_GT (Green).
 * - If a GT is missed, it is FN (Blue/Yellow).
 */
export const calculateMatches = (
  gtBoxes: BoundingBox[],
  predBoxes: BoundingBox[],
  config: VisualizationConfig
): RenderBox[] => {
  const result: RenderBox[] = [];
  const matchedGtIndices = new Set<number>();
  const { matchOverlapMetric, matchOverlapThreshold } = config;

  const validPreds = predBoxes.filter(p => (p.confidence || 1) >= config.confThreshold);
  const afterNms = applyNmsIou(validPreds, config.nmsIouThreshold);
  const sortedPreds = [...afterNms].sort((a, b) => (b.confidence || 0) - (a.confidence || 0));

  // 1. Check every prediction against all GTs
  sortedPreds.forEach((pred) => {
    let isTp = false;

    gtBoxes.forEach((gt, gtIdx) => {
      if (gt.classId !== pred.classId) return;

      const score = overlapScore(matchOverlapMetric, pred, gt);

      // Visualization Logic: Any match counts as a "Correct Prediction" visually
      if (score >= matchOverlapThreshold) {
        isTp = true;
        matchedGtIndices.add(gtIdx);
      }
    });

    if (isTp) {
      // True Positive Prediction (Matches at least one GT)
      result.push({
        ...pred,
        type: BoxType.TP_PRED,
        color: config.styles.tpPred.color,
        dashed: config.styles.tpPred.dashed
      });
    } else {
      // False Positive Prediction (No overlap with any GT)
      result.push({
        ...pred,
        type: BoxType.FP,
        color: config.styles.fp.color,
        dashed: config.styles.fp.dashed
      });
    }
  });

  // 2. Add GTs (TP_GT or FN)
  gtBoxes.forEach((gt, idx) => {
    if (matchedGtIndices.has(idx)) {
      result.push({
        ...gt,
        type: BoxType.TP_GT,
        color: config.styles.tpGt.color,
        dashed: config.styles.tpGt.dashed
      });
    } else {
      result.push({
        ...gt,
        type: BoxType.FN,
        color: config.styles.fn.color,
        dashed: config.styles.fn.dashed
      });
    }
  });

  return result;
};


export interface PRPoint {
  confidence: number;
  precision: number;
  recall: number;
  f1: number;
}

type PRStatsConfigPick = Pick<VisualizationConfig, 'matchOverlapMetric' | 'matchOverlapThreshold' | 'nmsIouThreshold'>;

const primaryPredictionBoxes = (item: ImageItem): BoundingBox[] => {
  const visible = item.predictions?.filter(p => p.visible) ?? [];
  if (visible.length > 0) return visible[0].boxes;
  return item.predData ?? [];
};

/**
 * Calculates Precision-Recall curve data.
 * * Logic aligned with Python Script:
 * 1. Collect all predictions and GTs.
 * 2. Evaluate at multiple confidence thresholds.
 * 3. Logic:
 * - Overlap metric: IoU or IoMin (threshold applies to chosen metric).
 * - GT Scanning: A GT counts as 1 TP.
 * - Fragmentation: Multiple preds matching one GT -> 1st is TP, others are IGNORED (Duplicate).
 * - GT Reuse: One pred matching multiple GTs -> Can count as TP for both if they are new.
 * - Smoothing: Curve is monotonized (max accumulated).
 */
export const calculatePRStats = async (
  items: ImageItem[],
  prConfig: PRStatsConfigPick
): Promise<PRPoint[]> => {
  const { matchOverlapMetric, matchOverlapThreshold, nmsIouThreshold } = prConfig;
  // 1. Gather all GTs and raw preds per image (primary visible source)
  const dataset = items.map((item, imgIdx) => {
    const gts = item.gtData || [];
    return {
      imgIdx,
      gts: gts.map(g => ({ ...g, used: false })),
      rawPreds: primaryPredictionBoxes(item),
    };
  });

  const totalGtCount = dataset.reduce((acc, d) => acc + d.gts.length, 0);

  if (totalGtCount === 0) return [];

  // 2. Generate Thresholds (Sampling)
  // Use 50 steps for smoother curve (similar to Python's dense plot)
  const steps = 50;
  const rawResults: PRPoint[] = [];

  for (let i = 0; i <= steps; i++) {
    const confThreshold = i / steps;

    const predsAtStep: (BoundingBox & { imgIdx: number })[] = [];
    for (const d of dataset) {
      const passed = d.rawPreds.filter(p => (p.confidence || 0) >= confThreshold);
      for (const p of applyNmsIou(passed, nmsIouThreshold)) {
        predsAtStep.push({ ...p, imgIdx: d.imgIdx });
      }
    }
    predsAtStep.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));

    // Track detected GTs PER IMAGE for this threshold level
    // Map<ImageIndex, Set<GtIndex>>
    const detectedGtsMap = new Map<number, Set<number>>();

    let tp = 0;
    let fp = 0;

    for (const pred of predsAtStep) {
      const imgIdx = pred.imgIdx;
      const gtsInImage = dataset[imgIdx].gts;

      // Ensure we have a set for this image
      if (!detectedGtsMap.has(imgIdx)) {
        detectedGtsMap.set(imgIdx, new Set());
      }
      const detectedSet = detectedGtsMap.get(imgIdx)!;

      // Find Matches
      let matchedAnyGt = false;
      let isNewDiscovery = false;

      // Check against all GTs in the image
      gtsInImage.forEach((gt, gtIdx) => {
        if (gt.classId !== pred.classId) return;

        const score = overlapScore(matchOverlapMetric, pred, gt);

        if (score >= matchOverlapThreshold) {
          matchedAnyGt = true;
          // Check if this GT was already found by a higher confidence pred
          if (!detectedSet.has(gtIdx)) {
            detectedSet.add(gtIdx);
            isNewDiscovery = true;
          }
        }
      });

      if (matchedAnyGt) {
        if (isNewDiscovery) {
          // Found at least one new GT -> True Positive
          tp++;
        } else {
          // Matched GTs, but all were already found -> Duplicate / Redundant
          // Python Logic: Ignore (do not increment FP, do not increment TP)
        }
      } else {
        // Did not match any GT -> False Positive
        fp++;
      }
    }

    const precision = (tp + fp) === 0 ? 1 : tp / (tp + fp);
    const recall = tp / totalGtCount;
    const f1 = (precision + recall) === 0 ? 0 : 2 * (precision * recall) / (precision + recall);

    rawResults.push({
      confidence: confThreshold,
      precision,
      recall,
      f1
    });
  }

  // 3. Monotonic Smoothing (Envelope)
  rawResults.sort((a, b) => b.confidence - a.confidence);

  let maxPrecision = 0;
  for (let i = rawResults.length - 1; i >= 0; i--) {
    maxPrecision = Math.max(maxPrecision, rawResults[i].precision);
    rawResults[i].precision = maxPrecision;
  }

  if (rawResults[0].recall > 0) {
    rawResults.unshift({
      confidence: 1.1,
      precision: 1.0,
      recall: 0.0,
      f1: 0.0
    });
  }

  return rawResults;
};
