import React, { useEffect, useRef, useState, useLayoutEffect } from 'react';
import { Download, Loader2, Trash2, Check } from 'lucide-react';
import { ImageItem, VisualizationConfig, BoxType, RenderBox, HitRegion, BoundingBox } from '../types';
import { drawVisualization } from '../utils/render';
import { calculateMatches } from '../utils/yolo';
import { getAudioFilename, extractStartTimeFromFilename } from '../utils/audio';

interface ImageViewerProps {
  item: ImageItem;
  config: VisualizationConfig;
  externalHighlight?: BoxType | null;
  isEditMode?: boolean;
  onUpdateGt?: (fileName: string, newBoxes: BoundingBox[]) => void;
  audioPlayer?: any; // Avoiding circular dependency if possible, or use type
  audioFiles?: Record<string, File | FileSystemFileHandle>;
}

interface DragState {
  mode: 'move' | 'resize' | 'create';
  boxIndex: number; // -1 for create
  startX: number;
  startY: number;
  // Snapshot of the box when drag started
  initialBox?: BoundingBox;
  // For resize: which handle?
  handle?: 'tl' | 'tr' | 'bl' | 'br';
}

const ImageViewer: React.FC<ImageViewerProps> = ({ item, config, externalHighlight, isEditMode, onUpdateGt, audioPlayer, audioFiles }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Local GT state for smooth editing
  const [localGtBoxes, setLocalGtBoxes] = useState<BoundingBox[]>(item.gtData || []);
  const [selectedBoxIdx, setSelectedBoxIdx] = useState<number | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [playingBox, setPlayingBox] = useState<BoundingBox | null>(null);
  const [playhead, setPlayhead] = useState<number | null>(null); // 0 to 1 progress
  const [tempAudioBox, setTempAudioBox] = useState<BoundingBox | null>(null);
  const [contextPredBox, setContextPredBox] = useState<BoundingBox | null>(null);

  // Cache the processed data
  const [cachedData, setCachedData] = useState<{
    img: HTMLImageElement;
    boxes: RenderBox[];
    hitRegions: HitRegion[];
    transform?: { scale: number; offsetX: number; offsetY: number };
  } | null>(null);

  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [hoveredStat, setHoveredStat] = useState<BoxType | null>(null);

  // Sync props to local state when item changes (and not currently dragging/editing locally)
  useEffect(() => {
    setLocalGtBoxes(item.gtData || []);
    setSelectedBoxIdx(null);
    setPlayingBox(null);
    setTempAudioBox(null);
  }, [item, item.gtData]); // Only reset when item specifically changes

  // Close context menu
  useEffect(() => {
    const closeMenu = () => {
      setContextMenu(null);
      setContextPredBox(null);
    };
    if (contextMenu) window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, [contextMenu]);

  // Initial Load & Redraw Effect
  useLayoutEffect(() => {
    let active = true;

    const render = async () => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      let img = cachedData?.img;
      if (!img || img.getAttribute('data-name') !== item.name) {
        setLoading(true);
        img = new Image();
        img.setAttribute('data-name', item.name);
        const file = item.file;
        const url = file instanceof File ? URL.createObjectURL(file) : URL.createObjectURL(await (file as FileSystemFileHandle).getFile());
        img.src = url;
        await new Promise((resolve) => {
          img!.onload = resolve;
          // handle error?
        });
        URL.revokeObjectURL(url); // Revoke after load
      }

      if (!active) return;

      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');

      if (ctx) {
        // Calculate Matches locally using localGtBoxes
        // Filter out Predictions if in Edit Mode to reduce clutter (Requested Feature)
        // Except if showPredInEditMode is enabled
        const currentGt = isEditMode ? localGtBoxes : (item.gtData || []);
        const currentPred = (isEditMode && !config.showPredInEditMode) ? [] : (item.predData || []);

        const renderBoxes = calculateMatches(currentGt, currentPred, config);

        const result = await drawVisualization(ctx, item, config, img.naturalWidth, img.naturalHeight, img, {
          preCalculatedBoxes: renderBoxes,
          highlightType: hoveredStat || externalHighlight
        });

        // Store transform info for mouse mapping
        const transform = { scale: 1.0, offsetX: 0, offsetY: 0 };

        setCachedData({
          img,
          boxes: renderBoxes,
          hitRegions: result.hitRegions,
          transform
        });

        // Draw Editor Overlay
        if (isEditMode) {
          drawEditorOverlay(ctx, renderBoxes, selectedBoxIdx);
        }

        // Draw Playing Highlight
        if (playingBox) {
          drawPlayingHighlight(ctx, playingBox);
        }

        if (tempAudioBox) {
          drawPlayingHighlight(ctx, tempAudioBox);
        }
      }

      setLoading(false);
    };

    render();

    return () => { active = false; };
  }, [item, config, localGtBoxes, isEditMode, hoveredStat, externalHighlight, playingBox, playhead, tempAudioBox]); // Re-render when boxes or playhead change

  // Global Deletion Listener
  useEffect(() => {
    if (!isEditMode || selectedBoxIdx === null) return;

    const onKey = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input field (like Page Jump)
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        const newBoxes = localGtBoxes.filter((_, i) => i !== selectedBoxIdx);
        setLocalGtBoxes(newBoxes);
        setSelectedBoxIdx(null);
        onUpdateGt?.(item.name, newBoxes);
      }
    };

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isEditMode, selectedBoxIdx, localGtBoxes, item, onUpdateGt]);

  // Helper to draw specific box highlight
  const drawPlayingHighlight = (ctx: CanvasRenderingContext2D, box: BoundingBox) => {
    const { width, height } = ctx.canvas;
    const x = box.x * width;
    const y = box.y * height;
    const w = box.w * width;
    const h = box.h * height;

    const highlightColor = config.audio?.highlightColor ?? '#00ff00';

    ctx.save();
    ctx.strokeStyle = highlightColor;
    ctx.lineWidth = 4;
    ctx.shadowColor = highlightColor;
    ctx.shadowBlur = 10;
    ctx.strokeRect(x - w / 2, y - h / 2, w, h);

    // Draw Playhead (progress line)
    if (playhead !== null) {
      const lx = x - w / 2;
      const playX = lx + (w * playhead);
      ctx.beginPath();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.shadowBlur = 0;
      ctx.setLineDash([2, 2]);
      ctx.moveTo(playX, y - h / 2);
      ctx.lineTo(playX, y + h / 2);
      ctx.stroke();
    }

    ctx.restore();
  };


  const drawEditorOverlay = (ctx: CanvasRenderingContext2D, boxes: RenderBox[], selectedIdx: number | null) => {
    // Find the render box corresponding to the selected GT index
    // RenderBox order might differ from localGtBoxes if calculateMatches reorders?
    // calculateMatches returns: [...Predicted(TP/FP), ...GT(TP_GT/FN)]
    // We need to map back to localGtBoxes index?
    // Actually simpler: Just draw the localGtBox geometry by index if selected

    if (selectedIdx === null) return;
    const box = localGtBoxes[selectedIdx];
    if (!box) return;

    const { width, height } = ctx.canvas;
    const x = box.x * width;
    const y = box.y * height;
    const w = box.w * width;
    const h = box.h * height;

    const lx = x - w / 2;
    const ly = y - h / 2;

    ctx.save();

    const highlightColor = config.editHighlightColor || '#fbbf24';

    // 1. Draw Fill (Semi-transparent)
    // Convert hex to rgba for fill
    const r = parseInt(highlightColor.slice(1, 3), 16);
    const g = parseInt(highlightColor.slice(3, 5), 16);
    const b = parseInt(highlightColor.slice(5, 7), 16);
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.15)`;
    ctx.fillRect(lx, ly, w, h);

    // 2. Draw Dash Border (Outer)
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(lx, ly, w, h);

    // 3. Draw Solid Border (Inner/Main)
    ctx.setLineDash([]);
    ctx.strokeStyle = highlightColor;
    ctx.lineWidth = 2;
    ctx.strokeRect(lx, ly, w, h);

    // Draw handles (Larger and more visible)
    const handleSize = 10;
    const handles = [
      { x: lx, y: ly }, // TL
      { x: lx + w, y: ly }, // TR
      { x: lx, y: ly + h }, // BL
      { x: lx + w, y: ly + h } // BR
    ];

    ctx.fillStyle = highlightColor;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    handles.forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });

    ctx.restore();
  };

  // Coordinate Mapping
  const getImgCoords = (e: React.MouseEvent) => {
    if (!canvasRef.current || !cachedData) return { x: 0, y: 0 };
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;

    const cx = (e.clientX - rect.left) * scaleX;
    const cy = (e.clientY - rect.top) * scaleY;

    // Normalized coordinates (0-1)
    const nx = cx / canvasRef.current.width;
    const ny = cy / canvasRef.current.height;

    return { x: nx, y: ny, rawX: cx, rawY: cy };
  };

  // Mouse Handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // Only left click

    // Grab focus so keyboard events target this component correctly if using target listeners
    // (Though we moved to document listener, this is still good practice)
    containerRef.current?.focus();

    const coords = getImgCoords(e);
    const { width, height } = canvasRef.current!;

    if (!isEditMode) {
      if (!cachedData) return;
      let hit: BoundingBox | null = null;
      let minArea = Infinity;

      for (const b of cachedData.boxes) {
        const bx1 = b.x - b.w / 2;
        const bx2 = b.x + b.w / 2;
        const by1 = b.y - b.h / 2;
        const by2 = b.y + b.h / 2;

        if (coords.x >= bx1 && coords.x <= bx2 && coords.y >= by1 && coords.y <= by2) {
          const area = b.w * b.h;
          if (area < minArea) {
            minArea = area;
            hit = b;
          }
        }
      }

      if (hit) {
        setDragState({
          mode: 'move',
          boxIndex: -1,
          startX: coords.x,
          startY: coords.y,
          initialBox: { ...hit }
        });
      } else {
        setDragState({
          mode: 'create',
          boxIndex: -2,
          startX: coords.x,
          startY: coords.y
        });
        setTempAudioBox({ classId: 0, x: coords.x, y: coords.y, w: 0, h: 0, confidence: 1 });
      }
      return;
    }

    // 1. Check ALL GT boxes for handle hits first (to prioritize resizing over selection/creation)
    for (let i = localGtBoxes.length - 1; i >= 0; i--) {
      const b = localGtBoxes[i];
      const lx = (b.x - b.w / 2) * width;
      const ly = (b.y - b.h / 2) * height;
      const rw = b.w * width;
      const rh = b.h * height;

      const handles: Record<'tl' | 'tr' | 'bl' | 'br', { x: number, y: number }> = {
        tl: { x: lx, y: ly },
        tr: { x: lx + rw, y: ly },
        bl: { x: lx, y: ly + rh },
        br: { x: lx + rw, y: ly + rh }
      };

      for (const [key, p] of Object.entries(handles)) {
        const dx = coords.rawX - p.x;
        const dy = coords.rawY - p.y;
        if (Math.sqrt(dx * dx + dy * dy) < 15) { // Slightly larger hit area
          setSelectedBoxIdx(i);
          setDragState({
            mode: 'resize',
            handle: key as any,
            boxIndex: i,
            startX: coords.x,
            startY: coords.y,
            initialBox: { ...b }
          });
          return;
        }
      }
    }

    // 2. Check collision with any GT box body (Reverse order)
    let hit = -1;
    for (let i = localGtBoxes.length - 1; i >= 0; i--) {
      const b = localGtBoxes[i];
      const bx1 = b.x - b.w / 2;
      const bx2 = b.x + b.w / 2;
      const by1 = b.y - b.h / 2;
      const by2 = b.y + b.h / 2;

      if (coords.x >= bx1 && coords.x <= bx2 && coords.y >= by1 && coords.y <= by2) {
        hit = i;
        break;
      }
    }

    if (hit !== -1) {
      setSelectedBoxIdx(hit);
      setDragState({
        mode: 'move',
        boxIndex: hit,
        startX: coords.x,
        startY: coords.y,
        initialBox: { ...localGtBoxes[hit] }
      });
    } else {
      // Begin Create
      const newBox: BoundingBox = {
        classId: 0, // Default Class
        x: coords.x,
        y: coords.y,
        w: 0,
        h: 0,
        confidence: 1.0
      };

      const newBoxes = [...localGtBoxes, newBox];
      setLocalGtBoxes(newBoxes);
      const newIndex = newBoxes.length - 1;

      setSelectedBoxIdx(newIndex);
      setDragState({
        mode: 'create',
        boxIndex: newIndex,
        startX: coords.x,
        startY: coords.y
      });
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getImgCoords(e);

    if (dragState) {
      e.preventDefault();

      if (!isEditMode) {
        if (dragState.mode === 'create' && dragState.boxIndex === -2) {
          const startX = dragState.startX;
          const startY = dragState.startY;
          const currentX = coords.x;
          const currentY = coords.y;

          const minX = Math.min(startX, currentX);
          const maxX = Math.max(startX, currentX);
          const minY = Math.min(startY, currentY);
          const maxY = Math.max(startY, currentY);

          const w = maxX - minX;
          const h = maxY - minY;
          const x = minX + w / 2;
          const y = minY + h / 2;

          setTempAudioBox({ classId: 0, x, y, w, h, confidence: 1 });
        }
        return;
      }

      if (dragState.mode === 'move' && dragState.initialBox) {
        const dx = coords.x - dragState.startX;
        const dy = coords.y - dragState.startY;

        const newBoxes = [...localGtBoxes];
        newBoxes[dragState.boxIndex] = {
          ...dragState.initialBox,
          x: dragState.initialBox.x + dx,
          y: dragState.initialBox.y + dy
        };
        setLocalGtBoxes(newBoxes);
      } else if (dragState.mode === 'resize' && dragState.initialBox && dragState.handle) {
        const b = dragState.initialBox;
        let x1 = b.x - b.w / 2;
        let y1 = b.y - b.h / 2;
        let x2 = b.x + b.w / 2;
        let y2 = b.y + b.h / 2;

        if (dragState.handle === 'tl') { x1 = coords.x; y1 = coords.y; }
        else if (dragState.handle === 'tr') { x2 = coords.x; y1 = coords.y; }
        else if (dragState.handle === 'bl') { x1 = coords.x; y2 = coords.y; }
        else if (dragState.handle === 'br') { x2 = coords.x; y2 = coords.y; }

        const w = Math.abs(x2 - x1);
        const h = Math.abs(y2 - y1);
        const x = (x1 + x2) / 2;
        const y = (y1 + y2) / 2;

        const newBoxes = [...localGtBoxes];
        newBoxes[dragState.boxIndex] = { ...b, x, y, w, h };
        setLocalGtBoxes(newBoxes);
      } else if (dragState.mode === 'create') {
        const startX = dragState.startX;
        const startY = dragState.startY;
        const currentX = coords.x;
        const currentY = coords.y;

        const minX = Math.min(startX, currentX);
        const maxX = Math.max(startX, currentX);
        const minY = Math.min(startY, currentY);
        const maxY = Math.max(startY, currentY);

        const w = maxX - minX;
        const h = maxY - minY;
        const x = minX + w / 2;
        const y = minY + h / 2;

        const newBoxes = [...localGtBoxes];
        if (newBoxes[dragState.boxIndex]) {
          newBoxes[dragState.boxIndex] = {
            ...newBoxes[dragState.boxIndex],
            x, y, w, h
          };
          setLocalGtBoxes(newBoxes);
        }
      }
      return;
    }

    // Standard Hover Logic (only if not dragging)
    if (!cachedData || !canvasRef.current) return;
    const hit = cachedData.hitRegions.find(r =>
      coords.rawX >= r.x && coords.rawX <= r.x + r.w &&
      coords.rawY >= r.y && coords.rawY <= r.y + r.h
    );

    if (hit) {
      if (hoveredStat !== hit.type) setHoveredStat(hit.type);
    } else {
      if (hoveredStat !== null) setHoveredStat(null);
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (dragState) {
      if (!isEditMode) {
        if (dragState.mode === 'create' && dragState.boxIndex === -2 && tempAudioBox) {
          if (tempAudioBox.w > 0.005 && tempAudioBox.h > 0.005) {
            playAudioForBox(tempAudioBox);
          } else {
            setTempAudioBox(null);
          }
        } else if (dragState.mode === 'move' && dragState.boxIndex === -1 && dragState.initialBox) {
          const coords = getImgCoords(e);
          const dx = coords.x - dragState.startX;
          const dy = coords.y - dragState.startY;
          if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) {
            playAudioForBox(dragState.initialBox);
          }
        }
        setDragState(null);
        return;
      }

      if (dragState.mode === 'create') {
        const box = localGtBoxes[dragState.boxIndex];
        if (box && (box.w < 0.001 || box.h < 0.001)) {
          // Remove if too small
          const newBoxes = localGtBoxes.filter((_, i) => i !== dragState.boxIndex);
          setLocalGtBoxes(newBoxes);
          setSelectedBoxIdx(null);
        } else {
          onUpdateGt?.(item.name, localGtBoxes);
        }
      } else if (dragState.mode === 'move' || dragState.mode === 'resize') {
        onUpdateGt?.(item.name, localGtBoxes);
      }
      setDragState(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isEditMode || selectedBoxIdx === null) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const newBoxes = localGtBoxes.filter((_, i) => i !== selectedBoxIdx);
      setLocalGtBoxes(newBoxes);
      setSelectedBoxIdx(null);
      onUpdateGt?.(item.name, newBoxes);
      e.preventDefault();
    }
  };

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const img = new Image();
      const url = URL.createObjectURL(item.file);
      img.src = url;
      await new Promise((resolve) => img.onload = resolve);

      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dynamicFontSize = Math.max(12, Math.floor(img.naturalWidth * 0.02));
      const dynamicLineWidth = Math.max(1, Math.floor(img.naturalWidth * 0.002));

      await drawVisualization(ctx, item, config, img.naturalWidth, img.naturalHeight, img, {
        fontSize: dynamicFontSize,
        forceLineWidth: dynamicLineWidth
      });

      const link = document.createElement('a');
      link.download = `vis_${item.name}`;
      link.href = canvas.toDataURL('image/jpeg', 0.95);
      link.click();

      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Download failed", e);
    } finally {
      setDownloading(false);
      setContextMenu(null);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();

    if (isEditMode) {
      const coords = getImgCoords(e);
      let hit = -1;
      let hitPredBox: BoundingBox | null = null;
      let hitPredArea = Infinity;

      // Perform hit detection
      for (let i = localGtBoxes.length - 1; i >= 0; i--) {
        const b = localGtBoxes[i];
        const bx1 = b.x - b.w / 2;
        const bx2 = b.x + b.w / 2;
        const by1 = b.y - b.h / 2;
        const by2 = b.y + b.h / 2;

        if (coords.x >= bx1 && coords.x <= bx2 && coords.y >= by1 && coords.y <= by2) {
          hit = i;
          break;
        }
      }

      if (hit !== -1) {
        setSelectedBoxIdx(hit);
        setContextMenu({ x: e.clientX, y: e.clientY });
        setContextPredBox(null);
      } else {
        if (config.showPredInEditMode && cachedData) {
          for (const b of cachedData.boxes) {
            if (b.type === BoxType.TP_PRED || b.type === BoxType.FP) {
              const bx1 = b.x - b.w / 2;
              const bx2 = b.x + b.w / 2;
              const by1 = b.y - b.h / 2;
              const by2 = b.y + b.h / 2;
              if (coords.x >= bx1 && coords.x <= bx2 && coords.y >= by1 && coords.y <= by2) {
                const area = b.w * b.h;
                if (area < hitPredArea) {
                  hitPredArea = area;
                  hitPredBox = b;
                }
              }
            }
          }
        }

        if (hitPredBox) {
          setSelectedBoxIdx(null);
          setContextPredBox(hitPredBox);
          setContextMenu({ x: e.clientX, y: e.clientY });
        } else {
          setContextMenu(null);
          setContextPredBox(null);
        }
      }
      return;
    }

    const x = Math.min(e.clientX, window.innerWidth - 180);
    const y = Math.min(e.clientY, window.innerHeight - 50);
    setContextMenu({ x, y });
  };



  const playAudioForBox = async (box: BoundingBox) => {
    if (!audioPlayer || !audioFiles) return;

    const audioName = getAudioFilename(item.name);
    const fileHandle = audioFiles[audioName];
    if (!fileHandle) {
      console.warn("Audio file not found:", audioName);
      alert(`Audio file not found: ${audioName}`);
      return;
    }

    await audioPlayer.loadAudioFile(fileHandle);

    // Calculate Time
    const imageStartTime = extractStartTimeFromFilename(item.name);
    const IMAGE_DURATION_MS = 5000; // Assumption based on t0...t5000

    const startX = box.x - box.w / 2;
    const startTime = imageStartTime + (startX * IMAGE_DURATION_MS);
    const duration = box.w * IMAGE_DURATION_MS;

    // Calculate Frequency
    const minF = config.audio?.minFreq ?? 500;
    const maxF = config.audio?.maxFreq ?? 12000;

    const boxTopY = box.y - box.h / 2;
    const boxBottomY = box.y + box.h / 2;

    const freqTop = maxF - (boxTopY * (maxF - minF)); // Higher Freq
    const freqBottom = maxF - (boxBottomY * (maxF - minF)); // Lower Freq

    // Set Playing Highlight
    setPlayingBox(box);
    setPlayhead(0);
    setTempAudioBox(null);

    // Playhead Animation
    const startTimestamp = performance.now();
    const animate = (now: number) => {
      const elapsed = now - startTimestamp;
      const progress = Math.min(elapsed / duration, 1);
      setPlayhead(progress);
      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };
    requestAnimationFrame(animate);

    await audioPlayer.playSubRegion({
      startTimeMs: startTime,
      durationMs: duration,
      minFreq: Math.min(freqTop, freqBottom),
      maxFreq: Math.max(freqTop, freqBottom)
    });

    setContextMenu(null);

    // Clear highlight after duration
    setTimeout(() => {
      setPlayingBox((prev) => {
        if (prev === box) {
          setTimeout(() => setPlayhead(null), 0);
          return null;
        }
        return prev;
      });
    }, duration + 100); // Small buffer
  };

  const handlePlayAudio = async () => {
    let box: BoundingBox | undefined;
    if (selectedBoxIdx !== null) {
      box = localGtBoxes[selectedBoxIdx];
    } else if (cachedData && contextMenu) {
      if (canvasRef.current) {
        const rect = canvasRef.current.getBoundingClientRect();
        const scaleX = canvasRef.current.width / rect.width;
        const scaleY = canvasRef.current.height / rect.height;
        const mx = (contextMenu.x - rect.left) * scaleX;
        const my = (contextMenu.y - rect.top) * scaleY;
        const nx = mx / canvasRef.current.width;
        const ny = my / canvasRef.current.height;

        let bestMatch = null;
        let minArea = Infinity;

        for (const b of cachedData.boxes) {
          const bx1 = b.x - b.w / 2;
          const bx2 = b.x + b.w / 2;
          const by1 = b.y - b.h / 2;
          const by2 = b.y + b.h / 2;

          if (nx >= bx1 && nx <= bx2 && ny >= by1 && ny <= by2) {
            const area = b.w * b.h;
            if (area < minArea) {
              minArea = area;
              bestMatch = b;
            }
          }
        }
        if (bestMatch) box = bestMatch;
      }
    }

    if (!box) return;
    await playAudioForBox(box);
  };

  const handleDeleteSelected = () => {
    if (selectedBoxIdx !== null && isEditMode) {
      const newBoxes = localGtBoxes.filter((_, i) => i !== selectedBoxIdx);
      setLocalGtBoxes(newBoxes);
      setSelectedBoxIdx(null);
      onUpdateGt?.(item.name, newBoxes);
      setContextMenu(null);
    }
  };

  const handleMouseLeave = () => {
    setHoveredStat(null);
  };


  // Aspect Ratio Class
  let aspectClass = "aspect-square";
  if (config.aspectRatio === '16:9') aspectClass = "aspect-video";
  else if (config.aspectRatio === '4:3') aspectClass = "aspect-[4/3]";
  else if (config.aspectRatio === '1:1') aspectClass = "aspect-square";
  else if (config.aspectRatio === 'auto') aspectClass = "aspect-auto h-64";

  return (
    <div
      ref={containerRef}
      className={`relative bg-slate-900 rounded-lg overflow-hidden border border-slate-700 ${aspectClass} flex items-center justify-center w-full focus:outline-none`}
      onContextMenu={handleContextMenu}
      tabIndex={isEditMode ? 0 : undefined}
    >
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900 z-10">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      )}

      <canvas
        ref={canvasRef}
        className={`max-w-full max-h-full object-contain ${isEditMode ? 'cursor-default' : 'cursor-crosshair'}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      />

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-slate-800 border border-slate-700 rounded shadow-xl py-1 min-w-[160px] flex flex-col"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          {isEditMode ? (
            <>
              {selectedBoxIdx !== null && (
                <>
                  <button
                    onClick={handleDeleteSelected}
                    className="text-left px-4 py-2 text-xs text-red-400 hover:bg-slate-700 hover:text-red-300 flex items-center gap-2 transition-colors w-full border-b border-slate-700"
                  >
                    <Trash2 className="w-3 h-3" />
                    Delete Box
                  </button>
                  {audioFiles && Object.keys(audioFiles).length > 0 && (
                    <button
                      onClick={() => playAudioForBox(localGtBoxes[selectedBoxIdx])}
                      className="text-left px-4 py-2 text-xs text-indigo-300 hover:bg-slate-700 hover:text-indigo-200 flex items-center gap-2 transition-colors w-full"
                    >
                      <Download className="w-3 h-3 rotate-90" />
                      Play Audio Region
                    </button>
                  )}
                </>
              )}
              {contextPredBox && (
                <button
                  onClick={() => {
                    const newBox = { ...contextPredBox, confidence: 1.0, type: undefined };
                    // @ts-ignore
                    delete newBox.type; // strip type if it got copied
                    const newBoxes = [...localGtBoxes, newBox];
                    setLocalGtBoxes(newBoxes);
                    onUpdateGt?.(item.name, newBoxes);
                    setContextMenu(null);
                    setContextPredBox(null);
                  }}
                  className="text-left px-4 py-2 text-xs text-emerald-400 hover:bg-slate-700 hover:text-emerald-300 flex items-center gap-2 transition-colors w-full"
                >
                  <Check className="w-3 h-3" />
                  Accept Prediction
                </button>
              )}
            </>
          ) : (
            <>
              {/* Play Audio Option */}
              {audioFiles && Object.keys(audioFiles).length > 0 && (
                <button
                  onClick={handlePlayAudio}
                  className="text-left px-4 py-2 text-xs text-indigo-300 hover:bg-slate-700 hover:text-indigo-200 flex items-center gap-2 transition-colors w-full border-b border-slate-700"
                >
                  <Download className="w-3 h-3 rotate-90" /> {/* Use a play icon if available, or just recycle */}
                  Play Audio Region
                </button>
              )}

              <button
                onClick={handleDownload}
                disabled={downloading}
                className="text-left px-4 py-2 text-xs text-slate-200 hover:bg-slate-700 hover:text-white flex items-center gap-2 transition-colors w-full"
              >
                {downloading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                Save Visualization
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default ImageViewer;