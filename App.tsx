import React, { useState, useMemo, useRef, useEffect } from 'react';
import ControlPanel from './components/ControlPanel';
import ImageViewer from './components/ImageViewer';
import PRGraph from './components/PRGraph';
import { VisualizationConfig, ImageItem, FileMap, Project, FileCollection, BoxType, LabelMap } from './types';
import { ChevronLeft, ChevronRight, Inbox, Download, Loader2, ZoomIn, ZoomOut, Shuffle, PanelRight } from 'lucide-react';
import { drawVisualization } from './utils/render';
import { parseYoloFile, calculateMatches, preloadLabels } from './utils/yolo';

const DEFAULT_CONFIG: VisualizationConfig = {
  iopThreshold: 0.5,
  confThreshold: 0.25,
  styles: {
    tpPred: { color: '#4ade80', dashed: false }, // Green, Solid
    tpGt: { color: '#ffffff', dashed: true },  // White, Dashed
    fn: { color: '#72f8ef', dashed: true },  // Blue/Cyan, Dashed
    fp: { color: '#fbbf24', dashed: false }, // Amber, Solid
  },
  lineWidth: 4,
  labelFontSize: 23,
  gridSize: 9,
  aspectRatio: '1:1', // Default to Square to avoid black bars on mixed content
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
  predLabels: {}, // Local
});

const App: React.FC = () => {
  const [projects, setProjects] = useState<Project[]>(() => [createProject('Default Project')]);
  const [activeProjectId, setActiveProjectId] = useState<string>(() => projects[0].id);
  const [collections, setCollections] = useState<FileCollection[]>([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);

  // Page Stats & Highlight State
  const [pageStats, setPageStats] = useState({ tp: 0, fp: 0, fn: 0 });
  const [globalHighlight, setGlobalHighlight] = useState<BoxType | null>(null);

  // Jump Page State
  const [jumpPageInput, setJumpPageInput] = useState("1");

  // Sidebar State
  const [sidebarWidth, setSidebarWidth] = useState(250);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const isDragging = useRef(false);

  // Active Project Accessors
  const activeProject = projects.find(p => p.id === activeProjectId) || projects[0];
  const { config } = activeProject;

  // Resolve Files from Collections
  const imageFiles = useMemo(() =>
    collections.find(c => c.id === activeProject.imageCollectionId)?.files || {},
    [collections, activeProject.imageCollectionId]);

  const gtLabels = useMemo(() =>
    collections.find(c => c.id === activeProject.gtCollectionId)?.labels || {},
    [collections, activeProject.gtCollectionId]);

  const predLabels = activeProject.predLabels;

  // State Updates
  const updateProject = (updates: Partial<Project>) => {
    setProjects(ps => ps.map(p => p.id === activeProjectId ? { ...p, ...updates } : p));
  };

  const setConfig = (newConfig: VisualizationConfig) => updateProject({ config: newConfig });


  // Collection Management
  const handleImportCollection = async (type: 'images' | 'labels') => {
    try {
      // @ts-ignore - File System Access API
      const dirHandle = await window.showDirectoryPicker();
      const fileMap: FileMap = {};

      // Iterate through directory (not recursive for now as per original logic)
      // @ts-ignore
      for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file' && !entry.name.startsWith('.')) {
          fileMap[entry.name] = entry;
        }
      }

      const count = Object.keys(fileMap).length;
      if (count === 0) return;

      let name = dirHandle.name || `New ${type === 'images' ? 'Dataset' : 'Labels'}`;

      let labelMap: LabelMap | undefined = undefined;
      // Pre-load labels if type is labels
      if (type === 'labels') {
        labelMap = await preloadLabels(fileMap);
      }

      const newCollection: FileCollection = {
        id: generateId(),
        name,
        type,
        files: fileMap,
        labels: labelMap,
        count
      };

      setCollections(prev => [...prev, newCollection]);

      if (type === 'images' && !activeProject.imageCollectionId) updateProject({ imageCollectionId: newCollection.id });
      else if (type === 'labels' && !activeProject.gtCollectionId) updateProject({ gtCollectionId: newCollection.id });
    } catch (err) {
      console.error("Failed to import collection", err);
    }
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

  const handleLoadPred = async () => {
    try {
      // @ts-ignore
      const dirHandle = await window.showDirectoryPicker();
      const fileMap: FileMap = {};
      // @ts-ignore
      for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file' && !entry.name.startsWith('.')) {
          fileMap[entry.name] = entry;
        }
      }
      const labelMap = await preloadLabels(fileMap);
      updateProject({ predLabels: labelMap });
    } catch (err) {
      console.error("Failed to load predictions", err);
    }
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
        gtData: gtLabels[txtName],
        predData: predLabels[txtName],
      };
    });
  }, [imageFiles, gtLabels, predLabels]);

  // Pagination Logic
  const totalPages = Math.ceil(items.length / config.gridSize);
  const currentItems = items.slice(
    currentPage * config.gridSize,
    (currentPage + 1) * config.gridSize
  );

  // Sync jump input with current page
  useEffect(() => {
    setJumpPageInput((currentPage + 1).toString());
  }, [currentPage]);

  // Calculate Page Stats
  useEffect(() => {
    if (currentItems.length === 0) {
      setPageStats({ tp: 0, fp: 0, fn: 0 });
      return;
    }

    const totals = { tp: 0, fp: 0, fn: 0 };
    currentItems.forEach((item) => {
      const gtBoxes = item.gtData || [];
      const predBoxes = item.predData || [];
      const result = calculateMatches(gtBoxes, predBoxes, config);

      result.forEach(b => {
        if (b.type === BoxType.TP_PRED) totals.tp++;
        else if (b.type === BoxType.FP) totals.fp++;
        else if (b.type === BoxType.FN) totals.fn++;
      });
    });

    setPageStats(totals);
  }, [currentItems, config.iopThreshold, config.confThreshold]);


  const nextPage = () => setCurrentPage(p => Math.min(p + 1, totalPages - 1));
  const prevPage = () => setCurrentPage(p => Math.max(p - 1, 0));

  const randomPage = () => {
    if (totalPages <= 1) return;
    const rnd = Math.floor(Math.random() * totalPages);
    setCurrentPage(rnd);
  };

  const handlePageJump = (e: React.FormEvent) => {
    e.preventDefault();
    const pageNum = parseInt(jumpPageInput, 10);
    if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= totalPages) {
      setCurrentPage(pageNum - 1);
    } else {
      setJumpPageInput((currentPage + 1).toString()); // Reset on invalid
    }
  };

  const handleDownloadPage = async () => {
    if (currentItems.length === 0) return;
    setIsDownloading(true);

    try {
      // 1. Load all images to determine dimensions
      const loadedData = await Promise.all(currentItems.map(async (item) => {
        const file = item.file;
        const url = file instanceof File ? URL.createObjectURL(file) : URL.createObjectURL(await (file as FileSystemFileHandle).getFile());
        const img = new Image();
        img.src = url;
        await new Promise((resolve) => {
          img.onload = resolve;
          img.onerror = resolve; // Handle error gracefully
        });
        return { item, img, url };
      }));

      // 2. Configure Layout (Stitched High-Res)
      const cols = config.gridSize === 9 ? 3 : 4;
      const targetCellWidth = 1600; // High resolution standard width
      const gap = 80; // Large gap for separation

      // 3. Organize Grid Rows
      const rows: typeof loadedData[] = [];
      let currentRow: typeof loadedData = [];

      for (const data of loadedData) {
        currentRow.push(data);
        if (currentRow.length === cols) {
          rows.push(currentRow);
          currentRow = [];
        }
      }
      if (currentRow.length > 0) rows.push(currentRow);

      // 4. Calculate Dimensions (Adaptive Height)
      let totalHeight = 0;
      const rowConfigs = rows.map(row => {
        // Calculate height for each item based on target width to maintain aspect ratio
        const processedItems = row.map(data => {
          const aspect = data.img.naturalWidth ? (data.img.naturalWidth / data.img.naturalHeight) : 1.77;
          const height = Math.round(targetCellWidth / aspect);
          return { ...data, width: targetCellWidth, height };
        });
        // Row height is determined by the tallest item in the row (to align grid)
        const rowHeight = Math.max(...processedItems.map(i => i.height));
        const y = totalHeight;
        totalHeight += rowHeight + gap;
        return { items: processedItems, rowHeight, y };
      });
      // Remove last gap
      if (rowConfigs.length > 0) totalHeight -= gap;

      const totalWidth = (cols * targetCellWidth) + ((cols - 1) * gap);

      // 5. Create Canvas
      const canvas = document.createElement('canvas');
      canvas.width = totalWidth;
      canvas.height = totalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not create canvas context');

      // Fill Background (Dark Border)
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // 6. Draw Items
      for (const rowConfig of rowConfigs) {
        for (let i = 0; i < rowConfig.items.length; i++) {
          const { item, img, width, height } = rowConfig.items[i];
          const x = i * (targetCellWidth + gap);
          // Center vertically in the row strip
          const y = rowConfig.y + (rowConfig.rowHeight - height) / 2;

          ctx.save();
          ctx.translate(x, y);
          ctx.beginPath();
          ctx.rect(0, 0, width, height);
          ctx.clip(); // Clip to exact image area

          const scaleFactor = width / (img.naturalWidth || width);

          await drawVisualization(ctx, item, config, width, height, img, {
            fontSize: Math.round(config.labelFontSize * scaleFactor),
            forceLineWidth: Math.max(1, Math.round(config.lineWidth * scaleFactor))
          });

          ctx.restore();
        }
      }

      // 7. Download
      const link = document.createElement('a');
      link.download = `page_${currentPage + 1}_${activeProject.name}.jpg`;
      link.href = canvas.toDataURL('image/jpeg', 0.92); // High Quality
      link.click();

      // Cleanup
      loadedData.forEach(d => URL.revokeObjectURL(d.url));

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

  // Resize Handler
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const newWidth = document.body.clientWidth - e.clientX;
      setSidebarWidth(Math.max(300, Math.min(newWidth, 800)));
    };

    const handleMouseUp = () => {
      isDragging.current = false;
      document.body.style.cursor = 'default';
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

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
          hasGt: Object.keys(gtLabels).length > 0,
          hasPred: Object.keys(predLabels).length > 0,
        }}
      />

      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Header - Sticky */}
        <div className="h-16 border-b border-slate-700 flex items-center justify-between px-6 bg-surface shadow-sm z-10 flex-shrink-0">
          {/* Left: Info & Page Jump */}
          <div className="text-slate-300 text-sm flex items-center gap-4 flex-1 min-w-0">
            {config.viewMode === 'grid' && (
              <form onSubmit={handlePageJump} className="flex items-center gap-2 text-slate-400 flex-shrink-0">
                <span>Page</span>
                <input
                  type="number"
                  value={jumpPageInput}
                  onChange={(e) => setJumpPageInput(e.target.value)}
                  onBlur={() => handlePageJump({ preventDefault: () => { } } as any)}
                  className="w-16 bg-slate-800 border border-slate-700 rounded text-center text-white focus:outline-none focus:border-primary text-sm py-1"
                />
                <span>of <span className="text-white font-bold">{totalPages || 1}</span></span>
              </form>
            )}
          </div>

          {/* Center: Global Stats & Zoom */}
          <div className="flex items-center justify-center gap-6 flex-shrink-0 mx-4">
            {config.viewMode === 'grid' && items.length > 0 && (
              <>
                {/* Global Stats with Highlight */}
                <div className="flex items-center gap-4 bg-slate-800/80 px-5 py-2 rounded-full border border-slate-700 shadow-sm">
                  <div
                    onMouseEnter={() => setGlobalHighlight(BoxType.TP_PRED)}
                    onMouseLeave={() => setGlobalHighlight(null)}
                    className="cursor-pointer px-3 py-0.5 rounded hover:bg-white/10 transition-colors"
                    style={{ color: config.styles.tpPred.color }}
                  >
                    <span className="font-bold mr-1">TP:</span>{pageStats.tp}
                  </div>
                  <div className="w-px h-4 bg-slate-600"></div>
                  <div
                    onMouseEnter={() => setGlobalHighlight(BoxType.FN)}
                    onMouseLeave={() => setGlobalHighlight(null)}
                    className="cursor-pointer px-3 py-0.5 rounded hover:bg-white/10 transition-colors"
                    style={{ color: config.styles.fn.color }}
                  >
                    <span className="font-bold mr-1">FN:</span>{pageStats.fn}
                  </div>
                  <div className="w-px h-4 bg-slate-600"></div>
                  <div
                    onMouseEnter={() => setGlobalHighlight(BoxType.FP)}
                    onMouseLeave={() => setGlobalHighlight(null)}
                    className="cursor-pointer px-3 py-0.5 rounded hover:bg-white/10 transition-colors"
                    style={{ color: config.styles.fp.color }}
                  >
                    <span className="font-bold mr-1">FP:</span>{pageStats.fp}
                  </div>
                </div>

                {/* Zoom */}
                <div className="flex items-center gap-2 bg-slate-800/50 px-3 py-2 rounded-full border border-slate-700">
                  <button onClick={() => setConfig({ ...config, zoomLevel: Math.max(0.5, config.zoomLevel - 0.1) })} className="p-1 hover:bg-slate-700 rounded-full text-slate-400 hover:text-white transition-colors"><ZoomOut className="w-3.5 h-3.5" /></button>
                  <input
                    type="range"
                    min="0.5" max="3" step="0.1"
                    value={config.zoomLevel}
                    onChange={(e) => setConfig({ ...config, zoomLevel: parseFloat(e.target.value) })}
                    className="w-24 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-primary"
                  />
                  <button onClick={() => setConfig({ ...config, zoomLevel: Math.min(3, config.zoomLevel + 0.1) })} className="p-1 hover:bg-slate-700 rounded-full text-slate-400 hover:text-white transition-colors"><ZoomIn className="w-3.5 h-3.5" /></button>
                </div>
              </>
            )}
          </div>

          {/* Right: Actions */}
          <div className="flex justify-end gap-4 flex-1 min-w-0">
            {config.viewMode === 'grid' && (
              <>
                {items.length > 0 && (
                  <button
                    onClick={handleDownloadPage}
                    disabled={isDownloading}
                    className="bg-primary hover:bg-blue-600 text-white p-2 rounded flex items-center justify-center disabled:opacity-50 transition-colors shadow-lg shadow-blue-900/20"
                    title="Download Page"
                  >
                    {isDownloading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
                  </button>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={prevPage}
                    disabled={currentPage === 0}
                    className="p-2 rounded hover:bg-slate-700 disabled:opacity-30 disabled:hover:bg-transparent text-slate-200"
                    title="Previous Page"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>

                  <button
                    onClick={randomPage}
                    disabled={totalPages <= 1}
                    className="p-2 rounded hover:bg-slate-700 disabled:opacity-30 disabled:hover:bg-transparent text-slate-200"
                    title="Random Page"
                  >
                    <Shuffle className="w-5 h-5" />
                  </button>

                  <button
                    onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                    className={`p-2 rounded transition-colors ${isSidebarOpen ? 'bg-primary/20 text-primary' : 'hover:bg-slate-700 text-slate-200'}`}
                    title={isSidebarOpen ? "Hide Sidebar" : "Show Sidebar"}
                  >
                    <PanelRight className="w-5 h-5" />
                  </button>

                  <button
                    onClick={nextPage}
                    disabled={currentPage >= totalPages - 1}
                    className="p-2 rounded hover:bg-slate-700 disabled:opacity-30 disabled:hover:bg-transparent text-slate-200"
                    title="Next Page"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Main Content Split View */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left / Main: Grid or Full PR Graph */}
          <div className="flex-1 overflow-hidden relative flex flex-col">
            {config.viewMode === 'pr-curve' ? (
              <PRGraph items={items} config={config} />
            ) : (
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
                        externalHighlight={globalHighlight}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right Sidebar: PR Graph (Visible in Grid Mode) */}
          {config.viewMode === 'grid' && isSidebarOpen && (
            <>
              <div
                className="w-1 bg-slate-800 hover:bg-primary cursor-col-resize z-20 flex-shrink-0 transition-colors border-l border-slate-700"
                onMouseDown={(e) => {
                  isDragging.current = true;
                  document.body.style.cursor = 'col-resize';
                  e.preventDefault();
                }}
              />
              <div
                style={{ width: sidebarWidth }}
                className="flex-shrink-0 bg-surface/30 border-l border-slate-700 overflow-hidden shadow-xl z-10 flex flex-col"
              >
                <PRGraph items={items} config={config} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;