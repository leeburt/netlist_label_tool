import { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';

const AutocompleteInput = ({ value, onChange, options = [], placeholder, autoFocus, onKeyDown, className, onFocus }: any) => {
  const [isOpen, setIsOpen] = useState(false);
  const [coords, setCoords] = useState({ left: 0, top: 0, width: 0 });
  const [isTyping, setIsTyping] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const updatePosition = () => {
    if (inputRef.current) {
        const rect = inputRef.current.getBoundingClientRect();
        setCoords({ 
            left: rect.left, 
            top: rect.bottom + window.scrollY, 
            width: rect.width 
        });
    }
  };

  useEffect(() => {
    if (isOpen) {
        updatePosition();
        window.addEventListener('resize', updatePosition);
        window.addEventListener('scroll', updatePosition, true);
    }
    return () => {
        window.removeEventListener('resize', updatePosition);
        window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen]);

  useEffect(() => {
      const handleGlobalClick = (e: any) => {
          if (inputRef.current && !inputRef.current.contains(e.target) && !e.target.closest('.autocomplete-dropdown')) {
              setIsOpen(false);
          }
      };
      window.addEventListener('mousedown', handleGlobalClick);
      return () => window.removeEventListener('mousedown', handleGlobalClick);
  }, []);

  const filtered = useMemo(() => {
      const distinct = Array.from(new Set(options)).sort();
      if (!value || !isTyping) return distinct;
      const lower = value.toLowerCase();
      return distinct.filter((o: any) => o.toLowerCase().includes(lower));
  }, [value, options, isTyping]);

  return (
      <div className="relative w-full">
          <input
              ref={inputRef}
              className={className}
              value={value}
              onChange={e => { onChange(e.target.value); setIsOpen(true); setIsTyping(true); }}
              onFocus={(e) => { setIsOpen(true); setIsTyping(false); if(onFocus) onFocus(e); }}
              onClick={() => setIsOpen(true)}
              onKeyDown={e => {
                  if (e.key === 'Escape') setIsOpen(false);
                  if (onKeyDown) onKeyDown(e);
              }}
              placeholder={placeholder}
              autoFocus={autoFocus}
              autoComplete="off"
          />
          {isOpen && filtered.length > 0 && (
              createPortal(
                  <div className="autocomplete-dropdown fixed z-[99999] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-xl rounded max-h-60 overflow-y-auto"
                       style={{ left: coords.left, top: coords.top, width: coords.width }}>
                      {filtered.map((opt: any) => (
                          <div key={opt} className="px-3 py-2 text-xs text-slate-700 dark:text-slate-300 hover:bg-blue-50 dark:hover:bg-blue-900/30 cursor-pointer border-b border-slate-100 dark:border-slate-800/50 last:border-0"
                               onClick={(e) => { e.stopPropagation(); onChange(opt); setIsOpen(false); setIsTyping(false); }}>
                              {opt}
                          </div>
                      ))}
                  </div>,
                  document.body
              )
          )}
      </div>
  );
};

export default AutocompleteInput;
