import { useState, useRef, useEffect, useMemo } from 'react';
import { Layers, Plus, Eye, EyeOff, Search } from 'lucide-react';
import { getComponentColor, stringToColor } from '../utils/colorUtils';

const RightSidebar = ({ 
    nodes, 
    componentTypes, 
    portNames, 
    onAddType, 
    onAddPort, 
    hiddenTypes, 
    setHiddenTypes,
    hiddenNodeIds,
    setHiddenNodeIds,
    onSelectIds
}: any) => {
    const [newItemName, setNewItemName] = useState('');
    const [newItemType, setNewItemType] = useState('component'); // 'component' | 'port'
    const [searchTerm, setSearchTerm] = useState('');

    const toggleTypeVisibility = (type: any) => {
        const newHidden = new Set(hiddenTypes);
        if (newHidden.has(type)) newHidden.delete(type);
        else newHidden.add(type);
        setHiddenTypes(newHidden);
    };

    const toggleNodeVisibility = (id: any) => {
        const newHidden = new Set(hiddenNodeIds);
        if (newHidden.has(id)) newHidden.delete(id);
        else newHidden.add(id);
        setHiddenNodeIds(newHidden);
    };

    const handleAdd = () => {
        if (!newItemName.trim()) return;
        if (newItemType === 'component') onAddType(newItemName.trim());
        else onAddPort(newItemName.trim());
        setNewItemName('');
    };

    const filteredNodes = useMemo(() => nodes.filter((n: any) => {
        if (n.type === 'net_node') return false;
        const label = n.data.label || '';
        const type = n.data.type || '';
        if (hiddenTypes.has(type)) return false;
        if (searchTerm && !label.toLowerCase().includes(searchTerm.toLowerCase()) && !type.toLowerCase().includes(searchTerm.toLowerCase())) return false;
        return true;
    }), [nodes, hiddenTypes, searchTerm]);

    const groupedNodes = useMemo(() => {
        const groups: any = {};
        filteredNodes.forEach((n: any) => {
            const t = n.data.type || 'Uncategorized';
            if (!groups[t]) groups[t] = [];
            groups[t].push(n);
        });
        return groups;
    }, [filteredNodes]);

    // Resizing Logic for 3 Sections (Components, Ports, Instances)
    // We track height percentages. Start with 33% each.
    // However, the top part "Add New Tag" is fixed height.
    // So we manage the remaining flexible space.
    const [split1, setSplit1] = useState(33); // % Height of Component Types
    const [split2, setSplit2] = useState(33); // % Height of Port Names
    // Third section takes the rest (100 - split1 - split2)

    const [isResizing1, setIsResizing1] = useState(false);
    const [isResizing2, setIsResizing2] = useState(false);
    const sidebarRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleMouseMove = (e: any) => {
            if ((!isResizing1 && !isResizing2) || !sidebarRef.current) return;
            const rect = sidebarRef.current.getBoundingClientRect();
            // We need to account for the fixed header (~90px estimated)
            // But simplified: let's just use percentage of the total sidebar height for now, 
            // recognizing there is a fixed header.
            // A better way is flex-basis with pixels, but user asked for equal split default.
            
            // Let's assume the resize area is the whole sidebar height minus the fixed header.
            // But calculating that dynamically is complex.
            // Simpler: use the whole sidebar height for calculation.
            
            // const relY = e.clientY - rect.top;
            
            if (isResizing1) {
                // Dragging first handle (between Comp Types and Ports)
                // split1 is roughly pct (minus offset for header)
                // Let's just clamp it.
                // We need to respect the fixed header at top (~100px).
                // 100px is approx 10-15% of screen height.
                
                // Let's try a pure flex-based approach using pixels for smoother feel?
                // Or just keep the % logic simple.
                // New split1 = pct - (headerOffsetPct)
                // Let's stick to simple relative movement.
                
                // Better approach: Update state based on dy
                const dy = e.movementY;
                const dpct = (dy / rect.height) * 100;
                setSplit1(prev => Math.max(10, Math.min(80 - split2, prev + dpct)));
            } else if (isResizing2) {
                // Dragging second handle (between Ports and Instances)
                const dy = e.movementY;
                const dpct = (dy / rect.height) * 100;
                setSplit2(prev => Math.max(10, Math.min(90 - split1, prev + dpct)));
            }
        };
        
        const handleMouseUp = () => {
            setIsResizing1(false);
            setIsResizing2(false);
        };

        if (isResizing1 || isResizing2) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isResizing1, isResizing2, split1, split2]);


    return (
        <div ref={sidebarRef} className="w-72 bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 flex flex-col shrink-0 z-20 shadow-xl overflow-hidden select-none transition-colors">
             {/* Fixed Header Section */}
             <div className="shrink-0 border-b border-slate-200 dark:border-slate-800">
                <div className="p-3 bg-slate-50 dark:bg-slate-950/50 text-slate-700 dark:text-slate-200 font-bold text-xs uppercase tracking-wider flex items-center gap-2 transition-colors">
                    <Layers size={14} className="text-blue-600 dark:text-blue-500"/>
                    <span>Tags & Filter</span>
                </div>
                {/* Add Tag Inputs */}
                <div className="p-4 space-y-2">
                    <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase transition-colors">Add New Tag</label>
                    <div className="flex gap-1">
                        <input 
                           className="flex-1 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs text-slate-900 dark:text-slate-200 outline-none focus:border-blue-500 transition-colors" 
                           placeholder="Name..." 
                           value={newItemName}
                           onChange={e => setNewItemName(e.target.value)}
                           onKeyDown={e => e.key === 'Enter' && handleAdd()}
                        />
                        <select 
                           className="bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-1 py-1 text-[10px] text-slate-600 dark:text-slate-400 outline-none transition-colors"
                           value={newItemType}
                           onChange={e => setNewItemType(e.target.value)}
                        >
                            <option value="component">Comp</option>
                            <option value="port">Port</option>
                        </select>
                        <button onClick={handleAdd} className="p-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded"><Plus size={14}/></button>
                    </div>
                </div>
             </div>

             {/* Resizable Section 1: Component Types */}
             <div style={{ height: `${split1}%` }} className="flex flex-col min-h-[50px]">
                 <div className="px-4 py-2 bg-slate-50 dark:bg-slate-900/50 sticky top-0 z-10 flex items-center justify-between transition-colors">
                    <label className="text-[10px] font-bold text-slate-500 dark:text-slate-500 uppercase">Component Types</label>
                    <span className="text-[9px] bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-1.5 rounded-full transition-colors">{componentTypes.length}</span>
                 </div>
                 <div className="flex-1 overflow-y-auto custom-scrollbar px-4 pb-2 space-y-1">
                    {componentTypes.map((t: any) => (
                        <div key={t} className="flex items-center justify-between group hover:bg-slate-100 dark:hover:bg-slate-800/50 rounded px-1 py-0.5 transition-colors">
                            <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                                <div className="w-2.5 h-2.5 rounded-full shadow-sm" style={{backgroundColor: getComponentColor(t)}} />
                                <span>{t}</span>
                            </div>
                            <button onClick={() => toggleTypeVisibility(t)} className={`p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 ${hiddenTypes.has(t) ? 'text-slate-400 dark:text-slate-600' : 'text-blue-600 dark:text-blue-400'}`}>
                                {hiddenTypes.has(t) ? <EyeOff size={12}/> : <Eye size={12}/>}
                            </button>
                        </div>
                    ))}
                 </div>
             </div>

             {/* Resizer 1 */}
             <div 
                className="h-1 bg-slate-200 dark:bg-slate-950 border-y border-slate-300 dark:border-slate-800 cursor-row-resize hover:bg-blue-500 dark:hover:bg-blue-600 transition-colors shrink-0"
                onMouseDown={() => setIsResizing1(true)}
             />

             {/* Resizable Section 2: Port Names */}
             <div style={{ height: `${split2}%` }} className="flex flex-col min-h-[50px]">
                 <div className="px-4 py-2 bg-slate-50 dark:bg-slate-900/50 sticky top-0 z-10 flex items-center justify-between transition-colors">
                    <label className="text-[10px] font-bold text-slate-500 dark:text-slate-500 uppercase">Port Names</label>
                    <span className="text-[9px] bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-1.5 rounded-full transition-colors">{portNames.length}</span>
                 </div>
                 <div className="flex-1 overflow-y-auto custom-scrollbar px-4 pb-2 space-y-1">
                    {portNames.map((t: any) => (
                        <div key={t} className="flex items-center justify-between group hover:bg-slate-100 dark:hover:bg-slate-800/50 rounded px-1 py-0.5 transition-colors">
                            <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                                <div className="w-2.5 h-2.5 rounded-full shadow-sm" style={{backgroundColor: stringToColor(t)}} />
                                <span>{t}</span>
                            </div>
                            <button onClick={() => toggleTypeVisibility(t)} className={`p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 ${hiddenTypes.has(t) ? 'text-slate-400 dark:text-slate-600' : 'text-blue-600 dark:text-blue-400'}`}>
                                {hiddenTypes.has(t) ? <EyeOff size={12}/> : <Eye size={12}/>}
                            </button>
                        </div>
                    ))}
                 </div>
             </div>

             {/* Resizer 2 */}
             <div 
                className="h-1 bg-slate-200 dark:bg-slate-950 border-y border-slate-300 dark:border-slate-800 cursor-row-resize hover:bg-blue-500 dark:hover:bg-blue-600 transition-colors shrink-0"
                onMouseDown={() => setIsResizing2(true)}
             />

             {/* Resizable Section 3: Instance List (Takes remaining space) */}
             <div className="flex-1 flex flex-col min-h-0 bg-slate-50/50 dark:bg-slate-900/30 transition-colors">
                 <div className="p-2 border-b border-slate-200 dark:border-slate-800 shrink-0">
                     <div className="relative">
                         <Search size={12} className="absolute left-2.5 top-2 text-slate-400 dark:text-slate-500"/>
                         <input 
                            type="text" 
                            placeholder="Filter instances..." 
                            className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded py-1.5 pl-7 pr-2 text-[11px] text-slate-900 dark:text-slate-300 focus:border-blue-500 outline-none transition-colors" 
                            value={searchTerm} 
                            onChange={e => setSearchTerm(e.target.value)}
                         />
                     </div>
                 </div>
                 
                 <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-4">
                     {Object.entries(groupedNodes).map(([type, list]: any) => (
                         <div key={type}>
                             <div className="text-[10px] font-bold text-slate-500 uppercase mb-1 sticky top-0 bg-slate-100 dark:bg-slate-900 py-1 z-10 flex items-center gap-2 border-b border-slate-200 dark:border-slate-800/50 shadow-sm transition-colors">
                                 <div className="w-2 h-2 rounded-full" style={{backgroundColor: getComponentColor(type)}} />
                                 {type} ({list.length})
                             </div>
                             <div className="space-y-0.5 pl-2 border-l border-slate-200 dark:border-slate-800 ml-1 transition-colors">
                                 {list.map((n: any, idx: number) => (
                                     <div key={n.id} className="flex items-center justify-between py-1 px-2 rounded hover:bg-slate-100 dark:hover:bg-slate-800 group text-xs text-slate-600 dark:text-slate-400 transition-colors">
                                         <div className="flex items-center gap-2 cursor-pointer truncate" onClick={() => onSelectIds(n.id)}>
                                             <input 
                                                 type="checkbox" 
                                                 className="accent-blue-600 rounded cursor-pointer" 
                                                 checked={!hiddenNodeIds.has(n.id)} 
                                                 onChange={(e) => { e.stopPropagation(); toggleNodeVisibility(n.id); }}
                                             />
                                             <span className={hiddenNodeIds.has(n.id) ? 'opacity-50 line-through' : ''}>
                                                 {n.data.label || `${type} #${idx+1}`}
                                             </span>
                                         </div>
                                     </div>
                                 ))}
                             </div>
                         </div>
                     ))}
                     {filteredNodes.length === 0 && <div className="text-center text-[10px] text-slate-400 dark:text-slate-600 mt-4 italic transition-colors">No matching instances</div>}
                 </div>
             </div>
        </div>
    );
};

export default RightSidebar;
