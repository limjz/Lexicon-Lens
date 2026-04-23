import { useState, useRef, useEffect } from 'react';
import { FileUp, FileText, X, Loader2, Trash2, CheckCircle2, FolderPlus, MoreVertical, Edit2, ChevronRight, ChevronDown, Folder, Zap, RotateCcw } from 'lucide-react';
import { processFile } from '../lib/gemini';
import { motion, AnimatePresence } from 'motion/react';

export interface Category {
  id: string;
  name: string;
}

export interface CheatSheet {
  id: string;
  name: string;
  content: string;
  terms: Record<string, string>;
  folderId?: string;
  isProcessing?: boolean;
  isProcessingContent?: boolean;
  isProcessingTerms?: boolean;
}

interface SidebarProps {
  cheatSheets: CheatSheet[];
  folders: Category[];
  selectedSheetId: string | null;
  onSelectSheet: (id: string | null) => void;
  onAddCheatSheet: (sheet: CheatSheet) => void;
  onUpdateCheatSheet: (id: string, updates: Partial<CheatSheet>) => void;
  onRemoveCheatSheet: (id: string) => void;
  onRenameSheet: (id: string, newName: string) => void;
  onAddFolder: (name: string) => void;
  onMoveSheet: (id: string, folderId: string | undefined) => void;
  onPasteText: (text: string) => void;
}

export function Sidebar({ 
  cheatSheets, 
  folders,
  selectedSheetId, 
  onSelectSheet, 
  onAddCheatSheet, 
  onUpdateCheatSheet,
  onRemoveCheatSheet, 
  onRenameSheet,
  onAddFolder,
  onMoveSheet,
  onPasteText 
}: SidebarProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [multiSelectedIds, setMultiSelectedIds] = useState<Set<string>>(new Set());
  const [selectionBox, setSelectionBox] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, ids: string[] } | null>(null);

  const toggleFolder = (id: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const uploadSessionRef = useRef(0);

  const handleCancelUpload = () => {
    uploadSessionRef.current++; // Invalidate current session
    setIsUploading(false);
    // Remove all sheets that are currently in 'processing' state
    cheatSheets.filter(s => s.isProcessing).forEach(sheet => {
      onRemoveCheatSheet(sheet.id);
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
    setError("Upload sequence stopped.");
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const currentSession = ++uploadSessionRef.current;
    setIsUploading(true);
    setError(null);

    // Metadata for background queue
    const queue: { file: File, sheetId: string, initialContent: string, isPlainDoc: boolean }[] = [];

    // Step 1: Instant UI Creation
    for (const file of files) {
      if (uploadSessionRef.current !== currentSession) break;

      if (file.size > 10 * 1024 * 1024) {
        setError(prev => prev ? `${prev}\n${file.name}: File exceeds 10MB limit.` : `${file.name}: File exceeds 10MB limit.`);
        continue;
      }

      const sheetId = Math.random().toString(36).substr(2, 9);
      const isPlainDoc = file.type.startsWith('text/') || 
                       file.name.endsWith('.md') || 
                       file.name.endsWith('.txt') || 
                       file.name.endsWith('.json') ||
                       file.name.endsWith('.js') ||
                       file.name.endsWith('.ts');

      let initialContent = "";
      if (isPlainDoc) {
        try {
          initialContent = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsText(file);
          });
        } catch (e) {
          console.warn("Fast read failed, falling back to AI", e);
        }
      }

      onAddCheatSheet({
        id: sheetId,
        name: file.name,
        content: initialContent,
        terms: {},
        isProcessing: !isPlainDoc,
        isProcessingContent: !isPlainDoc,
        isProcessingTerms: false
      });

      queue.push({ file, sheetId, initialContent, isPlainDoc });
    }

    // Step 2: Sequential Background Processing
    (async () => {
      for (const item of queue) {
        if (uploadSessionRef.current !== currentSession) break;

        // Add a small delay between files to avoid hitting RPM (Rate Per Minute) limits
        await new Promise(resolve => setTimeout(resolve, 2000));

        const { file, sheetId, initialContent, isPlainDoc } = item;
        
        try {
          if (!isPlainDoc) {
            const result = await processFile(file);
            if (uploadSessionRef.current !== currentSession) return;

            onUpdateCheatSheet(sheetId, {
              content: result.content,
              terms: result.terms,
              isProcessing: false,
              isProcessingContent: false,
              isProcessingTerms: false
            });
          } else {
            // No background processing needed for plain docs anymore
            // since we disabled automatic glossary extraction.
            if (uploadSessionRef.current !== currentSession) return;

            onUpdateCheatSheet(sheetId, {
              isProcessingTerms: false,
              isProcessingContent: false,
              isProcessing: false
            });
          }
        } catch (err: any) {
          if (uploadSessionRef.current === currentSession) {
            const { formatGeminiError } = await import('../lib/gemini');
            console.error(`Background processing failed for ${file.name}`, err);
            const errorMsg = formatGeminiError(err);
            setError(prev => prev ? `${prev}\n${file.name}: ${errorMsg}` : `${file.name}: ${errorMsg}`);
            onUpdateCheatSheet(sheetId, { isProcessing: false, isProcessingContent: false, isProcessingTerms: false });
          }
        }
      }

      if (uploadSessionRef.current === currentSession) {
        setIsUploading(false);
      }
    })();

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const startEditing = (sheet: CheatSheet) => {
    setEditingId(sheet.id);
    setEditValue(sheet.name);
  };

  const saveEdit = () => {
    if (editingId && editValue.trim()) {
      onRenameSheet(editingId, editValue.trim());
    }
    setEditingId(null);
  };

  const handleCreateFolder = () => {
    if (newFolderName.trim()) {
      onAddFolder(newFolderName.trim());
      setNewFolderName("");
      setIsCreatingFolder(false);
    }
  };

  const [draggedOverFolderId, setDraggedOverFolderId] = useState<string | null>(null);

  const handleDragStart = (e: React.DragEvent, sheetId: string) => {
    // If we're dragging a sheet that's part of a multi-selection, drag the whole set
    const idsToMove = multiSelectedIds.has(sheetId) 
      ? Array.from(multiSelectedIds) 
      : [sheetId];
    
    e.dataTransfer.setData("sheetIds", JSON.stringify(idsToMove));
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, folderId: string) => {
    e.preventDefault();
    setDraggedOverFolderId(folderId);
  };

  const handleDragLeave = () => {
    setDraggedOverFolderId(null);
  };

  const handleDrop = (e: React.DragEvent, folderId: string | undefined) => {
    e.preventDefault();
    const sheetIdsJson = e.dataTransfer.getData("sheetIds");
    if (sheetIdsJson) {
      try {
        const ids = JSON.parse(sheetIdsJson) as string[];
        ids.forEach(id => onMoveSheet(id, folderId));
        // Clear multi-selection after successful move
        setMultiSelectedIds(new Set());
      } catch (err) {
        console.error("Failed to parse dropped sheet IDs", err);
      }
    }
    setDraggedOverFolderId(null);
  };

  const toggleMultiSelect = (id: string, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault(); 
      e.stopPropagation();
    }
    
    setMultiSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const [hasMoved, setHasMoved] = useState(false);
  const dragStartPos = useRef<{ x: number, y: number } | null>(null);

  // Marquee Selection Logic
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // Left click for marquee
    
    const target = e.target as HTMLElement;
    const isInteractive = target.closest('button') || target.closest('input') || target.closest('[role="menuitem"]');
    
    // If clicking a sheet that is NOT selected, we let the click/drag for that sheet happen.
    // If clicking the background, we marquee.
    const sheetEl = target.closest('[data-sheet-id]');
    if (isInteractive || sheetEl) {
      // If we target a sheet but it's part of a selection, we don't start marquee
      return;
    }

    // Set drag start position to detect movement
    dragStartPos.current = { x: e.clientX, y: e.clientY };
    setHasMoved(false);
    e.preventDefault();

    const rect = sidebarRef.current?.getBoundingClientRect();
    if (!rect) return;

    const startX = e.clientX - rect.left;
    const startY = e.clientY - rect.top;

    setSelectionBox({
      startX,
      startY,
      endX: startX,
      endY: startY,
    });
  };

  useEffect(() => {
    if (!selectionBox || !sidebarRef.current) return;

    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (!dragStartPos.current) return;
      
      const dist = Math.sqrt(
        Math.pow(e.clientX - dragStartPos.current.x, 2) + 
        Math.pow(e.clientY - dragStartPos.current.y, 2)
      );
      
      if (dist > 5) {
        setHasMoved(true);
      }

      const rect = sidebarRef.current!.getBoundingClientRect();
      const currentX = e.clientX - rect.left;
      const currentY = e.clientY - rect.top;

      setSelectionBox(prev => prev ? { ...prev, endX: currentX, endY: currentY } : null);

      // Calculate intersection selection
      const boxLeft = Math.min(selectionBox.startX, currentX);
      const boxRight = Math.max(selectionBox.startX, currentX);
      const boxTop = Math.min(selectionBox.startY, currentY);
      const boxBottom = Math.max(selectionBox.startY, currentY);

      const sheetElements = sidebarRef.current!.querySelectorAll('[data-sheet-id]');
      const newSelected = new Set<string>();

      sheetElements.forEach((el) => {
        const elRect = el.getBoundingClientRect();
        const elRelativeTop = elRect.top - rect.top;
        const elRelativeLeft = elRect.left - rect.left;
        const elRelativeBottom = elRelativeTop + elRect.height;
        const elRelativeRight = elRelativeLeft + elRect.width;

        const isInside = (
          elRelativeLeft < boxRight &&
          elRelativeRight > boxLeft &&
          elRelativeTop < boxBottom &&
          elRelativeBottom > boxTop
        );

        if (isInside) {
          const id = el.getAttribute('data-sheet-id');
          if (id) newSelected.add(id);
        }
      });

      setMultiSelectedIds(newSelected);
    };

    const handleGlobalMouseUp = () => {
      setSelectionBox(null);
      dragStartPos.current = null;
    };

    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);
    
    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [selectionBox]);

  const handleSidebarClick = (e: React.MouseEvent) => {
    // If we moved the cursor significantly, it was a marquee, don't clear
    if (hasMoved) return;

    if (e.button === 0) {
      const target = e.target as HTMLElement;
      const isSheetClick = target.closest('[data-sheet-id]');
      const isFolderClick = target.closest('[data-folder-id]');
      
      if (!isSheetClick && !isFolderClick) {
        setMultiSelectedIds(new Set());
      }
    }
  };

  useEffect(() => {
    const handleCloseMenu = () => setContextMenu(null);
    window.addEventListener('click', handleCloseMenu);
    return () => window.removeEventListener('click', handleCloseMenu);
  }, []);

  const handleItemContextMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    let ids = [id];
    if (multiSelectedIds.has(id)) {
      ids = Array.from(multiSelectedIds);
    } else {
      setMultiSelectedIds(new Set([id]));
    }
    
    setContextMenu({ x: e.clientX, y: e.clientY, ids });
  };

  const renderSheet = (sheet: CheatSheet) => {
    const isMultiSelected = multiSelectedIds.has(sheet.id);
    const isPrimarySelected = selectedSheetId === sheet.id;

    return (
      <div 
        key={sheet.id} 
        className="relative group pl-4"
        draggable
        onDragStart={(e) => handleDragStart(e, sheet.id)}
        onContextMenu={(e) => handleItemContextMenu(e, sheet.id)}
        data-sheet-id={sheet.id}
      >
        <div className={`w-full text-left p-2 rounded-xl border transition-all flex flex-col gap-1 cursor-grab active:cursor-grabbing ${
          isMultiSelected
          ? 'bg-blue-100 border-blue-300 text-blue-800 shadow-sm'
          : isPrimarySelected
          ? 'bg-blue-50 border-blue-200 text-blue-700 shadow-sm'
          : 'bg-white border-transparent hover:bg-gray-100 text-gray-600'
        } ${sheet.isProcessingContent ? 'opacity-70' : ''}`}
        onClick={() => {
          if (multiSelectedIds.size > 0 && !isMultiSelected) {
             setMultiSelectedIds(new Set());
          }
          onSelectSheet(sheet.id);
        }}
        >
          <div className="flex items-center gap-2 overflow-hidden">
            <div 
              className="shrink-0"
              onClick={(e) => { e.stopPropagation(); toggleMultiSelect(sheet.id); }}
            >
              {isMultiSelected ? (
                <div className="size-3.5 bg-blue-600 rounded flex items-center justify-center">
                  <CheckCircle2 className="size-2.5 text-white" />
                </div>
              ) : sheet.isProcessingContent ? (
                <Loader2 className="size-3.5 text-blue-500 animate-spin" />
              ) : (
                <FileText className={`size-3.5 ${isPrimarySelected ? 'text-blue-500' : 'text-gray-400'}`} />
              )}
            </div>
            
            {editingId === sheet.id ? (
              <input
                autoFocus
                className="bg-transparent border-b border-blue-400 outline-none w-full text-sm font-medium"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={saveEdit}
                onKeyDown={(e) => e.key === 'Enter' && saveEdit()}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-sm font-medium truncate">{sheet.name}</span>
                {sheet.isProcessingTerms && !sheet.isProcessingContent && (
                  <span className="text-[10px] text-blue-500 font-bold flex items-center gap-1">
                    <Zap className="size-2 fill-current" />
                    Scanning terms...
                  </span>
                )}
              </div>
            )}
            
            {(isPrimarySelected && !isMultiSelected && multiSelectedIds.size === 0 && !sheet.isProcessingTerms) && (
              <CheckCircle2 className="size-3 text-blue-500 shrink-0 ml-auto" />
            )}
            {sheet.isProcessingTerms && (
               <Loader2 className="size-2 text-blue-400 animate-spin shrink-0 ml-auto" />
            )}
          </div>
        </div>
      </div>
    );
  };

  const [isDraggingFile, setIsDraggingFile] = useState(false);

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingFile(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      // Simulate an event object for handleFileUpload or just call a shared logic
      const mockEvent = {
        target: { files: e.dataTransfer.files }
      } as unknown as React.ChangeEvent<HTMLInputElement>;
      handleFileUpload(mockEvent);
    }
  };

  return (
    <aside 
      id="sidebar" 
      ref={sidebarRef}
      onMouseDown={handleMouseDown}
      onClick={handleSidebarClick}
      onContextMenu={(e) => e.preventDefault()} // Global right-click suppression for marquee
      className="w-80 flex-shrink-0 flex flex-col bg-gray-50 border-r border-gray-200 h-screen overflow-hidden relative select-none"
    >
      {/* Selection Marquee Box */}
      {selectionBox && (
        <div 
          className="absolute z-50 border border-blue-500 bg-blue-400/20 pointer-events-none"
          style={{
            left: Math.min(selectionBox.startX, selectionBox.endX),
            top: Math.min(selectionBox.startY, selectionBox.endY),
            width: Math.abs(selectionBox.endX - selectionBox.startX),
            height: Math.abs(selectionBox.endY - selectionBox.startY),
          }}
        />
      )}

      {/* Context Menu */}
      <AnimatePresence>
        {contextMenu && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="fixed z-[100] bg-white border border-gray-200 shadow-xl rounded-xl py-2 w-48 select-none"
            style={{ top: contextMenu.y, left: contextMenu.x }}
            onClick={(e) => e.stopPropagation()}
          >
            {contextMenu.ids.length === 1 && (
              <button 
                onClick={() => {
                  const sheet = cheatSheets.find(s => s.id === contextMenu.ids[0]);
                  if (sheet) startEditing(sheet);
                  setContextMenu(null);
                }}
                className="w-full text-left px-4 py-2 hover:bg-gray-100 flex items-center gap-2 text-sm text-gray-700 transition-colors"
              >
                <Edit2 className="size-4" />
                Rename
              </button>
            )}
            
            <button 
              onClick={() => {
                contextMenu.ids.forEach(id => onRemoveCheatSheet(id));
                setMultiSelectedIds(new Set());
                setContextMenu(null);
              }}
              className="w-full text-left px-4 py-2 hover:bg-red-50 flex items-center gap-2 text-sm text-red-600 transition-colors"
            >
              <Trash2 className="size-4" />
              Delete {contextMenu.ids.length > 1 ? `(${contextMenu.ids.length})` : ''}
            </button>

            <div className="h-px bg-gray-100 my-1 mx-4" />
            
            <div className="px-4 py-1 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Move to</div>
            {folders.map(folder => (
              <button 
                key={folder.id}
                onClick={() => {
                  contextMenu.ids.forEach(id => onMoveSheet(id, folder.id));
                  setMultiSelectedIds(new Set());
                  setContextMenu(null);
                }}
                className="w-full text-left px-4 py-2 hover:bg-gray-100 flex items-center gap-2 text-sm text-gray-700 transition-colors"
              >
                <Folder className="size-4 text-gray-400" />
                {folder.name}
              </button>
            ))}
            <button 
              onClick={() => {
                contextMenu.ids.forEach(id => onMoveSheet(id, undefined));
                setMultiSelectedIds(new Set());
                setContextMenu(null);
              }}
              className="w-full text-left px-4 py-2 hover:bg-gray-100 flex items-center gap-2 text-sm text-gray-700 transition-colors"
            >
              <FileText className="size-4 text-gray-400" />
              Uncategorized
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="p-6 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <FileText className="text-blue-600" />
            Lexicon Lens
          </h1>
          <button 
            onClick={() => window.location.reload()} 
            className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-blue-600 transition-all group"
            title="Refresh App"
          >
            <RotateCcw className="size-4 group-active:rotate-[-45deg] transition-transform" />
          </button>
        </div>
        <p className="text-sm text-gray-500 mt-1">AI-powered reading assistant</p>
      </div>

      <div className="p-6 flex-1 overflow-y-auto space-y-6">
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="bg-red-50 border border-red-200 text-red-600 p-3 rounded-xl text-xs font-medium relative pr-8 whitespace-pre-line overflow-y-auto max-h-32"
            >
              <button 
                onClick={() => setError(null)}
                className="absolute right-2 top-2 hover:text-red-800"
              >
                <X className="size-3" />
              </button>
              {error}
            </motion.div>
          )}
        </AnimatePresence>

        <section 
          className={`space-y-3 p-3 rounded-2xl border-2 border-dashed transition-all ${
            isDraggingFile ? 'bg-blue-50 border-blue-400' : 'border-transparent'
          }`}
          onDragOver={(e) => { e.preventDefault(); setIsDraggingFile(true); }}
          onDragLeave={() => setIsDraggingFile(false)}
          onDrop={handleFileDrop}
        >
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Library</h2>
            {isUploading && (
              <button 
                onClick={handleCancelUpload}
                className="text-[9px] font-bold bg-red-100 text-red-600 px-1.5 py-0.5 rounded hover:bg-red-200 uppercase transition-colors"
              >
                Stop Upload
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex flex-col items-center justify-center gap-1 py-3 px-2 rounded-xl border border-gray-200 bg-white hover:border-blue-400 hover:bg-blue-50 transition-all text-gray-600 hover:text-blue-600 disabled:opacity-50 group shadow-sm overflow-hidden relative"
            >
              {isUploading ? (
                <div className="flex flex-col items-center">
                  <Loader2 className="animate-spin size-4 text-blue-600" />
                  <span className="text-[10px] font-bold mt-1">WORKING...</span>
                </div>
              ) : (
                <>
                  <FileUp className="size-4 group-hover:-translate-y-0.5 transition-transform" />
                  <span className="text-[10px] font-bold">UPLOAD</span>
                </>
              )}
            </button>
            <button
              onClick={() => setIsCreatingFolder(true)}
              className="flex flex-col items-center justify-center gap-1 py-3 px-2 rounded-xl border border-gray-200 bg-white hover:border-blue-400 hover:bg-blue-50 transition-all text-gray-600 hover:text-blue-600 shadow-sm"
            >
              <FolderPlus className="size-4" />
              <span className="text-[10px] font-bold uppercase">Folder</span>
            </button>
          </div>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            className="hidden"
            accept=".md,.pdf,.txt,.js,.py,.html,.css,.csv,.json"
            multiple
          />
          
          <AnimatePresence>
            {isCreatingFolder && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="p-3 bg-white border border-blue-200 rounded-xl shadow-sm space-y-2"
              >
                <input
                  autoFocus
                  placeholder="Folder name..."
                  className="w-full text-sm p-1.5 border rounded outline-none focus:ring-2 focus:ring-blue-100"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
                />
                <div className="flex gap-2">
                  <button onClick={handleCreateFolder} className="flex-1 text-[10px] bg-blue-600 text-white font-bold py-1.5 rounded uppercase">Create</button>
                  <button onClick={() => setIsCreatingFolder(false)} className="flex-1 text-[10px] bg-gray-100 text-gray-600 font-bold py-1.5 rounded uppercase">Cancel</button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Storage</h2>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold bg-gray-200 px-1.5 py-0.5 rounded text-gray-600 uppercase">
                {cheatSheets.length} items
              </span>
            </div>
          </div>

          <div className="space-y-4">
            <button
              onClick={() => { onSelectSheet(null); onPasteText(""); }}
              className={`w-full text-left p-3 rounded-xl border transition-all text-sm font-bold flex items-center gap-2 ${
                selectedSheetId === null 
                ? 'bg-blue-600 border-blue-600 text-white shadow-md' 
                : 'bg-white border-gray-100 hover:bg-gray-100 text-gray-700'
              }`}
            >
              <Zap className={`size-4 ${selectedSheetId === null ? 'fill-white' : ''}`} />
              NEW SCAN
            </button>

            <div className="space-y-1">
              {folders.map(folder => (
                <div 
                  key={folder.id} 
                  className={`space-y-1 rounded-lg transition-colors ${
                    draggedOverFolderId === folder.id ? 'bg-blue-50 ring-2 ring-blue-400 ring-inset' : ''
                  }`}
                  data-folder-id={folder.id}
                  onDragOver={(e) => handleDragOver(e, folder.id)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, folder.id)}
                >
                  <button
                    onClick={() => toggleFolder(folder.id)}
                    className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-gray-100 text-gray-600 group"
                  >
                    {expandedFolders.has(folder.id) ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                    <Folder className="size-4 fill-gray-400 text-gray-400" />
                    <span className="text-sm font-semibold">{folder.name}</span>
                  </button>
                  
                  {expandedFolders.has(folder.id) && (
                    <div className="space-y-1 ml-2 border-l border-gray-200">
                      {cheatSheets.filter(s => s.folderId === folder.id).map(sheet => renderSheet(sheet))}
                      {cheatSheets.filter(s => s.folderId === folder.id).length === 0 && (
                        <div className="text-[10px] text-gray-400 italic py-2 pl-4">No documents here</div>
                      )}
                    </div>
                  )}
                </div>
              ))}

              <div 
                className={`pt-2 italic text-xs text-gray-400 pb-1 transition-colors rounded ${
                  draggedOverFolderId === 'uncategorized' ? 'bg-gray-100 ring-1 ring-gray-300' : ''
                }`}
                data-folder-id="uncategorized"
                onDragOver={(e) => handleDragOver(e, 'uncategorized')}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, undefined)}
              >
                Uncategorized
              </div>
              {cheatSheets.filter(s => !s.folderId).map(sheet => (
                <div key={sheet.id}>
                  {renderSheet(sheet)}
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      <div className="p-6 bg-white border-t border-gray-200">
        <div className="flex items-center gap-3">
          <div className="size-8 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-xs shadow-inner">LL</div>
          <div>
            <div className="text-sm font-semibold text-gray-900 leading-tight">Lexicon Linker</div>
            <div className="text-[10px] text-green-500 font-bold uppercase tracking-tighter">System Synchronized</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
