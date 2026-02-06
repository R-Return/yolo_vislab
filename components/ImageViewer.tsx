import React, { useEffect, useRef, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { ImageItem, VisualizationConfig, BoxType, RenderBox, HitRegion } from '../types';
import { drawVisualization } from '../utils/render';

interface ImageViewerProps {
  item: ImageItem;
  config: VisualizationConfig;
  externalHighlight?: BoxType | null;
}

const ImageViewer: React.FC<ImageViewerProps> = ({ item, config, externalHighlight }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Cache the processed data to avoid re-parsing on hover
  const [cachedData, setCachedData] = useState<{
      img: HTMLImageElement;
      boxes: RenderBox[];
      hitRegions: HitRegion[];
  } | null>(null);

  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  
  // Highlight interaction (Local)
  const [hoveredStat, setHoveredStat] = useState<BoxType | null>(null);

  // Close context menu on global click
  useEffect(() => {
    const closeMenu = () => setContextMenu(null);
    if (contextMenu) {
        window.addEventListener('click', closeMenu);
        window.addEventListener('scroll', closeMenu, true); // Close on scroll
    }
    return () => {
        window.removeEventListener('click', closeMenu);
        window.removeEventListener('scroll', closeMenu, true);
    }
  }, [contextMenu]);

  // Initial Load Effect
  useEffect(() => {
    let active = true;
    
    const load = async () => {
      setLoading(true);
      const canvas = canvasRef.current;
      if (!canvas) return;

      const img = new Image();
      const url = URL.createObjectURL(item.file);
      
      img.onload = async () => {
        if (!active) {
            URL.revokeObjectURL(url);
            return;
        }

        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        
        if (ctx) {
          // Initial render (calculates boxes and regions)
          const result = await drawVisualization(ctx, item, config, img.naturalWidth, img.naturalHeight, img);
          if (active) {
             setCachedData({
                 img,
                 boxes: result.boxes || [],
                 hitRegions: result.hitRegions
             });
          }
        }
        
        if (active) setLoading(false);
        URL.revokeObjectURL(url);
      };

      img.src = url;
    };

    load();

    return () => { active = false; };
  }, [item, config]); // Re-run if item or config changes

  // Hover/Highlight Effect (Re-render using cache)
  useEffect(() => {
      if (!cachedData || !canvasRef.current) return;
      
      const ctx = canvasRef.current.getContext('2d');
      if (!ctx) return;

      // Determine which highlight to use (Local hover takes precedence, then global)
      const activeHighlight = hoveredStat || externalHighlight;

      // Fast re-render using cached image and boxes
      drawVisualization(
          ctx, 
          item, 
          config, 
          cachedData.img.naturalWidth, 
          cachedData.img.naturalHeight, 
          cachedData.img,
          {
              preCalculatedBoxes: cachedData.boxes,
              highlightType: activeHighlight
          }
      );

  }, [hoveredStat, externalHighlight, cachedData, config, item]);


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
    // Prevent menu from going off-screen
    const x = Math.min(e.clientX, window.innerWidth - 180);
    const y = Math.min(e.clientY, window.innerHeight - 50);
    setContextMenu({ x, y });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!cachedData || !canvasRef.current) return;
      
      const rect = canvasRef.current.getBoundingClientRect();
      const scaleX = canvasRef.current.width / rect.width;
      const scaleY = canvasRef.current.height / rect.height;
      
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;

      // Check for collision with stats regions
      const hit = cachedData.hitRegions.find(r => 
          x >= r.x && x <= r.x + r.w &&
          y >= r.y && y <= r.y + r.h
      );

      if (hit) {
          if (hoveredStat !== hit.type) setHoveredStat(hit.type);
      } else {
          if (hoveredStat !== null) setHoveredStat(null);
      }
  };

  const handleMouseLeave = () => {
      setHoveredStat(null);
  };

  // Determine Aspect Ratio Class
  let aspectClass = "aspect-square"; 
  if (config.aspectRatio === '16:9') aspectClass = "aspect-video";
  else if (config.aspectRatio === '4:3') aspectClass = "aspect-[4/3]";
  else if (config.aspectRatio === '1:1') aspectClass = "aspect-square";
  else if (config.aspectRatio === 'auto') aspectClass = "aspect-auto h-64"; 

  return (
    <div 
      ref={containerRef} 
      className={`relative bg-slate-900 rounded-lg overflow-hidden border border-slate-700 ${aspectClass} flex items-center justify-center w-full`}
      onContextMenu={handleContextMenu}
    >
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900 z-10">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      )}

      <canvas 
        ref={canvasRef} 
        className="max-w-full max-h-full object-contain cursor-crosshair"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      />

      {/* Context Menu */}
      {contextMenu && (
        <div 
          className="fixed z-50 bg-slate-800 border border-slate-700 rounded shadow-xl py-1 min-w-[160px] flex flex-col"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button 
            onClick={handleDownload}
            disabled={downloading}
            className="text-left px-4 py-2 text-xs text-slate-200 hover:bg-slate-700 hover:text-white flex items-center gap-2 transition-colors w-full"
          >
            {downloading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
            Save Visualization
          </button>
        </div>
      )}
    </div>
  );
};

export default ImageViewer;