import React, { useRef, useState, useEffect } from 'react';
import { Settings, Monitor, FileImage, FileText, FolderPlus, FolderOpen, Trash2, Pencil, Check, X, Database, Link, Upload, LayoutGrid, Maximize, Square, RectangleHorizontal } from 'lucide-react';
import { VisualizationConfig, Project, FileCollection, BoxStyle } from '../types';

interface ControlPanelProps {
  projects: Project[];
  activeProjectId: string;
  collections: FileCollection[];
  
  onProjectChange: (projectId: string) => void;
  onProjectCreate: (name: string) => void;
  onProjectRename: (id: string, name: string) => void;
  onProjectDelete: (projectId: string) => void;
  
  onBindData: (type: 'image' | 'gt', collectionId: string | null) => void;
  onLoadPred: (files: FileList) => void; 
  
  onImportCollection: (type: 'images' | 'labels', files: FileList) => void;
  onDeleteCollection: (id: string) => void;
  
  config: VisualizationConfig;
  onConfigChange: (newConfig: VisualizationConfig) => void;
  
  stats: {
    totalImages: number;
    hasGt: boolean;
    hasPred: boolean;
  };
}

const ControlPanel: React.FC<ControlPanelProps> = ({
  projects,
  activeProjectId,
  collections,
  onProjectChange,
  onProjectCreate,
  onProjectRename,
  onProjectDelete,
  onBindData,
  onLoadPred,
  onImportCollection,
  onDeleteCollection,
  config,
  onConfigChange,
  stats
}) => {
  const [mode, setMode] = useState<'view' | 'create' | 'rename'>('view');
  const [inputValue, setInputValue] = useState('');

  // Hidden inputs
  const importImgRef = useRef<HTMLInputElement>(null);
  const importLabelRef = useRef<HTMLInputElement>(null);
  const projectPredRef = useRef<HTMLInputElement>(null);

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
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
          <Monitor className="w-6 h-6 text-primary" />
          YOLO VisLab
        </h1>
        <p className="text-slate-400 text-xs mt-1">Research Visualization Tool</p>
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
              onClick={() => onConfigChange({...config, gridSize: 9})}
              className={`flex-1 py-1.5 px-2 rounded text-xs flex items-center justify-center gap-1 border ${config.gridSize === 9 ? 'bg-primary/20 border-primary text-primary' : 'bg-slate-700 border-transparent text-slate-400'}`}
            >
              <LayoutGrid className="w-3 h-3" /> 3x3
            </button>
            <button 
              onClick={() => onConfigChange({...config, gridSize: 16})}
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
                onClick={() => onConfigChange({...config, aspectRatio: opt.id})}
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

      {/* Project Management */}
      <div className="space-y-4 mb-8">
        <h2 className="text-slate-300 font-semibold flex items-center gap-2 border-b border-slate-700 pb-2">
          <FolderOpen className="w-4 h-4" /> Projects
        </h2>

        {mode === 'view' ? (
           <div className="space-y-2">
             <div className="flex gap-2">
               <div className="flex-1 relative">
                  <select 
                    value={activeProjectId}
                    onChange={(e) => onProjectChange(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 text-slate-200 rounded-l px-3 py-2 appearance-none focus:outline-none focus:border-primary truncate pr-8"
                  >
                    {projects.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                  <div className="absolute right-3 top-2.5 pointer-events-none text-slate-500">▼</div>
               </div>
               
               <button onClick={() => setMode('rename')} className="bg-slate-700 hover:bg-slate-600 text-slate-200 p-2 border-y border-r border-slate-700"><Pencil className="w-4 h-4" /></button>
               <button onClick={() => setMode('create')} className="bg-slate-700 hover:bg-slate-600 text-slate-200 p-2 rounded-r border-y border-r border-slate-700"><FolderPlus className="w-4 h-4" /></button>
             </div>
             {projects.length > 1 && (
                <button onClick={() => {if(window.confirm(`Delete "${activeProject?.name}"?`)) onProjectDelete(activeProjectId);}} className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1 mt-1 ml-1">
                  <Trash2 className="w-3 h-3" /> Delete Project
                </button>
             )}
           </div>
        ) : (
          <div className="flex gap-2">
            <input type="text" value={inputValue} onChange={(e) => setInputValue(e.target.value)} placeholder={mode === 'create' ? "Name" : "Rename"} className="flex-1 bg-slate-800 border border-slate-700 text-slate-200 rounded px-2 py-1 focus:outline-none focus:border-primary" autoFocus onKeyDown={(e) => e.key === 'Enter' && handleSubmit()} />
            <button onClick={handleSubmit} className="bg-green-600 text-white px-2 rounded"><Check className="w-4 h-4" /></button>
            <button onClick={() => setMode('view')} className="bg-slate-700 text-slate-200 px-2 rounded"><X className="w-4 h-4" /></button>
          </div>
        )}
      </div>

      {/* Project Data */}
      <div className="space-y-4 mb-8">
        <h2 className="text-slate-300 font-semibold flex items-center gap-2 border-b border-slate-700 pb-2">
          <Link className="w-4 h-4" /> Project Data
        </h2>
        
        {/* Images */}
        <div>
          <label className="text-slate-400 text-xs mb-1 block">Dataset (Images)</label>
          <div className="relative">
            <select value={activeProject?.imageCollectionId || ''} onChange={(e) => onBindData('image', e.target.value || null)} className="w-full bg-slate-800 border border-slate-700 text-slate-200 rounded px-3 py-2 appearance-none focus:outline-none focus:border-primary text-xs">
              <option value="">-- No Dataset Selected --</option>
              {imageCollections.map(c => <option key={c.id} value={c.id}>{c.name} ({c.count})</option>)}
            </select>
            <div className="absolute right-3 top-2.5 pointer-events-none text-slate-500">▼</div>
          </div>
        </div>

        {/* GT */}
        <div>
          <label className="text-slate-400 text-xs mb-1 block">Ground Truth Labels</label>
           <div className="relative">
            <select value={activeProject?.gtCollectionId || ''} onChange={(e) => onBindData('gt', e.target.value || null)} className="w-full bg-slate-800 border border-slate-700 text-slate-200 rounded px-3 py-2 appearance-none focus:outline-none focus:border-primary text-xs">
              <option value="">-- No GT Selected --</option>
              {labelCollections.map(c => <option key={c.id} value={c.id}>{c.name} ({c.count})</option>)}
            </select>
             <div className="absolute right-3 top-2.5 pointer-events-none text-slate-500">▼</div>
          </div>
        </div>

         {/* Pred (Local Upload) */}
         <div>
          <div className="flex justify-between items-center mb-1">
             <label className="text-slate-400 text-xs block">Predictions (Project Specific)</label>
             <span className={`text-[10px] ${stats.hasPred ? 'text-green-400' : 'text-slate-500'}`}>{stats.hasPred ? 'Loaded' : 'None'}</span>
          </div>
          <button onClick={() => projectPredRef.current?.click()} className="w-full bg-slate-700 hover:bg-slate-600 text-slate-200 py-2 px-3 rounded flex items-center justify-center gap-2 transition-colors text-xs border border-slate-600 border-dashed">
            <Upload className="w-3 h-3" /> Upload Prediction Labels
          </button>
          <input type="file" ref={projectPredRef} className="hidden" 
          // @ts-ignore
          webkitdirectory="" directory="" multiple onChange={(e) => e.target.files && onLoadPred(e.target.files)} />
        </div>
      </div>

      {/* Global Data Library */}
      <div className="space-y-4 mb-8">
        <h2 className="text-slate-300 font-semibold flex items-center gap-2 border-b border-slate-700 pb-2">
          <Database className="w-4 h-4" /> Data Library
        </h2>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => importImgRef.current?.click()} className="bg-slate-700 hover:bg-slate-600 text-slate-200 py-2 rounded flex flex-col items-center justify-center gap-1 transition-colors text-xs p-1">
            <FileImage className="w-4 h-4" /> Add Images
          </button>
           <button onClick={() => importLabelRef.current?.click()} className="bg-slate-700 hover:bg-slate-600 text-slate-200 py-2 rounded flex flex-col items-center justify-center gap-1 transition-colors text-xs p-1">
            <FileText className="w-4 h-4" /> Add Labels
          </button>
        </div>
        <input type="file" ref={importImgRef} className="hidden" 
        // @ts-ignore
        webkitdirectory="" directory="" multiple onChange={(e) => e.target.files && onImportCollection('images', e.target.files)} />
        <input type="file" ref={importLabelRef} className="hidden" 
        // @ts-ignore
        webkitdirectory="" directory="" multiple onChange={(e) => e.target.files && onImportCollection('labels', e.target.files)} />

        <div className="space-y-2 mt-2 max-h-32 overflow-y-auto custom-scrollbar">
           {collections.map(c => (
             <div key={c.id} className="flex items-center justify-between bg-slate-800/50 p-2 rounded border border-slate-700/50 group">
                <div className="flex items-center gap-2 overflow-hidden">
                   {c.type === 'images' ? <FileImage className="w-3 h-3 text-blue-400 flex-shrink-0" /> : <FileText className="w-3 h-3 text-emerald-400 flex-shrink-0" />}
                   <span className="text-xs text-slate-300 truncate">{c.name}</span>
                </div>
                <button onClick={() => onDeleteCollection(c.id)} className="text-slate-600 hover:text-red-400 p-1 opacity-0 group-hover:opacity-100"><Trash2 className="w-3 h-3" /></button>
             </div>
           ))}
        </div>
      </div>

      {/* Configuration */}
      <div className="space-y-4">
        <h2 className="text-slate-300 font-semibold flex items-center gap-2 border-b border-slate-700 pb-2">
          <Settings className="w-4 h-4" /> Parameters & Styles
        </h2>
        
        {/* Global Params */}
        <div className="space-y-3 pt-2">
          <p className="text-xs text-slate-400 uppercase font-bold tracking-wider">Analysis</p>
          <div>
            <div className="flex justify-between mb-1"><label className="text-slate-300">IoP Threshold</label><span className="text-xs text-primary">{config.iopThreshold.toFixed(2)}</span></div>
            <input type="range" min="0.1" max="1.0" step="0.05" value={config.iopThreshold} onChange={(e) => onConfigChange({...config, iopThreshold: parseFloat(e.target.value)})} className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-primary" />
            <p className="text-[10px] text-slate-500 mt-1">Intersection over Prediction Area</p>
          </div>
          <div>
             <div className="flex justify-between mb-1"><label className="text-slate-300">Conf Threshold</label><span className="text-xs text-primary">{config.confThreshold.toFixed(2)}</span></div>
            <input type="range" min="0.0" max="1.0" step="0.05" value={config.confThreshold} onChange={(e) => onConfigChange({...config, confThreshold: parseFloat(e.target.value)})} className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-primary" />
          </div>
          <div>
             <div className="flex justify-between mb-1"><label className="text-slate-300">Line Width</label><span className="text-xs text-primary">{config.lineWidth}px</span></div>
            <input type="range" min="1" max="10" step="1" value={config.lineWidth} onChange={(e) => onConfigChange({...config, lineWidth: parseInt(e.target.value)})} className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-primary" />
          </div>
          <div>
             <div className="flex justify-between mb-1"><label className="text-slate-300">Label Size</label><span className="text-xs text-primary">{config.labelFontSize}px</span></div>
            <input type="range" min="8" max="40" step="1" value={config.labelFontSize} onChange={(e) => onConfigChange({...config, labelFontSize: parseInt(e.target.value)})} className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-primary" />
          </div>
        </div>

        {/* Style Helpers */}
        <div className="grid grid-cols-1 gap-3 pt-2">
           <p className="text-xs text-slate-400 uppercase font-bold tracking-wider">Colors</p>
           {/* TP Pred */}
           <div className="bg-slate-800/50 p-2 rounded border border-slate-700">
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs font-medium text-slate-300">TP (Prediction)</span>
                <input type="color" value={config.styles.tpPred.color} onChange={(e) => handleStyleChange('tpPred', 'color', e.target.value)} className="w-4 h-4 bg-transparent border-none cursor-pointer" />
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                <input type="checkbox" checked={config.styles.tpPred.dashed} onChange={(e) => handleStyleChange('tpPred', 'dashed', e.target.checked)} className="rounded bg-slate-700 border-slate-600 text-primary" />
                Dashed Line
              </label>
           </div>
           {/* Others... */}
           <div className="bg-slate-800/50 p-2 rounded border border-slate-700">
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs font-medium text-slate-300">TP (GT Match)</span>
                <input type="color" value={config.styles.tpGt.color} onChange={(e) => handleStyleChange('tpGt', 'color', e.target.value)} className="w-4 h-4 bg-transparent border-none cursor-pointer" />
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                <input type="checkbox" checked={config.styles.tpGt.dashed} onChange={(e) => handleStyleChange('tpGt', 'dashed', e.target.checked)} className="rounded bg-slate-700 border-slate-600 text-primary" />
                Dashed Line
              </label>
           </div>
           
           <div className="bg-slate-800/50 p-2 rounded border border-slate-700">
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs font-medium text-slate-300">False Negative</span>
                <input type="color" value={config.styles.fn.color} onChange={(e) => handleStyleChange('fn', 'color', e.target.value)} className="w-4 h-4 bg-transparent border-none cursor-pointer" />
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                <input type="checkbox" checked={config.styles.fn.dashed} onChange={(e) => handleStyleChange('fn', 'dashed', e.target.checked)} className="rounded bg-slate-700 border-slate-600 text-primary" />
                Dashed Line
              </label>
           </div>
           
           <div className="bg-slate-800/50 p-2 rounded border border-slate-700">
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs font-medium text-slate-300">False Positive</span>
                <input type="color" value={config.styles.fp.color} onChange={(e) => handleStyleChange('fp', 'color', e.target.value)} className="w-4 h-4 bg-transparent border-none cursor-pointer" />
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                <input type="checkbox" checked={config.styles.fp.dashed} onChange={(e) => handleStyleChange('fp', 'dashed', e.target.checked)} className="rounded bg-slate-700 border-slate-600 text-primary" />
                Dashed Line
              </label>
           </div>

        </div>
      </div>
    </div>
  );
};

export default ControlPanel;