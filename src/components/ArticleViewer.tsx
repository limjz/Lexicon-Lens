import React, { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import { Tooltip } from './Tooltip';
import { defineSelection } from '../lib/gemini';
import { Sparkles, Save, Loader2, X, Highlighter, Search, ChevronUp, ChevronDown, BookMarked, Trash2, ZoomIn, ZoomOut, Maximize2, Settings, Command, Keyboard, Plus } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ArticleViewerProps {
  text: string;
  glossary: Record<string, string>;
  highlights?: string[];
  onSaveTerm?: (term: string, definition: string) => void;
  onHighlight?: (text: string) => void;
  onClearHighlights?: () => void;
  canSave?: boolean;
  revision?: number;
  isProcessingContent?: boolean;
  isProcessingTerms?: boolean;
  showLexicon?: boolean;
  onToggleLexicon?: () => void;
}

export function ArticleViewer({ 
  text, 
  glossary, 
  highlights = [],
  onSaveTerm, 
  onHighlight,
  onClearHighlights,
  canSave, 
  revision = 0,
  isProcessingContent,
  isProcessingTerms,
  showLexicon,
  onToggleLexicon
}: ArticleViewerProps) {
  const [selectionText, setSelectionText] = useState<string | null>(null);
  const [selectionContext, setSelectionContext] = useState<string | null>(null);
  const [aiDefinition, setAiDefinition] = useState<string | null>(null);
  const [isDefining, setIsDefining] = useState(false);
  const [selectionMode, setSelectionMode] = useState<'define' | 'highlight'>('define');
  const [zoom, setZoom] = useState(100);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [isToolbarOpen, setIsToolbarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMatches, setSearchMatches] = useState<number[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(-1);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const viewerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setIsSearchOpen(false);
      }
    };
    if (isSearchOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isSearchOpen]);

  const handleSelection = (e: React.MouseEvent | React.KeyboardEvent) => {
    if (isProcessingContent) return;
    
    // Don't clear selection if user is clicking inside the assistant panel
    const target = e.target as HTMLElement;
    if (target.closest('.ai-assistant-panel')) return;

    const sel = window.getSelection();
    if (sel && sel.toString().trim().length > 0) {
      const selected = sel.toString().trim();
      
      if (selectionMode === 'highlight') {
        if (onHighlight) {
          onHighlight(selected);
        }
        // Don't show popup in highlight mode
        setSelectionText(null);
        // Clear window selection
        window.getSelection()?.removeAllRanges();
        return;
      }

      setSelectionText(selected);
      
      // Attempt to find the paragraph/block context
      let context = "";
      try {
        const node = sel.anchorNode;
        if (node) {
          const parent = node.parentElement;
          if (parent) {
            const block = parent.closest('p, li, h1, h2, h3, blockquote, td, th');
            if (block) {
              context = block.textContent || "";
            } else {
              context = parent.textContent || "";
            }
          }
        }
      } catch (err) {
        console.error("Error getting selection context", err);
      }
      
      setSelectionContext(context || selected); // Fallback to selection itself if context fails
      setAiDefinition(null);
    } else {
      if (!aiDefinition) {
        setSelectionText(null);
        setSelectionContext(null);
      }
    }
  };

  const handleAiDefine = async () => {
    if (!selectionText) return;
    setIsDefining(true);
    try {
      // Use the paragraph context if available, fallback to full text
      const contextToUse = selectionContext || text;
      const def = await defineSelection(selectionText, contextToUse);
      setAiDefinition(def);
    } catch (e: any) {
      const { formatGeminiError } = await import('../lib/gemini');
      setAiDefinition(formatGeminiError(e));
    } finally {
      setIsDefining(false);
    }
  };

  // Shortcut listeners for toolbar tools
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Find in text (Ctrl+F)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setIsSearchOpen(prev => !prev);
      }
      
      // Zoom In (Ctrl + Plus / Equal)
      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        setZoom(prev => Math.min(prev + 10, 200));
      }
      
      // Zoom Out (Ctrl + Minus)
      if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault();
        setZoom(prev => Math.max(prev - 10, 50));
      }
      
      // Reset Zoom (Ctrl + 0)
      if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        setZoom(100);
      }

      // Shift+D: Define Mode
      if (e.shiftKey && e.key.toLowerCase() === 'd') {
        setSelectionMode('define');
      }

      // Shift+H: Highlight Mode
      if (e.shiftKey && e.key.toLowerCase() === 'h') {
        setSelectionMode('highlight');
      }

      // Shift+L: Toggle Lexicon
      if (e.shiftKey && e.key.toLowerCase() === 'l') {
        if (onToggleLexicon) onToggleLexicon();
      }

      // Shift+C: Clear Highlights
      if (e.shiftKey && e.key.toLowerCase() === 'c') {
        if (onClearHighlights) onClearHighlights();
      }

      // Shift+S: Shortcuts
      if (e.shiftKey && e.key.toLowerCase() === 's') {
        setShowShortcuts(prev => !prev);
      }

      if (e.key === 'Escape') {
        if (isSearchOpen) {
          setIsSearchOpen(false);
          handleSearch("");
        }
        if (showShortcuts) setShowShortcuts(false);
        if (selectionText) {
          setSelectionText(null);
          setSelectionContext(null);
          setAiDefinition(null);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSearchOpen, onToggleLexicon, onClearHighlights, showShortcuts, selectionText]); 

  // Zoom shortcut listener for Ctrl+Wheel
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        // Determine zoom direction
        const isZoomIn = e.deltaY < 0;
        setZoom(prev => {
          const step = 5;
          const newValue = isZoomIn ? prev + step : prev - step;
          return Math.min(Math.max(newValue, 50), 300); // 50% to 300%
        });
      }
    };

    // Use passive: false to allow e.preventDefault()
    viewer.addEventListener('wheel', handleWheel, { passive: false });
    return () => viewer.removeEventListener('wheel', handleWheel);
  }, []);

  // Search logic
  const handleSearch = (query: string) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setSearchMatches([]);
      setCurrentMatchIndex(-1);
      return;
    }

    // Find all occurrences in the text
    const matches: number[] = [];
    const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    
    // We search the raw text content
    let match;
    while ((match = regex.exec(text)) !== null) {
      matches.push(match.index);
    }
    
    setSearchMatches(matches);
    if (matches.length > 0) {
      setCurrentMatchIndex(0);
      scrollToMatch(0);
    } else {
      setCurrentMatchIndex(-1);
    }
  };

  const scrollToMatch = (index: number) => {
    // Find the elements that contain this match
    // Since we render markdown, we search for marked elements or use window.find (if available)
    // A better way is to target the specific DOM node.
    // For simplicity, we'll use a data attribute on the highlighted nodes if they match the query
    setTimeout(() => {
      const matchElements = viewerRef.current?.querySelectorAll(`[data-search-match="true"]`);
      if (matchElements && matchElements[index]) {
        matchElements[index].scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Add a temporary pulse effect
        (matchElements[index] as HTMLElement).classList.add('animate-pulse', 'ring-4', 'ring-green-400');
        setTimeout(() => {
          (matchElements[index] as HTMLElement).classList.remove('animate-pulse', 'ring-4', 'ring-green-400');
        }, 2000);
      }
    }, 100);
  };

  const nextMatch = () => {
    if (searchMatches.length === 0) return;
    const next = (currentMatchIndex + 1) % searchMatches.length;
    setCurrentMatchIndex(next);
    scrollToMatch(next);
  };

  const prevMatch = () => {
    if (searchMatches.length === 0) return;
    const prev = (currentMatchIndex - 1 + searchMatches.length) % searchMatches.length;
    setCurrentMatchIndex(prev);
    scrollToMatch(prev);
  };

  const highlightText = useCallback((content: string) => {
    if (!content || typeof content !== 'string') return content;
    
    // Sort terms and highlights by length (descending) to ensure longest phrases match first
    const termsArr = Object.keys(glossary).sort((a, b) => b.length - a.length);
    const sortedHighlights = [...highlights].sort((a, b) => b.length - a.length);
    
    if (termsArr.length === 0 && sortedHighlights.length === 0) return content;

    // Create combinations for regex
    const escapedTerms = termsArr.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const escapedHighlights = sortedHighlights.map(h => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    
    // Search tokens
    const searchTokens = searchQuery.trim() ? [searchQuery.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')] : [];
    
    // Combine all to a single regex for one-pass processing
    const allTokens = [...new Set([...escapedTerms, ...escapedHighlights, ...searchTokens])].sort((a, b) => b.length - a.length);
    if (allTokens.length === 0) return content;

    const regex = new RegExp(`(${allTokens.join('|')})`, 'gi');

    const parts = content.split(regex);
    const result: React.ReactNode[] = [];

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part) continue;

      if (i % 2 === 1) {
        // This is a matched token
        const lowerPart = part.toLowerCase();
        
        // Find which type it is
        const originalTermKey = termsArr.find(t => t.toLowerCase() === lowerPart);
        const isHighlight = sortedHighlights.some(h => h.toLowerCase() === lowerPart);
        const isSearchMatch = searchQuery.trim() && lowerPart === searchQuery.trim().toLowerCase();

        if (originalTermKey) {
          const definition = glossary[originalTermKey] || "";
          result.push(
            <Tooltip key={`term-${i}`} term={originalTermKey} definition={definition} isHighlighted={isHighlight}>
              {part}
            </Tooltip>
          );
        } else if (isSearchMatch) {
          result.push(
            <mark 
              key={`search-${i}`} 
              data-search-match="true"
              className="bg-green-300 text-green-900 px-0.5 rounded-sm font-medium ring-2 ring-green-500"
            >
              {part}
            </mark>
          );
        } else if (isHighlight) {
          result.push(
            <mark key={`mark-${i}`} className="bg-yellow-200 text-yellow-900 px-0.5 rounded-sm font-medium">
              {part}
            </mark>
          );
        } else {
          result.push(part);
        }
      } else {
        result.push(part);
      }
    }
    return result;
  }, [glossary, highlights, searchQuery]);

  const processChildren = useCallback((children: React.ReactNode): React.ReactNode => {
    return React.Children.map(children, child => {
      if (typeof child === 'string') {
        return highlightText(child);
      }
      if (React.isValidElement(child)) {
        const elementChild = child as React.ReactElement<any>;
        if (elementChild.props && elementChild.props.children) {
          // Skip highlighting inside links to avoid nested interactive elements
          if (elementChild.type === 'a') return child;
          
          return React.cloneElement(elementChild, {
            children: processChildren(elementChild.props.children)
          });
        }
      }
      return child;
    });
  }, [highlightText]);

  const components = useMemo(() => ({
    p: ({ children }: any) => <p className="mb-4">{processChildren(children)}</p>,
    h1: ({ children }: any) => <h1 className="text-2xl font-bold mb-4">{processChildren(children)}</h1>,
    h2: ({ children }: any) => <h2 className="text-xl font-bold mb-3">{processChildren(children)}</h2>,
    h3: ({ children }: any) => <h3 className="text-lg font-bold mb-2">{processChildren(children)}</h3>,
    li: ({ children }: any) => <li className="mb-1">{processChildren(children)}</li>,
    em: ({ children }: any) => <em className="italic">{processChildren(children)}</em>,
    strong: ({ children }: any) => <strong className="font-bold">{processChildren(children)}</strong>,
    td: ({ children }: any) => <td className="p-2 border">{processChildren(children)}</td>,
    th: ({ children }: any) => <th className="p-2 border font-bold bg-gray-50">{processChildren(children)}</th>,
    a: ({ children, href }: any) => <a href={href} className="text-blue-600 underline" target="_blank" rel="noopener noreferrer">{processChildren(children)}</a>,
    blockquote: ({ children }: any) => <blockquote className="border-l-4 border-gray-200 pl-4 italic my-4">{processChildren(children)}</blockquote>,
    table: ({ children }: any) => (
      <div className="overflow-x-auto my-4">
        <table className="min-w-full border-collapse border">{processChildren(children)}</table>
      </div>
    ),
  }), [processChildren]);

  return (
    <div 
      ref={viewerRef}
      onMouseUp={handleSelection}
      onKeyUp={handleSelection}
      className="flex items-start gap-8 w-full"
    >
      <div className="flex-1 flex justify-center min-w-0">
        <div 
          id="article-viewer"
          style={{ zoom: `${zoom}%` }}
          className={`prose prose-blue prose-sm md:prose-base w-full max-w-4xl rounded-2xl bg-white p-8 md:p-12 shadow-sm border border-gray-100 min-h-[600px] leading-relaxed text-gray-800 transition-all ${
            isProcessingContent ? 'opacity-90 select-none cursor-wait' : ''
          }`}
        >
          {isProcessingContent ? (
            <div className="flex flex-col items-center justify-center py-24 space-y-4">
              <Loader2 className="size-12 text-blue-500 animate-spin" />
              <div className="text-center">
                <h3 className="text-lg font-bold text-gray-900">Extracting content with AI...</h3>
                <p className="text-sm text-gray-500">Gemini is analyzing your document. This usually takes 10-30 seconds.</p>
              </div>
            </div>
          ) : !text ? (
            <p className="text-gray-400 italic text-center py-20">Select a document from the sidebar or paste text to begin...</p>
          ) : (
            <>
              {isProcessingTerms && (
                <div className="mb-6 p-4 bg-blue-50 border border-blue-100 rounded-xl flex items-center gap-3">
                  <Loader2 className="size-4 text-blue-500 animate-spin" />
                  <span className="text-sm font-medium text-blue-700">Analyzing terminology and generating glossary... Highlights will appear automatically.</span>
                </div>
              )}
              <ReactMarkdown 
                key={`viewer-${revision}-${Object.keys(glossary).length}`}
                remarkPlugins={[remarkGfm]}
                components={components}
              >
                {text}
              </ReactMarkdown>
            </>
          )}
        </div>
      </div>

      {/* Document Tools Area - Fixed on the bottom right */}
      <aside className="fixed bottom-8 right-8 z-40 flex flex-col-reverse items-end pointer-events-none">
        <div className="flex flex-col-reverse gap-3 items-center pointer-events-auto">
          <button 
            onClick={() => setIsToolbarOpen(!isToolbarOpen)}
            className={`size-14 rounded-full flex items-center justify-center shadow-2xl transition-all pointer-events-auto bg-gray-900 border border-gray-800 text-white ${
              isToolbarOpen ? 'rotate-45' : 'hover:scale-110 active:scale-95'
            }`}
            title={isToolbarOpen ? "Close Tools" : "Open Document Tools"}
          >
            <Plus className="size-6" />
          </button>

          <AnimatePresence>
            {isToolbarOpen && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.8, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.8, y: 20 }}
                className="flex flex-col-reverse gap-2 items-center mb-2"
              >
                {/* 1. AI Tools & Highlights (Base set) */}
                <div className="flex flex-col gap-1 bg-white/90 backdrop-blur-md border border-gray-100 rounded-xl p-1.5 shadow-xl">
                  <button 
                    onClick={() => setSelectionMode('define')}
                    className={`p-2.5 rounded-lg transition-all flex items-center justify-center ${selectionMode === 'define' ? 'bg-indigo-600 text-white shadow-lg' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
                    title="AI Define Mode (Shift+D)"
                  >
                    <Sparkles className="size-5" />
                  </button>
                  <button 
                    onClick={() => setSelectionMode('highlight')}
                    className={`p-2.5 rounded-lg transition-all flex items-center justify-center ${selectionMode === 'highlight' ? 'bg-indigo-600 text-white shadow-lg' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
                    title="Quick Highlight Mode (Shift+H)"
                  >
                    <Highlighter className="size-5" />
                  </button>
                </div>

                {/* 2. Search & Lexicon */}
                <div className="flex flex-col gap-1 bg-white/90 backdrop-blur-md border border-gray-100 rounded-xl p-1.5 shadow-xl">
                  <div className="relative flex justify-center" ref={searchRef}>
                    <AnimatePresence>
                      {isSearchOpen && (
                        <motion.div 
                          initial={{ opacity: 0, scale: 0.9, x: -20 }}
                          animate={{ opacity: 1, scale: 1, x: 0 }}
                          exit={{ opacity: 0, scale: 0.9, x: -20 }}
                          className="absolute right-full mr-4 bottom-0 flex items-center gap-2 bg-white border border-gray-200 rounded-xl pl-4 pr-2 py-1 shadow-2xl h-11 w-64"
                        >
                          <input 
                            autoFocus
                            type="text" 
                            placeholder="Find..."
                            value={searchQuery}
                            onChange={(e) => handleSearch(e.target.value)}
                            className="bg-transparent border-none outline-none text-sm flex-1"
                          />
                          <div className="flex items-center gap-1 border-l border-gray-100 pl-2">
                            <span className="text-[10px] text-gray-400 font-mono w-8 text-center">
                              {searchMatches.length > 0 ? `${currentMatchIndex + 1}/${searchMatches.length}` : '0/0'}
                            </span>
                            <button onClick={prevMatch} className="p-1.5 hover:bg-gray-100 rounded text-gray-400"><ChevronUp className="size-4" /></button>
                            <button onClick={nextMatch} className="p-1.5 hover:bg-gray-100 rounded text-gray-400"><ChevronDown className="size-4" /></button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                    
                    <button 
                      onClick={() => setIsSearchOpen(!isSearchOpen)}
                      className={`p-2.5 rounded-lg transition-all flex items-center justify-center ${isSearchOpen ? 'bg-indigo-50 text-indigo-600' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
                      title="Search (Ctrl+F)"
                    >
                      <Search className="size-5" />
                    </button>
                  </div>
                  
                  <button 
                    onClick={onToggleLexicon}
                    className={`p-2.5 rounded-lg transition-all flex items-center justify-center ${showLexicon ? 'bg-indigo-600 text-white shadow-lg' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
                    title={showLexicon ? "Hide Lexicon (Shift+L)" : "Show Lexicon (Shift+L)"}
                  >
                    <BookMarked className="size-5" />
                  </button>
                </div>

                {/* 3. Zoom Controls */}
                <div className="flex flex-col gap-1 bg-white/90 backdrop-blur-md border border-gray-100 rounded-xl p-1.5 shadow-xl">
                  <button 
                    onClick={() => setZoom(prev => Math.min(prev + 10, 200))}
                    className="p-2.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all flex items-center justify-center"
                    title="Zoom In"
                  >
                    <ZoomIn className="size-5" />
                  </button>
                  <div className="text-[10px] font-bold text-gray-400 text-center">{zoom}%</div>
                  <button 
                    onClick={() => setZoom(prev => Math.max(prev - 10, 50))}
                    className="p-2.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all flex items-center justify-center"
                    title="Zoom Out"
                  >
                    <ZoomOut className="size-5" />
                  </button>
                  <button 
                    onClick={() => setZoom(100)}
                    className="p-2.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all flex items-center justify-center"
                    title="Reset Zoom"
                  >
                    <Maximize2 className="size-5" />
                  </button>
                </div>

                {/* 4. Misc & Utilities */}
                <div className="flex flex-col gap-1 bg-white/90 backdrop-blur-md border border-gray-100 rounded-xl p-1.5 shadow-xl">
                  <button 
                    onClick={() => setShowShortcuts(!showShortcuts)}
                    className={`p-2.5 rounded-lg transition-all flex items-center justify-center ${showShortcuts ? 'bg-gray-900 text-white' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
                    title="Shortcuts Help"
                  >
                    <Keyboard className="size-5" />
                  </button>
                  
                  {highlights.length > 0 && onClearHighlights && (
                    <button 
                      onClick={onClearHighlights}
                      className="p-2.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-all flex items-center justify-center"
                      title="Clear Highlights (Shift+C)"
                    >
                      <Trash2 className="size-5" />
                    </button>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </aside>

      <AnimatePresence>
        {showShortcuts && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={() => setShowShortcuts(false)}
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-xs bg-white rounded-2xl shadow-2xl overflow-hidden border border-gray-100"
            >
              <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-gray-900 text-white rounded-lg">
                    <Keyboard className="size-3.5" />
                  </div>
                  <h3 className="font-bold text-gray-900 text-sm tracking-tight">Shortcuts</h3>
                </div>
                <button 
                  onClick={() => setShowShortcuts(false)}
                  className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-all"
                >
                  <X className="size-4" />
                </button>
              </div>
              <div className="p-5 space-y-5 max-h-[60vh] overflow-y-auto custom-scrollbar">
                <div className="space-y-3">
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-1">Navigation & Tools</div>
                  <div className="grid gap-2">
                    <ShortcutRow keys={['Ctrl', 'F']} label="Find in text" />
                    <ShortcutRow keys={['Shift', 'D']} label="AI Define Mode" />
                    <ShortcutRow keys={['Shift', 'H']} label="Highlight Mode" />
                    <ShortcutRow keys={['Shift', 'L']} label="Toggle Lexicon" />
                    <ShortcutRow keys={['Shift', 'C']} label="Clear All Highlights" />
                    <ShortcutRow keys={['Shift', 'S']} label="Shortcuts Inventory" />
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-1">View & Navigation</div>
                  <div className="grid gap-2">
                    <ShortcutRow keys={['Ctrl', '+']} label="Zoom In" />
                    <ShortcutRow keys={['Ctrl', '-']} label="Zoom Out" />
                    <ShortcutRow keys={['Ctrl', '0']} label="Reset Zoom (100%)" />
                    <ShortcutRow keys={['Ctrl', 'Wheel']} label="Zoom (Mouse)" />
                    <ShortcutRow keys={['Esc']} label="Close Panels / Deselect" />
                  </div>
                </div>
              </div>
              <div className="px-6 py-4 bg-gray-50 text-center">
                <p className="text-[10px] text-gray-400 font-medium">Use these shortcuts for ultimate reading efficiency.</p>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selectionText && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 50, scale: 0.95 }}
            className="ai-assistant-panel fixed bottom-8 left-1/2 -ms-40 z-50 p-5 rounded-2xl bg-white shadow-[0_20px_50px_rgba(0,0,0,0.2)] border border-gray-200 w-[400px] select-none pointer-events-auto flex flex-col gap-4 transform -translate-x-1/2 md:translate-x-0"
            style={{ 
              left: 'calc(50% + 160px)', // Centered in the content area (Sidebar is 320px)
            }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-blue-500" />
                <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">AI Assistant</span>
              </div>
              <button 
                onClick={() => {
                  setSelectionText(null);
                  setSelectionContext(null);
                  setAiDefinition(null);
                }} 
                className="text-gray-400 hover:text-gray-600 p-1 hover:bg-gray-100 rounded-full transition-colors"
              >
                <X className="size-4" />
              </button>
            </div>
            
            <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
              <p className="text-sm font-semibold text-gray-600 line-clamp-2 italic">"{selectionText}"</p>
            </div>

            {aiDefinition ? (
              <div className="space-y-4">
                <div className="max-h-64 overflow-y-auto pr-2 custom-scrollbar">
                  <div className="flex flex-col gap-2">
                    {aiDefinition.split('\n').filter(line => line.trim()).map((line, i) => (
                      <div key={i} className={i === 0 ? "text-lg font-bold text-gray-900 border-b border-gray-100 pb-1" : "text-sm text-gray-600 leading-relaxed"}>
                        <ReactMarkdown>{line}</ReactMarkdown>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2 pt-2 border-t border-gray-100">
                  {canSave && (
                    <button 
                      onClick={() => {
                        onSaveTerm?.(selectionText, aiDefinition);
                        setSelectionText(null);
                        setAiDefinition(null);
                      }}
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 px-3 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 transition-all shadow-md active:scale-95"
                    >
                      <Save className="size-3" />
                      SAVE TO SHEET
                    </button>
                  )}
                  <button 
                    onClick={() => setAiDefinition(null)}
                    className="flex-1 py-2.5 px-3 bg-gray-100 text-gray-600 rounded-xl text-xs font-bold hover:bg-gray-200 transition-all active:scale-95 uppercase"
                  >
                    Discard
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <button 
                  onClick={handleAiDefine}
                  disabled={isDefining}
                  className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-gray-900 text-white rounded-xl text-sm font-bold hover:bg-black transition-all disabled:opacity-50 shadow-lg active:scale-[0.98]"
                >
                  {isDefining ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      <span>Processing...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="size-4 text-blue-400" />
                      <span>DEFINE WITH AI</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ShortcutRow({ keys, label }: { keys: string[], label: string }) {
  return (
    <div className="flex items-center justify-between group p-1.5 rounded-lg hover:bg-gray-50 transition-colors">
      <span className="text-sm font-medium text-gray-500 group-hover:text-gray-900 transition-colors">{label}</span>
      <div className="flex items-center gap-1">
        {keys.map((k, i) => (
          <React.Fragment key={i}>
            <kbd className="px-2 py-1 min-w-[24px] text-center bg-gray-100 border-b-2 border-gray-300 rounded text-[10px] font-bold text-gray-900 font-mono shadow-sm">
              {k}
            </kbd>
            {i < keys.length - 1 && <span className="text-[10px] text-gray-300 font-bold">+</span>}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
