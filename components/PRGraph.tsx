import React, { useEffect, useState, useRef } from 'react';
import { ImageItem, VisualizationConfig } from '../types';
import { calculatePRStats, PRPoint } from '../utils/yolo';
import { Loader2 } from 'lucide-react';

interface PRGraphProps {
  items: ImageItem[];
  config: VisualizationConfig;
}

const PRGraph: React.FC<PRGraphProps> = ({ items, config }) => {
  const [data, setData] = useState<PRPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const compute = async () => {
      setLoading(true);
      try {
        // Use a small timeout to allow UI to render loading state
        await new Promise(r => setTimeout(r, 100));
        const points = await calculatePRStats(items, config.iopThreshold);
        setData(points);
      } catch (e) {
        console.error("Error computing PR stats", e);
      } finally {
        setLoading(false);
      }
    };
    compute();
  }, [items, config.iopThreshold]); // Re-compute when IoP changes

  // Chart Rendering Logic
  const width = 800;
  const height = 500;
  const padding = 50;
  const chartW = width - padding * 2;
  const chartH = height - padding * 2;

  const pointsString = data.map(p => {
    const x = padding + p.recall * chartW;
    const y = height - padding - p.precision * chartH;
    return `${x},${y}`;
  }).join(' ');

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 bg-background h-full overflow-hidden relative">
      <div className="absolute top-4 left-4 bg-slate-800 p-4 rounded shadow-lg border border-slate-700 max-w-sm z-10">
        <h3 className="text-lg font-bold text-white mb-2">Precision-Recall Curve</h3>
        <p className="text-sm text-slate-300 mb-2">
            <strong>IoP Threshold:</strong> {config.iopThreshold.toFixed(2)}
        </p>
        <p className="text-xs text-slate-400">
            <strong>Precision:</strong> % of Predictions that fall inside a GT.<br/>
            <strong>Recall:</strong> % of GTs that have at least one prediction.<br/>
            Plots performance across Confidence thresholds (0.0 - 1.0).
        </p>
      </div>

      {loading ? (
        <div className="flex flex-col items-center gap-4">
            <Loader2 className="w-12 h-12 text-primary animate-spin" />
            <p className="text-slate-400">Analyzing dataset across confidence levels...</p>
        </div>
      ) : (
        <div className="bg-slate-900 rounded-xl p-4 shadow-2xl border border-slate-700" ref={containerRef}>
          <svg width={width} height={height} className="overflow-visible">
            {/* Grid */}
            <g stroke="#334155" strokeWidth="1" strokeDasharray="4">
               {[0, 0.25, 0.5, 0.75, 1].map(v => (
                   <React.Fragment key={v}>
                       {/* Horizontal */}
                       <line x1={padding} y1={height - padding - v * chartH} x2={width - padding} y2={height - padding - v * chartH} />
                       {/* Vertical */}
                       <line x1={padding + v * chartW} y1={height - padding} x2={padding + v * chartW} y2={padding} />
                   </React.Fragment>
               ))}
            </g>

            {/* Axes */}
            <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#cbd5e1" strokeWidth="2" />
            <line x1={padding} y1={height - padding} x2={padding} y2={padding} stroke="#cbd5e1" strokeWidth="2" />

            {/* Labels */}
            <text x={width / 2} y={height - 10} textAnchor="middle" fill="#94a3b8" fontSize="14">Recall (Unique GTs Found)</text>
            <text x={15} y={height / 2} textAnchor="middle" fill="#94a3b8" fontSize="14" transform={`rotate(-90, 15, ${height/2})`}>Precision (Valid Preds)</text>

            {/* Curve */}
            <polyline 
                points={pointsString} 
                fill="none" 
                stroke="#3b82f6" 
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            
            {/* Data Points (Hoverable) */}
            {data.map((p, i) => (
                <circle 
                    key={i}
                    cx={padding + p.recall * chartW} 
                    cy={height - padding - p.precision * chartH} 
                    r={4}
                    fill={p.confidence >= config.confThreshold ? "#ef4444" : "#3b82f6"} // Highlight current conf
                    className="hover:r-6 transition-all cursor-pointer"
                >
                    <title>Conf: {p.confidence.toFixed(2)} | P: {p.precision.toFixed(3)} | R: {p.recall.toFixed(3)}</title>
                </circle>
            ))}
          </svg>
        </div>
      )}
    </div>
  );
};

export default PRGraph;