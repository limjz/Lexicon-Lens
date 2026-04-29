import { useState, useMemo, useEffect } from 'react';
import { Sidebar, CheatSheet, Category } from './components/Sidebar';
import { ArticleViewer } from './components/ArticleViewer';
import { motion, AnimatePresence } from 'motion/react';
import { BookOpen, Sparkles, Wand2, FileText, Zap, CheckCircle2, Search, Highlighter, Plus, Trash2, Layout, BookMarked, Settings, Menu, X, ChevronRight, Save, Loader2, AlertCircle, PenLine } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function App() {
  const [cheatSheets, setCheatSheets] = useState<CheatSheet[]>(() => {
    const saved = localStorage.getItem('lexicon_sheets');
    try {
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [folders, setFolders] = useState<Category[]>(() => {
    const saved = localStorage.getItem('lexicon_folders');
    try {
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [selectedSheetId, setSelectedSheetId] = useState<string | null>(() => {
    return localStorage.getItem('lexicon_selected_id');
  });

  const [pastedText, setPastedText] = useState("");
  const [glossaryRevision, setGlossaryRevision] = useState(0);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [showLexicon, setShowLexicon] = useState(false);
  const [appMode, setAppMode] = useState<'reading' | 'edit'>('reading');

  // Persistence Effects
  useEffect(() => {
    localStorage.setItem('lexicon_sheets', JSON.stringify(cheatSheets));
  }, [cheatSheets]);

  useEffect(() => {
    localStorage.setItem('lexicon_folders', JSON.stringify(folders));
  }, [folders]);

  useEffect(() => {
    if (selectedSheetId) {
      localStorage.setItem('lexicon_selected_id', selectedSheetId);
    } else {
      localStorage.removeItem('lexicon_selected_id');
    }
  }, [selectedSheetId]);

  const handleAddCheatSheet = (sheet: CheatSheet) => {
    setCheatSheets(prev => [...prev, sheet]);
  };

  const handleUpdateCheatSheet = (id: string, updates: Partial<CheatSheet>) => {
    setCheatSheets(prev => prev.map(sheet => 
      sheet.id === id ? { ...sheet, ...updates } : sheet
    ));
    if (updates.terms) {
      setGlossaryRevision(prev => prev + 1);
    }
  };

  const handleRemoveCheatSheet = (id: string) => {
    setCheatSheets(prev => {
      const filtered = prev.filter(s => s.id !== id);
      if (selectedSheetId === id) setSelectedSheetId(null);
      return filtered;
    });
  };

  const handleRenameSheet = (id: string, newName: string) => {
    setCheatSheets(prev => prev.map(s => s.id === id ? { ...s, name: newName } : s));
  };

  const handleAddFolder = (name: string) => {
    setFolders(prev => [...prev, { id: Math.random().toString(36).substr(2, 9), name }]);
  };

  const handleMoveSheet = (id: string, folderId: string | undefined) => {
    setCheatSheets(prev => prev.map(s => s.id === id ? { ...s, folderId } : s));
  };

  const handleSaveTerm = (term: string, definition: string) => {
    if (!term || !definition) return;
    
    // Normalize whitespace for better matching
    const normalizedTerm = term.trim().replace(/\s+/g, ' ');
    console.log(`Saving term: "${normalizedTerm}"`);
    
    setCheatSheets(prev => {
      const targetId = selectedSheetId || (prev.length > 0 ? prev[0].id : null);
      
      if (!targetId) {
        // Create an "Ungrouped" sheet if none exists
        const newSheet: CheatSheet = {
          id: Math.random().toString(36).substr(2, 9),
          name: "My Definitions",
          content: "",
          terms: { [normalizedTerm]: definition },
          isProcessing: false,
          isProcessingContent: false,
          isProcessingTerms: false
        };
        return [newSheet];
      }

      const next = prev.map(sheet => {
        if (sheet.id === targetId) {
          return {
            ...sheet,
            terms: { ...sheet.terms, [normalizedTerm]: definition }
          };
        }
        return sheet;
      });
      return next;
    });

    // Force glossary update
    setGlossaryRevision(prev => prev + 1);
    setSaveStatus(`Saved: "${normalizedTerm}"`);
    setTimeout(() => setSaveStatus(null), 3000);
  };

  const handleContentChange = (newContent: string) => {
    if (selectedSheetId) {
      handleUpdateCheatSheet(selectedSheetId, { content: newContent });
    } else {
      setPastedText(newContent);
    }
  };

  const [lexiconWidth, setLexiconWidth] = useState(320);
  const [libraryWidth, setLibraryWidth] = useState(320);
  const [lexiconSearchQuery, setLexiconSearchQuery] = useState("");

  // Resize handler for Lexicon
  const handleLexiconResize = (e: MouseEvent) => {
    const newWidth = e.clientX - libraryWidth;
    if (newWidth > 200 && newWidth < 600) {
      setLexiconWidth(newWidth);
    }
  };

  const startLexiconResizing = () => {
    window.addEventListener('mousemove', handleLexiconResize);
    window.addEventListener('mouseup', () => {
      window.removeEventListener('mousemove', handleLexiconResize);
    });
  };

  // Resize handler for Library
  const handleLibraryResize = (e: MouseEvent) => {
    const newWidth = e.clientX;
    if (newWidth > 200 && newWidth < 500) {
      setLibraryWidth(newWidth);
    }
  };

  const startLibraryResizing = () => {
    window.addEventListener('mousemove', handleLibraryResize);
    window.addEventListener('mouseup', () => {
      window.removeEventListener('mousemove', handleLibraryResize);
    });
  };

  const SidebarGlossary = () => {
    if (!selectedSheet) return null;
    
    // Get all terms defined for this specific sheet
    const sheetTerms = selectedSheet.terms || {};
    const termKeys = Object.keys(sheetTerms);
    
    const filteredTerms = termKeys.filter(term => {
      const query = lexiconSearchQuery.toLowerCase();
      const definition = sheetTerms[term].toLowerCase();
      return term.toLowerCase().includes(query) || definition.includes(query);
    }).sort();

    if (termKeys.length === 0) {
      return (
        <div className="p-6 text-center">
          <BookMarked className="size-8 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-400 text-sm italic">No translated terms yet.</p>
          <p className="text-gray-400 text-xs mt-2">Use "AI Define" mode and save definitions to build your document vocabulary.</p>
        </div>
      );
    }

    return (
      <div className="flex flex-col h-full bg-gray-50/50">
        <div className="p-4 border-b border-gray-100 sticky top-0 bg-white z-10 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-gray-900 text-sm flex items-center gap-2">
              <BookMarked className="size-4 text-indigo-600" />
              DOCUMENT LEXICON ({termKeys.length})
            </h3>
          </div>
          
          <div className="relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-gray-400 group-focus-within:text-indigo-500 transition-colors" />
            <input 
              type="text"
              placeholder="Search terms or definitions..."
              value={lexiconSearchQuery}
              onChange={(e) => setLexiconSearchQuery(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-lg py-2 pl-9 pr-3 text-xs outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400 transition-all font-medium"
            />
            {lexiconSearchQuery && (
              <button 
                onClick={() => setLexiconSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="size-3" />
              </button>
            )}
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
          {filteredTerms.length > 0 ? (
            filteredTerms.map((term, index) => {
              const definition = sheetTerms[term];
              
              const lines = definition.split('\n').filter(l => l.trim());
              const chinese = lines[0] || "";
              const other = lines.slice(1).join('\n');
              
              return (
                <div key={index} className="group p-5 rounded-2xl border border-gray-200 bg-white hover:shadow-xl hover:border-indigo-200 transition-all duration-300">
                  <div className="flex items-start justify-between mb-3">
                    <span className="font-bold text-gray-900 text-xl leading-tight">{term}</span>
                    <span className="text-sm font-black bg-indigo-50 text-indigo-600 px-3 py-1.5 rounded-md uppercase tracking-tighter shrink-0 ml-2">{chinese}</span>
                  </div>
                  {other && (
                    <div className="text-base text-gray-600 leading-relaxed glossary-content border-t border-gray-50 pt-4 mt-4">
                      <ReactMarkdown>{other}</ReactMarkdown>
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <div className="py-12 text-center">
              <Search className="size-8 text-gray-200 mx-auto mb-3" />
              <p className="text-gray-400 text-xs font-bold uppercase tracking-widest">No matches found</p>
              <p className="text-gray-400 text-[10px] mt-1">Try a different search term</p>
            </div>
          )}
        </div>
      </div>
    );
  };

  const selectedSheet = useMemo(() => 
    cheatSheets.find(s => s.id === selectedSheetId), 
    [cheatSheets, selectedSheetId]
  );

  const displayContent = selectedSheetId ? (selectedSheet?.content || "") : pastedText;

  const glossary = useMemo(() => {
    const combined: Record<string, string> = {};
    cheatSheets.forEach(sheet => {
      Object.assign(combined, sheet.terms);
    });
    return combined;
  }, [cheatSheets, glossaryRevision]);

  const currentHighlights = useMemo(() => {
    if (!selectedSheetId) return [];
    return selectedSheet?.highlights || [];
  }, [selectedSheet, selectedSheetId]);

  const handleHighlightText = (highlight: { text: string; index: number; color?: string }) => {
    if (!highlight.text) return;
    const targetId = selectedSheetId;
    if (!targetId) return;

    const normalizedText = highlight.text.trim().replace(/\s+/g, ' ');

    setCheatSheets(prev => prev.map(sheet => {
      if (sheet.id === targetId) {
        const currentHighlights = (sheet.highlights || []).filter(h =>
          h && typeof h === 'object' && typeof h.text === 'string'
        ) as { text: string; index: number; color?: string }[];

        const existingIndex = currentHighlights.findIndex(h =>
          h.text.toLowerCase() === normalizedText.toLowerCase() &&
          h.index === highlight.index
        );

        const newHighlights = existingIndex !== -1
          ? currentHighlights.filter((_, i) => i !== existingIndex)
          : [...currentHighlights, { text: normalizedText, index: highlight.index, color: highlight.color || 'yellow' }];

        return { ...sheet, highlights: newHighlights };
      }
      return sheet;
    }));
    setGlossaryRevision(prev => prev + 1);
  };

  const handleClearHighlights = () => {
    const targetId = selectedSheetId;
    if (!targetId) return;
    setCheatSheets(prev => prev.map(sheet => {
      if (sheet.id === targetId) return { ...sheet, highlights: [] };
      return sheet;
    }));
    setGlossaryRevision(prev => prev + 1);
  };

  return (
    <div id="app-container" className="flex h-screen bg-gray-50 text-gray-900 font-sans overflow-hidden">

      {/* ── Mode switcher – fixed top-right ── */}
      <div className="fixed top-4 right-4 z-[90] flex items-center gap-0.5 bg-white/95 backdrop-blur-md border border-gray-200 rounded-full p-1 shadow-lg">
        <button
          onClick={() => setAppMode('reading')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
            appMode === 'reading'
              ? 'bg-gray-900 text-white shadow'
              : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
          }`}
        >
          <BookOpen className="size-3.5" />
          Reading
        </button>
        <button
          onClick={() => setAppMode('edit')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
            appMode === 'edit'
              ? 'bg-indigo-600 text-white shadow'
              : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
          }`}
        >
          <PenLine className="size-3.5" />
          Editing
        </button>
      </div>
      <div style={{ width: `${libraryWidth}px` }} className="flex-shrink-0 relative h-full z-50">
        <Sidebar 
          cheatSheets={cheatSheets}
          folders={folders}
          selectedSheetId={selectedSheetId}
          onSelectSheet={setSelectedSheetId}
          onAddCheatSheet={handleAddCheatSheet}
          onUpdateCheatSheet={handleUpdateCheatSheet}
          onRemoveCheatSheet={handleRemoveCheatSheet}
          onRenameSheet={handleRenameSheet}
          onAddFolder={handleAddFolder}
          onMoveSheet={handleMoveSheet}
          onPasteText={setPastedText}
        />

        {/* Lexicon Overlay */}
        <AnimatePresence>
          {selectedSheet && showLexicon && (
            <motion.aside 
              initial={{ x: -libraryWidth, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -libraryWidth, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="absolute inset-0 bg-white z-[70] flex flex-col shadow-2xl border-r border-gray-200"
            >
              <div className="flex-1 overflow-hidden relative">
                <SidebarGlossary />
                <button 
                  onClick={() => setShowLexicon(false)}
                  className="absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-full transition-all z-20"
                  title="Back to Library"
                >
                  <X className="size-5" />
                </button>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* Resize Handle for Library */}
        <div 
          className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-indigo-400/30 transition-colors z-[80]"
          onMouseDown={startLibraryResizing}
        />
      </div>

      <main className="flex-1 overflow-hidden flex flex-row">
        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 lg:p-12">
          <div className="space-y-8 h-full">


          <section className="relative min-h-full">


            {!selectedSheetId && !pastedText && (
              <div className="mb-6">
                <textarea
                  placeholder="Paste text or article content here to scan it against your library..."
                  className="w-full h-48 p-6 rounded-2xl border-2 border-dashed border-gray-200 bg-white text-lg focus:ring-4 focus:ring-blue-100 focus:border-blue-400 transition-all overflow-y-auto resize-none outline-none"
                  value={pastedText}
                  onChange={(e) => setPastedText(e.target.value)}
                />
              </div>
            )}

            <ArticleViewer
              text={displayContent}
              glossary={glossary}
              highlights={currentHighlights}
              onSaveTerm={handleSaveTerm}
              onHighlight={handleHighlightText}
              onClearHighlights={handleClearHighlights}
              canSave={!!selectedSheetId || cheatSheets.length > 0}
              revision={glossaryRevision}
              isProcessingContent={selectedSheet?.isProcessingContent}
              isProcessingTerms={selectedSheet?.isProcessingTerms}
              showLexicon={showLexicon}
              onToggleLexicon={() => setShowLexicon(!showLexicon)}
              appMode={appMode}
              onContentChange={handleContentChange}
              documentId={selectedSheetId || 'pastedText'}
            />

            <AnimatePresence>
              {saveStatus && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9, x: '-50%' }}
                  animate={{ opacity: 1, scale: 1, x: '-50%' }}
                  exit={{ opacity: 0, scale: 0.9, x: '-50%' }}
                  className="fixed top-24 left-1/2 z-[100] px-6 py-3 bg-green-600 text-white rounded-full font-bold shadow-2xl flex items-center gap-3 border border-green-500"
                >
                  <CheckCircle2 className="size-5" />
                  {saveStatus}
                </motion.div>
              )}
            </AnimatePresence>
          </section>

          <AnimatePresence>
            {!displayContent && (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-12"
              >
                <div className="p-6 rounded-2xl bg-white border border-gray-100 shadow-sm space-y-3">
                  <div className="size-10 rounded-xl bg-orange-100 flex items-center justify-center text-orange-600 font-bold">1</div>
                  <h3 className="font-semibold">Upload Documents</h3>
                  <p className="text-sm text-gray-500">Upload your PDF/MD files. We extract the full text and generate a starting glossary for you.</p>
                </div>
                <div className="p-6 rounded-2xl bg-white border border-gray-100 shadow-sm space-y-3">
                  <div className="size-10 rounded-xl bg-blue-100 flex items-center justify-center text-blue-600 font-bold">2</div>
                  <h3 className="font-semibold">Interactive Selection</h3>
                  <p className="text-sm text-gray-500">Pick a document from the sidebar to view its content. Highlight any text that's unclear to define it.</p>
                </div>
                <div className="p-6 rounded-2xl bg-white border border-gray-100 shadow-sm space-y-3">
                  <div className="size-10 rounded-xl bg-green-100 flex items-center justify-center text-green-600 font-bold">3</div>
                  <h3 className="font-semibold">Building Cheat Sheets</h3>
                  <p className="text-sm text-gray-500">Save AI-generated definitions to the specific document's cheat sheet for future reference.</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </main>
  </div>
);
}
