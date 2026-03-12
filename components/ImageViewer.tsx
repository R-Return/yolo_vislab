import React, { useEffect, useRef, useState, useLayoutEffect } from 'react';
import { Download, Loader2, Trash2, Check, Copy } from 'lucide-react';
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
  activePlayback?: { id: number; fileName: string } | null;
  onSetGlobalPlayback?: (pb: { id: number; fileName: string } | null) => void;
  isFocused?: boolean;
  onFocusToggle?: () => void;
  onSetFocus?: () => void;
  onRecoverOriginalGt?: (fileName: string) => void;
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
  potentialSelect?: number;
}

const ImageViewer: React.FC<ImageViewerProps> = ({ item, config, externalHighlight, isEditMode, onUpdateGt, audioPlayer, audioFiles, activePlayback, onSetGlobalPlayback, isFocused, onFocusToggle, onSetFocus, onRecoverOriginalGt }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const playbackIdRef = useRef<number>(0);

  // Local GT state for smooth editing
  const [localGtBoxes, setLocalGtBoxes] = useState<BoundingBox[]>(item.gtData || []);
  const [selectedBoxIdx, setSelectedBoxIdx] = useState<number | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [playingBox, setPlayingBox] = useState<BoundingBox | null>(null);
  const [hidePlayingBorder, setHidePlayingBorder] = useState(false);
  const [playhead, setPlayhead] = useState<number | null>(null); // 0 to 1 progress
  const [tempAudioBox, setTempAudioBox] = useState<BoundingBox | null>(null);
  const [contextPredBox, setContextPredBox] = useState<BoundingBox | null>(null);
  const localPlaybackIdRef = useRef<number>(0);
  const activePlaybackRef = useRef(activePlayback);

  // Sync ref with prop
  useEffect(() => {
    activePlaybackRef.current = activePlayback;
  }, [activePlayback]);

  // Sync with global playback
  useEffect(() => {
    if (activePlayback && activePlayback.fileName === item.name) {
      if (activePlayback.id !== localPlaybackIdRef.current) {
        // Someone else started playing our file, or we started playing but this effect triggered?
        // Actually, if it's OUR file and a NEW ID, it means we should stop any OLD local playback.
        // But if it's NOT our file, we definitely stop.
      }
    } else if (activePlayback) {
      // Something else is playing, clear our highlight
      setPlayingBox(null);
      setPlayhead(null);
      playbackIdRef.current += 1; // STOP STALE ANIMATIONS
      localPlaybackIdRef.current = -1; // Invalidate local
    }
  }, [activePlayback, item.name]);

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

  // Stats computed from drawn boxes
  const [computedStats, setComputedStats] = useState({ tp: 0, fp: 0, fn: 0 });

  // Grid Label Highlight State
  const [lockedStat, setLockedStat] = useState<BoxType | null>(null);

  // Crosshairs State
  const [hoverCoords, setHoverCoords] = useState<{ x: number, y: number, timePx: number, freqHz: number } | null>(null);

  // Sync props to local state when item.gtData changes
  useEffect(() => {
    setLocalGtBoxes(item.gtData || []);
  }, [item.gtData]);

  // Only reset viewer state when navigating to a new item
  useEffect(() => {
    setSelectedBoxIdx(null);
    setPlayingBox(null);
    setHidePlayingBorder(false);
    setTempAudioBox(null);
  }, [item.name]);

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
        const currentPred = (isEditMode && config.showPredictions === false) ? [] : (item.predData || []);

        const renderBoxes = calculateMatches(currentGt, currentPred, config);

        const activeHighlightType = lockedStat || hoveredStat || externalHighlight;

        const result = await drawVisualization(ctx, item, config, img.naturalWidth, img.naturalHeight, img, {
          preCalculatedBoxes: renderBoxes,
          highlightType: activeHighlightType
        });

        // Store transform info for mouse mapping
        const transform = { scale: 1.0, offsetX: 0, offsetY: 0 };

        setCachedData({
          img,
          boxes: renderBoxes,
          hitRegions: result.hitRegions,
          transform
        });

        // Update local computed stats for DOM rendering
        setComputedStats(result.stats);

        // Draw Editor Overlay
        if (isEditMode) {
          drawEditorOverlay(ctx, renderBoxes, selectedBoxIdx);
        }

        // Draw Playing Highlight
        if (playingBox && !hidePlayingBorder) {
          drawPlayingHighlight(ctx, playingBox);
        } else if (playhead !== null) {
          // Playhead without box highlight (ambient full-image generation)
          drawPlayingHighlight(ctx, null as any); // Render just playhead
        }
      } else if (playhead !== null) {
        // Playhead without box highlight (ambient full-image generation)
        drawPlayingHighlight(ctx, null as any); // Render just playhead
      }

      if (tempAudioBox) {
        drawPlayingHighlight(ctx, tempAudioBox);
      }

      setLoading(false);
    };

    render();

    return () => { active = false; };
  }, [item, config, config.ioMinThreshold, config.confThreshold, config.showLabels, localGtBoxes, isEditMode, hoveredStat, lockedStat, externalHighlight, playingBox, playhead, tempAudioBox, hidePlayingBorder]); // Re-render when boxes or playhead change

  // Global Deletion Listener
  useEffect(() => {
    if (!isEditMode || selectedBoxIdx === null) return;

    const onKey = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input field
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        e.stopPropagation();
        const newBoxes = localGtBoxes.filter((_, i) => i !== selectedBoxIdx);
        setLocalGtBoxes(newBoxes);
        setSelectedBoxIdx(null);
        onUpdateGt?.(item.name, newBoxes);
      }
    };

    // Use capture phase to ensure we aren't blocked by generic bubbling stoppers
    document.addEventListener('keydown', onKey, { capture: true });
    return () => document.removeEventListener('keydown', onKey, { capture: true });
  }, [isEditMode, selectedBoxIdx, localGtBoxes, item, onUpdateGt]);

  // Spacebar Playback for Focused Item
  useEffect(() => {
    if (!isFocused) return;
    const onSpace = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
      if (e.key === ' ') {
        e.preventDefault();
        if (playhead !== null) {
          audioPlayer?.togglePause();
        } else {
          const fullImageAudioBox: BoundingBox = {
            classId: 0, x: 0.5, y: 0.5, w: 1.0, h: 1.0, confidence: 1.0
          };
          playAudioForBox(fullImageAudioBox, false, true);
        }
      }
    };
    document.addEventListener('keydown', onSpace);
    return () => document.removeEventListener('keydown', onSpace);
  }, [isFocused, playhead, audioPlayer, item]);

  // Helper to draw specific box highlight
  const drawPlayingHighlight = (ctx: CanvasRenderingContext2D, box: BoundingBox | null) => {
    const { width, height } = ctx.canvas;

    // Draw Box if present
    if (box) {
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
      ctx.restore();
    }

    ctx.save();

    // Draw Playhead (progress line)
    // If playingBox is null but playhead exists, we are playing a hidden box (full image).
    if (playhead !== null) {
      // Base the playhead on the box dimensions, or full width if no box is highlighted
      const actualW = box ? (box.w * width) : width;
      const actualX = box ? ((box.x * width) - actualW / 2) : 0;
      const actualY = box ? (box.y * height) : (height / 2);
      const actualH = box ? (box.h * height) : height;

      const playX = actualX + (actualW * playhead);
      ctx.beginPath();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.shadowBlur = 0;
      ctx.setLineDash([2, 5]);
      ctx.moveTo(playX, actualY - actualH / 2);
      ctx.lineTo(playX, actualY + actualH / 2);
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
  const getImgCoords = (e: React.MouseEvent | MouseEvent) => {
    if (!canvasRef.current || !cachedData) return { x: 0, y: 0, rawX: 0, rawY: 0 };
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;

    const cx = (e.clientX - rect.left) * scaleX;
    const cy = (e.clientY - rect.top) * scaleY;

    // Normalized coordinates (0-1) clamped to boundaries
    const nx = Math.max(0, Math.min(1, cx / canvasRef.current.width));
    const ny = Math.max(0, Math.min(1, cy / canvasRef.current.height));

    const clampedRawX = Math.max(0, Math.min(canvasRef.current.width, cx));
    const clampedRawY = Math.max(0, Math.min(canvasRef.current.height, cy));

    return { x: nx, y: ny, rawX: clampedRawX, rawY: clampedRawY };
  };

  // Mouse Handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    // We allow right click for audio drag box in edit mode
    if (e.button !== 0 && !(e.button === 2 && isEditMode)) return;

    // Grab focus so keyboard events target this component correctly if using target listeners
    // (Though we moved to document listener, this is still good practice)
    containerRef.current?.focus();

    const coords = getImgCoords(e);

    // If it's a right click in edit mode, initiate an audio temp box drag
    if (isEditMode && e.button === 2) {
      setDragState({
        mode: 'create',
        boxIndex: -2,
        startX: coords.x,
        startY: coords.y
      });
      // Same logic as non-edit mode temp audio box creation
      audioPlayer?.stop();
      setPlayingBox(null);
      setPlayhead(null);
      playbackIdRef.current += 1;
      setTempAudioBox({ classId: 0, x: coords.x, y: coords.y, w: 0, h: 0, confidence: 1 });
      return;
    }
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

      setDragState({
        mode: 'create',
        boxIndex: -2,
        startX: coords.x,
        startY: coords.y,
        initialBox: hit ? { ...hit } : undefined
      });
      // Stop previous playing audio / clear temp box when starting to draw a new one
      audioPlayer?.stop();
      setPlayingBox(null);
      setPlayhead(null);
      playbackIdRef.current += 1;
      setTempAudioBox({ classId: 0, x: coords.x, y: coords.y, w: 0, h: 0, confidence: 1 });
      return;
    }

    // 1. Check ALL GT boxes for handle hits first (to prioritize resizing over selection/creation)
    for (let i = localGtBoxes.length - 1; i >= 0; i--) {
      if (i !== selectedBoxIdx) continue; // Only allow resizing the currently selected box
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

      let bestHandle = null;
      let minDistance = Infinity;

      for (const [key, p] of Object.entries(handles)) {
        const dx = coords.rawX - p.x;
        const dy = coords.rawY - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 30 && dist < minDistance) {
          minDistance = dist;
          bestHandle = key;
        }
      }

      if (bestHandle) {
        setSelectedBoxIdx(i);
        setDragState({
          mode: 'resize',
          handle: bestHandle as any,
          boxIndex: i,
          startX: coords.x,
          startY: coords.y,
          initialBox: { ...b }
        });
        return;
      }
    }

    // 2. Check collision with any GT box body (Find the smallest overlapping box)
    let hit = -1;
    let minArea = Infinity;

    for (let i = localGtBoxes.length - 1; i >= 0; i--) {
      const b = localGtBoxes[i];
      const bx1 = b.x - b.w / 2;
      const bx2 = b.x + b.w / 2;
      const by1 = b.y - b.h / 2;
      const by2 = b.y + b.h / 2;

      if (coords.x >= bx1 && coords.x <= bx2 && coords.y >= by1 && coords.y <= by2) {
        const area = b.w * b.h;
        if (area < minArea) {
          minArea = area;
          hit = i;
        }
      }
    }

    if (hit !== -1 && hit === selectedBoxIdx) {
      // Only move if it is already selected
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
        startY: coords.y,
        potentialSelect: hit !== -1 ? hit : undefined
      });
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getImgCoords(e);

    if (dragState) {
      e.preventDefault();

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
        return;
      }

      if (!isEditMode) return;

      if (dragState.mode === 'move' && dragState.initialBox) {
        const dx = coords.x - dragState.startX;
        const dy = coords.y - dragState.startY;

        let newX = dragState.initialBox.x + dx;
        let newY = dragState.initialBox.y + dy;
        const halfW = dragState.initialBox.w / 2;
        const halfH = dragState.initialBox.h / 2;

        // Clamp so the box edges stay within [0, 1]
        newX = Math.max(halfW, Math.min(1 - halfW, newX));
        newY = Math.max(halfH, Math.min(1 - halfH, newY));

        const newBoxes = [...localGtBoxes];
        newBoxes[dragState.boxIndex] = {
          ...dragState.initialBox,
          x: newX,
          y: newY
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

    // Calculate Tooltip info
    const imageStartTime = extractStartTimeFromFilename(item.name);
    const clipSec = config.audio?.clipSec ?? 6.0;
    const TIME_TOTAL = clipSec * 1000;
    const timeAtCursor = imageStartTime + (coords.x * TIME_TOTAL);

    const minF = config.audio?.minFreq ?? 500;
    const maxF = config.audio?.maxFreq ?? 12000;
    const freqAtCursor = maxF - (coords.y * (maxF - minF));

    let cursorX = coords.rawX;
    let cursorY = coords.rawY;
    if (containerRef.current) {
      const containerRect = containerRef.current.getBoundingClientRect();
      cursorX = e.clientX - containerRect.left;
      cursorY = e.clientY - containerRect.top;
    }

    setHoverCoords({
      x: cursorX,
      y: cursorY,
      timePx: timeAtCursor / 1000,
      freqHz: freqAtCursor
    });

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
      if (dragState.mode === 'create' && dragState.boxIndex === -2 && tempAudioBox) {
        if (tempAudioBox.w > 0.005 && tempAudioBox.h > 0.005) {
          playAudioForBox(tempAudioBox, e.shiftKey);
          if (isEditMode) {
            // Nothing to suppress, just do nothing
          }
        } else {
          // It was a click!
          if (!isEditMode) {
            if (dragState.initialBox) {
              playAudioForBox(dragState.initialBox, e.shiftKey);
            } else {
              // Clicked on empty space! Play full image audio.
              const fullImageAudioBox: BoundingBox = {
                classId: 0,
                x: 0.5, y: 0.5, w: 1.0, h: 1.0, confidence: 1.0
              };
              playAudioForBox(fullImageAudioBox, false, true); // Play full image without drawing border
            }
          } else {
            // in edit mode, a simple right click should open our custom context menu since we bypassed it earlier
            openContextMenuInEditMode(e.clientX, e.clientY);
          }
        }
        setTempAudioBox(null);
        setDragState(null);
        return;
      }

      if (!isEditMode) {
        setDragState(null);
        return;
      }

      if (dragState.mode === 'create') {
        const box = localGtBoxes[dragState.boxIndex];
        if (box && (box.w < 0.001 || box.h < 0.001)) {
          const newBoxes = localGtBoxes.filter((_, i) => i !== dragState.boxIndex);
          setLocalGtBoxes(newBoxes);
          if (dragState.potentialSelect !== undefined) {
            setSelectedBoxIdx(dragState.potentialSelect);
          } else {
            setSelectedBoxIdx(null);
          }
        } else {
          onUpdateGt?.(item.name, localGtBoxes);
        }
      } else if (dragState.mode === 'move' || dragState.mode === 'resize') {
        const currentBox = localGtBoxes[dragState.boxIndex];
        const initial = dragState.initialBox;
        if (currentBox && initial) {
          if (currentBox.x !== initial.x || currentBox.y !== initial.y || currentBox.w !== initial.w || currentBox.h !== initial.h) {
            onUpdateGt?.(item.name, localGtBoxes);
          }
        } else {
          onUpdateGt?.(item.name, localGtBoxes);
        }
      }
      setDragState(null);
    }
  };

  // Add Global Mouse Listeners when Dragging
  useEffect(() => {
    if (!dragState) return;

    // Use a slightly different mouse move for global to map accurately 
    const handleGlobalMouseMove = (e: MouseEvent) => {
      // Mock React.MouseEvent interface since getImgCoords expects it
      handleMouseMove(e as unknown as React.MouseEvent<HTMLCanvasElement>);
    };

    const handleGlobalMouseUp = (e: MouseEvent) => {
      handleMouseUp(e as unknown as React.MouseEvent);
    };

    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [dragState, handleMouseMove, handleMouseUp]);

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

  const handleMouseLeaveCanvas = () => {
    setHoveredStat(null);
    setHoverCoords(null);
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

  const openContextMenuInEditMode = (clientX: number, clientY: number) => {
    if (!canvasRef.current || !cachedData) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;

    const cx = (clientX - rect.left) * scaleX;
    const cy = (clientY - rect.top) * scaleY;

    // Normalized coordinates (0-1)
    const nx = cx / canvasRef.current.width;
    const ny = cy / canvasRef.current.height;

    let hitGt = -1;
    let hitGtArea = Infinity;

    let hitPredBox: BoundingBox | null = null;
    let hitPredArea = Infinity;

    // Perform hit detection for GT (smallest area)
    for (let i = localGtBoxes.length - 1; i >= 0; i--) {
      const b = localGtBoxes[i];
      const bx1 = b.x - b.w / 2;
      const bx2 = b.x + b.w / 2;
      const by1 = b.y - b.h / 2;
      const by2 = b.y + b.h / 2;

      if (nx >= bx1 && nx <= bx2 && ny >= by1 && ny <= by2) {
        const area = b.w * b.h;
        if (area < hitGtArea) {
          hitGtArea = area;
          hitGt = i;
        }
      }
    }

    // Perform hit detection for Prediction (smallest area)
    if (config.showPredictions !== false && cachedData) {
      for (const b of cachedData.boxes) {
        if (b.type === BoxType.TP_PRED || b.type === BoxType.FP) {
          const bx1 = b.x - b.w / 2;
          const bx2 = b.x + b.w / 2;
          const by1 = b.y - b.h / 2;
          const by2 = b.y + b.h / 2;
          if (nx >= bx1 && nx <= bx2 && ny >= by1 && ny <= by2) {
            const area = b.w * b.h;
            if (area < hitPredArea) {
              hitPredArea = area;
              hitPredBox = b;
            }
          }
        }
      }
    }

    if (hitGt !== -1 || hitPredBox) {
      setSelectedBoxIdx(hitGt !== -1 ? hitGt : null);
      setContextPredBox(hitPredBox);
    } else {
      setSelectedBoxIdx(null);
      setContextPredBox(null);
    }

    const x = Math.min(clientX, window.innerWidth - 200);
    const y = Math.min(clientY, window.innerHeight - 80);
    setContextMenu({ x, y });
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();

    if (isEditMode) {
      // In Edit Mode, we handle context menu in handleMouseUp to distinguish click vs audio drag
      return;
    }

    const x = Math.min(e.clientX, window.innerWidth - 200);
    const y = Math.min(e.clientY, window.innerHeight - 80);
    setContextMenu({ x, y });
  };



  const playAudioForBox = async (box: BoundingBox, fullBand: boolean = false, hideBorder: boolean = false) => {
    if (!audioPlayer || !audioFiles) return;

    const audioName = getAudioFilename(item.name);
    const fileHandle = audioFiles[audioName];
    if (!fileHandle) {
      console.warn("Audio file not found:", audioName);
      alert(`Audio file not found: ${audioName}`);
      return;
    }

    await audioPlayer.loadAudioFile(fileHandle);

    // Calculate Time based on config
    const imageStartTime = extractStartTimeFromFilename(item.name);
    const clipSec = config.audio?.clipSec ?? 6.0;
    const IMAGE_DURATION_MS = clipSec * 1000;

    const startX = box.x - box.w / 2;
    const startTime = imageStartTime + (startX * IMAGE_DURATION_MS);
    const duration = box.w * IMAGE_DURATION_MS;
    const playbackSpeed = config.audio?.playbackSpeed ?? 1.0;

    // Calculate Frequency
    const minF = config.audio?.minFreq ?? 500;
    const maxF = config.audio?.maxFreq ?? 12000;

    let freqTop = maxF;
    let freqBottom = minF;

    if (!fullBand) {
      const boxTopY = box.y - box.h / 2;
      const boxBottomY = box.y + box.h / 2;
      freqTop = maxF - (boxTopY * (maxF - minF)); // Higher Freq
      freqBottom = maxF - (boxBottomY * (maxF - minF)); // Lower Freq
    }

    // Strict Clamping: never play sound outside global minF and maxF under any circumstances
    const clampFreq = (f: number) => Math.max(minF, Math.min(maxF, f));
    const finalMinFreq = clampFreq(Math.min(freqTop, freqBottom));
    const finalMaxFreq = clampFreq(Math.max(freqTop, freqBottom));

    const actualBox = fullBand ? { ...box, y: 0.5, h: 1.0 } : box;

    // Set Playing Highlight Bounds
    setPlayingBox(actualBox);

    setHidePlayingBorder(hideBorder || false);
    setPlayhead(0);
    setTempAudioBox(null);

    // Playhead Animation
    playbackIdRef.current += 1;
    const currentPlaybackId = playbackIdRef.current;

    // Clear highlight immediately before timeout to prevent 1-frame flashes
    const finishPlayback = () => {
      if (playbackIdRef.current !== currentPlaybackId) return;
      playbackIdRef.current += 1; // Kill animation loop
      setPlayhead(null);
      setPlayingBox(null);
      if (activePlaybackRef.current?.id === currentPlaybackId) {
        onSetGlobalPlayback?.(null);
      }
    };

    // Prepare to play
    // Notify global state
    localPlaybackIdRef.current = currentPlaybackId;
    onSetGlobalPlayback?.({ id: currentPlaybackId, fileName: item.name });

    // Wait for playback to actually start (buffering finished)
    await audioPlayer.playSubRegion({
      startTimeMs: startTime,
      durationMs: duration,
      minFreq: finalMinFreq,
      maxFreq: finalMaxFreq,
      playbackSpeed: playbackSpeed,
      onFinish: () => {
        finishPlayback();
      }
    });

    // Playhead Animation (Starts when audio starts playing)
    let lastTime = performance.now();
    let accumulatedTime = 0;

    const animate = (now: number) => {
      if (playbackIdRef.current !== currentPlaybackId) return; // Abort stale loop

      const dt = now - lastTime;
      lastTime = now;

      if (!audioPlayer?.isPaused?.()) {
        accumulatedTime += dt;
      }

      const progress = Math.min(accumulatedTime / (duration / playbackSpeed), 1);

      setPlayhead(progress);

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
      // Note: We don't call finishPlayback() here anymore, we let onFinish handle it
    };
    requestAnimationFrame(animate);

    setContextMenu(null);
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
  else if (config.aspectRatio === 'auto') aspectClass = config.gridSize === 1 ? "aspect-auto min-h-[500px] h-auto" : "aspect-auto h-auto";

  const isLocalModified = JSON.stringify(localGtBoxes) !== JSON.stringify(item.gtData || []);
  const showModifiedBadge = isLocalModified || item.isModified;

  return (
    <div
      className={`relative bg-slate-900 rounded-lg overflow-hidden border ${isFocused ? 'border-primary ring-2 ring-primary/50' : 'border-slate-700'} ${aspectClass} flex flex-col w-full focus:outline-none transition-all cursor-pointer`}
      onContextMenu={handleContextMenu}
      onClick={onSetFocus}
      onDoubleClick={onFocusToggle}
      tabIndex={isEditMode || isFocused ? 0 : undefined}
      onKeyDown={(e) => {
        if (isEditMode && selectedBoxIdx !== null && (e.key === 'Backspace' || e.key === 'Delete')) {
          e.preventDefault();
          e.stopPropagation();
          handleDeleteSelected();
        }
      }}
    >
      {/* Header Bar */}
      <div className="flex justify-between items-center w-full bg-slate-800/80 px-2 py-1 shrink-0 border-b border-slate-700 z-20 h-7 transition-all">
        <div className="text-[10px] font-mono font-bold text-slate-300 truncate max-w-[60%] flex items-center gap-2">
          <span className="truncate">{item.name}</span>
          {showModifiedBadge && (
            <span className="shrink-0 text-amber-500 border border-amber-500/40 px-1.5 py-0.5 rounded-[2px] text-[8px] leading-none bg-amber-500/5">MOD</span>
          )}
          {item.isSaved && !showModifiedBadge && (
            <span className="shrink-0 text-emerald-500 border border-emerald-500/40 px-1.5 py-0.5 rounded-[2px] text-[8px] leading-none bg-emerald-500/5 flex items-center gap-0.5">
              <Check className="w-2 h-2" /> SAVED
            </span>
          )}
        </div>
        <div className="flex gap-2 text-[10px] font-mono font-bold">
          <span
            onMouseEnter={() => !lockedStat && setHoveredStat(BoxType.TP_PRED)}
            onMouseLeave={() => !lockedStat && setHoveredStat(null)}
            onClick={(e) => {
              e.stopPropagation();
              if (lockedStat === BoxType.TP_PRED) {
                setLockedStat(null);
                setHoveredStat(null);
              } else {
                setLockedStat(BoxType.TP_PRED);
                setHoveredStat(BoxType.TP_PRED);
              }
            }}
            className={`cursor-pointer px-1.5 py-0.5 rounded transition-all select-none ${lockedStat === BoxType.TP_PRED ? 'bg-white/20 ring-1 ring-white/50' : 'hover:bg-white/10'}`}
            style={{ color: config.styles.tpPred.color }}
          >
            TP:{computedStats.tp}
          </span>
          <span
            onMouseEnter={() => !lockedStat && setHoveredStat(BoxType.FN)}
            onMouseLeave={() => !lockedStat && setHoveredStat(null)}
            onClick={(e) => {
              e.stopPropagation();
              if (lockedStat === BoxType.FN) {
                setLockedStat(null);
                setHoveredStat(null);
              } else {
                setLockedStat(BoxType.FN);
                setHoveredStat(BoxType.FN);
              }
            }}
            className={`cursor-pointer px-1.5 py-0.5 rounded transition-all select-none ${lockedStat === BoxType.FN ? 'bg-white/20 ring-1 ring-white/50' : 'hover:bg-white/10'}`}
            style={{ color: config.styles.fn.color }}
          >
            FN:{computedStats.fn}
          </span>
          <span
            onMouseEnter={() => !lockedStat && setHoveredStat(BoxType.FP)}
            onMouseLeave={() => !lockedStat && setHoveredStat(null)}
            onClick={(e) => {
              e.stopPropagation();
              if (lockedStat === BoxType.FP) {
                setLockedStat(null);
                setHoveredStat(null);
              } else {
                setLockedStat(BoxType.FP);
                setHoveredStat(BoxType.FP);
              }
            }}
            className={`cursor-pointer px-1.5 py-0.5 rounded transition-all select-none ${lockedStat === BoxType.FP ? 'bg-white/20 ring-1 ring-white/50' : 'hover:bg-white/10'}`}
            style={{ color: config.styles.fp.color }}
          >
            FP:{computedStats.fp}
          </span>
        </div>
      </div>

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900 z-10">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      )}

      {/* Modified Indicator removed from here - moved to header */}

      {/* Canvas container */}
      <div className="relative flex-1 flex items-center justify-center min-h-0 min-w-0" ref={containerRef}>
        <canvas
          ref={canvasRef}
          className={`max-w-full max-h-full object-contain ${isEditMode ? 'cursor-default' : 'cursor-crosshair'}`}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeaveCanvas}
        />

        {/* Crosshairs & Tooltip */}
        {hoverCoords && !isEditMode && (
          <>
            <div className="absolute top-0 bottom-0 border-l border-white/40 border-dashed pointer-events-none z-10" style={{ left: hoverCoords.x }} />
            <div className="absolute left-0 right-0 border-t border-white/40 border-dashed pointer-events-none z-10" style={{ top: hoverCoords.y }} />

            {/* Freq at left edge */}
            <div
              className="absolute left-1 bg-slate-800 text-white text-[10px] px-1.5 py-0.5 rounded shadow pointer-events-none z-20 border border-slate-600 font-mono -translate-y-1/2"
              style={{ top: hoverCoords.y }}
            >
              {Math.round(hoverCoords.freqHz)}Hz
            </div>

            {/* Time at bottom edge */}
            <div
              className="absolute bottom-1 bg-slate-800 text-white text-[10px] px-1.5 py-0.5 rounded shadow pointer-events-none z-20 border border-slate-600 font-mono -translate-x-1/2"
              style={{ left: hoverCoords.x }}
            >
              {hoverCoords.timePx.toFixed(2)}s
            </div>
          </>
        )}
      </div>

      {/* Saved Badge removed from here - moved to header */}

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
              {/* Copy Filename Option (Edit Mode) */}
              <button
                onClick={() => {
                  navigator.clipboard.writeText(item.name);
                  setContextMenu(null);
                }}
                className="text-left px-4 py-2 text-xs text-slate-300 hover:bg-slate-700 hover:text-white flex items-center gap-2 transition-colors w-full border-t border-slate-700 mt-1 pt-2"
              >
                <Copy className="w-3 h-3" />
                Copy Filename
              </button>
              {/* GT Operations */}
              <button
                onClick={() => {
                  setLocalGtBoxes([]);
                  onUpdateGt?.(item.name, []);
                  setContextMenu(null);
                }}
                className="text-left px-4 py-2 text-xs text-red-500 hover:bg-slate-700 hover:text-red-400 flex items-center gap-2 transition-colors w-full border-t border-slate-700 mt-1 pt-2"
              >
                <Trash2 className="w-3 h-3" />
                Delete All GTs
              </button>
              {onRecoverOriginalGt && (
                <button
                  onClick={() => {
                    onRecoverOriginalGt(item.name);
                    setContextMenu(null);
                  }}
                  className="text-left px-4 py-2 text-xs text-blue-400 hover:bg-slate-700 hover:text-blue-300 flex items-center gap-2 transition-colors w-full"
                >
                  <Copy className="w-3 h-3" />
                  Recover original GTs
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
              {/* Copy Filename Option */}
              <button
                onClick={() => {
                  navigator.clipboard.writeText(item.name);
                  setContextMenu(null);
                }}
                className="text-left px-4 py-2 text-xs text-slate-300 hover:bg-slate-700 hover:text-white flex items-center gap-2 transition-colors w-full"
              >
                <Copy className="w-3 h-3" />
                Copy Filename
              </button>

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