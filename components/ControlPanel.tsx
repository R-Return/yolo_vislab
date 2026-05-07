import React, { useRef, useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Settings, Monitor, FileImage, FileText, FolderPlus, FolderOpen, Trash2, Pencil, Check, X, Database, Link, Upload, LayoutGrid, Maximize, Square, RectangleHorizontal, Download, Music, Loader2, Palette, Layout, ChevronDown, ChevronRight, GripVertical } from 'lucide-react';
import { VisualizationConfig, Project, FileCollection, BoxStyle, PredictionSource, MatchOverlapMetric } from '../types';

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
    audioPath?: string;
  };
  predictionSources: PredictionSource[];
  onTogglePredictionVisibility: (id: string, visible: boolean) => void;
  onUpdatePredictionColor: (id: string, color: string) => void;
  onDeletePrediction: (id: string) => void;
  onReorderPredictions: (newSources: PredictionSource[]) => void;
  onSetIsolatedPredictions: (ids: string[]) => void;
  onToggleGroupVisibility: (groupId: string, visible: boolean) => void;
  onToggleAllPredictionsVisibility: (visible: boolean) => void;
  isEditMode: boolean;
  onToggleEditMode: (enabled: boolean) => void;
  onExportLabels: (asZip?: boolean) => void;
  onLoadAudio: () => void;
  onImportFolder: () => void;
  hasAudio: boolean;
  isExporting: boolean;
  exportProgress?: { current: number, total: number } | null;
}

const IndeterminateCheckbox: React.FC<{
  checked: boolean;
  indeterminate: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
  title?: string;
}> = ({ checked, indeterminate, onChange, className, title }) => {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className={className}
      title={title}
    />
  );
};

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
  predictionSources,
  onTogglePredictionVisibility,
  onUpdatePredictionColor,
  onDeletePrediction,
  onReorderPredictions,
  onSetIsolatedPredictions,
  onToggleGroupVisibility,
  onToggleAllPredictionsVisibility,
  isEditMode,
  onToggleEditMode,
  onExportLabels,
  onLoadAudio,
  onImportFolder,
  hasAudio,
  isExporting,
  exportProgress
}) => {
  const [mode, setMode] = useState<'view' | 'create' | 'rename'>('view');
  const [inputValue, setInputValue] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const dragStartIdx = useRef<number | null>(null);

  const toggleGroup = (groupId: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const handleDragStart = (idx: number) => {
    dragStartIdx.current = idx;
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (dropIdx: number) => {
    if (dragStartIdx.current === null) return;
    const items = [...predictionSources];
    const [reorderedItem] = items.splice(dragStartIdx.current, 1);
    items.splice(dropIdx, 0, reorderedItem);
    onReorderPredictions(items);
    dragStartIdx.current = null;
  };

  // Grouping logic for rendering
  const { groups, ungrouped } = useMemo(() => {
    const g: Record<string, PredictionSource[]> = {};
    const u: PredictionSource[] = [];

    predictionSources.forEach(s => {
      if (s.groupId) {
        if (!g[s.groupId]) g[s.groupId] = [];
        g[s.groupId].push(s);
      } else {
        u.push(s);
      }
    });

    return { groups: g, ungrouped: u };
  }, [predictionSources]);

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
                  onClick={() => onExportLabels(false)}
                  disabled={isExporting}
                  className="py-1.5 px-3 rounded text-xs flex items-center justify-center gap-1 border border-slate-600 bg-slate-700 text-slate-300 hover:bg-slate-600 hover:text-white disabled:opacity-50"
                  title="Download Modified Labels to Folder"
                >
                  {isExporting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                </button>
              </div>

              <div className="flex gap-2 mt-1">
                <button
                  onClick={() => onExportLabels(true)}
                  disabled={isExporting}
                  className="flex-1 py-1 px-2 rounded text-[10px] flex items-center justify-center gap-1 border border-slate-600 bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white disabled:opacity-50 transition-colors"
                  title="Download all modified labels as a single .zip file"
                >
                  <Download className="w-3 h-3" /> Download as Zip
                </button>
              </div>

              {isExporting && exportProgress && (
                <div className="mt-2 text-[10px] text-slate-400">
                  <div className="flex justify-between mb-1">
                    <span>Exporting...</span>
                    <span>{exportProgress.current} / {exportProgress.total}</span>
                  </div>
                  <div className="w-full bg-slate-700 rounded-full h-1.5">
                    <div
                      className="bg-primary h-1.5 rounded-full transition-all duration-300"
                      style={{ width: `${(exportProgress.current / Math.max(1, exportProgress.total)) * 100}%` }}
                    ></div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Pred Labels */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-slate-400 text-xs block font-medium">Predictions</label>
            {predictionSources.length > 0 && (
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-[10px] text-slate-400 cursor-pointer hover:text-slate-300">
                  <IndeterminateCheckbox
                    checked={predictionSources.every(s => s.visible)}
                    indeterminate={predictionSources.some(s => s.visible) && !predictionSources.every(s => s.visible)}
                    onChange={(checked) => onToggleAllPredictionsVisibility(checked)}
                    className="rounded bg-slate-700 border-slate-600 text-primary w-3 h-3 cursor-pointer"
                    title="Toggle All Predictions"
                  />
                  Select All
                </label>
                <label className="flex items-center gap-1.5 text-[10px] text-slate-400 cursor-pointer hover:text-slate-300">
                  <input
                    type="checkbox"
                    checked={config.showPredictions ?? true}
                    onChange={(e) => onConfigChange({ ...config, showPredictions: e.target.checked })}
                    className="rounded bg-slate-700 border-slate-600 text-primary w-3 h-3 cursor-pointer"
                  />
                  Show UI
                </label>
              </div>
            )}
          </div>

          {predictionSources.length > 0 && (
            <div className="space-y-3 mb-2 max-h-[400px] overflow-y-auto pr-1 custom-scrollbar">
              {/* Ungrouped Predictions */}
              {ungrouped.map((source) => {
                const globalIdx = predictionSources.findIndex(s => s.id === source.id);
                return (
                  <div
                    key={source.id}
                    draggable
                    onDragStart={() => handleDragStart(globalIdx)}
                    onDragOver={handleDragOver}
                    onDrop={() => handleDrop(globalIdx)}
                    onMouseEnter={() => onSetIsolatedPredictions([source.id])}
                    onMouseLeave={() => onSetIsolatedPredictions([])}
                    className="flex items-center justify-between bg-slate-800/50 p-1.5 rounded border border-slate-700 hover:border-slate-500 transition-colors cursor-grab active:cursor-grabbing group"
                  >
                    <div className="flex items-center gap-2 overflow-hidden flex-1">
                      <GripVertical className="w-3 h-3 text-slate-600 group-hover:text-slate-400 flex-shrink-0" />
                      <input
                        type="color"
                        value={source.color}
                        onChange={(e) => onUpdatePredictionColor(source.id, e.target.value)}
                        className="w-4 h-4 rounded cursor-pointer bg-transparent border-none flex-shrink-0"
                        title="Change Color"
                      />
                      <span className="text-xs text-slate-300 truncate" title={source.path}>{source.name}</span>
                    </div>
                    <div className="flex items-center gap-1.5 ml-2">
                      <input
                        type="checkbox"
                        checked={source.visible}
                        onChange={(e) => onTogglePredictionVisibility(source.id, e.target.checked)}
                        className="w-3.5 h-3.5 rounded bg-slate-700 border-slate-600 text-primary cursor-pointer"
                        title="Toggle Visibility"
                      />
                      <button
                        onClick={() => onDeletePrediction(source.id)}
                        className="p-1 rounded hover:bg-slate-700 text-slate-500 hover:text-red-400 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}

              {/* Grouped Predictions */}
              {(Object.entries(groups) as [string, PredictionSource[]][]).map(([groupId, sources]) => (
                <div key={groupId} className="space-y-1 bg-slate-900/30 rounded-lg p-1 border border-slate-800/50">
                  <div
                    onMouseEnter={() => onSetIsolatedPredictions(sources.map(s => s.id))}
                    onMouseLeave={() => onSetIsolatedPredictions([])}
                    className="flex items-center justify-between px-2 py-1 cursor-pointer hover:bg-slate-800/50 rounded transition-colors group"
                  >
                    <div className="flex items-center gap-2 overflow-hidden" onClick={() => toggleGroup(groupId)}>
                      {collapsedGroups.has(groupId) ? <ChevronRight className="w-3.5 h-3.5 text-slate-500" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-500" />}
                      <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider truncate">{groupId}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-600 group-hover:text-slate-400">{sources.length} models</span>
                      <IndeterminateCheckbox
                        checked={sources.every(s => s.visible)}
                        indeterminate={sources.some(s => s.visible) && !sources.every(s => s.visible)}
                        onChange={(checked) => onToggleGroupVisibility(groupId, checked)}
                        className="w-3.5 h-3.5 rounded bg-slate-700 border-slate-600 text-primary cursor-pointer"
                        title="Toggle Group Visibility"
                      />
                    </div>
                  </div>

                  {!collapsedGroups.has(groupId) && (
                    <div className="space-y-1 pl-2">
                      {sources.map((source) => {
                        const globalIdx = predictionSources.findIndex(s => s.id === source.id);
                        return (
                          <div
                            key={source.id}
                            draggable
                            onDragStart={() => handleDragStart(globalIdx)}
                            onDragOver={handleDragOver}
                            onDrop={() => handleDrop(globalIdx)}
                            onMouseEnter={() => onSetIsolatedPredictions([source.id])}
                            onMouseLeave={() => onSetIsolatedPredictions([])}
                            className="flex items-center justify-between bg-slate-800/30 p-1.5 rounded border border-transparent hover:border-slate-700 transition-colors cursor-grab active:cursor-grabbing group"
                          >
                            <div className="flex items-center gap-2 overflow-hidden flex-1">
                              <GripVertical className="w-3 h-3 text-slate-700 group-hover:text-slate-500 flex-shrink-0" />
                              <input
                                type="color"
                                value={source.color}
                                onChange={(e) => onUpdatePredictionColor(source.id, e.target.value)}
                                className="w-3.5 h-3.5 rounded cursor-pointer bg-transparent border-none flex-shrink-0"
                                title="Change Color"
                              />
                              <span className="text-xs text-slate-400 truncate" title={source.path}>{source.name}</span>
                            </div>
                            <div className="flex items-center gap-1.5 ml-2">
                              <input
                                type="checkbox"
                                checked={source.visible}
                                onChange={(e) => onTogglePredictionVisibility(source.id, e.target.checked)}
                                className="w-3 h-3 rounded bg-slate-700 border-slate-600 text-primary cursor-pointer"
                                title="Toggle Visibility"
                              />
                              <button
                                onClick={() => onDeletePrediction(source.id)}
                                className="p-1 rounded hover:bg-slate-700 text-slate-600 hover:text-red-400 transition-colors"
                                title="Delete"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <button
            onClick={onLoadPred}
            className={`w-full py-2 px-3 rounded flex items-center justify-center gap-2 transition-colors text-xs border border-dashed ${predictionSources.length > 0 ? 'bg-amber-500/10 border-amber-500/50 text-amber-500 hover:bg-amber-500/20' : 'bg-slate-700 border-slate-600 text-slate-200 hover:bg-slate-600'}`}
          >
            <Upload className="w-3 h-3" /> Load Predictions
          </button>
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
            <div className="flex justify-between items-center gap-2 mb-1">
              <label className="text-slate-300 text-[10px]">Conf Threshold</label>
              <input
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={Number(config.confThreshold.toFixed(2))}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (Number.isNaN(v)) return;
                  onConfigChange({
                    ...config,
                    confThreshold: Math.min(1, Math.max(0, Math.round(v * 100) / 100)),
                  });
                }}
                className="w-16 shrink-0 py-0.5 px-1 rounded border border-slate-600 bg-slate-700 text-[10px] text-primary text-right [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
            </div>
            <input
              type="range"
              min="0.0"
              max="1.0"
              step="0.05"
              value={Math.min(1, Math.max(0, Math.round(config.confThreshold / 0.05) * 0.05))}
              onChange={(e) => onConfigChange({ ...config, confThreshold: parseFloat(e.target.value) })}
              className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-primary"
            />
          </div>
          <div className="space-y-2">
            <label className="text-slate-300 text-[10px] block">Overlap metric</label>
            <select
              value={config.matchOverlapMetric}
              onChange={(e) =>
                onConfigChange({ ...config, matchOverlapMetric: e.target.value as MatchOverlapMetric })
              }
              className="w-full py-1 px-2 rounded border border-slate-600 bg-slate-700 text-[10px] text-slate-200"
            >
              <option value="iou">IoU</option>
              <option value="iomin">IoMin</option>
            </select>
            <p className="text-[10px] text-slate-500 leading-snug">
              <span className="text-slate-400">IoU:</span> standard Intersection over Union
              <br />
              <span className="text-slate-400">IoMin:</span> Intersection over the smallest box area (intersection /
              min(ground_truth, prediction)).
            </p>
            <div>
              <div className="flex justify-between items-center gap-2 mb-1">
                <label className="text-slate-300 text-[10px] shrink-0">Overlap threshold</label>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={Number(config.matchOverlapThreshold.toFixed(2))}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    if (Number.isNaN(v)) return;
                    onConfigChange({
                      ...config,
                      matchOverlapThreshold: Math.min(1, Math.max(0, Math.round(v * 100) / 100)),
                    });
                  }}
                  className="w-16 shrink-0 py-0.5 px-1 rounded border border-slate-600 bg-slate-700 text-[10px] text-primary text-right [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={Math.min(
                  1,
                  Math.max(0, Math.round(config.matchOverlapThreshold / 0.05) * 0.05)
                )}
                onChange={(e) =>
                  onConfigChange({ ...config, matchOverlapThreshold: parseFloat(e.target.value) })
                }
                className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-primary"
              />
            </div>
            <div>
              <div className="flex justify-between items-center gap-2 mb-1">
                <label className="text-slate-300 text-[10px] shrink-0">NMS IoU threshold</label>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={Number(config.nmsIouThreshold.toFixed(2))}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    if (Number.isNaN(v)) return;
                    onConfigChange({
                      ...config,
                      nmsIouThreshold: Math.min(1, Math.max(0, Math.round(v * 100) / 100)),
                    });
                  }}
                  className="w-16 shrink-0 py-0.5 px-1 rounded border border-slate-600 bg-slate-700 text-[10px] text-primary text-right [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={Math.min(1, Math.max(0, Math.round(config.nmsIouThreshold / 0.05) * 0.05))}
                onChange={(e) =>
                  onConfigChange({ ...config, nmsIouThreshold: parseFloat(e.target.value) })
                }
                className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-primary"
              />
              <p className="text-[10px] text-slate-500 leading-snug mt-1">
                Retains the highest-confidence box when multiple predicted boxes overlap more than this threshold. Set to 1 to disable.
              </p>
            </div>
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