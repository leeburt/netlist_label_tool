import { useState, useRef, useEffect } from 'react';
import { ChevronRight, Settings, Trash2, PanelRightClose, Sparkles, Bot, AlertTriangle, Edit2, Zap, Check, CheckCircle2, Send, Square } from 'lucide-react';
import { DEFAULT_LLM_HOST, DEFAULT_LLM_MODELS, DEFAULT_LLM_SYSTEM_PROMPT, LLM_PRESETS } from '../utils/constants';
import { reactStateToPythonData, applyCorrectionItems, filterRedundantCorrections, autoDiffNetlists } from '../utils/netlistUtils';
import NetlistDiffTable from './NetlistDiffTable';

const LLMChatPanel = ({ isOpen, onClose, nodes, edges, extraData, onApplyNetlist, bgImage, notify, onHighlight, currentFileId }: any) => {
    const [settings, setSettings] = useState(() => {
        try { 
            const s = localStorage.getItem('llm_settings'); 
            if (s) { 
                const p = JSON.parse(s); 
                if (p?.host) {
                    // Sync Models with Code Constants
                    // Strategy: Force update defaults from code, but keep user-added custom models
                    const userCustomModels = (p.models || []).filter((m: any) => 
                        !DEFAULT_LLM_MODELS.some(dm => dm.id === m.id)
                    );
                    p.models = [...DEFAULT_LLM_MODELS, ...userCustomModels];
                    
                    // Ensure current model is in list
                    if (p.model && !p.models.find((m: any) => m.id === p.model)) {
                        p.models.push({ id: p.model, alias: p.model });
                    }
                    return p; 
                } 
            } 
        } catch {}
        return { 
            host: DEFAULT_LLM_HOST, 
            apiKey: '', 
            model: DEFAULT_LLM_MODELS[0].id, 
            models: DEFAULT_LLM_MODELS,
            systemPrompt: DEFAULT_LLM_SYSTEM_PROMPT 
        };
    });
    const [msgs, setMsgs] = useState<any[]>([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [cfgOpen, setCfgOpen] = useState(false);
    const [editingMsgIndex, setEditingMsgIndex] = useState<number | null>(null);
    const [editContent, setEditContent] = useState('');
    const endRef = useRef<HTMLDivElement>(null);
    const abortRef = useRef<AbortController | null>(null);
    const lastNetlistRef = useRef<string>('{}');
    const prevMsgsLen = useRef(0);

    // Remove setMsgs([]) to keep history, but we need to track file context

    useEffect(() => { localStorage.setItem('llm_settings', JSON.stringify(settings)); }, [settings]);
    
    // Auto-scroll only on new messages or during loading (streaming), not on local state updates like checkbox toggles
    useEffect(() => { 
        if (msgs.length > prevMsgsLen.current || loading) {
            endRef.current?.scrollIntoView({ behavior: 'smooth' }); 
        }
        prevMsgsLen.current = msgs.length;
    }, [msgs, loading]);

    const getNetlist = () => { try { return reactStateToPythonData(nodes, edges, extraData); } catch { return '{}'; } };

    const extractAndApplyAll = (text: string, startFrom: number = 0, msgFileId?: string): number => {
        const matches = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
        let applied = startFrom;
        for (let i = startFrom; i < matches.length; i++) {
            try { 
                const block = matches[i][1].trim();
                if (block.startsWith('{') || block.startsWith('[')) {
                    JSON.parse(block); 
                    onApplyNetlist(block, false, msgFileId); 
                    applied = i + 1; 
                }
            } catch {}
        }
        return applied;
    };

    const handleCorrectionToggle = (msgIdx: number, corrIdx: number) => {
        const msg = msgs[msgIdx];
        if (!msg.corrections) return;
        const newChecked = [...(msg.correctionChecked || [])];
        newChecked[corrIdx] = !newChecked[corrIdx];
        const firstApply = !msg.correctionHistorySaved && newChecked.some(Boolean);
        setMsgs(prev => {
            const c = [...prev];
            c[msgIdx] = { ...c[msgIdx], correctionChecked: newChecked, correctionHistorySaved: firstApply || c[msgIdx].correctionHistorySaved };
            return c;
        });
        
        // Use current netlist state as baseline to prevent rolling back user changes
        const currentBaseline = getNetlist();
        const result = applyCorrectionItems(currentBaseline, msg.corrections, newChecked);
        onApplyNetlist(result, !firstApply, msg.fileId);
    };

    const handleCorrectionToggleAll = (msgIdx: number, val: boolean) => {
        const msg = msgs[msgIdx];
        if (!msg.corrections) return;
        const newChecked = new Array(msg.corrections.length).fill(val);
        const firstApply = !msg.correctionHistorySaved && val;
        setMsgs(prev => {
            const c = [...prev];
            c[msgIdx] = { ...c[msgIdx], correctionChecked: newChecked, correctionHistorySaved: firstApply || c[msgIdx].correctionHistorySaved };
            return c;
        });
        
        // Use current netlist state as baseline to prevent rolling back user changes
        const currentBaseline = getNetlist();
        const result = applyCorrectionItems(currentBaseline, msg.corrections, newChecked);
        onApplyNetlist(result, !firstApply, msg.fileId);
    };
    
    // Handle item click for highlighting
    const handleItemClick = (item: any) => {
        if (!onHighlight) return;
        
        // Logic to determine what IDs to highlight based on item
        // item structure: { to: 'ckt_netlist'|'connection'|'external_ports', key: string, ... }
        
        if (item.to === 'ckt_netlist') {
            // key is the rawId (e.g. "#12") from python data
            const targetNode = nodes.find((n: any) => n.data?.rawId === item.key);
            if (targetNode) {
                onHighlight([targetNode.id]);
            } else {
                 // Fallback: direct ID match
                 if (nodes.find((n: any) => n.id === item.key)) {
                     onHighlight([item.key]);
                 }
            }
        } else if (item.to === 'external_ports') {
            // key is the external port key (e.g. "#1")
            const targetNode = nodes.find((n: any) => {
                if (n.type !== 'port' || !n.data?.isExternal) return false;
                const exId = n.data.externalId;
                if (!exId) return false;
                return exId === item.key || `#${exId}` === item.key || exId === `#${item.key}`;
            });
            if (targetNode) {
                onHighlight([targetNode.id]);
            }
        } else if (item.to === 'connection') {
            // key is the netName. We need to find all edges with this netName
            const netName = item.key;
            // Edges structure in react-flow usually has data.netName if customized
            const relevantEdges = edges.filter((e: any) => e.data?.netName === netName);
            // Also include Net Nodes
            const relevantNodes = nodes.filter((n: any) => n.type === 'net_node' && n.data?.netName === netName);
            
            const ids = [...relevantEdges.map((e: any) => e.id), ...relevantNodes.map((n: any) => n.id)];
            onHighlight(ids);
        }
    };

    const handleResend = async (index: number, newContent: string) => {
        setEditingMsgIndex(null);
        if (!newContent.trim()) return;
        
        const contextFileId = currentFileId; // Assume resend is in current context

        // Truncate history up to this message
        const history = msgs.slice(0, index);
        const oldMsg = msgs[index];
        const updatedMsg = { ...oldMsg, content: newContent, fileId: contextFileId };
        
        // Update state with truncated history + updated message
        const newMsgs = [...history, updatedMsg];
        setMsgs(newMsgs);
        setLoading(true);

        // Update context to current state
        const netlist = getNetlist();
        lastNetlistRef.current = netlist;

        // Re-construct apiMsgs
        let sysContent = settings.systemPrompt;
        
        // Check for new flags in the edited content
        const newHasNetlist = newContent.includes('@网表');
        const newHasImage = newContent.includes('@原图');
        // Update flags
        updatedMsg.hasNetlist = newHasNetlist;
        updatedMsg.hasImage = newHasImage;
        
        if (newHasNetlist) {
            sysContent += '\n\n当前网表:\n```json\n' + netlist + '\n```';
        }

        const apiMsgs: any[] = [{ role: 'system', content: sysContent }];
        
        newMsgs.forEach((m: any) => {
            if (m.role === 'user') {
                const cleanText = m.content.replace(/@原图/g, '').replace(/@网表/g, '').trim() || m.content;
                if (m.hasImage && bgImage?.startsWith('data:')) {
                    apiMsgs.push({ role: 'user', content: [
                        { type: 'image_url', image_url: { url: bgImage } },
                        { type: 'text', text: cleanText }
                    ]});
                } else {
                    apiMsgs.push({ role: 'user', content: cleanText });
                }
            } else if (m.role === 'assistant') {
                apiMsgs.push({ role: 'assistant', content: m.content });
            }
        });

        // Copy-paste the fetch logic from send()
        // Ideally refactor, but for now duplicate to ensure safety
        try {
            abortRef.current = new AbortController();
            const host = settings.host.replace(/\/+$/, '');
            const endpoint = host.match(/\/v\d+\/?$/) ? `${host}/chat/completions` : `${host}/v1/chat/completions`;
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${settings.apiKey}` },
                body: JSON.stringify({ model: settings.model, messages: apiMsgs, stream: true }),
                signal: abortRef.current.signal
            });
            if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);

            const resolveCorrections = (content: string): any[] | null => {
                if (!newHasNetlist) return null;
                 const matches = [...content.matchAll(/```(?:json|corrections)?\s*([\s\S]*?)```/g)];
                for (const m of matches) {
                    const block = m[1].trim();
                    try {
                        const parsed = JSON.parse(block);
                        if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].to && parsed[0].type) {
                            return filterRedundantCorrections(parsed);
                        }
                        const diff = autoDiffNetlists(lastNetlistRef.current, block);
                        if (diff) return filterRedundantCorrections(diff);
                    } catch {}
                }
                return null;
            };

            if (!res.headers.get('content-type')?.includes('text/event-stream')) {
                const data = await res.json();
                const content = data.choices?.[0]?.message?.content || '';
                const reasoning = data.choices?.[0]?.message?.reasoning_content || '';
                const corrs = resolveCorrections(content);
                if (corrs) {
                    setMsgs(prev => [...prev, { role: 'assistant', content, ts: Date.now(), corrections: corrs, baseline: lastNetlistRef.current, correctionChecked: new Array(corrs.length).fill(false), reasoning, fileId: contextFileId }]);
                } else {
                    const applied = !newHasNetlist && extractAndApplyAll(content, 0, contextFileId) > 0;
                    setMsgs(prev => [...prev, { role: 'assistant', content, ts: Date.now(), applied, reasoning, fileId: contextFileId }]);
                }
                return;
            }

            const reader = res.body!.getReader();
            const decoder = new TextDecoder();
            let full = '';
            let fullReasoning = '';
            let appliedBlocks = 0;
            setMsgs(prev => [...prev, { role: 'assistant', content: '', ts: Date.now(), fileId: contextFileId }]);

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                for (const line of decoder.decode(value).split('\n')) {
                    if (!line.startsWith('data: ') || line.includes('[DONE]')) continue;
                    try {
                        const choice = JSON.parse(line.slice(6)).choices?.[0];
                        const delta = choice?.delta?.content || '';
                        const reasoningDelta = choice?.delta?.reasoning_content || '';
                        full += delta;
                        fullReasoning += reasoningDelta;
                        setMsgs(prev => { const c = [...prev]; c[c.length - 1] = { ...c[c.length - 1], content: full, reasoning: fullReasoning }; return c; });
                    } catch {}
                }
                if (!newHasNetlist) {
                    const newApplied = extractAndApplyAll(full, appliedBlocks, contextFileId);
                    if (newApplied > appliedBlocks) {
                        appliedBlocks = newApplied;
                        setMsgs(prev => { const c = [...prev]; c[c.length - 1] = { ...c[c.length - 1], applied: true }; return c; });
                    }
                }
            }

            const corrs = resolveCorrections(full);
            if (corrs) {
                setMsgs(prev => { const c = [...prev]; c[c.length - 1] = { ...c[c.length - 1], corrections: corrs, baseline: lastNetlistRef.current, correctionChecked: new Array(corrs.length).fill(false) }; return c; });
            } else if (!newHasNetlist) {
                const finalApplied = extractAndApplyAll(full, appliedBlocks, contextFileId);
                if (finalApplied > appliedBlocks) {
                    setMsgs(prev => { const c = [...prev]; c[c.length - 1] = { ...c[c.length - 1], applied: true }; return c; });
                }
            }
        } catch (e: any) {
            if (e.name !== 'AbortError') setMsgs(prev => [...prev, { role: 'error', content: e.message, ts: Date.now() }]);
        } finally {
            setLoading(false);
            abortRef.current = null;
        }
    };

    const send = async () => {
        if (!input.trim() || loading) return;
        if (!settings.apiKey) { notify?.('请先配置 API Key'); setCfgOpen(true); return; }

        const contextFileId = currentFileId;

        const hasNetlist = input.includes('@网表');
        const hasImage = input.includes('@原图');
        const userMsg = { role: 'user', content: input, ts: Date.now(), hasNetlist, hasImage, fileId: contextFileId };
        const newMsgs = [...msgs, userMsg];
        setMsgs(newMsgs);
        setInput('');
        setLoading(true);

        // Update context to current state
        const netlist = getNetlist();
        lastNetlistRef.current = netlist;

        let sysContent = settings.systemPrompt;
        if (hasNetlist) {
            sysContent += '\n\n当前网表:\n```json\n' + netlist + '\n```';
        }
        const apiMsgs: any[] = [{ role: 'system', content: sysContent }];

        newMsgs.forEach((m: any) => {
            if (m.role === 'user') {
                const cleanText = m.content.replace(/@原图/g, '').replace(/@网表/g, '').trim() || m.content;
                if (m.hasImage && bgImage?.startsWith('data:')) {
                    apiMsgs.push({ role: 'user', content: [
                        { type: 'image_url', image_url: { url: bgImage } },
                        { type: 'text', text: cleanText }
                    ]});
                } else {
                    apiMsgs.push({ role: 'user', content: cleanText });
                }
            } else if (m.role === 'assistant') {
                apiMsgs.push({ role: 'assistant', content: m.content });
            }
        });

        try {
            abortRef.current = new AbortController();
            const host = settings.host.replace(/\/+$/, '');
            const endpoint = host.match(/\/v\d+\/?$/) ? `${host}/chat/completions` : `${host}/v1/chat/completions`;
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${settings.apiKey}` },
                body: JSON.stringify({ model: settings.model, messages: apiMsgs, stream: true }),
                signal: abortRef.current.signal
            });
            if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);

            // Helper: try extract corrections or auto-diff from full response
            const resolveCorrections = (content: string): any[] | null => {
                if (!hasNetlist) return null;
                
                const matches = [...content.matchAll(/```(?:json|corrections)?\s*([\s\S]*?)```/g)];
                for (const m of matches) {
                    const block = m[1].trim();
                    try {
                        const parsed = JSON.parse(block);
                        if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].to && parsed[0].type) {
                            return filterRedundantCorrections(parsed);
                        }
                        const diff = autoDiffNetlists(lastNetlistRef.current, block);
                        if (diff) return filterRedundantCorrections(diff);
                    } catch {}
                }
                return null;
            };

            if (!res.headers.get('content-type')?.includes('text/event-stream')) {
                const data = await res.json();
                const content = data.choices?.[0]?.message?.content || '';
                const reasoning = data.choices?.[0]?.message?.reasoning_content || '';
                const corrs = resolveCorrections(content);
                if (corrs) {
                    setMsgs(prev => [...prev, { role: 'assistant', content, ts: Date.now(), corrections: corrs, baseline: lastNetlistRef.current, correctionChecked: new Array(corrs.length).fill(false), reasoning, fileId: contextFileId }]);
                } else {
                    const applied = !hasNetlist && extractAndApplyAll(content, 0, contextFileId) > 0;
                    setMsgs(prev => [...prev, { role: 'assistant', content, ts: Date.now(), applied, reasoning, fileId: contextFileId }]);
                }
                return;
            }

            const reader = res.body!.getReader();
            const decoder = new TextDecoder();
            let full = '';
            let fullReasoning = '';
            let appliedBlocks = 0;
            setMsgs(prev => [...prev, { role: 'assistant', content: '', ts: Date.now(), fileId: contextFileId }]);

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                for (const line of decoder.decode(value).split('\n')) {
                    if (!line.startsWith('data: ') || line.includes('[DONE]')) continue;
                    try {
                        const choice = JSON.parse(line.slice(6)).choices?.[0];
                        const delta = choice?.delta?.content || '';
                        const reasoningDelta = choice?.delta?.reasoning_content || '';
                        full += delta;
                        fullReasoning += reasoningDelta;
                        setMsgs(prev => { const c = [...prev]; c[c.length - 1] = { ...c[c.length - 1], content: full, reasoning: fullReasoning }; return c; });
                    } catch {}
                }
                // Only auto-apply JSON during streaming if NOT in netlist mode
                if (!hasNetlist) {
                    const newApplied = extractAndApplyAll(full, appliedBlocks, contextFileId);
                    if (newApplied > appliedBlocks) {
                        appliedBlocks = newApplied;
                        setMsgs(prev => { const c = [...prev]; c[c.length - 1] = { ...c[c.length - 1], applied: true }; return c; });
                    }
                }
            }

            // After streaming: resolve corrections or auto-diff
            const corrs = resolveCorrections(full);
            if (corrs) {
                setMsgs(prev => { const c = [...prev]; c[c.length - 1] = { ...c[c.length - 1], corrections: corrs, baseline: lastNetlistRef.current, correctionChecked: new Array(corrs.length).fill(false) }; return c; });
            } else if (!hasNetlist) {
                const finalApplied = extractAndApplyAll(full, appliedBlocks, contextFileId);
                if (finalApplied > appliedBlocks) {
                    setMsgs(prev => { const c = [...prev]; c[c.length - 1] = { ...c[c.length - 1], applied: true }; return c; });
                }
            }
        } catch (e: any) {
            if (e.name !== 'AbortError') setMsgs(prev => [...prev, { role: 'error', content: e.message, ts: Date.now() }]);
        } finally {
            setLoading(false);
            abortRef.current = null;
        }
    };

    const renderContent = (text: string, msgData?: any, msgIdx?: number) => {
        if (!text && !msgData?.reasoning) return null;

        const thinkMatch = text ? text.match(/<think>([\s\S]*?)(?:<\/think>|$)/) : null;
        let thinkContent = null;
        let mainContent = text || '';

        if (thinkMatch) {
            thinkContent = thinkMatch[1];
            mainContent = text.replace(thinkMatch[0], '').trim();
        }

        // Merge with reasoning field if available
        if (msgData?.reasoning) {
            thinkContent = thinkContent ? (thinkContent + '\n---\n' + msgData.reasoning) : msgData.reasoning;
        }

        const renderedThink = thinkContent ? (
            <details className="mb-2 group" open>
                <summary className="text-[10px] text-slate-400 cursor-pointer select-none list-none flex items-center gap-1 hover:text-slate-600 dark:hover:text-slate-300 transition-colors outline-none">
                     <ChevronRight size={10} className="group-open:rotate-90 transition-transform"/> 
                     <span>Thinking Process</span>
                </summary>
                <div className="pl-3 border-l-2 border-slate-200 dark:border-slate-700 mt-1 ml-1 text-slate-500 dark:text-slate-400 italic text-xs whitespace-pre-wrap">
                    {thinkContent}
                </div>
            </details>
        ) : null;

        const renderedMain = mainContent ? mainContent.split(/(```[\s\S]*?```)/g).map((part, i) => {
            if (part.startsWith('```')) {
                const lang = part.match(/```(\w*)/)?.[1] || '';
                if ((!lang || lang === 'corrections' || lang === 'json') && msgData?.corrections && msgIdx !== undefined) {
                    return <NetlistDiffTable key={i} items={msgData.corrections} baseline={msgData.baseline || '{}'}
                        checked={msgData.correctionChecked || []} onToggle={(ci: number) => handleCorrectionToggle(msgIdx, ci)}
                        onToggleAll={(val: boolean) => handleCorrectionToggleAll(msgIdx, val)}
                        onItemClick={handleItemClick}/>;
                }
                const code = part.replace(/```\w*\n?/, '').replace(/\n?```$/, '');
                return (
                    <div key={i} className="my-2 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700">
                        <div className="flex justify-between items-center px-3 py-1 bg-slate-100 dark:bg-slate-800 text-[10px] text-slate-500 dark:text-slate-400">
                            <span>{lang || 'code'}</span>
                            {msgData?.applied && lang === 'json' && <span className="text-green-500 flex items-center gap-1"><CheckCircle2 size={10}/> 已应用</span>}
                        </div>
                        <pre className="p-3 bg-slate-50 dark:bg-slate-900 text-[11px] text-slate-700 dark:text-slate-300 overflow-x-auto max-h-48"><code>{code}</code></pre>
                    </div>
                );
            }
            return part ? <p key={i} className="whitespace-pre-wrap leading-relaxed">{part}</p> : null;
        }) : null;

        return <>{renderedThink}{renderedMain}</>;
    };

    return (
        <div className={`w-[420px] bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 flex flex-col shrink-0 z-20 shadow-2xl transition-colors ${!isOpen ? 'hidden' : ''}`}>
            {/* Header */}
            <div className="p-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-gradient-to-r from-violet-500/5 to-blue-500/5 dark:from-violet-500/10 dark:to-blue-500/10 shrink-0">
                <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center shadow-lg shadow-violet-500/20">
                        <Sparkles size={16} className="text-white"/>
                    </div>
                    <div>
                        <h3 className="text-sm font-bold text-slate-800 dark:text-white leading-tight">AI 助手</h3>
                        <div className="relative group">
                            <select 
                                className="appearance-none bg-transparent text-[10px] text-slate-400 dark:text-slate-500 font-mono outline-none cursor-pointer hover:text-violet-500 pr-3 py-0.5"
                                value={settings.model}
                                onChange={(e) => setSettings({...settings, model: e.target.value})}
                            >
                                {settings.models?.map((m: any) => (
                                    <option key={m.id} value={m.id}>{m.alias}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-0.5">
                    <button onClick={() => setCfgOpen(!cfgOpen)} className={`p-1.5 rounded-lg transition-colors ${cfgOpen ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400' : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400'}`}><Settings size={15}/></button>
                    <button onClick={() => setMsgs([])} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-400 transition-colors" title="清空"><Trash2 size={15}/></button>
                    <button onClick={onClose} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-400 transition-colors"><PanelRightClose size={15}/></button>
                </div>
            </div>

            {/* Settings */}
            {cfgOpen && (
                <div className="border-b border-slate-200 dark:border-slate-800 p-3 space-y-2.5 bg-slate-50/80 dark:bg-slate-950/50">
                    {[
                        { k: 'host', l: 'API Host', p: 'https://api.openai.com', t: 'text' },
                        { k: 'apiKey', l: 'API Key', p: 'sk-...', t: 'password' },
                    ].map((f: any) => (
                        <div key={f.k}>
                            <label className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase">{f.l}</label>
                            <input type={f.t} className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-200 outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/20 mt-0.5 transition-all" placeholder={f.p} value={(settings as any)[f.k]} onChange={e => setSettings((s: any) => ({ ...s, [f.k]: e.target.value }))}/>
                        </div>
                    ))}
                    
                    {/* Model Management */}
                    <div>
                        <label className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase flex justify-between items-center">
                            <span>Models</span>
                        </label>
                        <div className="space-y-1.5 mt-0.5">
                            {settings.models?.map((m: any, idx: number) => (
                                <div key={idx} className="flex gap-1">
                                    <input className="flex-1 min-w-0 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-[10px] text-slate-600 dark:text-slate-400" 
                                        value={m.alias} placeholder="Alias"
                                        onChange={e => {
                                            const newModels = [...settings.models];
                                            newModels[idx].alias = e.target.value;
                                            setSettings({...settings, models: newModels});
                                        }}
                                    />
                                    <input className="flex-[2] min-w-0 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-[10px] text-slate-600 dark:text-slate-400 font-mono" 
                                        value={m.id} placeholder="Model ID"
                                        onChange={e => {
                                            const newModels = [...settings.models];
                                            newModels[idx].id = e.target.value;
                                            // Auto-update selection if modifying current
                                            if (settings.model === m.id) setSettings({...settings, models: newModels, model: e.target.value});
                                            else setSettings({...settings, models: newModels});
                                        }}
                                    />
                                    <button onClick={() => {
                                        const newModels = settings.models.filter((_: any, i: number) => i !== idx);
                                        setSettings({...settings, models: newModels, model: settings.model === m.id ? (newModels[0]?.id || '') : settings.model});
                                    }} className="px-1.5 text-slate-400 hover:text-red-500"><Trash2 size={12}/></button>
                                </div>
                            ))}
                            <div className="flex gap-1 pt-1">
                                <button onClick={() => setSettings({...settings, models: [...(settings.models||[]), {id: '', alias: 'New Model'}]})} 
                                    className="w-full py-1 text-[10px] border border-dashed border-slate-300 dark:border-slate-700 text-slate-400 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                                    + Add Model
                                </button>
                            </div>
                        </div>
                    </div>

                    <div>
                        <label className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase">System Prompt</label>
                        <textarea className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-200 outline-none focus:border-violet-500 mt-0.5 h-20 resize-none transition-all" value={settings.systemPrompt} onChange={e => setSettings((s: any) => ({ ...s, systemPrompt: e.target.value }))}/>
                    </div>
                    <div className="text-[10px] text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 rounded px-2 py-1.5 flex justify-between items-center">
                        <span>💡 在消息中输入 <code className="text-violet-500 font-bold">@网表</code> 附带数据</span>
                        <button onClick={() => {
                            if (window.confirm('Reset settings to defaults?')) {
                                setSettings({
                                    host: DEFAULT_LLM_HOST, 
                                    apiKey: '', 
                                    model: DEFAULT_LLM_MODELS[0].id, 
                                    models: DEFAULT_LLM_MODELS,
                                    systemPrompt: DEFAULT_LLM_SYSTEM_PROMPT
                                });
                            }
                        }} className="text-[9px] underline hover:text-red-500">Restore Defaults</button>
                    </div>
                </div>
            )}

            {/* Presets */}
            {msgs.length === 0 && !cfgOpen && (
                <div className="p-3 border-b border-slate-200 dark:border-slate-800 shrink-0">
                    <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase mb-2 tracking-wider">快捷指令</div>
                    <div className="grid grid-cols-2 gap-1.5">
                        {LLM_PRESETS.map(p => (
                            <button key={p.label} onClick={() => setInput(p.prompt)}
                                className="text-left px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700/50 hover:border-violet-300 dark:hover:border-violet-600 hover:bg-violet-50 dark:hover:bg-violet-900/10 transition-all text-[11px] text-slate-500 dark:text-slate-400 hover:text-violet-700 dark:hover:text-violet-300">
                                <span className="mr-1">{p.icon}</span><span className="font-medium">{p.label}</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar min-h-0">
                {msgs.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full text-slate-300 dark:text-slate-600 gap-3 select-none">
                        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500/10 to-blue-500/10 flex items-center justify-center">
                            <Bot size={32} className="text-violet-300 dark:text-violet-700"/>
                        </div>
                        <p className="text-xs font-medium">输入问题开始对话</p>
                        <p className="text-[10px] text-slate-300 dark:text-slate-600">用 @网表 @原图 引用当前数据</p>
                    </div>
                )}
                {msgs.map((m: any, i: number) => (
                    <div key={i} className={`flex gap-2.5 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                        {m.role !== 'user' && (
                            <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${m.role === 'error' ? 'bg-red-100 dark:bg-red-900/30' : 'bg-gradient-to-br from-violet-500 to-blue-500 shadow-sm'}`}>
                                {m.role === 'error' ? <AlertTriangle size={13} className="text-red-500"/> : <Bot size={13} className="text-white"/>}
                            </div>
                        )}
                        <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
                            m.role === 'user' ? 'bg-gradient-to-r from-violet-600 to-blue-600 text-white rounded-br-md shadow-sm'
                            : m.role === 'error' ? 'bg-red-50 dark:bg-red-900/10 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900/30 rounded-bl-md'
                            : 'bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-200 rounded-bl-md'
                        }`}>
                            {m.role === 'user' ? (
                                editingMsgIndex === i ? (
                                    <div className="min-w-[200px]">
                                        <textarea 
                                            className="w-full bg-white/20 text-white rounded p-2 text-xs outline-none focus:bg-white/30 resize-none mb-2"
                                            rows={3}
                                            value={editContent}
                                            onChange={e => setEditContent(e.target.value)}
                                            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleResend(i, editContent); } }}
                                        />
                                        <div className="flex justify-end gap-2">
                                            <button onClick={() => setEditingMsgIndex(null)} className="px-2 py-1 text-[10px] hover:bg-white/20 rounded">Cancel</button>
                                            <button onClick={() => handleResend(i, editContent)} className="px-2 py-1 text-[10px] bg-white/20 hover:bg-white/30 rounded font-bold">Save & Resend</button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="group relative">
                                        <div className="absolute -left-8 top-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button onClick={() => { setEditingMsgIndex(i); setEditContent(m.content); }} 
                                                className="p-1.5 bg-slate-200 dark:bg-slate-700 rounded-full text-slate-500 hover:text-blue-500 hover:bg-white shadow-sm">
                                                <Edit2 size={10}/>
                                            </button>
                                        </div>
                                        {m.hasNetlist && <span className="inline-block bg-white/20 rounded px-1 py-0.5 text-[10px] mr-1 mb-1">📋 网表</span>}
                                        {m.hasImage && <span className="inline-block bg-white/20 rounded px-1 py-0.5 text-[10px] mr-1 mb-1">🖼️ 原图</span>}
                                        {m.content.replace(/@原图/g, '').replace(/@网表/g, '').trim()}
                                    </div>
                                )
                            ) : (
                                m.content ? renderContent(m.content, m, i) : (
                                    <div className="flex gap-1.5 py-1">
                                        <div className="w-1.5 h-1.5 bg-violet-400 rounded-full animate-bounce"/>
                                        <div className="w-1.5 h-1.5 bg-violet-400 rounded-full animate-bounce [animation-delay:150ms]"/>
                                        <div className="w-1.5 h-1.5 bg-violet-400 rounded-full animate-bounce [animation-delay:300ms]"/>
                                    </div>
                                )
                            )}
                            {m.applied && !m.corrections && <div className="mt-2 pt-2 border-t border-green-200/50 dark:border-green-800/30 flex items-center gap-1.5 text-green-600 dark:text-green-400 text-[11px] font-medium"><Zap size={12}/> 网表已自动更新</div>}
                            {m.corrections && (m.correctionChecked || []).some(Boolean) && <div className="mt-2 pt-2 border-t border-violet-200/50 dark:border-violet-800/30 flex items-center gap-1.5 text-violet-600 dark:text-violet-400 text-[11px] font-medium"><Check size={12}/> {(m.correctionChecked || []).filter(Boolean).length}/{m.corrections.length} 项已应用</div>}
                        </div>
                    </div>
                ))}
                <div ref={endRef}/>
            </div>

            {/* Input */}
            <div className="p-3 border-t border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur shrink-0">
                <div className="flex gap-1.5 mb-2">
                    <button onClick={() => setInput(prev => prev.includes('@网表') ? prev : '@网表 ' + prev)}
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold border transition-all ${input.includes('@网表') ? 'bg-violet-100 dark:bg-violet-900/30 border-violet-300 dark:border-violet-700 text-violet-600 dark:text-violet-400' : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400 hover:text-violet-500 hover:border-violet-300'}`}>
                        📋 @网表
                    </button>
                    <button onClick={() => setInput(prev => prev.includes('@原图') ? prev : '@原图 ' + prev)}
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold border transition-all ${input.includes('@原图') ? 'bg-blue-100 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700 text-blue-600 dark:text-blue-400' : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400 hover:text-blue-500 hover:border-blue-300'}`}>
                        🖼️ @原图
                    </button>
                </div>
                <div className="flex gap-2 items-end">
                    <textarea
                        className="flex-1 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm text-slate-800 dark:text-slate-200 outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/20 resize-none placeholder-slate-400 dark:placeholder-slate-600 transition-all min-h-[80px]"
                        rows={3} placeholder="输入问题... @网表 引用网表 @原图 引用电路图&#10;Enter 发送，Shift+Enter 换行" value={input}
                        onChange={e => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px'; }}
                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                    />
                    {loading ? (
                        <button onClick={() => { abortRef.current?.abort(); setLoading(false); }} className="p-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-500 hover:text-red-500 dark:text-slate-400 dark:hover:text-red-400 rounded-xl transition-colors shrink-0 border border-slate-200 dark:border-slate-700 shadow-sm"><Square size={14} fill="currentColor"/></button>
                    ) : (
                        <button onClick={send} disabled={!input.trim()} className="p-2.5 bg-gradient-to-r from-violet-500 to-blue-500 hover:from-violet-600 hover:to-blue-600 text-white rounded-xl transition-all disabled:opacity-30 shrink-0 shadow-lg shadow-violet-500/20"><Send size={18}/></button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default LLMChatPanel;
