import React, { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import { Tooltip } from './Tooltip';
import { defineSelection } from '../lib/gemini';
import {
  Sparkles, Save, Loader2, X, Highlighter, Search, ChevronUp, ChevronDown,
  BookMarked, Trash2, ZoomIn, ZoomOut, Maximize2, Keyboard, Plus,
  Bold, Italic, Strikethrough, Code, List, ListOrdered, CheckSquare,
  Quote, Code2, Minus,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// ─── Highlight colour palette ───────────────────────────────────────────────

const HIGHLIGHT_COLORS = ['yellow', 'pink', 'blue', 'green', 'orange', 'red'] as const;
type HighlightColor = typeof HIGHLIGHT_COLORS[number];

const COLOR_DOT: Record<HighlightColor, string> = {
  yellow: '#fef08a',
  pink:   '#fbcfe8',
  blue:   '#bfdbfe',
  green:  '#bbf7d0',
  orange: '#fed7aa',
  red:    '#fecaca',
};

const COLOR_CLASSES: Record<HighlightColor, string> = {
  yellow: 'bg-yellow-200 text-yellow-900 ring-yellow-400 shadow-[0_0_8px_rgba(253,224,71,0.4)]',
  pink:   'bg-pink-200   text-pink-900   ring-pink-400   shadow-[0_0_8px_rgba(244,114,182,0.3)]',
  blue:   'bg-blue-200   text-blue-900   ring-blue-400   shadow-[0_0_8px_rgba(96,165,250,0.3)]',
  green:  'bg-green-200  text-green-900  ring-green-400  shadow-[0_0_8px_rgba(74,222,128,0.3)]',
  orange: 'bg-orange-200 text-orange-900 ring-orange-400 shadow-[0_0_8px_rgba(251,146,60,0.3)]',
  red:    'bg-red-200    text-red-900    ring-red-400    shadow-[0_0_8px_rgba(248,113,113,0.3)]',
};

// ─── Props ───────────────────────────────────────────────────────────────────

interface ArticleViewerProps {
  text: string;
  glossary: Record<string, string>;
  highlights?: { text: string; index: number; color?: string }[];
  onSaveTerm?: (term: string, definition: string) => void;
  onHighlight?: (highlight: { text: string; index: number; color?: string }) => void;
  onClearHighlights?: () => void;
  canSave?: boolean;
  revision?: number;
  isProcessingContent?: boolean;
  isProcessingTerms?: boolean;
  showLexicon?: boolean;
  onToggleLexicon?: () => void;
  // mode
  appMode?: 'reading' | 'edit';
  onContentChange?: (content: string) => void;
  documentId?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

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
  onToggleLexicon,
  appMode = 'reading',
  onContentChange,
  documentId,
}: ArticleViewerProps) {

  // ── Reading-mode state ─────────────────────────────────────────────────────
  const [selectionText, setSelectionText]       = useState<string | null>(null);
  const [selectionIndex, setSelectionIndex]     = useState<number>(0);
  const [selectionContext, setSelectionContext] = useState<string | null>(null);
  const [aiDefinition, setAiDefinition]         = useState<string | null>(null);
  const [isDefining, setIsDefining]             = useState(false);
  const [selectionMode, setSelectionMode]       = useState<'define' | 'highlight'>('define');
  const [highlightColor, setHighlightColor]     = useState<HighlightColor>('yellow');
  const [zoom, setZoom]                         = useState(100);
  const [showShortcuts, setShowShortcuts]       = useState(false);
  const [isToolbarOpen, setIsToolbarOpen]       = useState(false);
  const [searchQuery, setSearchQuery]           = useState('');
  const [searchMatches, setSearchMatches]       = useState<number[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(-1);
  const [isSearchOpen, setIsSearchOpen]         = useState(false);

  // ── Edit-mode state ────────────────────────────────────────────────────────
  const [editContent, setEditContent]   = useState(text);
  const [editorFontSize, setEditorFontSize] = useState(16);
  const editContentRef = useRef(editContent);
  editContentRef.current = editContent;
  const textareaRef    = useRef<HTMLTextAreaElement>(null);
  const prevDocIdRef   = useRef(documentId);
  const prevAppModeRef = useRef(appMode);

  // ── Shared refs ────────────────────────────────────────────────────────────
  const selectionModeRef = useRef(selectionMode);
  selectionModeRef.current = selectionMode;
  const onHighlightRef = useRef(onHighlight);
  onHighlightRef.current = onHighlight;
  const viewerRef  = useRef<HTMLDivElement>(null);
  const searchRef  = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // ── Sync editContent when switching documents ──────────────────────────────
  useEffect(() => {
    if (documentId !== prevDocIdRef.current) {
      prevDocIdRef.current = documentId;
      setEditContent(text);
    }
  }, [documentId, text]);

  // ── Sync editContent when switching INTO edit mode (picks up AI content) ───
  useEffect(() => {
    if (appMode === 'edit' && prevAppModeRef.current !== 'edit') {
      setEditContent(text);
    }
    prevAppModeRef.current = appMode;
  }, [appMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Abort AI on selection change ───────────────────────────────────────────
  useEffect(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsDefining(false);
    }
  }, [selectionText]);

  // ── Close search on outside click ─────────────────────────────────────────
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setIsSearchOpen(false);
      }
    };
    if (isSearchOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isSearchOpen]);

  // ── Occurrence-index walker ────────────────────────────────────────────────
  const getOccurrenceIndex = useCallback((sel: Selection, targetText: string) => {
    const viewer = viewerRef.current;
    if (!viewer || !sel || sel.rangeCount === 0) return 0;
    try {
      const range = sel.getRangeAt(0);
      const startNode = range.startContainer;
      const startOffset = range.startOffset;
      const normalizedTarget = targetText.trim().replace(/\s+/g, ' ').toLowerCase();
      if (!normalizedTarget) return 0;
      const escaped = normalizedTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const targetRegex = new RegExp(escaped, 'g');
      let occurrenceCount = 0;
      const walker = document.createTreeWalker(viewer, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const parent = node.parentElement;
        if (parent && (
          parent.closest('.tooltip-content') ||
          parent.closest('.hidden') ||
          parent.closest('.ai-assistant-panel') ||
          parent.getAttribute('aria-hidden') === 'true'
        )) continue;
        const isInsideGlossaryTerm = !!parent?.closest('[data-glossary-term]');
        const nodeText = node.textContent || '';
        if (node === startNode) {
          if (!isInsideGlossaryTerm) {
            const partBefore = nodeText.substring(0, startOffset);
            const normalizedPartBefore = partBefore.replace(/\s+/g, ' ').toLowerCase();
            targetRegex.lastIndex = 0;
            const matchesBefore = normalizedPartBefore.match(targetRegex);
            if (matchesBefore) occurrenceCount += matchesBefore.length;
          }
          break;
        }
        if (!isInsideGlossaryTerm) {
          const normalizedText = nodeText.replace(/\s+/g, ' ').toLowerCase();
          targetRegex.lastIndex = 0;
          const matches = normalizedText.match(targetRegex);
          if (matches) occurrenceCount += matches.length;
        }
      }
      return occurrenceCount;
    } catch (err) {
      console.error('Error in getOccurrenceIndex:', err);
      return 0;
    }
  }, []);

  // ── Mouse/keyboard selection (reading mode only) ───────────────────────────
  const handleSelection = (e: React.MouseEvent | React.KeyboardEvent) => {
    if (appMode === 'edit') return;
    if (isProcessingContent) return;
    const target = e.target as HTMLElement;
    if (target.closest('.ai-assistant-panel')) return;
    const sel = window.getSelection();
    if (sel && sel.toString().trim().length > 0) {
      const selected = sel.toString();
      const index = getOccurrenceIndex(sel, selected);
      if (selectionMode === 'highlight') {
        if (onHighlight) onHighlight({ text: selected.trim().replace(/\s+/g, ' '), index, color: highlightColor });
        setTimeout(() => window.getSelection()?.removeAllRanges(), 200);
        return;
      }
      setSelectionText(selected.trim());
      setSelectionIndex(index);
      let context = '';
      try {
        const node = sel.anchorNode;
        if (node) {
          const parent = node.parentElement;
          if (parent) {
            const block = parent.closest('p, li, h1, h2, h3, blockquote, td, th');
            context = (block ? block.textContent : parent.textContent) || '';
          }
        }
      } catch {}
      setSelectionContext(context || selected);
      setAiDefinition(null);
    } else {
      if (!aiDefinition) {
        setSelectionText(null);
        setSelectionContext(null);
      }
    }
  };

  // ── AI define ─────────────────────────────────────────────────────────────
  const handleAiDefine = async () => {
    if (!selectionText) return;
    if (abortControllerRef.current) abortControllerRef.current.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsDefining(true);
    try {
      const contextToUse = selectionContext || text;
      const def = await defineSelection(selectionText, contextToUse, controller.signal);
      if (!controller.signal.aborted && selectionText) setAiDefinition(def);
    } catch (e: any) {
      if (e.name === 'AbortError') return;
      const { formatGeminiError } = await import('../lib/gemini');
      setAiDefinition(formatGeminiError(e));
    } finally {
      if (abortControllerRef.current === controller) {
        setIsDefining(false);
        abortControllerRef.current = null;
      }
    }
  };

  // ── Keyboard shortcuts (reading mode) ─────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Zoom shortcuts — active in BOTH modes (Shift+scroll / Shift++ / Shift+- / Shift+0)
      if (e.shiftKey && (e.key === '+' || e.code === 'Equal')) {
        e.preventDefault();
        setZoom(prev => Math.min(prev + 10, 200));
      }
      if (e.shiftKey && (e.key === '-' || e.code === 'Minus')) {
        e.preventDefault();
        setZoom(prev => Math.max(prev - 10, 50));
      }
      if (e.shiftKey && (e.key === '0' || e.code === 'Digit0')) {
        e.preventDefault();
        setZoom(100);
      }

      // In edit mode only allow Ctrl+F (beyond zoom above)
      if (appMode === 'edit') {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
          e.preventDefault();
          setIsSearchOpen(prev => !prev);
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setIsSearchOpen(prev => !prev);
      }
      if (e.shiftKey && e.key.toLowerCase() === 'd') setSelectionMode('define');
      if (e.shiftKey && e.key.toLowerCase() === 'f') setSelectionMode('highlight');
      if (e.shiftKey && e.key.toLowerCase() === 'l') { if (onToggleLexicon) onToggleLexicon(); }
      if (e.shiftKey && e.key.toLowerCase() === 'c') { if (onClearHighlights) onClearHighlights(); }
      if (e.shiftKey && e.key.toLowerCase() === 's') setShowShortcuts(prev => !prev);
      if (e.key === 'Escape') {
        if (isSearchOpen) { setIsSearchOpen(false); handleSearch(''); }
        if (showShortcuts) setShowShortcuts(false);
        if (selectionText) { setSelectionText(null); setSelectionContext(null); setAiDefinition(null); }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [appMode, isSearchOpen, onToggleLexicon, onClearHighlights, showShortcuts, selectionText, selectionMode]);

  // ── Ctrl+Wheel zoom ────────────────────────────────────────────────────────
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const handleWheel = (e: WheelEvent) => {
      if (e.shiftKey) {
        e.preventDefault();
        setZoom(prev => Math.min(Math.max(e.deltaY < 0 ? prev + 5 : prev - 5, 50), 300));
      }
    };
    viewer.addEventListener('wheel', handleWheel, { passive: false });
    return () => viewer.removeEventListener('wheel', handleWheel);
  }, []);

  // ── Search ─────────────────────────────────────────────────────────────────
  const handleSearch = (query: string) => {
    setSearchQuery(query);
    if (!query.trim()) { setSearchMatches([]); setCurrentMatchIndex(-1); return; }
    const matches: number[] = [];
    const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    let match;
    while ((match = regex.exec(text)) !== null) matches.push(match.index);
    setSearchMatches(matches);
    if (matches.length > 0) { setCurrentMatchIndex(0); scrollToMatch(0); }
    else setCurrentMatchIndex(-1);
  };

  const scrollToMatch = (index: number) => {
    setTimeout(() => {
      const els = viewerRef.current?.querySelectorAll('[data-search-match="true"]');
      if (els && els[index]) {
        els[index].scrollIntoView({ behavior: 'smooth', block: 'center' });
        (els[index] as HTMLElement).classList.add('animate-pulse', 'ring-4', 'ring-green-400');
        setTimeout(() => (els[index] as HTMLElement).classList.remove('animate-pulse', 'ring-4', 'ring-green-400'), 2000);
      }
    }, 100);
  };

  const nextMatch = () => {
    if (!searchMatches.length) return;
    const next = (currentMatchIndex + 1) % searchMatches.length;
    setCurrentMatchIndex(next);
    scrollToMatch(next);
  };

  const prevMatch = () => {
    if (!searchMatches.length) return;
    const prev = (currentMatchIndex - 1 + searchMatches.length) % searchMatches.length;
    setCurrentMatchIndex(prev);
    scrollToMatch(prev);
  };

  // ── Highlight renderer (reading mode) ─────────────────────────────────────
  const highlightText = useCallback((content: string, counters: Record<string, number>) => {
    if (!content || typeof content !== 'string') return content;
    const termsArr = Object.keys(glossary).sort((a, b) => b.length - a.length);
    const validHighlights = (highlights || []).filter(h => h && typeof h === 'object' && typeof h.text === 'string');
    const sortedHighlights = [...validHighlights].sort((a, b) => b.text.length - a.text.length);
    const searchTokens = searchQuery.trim() ? [searchQuery.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')] : [];
    const allTokens = [...new Set([
      ...termsArr.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      ...sortedHighlights.map(h => h.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      ...searchTokens,
    ])].sort((a, b) => b.length - a.length);
    if (allTokens.length === 0) return content;
    const regex = new RegExp(`(${allTokens.join('|')})`, 'gi');
    const parts = content.split(regex);
    const result: React.ReactNode[] = [];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part === undefined) continue;
      if (i % 2 === 1) {
        const lowerPart = part.toLowerCase();
        const normalizedPart = part.trim().replace(/\s+/g, ' ').toLowerCase();
        counters[normalizedPart] = (counters[normalizedPart] || 0) + 1;
        const currentOccurrenceIndex = counters[normalizedPart] - 1;
        const originalTermKey = termsArr.find(t => t.toLowerCase() === lowerPart);
        const highlightMatch = sortedHighlights.find(h => {
          const hText = h.text.trim().replace(/\s+/g, ' ').toLowerCase();
          return hText === normalizedPart && h.index === currentOccurrenceIndex;
        });
        const isSearchMatch = searchQuery.trim() && lowerPart === searchQuery.trim().toLowerCase();
        if (originalTermKey) {
          result.push(
            <Tooltip key={`term-${i}-${currentOccurrenceIndex}`} term={originalTermKey} definition={glossary[originalTermKey] || ''} isHighlighted={!!highlightMatch}>
              {part}
            </Tooltip>
          );
        } else if (isSearchMatch) {
          result.push(
            <mark key={`search-${i}-${currentOccurrenceIndex}`} data-search-match="true" className="bg-green-300 text-green-900 px-0.5 rounded-sm font-medium ring-2 ring-green-500">
              {part}
            </mark>
          );
        } else if (highlightMatch) {
          const colorKey = (highlightMatch.color || 'yellow') as HighlightColor;
          const colorCls = COLOR_CLASSES[colorKey] ?? COLOR_CLASSES.yellow;
          result.push(
            <mark
              key={`mark-${i}-${currentOccurrenceIndex}`}
              onClick={(e) => {
                if (selectionModeRef.current !== 'highlight') return;
                e.stopPropagation();
                onHighlightRef.current?.({ text: part, index: currentOccurrenceIndex, color: highlightMatch.color });
              }}
              className={`${colorCls} px-0.5 rounded-sm font-bold ring-1 transition-opacity`}
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
      if (typeof child === 'string') return highlightText(child, counters);
      if (React.isValidElement(child)) {
        const el = child as React.ReactElement<any>;
        if (el.props?.children) return React.cloneElement(el, { children: processChildren(el.props.children, counters) });
      }
      return child;
    });
  }, [highlightText]);

  const countersRef = useRef<Record<string, number>>({});
  countersRef.current = {};

  const components = useMemo(() => {
    const wrap = (children: any) => processChildren(children, countersRef.current);
    return {
      p:          ({ children }: any) => <p className="mb-6 leading-relaxed text-gray-800 text-lg sm:text-xl font-sans selection:bg-indigo-100">{wrap(children)}</p>,
      h1:         ({ children }: any) => <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 mt-12 mb-8 border-b-2 border-indigo-100 pb-2">{wrap(children)}</h1>,
      h2:         ({ children }: any) => <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mt-10 mb-6">{wrap(children)}</h2>,
      h3:         ({ children }: any) => <h3 className="text-xl sm:text-2xl font-bold text-gray-900 mt-8 mb-4">{wrap(children)}</h3>,
      li:         ({ children }: any) => <li className="mb-3 text-gray-700 leading-relaxed text-lg">{wrap(children)}</li>,
      em:         ({ children }: any) => <em className="italic text-gray-800">{wrap(children)}</em>,
      strong:     ({ children }: any) => <strong className="font-bold text-gray-900">{wrap(children)}</strong>,
      td:         ({ children }: any) => <td className="p-3 border border-gray-200 text-gray-800">{wrap(children)}</td>,
      th:         ({ children }: any) => <th className="p-3 border border-gray-200 font-bold bg-gray-50 text-gray-900">{wrap(children)}</th>,
      a:          ({ children, href }: any) => <a href={href} className="text-indigo-600 underline font-medium hover:text-indigo-800" target="_blank" rel="noopener noreferrer">{wrap(children)}</a>,
      blockquote: ({ children }: any) => (
        <blockquote className="border-l-4 border-indigo-200 pl-6 my-8 italic text-gray-600 text-xl font-serif">{wrap(children)}</blockquote>
      ),
      table: ({ children }: any) => (
        <div className="overflow-x-auto my-4"><table className="min-w-full border-collapse border">{wrap(children)}</table></div>
      ),
    };
  }, [processChildren]);

  // ── Edit-mode: applyFormat ─────────────────────────────────────────────────
  const applyFormat = useCallback((type: string) => {
    const ta = textareaRef.current;
    if (!ta) return;

    const start   = ta.selectionStart;
    const end     = ta.selectionEnd;
    const val     = editContentRef.current;
    const selected = val.substring(start, end);
    const before   = val.substring(0, start);
    const after    = val.substring(end);

    const lineStart  = before.lastIndexOf('\n') + 1;
    const lineEndIdx = val.indexOf('\n', end);
    const lineEnd    = lineEndIdx === -1 ? val.length : lineEndIdx;

    let newVal   = val;
    let newStart = start;
    let newEnd   = end;

    // Wrap selection with prefix/suffix (inline formatting)
    const wrap = (p: string, s?: string) => {
      const suf = s ?? p;
      const placeholder = 'text';
      if (selected.startsWith(p) && selected.endsWith(suf) && selected.length > p.length + suf.length - 1) {
        // Toggle off
        const inner = selected.slice(p.length, selected.length - suf.length);
        newVal   = before + inner + after;
        newEnd   = start + inner.length;
        newStart = start;
      } else if (!selected && before.endsWith(p) && after.startsWith(suf)) {
        // Cursor inside empty markers → remove them
        newVal   = before.slice(0, -p.length) + after.slice(suf.length);
        newStart = newEnd = start - p.length;
      } else {
        const inner = selected || placeholder;
        newVal   = before + p + inner + suf + after;
        newStart = start + p.length;
        newEnd   = start + p.length + inner.length;
      }
    };

    // Toggle a line-level prefix for all selected lines
    const toggleLinePrefix = (prefix: string) => {
      const preContent  = val.substring(0, lineStart);
      const block       = val.substring(lineStart, lineEnd);
      const postContent = val.substring(lineEnd);
      const lines       = block.split('\n');
      const allHave     = lines.every(l => l.trim() === '' || l.startsWith(prefix));
      const newLines    = allHave
        ? lines.map(l => l.startsWith(prefix) ? l.slice(prefix.length) : l)
        : lines.map(l => l.trim() === '' ? l : prefix + l);
      newVal   = preContent + newLines.join('\n') + postContent;
      newStart = lineStart;
      newEnd   = lineStart + newLines.join('\n').length;
    };

    switch (type) {
      case 'bold':          wrap('**');         break;
      case 'italic':        wrap('*');          break;
      case 'strikethrough': wrap('~~');         break;
      case 'code':          wrap('`');          break;
      case 'h1':            toggleLinePrefix('# ');     break;
      case 'h2':            toggleLinePrefix('## ');    break;
      case 'h3':            toggleLinePrefix('### ');   break;
      case 'ul':            toggleLinePrefix('- ');     break;
      case 'task':          toggleLinePrefix('- [ ] '); break;
      case 'quote':         toggleLinePrefix('> ');     break;
      case 'ol': {
        const preContent  = val.substring(0, lineStart);
        const block       = val.substring(lineStart, lineEnd);
        const postContent = val.substring(lineEnd);
        const lines       = block.split('\n');
        const hasOl       = lines.every(l => /^\d+\. /.test(l) || l.trim() === '');
        const newLines    = hasOl
          ? lines.map(l => l.replace(/^\d+\. /, ''))
          : lines.map((l, i) => l.trim() === '' ? l : `${i + 1}. ${l}`);
        newVal   = preContent + newLines.join('\n') + postContent;
        newStart = lineStart;
        newEnd   = lineStart + newLines.join('\n').length;
        break;
      }
      case 'codeblock': {
        const content = selected || 'your code here';
        newVal   = before + '```\n' + content + '\n```' + after;
        newStart = start + 4;
        newEnd   = start + 4 + content.length;
        break;
      }
      case 'hr': {
        newVal   = before + '\n\n---\n\n' + after;
        newStart = newEnd = start + 6;
        break;
      }
    }

    setEditContent(newVal);
    onContentChange?.(newVal);

    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = newStart;
      ta.selectionEnd   = newEnd;
    });
  }, [onContentChange]);

  // ── Edit-mode: keyboard shortcuts inside the textarea ─────────────────────
  const handleEditorKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl+B / Ctrl+I
    if (e.ctrlKey || e.metaKey) {
      if (e.key.toLowerCase() === 'b') { e.preventDefault(); applyFormat('bold');   return; }
      if (e.key.toLowerCase() === 'i') { e.preventDefault(); applyFormat('italic'); return; }
    }

    // Tab → 2 spaces
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta  = e.currentTarget;
      const s   = ta.selectionStart;
      const val = editContentRef.current;
      const newVal = val.substring(0, s) + '  ' + val.substring(ta.selectionEnd);
      setEditContent(newVal);
      onContentChange?.(newVal);
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = s + 2; });
      return;
    }

    // Smart Enter: continue list prefixes
    if (e.key === 'Enter') {
      const ta  = e.currentTarget;
      const pos = ta.selectionStart;
      const val = editContentRef.current;
      const lineStart   = val.lastIndexOf('\n', pos - 1) + 1;
      const currentLine = val.substring(lineStart, pos);
      const listMatch   = currentLine.match(/^(\s*)([-*+]|\d+\.) (\[[ x]\] )?/);
      if (listMatch) {
        e.preventDefault();
        const fullPrefix  = listMatch[0];
        const lineContent = currentLine.substring(fullPrefix.length);
        if (lineContent.trim() === '') {
          // Empty list item → exit list
          const newVal = val.substring(0, lineStart) + '\n' + val.substring(pos);
          setEditContent(newVal);
          onContentChange?.(newVal);
          requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = lineStart + 1; });
        } else {
          // Continue list; increment ordered number
          let nextPrefix = fullPrefix;
          const olMatch  = currentLine.match(/^(\d+)\. /);
          if (olMatch) nextPrefix = `${parseInt(olMatch[1]) + 1}. `;
          const newVal = val.substring(0, pos) + '\n' + nextPrefix + val.substring(pos);
          setEditContent(newVal);
          onContentChange?.(newVal);
          requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = pos + 1 + nextPrefix.length; });
        }
      }
    }
  }, [applyFormat, onContentChange]);

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div
      onMouseUp={handleSelection}
      onKeyUp={handleSelection}
      className="flex items-start gap-8 w-full"
    >
      {/* ── Floating search bar ── */}
      <AnimatePresence>
        {isSearchOpen && (
          <motion.div
            initial={{ opacity: 0, y: -20, x: '-50%' }}
            animate={{ opacity: 1, y: 0,   x: '-50%' }}
            exit={{   opacity: 0, y: -20,  x: '-50%' }}
            className="fixed top-8 left-1/2 z-[100] flex items-center gap-3 bg-white/95 backdrop-blur-md border border-gray-200 rounded-2xl pl-5 pr-3 py-2 shadow-2xl min-w-[400px] border-b-4 border-b-blue-500"
            ref={searchRef}
          >
            <Search className="size-4 text-blue-500" />
            <input
              autoFocus
              type="text"
              placeholder="Find in document..."
              value={searchQuery}
              onChange={e => handleSearch(e.target.value)}
              className="bg-transparent border-none outline-none text-sm flex-1 font-medium text-gray-900"
            />
            <div className="flex items-center gap-1 border-l border-gray-100 pl-3">
              <span className="text-[10px] font-bold text-gray-400 font-mono min-w-[45px] text-center bg-gray-50 py-1 rounded">
                {searchMatches.length > 0 ? `${currentMatchIndex + 1}/${searchMatches.length}` : '0/0'}
              </span>
              <button onClick={prevMatch} className="p-2 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-600 transition-colors"><ChevronUp className="size-4" /></button>
              <button onClick={nextMatch} className="p-2 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-600 transition-colors"><ChevronDown className="size-4" /></button>
              <div className="w-px h-4 bg-gray-200 mx-1" />
              <button onClick={() => { setIsSearchOpen(false); handleSearch(''); }} className="p-2 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-red-500 transition-colors"><X className="size-4" /></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ════════════════════════════════════════════════════════════════════
          EDIT MODE
          ════════════════════════════════════════════════════════════════════ */}
      {appMode === 'edit' && (
        <div className="flex-1 flex flex-col items-center justify-start min-w-0">

          {/* ── Word-like toolbar ── */}
          <div className="w-full max-w-4xl sticky top-0 z-10 mb-4 bg-white border border-gray-200 rounded-2xl shadow-md overflow-hidden">

            {/* Toolbar row */}
            <div className="flex flex-wrap items-center gap-1 px-3 py-2 bg-gray-50/80 border-b border-gray-100">

              {/* Headings */}
              <div className="flex items-center gap-0.5">
                <TBtn onClick={() => applyFormat('h1')} title="Heading 1 (# …)">H1</TBtn>
                <TBtn onClick={() => applyFormat('h2')} title="Heading 2 (## …)">H2</TBtn>
                <TBtn onClick={() => applyFormat('h3')} title="Heading 3 (### …)">H3</TBtn>
              </div>

              <TDiv />

              {/* Inline styles */}
              <div className="flex items-center gap-0.5">
                <TBtn onClick={() => applyFormat('bold')}          title="Bold (Ctrl+B)"><Bold className="size-3.5" /></TBtn>
                <TBtn onClick={() => applyFormat('italic')}        title="Italic (Ctrl+I)"><Italic className="size-3.5" /></TBtn>
                <TBtn onClick={() => applyFormat('strikethrough')} title="Strikethrough"><Strikethrough className="size-3.5" /></TBtn>
                <TBtn onClick={() => applyFormat('code')}          title="Inline Code"><Code className="size-3.5" /></TBtn>
              </div>

              <TDiv />

              {/* Lists */}
              <div className="flex items-center gap-0.5">
                <TBtn onClick={() => applyFormat('ul')}   title="Bullet List"><List className="size-3.5" /></TBtn>
                <TBtn onClick={() => applyFormat('ol')}   title="Numbered List"><ListOrdered className="size-3.5" /></TBtn>
                <TBtn onClick={() => applyFormat('task')} title="Task List"><CheckSquare className="size-3.5" /></TBtn>
              </div>

              <TDiv />

              {/* Blocks */}
              <div className="flex items-center gap-0.5">
                <TBtn onClick={() => applyFormat('quote')}     title="Blockquote"><Quote className="size-3.5" /></TBtn>
                <TBtn onClick={() => applyFormat('codeblock')} title="Code Block"><Code2 className="size-3.5" /></TBtn>
                <TBtn onClick={() => applyFormat('hr')}        title="Horizontal Rule"><Minus className="size-3.5" /></TBtn>
              </div>

              <TDiv />

              {/* Font size */}
              <div className="flex items-center gap-1 ml-auto">
                <button
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => setEditorFontSize(s => Math.max(s - 1, 10))}
                  className="w-6 h-6 flex items-center justify-center rounded text-xs font-bold text-gray-500 hover:bg-gray-200 transition-all"
                  title="Decrease font size"
                >A−</button>
                <span className="text-[11px] font-mono text-gray-400 min-w-[26px] text-center">{editorFontSize}</span>
                <button
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => setEditorFontSize(s => Math.min(s + 1, 32))}
                  className="w-6 h-6 flex items-center justify-center rounded text-xs font-bold text-gray-500 hover:bg-gray-200 transition-all"
                  title="Increase font size"
                >A+</button>
              </div>
            </div>

            {/* Status bar */}
            <div className="flex items-center justify-between px-4 py-1.5 text-[10px] text-gray-400 bg-white">
              <span>{editContent.split('\n').length} lines · {editContent.length} chars</span>
              <span className="flex items-center gap-1 text-emerald-600 font-semibold">
                <span className="size-1.5 rounded-full bg-emerald-500 inline-block" />
                Auto-saved
              </span>
            </div>
          </div>

          {/* ── Editor textarea ── */}
          <textarea
            ref={textareaRef}
            value={editContent}
            onChange={e => {
              setEditContent(e.target.value);
              onContentChange?.(e.target.value);
            }}
            onKeyDown={handleEditorKeyDown}
            placeholder="Start writing or paste content here…&#10;&#10;Tip: Select text and use the toolbar above to format it.&#10;Keyboard shortcuts: Ctrl+B (bold), Ctrl+I (italic), Tab (indent), Enter (continue list)"
            spellCheck
            style={{ fontSize: `${editorFontSize}px`, lineHeight: '1.8' }}
            className="w-full max-w-4xl rounded-2xl bg-white px-10 py-10 shadow-sm border border-gray-100 min-h-[600px] text-gray-800 font-sans resize-none outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300 transition-all"
          />
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          READING MODE
          ════════════════════════════════════════════════════════════════════ */}
      {appMode === 'reading' && (
        <div className="flex-1 flex flex-col items-center justify-start min-w-0">
          {isProcessingTerms && !isProcessingContent && text && (
            <div className="w-full max-w-4xl mb-4 p-4 bg-blue-50/80 backdrop-blur-sm border border-blue-100 rounded-xl flex items-center gap-3 shadow-sm select-none">
              <Loader2 className="size-4 text-blue-500 animate-spin" />
              <span className="text-sm font-medium text-blue-700">Analyzing terminology and generating glossary… Highlights will appear automatically.</span>
            </div>
          )}
          <div
            ref={viewerRef}
            id="article-viewer"
            style={{ zoom: `${zoom}%` }}
            className={`prose prose-blue prose-sm md:prose-base w-full max-w-4xl rounded-2xl bg-white p-8 md:p-12 shadow-sm border border-gray-100 min-h-[600px] leading-relaxed text-gray-800 transition-all ${
              isProcessingContent ? 'opacity-90 select-none cursor-wait' : ''
            } ${selectionMode === 'highlight' ? '[&_mark]:cursor-pointer [&_mark]:hover:opacity-75' : '[&_mark]:cursor-text'}`}
          >
            {isProcessingContent ? (
              <div className="flex flex-col items-center justify-center py-24 space-y-4">
                <Loader2 className="size-12 text-blue-500 animate-spin" />
                <div className="text-center">
                  <h3 className="text-lg font-bold text-gray-900">Extracting content with AI…</h3>
                  <p className="text-sm text-gray-500">Gemini is analyzing your document. This usually takes 10–30 seconds.</p>
                </div>
              </div>
            ) : !text ? (
              <p className="text-gray-400 italic text-center py-20">Select a document from the sidebar or paste text to begin…</p>
            ) : (
              <ReactMarkdown
                key={`viewer-${revision}-${Object.keys(glossary).length}-${highlights.length}`}
                remarkPlugins={[remarkGfm]}
                components={components}
              >
                {text}
              </ReactMarkdown>
            )}
          </div>
        </div>
      )}

      {/* ── Floating toolbar (reading mode only) ── */}
      {appMode === 'reading' && (
        <aside className="fixed bottom-8 right-8 z-40 flex flex-col-reverse items-end pointer-events-none">
          <div className="flex flex-col-reverse gap-3 items-center pointer-events-auto">
            <button
              onClick={() => setIsToolbarOpen(!isToolbarOpen)}
              className={`size-14 rounded-full flex items-center justify-center shadow-2xl transition-all pointer-events-auto bg-gray-900 border border-gray-800 text-white ${
                isToolbarOpen ? 'rotate-45' : 'hover:scale-110 active:scale-95'
              }`}
              title={isToolbarOpen ? 'Close Tools' : 'Open Document Tools'}
            >
              <Plus className="size-6" />
            </button>

            <AnimatePresence>
              {isToolbarOpen && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.8, y: 20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{   opacity: 0, scale: 0.8, y: 20 }}
                  className="flex flex-col-reverse gap-2 items-center mb-2"
                >
                  {/* AI + Highlight tools */}
                  <div className="flex flex-col gap-1 bg-white/90 backdrop-blur-md border border-gray-100 rounded-xl p-1.5 shadow-xl">
                    <button onClick={() => setSelectionMode('define')}
                      className={`p-2.5 rounded-lg transition-all flex items-center justify-center ${selectionMode === 'define' ? 'bg-indigo-600 text-white shadow-lg' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
                      title="AI Define Mode (Shift+D)">
                      <Sparkles className="size-5" />
                    </button>
                    <button onClick={() => setSelectionMode('highlight')}
                      className={`p-2.5 rounded-lg transition-all flex items-center justify-center ${selectionMode === 'highlight' ? 'shadow-lg ring-2 ring-gray-300' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
                      style={selectionMode === 'highlight' ? { backgroundColor: COLOR_DOT[highlightColor] } : {}}
                      title="Quick Highlight Mode (Shift+F)">
                      <Highlighter className="size-5" style={selectionMode === 'highlight' ? { color: '#78350f' } : {}} />
                    </button>
                  </div>

                  {/* Colour picker */}
                  {selectionMode === 'highlight' && (
                    <div className="flex flex-col gap-1.5 bg-white/90 backdrop-blur-md border border-gray-100 rounded-xl p-2 shadow-xl items-center">
                      {HIGHLIGHT_COLORS.map(color => (
                        <button key={color} onClick={() => setHighlightColor(color)} title={color.charAt(0).toUpperCase() + color.slice(1)}
                          className={`size-6 rounded-full transition-all ${highlightColor === color ? 'ring-2 ring-offset-1 ring-gray-700 scale-110' : 'hover:scale-110 ring-1 ring-gray-200'}`}
                          style={{ backgroundColor: COLOR_DOT[color] }}
                        />
                      ))}
                    </div>
                  )}

                  {/* Search & Lexicon */}
                  <div className="flex flex-col gap-1 bg-white/90 backdrop-blur-md border border-gray-100 rounded-xl p-1.5 shadow-xl">
                    <button onClick={() => setIsSearchOpen(!isSearchOpen)}
                      className={`p-2.5 rounded-lg transition-all flex items-center justify-center ${isSearchOpen ? 'bg-indigo-50 text-indigo-600' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
                      title="Search (Ctrl+F)">
                      <Search className="size-5" />
                    </button>
                    <button onClick={onToggleLexicon}
                      className={`p-2.5 rounded-lg transition-all flex items-center justify-center ${showLexicon ? 'bg-indigo-600 text-white shadow-lg' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
                      title={showLexicon ? 'Hide Lexicon (Shift+L)' : 'Show Lexicon (Shift+L)'}>
                      <BookMarked className="size-5" />
                    </button>
                  </div>

                  {/* Zoom */}
                  <div className="flex flex-col gap-1 bg-white/90 backdrop-blur-md border border-gray-100 rounded-xl p-1.5 shadow-xl">
                    <button onClick={() => setZoom(prev => Math.min(prev + 10, 200))} className="p-2.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all flex items-center justify-center" title="Zoom In (Shift++)"><ZoomIn className="size-5" /></button>
                    <div className="text-[10px] font-bold text-gray-400 text-center">{zoom}%</div>
                    <button onClick={() => setZoom(prev => Math.max(prev - 10, 50))} className="p-2.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all flex items-center justify-center" title="Zoom Out (Shift+-)"><ZoomOut className="size-5" /></button>
                    <button onClick={() => setZoom(100)} className="p-2.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all flex items-center justify-center" title="Reset Zoom (Shift+0)"><Maximize2 className="size-5" /></button>
                  </div>

                  {/* Misc */}
                  <div className="flex flex-col gap-1 bg-white/90 backdrop-blur-md border border-gray-100 rounded-xl p-1.5 shadow-xl">
                    {onClearHighlights && highlights.length > 0 && (
                      <button onClick={onClearHighlights} className="p-2.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-all flex items-center justify-center" title="Clear All Highlights (Shift+C)">
                        <Trash2 className="size-5" />
                      </button>
                    )}
                    <button onClick={() => setShowShortcuts(!showShortcuts)}
                      className={`p-2.5 rounded-lg transition-all flex items-center justify-center ${showShortcuts ? 'bg-gray-900 text-white' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
                      title="Shortcuts Help">
                      <Keyboard className="size-5" />
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </aside>
      )}

      {/* ── Shortcuts panel ── */}
      <AnimatePresence>
        {showShortcuts && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={() => setShowShortcuts(false)}
            />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-xs bg-white rounded-2xl shadow-2xl overflow-hidden border border-gray-100"
            >
              <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-gray-900 text-white rounded-lg"><Keyboard className="size-3.5" /></div>
                  <h3 className="font-bold text-gray-900 text-sm tracking-tight">Shortcuts</h3>
                </div>
                <button onClick={() => setShowShortcuts(false)} className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-all"><X className="size-4" /></button>
              </div>
              <div className="p-5 space-y-5 max-h-[60vh] overflow-y-auto custom-scrollbar">
                <div className="space-y-3">
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-1">Reading — Selection Modes</div>
                  <div className="grid gap-2">
                    <ShortcutRow keys={['Shift', 'D']} label="AI Define Mode" />
                    <ShortcutRow keys={['Shift', 'F']} label="Highlight Mode" />
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-1">Reading — Navigation & Tools</div>
                  <div className="grid gap-2">
                    <ShortcutRow keys={['Ctrl', 'F']} label="Find in text" />
                    <ShortcutRow keys={['Shift', 'L']} label="Toggle Lexicon" />
                    <ShortcutRow keys={['Shift', 'C']} label="Clear All Highlights" />
                    <ShortcutRow keys={['Shift', 'S']} label="Shortcuts Inventory" />
                    <ShortcutRow keys={['Esc']} label="Close Panels / Deselect" />
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-1">Editing — Shortcuts</div>
                  <div className="grid gap-2">
                    <ShortcutRow keys={['Ctrl', 'B']} label="Bold" />
                    <ShortcutRow keys={['Ctrl', 'I']} label="Italic" />
                    <ShortcutRow keys={['Tab']} label="Indent (2 spaces)" />
                    <ShortcutRow keys={['Enter']} label="Continue list" />
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-1">View & Zoom (Both Modes)</div>
                  <div className="grid gap-2">
                    <ShortcutRow keys={['Shift', '+']} label="Zoom In" />
                    <ShortcutRow keys={['Shift', '-']} label="Zoom Out" />
                    <ShortcutRow keys={['Shift', '0']} label="Reset Zoom (100%)" />
                    <ShortcutRow keys={['Shift', 'Scroll']} label="Zoom (Mouse)" />
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

      {/* ── AI assistant panel (reading mode only) ── */}
      <AnimatePresence>
        {selectionText && appMode === 'reading' && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0,  scale: 1   }}
            exit={{   opacity: 0, y: 50, scale: 0.95 }}
            className="ai-assistant-panel fixed bottom-8 left-1/2 -ms-40 z-50 p-5 rounded-2xl bg-white shadow-[0_20px_50px_rgba(0,0,0,0.2)] border border-gray-200 w-[400px] select-none pointer-events-auto flex flex-col gap-4 transform -translate-x-1/2 md:translate-x-0"
            style={{ left: 'calc(50% + 160px)' }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-blue-500" />
                <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">AI Assistant</span>
              </div>
              <button onClick={() => { setSelectionText(null); setSelectionContext(null); setAiDefinition(null); }}
                className="text-gray-400 hover:text-gray-600 p-1 hover:bg-gray-100 rounded-full transition-colors">
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
                      <div key={i} className={i === 0 ? 'text-lg font-bold text-gray-900 border-b border-gray-100 pb-1' : 'text-sm text-gray-600 leading-relaxed'}>
                        <ReactMarkdown>{line}</ReactMarkdown>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2 pt-2 border-t border-gray-100">
                  {canSave && (
                    <button onClick={() => { onSaveTerm?.(selectionText, aiDefinition); setSelectionText(null); setAiDefinition(null); }}
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 px-3 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 transition-all shadow-md active:scale-95">
                      <Save className="size-3" />SAVE TERM
                    </button>
                  )}
                  <button
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => {
                      if (onHighlight && selectionText) onHighlight({ text: selectionText.trim().replace(/\s+/g, ' '), index: selectionIndex, color: highlightColor });
                      setSelectionText(null); setAiDefinition(null);
                      window.getSelection()?.removeAllRanges();
                    }}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 px-3 bg-yellow-400 text-yellow-950 border border-yellow-500 rounded-xl text-xs font-bold hover:bg-yellow-500 shadow-md transition-all active:scale-95 uppercase">
                    <Highlighter className="size-3" />Highlight
                  </button>
                  <button onClick={() => { setSelectionText(null); setAiDefinition(null); window.getSelection()?.removeAllRanges(); }}
                    className="py-2.5 px-3 bg-gray-100 text-gray-500 rounded-xl text-xs font-bold hover:bg-gray-200 transition-all active:scale-95 uppercase">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={handleAiDefine} disabled={isDefining}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-gray-900 text-white rounded-xl text-sm font-bold hover:bg-black transition-all disabled:opacity-50 shadow-lg active:scale-[0.98]">
                {isDefining ? <><Loader2 className="size-4 animate-spin" /><span>Processing…</span></> : <><Sparkles className="size-4 text-blue-400" /><span>DEFINE WITH AI</span></>}
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Helper components ────────────────────────────────────────────────────────

function ShortcutRow({ keys, label }: { keys: string[], label: string }) {
  return (
    <div className="flex items-center justify-between group p-1.5 rounded-lg hover:bg-gray-50 transition-colors">
      <span className="text-sm font-medium text-gray-500 group-hover:text-gray-900 transition-colors">{label}</span>
      <div className="flex items-center gap-1">
        {keys.map((k, i) => (
          <React.Fragment key={i}>
            <kbd className="px-2 py-1 min-w-[24px] text-center bg-gray-100 border-b-2 border-gray-300 rounded text-[10px] font-bold text-gray-900 font-mono shadow-sm">{k}</kbd>
            {i < keys.length - 1 && <span className="text-[10px] text-gray-300 font-bold">+</span>}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

/** Toolbar button — uses onMouseDown+preventDefault to keep textarea focus */
function TBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      onMouseDown={e => { e.preventDefault(); onClick(); }}
      title={title}
      className="px-2 py-1.5 rounded-lg text-xs font-semibold transition-all min-w-[28px] h-7 flex items-center justify-center text-gray-600 hover:bg-gray-200 hover:text-gray-900 active:bg-gray-300"
    >
      {children}
    </button>
  );
}

/** Vertical divider between toolbar groups */
function TDiv() {
  return <div className="w-px h-5 bg-gray-200 mx-1 shrink-0" />;
}
