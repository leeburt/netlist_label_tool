import { useState } from 'react';
import { Check, ChevronRight } from 'lucide-react';
import { getOriginalFromBaseline } from '../utils/netlistUtils';

const NetlistDiffTable = ({ items, baseline, checked, onToggle, onToggleAll, onItemClick }: {
    items: any[], baseline: string, checked: boolean[], onToggle: (i: number) => void, onToggleAll?: (val: boolean) => void, onItemClick?: (item: any) => void
}) => {
    const [expanded, setExpanded] = useState<Set<number>>(new Set());

    const toggleExpand = (i: number) => {
        const next = new Set(expanded);
        if (next.has(i)) next.delete(i);
        else next.add(i);
        setExpanded(next);
    };

    const getDiffs = (c: any) => {
        if (c.type === 'del') return [{ field: '整项', old: '存在', val: '删除' }];
        if (c.type === 'add') {
            if (!c.content) return [{ field: '整项', old: '-', val: '新增' }];
            return Object.keys(c.content).map(k => ({
                field: k, old: '-', val: typeof c.content[k] === 'object' ? JSON.stringify(c.content[k]) : String(c.content[k])
            }));
        }
        // For connection renames: show rename_to/name/key as "重命名" directly
        if (c.type === 'modify' && c.to === 'connection' && c.content) {
            const renameVal = c.content.rename_to || c.content.name || c.content.key;
            if (renameVal && renameVal !== c.key) {
                return [{ field: 'rename_to', old: c.key, val: renameVal }];
            }
        }
        const orig = getOriginalFromBaseline(baseline, c);
        if (!orig || !c.content) return [];
        const diffs: any[] = [];
        const walk = (obj: any, ref: any, prefix: string) => {
            for (const k of Object.keys(obj)) {
                const path = prefix ? `${prefix}.${k}` : k;
                if (obj[k] && typeof obj[k] === 'object' && !Array.isArray(obj[k]) && ref?.[k] && typeof ref[k] === 'object' && !Array.isArray(ref[k])) {
                    walk(obj[k], ref[k], path);
                } else {
                    const ov = ref?.[k], nv = obj[k];
                    if (JSON.stringify(ov) !== JSON.stringify(nv))
                        diffs.push({ field: path, old: ov === undefined ? '-' : typeof ov === 'object' ? JSON.stringify(ov) : String(ov), val: typeof nv === 'object' ? JSON.stringify(nv) : String(nv) });
                }
            }
        };
        walk(c.content, orig, '');
        return diffs;
    };

    const checkedCount = checked.filter(Boolean).length;

    return (
        <div className="my-2 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden bg-white dark:bg-slate-900">
            <div className="px-3 py-2 bg-slate-50 dark:bg-slate-950/50 flex items-center justify-between border-b border-slate-100 dark:border-slate-800">
                <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">校对 · {items.length} 项</span>
                <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">{checkedCount}/{items.length}</span>
                    {onToggleAll && (
                        <button onClick={() => onToggleAll(checkedCount < items.length)}
                            className="text-[10px] px-2 py-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors">
                            {checkedCount < items.length ? '全选' : '取消'}
                        </button>
                    )}
                </div>
            </div>
            
            <div className="max-h-[320px] overflow-y-auto custom-scrollbar">
                {items.map((c: any, i: number) => {
                    const diffs = getDiffs(c);
                    const isExpanded = expanded.has(i);
                    const firstDiff = diffs[0];
                    // 智能摘要：优先展示第一条差异，如果没差异显示原因
                    const summaryText = firstDiff 
                        ? (firstDiff.field === '整项' ? firstDiff.val 
                          : firstDiff.field === 'rename_to' ? `→ ${firstDiff.val}`
                          : `${firstDiff.field}: ${firstDiff.old} → ${firstDiff.val}`)
                        : (c.reason || c.type);
                    
                    return (
                        <div key={i} className={`text-[11px] border-b border-slate-50 dark:border-slate-800/50 last:border-0 transition-colors ${checked[i] ? 'bg-blue-50/30 dark:bg-blue-900/10' : ''}`}>
                            <div className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/30"
                                onClick={() => { if (onItemClick) onItemClick(c); }}>
                                
                                <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-all shrink-0 ${checked[i] ? 'bg-blue-500 border-blue-500 text-white' : 'border-slate-300 dark:border-slate-600'}`}
                                     onClick={(e) => { e.stopPropagation(); onToggle(i); }}>
                                    {checked[i] && <Check size={10} strokeWidth={3}/>}
                                </div>

                                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.type === 'add' ? 'bg-green-500' : (c.type === 'del' ? 'bg-red-500' : 'bg-amber-500')}`} />

                                <span className="font-mono font-bold text-slate-700 dark:text-slate-300 min-w-[24px]">{c.key}</span>

                                <div className="flex-1 min-w-0 flex items-center gap-2 text-slate-500 dark:text-slate-400">
                                    <span className="truncate opacity-90" title={typeof summaryText === 'string' ? summaryText : ''}>
                                       {summaryText}
                                    </span>
                                </div>

                                <button onClick={(e) => { e.stopPropagation(); toggleExpand(i); }} 
                                    className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded text-slate-400">
                                    <ChevronRight size={12} className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}/>
                                </button>
                            </div>

                            {isExpanded && (
                                <div className="px-3 pb-2 pl-9 space-y-1 bg-slate-50/50 dark:bg-slate-900/50 border-t border-slate-100 dark:border-slate-800/50">
                                    <div className="text-[10px] text-slate-400 font-mono mb-1 border-b border-slate-200 dark:border-slate-700/50 pb-1 flex flex-wrap gap-2">
                                        <span>To: {c.to}</span>
                                        <span>Type: {c.type}</span>
                                        {c.reason && <span className="italic text-slate-500">{c.reason}</span>}
                                    </div>
                                    {diffs.map((d: any, j: number) => (
                                        <div key={j} className="flex items-start gap-1.5 font-mono text-[10px] leading-tight">
                                            <span className="text-slate-500 dark:text-slate-400 shrink-0">{d.field}:</span>
                                            <div className="flex flex-wrap items-baseline gap-1 break-all">
                                                {d.old !== '-' && <span className="text-red-400/80 line-through decoration-red-400/50">{d.old}</span>}
                                                {d.old !== '-' && <span className="text-slate-300 dark:text-slate-600">→</span>}
                                                <span className="text-green-600 dark:text-green-400 font-medium">{d.val}</span>
                                            </div>
                                        </div>
                                    ))}
                                    {c.content && (
                                        <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700/30">
                                            <div className="text-[9px] uppercase text-slate-400 mb-0.5">Raw Content:</div>
                                            <pre className="text-[9px] font-mono bg-slate-100 dark:bg-slate-800 p-1.5 rounded overflow-x-auto text-slate-600 dark:text-slate-400 whitespace-pre-wrap break-all">
                                                {JSON.stringify(c.content, null, 2)}
                                            </pre>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default NetlistDiffTable;
