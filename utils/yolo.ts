import { BoundingBox, BoxType, RenderBox, VisualizationConfig, ImageItem } from '../types';

/**
 * Parses a YOLO format string into BoundingBox objects.
 * Format: <class_id> <cx> <cy> <w> <h> [confidence]
 */
export const parseYoloFile = async (file: File): Promise<BoundingBox[]> => {
  const text = await file.text();
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
 * Calculates Intersection over Prediction (IoP).
 * IoP = Area(Intersection) / Area(Prediction Box).
 * This allows large predictions that contain small GTs (fragmentation) to be matched.
 */
const calculateIoP = (pred: BoundingBox, gt: BoundingBox): number => {
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

  if (x2 < x1 || y2 < y1) return 0.0;

  const intersectionArea = (x2 - x1) * (y2 - y1);
  
  // CHANGE: Denominator is strictly the Prediction Area
  const predArea = pred.w * pred.h;

  if (predArea === 0) return 0;
  return intersectionArea / predArea;
};

/**
 * Processes GT and Pred boxes for Visualization (Drawing).
 * * Logic for Visualization:
 * - If a Prediction matches *any* GT (IoP >= Threshold), it is visualized as TP (Green).
 * (Even if it is a duplicate detection, we visually show it as correct).
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
  
  const validPreds = predBoxes.filter(p => (p.confidence || 1) >= config.confThreshold);
  // Sort preds by confidence (High -> Low)
  const sortedPreds = [...validPreds].sort((a, b) => (b.confidence || 0) - (a.confidence || 0));

  // 1. Check every prediction against all GTs
  sortedPreds.forEach((pred) => {
    let isTp = false;

    gtBoxes.forEach((gt, gtIdx) => {
      if (gt.classId !== pred.classId) return; 

      const iop = calculateIoP(pred, gt);
      
      // Visualization Logic: Any match counts as a "Correct Prediction" visually
      if (iop >= config.iopThreshold) {
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

/**
 * Calculates Precision-Recall curve data.
 * * Logic aligned with Python Script:
 * 1. Collect all predictions and GTs.
 * 2. Evaluate at multiple confidence thresholds.
 * 3. Logic:
 * - IoP Metric: Intersection / PredArea.
 * - GT Scanning: A GT counts as 1 TP.
 * - Fragmentation: Multiple preds matching one GT -> 1st is TP, others are IGNORED (Duplicate).
 * - GT Reuse: One pred matching multiple GTs -> Can count as TP for both if they are new.
 * - Smoothing: Curve is monotonized (max accumulated).
 */
export const calculatePRStats = async (
  items: ImageItem[],
  iopThreshold: number
): Promise<PRPoint[]> => {
  // 1. Gather all GTs and Preds from all items
  // We need to keep track of which image they belong to for matching
  const dataset = await Promise.all(items.map(async (item, imgIdx) => {
    const gts = item.gtFile ? await parseYoloFile(item.gtFile) : [];
    const preds = item.predFile ? await parseYoloFile(item.predFile) : [];
    return { 
      imgIdx,
      gts: gts.map(g => ({ ...g, used: false })), // 'used' flag isn't strictly needed here as we reset per threshold
      preds: preds.map(p => ({ ...p, imgIdx }))   // flatten preds with image index
    };
  }));

  const allPreds = dataset.flatMap(d => d.preds);
  const totalGtCount = dataset.reduce((acc, d) => acc + d.gts.length, 0);

  if (totalGtCount === 0) return [];

  // Sort all predictions globally by confidence (Desc)
  allPreds.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));

  // 2. Generate Thresholds (Sampling)
  // Use 50 steps for smoother curve (similar to Python's dense plot)
  const steps = 50; 
  const rawResults: PRPoint[] = [];

  for (let i = 0; i <= steps; i++) {
    const confThreshold = i / steps;
    
    // Filter predictions for this threshold
    // Note: They remain sorted by confidence
    const validPreds = allPreds.filter(p => (p.confidence || 0) >= confThreshold);

    // Track detected GTs PER IMAGE for this threshold level
    // Map<ImageIndex, Set<GtIndex>>
    const detectedGtsMap = new Map<number, Set<number>>();
    
    let tp = 0;
    let fp = 0;

    for (const pred of validPreds) {
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

        const iop = calculateIoP(pred, gt);
        
        if (iop >= iopThreshold) {
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
  // Logic: Precision should not increase as Recall decreases.
  // We iterate backwards (from Recall=1 to Recall=0) and keep the max precision seen so far.
  
  // Sort by Recall Descending first (roughly equivalent to Conf ascending)
  // But strictly, we process the list such that for a given recall R, P is max(P(r)) for all r >= R
  
  // Sort by Confidence Descending (High Conf -> Low Recall, High Precision)
  rawResults.sort((a, b) => b.confidence - a.confidence);

  let maxPrecision = 0;
  // Iterate backwards (Low Conf/High Recall -> High Conf/Low Recall)
  for (let i = rawResults.length - 1; i >= 0; i--) {
    maxPrecision = Math.max(maxPrecision, rawResults[i].precision);
    rawResults[i].precision = maxPrecision;
  }

  // 4. Add Anchor Points (0,1) and (1,0) for display aesthetics
  // Insert (Conf=1.0+, P=1, R=0) at start
  if (rawResults[0].recall > 0) {
    rawResults.unshift({
      confidence: 1.1,
      precision: 1.0,
      recall: 0.0,
      f1: 0.0
    });
  }
  
  // Ensure the last point drops to 0 if needed (optional, depends on preference)
  // Usually for PR curves we just want the envelope.

  return rawResults;
};