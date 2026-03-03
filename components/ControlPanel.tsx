import React, { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Settings, Monitor, FileImage, FileText, FolderPlus, FolderOpen, Trash2, Pencil, Check, X, Database, Link, Upload, LayoutGrid, Maximize, Square, RectangleHorizontal, Download, Music, Loader2, Palette, Layout } from 'lucide-react';
import { VisualizationConfig, Project, FileCollection, BoxStyle } from '../types';

interface ControlPanelProps {
  projects: Project[];
  activeProjectId: string;
  collections: FileCollection[];

  onProjectChange: (projectId: string) => void;
  onProjectCreate: (name: string) => void;
  onProjectRename: (id: string, name: string) => void;
  onProjectDelete: (projectId: string) => void;

  onImportImages: () => void;
  onImportGT: () => void;
  onLoadPred: () => void;

  config: VisualizationConfig;
  onConfigChange: (newConfig: VisualizationConfig) => void;

  stats: {
    totalImages: number;
    hasGt: boolean;
    hasPred: boolean;
    imagePath?: string;
    gtPath?: string;
    predPath?: string;
    audioPath?: string;
  };
  isEditMode: boolean;
  onToggleEditMode: (enabled: boolean) => void;
  onExportLabels: () => void;
  onLoadAudio: () => void;
  onImportFolder: () => void;
  hasAudio: boolean;
  isExporting: boolean;
}

const ControlPanel: React.FC<ControlPanelProps> = ({
  projects,
  activeProjectId,
  collections,
  onProjectChange,
  onProjectCreate,
  onProjectRename,
  onProjectDelete,
  onImportImages,
  onImportGT,
  onLoadPred,
  onConfigChange,
  config,
  stats,
  isEditMode,
  onToggleEditMode,
  onExportLabels,
  onLoadAudio,
  onImportFolder,
  hasAudio,
  isExporting
}) => {
  const [mode, setMode] = useState<'view' | 'create' | 'rename'>('view');
  const [inputValue, setInputValue] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const activeProject = projects.find(p => p.id === activeProjectId);

  useEffect(() => {
    if (mode === 'rename' && activeProject) {
      setInputValue(activeProject.name);
    } else if (mode === 'create') {
      setInputValue('');
    }
  }, [mode, activeProject]);

  const handleStyleChange = (key: keyof VisualizationConfig['styles'], field: keyof BoxStyle, value: string | boolean) => {
    onConfigChange({
      ...config,
      styles: {
        ...config.styles,
        [key]: {
          ...config.styles[key],
          [field]: value
        }
      }
    });
  };

  const handleSubmit = () => {
    if (!inputValue.trim()) return;

    if (mode === 'create') {
      onProjectCreate(inputValue.trim());
    } else if (mode === 'rename') {
      onProjectRename(activeProjectId, inputValue.trim());
    }
    setMode('view');
    setInputValue('');
  };

  const imageCollections = collections.filter(c => c.type === 'images');
  const labelCollections = collections.filter(c => c.type === 'labels');

  return (
    <div className="w-80 h-screen bg-surface border-r border-slate-700 flex flex-col p-4 overflow-y-auto custom-scrollbar text-sm z-20 relative flex-shrink-0">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <Monitor className="w-6 h-6 text-primary" />
            YOLO VisLab
          </h1>
          <p className="text-slate-400 text-xs mt-1">Research Visualization Tool</p>
        </div>
        <button
          onClick={() => setIsSettingsOpen(true)}
          className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors"
          title="Advanced Settings"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>

      {/* Layout Controls */}
      <div className="mb-6 space-y-4">
        {/* Grid Size & Aspect Ratio */}
        <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Layout</span>
          </div>

          {/* Grid Size Toggle */}
          <div className="flex gap-2 mb-3">
            <button
              onClick={() => onConfigChange({ ...config, gridSize: 1 })}
              className={`flex-1 py-1.5 px-2 rounded text-xs flex items-center justify-center gap-1 border ${config.gridSize === 1 ? 'bg-primary/20 border-primary text-primary' : 'bg-slate-700 border-transparent text-slate-400'}`}
            >
              <LayoutGrid className="w-3 h-3" /> 1x1
            </button>
            <button
              onClick={() => onConfigChange({ ...config, gridSize: 9 })}
              className={`flex-1 py-1.5 px-2 rounded text-xs flex items-center justify-center gap-1 border ${config.gridSize === 9 ? 'bg-primary/20 border-primary text-primary' : 'bg-slate-700 border-transparent text-slate-400'}`}
            >
              <LayoutGrid className="w-3 h-3" /> 3x3
            </button>
            <button
              onClick={() => onConfigChange({ ...config, gridSize: 16 })}
              className={`flex-1 py-1.5 px-2 rounded text-xs flex items-center justify-center gap-1 border ${config.gridSize === 16 ? 'bg-primary/20 border-primary text-primary' : 'bg-slate-700 border-transparent text-slate-400'}`}
            >
              <LayoutGrid className="w-3 h-3" /> 4x4
            </button>
          </div>

          {/* Aspect Ratio Selector */}
          <div className="grid grid-cols-4 gap-1">
            {[
              { id: '16:9', icon: RectangleHorizontal, label: '16:9' },
              { id: '4:3', icon: RectangleHorizontal, label: '4:3' },
              { id: '1:1', icon: Square, label: '1:1' },
              { id: 'auto', icon: Maximize, label: 'Auto' },
            ].map((opt) => (
              <button
                key={opt.id}
                // @ts-ignore
                onClick={() => onConfigChange({ ...config, aspectRatio: opt.id })}
                className={`flex flex-col items-center justify-center py-1 rounded border transition-colors ${config.aspectRatio === opt.id ? 'bg-primary/20 border-primary text-primary' : 'bg-slate-700 border-transparent text-slate-400 hover:bg-slate-600'}`}
                title={opt.label}
              >
                <opt.icon className="w-3 h-3 mb-0.5" />
                <span className="text-[9px]">{opt.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Project Data */}
      <div className="space-y-6 mb-8 mt-2">
        <div className="flex items-center justify-between border-b border-slate-700 pb-2">
          <h2 className="text-slate-300 font-semibold flex items-center gap-2">
            <Database className="w-4 h-4" /> Data Sources
          </h2>
          <button
            onClick={onImportFolder}
            className="text-xs flex items-center gap-1 bg-primary/20 text-primary hover:bg-primary/30 px-2 py-1 rounded transition-colors border border-primary/30"
            title="Import Full Dataset Folder"
          >
            <FolderOpen className="w-3 h-3" /> Import Folder
          </button>
        </div>

        {/* Images */}
        <div className="space-y-1">
          <label className="text-slate-400 text-xs block">Images Folder</label>
          <button
            onClick={onImportImages}
            className={`w-full py-2 px-3 rounded flex items-center justify-center gap-2 transition-colors text-xs border border-dashed ${stats.totalImages > 0 ? 'bg-primary/20 border-primary text-primary' : 'bg-slate-700 border-slate-600 text-slate-200 hover:bg-slate-600'}`}
          >
            <FileImage className="w-3 h-3" /> {stats.imagePath ? stats.imagePath : 'Load Images'}
          </button>
          {stats.imagePath && <p className="text-[10px] text-slate-500 truncate px-1">Source: {stats.imagePath}</p>}
        </div>

        {/* GT labels */}
        <div className="space-y-1">
          <label className="text-slate-400 text-xs block">Ground Truth Labels</label>
          <button
            onClick={onImportGT}
            className={`w-full py-2 px-3 rounded flex items-center justify-center gap-2 transition-colors text-xs border border-dashed ${stats.hasGt ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400' : 'bg-slate-700 border-slate-600 text-slate-200 hover:bg-slate-600'}`}
          >
            <FileText className="w-3 h-3" /> {stats.gtPath ? stats.gtPath : 'Load Labels'}
          </button>
          {stats.gtPath && <p className="text-[10px] text-slate-500 truncate px-1">Source: {stats.gtPath}</p>}

          {stats.hasGt && (
            <div className="space-y-2 mt-2">
              <div className="flex gap-2">
                <button
                  onClick={() => onToggleEditMode(!isEditMode)}
                  className={`flex-1 py-1.5 px-2 rounded text-xs flex items-center justify-center gap-1 border transition-colors ${isEditMode ? 'bg-amber-500/20 border-amber-500 text-amber-500' : 'bg-slate-700 border-transparent text-slate-300 hover:bg-slate-600'}`}
                >
                  <Pencil className="w-3 h-3" /> {isEditMode ? 'Editing On' : 'Edit Labels'}
                </button>
                <button
                  onClick={onExportLabels}
                  disabled={isExporting}
                  className="py-1.5 px-3 rounded text-xs flex items-center justify-center gap-1 border border-slate-600 bg-slate-700 text-slate-300 hover:bg-slate-600 hover:text-white disabled:opacity-50"
                  title="Download Modified Labels"
                >
                  {isExporting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                </button>
              </div>

              {isEditMode && (
                <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer pl-1">
                  <input
                    type="checkbox"
                    checked={config.showPredInEditMode ?? false}
                    onChange={(e) => onConfigChange({ ...config, showPredInEditMode: e.target.checked })}
                    className="rounded bg-slate-700 border-slate-600 text-primary"
                  />
                  Show Predictions
                </label>
              )}
            </div>
          )}
        </div>

        {/* Pred Labels */}
        <div className="space-y-1">
          <label className="text-slate-400 text-xs block">Predictions</label>
          <button
            onClick={onLoadPred}
            className={`w-full py-2 px-3 rounded flex items-center justify-center gap-2 transition-colors text-xs border border-dashed ${stats.hasPred ? 'bg-amber-500/20 border-amber-500 text-amber-500' : 'bg-slate-700 border-slate-600 text-slate-200 hover:bg-slate-600'}`}
          >
            <Upload className="w-3 h-3" /> {stats.predPath ? stats.predPath : 'Load Predictions'}
          </button>
          {stats.predPath && <p className="text-[10px] text-slate-500 truncate px-1">Source: {stats.predPath}</p>}
        </div>

        {/* Audio */}
        <div className="space-y-1">
          <label className="text-slate-400 text-xs block">Audio Source</label>
          <button
            onClick={onLoadAudio}
            className={`w-full py-2 px-3 rounded flex items-center justify-center gap-2 transition-colors text-xs border border-dashed ${hasAudio ? 'bg-indigo-500/20 border-indigo-500 text-indigo-400' : 'bg-slate-700 border-slate-600 text-slate-200 hover:bg-slate-600'}`}
          >
            <Music className="w-3 h-3" /> {stats.audioPath ? stats.audioPath : 'Load Audio'}
          </button>
          {stats.audioPath && <p className="text-[10px] text-slate-500 truncate px-1">Source: {stats.audioPath}</p>}
        </div>
      </div>

      {/* Analysis Section */}
      <div className="space-y-4 mb-8">
        <h2 className="text-slate-300 font-semibold flex items-center gap-2 border-b border-slate-700 pb-2">
          <Layout className="w-4 h-4" /> Analysis
        </h2>
        <div className="space-y-3">
          <div>
            <div className="flex justify-between mb-1"><label className="text-slate-300 text-[10px]">Conf Threshold</label><span className="text-[10px] text-primary">{config.confThreshold.toFixed(2)}</span></div>
            <input type="range" min="0.0" max="1.0" step="0.05" value={config.confThreshold} onChange={(e) => onConfigChange({ ...config, confThreshold: parseFloat(e.target.value) })} className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-primary" />
          </div>
          <div>
            <div className="flex justify-between mb-1"><label className="text-slate-300 text-[10px]">IoMin Threshold</label><span className="text-[10px] text-primary">{config.ioMinThreshold.toFixed(2)}</span></div>
            <input type="range" min="0.1" max="1.0" step="0.05" value={config.ioMinThreshold} onChange={(e) => onConfigChange({ ...config, ioMinThreshold: parseFloat(e.target.value) })} className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-primary" />
          </div>
        </div>
      </div>

      {/* Colors Section */}
      <div className="space-y-4">
        <h2 className="text-slate-300 font-semibold flex items-center gap-2 border-b border-slate-700 pb-2">
          <Palette className="w-4 h-4" /> Colors & Highlights
        </h2>

        <div className="grid grid-cols-1 gap-2 pt-1">
          {[
            { id: 'tpPred', label: 'TP (Prediction)', color: config.styles.tpPred.color },
            { id: 'tpGt', label: 'TP (GT Match)', color: config.styles.tpGt.color },
            { id: 'fn', label: 'False Negative', color: config.styles.fn.color },
            { id: 'fp', label: 'False Positive', color: config.styles.fp.color },
          ].map(style => (
            <div key={style.id} className="bg-slate-800/50 p-2 rounded border border-slate-700 flex justify-between items-center">
              <span className="text-xs text-slate-300">{style.label}</span>
              <input
                type="color"
                value={style.color}
                onChange={(e) => handleStyleChange(style.id as any, 'color', e.target.value)}
                className="w-4 h-4 bg-transparent border-none cursor-pointer"
              />
            </div>
          ))}

          <div className="bg-amber-900/40 p-2 rounded border border-amber-500/50 mt-1 flex justify-between items-center">
            <span className="text-xs font-semibold text-amber-200">Edit Mode Highlight</span>
            <input
              type="color"
              value={config.editHighlightColor ?? '#fbbf24'}
              onChange={(e) => onConfigChange({ ...config, editHighlightColor: e.target.value })}
              className="w-4 h-4 bg-transparent border-none cursor-pointer"
            />
          </div>

          <div className="bg-indigo-900/40 p-2 rounded border border-indigo-500/50 mt-1 flex justify-between items-center">
            <span className="text-xs font-semibold text-indigo-200">Audio Highlight</span>
            <input
              type="color"
              value={config.audio?.highlightColor ?? '#00ff00'}
              onChange={(e) => onConfigChange({ ...config, audio: { ...config.audio!, highlightColor: e.target.value } })}
              className="w-4 h-4 bg-transparent border-none cursor-pointer"
            />
          </div>
        </div>
      </div>

      {/* Settings Modal */}
      {isSettingsOpen && createPortal(
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col">
            <div className="p-4 border-b border-slate-800 flex justify-between items-center">
              <h3 className="font-bold text-slate-200 flex items-center gap-2">
                <Settings className="w-4 h-4" /> Advanced Settings
              </h3>
              <button onClick={() => setIsSettingsOpen(false)} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>

            <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto custom-scrollbar">
              {/* Visuals */}
              <section className="space-y-4">
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Visual Style</h4>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={config.showLabels ?? true}
                    onChange={(e) => onConfigChange({ ...config, showLabels: e.target.checked })}
                    className="rounded bg-slate-800 border-slate-700 text-primary"
                  />
                  <label className="text-slate-300 text-sm">Show Box Labels</label>
                </div>
                <div>
                  <div className="flex justify-between mb-1"><label className="text-slate-300 text-sm">Line Width</label><span className="text-xs text-primary">{config.lineWidth}px</span></div>
                  <input type="range" min="1" max="10" step="1" value={config.lineWidth} onChange={(e) => onConfigChange({ ...config, lineWidth: parseInt(e.target.value) })} className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-primary" />
                </div>
                <div>
                  <div className="flex justify-between mb-1"><label className="text-slate-300 text-sm">Label Font Size</label><span className="text-xs text-primary">{config.labelFontSize}px</span></div>
                  <input type="range" min="8" max="32" step="1" value={config.labelFontSize} onChange={(e) => onConfigChange({ ...config, labelFontSize: parseInt(e.target.value) })} className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-primary" />
                </div>
              </section>

              {/* Audio Analysis */}
              <section className="space-y-4">
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Audio Analysis (Hz)</h4>
                <div>
                  <div className="flex justify-between mb-1"><label className="text-slate-300 text-sm">Min Frequency</label><span className="text-xs text-primary">{config.audio?.minFreq} Hz</span></div>
                  <input type="range" min="0" max="20000" step="100" value={config.audio?.minFreq} onChange={(e) => onConfigChange({ ...config, audio: { ...config.audio!, minFreq: parseInt(e.target.value) } })} className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-primary" />
                </div>
                <div>
                  <div className="flex justify-between mb-1"><label className="text-slate-300 text-sm">Max Frequency</label><span className="text-xs text-primary">{config.audio?.maxFreq} Hz</span></div>
                  <input type="range" min="0" max="20000" step="100" value={config.audio?.maxFreq} onChange={(e) => onConfigChange({ ...config, audio: { ...config.audio!, maxFreq: parseInt(e.target.value) } })} className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-primary" />
                </div>
                <div>
                  <div className="flex justify-between mb-1"><label className="text-slate-300 text-sm">Clip Duration (sec)</label><span className="text-xs text-primary">{config.audio?.clipSec ?? 6.0}s</span></div>
                  <input type="range" min="1.0" max="15.0" step="0.5" value={config.audio?.clipSec ?? 6.0} onChange={(e) => onConfigChange({ ...config, audio: { ...config.audio!, clipSec: parseFloat(e.target.value) } })} className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-primary" />
                </div>
                <div>
                  <div className="flex justify-between mb-1"><label className="text-slate-300 text-sm">Frame Stride (sec)</label><span className="text-xs text-primary">{config.audio?.strideSec ?? 5.0}s</span></div>
                  <input type="range" min="1.0" max="15.0" step="0.5" value={config.audio?.strideSec ?? 5.0} onChange={(e) => onConfigChange({ ...config, audio: { ...config.audio!, strideSec: parseFloat(e.target.value) } })} className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-primary" />
                </div>
              </section>
            </div>

            <div className="p-4 border-t border-slate-800 bg-slate-800/20 flex justify-end">
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors font-semibold"
              >
                Done
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div >
  );
};

export default ControlPanel;