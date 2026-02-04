import React, { useState, useMemo } from 'react';
import ControlPanel from './components/ControlPanel';
import ImageViewer from './components/ImageViewer';
import PRGraph from './components/PRGraph';
import { VisualizationConfig, ImageItem, FileMap, Project, FileCollection } from './types';
import { ChevronLeft, ChevronRight, Inbox, Download, Loader2 } from 'lucide-react';
import { drawVisualization } from './utils/render';

const DEFAULT_CONFIG: VisualizationConfig = {
  iopThreshold: 0.5, // Changed default
  confThreshold: 0.25,
  styles: {
    tpPred: { color: '#4ade80', dashed: false }, // Green, Solid
    tpGt:   { color: '#ffffff', dashed: true },  // White, Dashed
    fn:     { color: '#72f8ef', dashed: true },  // Blue/Cyan, Dashed
    fp:     { color: '#fbbf24', dashed: false }, // Amber, Solid
  },
  lineWidth: 2,
  gridSize: 9,
  zoomLevel: 1.0,
  viewMode: 'grid'
};

const generateId = () => {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
};

const createProject = (name: string): Project => ({
  id: generateId(),
  name,
  config: { ...DEFAULT_CONFIG },
  imageCollectionId: null,
  gtCollectionId: null,
  predFiles: {}, // Local
});

const App: React.FC = () => {
  const [projects, setProjects] = useState<Project[]>(() => [createProject('Default Project')]);
  const [activeProjectId, setActiveProjectId] = useState<string>(() => projects[0].id);
  const [collections, setCollections] = useState<FileCollection[]>([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);

  // Active Project Accessors
  const activeProject = projects.find(p => p.id === activeProjectId) || projects[0];
  const { config } = activeProject;

  // Resolve Files from Collections
  const imageFiles = useMemo(() => 
    collections.find(c => c.id === activeProject.imageCollectionId)?.files || {}, 
  [collections, activeProject.imageCollectionId]);

  const gtFiles = useMemo(() => 
    collections.find(c => c.id === activeProject.gtCollectionId)?.files || {}, 
  [collections, activeProject.gtCollectionId]);

  const predFiles = activeProject.predFiles;

  // State Updates
  const updateProject = (updates: Partial<Project>) => {
    setProjects(ps => ps.map(p => p.id === activeProjectId ? { ...p, ...updates } : p));
  };

  const setConfig = (newConfig: VisualizationConfig) => updateProject({ config: newConfig });
  
  // File Loading Helper
  const processFiles = (files: FileList) => {
    const map: FileMap = {};
    Array.from(files).forEach(file => {
      if (!file.name.startsWith('.')) map[file.name] = file;
    });
    return map;
  };

  // Collection Management
  const handleImportCollection = (type: 'images' | 'labels', files: FileList) => {
    if (files.length === 0) return;
    const fileMap = processFiles(files);
    const count = Object.keys(fileMap).length;
    if (count === 0) return;

    const firstFile = files[0];
    let name = `New ${type === 'images' ? 'Dataset' : 'Labels'} (${new Date().toLocaleTimeString()})`;
    if (firstFile.webkitRelativePath) {
      const parts = firstFile.webkitRelativePath.split('/');
      if (parts.length > 1) name = parts[0];
    }

    const newCollection: FileCollection = {
      id: generateId(),
      name,
      type,
      files: fileMap,
      count
    };

    setCollections(prev => [...prev, newCollection]);

    if (type === 'images' && !activeProject.imageCollectionId) updateProject({ imageCollectionId: newCollection.id });
    else if (type === 'labels' && !activeProject.gtCollectionId) updateProject({ gtCollectionId: newCollection.id });
  };

  const handleDeleteCollection = (id: string) => {
    setCollections(prev => prev.filter(c => c.id !== id));
    setProjects(ps => ps.map(p => ({
        ...p,
        imageCollectionId: p.imageCollectionId === id ? null : p.imageCollectionId,
        gtCollectionId: p.gtCollectionId === id ? null : p.gtCollectionId,
    })));
  };

  const handleBindData = (type: 'image' | 'gt', collectionId: string | null) => {
      if (type === 'image') {
          updateProject({ imageCollectionId: collectionId });
          setCurrentPage(0);
      }
      else if (type === 'gt') updateProject({ gtCollectionId: collectionId });
  };

  const handleLoadPred = (files: FileList) => {
     updateProject({ predFiles: processFiles(files) });
  };

  const handleProjectCreate = (name: string) => {
    const newProj = createProject(name);
    setProjects(prev => [...prev, newProj]);
    setActiveProjectId(newProj.id);
  };

  const handleProjectRename = (id: string, name: string) => {
    setProjects(ps => ps.map(p => p.id === id ? { ...p, name } : p));
  };

  const handleProjectDelete = (id: string) => {
    if (projects.length <= 1) return;
    const newProjects = projects.filter(p => p.id !== id);
    setProjects(newProjects);
    if (activeProjectId === id) setActiveProjectId(newProjects[0].id);
  };

  // Matched Items Logic
  const items: ImageItem[] = useMemo(() => {
    const imageNames = Object.keys(imageFiles).sort();
    return imageNames.map(imgName => {
      const baseName = imgName.substring(0, imgName.lastIndexOf('.'));
      const txtName = `${baseName}.txt`;
      return {
        name: imgName,
        file: imageFiles[imgName],
        gtFile: gtFiles[txtName],
        predFile: predFiles[txtName],
      };
    });
  }, [imageFiles, gtFiles, predFiles]);

  // Pagination Logic
  const totalPages = Math.ceil(items.length / config.gridSize);
  const currentItems = items.slice(
    currentPage * config.gridSize,
    (currentPage + 1) * config.gridSize
  );

  const nextPage = () => setCurrentPage(p => Math.min(p + 1, totalPages - 1));
  const prevPage = () => setCurrentPage(p => Math.max(p - 1, 0));

  const handleDownloadPage = async () => {
    if (currentItems.length === 0) return;
    setIsDownloading(true);
    try {
      const cols = config.gridSize === 9 ? 3 : 4;
      const rows = config.gridSize === 9 ? 3 : 4;
      const cellWidth = 640;
      const cellHeight = 360;
      
      const canvas = document.createElement('canvas');
      canvas.width = cols * cellWidth;
      canvas.height = rows * cellHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not create canvas context');

      ctx.fillStyle = '#1e293b';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      for (let i = 0; i < currentItems.length; i++) {
        const item = currentItems[i];
        const row = Math.floor(i / cols);
        const col = i % cols;
        const x = col * cellWidth;
        const y = row * cellHeight;

        ctx.save();
        ctx.translate(x, y);
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 2;
        ctx.strokeRect(0, 0, cellWidth, cellHeight);
        ctx.beginPath();
        ctx.rect(0, 0, cellWidth, cellHeight);
        ctx.clip();
        await drawVisualization(ctx, item, config, cellWidth, cellHeight);
        ctx.restore();
      }

      const link = document.createElement('a');
      link.download = `page_${currentPage + 1}_${activeProject.name}.jpg`;
      link.href = canvas.toDataURL('image/jpeg', 0.85);
      link.click();
    } catch (e) {
      console.error("Failed to generate download", e);
      alert("Failed to generate download image");
    } finally {
      setIsDownloading(false);
    }
  };

  const gridClass = config.gridSize === 9 
    ? "grid-cols-1 md:grid-cols-2 xl:grid-cols-3" 
    : "grid-cols-2 md:grid-cols-3 xl:grid-cols-4";

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <ControlPanel 
        projects={projects}
        activeProjectId={activeProjectId}
        collections={collections}
        onProjectChange={setActiveProjectId}
        onProjectCreate={handleProjectCreate}
        onProjectRename={handleProjectRename}
        onProjectDelete={handleProjectDelete}
        onBindData={handleBindData}
        onLoadPred={handleLoadPred}
        onImportCollection={handleImportCollection}
        onDeleteCollection={handleDeleteCollection}
        config={config}
        onConfigChange={setConfig}
        stats={{
          totalImages: items.length,
          hasGt: Object.keys(gtFiles).length > 0,
          hasPred: Object.keys(predFiles).length > 0,
        }}
      />

      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Header (Only show nav if in grid mode) */}
        {config.viewMode === 'grid' && (
          <div className="h-16 border-b border-slate-700 flex items-center justify-between px-6 bg-surface shadow-sm z-10">
            <div className="text-slate-300 text-sm flex items-center gap-4">
              <div className="bg-slate-800 px-3 py-1 rounded border border-slate-700">
                Project: <span className="text-white font-medium">{activeProject.name}</span>
              </div>
              <div>
                  Page <span className="text-white font-bold">{currentPage + 1}</span> of <span className="text-white font-bold">{totalPages || 1}</span>
                  <span className="mx-2 text-slate-500">|</span>
                  Total: {items.length}
              </div>
            </div>
            
            <div className="flex gap-4">
              {items.length > 0 && (
                <button
                  onClick={handleDownloadPage}
                  disabled={isDownloading}
                  className="bg-primary hover:bg-blue-600 text-white px-4 py-2 rounded flex items-center gap-2 text-sm disabled:opacity-50 transition-colors"
                >
                  {isDownloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  Download Page
                </button>
              )}

              <div className="flex gap-2">
                <button 
                  onClick={prevPage} 
                  disabled={currentPage === 0}
                  className="p-2 rounded hover:bg-slate-700 disabled:opacity-30 disabled:hover:bg-transparent text-slate-200"
                >
                  <ChevronLeft />
                </button>
                <button 
                  onClick={nextPage} 
                  disabled={currentPage >= totalPages - 1}
                  className="p-2 rounded hover:bg-slate-700 disabled:opacity-30 disabled:hover:bg-transparent text-slate-200"
                >
                  <ChevronRight />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Content Area */}
        <div className="flex-1 overflow-hidden bg-background relative">
          {config.viewMode === 'pr-curve' ? (
             <PRGraph items={items} config={config} />
          ) : (
            // Grid View with Zoom
            <div className="w-full h-full overflow-auto custom-scrollbar p-6">
              {items.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-500">
                  <Inbox className="w-12 h-12 mb-4 opacity-50" />
                  <p>No Images Selected</p>
                </div>
              ) : (
                <div 
                  className={`grid ${gridClass} gap-4 pb-10 origin-top-left transition-all duration-200 ease-out`}
                  style={{ width: `${config.zoomLevel * 100}%` }}
                >
                  {currentItems.map((item) => (
                    <ImageViewer 
                      key={item.name} 
                      item={item} 
                      config={config} 
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;