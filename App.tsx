import React, { useState, useMemo, useRef, useEffect } from 'react';
import ControlPanel from './components/ControlPanel';
import ImageViewer from './components/ImageViewer';
import PRGraph from './components/PRGraph';
import { VisualizationConfig, ImageItem, FileMap, Project, FileCollection, BoxType, LabelMap, BoundingBox } from './types';
import { ChevronLeft, ChevronRight, Inbox, Download, Loader2, ZoomIn, ZoomOut, Shuffle, PanelRight } from 'lucide-react';
import { drawVisualization } from './utils/render';
import { parseYoloFile, calculateMatches, preloadLabels } from './utils/yolo';
import { exportLabels } from './utils/export';
import { AudioPlayer, getAudioFilename, extractStartTimeFromFilename } from './utils/audio';

// Single Audio Player Instance
const audioPlayer = new AudioPlayer();

const DEFAULT_CONFIG: VisualizationConfig = {
  ioMinThreshold: 0.5,
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
  viewMode: 'grid',
  audio: {
    minFreq: 500,
    maxFreq: 12000,
    highlightColor: '#4ade80', // Match TP Pred by default
    clipSec: 6.0,
    strideSec: 5.0,
    playbackSpeed: 1.0
  },
  editHighlightColor: '#fbbf24', // Amber/Yellow default
  showLabels: false,
  showPredictions: true
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
  const [isExporting, setIsExporting] = useState(false);
  const [activePlayback, setActivePlayback] = useState<{ id: number; fileName: string } | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [modifiedFiles, setModifiedFiles] = useState<Set<string>>(new Set());

  // Audio State
  const [audioFileMap, setAudioFileMap] = useState<FileMap>({});

  // Page Stats & Highlight State
  const [pageStats, setPageStats] = useState({ tp: 0, fp: 0, fn: 0 });
  const [globalHighlight, setGlobalHighlight] = useState<BoxType | null>(null);
  const [lockedHighlight, setLockedHighlight] = useState<BoxType | null>(null);

  // Jump Page State
  const [jumpPageInput, setJumpPageInput] = useState("1");

  // Focus and Workflow State
  const [focusedItemIndex, setFocusedItemIndex] = useState(0);

  // Sidebar State
  const [sidebarWidth, setSidebarWidth] = useState(250);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const isDragging = useRef(false);
  const prevGridSizeRef = useRef(DEFAULT_CONFIG.gridSize);

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


  // Direct Data Loading
  const handleLoadImages = async () => {
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

      // Simplified: We use a special collection or just bind to project
      const collId = generateId();
      setCollections(prev => [...prev, { id: collId, name: dirHandle.name, type: 'images', files: fileMap, count: Object.keys(fileMap).length }]);
      updateProject({ imageCollectionId: collId, imagePath: dirHandle.name });
      setCurrentPage(0);
    } catch (err) {
      console.error("Failed to load images", err);
    }
  };

  const handleLoadGT = async () => {
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

      const collId = generateId();
      setCollections(prev => [...prev, { id: collId, name: dirHandle.name, type: 'labels', files: fileMap, labels: labelMap, count: Object.keys(fileMap).length }]);
      updateProject({ gtCollectionId: collId, gtPath: dirHandle.name });
    } catch (err) {
      console.error("Failed to load GT", err);
    }
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
      updateProject({ predLabels: labelMap, predPath: dirHandle.name });
    } catch (err) {
      console.error("Failed to load predictions", err);
    }
  };

  const handleUpdateLabels = (fileName: string, newBoxes: BoundingBox[]) => {
    if (!activeProject.gtCollectionId) return;

    const baseName = fileName.substring(0, fileName.lastIndexOf('.'));
    const txtName = `${baseName}.txt`;
    setModifiedFiles(prev => new Set(prev).add(txtName));

    // Update the relevant collection in state
    setCollections(prev => prev.map(c => {
      if (c.id === activeProject.gtCollectionId) {
        return {
          ...c,
          labels: {
            ...c.labels,
            [txtName]: newBoxes
          }
        };
      }
      return c;
    }));
  };

  const handleRecoverOriginalGt = async (fileName: string) => {
    if (!activeProject.gtCollectionId) return;
    const baseName = fileName.substring(0, fileName.lastIndexOf('.'));
    const txtName = `${baseName}.txt`;
    const collection = collections.find(c => c.id === activeProject.gtCollectionId);
    if (!collection || !collection.files[txtName]) return;

    try {
      const file = collection.files[txtName];
      const originalBoxes = await parseYoloFile(file);
      handleUpdateLabels(fileName, originalBoxes);

      setModifiedFiles(prev => {
        const next = new Set(prev);
        next.delete(txtName);
        return next;
      });
    } catch (e) {
      console.error("Failed to recover original GT", e);
    }
  };

  const handleExportLabels = async () => {
    if (!activeProject.gtCollectionId || modifiedFiles.size === 0) {
      alert("No modifications to export.");
      return;
    }
    const collection = collections.find(c => c.id === activeProject.gtCollectionId);
    if (!collection || !collection.labels) return;

    setIsExporting(true);
    try {
      // Filter labels to only include modified ones
      const filteredLabels: LabelMap = {};
      modifiedFiles.forEach(name => {
        if (collection.labels![name]) {
          filteredLabels[name] = collection.labels![name];
        }
      });

      await exportLabels(filteredLabels);
    } catch (err) {
      console.error("Export failed", err);
    } finally {
      setIsExporting(false);
    }
  };

  const handleLoadAudio = async () => {
    try {
      // @ts-ignore
      const dirHandle = await window.showDirectoryPicker();
      const fileMap: FileMap = {};
      // @ts-ignore
      for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file' && !entry.name.startsWith('.')) {
          const ext = entry.name.split('.').pop()?.toLowerCase();
          if (['wav', 'mp3', 'ogg', 'm4a'].includes(ext || '')) {
            fileMap[entry.name] = entry;
          }
        }
      }
      setAudioFileMap(fileMap);
      updateProject({ audioPath: dirHandle.name });
    } catch (err) {
      console.error("Failed to load audio folder", err);
    }
  };

  const handleImportFolder = async () => {
    try {
      // @ts-ignore
      const dirHandle = await window.showDirectoryPicker();

      let imgMap: FileMap = {};
      let gtMap: FileMap = {};
      let predMap: FileMap = {};
      let audioMap: FileMap = {};

      let hasImages = false;
      let hasGt = false;
      let hasPred = false;
      let hasAudio = false;

      // @ts-ignore
      for await (const entry of dirHandle.values()) {
        if (entry.kind === 'directory') {
          if (entry.name === 'images') {
            hasImages = true;
            // @ts-ignore
            for await (const file of entry.values()) {
              if (file.kind === 'file' && !file.name.startsWith('.')) {
                imgMap[file.name] = file;
              }
            }
          } else if (entry.name === 'labels') {
            hasGt = true;
            // @ts-ignore
            for await (const file of entry.values()) {
              if (file.kind === 'file' && !file.name.startsWith('.')) {
                gtMap[file.name] = file;
              }
            }
          } else if (entry.name === 'predictions') {
            hasPred = true;
            // @ts-ignore
            for await (const file of entry.values()) {
              if (file.kind === 'file' && !file.name.startsWith('.')) {
                predMap[file.name] = file;
              }
            }
          } else if (entry.name === 'audio') {
            hasAudio = true;
            // @ts-ignore
            for await (const file of entry.values()) {
              if (file.kind === 'file' && !file.name.startsWith('.')) {
                const ext = file.name.split('.').pop()?.toLowerCase();
                if (['wav', 'mp3', 'ogg', 'm4a'].includes(ext || '')) {
                  audioMap[file.name] = file;
                }
              }
            }
          }
        }
      }

      if (hasImages) {
        const collId = generateId();
        setCollections(prev => [...prev, { id: collId, name: 'Images', type: 'images', files: imgMap, count: Object.keys(imgMap).length }]);
        updateProject({ imageCollectionId: collId, imagePath: `${dirHandle.name}/images` });
        setCurrentPage(0);
      }

      if (hasGt) {
        const labelMap = await preloadLabels(gtMap);
        const collId = generateId();
        setCollections(prev => [...prev, { id: collId, name: 'Labels', type: 'labels', files: gtMap, labels: labelMap, count: Object.keys(gtMap).length }]);
        updateProject({ gtCollectionId: collId, gtPath: `${dirHandle.name}/labels` });
      }

      if (hasPred) {
        const labelMap = await preloadLabels(predMap);
        updateProject({ predLabels: labelMap, predPath: `${dirHandle.name}/predictions` });
      }

      if (hasAudio) {
        setAudioFileMap(audioMap);
        updateProject({ audioPath: `${dirHandle.name}/audio` });
      }

    } catch (err) {
      console.error("Failed to import folder", err);
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
        isModified: modifiedFiles.has(txtName),
      };
    });
  }, [imageFiles, gtLabels, predLabels, modifiedFiles]);

  // Pagination Logic
  const totalPages = Math.ceil(items.length / config.gridSize);
  const currentItems = useMemo(() => items.slice(
    currentPage * config.gridSize,
    (currentPage + 1) * config.gridSize
  ), [items, currentPage, config.gridSize]);

  // Sync jump input with current page
  useEffect(() => {
    setJumpPageInput((currentPage + 1).toString());
  }, [currentPage]);

  // Handle Grid Size Change - Recalculate Page to maintain visual continuity
  useEffect(() => {
    const prevGridSize = prevGridSizeRef.current;
    if (prevGridSize !== config.gridSize && prevGridSize !== 1 && config.gridSize !== 1) {
      const firstItemIndex = currentPage * prevGridSize;
      const newPage = Math.floor(firstItemIndex / config.gridSize);
      setCurrentPage(newPage);
      prevGridSizeRef.current = config.gridSize;
    }
  }, [config.gridSize, currentPage]);

  const toggleFocusMode = (indexInPage: number) => {
    if (config.gridSize === 1) {
      // Revert to prev
      const revertGrid = prevGridSizeRef.current === 1 ? 9 : prevGridSizeRef.current;
      const globalIndex = currentPage; // currentPage in 1x1 is the absolute item index
      const newPage = Math.floor(globalIndex / revertGrid);
      setConfig({ ...config, gridSize: revertGrid });
      setCurrentPage(newPage);
      setFocusedItemIndex(globalIndex % revertGrid);
    } else {
      // Enter Focus Mode
      prevGridSizeRef.current = config.gridSize;
      const globalIndex = currentPage * config.gridSize + indexInPage;
      setConfig({ ...config, gridSize: 1 });
      setCurrentPage(globalIndex);
      setFocusedItemIndex(0); // 0th index in a 1-item page
    }
  };

  // Keyboard Workflow
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
      if (currentItems.length === 0) return;

      const cols = config.gridSize === 9 ? 3 : (config.gridSize === 16 ? 4 : 1);

      if (e.key === 'ArrowRight') {
        setFocusedItemIndex(p => Math.min(p + 1, currentItems.length - 1));
      } else if (e.key === 'ArrowLeft') {
        setFocusedItemIndex(p => Math.max(p - 1, 0));
      } else if (e.key === 'ArrowDown') {
        setFocusedItemIndex(p => Math.min(p + cols, currentItems.length - 1));
      } else if (e.key === 'ArrowUp') {
        setFocusedItemIndex(p => Math.max(p - cols, 0));
      } else if (e.key === 'd' || e.key === 'D') {
        setCurrentPage(p => Math.min(p + 1, totalPages - 1));
      } else if (e.key === 'a' || e.key === 'A') {
        setCurrentPage(p => Math.max(p - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        toggleFocusMode(focusedItemIndex);
      } else if (e.key === 'e' || e.key === 'E') {
        e.preventDefault();
        setIsEditMode(prev => !prev);
      }

      // 10. Scroll into view
      if (['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
        setTimeout(() => {
          // React state needs a tick to update the DOM if we rely on focusedItemIndex change,
          // but since we know it's moving, it's safer to just let the app render the new focus state first,
          // then sweep through and snap it. We'll use a data attribute to find the focused element.
          const activeEl = document.querySelector('[data-focused="true"]');
          activeEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 50);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [config.gridSize, currentItems.length, focusedItemIndex, currentPage]);

  // Exit Prompt for Unsaved Modifications
  useEffect(() => {
    if (modifiedFiles.size === 0) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [modifiedFiles.size]);

  // Ensure currentPage is always within valid bounds
  useEffect(() => {
    if (totalPages > 0 && currentPage >= totalPages) {
      setCurrentPage(totalPages - 1);
    } else if (totalPages === 0 && currentPage !== 0) {
      setCurrentPage(0);
    }
  }, [totalPages, currentPage]);

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
  }, [currentItems, config.ioMinThreshold, config.confThreshold]);


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

  const gridClass = config.gridSize === 1
    ? "grid-cols-1 justify-items-center max-w-5xl mx-auto"
    : config.gridSize === 9
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
        onImportImages={handleLoadImages}
        onImportGT={handleLoadGT}
        onLoadPred={handleLoadPred}
        config={config}
        onConfigChange={setConfig}
        stats={{
          totalImages: items.length,
          hasGt: Object.keys(gtLabels).length > 0,
          hasPred: Object.keys(predLabels).length > 0,
          imagePath: activeProject.imagePath,
          gtPath: activeProject.gtPath,
          predPath: activeProject.predPath,
          audioPath: activeProject.audioPath
        }}
        isEditMode={isEditMode}
        onToggleEditMode={setIsEditMode}
        onExportLabels={handleExportLabels}
        onLoadAudio={handleLoadAudio}
        onImportFolder={handleImportFolder}
        hasAudio={Object.keys(audioFileMap).length > 0}
        isExporting={isExporting}
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
                    onMouseEnter={() => !lockedHighlight && setGlobalHighlight(BoxType.TP_PRED)}
                    onMouseLeave={() => !lockedHighlight && setGlobalHighlight(null)}
                    onClick={() => {
                      if (lockedHighlight === BoxType.TP_PRED) {
                        setLockedHighlight(null);
                        setGlobalHighlight(null);
                      } else {
                        setLockedHighlight(BoxType.TP_PRED);
                        setGlobalHighlight(BoxType.TP_PRED);
                      }
                    }}
                    className={`cursor-pointer px-3 py-0.5 rounded transition-all select-none ${lockedHighlight === BoxType.TP_PRED ? 'bg-white/20 ring-1 ring-white/50' : 'hover:bg-white/10'}`}
                    style={{ color: config.styles.tpPred.color }}
                  >
                    <span className="font-bold mr-1">TP:</span>{pageStats.tp}
                  </div>
                  <div className="w-px h-4 bg-slate-600"></div>
                  <div
                    onMouseEnter={() => !lockedHighlight && setGlobalHighlight(BoxType.FN)}
                    onMouseLeave={() => !lockedHighlight && setGlobalHighlight(null)}
                    onClick={() => {
                      if (lockedHighlight === BoxType.FN) {
                        setLockedHighlight(null);
                        setGlobalHighlight(null);
                      } else {
                        setLockedHighlight(BoxType.FN);
                        setGlobalHighlight(BoxType.FN);
                      }
                    }}
                    className={`cursor-pointer px-3 py-0.5 rounded transition-all select-none ${lockedHighlight === BoxType.FN ? 'bg-white/20 ring-1 ring-white/50' : 'hover:bg-white/10'}`}
                    style={{ color: config.styles.fn.color }}
                  >
                    <span className="font-bold mr-1">FN:</span>{pageStats.fn}
                  </div>
                  <div className="w-px h-4 bg-slate-600"></div>
                  <div
                    onMouseEnter={() => !lockedHighlight && setGlobalHighlight(BoxType.FP)}
                    onMouseLeave={() => !lockedHighlight && setGlobalHighlight(null)}
                    onClick={() => {
                      if (lockedHighlight === BoxType.FP) {
                        setLockedHighlight(null);
                        setGlobalHighlight(null);
                      } else {
                        setLockedHighlight(BoxType.FP);
                        setGlobalHighlight(BoxType.FP);
                      }
                    }}
                    className={`cursor-pointer px-3 py-0.5 rounded transition-all select-none ${lockedHighlight === BoxType.FP ? 'bg-white/20 ring-1 ring-white/50' : 'hover:bg-white/10'}`}
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

                {/* Playback Speed */}
                <div className="flex items-center gap-2 bg-slate-800/50 px-3 py-1.5 rounded-full border border-slate-700">
                  <span className="text-xs text-slate-400 font-semibold mr-1">Speed</span>
                  <select
                    className="bg-transparent text-xs text-white outline-none cursor-pointer appearance-none font-bold select-none pr-1"
                    value={config.audio?.playbackSpeed ?? 1}
                    onChange={(e) => setConfig({ ...config, audio: { ...config.audio, playbackSpeed: parseFloat(e.target.value) } })}
                  >
                    <option value="0.5" className="bg-slate-800">0.5x</option>
                    <option value="0.75" className="bg-slate-800">0.75x</option>
                    <option value="1" className="bg-slate-800">1x</option>
                    <option value="1.25" className="bg-slate-800">1.25x</option>
                    <option value="1.5" className="bg-slate-800">1.5x</option>
                  </select>
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
                    {currentItems.map((item, idx) => (
                      <ImageViewer
                        key={item.name}
                        item={item}
                        config={config}
                        externalHighlight={globalHighlight}
                        isEditMode={isEditMode}
                        onUpdateGt={handleUpdateLabels}
                        audioPlayer={audioPlayer}
                        audioFiles={audioFileMap}
                        activePlayback={activePlayback}
                        onSetGlobalPlayback={setActivePlayback}
                        isFocused={focusedItemIndex === idx}
                        onFocusToggle={() => toggleFocusMode(idx)}
                        onSetFocus={() => setFocusedItemIndex(idx)}
                        onRecoverOriginalGt={handleRecoverOriginalGt}
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