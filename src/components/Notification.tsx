import { useEffect } from 'react';
import { Info, X } from 'lucide-react';

const Notification = ({ message, onClose }: any) => {
    useEffect(() => {
        const timer = setTimeout(onClose, 5000);
        return () => clearTimeout(timer);
    }, [onClose]);

    return (
        <div className="fixed bottom-10 right-10 z-[1000] bg-slate-800 text-white px-4 py-3 rounded shadow-lg flex items-start gap-3 max-w-sm animate-in fade-in slide-in-from-bottom-5 border border-slate-700">
            <Info className="shrink-0 text-blue-400 mt-0.5" size={18} />
            <div className="flex-1 text-xs">
                <div className="font-bold mb-1">System Message</div>
                <div className="opacity-90 leading-relaxed whitespace-pre-line">{message}</div>
            </div>
            <button onClick={onClose} className="hover:bg-slate-700 rounded p-1"><X size={14}/></button>
        </div>
    );
};

export default Notification;
