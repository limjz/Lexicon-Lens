import { motion, AnimatePresence } from "motion/react";
import { useState, useRef, useEffect } from "react";

interface TooltipProps {
  term: string;
  definition: string;
  children: React.ReactNode;
  isHighlighted?: boolean;
}

export function Tooltip({ term, definition, children, isHighlighted }: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  const show = () => {
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    setIsVisible(true);
  };

  const hide = () => {
    timeoutRef.current = window.setTimeout(() => {
      setIsVisible(false);
    }, 100);
  };

  return (
    <span
      data-glossary-term="true"
      className={`relative cursor-help border-b-2 border-indigo-500 transition-colors inline font-semibold ${
        isHighlighted
          ? "bg-yellow-300 text-yellow-950 border-yellow-500 rounded-sm font-bold shadow-[0_0_8px_rgba(253,224,71,0.4)]"
          : "bg-indigo-100/50 text-indigo-700 px-0.5 rounded-sm hover:bg-indigo-200"
      }`}
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      {children}
      <AnimatePresence>
        {isVisible && (
          <motion.span
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 5, scale: 0.95 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="absolute bottom-full left-1/2 z-[9999] mb-3 w-72 -translate-x-1/2 rounded-xl bg-gray-900 p-4 text-sm text-white shadow-[0_10px_40px_rgba(0,0,0,0.3)] block border border-gray-700 select-none tooltip-content"
            style={{ pointerEvents: 'auto' }}
            onMouseEnter={show}
            onMouseLeave={hide}
          >
            <span className="block mb-1.5 font-bold text-yellow-400 border-b border-gray-700 pb-1.5 uppercase text-[10px] tracking-widest">{term}</span>
            <span className="block leading-relaxed opacity-90 whitespace-pre-wrap text-sm">{definition}</span>
            <span className="absolute top-full left-1/2 -ms-2 border-[8px] border-transparent border-t-gray-900" />
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}
