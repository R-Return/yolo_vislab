import React, { useEffect, useState, useRef } from 'react';
import { ImageItem, VisualizationConfig } from '../types';
import { calculatePRStats, PRPoint } from '../utils/yolo';
import { Loader2, Download } from 'lucide-react';

interface PRGraphProps {
  items: ImageItem[];
  config: VisualizationConfig;
}

const Chart = ({ data, config, type, itemsCount }: { data: PRPoint[], config: VisualizationConfig, type: 'pr' | 'f1', itemsCount: number }) => {
  const [hoveredPoint, setHoveredPoint] = useState<{ x: number, y: number, data: PRPoint } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const width = 600;
  const height = 300; // slightly shorter for vertical stack
  const padding = 40;
  const chartW = width - padding * 2;
  const chartH = height - padding * 2;

  let metricsText = '';
  if (data.length > 0) {
    if (type === 'pr') {
      let auc = 0;
      for (let i = 1; i < data.length; i++) {
        auc += (data[i].recall - data[i - 1].recall) * data[i].precision;
      }
      metricsText = `AUC: ${auc.toFixed(3)}`;
    } else {
      let peakF1 = 0;
      let peakConf = 0;
      for (const p of data) {
        if (p.f1 > peakF1) {
          peakF1 = p.f1;
          peakConf = p.confidence;
        }
      }
      metricsText = `Peak F1: ${peakF1.toFixed(3)} at Conf: ${peakConf.toFixed(2)}`;
    }
  }

  const clamp = (val: number) => Math.max(0, Math.min(1, val));

  const pointsString = data.map(p => {
    if (type === 'pr') {
      const x = padding + clamp(p.recall) * chartW;
      const y = height - padding - clamp(p.precision) * chartH;
      return `${x},${y}`;
    } else {
      const x = padding + clamp(p.confidence) * chartW;
      const y = height - padding - clamp(p.f1) * chartH;
      return `${x},${y}`;
    }
  }).join(' ');

  const handleMouseEnter = (e: React.MouseEvent, p: PRPoint) => {
    if (!containerRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const containerRect = containerRef.current.getBoundingClientRect();
    setHoveredPoint({
      x: rect.left - containerRect.left + rect.width / 2,
      y: rect.top - containerRect.top,
      data: p
    });
  };

  const handleMouseLeave = () => setHoveredPoint(null);

  const handleDownload = () => {
    if (!svgRef.current || data.length === 0) return;
    const svgData = new XMLSerializer().serializeToString(svgRef.current);
    const canvas = document.createElement("canvas");
    const scale = 2;
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const link = document.createElement('a');
      link.download = `${type}-curve.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    };
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
  };

  return (
    <div className="w-full flex flex-col items-center bg-surface/50 relative border-b border-slate-700 pb-4 mb-4">
      <div className="w-full mb-4 flex-shrink-0 flex justify-between items-start">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-bold text-white">
              {type === 'pr' ? 'Precision-Recall Curve' : 'F1-Confidence Curve'}
            </h3>
          </div>
          <p className="text-xs text-slate-400">
            <strong>IoMin:</strong> {config.ioMinThreshold.toFixed(2)} | <strong>Images:</strong> {itemsCount}
          </p>
          {metricsText && (
            <p className="text-xs font-semibold text-emerald-400 mt-0.5">
              {metricsText}
            </p>
          )}
        </div>
        <button
          onClick={handleDownload}
          disabled={data.length === 0}
          className="p-1.5 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors disabled:opacity-30"
          title="Download Graph Image"
        >
          <Download className="w-4 h-4" />
        </button>
      </div>

      <div className="w-full min-h-[250px] flex items-center justify-center relative" ref={containerRef}>
        {data.length === 0 ? null : (
          <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" className="w-full h-auto max-h-full overflow-visible">
            {/* Grid */}
            <g stroke="#334155" strokeWidth="1" strokeDasharray="4">
              {[0, 0.25, 0.5, 0.75, 1].map(v => (
                <React.Fragment key={v}>
                  <line x1={padding} y1={height - padding - v * chartH} x2={width - padding} y2={height - padding - v * chartH} />
                  <line x1={padding + v * chartW} y1={height - padding} x2={padding + v * chartW} y2={padding} />
                </React.Fragment>
              ))}
            </g>

            {/* Axes and Border Box */}
            <rect
              x={padding}
              y={padding}
              width={chartW}
              height={chartH}
              fill="none"
              stroke="#cbd5e1"
              strokeWidth="2"
            />

            {/* Grid 1.0 Labels */}
            <text x={width - padding} y={height - padding + 15} textAnchor="middle" fill="#94a3b8" fontSize="10">1.0</text>
            <text x={padding - 10} y={padding + 4} textAnchor="end" fill="#94a3b8" fontSize="10">1.0</text>

            {/* Labels */}
            <text x={width / 2} y={height - 5} textAnchor="middle" fill="#94a3b8" fontSize="12">
              {type === 'pr' ? 'Recall' : 'Confidence'}
            </text>
            <text x={10} y={height / 2} textAnchor="middle" fill="#94a3b8" fontSize="12" transform={`rotate(-90, 10, ${height / 2})`}>
              {type === 'pr' ? 'Precision' : 'F1 Score'}
            </text>

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
            {data.map((p, i) => {
              const cx = padding + clamp(type === 'pr' ? p.recall : p.confidence) * chartW;
              const cy = height - padding - clamp(type === 'pr' ? p.precision : p.f1) * chartH;
              return (
                <circle
                  key={i}
                  cx={cx}
                  cy={cy}
                  r={3}
                  fill={p.confidence >= config.confThreshold ? "#ef4444" : "#3b82f6"}
                  className="hover:r-[5px] transition-all cursor-pointer opacity-70 hover:opacity-100"
                  onMouseEnter={(e) => handleMouseEnter(e, p)}
                  onMouseLeave={handleMouseLeave}
                />
              )
            })}
          </svg>
        )}

        {/* Hover Tooltip */}
        {hoveredPoint && (
          <div
            className="absolute bg-slate-900 border border-slate-700 shadow-xl rounded-lg p-2 text-xs pointer-events-none z-20 flex flex-col gap-1 w-32"
            style={{
              left: hoveredPoint.x,
              top: hoveredPoint.y - 10,
              transform: 'translate(-50%, -100%)'
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
    </div>
  );
};

const PRGraph: React.FC<PRGraphProps> = ({ items, config }) => {
  const [data, setData] = useState<PRPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [isStale, setIsStale] = useState(false);
  const [lastComputationToken, setLastComputationToken] = useState('');

  // Determine if data is stale by creating a simple hash/string of current items & config
  useEffect(() => {
    const currentToken = `${items.length}_${config.ioMinThreshold}_${config.confThreshold}`;
    if (currentToken !== lastComputationToken && lastComputationToken !== '') {
      setIsStale(true);
    }
  }, [items, config.ioMinThreshold, config.confThreshold, lastComputationToken]);

  const compute = async () => {
    setLoading(true);
    setIsStale(false);
    try {
      await new Promise(r => setTimeout(r, 10)); // UI thread breathing room
      const points = await calculatePRStats(items, config.ioMinThreshold);
      setData(points);
      setLastComputationToken(`${items.length}_${config.ioMinThreshold}_${config.confThreshold}`);
    } catch (e) {
      console.error("Error computing PR stats", e);
    } finally {
      setLoading(false);
    }
  };

  // Run only initially when it's empty (optional, but good for zero-state)
  useEffect(() => {
    if (data.length === 0 && items.length > 0) {
      compute();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex-1 flex flex-col pt-2 pb-4 px-4 bg-surface/50 h-full overflow-y-auto custom-scrollbar relative border-l border-slate-700">
      <div className="flex items-center justify-between mb-4 mt-2 sticky top-0 z-10 bg-surface/90 backdrop-blur-sm py-2 border-b border-slate-700 mx-[-1rem] px-4">
        <div>
          <span className="text-sm font-bold text-slate-200">Metrics Generator</span>
          {isStale && <span className="ml-2 text-[10px] text-amber-500 font-semibold bg-amber-500/10 px-1.5 py-0.5 rounded">Stale</span>}
        </div>
        <button
          onClick={compute}
          disabled={loading || items.length === 0}
          className="bg-primary/20 hover:bg-primary/40 text-primary border border-primary/50 text-xs px-3 py-1.5 rounded transition-colors disabled:opacity-50 flex items-center gap-1 font-semibold"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
          {loading ? 'Computing...' : 'Recalculate'}
        </button>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-4">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
          <p className="text-xs text-slate-400">Calculating...</p>
        </div>
      ) : (
        <>
          <Chart data={data} config={config} type="pr" itemsCount={items.length} />
          <Chart data={data} config={config} type="f1" itemsCount={items.length} />
        </>
      )}
    </div>
  );
};

export default PRGraph;