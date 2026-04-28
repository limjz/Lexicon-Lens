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
  highlights?: { text: string; index: number }[];
  onSaveTerm?: (term: string, definition: string) => void;
  onHighlight?: (highlight: { text: string; index: number }) => void;
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
  const [selectionIndex, setSelectionIndex] = useState<number>(0);
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
  const abortControllerRef = useRef<AbortController | null>(null);

  // Terminate processing if selectionText changes or box is closed
  useEffect(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsDefining(false);
    }
  }, [selectionText]);

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

  const getOccurrenceIndex = useCallback((sel: Selection, targetText: string) => {
    const viewer = viewerRef.current;
    if (!viewer || !sel || sel.rangeCount === 0) return 0;

    try {
      const range = sel.getRangeAt(0);
      const startNode = range.startContainer;
      const startOffset = range.startOffset;
      
      const normalizedTarget = targetText.trim().replace(/\s+/g, ' ').toLowerCase();
      if (!normalizedTarget) return 0;

      let occurrenceCount = 0;
      const walker = document.createTreeWalker(viewer, NodeFilter.SHOW_TEXT);
      
      while (walker.nextNode()) {
        const node = walker.currentNode;
        
        // Skip UI elements like definitions or hidden text
        const parent = node.parentElement;
        if (parent && (
          parent.closest('.tooltip-content') || 
          parent.closest('.hidden') || 
          parent.closest('.ai-assistant-panel') ||
          parent.getAttribute('aria-hidden') === 'true'
        )) {
          continue;
        }

        const text = node.textContent || "";
        const normalizedText = text.replace(/\s+/g, ' ').toLowerCase();

        if (node === startNode) {
          const partBefore = text.substring(0, startOffset);
          const normalizedPartBefore = partBefore.replace(/\s+/g, ' ').toLowerCase();
          
          const escaped = normalizedTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const regex = new RegExp(escaped, 'g');
          const matchesBefore = normalizedPartBefore.match(regex);
          if (matchesBefore) {
            occurrenceCount += matchesBefore.length;
          }
          break;
        }

        const escaped = normalizedTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escaped, 'g');
        const matches = normalizedText.match(regex);
        if (matches) {
          occurrenceCount += matches.length;
        }
      }

      return occurrenceCount;
    } catch (err) {
      console.error("Error in getOccurrenceIndex:", err);
      return 0;
    }
  }, []);

  const handleSelection = (e: React.MouseEvent | React.KeyboardEvent) => {
    if (isProcessingContent) return;
    
    const target = e.target as HTMLElement;
    if (target.closest('.ai-assistant-panel')) return;

    const sel = window.getSelection();
    if (sel && sel.toString().trim().length > 0) {
      const selected = sel.toString();
      const index = getOccurrenceIndex(sel, selected);
      
      if (selectionMode === 'highlight') {
        if (onHighlight) {
            onHighlight({ text: selected.trim().replace(/\s+/g, ' '), index });
        }
        setTimeout(() => window.getSelection()?.removeAllRanges(), 200);
        return;
      }

      setSelectionText(selected.trim());
      setSelectionIndex(index);
      
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
      
      setSelectionContext(context || selected); 
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

    // Abort previous if any
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    
    setIsDefining(true);
    try {
      const contextToUse = selectionContext || text;
      const def = await defineSelection(selectionText, contextToUse, controller.signal);
      
      // If we weren't aborted and selection hasn't changed/cleared
      if (!controller.signal.aborted && selectionText) {
        setAiDefinition(def);
      }
    } catch (e: any) {
      if (e.name === 'AbortError') {
        console.log("AI Definition aborted");
        return;
      }
      const { formatGeminiError } = await import('../lib/gemini');
      setAiDefinition(formatGeminiError(e));
    } finally {
      if (abortControllerRef.current === controller) {
        setIsDefining(false);
        abortControllerRef.current = null;
      }
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
  }, [isSearchOpen, onToggleLexicon, onClearHighlights, showShortcuts, selectionText, selectionMode]); 

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

  const highlightText = useCallback((content: string, counters: Record<string, number>) => {
    if (!content || typeof content !== 'string') return content;
    
    const termsArr = Object.keys(glossary).sort((a, b) => b.length - a.length);
    const validHighlights = (highlights || []).filter(h => h && typeof h === 'object' && typeof h.text === 'string');
    const sortedHighlights = [...validHighlights].sort((a, b) => b.text.length - a.text.length);
    
    // Search tokens
    const searchTokens = searchQuery.trim() ? [searchQuery.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')] : [];
    
    // Combine all to a single regex for one-pass processing
    const allTokens = [...new Set([
      ...termsArr.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      ...sortedHighlights.map(h => h.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      ...searchTokens
    ])].sort((a, b) => b.length - a.length);

    if (allTokens.length === 0) return content;

    const regex = new RegExp(`(${allTokens.join('|')})`, 'gi');
    const parts = content.split(regex);
    const result: React.ReactNode[] = [];

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part === undefined) continue;

      if (i % 2 === 1) {
        // This is a matched token
        const lowerPart = part.toLowerCase();
        const normalizedPart = part.trim().replace(/\s+/g, ' ').toLowerCase();
        
        // Update occurrence counter for this specific string
        counters[normalizedPart] = (counters[normalizedPart] || 0) + 1;
        const currentOccurrenceIndex = counters[normalizedPart] - 1;

        // Find which type it is
        const originalTermKey = termsArr.find(t => t.toLowerCase() === lowerPart);
        const highlightMatch = sortedHighlights.find(h => {
          const hText = h.text.trim().replace(/\s+/g, ' ').toLowerCase();
          return hText === normalizedPart && h.index === currentOccurrenceIndex;
        });
        const isSearchMatch = searchQuery.trim() && lowerPart === searchQuery.trim().toLowerCase();

        if (originalTermKey) {
          const definition = glossary[originalTermKey] || "";
          result.push(
            <Tooltip key={`term-${i}-${currentOccurrenceIndex}`} term={originalTermKey} definition={definition} isHighlighted={!!highlightMatch}>
              {part}
            </Tooltip>
          );
        } else if (isSearchMatch) {
          result.push(
            <mark 
              key={`search-${i}-${currentOccurrenceIndex}`} 
              data-search-match="true"
              className="bg-green-300 text-green-900 px-0.5 rounded-sm font-medium ring-2 ring-green-500"
            >
              {part}
            </mark>
          );
        } else if (highlightMatch) {
          result.push(
            <mark 
              key={`mark-${i}-${currentOccurrenceIndex}`} 
              onClick={(e) => {
                e.stopPropagation();
                onHighlight?.({ text: part, index: currentOccurrenceIndex });
              }}
              className="bg-yellow-300 text-yellow-950 px-0.5 rounded-sm font-bold shadow-[0_0_10px_rgba(253,224,71,0.5)] ring-1 ring-yellow-500 cursor-pointer hover:bg-yellow-400 transition-colors"
            >
              {part}
            </mark>
          );
        } else {
          result.push(part);
        }
      } else {
        if (part) result.push(part);
      }
    }
    return result;
  }, [glossary, highlights, searchQuery]);

  const processChildren = useCallback((children: React.ReactNode, counters: Record<string, number>): React.ReactNode => {
    return React.Children.map(children, child => {
      if (typeof child === 'string') {
        return highlightText(child, counters);
      }
      if (React.isValidElement(child)) {
        const elementChild = child as React.ReactElement<any>;
        if (elementChild.props && elementChild.props.children) {
          return React.cloneElement(elementChild, {
            children: processChildren(elementChild.props.children, counters)
          });
        }
      }
      return child;
    });
  }, [highlightText]);

  const countersRef = useRef<Record<string, number>>({});

  // Reset counters for each fresh render pass
  countersRef.current = {};

  const components = useMemo(() => {
    const wrap = (children: any) => processChildren(children, countersRef.current);

    return {
      p: ({ children }: any) => <p className="mb-6 leading-relaxed text-gray-800 text-lg sm:text-xl font-sans selection:bg-indigo-100">{wrap(children)}</p>,
      h1: ({ children }: any) => <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 mt-12 mb-8 border-b-2 border-indigo-100 pb-2">{wrap(children)}</h1>,
      h2: ({ children }: any) => <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mt-10 mb-6">{wrap(children)}</h2>,
      h3: ({ children }: any) => <h3 className="text-xl sm:text-2xl font-bold text-gray-900 mt-8 mb-4">{wrap(children)}</h3>,
      li: ({ children }: any) => <li className="mb-3 text-gray-700 leading-relaxed text-lg">{wrap(children)}</li>,
      em: ({ children }: any) => <em className="italic text-gray-800">{wrap(children)}</em>,
      strong: ({ children }: any) => <strong className="font-bold text-gray-900">{wrap(children)}</strong>,
      td: ({ children }: any) => <td className="p-3 border border-gray-200 text-gray-800">{wrap(children)}</td>,
      th: ({ children }: any) => <th className="p-3 border border-gray-200 font-bold bg-gray-50 text-gray-900">{wrap(children)}</th>,
      a: ({ children, href }: any) => <a href={href} className="text-indigo-600 underline font-medium hover:text-indigo-800" target="_blank" rel="noopener noreferrer">{wrap(children)}</a>,
      blockquote: ({ children }: any) => (
        <blockquote className="border-l-4 border-indigo-200 pl-6 my-8 italic text-gray-600 text-xl font-serif">
          {wrap(children)}
        </blockquote>
      ),
      table: ({ children }: any) => (
        <div className="overflow-x-auto my-4">
          <table className="min-w-full border-collapse border">{wrap(children)}</table>
        </div>
      ),
    }
  }, [processChildren]);

  return (
    <div 
      onMouseUp={handleSelection}
      onKeyUp={handleSelection}
      className="flex items-start gap-8 w-full"
    >
      {/* Floating Top Search Bar */}
      <AnimatePresence>
        {isSearchOpen && (
          <motion.div 
            initial={{ opacity: 0, y: -20, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: -20, x: '-50%' }}
            className="fixed top-8 left-1/2 z-[100] flex items-center gap-3 bg-white/95 backdrop-blur-md border border-gray-200 rounded-2xl pl-5 pr-3 py-2 shadow-2xl min-w-[400px] border-b-4 border-b-blue-500"
            ref={searchRef}
          >
            <Search className="size-4 text-blue-500" />
            <input 
              autoFocus
              type="text" 
              placeholder="Find in document..."
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              className="bg-transparent border-none outline-none text-sm flex-1 font-medium text-gray-900"
            />
            <div className="flex items-center gap-1 border-l border-gray-100 pl-3">
              <span className="text-[10px] font-bold text-gray-400 font-mono min-w-[45px] text-center bg-gray-50 py-1 rounded">
                {searchMatches.length > 0 ? `${currentMatchIndex + 1}/${searchMatches.length}` : '0/0'}
              </span>
              <button 
                onClick={prevMatch} 
                className="p-2 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-600 transition-colors"
                title="Previous Match"
              >
                <ChevronUp className="size-4" />
              </button>
              <button 
                onClick={nextMatch} 
                className="p-2 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-600 transition-colors"
                title="Next Match"
              >
                <ChevronDown className="size-4" />
              </button>
              <div className="w-px h-4 bg-gray-200 mx-1" />
              <button 
                onClick={() => {
                  setIsSearchOpen(false);
                  handleSearch("");
                }} 
                className="p-2 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-red-500 transition-colors"
                title="Close Search"
              >
                <X className="size-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex-1 flex flex-col items-center justify-start min-w-0">
        {isProcessingTerms && !isProcessingContent && text && (
          <div className="w-full max-w-4xl mb-4 p-4 bg-blue-50/80 backdrop-blur-sm border border-blue-100 rounded-xl flex items-center gap-3 shadow-sm select-none">
            <Loader2 className="size-4 text-blue-500 animate-spin" />
            <span className="text-sm font-medium text-blue-700">Analyzing terminology and generating glossary... Highlights will appear automatically.</span>
          </div>
        )}
        <div 
          ref={viewerRef}
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
              <ReactMarkdown 
                key={`viewer-${revision}-${Object.keys(glossary).length}-${highlights.length}`}
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
                    className={`p-2.5 rounded-lg transition-all flex items-center justify-center ${selectionMode === 'highlight' ? 'bg-yellow-400 text-yellow-950 shadow-lg' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
                    title="Quick Highlight Mode (Shift+H)"
                  >
                    <Highlighter className="size-5" />
                  </button>
                </div>

                {/* 2. Search & Lexicon */}
                <div className="flex flex-col gap-1 bg-white/90 backdrop-blur-md border border-gray-100 rounded-xl p-1.5 shadow-xl">
                  <div className="relative flex justify-center">
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
                  {onClearHighlights && highlights.length > 0 && (
                    <button 
                      onClick={onClearHighlights}
                      className="p-2.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-all flex items-center justify-center"
                      title="Clear All Highlights (Shift+C)"
                    >
                      <Trash2 className="size-5" />
                    </button>
                  )}
                  <button 
                    onClick={() => setShowShortcuts(!showShortcuts)}
                    className={`p-2.5 rounded-lg transition-all flex items-center justify-center ${showShortcuts ? 'bg-gray-900 text-white' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
                    title="Shortcuts Help"
                  >
                    <Keyboard className="size-5" />
                  </button>
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
                      SAVE TERM
                    </button>
                  )}
                  <button 
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      if (onHighlight && selectionText) {
                        onHighlight({ text: selectionText.trim().replace(/\s+/g, ' '), index: selectionIndex });
                      }
                      setSelectionText(null);
                      setAiDefinition(null);
                      window.getSelection()?.removeAllRanges();
                    }}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 px-3 bg-yellow-400 text-yellow-950 border border-yellow-500 rounded-xl text-xs font-bold hover:bg-yellow-500 shadow-md transition-all active:scale-95 uppercase"
                  >
                    <Highlighter className="size-3" />
                    Highlight
                  </button>
                  <button 
                    onClick={() => {
                      setSelectionText(null);
                      setAiDefinition(null);
                      window.getSelection()?.removeAllRanges();
                    }}
                    className="py-2.5 px-3 bg-gray-100 text-gray-500 rounded-xl text-xs font-bold hover:bg-gray-200 transition-all active:scale-95 uppercase"
                  >
                    Cancel
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
                <button 
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    if (onHighlight && selectionText) {
                      onHighlight({ text: selectionText.trim().replace(/\s+/g, ' '), index: selectionIndex });
                    }
                    setSelectionText(null);
                    setAiDefinition(null);
                    window.getSelection()?.removeAllRanges();
                  }}
                  className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-yellow-400 text-yellow-950 border border-yellow-500 rounded-xl text-sm font-bold hover:bg-yellow-500 shadow-lg transition-all active:scale-[0.98]"
                >
                  <Highlighter className="size-4" />
                  <span>APPLY HIGHLIGHT</span>
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
