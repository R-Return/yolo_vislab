import React, { useEffect, useState, useRef } from 'react';
import { ImageItem, VisualizationConfig } from '../types';
import { calculatePRStats, PRPoint } from '../utils/yolo';
import { Loader2, Download } from 'lucide-react';

interface PRGraphProps {
  items: ImageItem[];
  config: VisualizationConfig;
}

const PRGraph: React.FC<PRGraphProps> = ({ items, config }) => {
  const [data, setData] = useState<PRPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [hoveredPoint, setHoveredPoint] = useState<{ x: number, y: number, data: PRPoint } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const compute = async () => {
      setLoading(true);
      try {
        // Use a small timeout to allow UI to render loading state
        await new Promise(r => setTimeout(r, 100));
        const points = await calculatePRStats(items, config.ioMinThreshold);
        setData(points);
      } catch (e) {
        console.error("Error computing PR stats", e);
      } finally {
        setLoading(false);
      }
    };
    compute();
  }, [items, config.ioMinThreshold]); // Re-compute when IoMin changes

  // Chart Rendering Logic
  const width = 600;  // Reduced base width for better scaling in sidebar
  const height = 400; // Aspect ratio 3:2
  const padding = 40;
  const chartW = width - padding * 2;
  const chartH = height - padding * 2;

  const pointsString = data.map(p => {
    const x = padding + p.recall * chartW;
    const y = height - padding - p.precision * chartH;
    return `${x},${y}`;
  }).join(' ');

  const handleMouseEnter = (e: React.MouseEvent, p: PRPoint) => {
    if (!containerRef.current) return;

    // Get exact position relative to the container
    const rect = e.currentTarget.getBoundingClientRect();
    const containerRect = containerRef.current.getBoundingClientRect();

    setHoveredPoint({
      x: rect.left - containerRect.left + rect.width / 2,
      y: rect.top - containerRect.top,
      data: p
    });
  };

  const handleMouseLeave = () => {
    setHoveredPoint(null);
  };

  const handleDownload = () => {
    if (!svgRef.current || data.length === 0) return;

    const svgData = new XMLSerializer().serializeToString(svgRef.current);
    const canvas = document.createElement("canvas");
    // Scale up for better quality
    const scale = 2;
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext("2d");

    if (!ctx) return;

    // Draw background since SVG is transparent
    ctx.fillStyle = "#1e293b"; // Dark slate background matches app theme
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const link = document.createElement('a');
      link.download = 'pr-curve.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
    };
    // Handle special characters
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
  };

  return (
    <div className="flex-1 flex flex-col items-center p-4 bg-surface/50 h-full overflow-hidden relative border-l border-slate-700">
      <div className="w-full mb-4 flex-shrink-0 flex justify-between items-start">
        <div>
          <h3 className="text-sm font-bold text-white mb-1">Precision-Recall Curve</h3>
          <p className="text-xs text-slate-400">
            <strong>IoMin:</strong> {config.ioMinThreshold.toFixed(2)} | <strong>Images:</strong> {items.length}
          </p>
        </div>
        <button
          onClick={handleDownload}
          disabled={loading || data.length === 0}
          className="p-1.5 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors disabled:opacity-30"
          title="Download Graph Image"
        >
          <Download className="w-4 h-4" />
        </button>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-4">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
          <p className="text-xs text-slate-400">Calculating...</p>
        </div>
      ) : (
        <div className="w-full flex-1 min-h-0 flex items-center justify-center relative" ref={containerRef}>
          <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" className="w-full h-auto max-h-full overflow-visible">
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
            <text x={width / 2} y={height - 5} textAnchor="middle" fill="#94a3b8" fontSize="12">Recall</text>
            <text x={10} y={height / 2} textAnchor="middle" fill="#94a3b8" fontSize="12" transform={`rotate(-90, 10, ${height / 2})`}>Precision</text>

            {/* Curve */}
            <polyline
              points={pointsString}
              fill="none"
              stroke="#3b82f6"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Data Points (Hoverable) */}
            {data.map((p, i) => (
              <circle
                key={i}
                cx={padding + p.recall * chartW}
                cy={height - padding - p.precision * chartH}
                r={3}
                fill={p.confidence >= config.confThreshold ? "#ef4444" : "#3b82f6"} // Highlight current conf
                className="hover:r-5 transition-all cursor-pointer opacity-70 hover:opacity-100"
                onMouseEnter={(e) => handleMouseEnter(e, p)}
                onMouseLeave={handleMouseLeave}
              />
            ))}
          </svg>

          {/* Hover Tooltip */}
          {hoveredPoint && (
            <div
              className="absolute bg-slate-900 border border-slate-700 shadow-xl rounded-lg p-2 text-xs pointer-events-none z-20 flex flex-col gap-1 w-32"
              style={{
                left: hoveredPoint.x,
                top: hoveredPoint.y - 10, // Just above the mouse entry point
                transform: 'translate(-50%, -100%)' // Center horizontally, move up
              }}
            >
              <div className="flex justify-between text-slate-400"><span>Recall (X)</span> <span className="text-white font-mono">{hoveredPoint.data.recall.toFixed(3)}</span></div>
              <div className="flex justify-between text-slate-400"><span>Precision (Y)</span> <span className="text-white font-mono">{hoveredPoint.data.precision.toFixed(3)}</span></div>
              <div className="h-px bg-slate-700 my-1" />
              <div className="flex justify-between text-slate-400"><span>Conf</span> <span className="text-yellow-400 font-mono">{hoveredPoint.data.confidence.toFixed(2)}</span></div>
              <div className="flex justify-between text-slate-400"><span>F1</span> <span className="text-blue-400 font-mono">{hoveredPoint.data.f1.toFixed(3)}</span></div>
            </div>
          )}

        </div>
      )}

      <div className="mt-4 text-[10px] text-slate-500 w-full text-center flex-shrink-0">
        Red dot indicates current Confidence Threshold ({config.confThreshold.toFixed(2)})
      </div>
    </div>
  );
};

export default PRGraph;