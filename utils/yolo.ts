import { BoundingBox, BoxType, RenderBox, VisualizationConfig, ImageItem } from '../types';

/**
 * Parses a YOLO format string into BoundingBox objects.
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
 * Denominator is Area of Prediction Box.
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
  const predArea = (b1_x2 - b1_x1) * (b1_y2 - b1_y1);

  if (predArea === 0) return 0;
  return intersectionArea / predArea;
};

/**
 * Processes GT and Pred boxes using IoP and Many-to-One matching.
 * Multiple Predictions can match the same GT (all counted as TPs).
 */
export const calculateMatches = (
  gtBoxes: BoundingBox[],
  predBoxes: BoundingBox[],
  config: VisualizationConfig
): RenderBox[] => {
  const result: RenderBox[] = [];
  const matchedGtIndices = new Set<number>();
  
  const validPreds = predBoxes.filter(p => (p.confidence || 1) >= config.confThreshold);
  // Sort preds by confidence
  const sortedPreds = [...validPreds].sort((a, b) => (b.confidence || 0) - (a.confidence || 0));

  // 1. Check every prediction against all GTs
  sortedPreds.forEach((pred) => {
    let bestIoP = 0;
    let bestGtIdx = -1;

    gtBoxes.forEach((gt, gtIdx) => {
      // We do NOT check if GT is already matched. Multiple preds can match one GT.
      if (gt.classId !== pred.classId) return; 

      const iop = calculateIoP(pred, gt);
      if (iop > bestIoP) {
        bestIoP = iop;
        bestGtIdx = gtIdx;
      }
    });

    if (bestIoP >= config.iopThreshold && bestGtIdx !== -1) {
      // True Positive Prediction
      matchedGtIndices.add(bestGtIdx); // Mark GT as "found" for FN calculation
      
      result.push({ 
        ...pred, 
        type: BoxType.TP_PRED, 
        color: config.styles.tpPred.color,
        dashed: config.styles.tpPred.dashed
      });

      // Add the matched GT for visualization context
      // We might add the same GT multiple times if multiple preds match it, 
      // but Render loop should handle overdraw (or we can dedupe here).
      // Let's allow overdraw to ensure every TP_PRED has a visual partner pair.
      const matchedGt = gtBoxes[bestGtIdx];
      result.push({
        ...matchedGt,
        type: BoxType.TP_GT,
        color: config.styles.tpGt.color,
        dashed: config.styles.tpGt.dashed
      });

    } else {
      // False Positive Prediction (Not inside any GT)
      result.push({ 
        ...pred, 
        type: BoxType.FP, 
        color: config.styles.fp.color,
        dashed: config.styles.fp.dashed
      });
    }
  });

  // 2. Determine False Negatives (GTs that were never hit)
  gtBoxes.forEach((gt, idx) => {
    if (!matchedGtIndices.has(idx)) {
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
 * Calculates Precision-Recall curve data for the entire dataset.
 * Precision = (Preds that fall inside a GT) / (Total Preds)
 * Recall = (Unique GTs that have at least one Pred inside) / (Total Unique GTs)
 */
export const calculatePRStats = async (
  items: ImageItem[],
  iopThreshold: number
): Promise<PRPoint[]> => {
  // 1. Gather all GTs and Preds from all items
  // Structure: For each item, list of GTs and list of Preds
  const dataset = await Promise.all(items.map(async item => {
    const gts = item.gtFile ? await parseYoloFile(item.gtFile) : [];
    const preds = item.predFile ? await parseYoloFile(item.predFile) : [];
    return { gts, preds };
  }));

  const totalGtCount = dataset.reduce((acc, d) => acc + d.gts.length, 0);
  if (totalGtCount === 0) return [];

  // 2. Generate Thresholds (0.0 to 1.0)
  const steps = 20; // 0.05 increments
  const results: PRPoint[] = [];

  for (let i = 0; i <= steps; i++) {
    const conf = i / steps;
    
    let totalPreds = 0;
    let correctPreds = 0; // Precision Numerator (Pred matches a GT)
    let gtsFound = 0;     // Recall Numerator (GT has at least one match)

    for (const data of dataset) {
      const validPreds = data.preds.filter(p => (p.confidence || 0) >= conf);
      totalPreds += validPreds.length;

      // Track which GTs in this image are hit
      const gtsHitInImage = new Set<number>();
      
      validPreds.forEach(pred => {
        let isMatch = false;
        data.gts.forEach((gt, gtIdx) => {
          if (gt.classId === pred.classId && calculateIoP(pred, gt) >= iopThreshold) {
            isMatch = true;
            gtsHitInImage.add(gtIdx);
          }
        });
        if (isMatch) correctPreds++;
      });

      gtsFound += gtsHitInImage.size;
    }

    const precision = totalPreds === 0 ? 1 : correctPreds / totalPreds;
    const recall = gtsFound / totalGtCount;
    const f1 = (precision + recall) === 0 ? 0 : 2 * (precision * recall) / (precision + recall);

    results.push({
      confidence: conf,
      precision,
      recall,
      f1
    });
  }

  // Return sorted by Recall (ascending) for plotting usually, but Conf (desc) is better for tracing
  return results.sort((a, b) => b.confidence - a.confidence);
};