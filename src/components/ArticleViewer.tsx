import React, { useMemo, useState, useRef, useCallback } from 'react';
import { Tooltip } from './Tooltip';
import { defineSelection } from '../lib/gemini';
import { Sparkles, Save, Loader2, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ArticleViewerProps {
  text: string;
  glossary: Record<string, string>;
  onSaveTerm?: (term: string, definition: string) => void;
  canSave?: boolean;
  revision?: number;
  isProcessingContent?: boolean;
  isProcessingTerms?: boolean;
}

export function ArticleViewer({ 
  text, 
  glossary, 
  onSaveTerm, 
  canSave, 
  revision = 0,
  isProcessingContent,
  isProcessingTerms
}: ArticleViewerProps) {
  const [selectionText, setSelectionText] = useState<string | null>(null);
  const [aiDefinition, setAiDefinition] = useState<string | null>(null);
  const [isDefining, setIsDefining] = useState(false);
  const viewerRef = useRef<HTMLDivElement>(null);

  const handleSelection = (e: React.MouseEvent | React.KeyboardEvent) => {
    if (isProcessingContent) return;
    
    // Don't clear selection if user is clicking inside the assistant panel
    const target = e.target as HTMLElement;
    if (target.closest('.ai-assistant-panel')) return;

    const sel = window.getSelection();
    if (sel && sel.toString().trim().length > 0) {
      setSelectionText(sel.toString().trim());
      setAiDefinition(null);
    } else {
      if (!aiDefinition) {
        setSelectionText(null);
      }
    }
  };

  const handleAiDefine = async () => {
    if (!selectionText) return;
    setIsDefining(true);
    try {
      const def = await defineSelection(selectionText, text);
      setAiDefinition(def);
    } catch (e: any) {
      const { formatGeminiError } = await import('../lib/gemini');
      setAiDefinition(formatGeminiError(e));
    } finally {
      setIsDefining(false);
    }
  };

  const highlightText = useCallback((content: string) => {
    if (!content || typeof content !== 'string') return content;
    
    // Sort terms by length (descending) to ensure longest phrases match first
    const termsArr = Object.keys(glossary).sort((a, b) => b.length - a.length);
    if (termsArr.length === 0) return content;

    // Create regex: escape special characters
    const escapedTerms = termsArr.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const regex = new RegExp(`(${escapedTerms})`, 'gi');

    const parts = content.split(regex);
    const result: React.ReactNode[] = [];

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (i % 2 === 1) {
        // This is a matched term
        const lowerPart = part.toLowerCase();
        const originalKey = termsArr.find(t => t.toLowerCase() === lowerPart) || part;
        const definition = glossary[originalKey] || "";
        
        result.push(
          <Tooltip key={`term-${i}-${part}`} term={originalKey} definition={definition}>
            {part}
          </Tooltip>
        );
      } else if (part) {
        result.push(part);
      }
    }
    return result;
  }, [glossary]);

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
      className="relative"
    >
      <div 
        id="article-viewer"
        className={`prose prose-blue prose-sm md:prose-base max-w-none rounded-2xl bg-white p-8 md:p-12 shadow-sm border border-gray-100 min-h-[600px] leading-relaxed text-gray-800 transition-all ${
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
                <div className="max-h-48 overflow-y-auto pr-2 custom-scrollbar">
                  <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                    {aiDefinition}
                  </p>
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
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
