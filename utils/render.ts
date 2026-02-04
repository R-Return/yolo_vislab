import { ImageItem, VisualizationConfig, BoxType, RenderResult } from '../types';
import { parseYoloFile, calculateMatches } from './yolo';

/**
 * Draws the visualization for a single image onto a canvas context.
 * Uses Aspect Fit (Letterbox) to ensure the full image is visible.
 */
export const drawVisualization = async (
  ctx: CanvasRenderingContext2D,
  item: ImageItem,
  config: VisualizationConfig,
  targetWidth: number,
  targetHeight: number,
  img?: HTMLImageElement
): Promise<RenderResult> => {
  // 1. Load Image
  let imageElement = img;
  if (!imageElement) {
    imageElement = new Image();
    imageElement.src = URL.createObjectURL(item.file);
    await new Promise((resolve) => {
      imageElement!.onload = resolve;
    });
  }

  // 2. Calculate Aspect Fit Dimensions
  const imgW = imageElement.naturalWidth;
  const imgH = imageElement.naturalHeight;
  const scale = Math.min(targetWidth / imgW, targetHeight / imgH);
  
  const drawW = imgW * scale;
  const drawH = imgH * scale;
  const offsetX = (targetWidth - drawW) / 2;
  const offsetY = (targetHeight - drawH) / 2;

  // Clear background
  ctx.fillStyle = '#1e293b'; // Slate 800
  ctx.fillRect(0, 0, targetWidth, targetHeight);

  // Draw Image
  ctx.drawImage(imageElement, offsetX, offsetY, drawW, drawH);

  // 3. Parse and Calculate Matches
  const gtBoxes = item.gtFile ? await parseYoloFile(item.gtFile) : [];
  const predBoxes = item.predFile ? await parseYoloFile(item.predFile) : [];
  const renderBoxes = calculateMatches(gtBoxes, predBoxes, config);

  // 4. Draw Boxes
  ctx.lineWidth = config.lineWidth;
  ctx.font = 'bold 16px sans-serif';

  renderBoxes.forEach((box) => {
    // Transform coordinates: Normalized (0-1) -> Image Space -> Screen Space
    const boxX_img = (box.x - box.w / 2) * imgW;
    const boxY_img = (box.y - box.h / 2) * imgH;
    const boxW_img = box.w * imgW;
    const boxH_img = box.h * imgH;

    const x = offsetX + boxX_img * scale;
    const y = offsetY + boxY_img * scale;
    const w = boxW_img * scale;
    const h = boxH_img * scale;

    ctx.strokeStyle = box.color;
    ctx.setLineDash(box.dashed ? [6, 4] : []); // Dash pattern 6px line, 4px space

    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.stroke();
    
    // Reset Dash for text
    ctx.setLineDash([]);

    // Draw Labels
    let label = '';
    if (box.type === BoxType.FN) {
      label = `GT ${box.classId}`; 
    } else if (box.type === BoxType.TP_GT) {
      label = `GT ${box.classId}`;
    } else {
      const conf = box.confidence !== undefined ? box.confidence.toFixed(2) : '1.00';
      label = `${box.type.replace('_PRED', '')} ${conf}`; 
    }

    const textMetrics = ctx.measureText(label);
    const textHeight = 16;
    const padding = 4;

    // Draw background for text
    ctx.fillStyle = box.color;
    ctx.fillRect(x, y - textHeight - padding, textMetrics.width + padding * 2, textHeight + padding);

    ctx.fillStyle = '#000000'; // Text color black for better contrast on bright box colors
    ctx.fillText(label, x + padding, y - 4);
  });

  // Clean up
  if (!img) {
     URL.revokeObjectURL(imageElement.src);
  }

  // Calculate stats based on PRED types mostly
  // Note: TP_PRED count might be > GT count now.
  const stats = {
    tp: renderBoxes.filter((b) => b.type === BoxType.TP_PRED).length,
    fp: renderBoxes.filter((b) => b.type === BoxType.FP).length,
    fn: renderBoxes.filter((b) => b.type === BoxType.FN).length,
  };

  // 5. Draw Stats in Top Right
  const statsText = `TP:${stats.tp} FN:${stats.fn} FP:${stats.fp}`;
  ctx.font = 'bold 14px monospace';
  const statsWidth = ctx.measureText(statsText).width + 20;
  
  // Background for stats
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.fillRect(targetWidth - statsWidth - 10, 10, statsWidth, 24);
  
  let currentX = targetWidth - statsWidth - 5;
  const drawStat = (text: string, color: string) => {
      ctx.fillStyle = color;
      ctx.fillText(text, currentX, 27);
      currentX += ctx.measureText(text).width + 10;
  };

  drawStat(`TP:${stats.tp}`, config.styles.tpPred.color);
  drawStat(`FN:${stats.fn}`, config.styles.fn.color);
  drawStat(`FP:${stats.fp}`, config.styles.fp.color);

  // 6. Draw Filename in Top Left
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  const nameWidth = ctx.measureText(item.name).width + 16;
  ctx.fillRect(10, 10, nameWidth, 24);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(item.name, 18, 27);

  return { stats };
};