import React, { useEffect, useRef, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { ImageItem, VisualizationConfig } from '../types';
import { drawVisualization } from '../utils/render';

interface ImageViewerProps {
  item: ImageItem;
  config: VisualizationConfig;
}

const ImageViewer: React.FC<ImageViewerProps> = ({ item, config }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [stats, setStats] = useState({ tp: 0, fp: 0, fn: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    
    const process = async () => {
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

        // Set canvas size to natural image size
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        
        if (ctx) {
          const result = await drawVisualization(ctx, item, config, img.naturalWidth, img.naturalHeight, img);
          if (active) {
             setStats(result.stats);
          }
        }
        
        if (active) setLoading(false);
        URL.revokeObjectURL(url);
      };

      img.src = url;
    };

    process();

    return () => { active = false; };
  }, [item, config]);

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      const link = document.createElement('a');
      link.download = `vis_${item.name}`;
      link.href = canvas.toDataURL('image/jpeg', 0.9);
      link.click();
    }
  };

  return (
    <div ref={containerRef} className="relative group bg-slate-900 rounded-lg overflow-hidden border border-slate-700 aspect-video flex items-center justify-center">
      {/* Loading State */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900 z-10">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      )}

      {/* Main Canvas */}
      <canvas 
        ref={canvasRef} 
        className="max-w-full max-h-full object-contain"
      />

      {/* Overlays are now drawn onto the canvas by drawVisualization, but we can keep DOM overlays if we want crisp text on zoom, 
          however, for consistency with the "Download Grid" feature which burns text into pixels, and the user's request for the downloaded image 
          to have these details, the canvas approach in drawVisualization is better. 
          We hide the DOM overlays to avoid duplication, or we can keep them for better accessibility/readability on screen.
          Let's hide DOM overlays since drawVisualization handles them now.
      */}

      {/* Download Button (Hover) */}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-end justify-end p-2 opacity-0 group-hover:opacity-100">
        <button 
          onClick={handleDownload}
          className="bg-primary hover:bg-blue-600 text-white p-2 rounded-full shadow-lg transform translate-y-2 group-hover:translate-y-0 transition-all"
          title="Download visualized image"
        >
          <Download className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};

export default ImageViewer;