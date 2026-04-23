import { useState, useMemo, useEffect } from 'react';
import { Sidebar, CheatSheet, Category } from './components/Sidebar';
import { ArticleViewer } from './components/ArticleViewer';
import { motion, AnimatePresence } from 'motion/react';
import { BookOpen, Sparkles, Wand2, FileText, Zap, CheckCircle2 } from 'lucide-react';

export default function App() {
  const [cheatSheets, setCheatSheets] = useState<CheatSheet[]>([]);
  const [folders, setFolders] = useState<Category[]>([]);
  const [selectedSheetId, setSelectedSheetId] = useState<string | null>(null);
  const [pastedText, setPastedText] = useState("");
  const [glossaryRevision, setGlossaryRevision] = useState(0);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

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
  }, [cheatSheets]);

  return (
    <div id="app-container" className="flex h-screen bg-gray-50 text-gray-900 font-sans">
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

      <main className="flex-1 overflow-y-auto p-12">
        <div className="max-w-4xl mx-auto space-y-8">
          <header className="space-y-4">
            <div className="flex items-center gap-2 text-indigo-600 font-semibold tracking-wider uppercase text-xs">
              <Zap className="size-4 fill-indigo-500" />
              Intelligence Mode: On-Demand Definitions
            </div>
            <h2 className="text-4xl font-bold tracking-tight text-gray-900">
              {selectedSheetId ? (
                <>Reading: <span className="text-blue-600 truncate inline-block max-w-[400px] align-bottom">{selectedSheet?.name}</span></>
              ) : (
                <>New <span className="text-blue-600">Article Scan</span></>
              )}
            </h2>
            <p className="text-lg text-gray-600 max-w-2xl leading-relaxed">
              {selectedSheetId 
                ? "Dive deep into your document. Highlight any confusing sentence to get an instant AI definition and save it to this document's specific lexicon."
                : "Paste an article below. Any terminology matching your library will be highlighted automatically. Highlight text for on-the-fly definitions."}
            </p>
          </header>

          <section className="relative">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 border border-blue-100 text-blue-700 text-sm font-medium">
                  <BookOpen className="size-4" />
                  {Object.keys(glossary).length} Total Definitions Available
                </div>
                {selectedSheetId && (
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-50 border border-green-100 text-green-700 text-sm font-medium">
                    <FileText className="size-4" />
                    {Object.keys(selectedSheet?.terms || {}).length} In this sheet
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <Wand2 className="size-3" />
                Context-aware highlights active
              </div>
            </div>

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
              onSaveTerm={handleSaveTerm}
              canSave={!!selectedSheetId || cheatSheets.length > 0}
              revision={glossaryRevision}
              isProcessingContent={selectedSheet?.isProcessingContent}
              isProcessingTerms={selectedSheet?.isProcessingTerms}
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
      </main>
    </div>
  );
}
