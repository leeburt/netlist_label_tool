import { useState, useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import AutocompleteInput from './AutocompleteInput';

const ModalDialog = ({ isOpen, type, initialName = '', initialType = '', data, options = {}, position, onConfirm, onCancel }: any) => {
  const [name, setName] = useState(initialName);
  const [inputType, setInputType] = useState(initialType);
  
  useEffect(() => {
    if (isOpen) {
        setName(initialName || '');
        setInputType(initialType || '');
    }
  }, [isOpen, initialName, initialType]);

  if (!isOpen) return null;

  if (type === 'MERGE_CONFIRM') {
      return (
        <div className="fixed inset-0 bg-black/60 z-[9999] flex items-center justify-center backdrop-blur-sm" onClick={onCancel}>
            <div className="bg-white dark:bg-slate-900 rounded-lg shadow-2xl w-96 p-6 border border-slate-200 dark:border-slate-700" onClick={e => e.stopPropagation()}>
                <h3 className="text-lg font-bold mb-2 text-slate-800 dark:text-slate-100 flex items-center gap-2">
                    <AlertTriangle className="text-orange-500"/> Merge Networks?
                </h3>
                <p className="text-sm text-slate-600 dark:text-slate-400 mb-6 leading-relaxed">
                    Connecting these points will merge distinct networks 
                    <span className="font-mono bg-slate-100 dark:bg-slate-800 px-1 mx-1 rounded text-slate-900 dark:text-slate-200 font-bold">{data.netA}</span> 
                    and 
                    <span className="font-mono bg-slate-100 dark:bg-slate-800 px-1 mx-1 rounded text-slate-900 dark:text-slate-200 font-bold">{data.netB}</span>.
                </p>
                <div className="flex justify-end gap-3">
                    <button onClick={onCancel} className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors">Cancel</button>
                    <button onClick={() => onConfirm()} className="px-4 py-2 text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 rounded shadow-sm transition-colors">Yes, Merge</button>
                </div>
            </div>
        </div>
      );
  }

  // Calculate position style if provided
  const modalStyle = position ? { 
      position: 'absolute' as const,  
      left: Math.min(window.innerWidth - 340, position.x + 20), 
      top: Math.min(window.innerHeight - 300, position.y + 20) 
  } : {};

  const overlayClass = position ? "fixed inset-0 z-[9999]" : "fixed inset-0 bg-black/60 z-[9999] flex items-center justify-center backdrop-blur-sm";

  return (
    <div className={overlayClass} onClick={onCancel}>
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow-2xl w-80 p-5 border border-slate-200 dark:border-slate-700" 
           style={modalStyle}
           onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold mb-4 text-slate-800 dark:text-slate-100">{type === 'comp' ? 'New Component' : (type === 'CONVERT_NET_TO_PORT' ? 'Convert to External Port' : 'New Port')}</h3>
        <div className="space-y-4">
            <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">名称 (Name)</label>
                <AutocompleteInput 
                    className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 p-2 rounded text-sm focus:border-blue-500 outline-none"
                    options={type === 'port' ? options.portNames : []}
                    value={name} 
                    onChange={setName} 
                    placeholder="e.g. M1" 
                    autoFocus 
                    onFocus={(e: any) => e.target.select()}
                    onKeyDown={(e: any) => e.key === 'Enter' && onConfirm(name, inputType)} 
                />
            </div>
            <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">类型 (Type)</label>
                <AutocompleteInput 
                    className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 p-2 rounded text-sm focus:border-blue-500 outline-none"
                    options={type === 'comp' ? options.compTypes : (options.portTypes || [])}
                    value={inputType} 
                    onChange={setInputType} 
                    placeholder={type === 'comp' ? 'e.g. NMOS' : 'e.g. port'} 
                    onFocus={(e: any) => e.target.select()}
                    onKeyDown={(e: any) => e.key === 'Enter' && onConfirm(name, inputType)} 
                />
            </div>
        </div>
        <div className="flex justify-end gap-2 mt-6">
            <button onClick={onCancel} className="px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded">取消</button>
            <button onClick={() => onConfirm(name, inputType)} className="px-3 py-1.5 text-sm bg-blue-600 text-white hover:bg-blue-700 rounded shadow-sm">确定</button>
        </div>
      </div>
    </div>
  );
};

export default ModalDialog;
