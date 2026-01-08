import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { 
  Settings, Undo, Redo, Save, Upload, MousePointer2, 
  Crop, CircleDot, Network, Trash2, ZoomIn, ZoomOut, RotateCcw, 
  Image as ImageIcon, Plus, Minus, Eye, EyeOff, Type, Droplets, AlertTriangle,
  FolderOpen, ChevronLeft, ChevronRight, Search, FileText, CheckCircle2,
  HelpCircle, X, AlignJustify, MoreVertical, Layers, Info, ChevronDown, ChevronUp, Grid,
  Moon, Sun, GripHorizontal, Monitor, Maximize, Move
} from 'lucide-react';

// --- 0. Utility Functions ---
const getId = () => `n_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
const SNAPPING_THRESHOLD = 8; 

// Default Suggestions for Autocomplete
const DEFAULT_TYPES = ['NMOS', 'PMOS', 'RES', 'CAP', 'IND', 'VSOURCE', 'ISOURCE', 'GND', 'VDD'];
const DEFAULT_PORT_NAMES = ['G', 'D', 'S', 'B', 'IN', 'OUT', 'VCC', 'VSS', 'PLUS', 'MINUS', 'A', 'B', 'Y'];

// Color Generation
const stringToColor = (str) => {
  if (!str) return '#999999';
  const s = String(str);
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = s.charCodeAt(i) + ((hash << 5) - hash);
  }
  const goldenRatio = 0.618033988749895;
  const h = (Math.abs(hash) * goldenRatio % 1) * 360;
  return `hsl(${h}, 85%, 40%)`; 
};

const getComponentColor = (type, opacity = 0.6) => {
    if (!type) return `rgba(59, 130, 246, ${opacity})`; 
    const s = String(type).toUpperCase();
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
        hash = s.charCodeAt(i) + ((hash << 5) - hash);
    }
    const h = Math.abs(hash) % 360;
    return `hsla(${h}, 60%, 92%, ${opacity})`; 
};

const getComponentStrokeColor = (type) => {
    if (!type) return '#2563eb';
    const s = String(type).toUpperCase();
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
        hash = s.charCodeAt(i) + ((hash << 5) - hash);
    }
    const h = Math.abs(hash) % 360;
    return `hsl(${h}, 60%, 40%)`;
}

// --- 1. Data Processing (Python <-> React) ---
const pythonDataToReactState = (jsonStr) => {
  try {
    const data = JSON.parse(jsonStr);
    let nodes = [];
    let edges = [];
    let mergeReport = new Set();
    
    // Check for New Format (viz_core.py compatible)
    if (data.components || data.external_ports) {
        // 1. Parse Components
        Object.entries(data.components || {}).forEach(([compName, compInfo]) => {
             // Handle box: [minX, minY, maxX, maxY]
             const [x1, y1, x2, y2] = compInfo.box;
             const w = Math.abs(x2 - x1);
             const h = Math.abs(y2 - y1);
             const x = Math.min(x1, x2);
             const y = Math.min(y1, y2);
             
             const compId = `comp_${compName}`; 
             
             nodes.push({
                 id: compId,
                 type: 'component',
                 position: { x, y },
                 width: w, height: h,
                 data: { label: compName, type: compInfo.type || '' }
             });
             
             (compInfo.ports || []).forEach(p => {
                 const pId = getId();
                 nodes.push({
                     id: pId,
                     type: 'port',
                     position: { x: p.coord[0], y: p.coord[1] },
                     parentId: compId,
                     data: { label: p.name, isExternal: false, compName: compName }
                 });
             });
        });
        
        // 2. Parse External Ports
        Object.entries(data.external_ports || {}).forEach(([portName, portInfo]) => {
             const pId = getId();
             nodes.push({
                 id: pId,
                 type: 'port',
                 position: { x: portInfo.coord[0], y: portInfo.coord[1] },
                 data: { label: portName, isExternal: true, compName: 'external' }
             });
        });
        
        // 3. Parse Connections (Star Topology for now)
        (data.connections || []).forEach((conn, index) => {
            const netName = `net_${index}`;
            const validNodes = [];
            
            // Find React Node IDs for each connected item
            (conn.nodes || []).forEach(item => {
                let foundNode = null;
                if (item.component === 'external') {
                    foundNode = nodes.find(n => n.type === 'port' && n.data.isExternal && n.data.label === item.port);
                } else {
                    const compId = `comp_${item.component}`;
                    foundNode = nodes.find(n => n.type === 'port' && n.parentId === compId && n.data.label === item.port);
                }
                
                if (foundNode) {
                    validNodes.push(foundNode);
                    foundNode.data.netName = netName;
                }
            });
            
            if (validNodes.length > 1) {
                // Calculate centroid
                const cx = validNodes.reduce((sum, n) => sum + n.position.x, 0) / validNodes.length;
                const cy = validNodes.reduce((sum, n) => sum + n.position.y, 0) / validNodes.length;
                
                const netNodeId = getId();
                const netNode = { 
                    id: netNodeId, 
                    type: 'net_node', 
                    position: { x: cx, y: cy }, 
                    data: { netName: netName } 
                };
                nodes.push(netNode);
                
                // Create Edges (Port -> Centroid)
                validNodes.forEach(vn => {
                    edges.push({
                        id: `edge_${getId()}`,
                        source: vn.id,
                        target: netNodeId,
                        type: 'net_edge',
                        data: { netName: netName }
                    });
                });
            }
        });
        
        return { nodes, edges, warnings: [] };
    }

    // --- Fallback: Old Format (Keep existing logic) ---
    const findNearestNodeInList = (list, x, y) => {
        for (const node of list) {
            if ((node.type === 'port' || node.type === 'net_node') && 
                Math.abs(node.position.x - x) <= SNAPPING_THRESHOLD && 
                Math.abs(node.position.y - y) <= SNAPPING_THRESHOLD) {
                return node;
            }
        }
        return null;
    };

    // 1. Parse Components & Ports
    (data.ckt_netlist || []).forEach(comp => {
        const { top_left, bottom_right } = comp.bbox;
        const x = top_left[0];
        const y = top_left[1];
        const w = bottom_right[0] - top_left[0];
        const h = bottom_right[1] - top_left[1];
        const compId = comp.device_name || comp.id; 

        nodes.push({
            id: compId,
            type: 'component',
            position: { x, y },
            width: w, height: h,
            data: { 
                label: typeof comp.name === 'string' ? comp.name : '', 
                type: typeof comp.component_type === 'string' ? comp.component_type : '', 
                rawId: comp.id 
            }
        });

        Object.entries(comp.port || {}).forEach(([portName, portInfo]) => {
            const center = portInfo.center;
            const pId = getId();
            nodes.push({
                id: pId,
                type: 'port',
                position: { x: center[0], y: center[1] },
                parentId: compId,
                data: { label: portName, isExternal: false, compName: comp.device_name }
            });
        });
    });

    // 2. Parse Connections with Auto-Merge Logic
    const netRenames = new Map(); 

    const getEffectiveNetName = (name) => {
        let curr = name;
        while (netRenames.has(curr)) {
            curr = netRenames.get(curr);
        }
        return curr;
    };

    Object.entries(data.connection || {}).forEach(([rawNetName, netInfo]) => {
        (netInfo.pixels || []).forEach(seg => {
            const [p1, p2] = seg;
            let currentNetName = getEffectiveNetName(rawNetName);

            let n1 = findNearestNodeInList(nodes, p1[0], p1[1]);
            if (!n1) {
                n1 = { id: getId(), type: 'net_node', position: { x: p1[0], y: p1[1] }, data: { netName: currentNetName } };
                nodes.push(n1);
            } else {
                const existingNet = n1.data.netName;
                if (existingNet && existingNet !== currentNetName) {
                    netRenames.set(currentNetName, existingNet);
                    mergeReport.add(`'${currentNetName}' merged into '${existingNet}'`);
                    currentNetName = existingNet;
                    nodes.forEach(n => { if(n.data.netName === rawNetName) n.data.netName = existingNet; });
                    edges.forEach(e => { if(e.data.netName === rawNetName) e.data.netName = existingNet; });
                } else if (!existingNet) {
                    n1.data.netName = currentNetName;
                }
            }

            let n2 = findNearestNodeInList(nodes, p2[0], p2[1]);
            if (!n2) {
                n2 = { id: getId(), type: 'net_node', position: { x: p2[0], y: p2[1] }, data: { netName: currentNetName } };
                nodes.push(n2);
            } else {
                const existingNet = n2.data.netName;
                if (existingNet && existingNet !== currentNetName) {
                    netRenames.set(currentNetName, existingNet);
                    mergeReport.add(`'${currentNetName}' merged into '${existingNet}'`);
                    currentNetName = existingNet;
                    nodes.forEach(n => { if(n.data.netName === rawNetName || n.data.netName === getEffectiveNetName(rawNetName)) n.data.netName = existingNet; });
                    edges.forEach(e => { if(e.data.netName === rawNetName || e.data.netName === getEffectiveNetName(rawNetName)) e.data.netName = existingNet; });
                } else if (!existingNet) {
                    n2.data.netName = currentNetName;
                }
            }

            if (n1.data.netName !== currentNetName) n1.data.netName = currentNetName;

            if (n1.id !== n2.id) {
                const exists = edges.some(e => (e.source === n1.id && e.target === n2.id) || (e.source === n2.id && e.target === n1.id));
                if (!exists) {
                    edges.push({ id: `edge_${getId()}`, source: n1.id, target: n2.id, type: 'net_edge', data: { netName: currentNetName } });
                }
            }
        });
    });

    nodes.forEach(n => { if (n.data?.netName && netRenames.has(n.data.netName)) n.data.netName = getEffectiveNetName(n.data.netName); });
    edges.forEach(e => { if (e.data?.netName && netRenames.has(e.data.netName)) e.data.netName = getEffectiveNetName(e.data.netName); });

    return { nodes, edges, warnings: Array.from(mergeReport) };
  } catch (e) {
    console.error("JSON Parse Error", e);
    return null;
  }
};

const reactStateToPythonData = (nodes, edges) => {
    // Export to New Format (viz_core.py compatible)
    const components = {};
    const external_ports = {};
    const connections = []; 
    const nets = new Map(); // netName -> Set of {component, port}
    
    // 1. Components
    nodes.filter(n => n.type === 'component').forEach(n => {
        const compName = n.data.label;
        if (!compName) return;
        
        const x1 = Math.round(n.position.x);
        const y1 = Math.round(n.position.y);
        const x2 = Math.round(n.position.x + n.width);
        const y2 = Math.round(n.position.y + n.height);
        
        const compPorts = nodes.filter(p => p.parentId === n.id).map(p => ({
            name: p.data.label,
            coord: [Math.round(p.position.x), Math.round(p.position.y)]
        }));
        
        components[compName] = {
            type: n.data.type || '',
            box: [x1, y1, x2, y2],
            ports: compPorts
        };
        
        // Track connectivity
        nodes.filter(p => p.parentId === n.id).forEach(p => {
             const net = p.data.netName;
             if (net) {
                 if (!nets.has(net)) nets.set(net, []);
                 nets.get(net).push({ component: compName, port: p.data.label });
             }
        });
    });
    
    // 2. External Ports
    nodes.filter(n => n.type === 'port' && n.data.isExternal).forEach(n => {
        const portName = n.data.label;
        if (!portName) return;
        
        external_ports[portName] = {
            type: n.data.type || '',
            coord: [Math.round(n.position.x), Math.round(n.position.y)]
        };
        
        const net = n.data.netName;
        if (net) {
             if (!nets.has(net)) nets.set(net, []);
             nets.get(net).push({ component: 'external', port: portName });
        }
    });
    
    // 3. Connections
    nets.forEach((nodeList, netName) => {
        const uniqueNodes = [];
        const seen = new Set();
        nodeList.forEach(item => {
            const key = `${item.component}:${item.port}`;
            if (!seen.has(key)) {
                seen.add(key);
                uniqueNodes.push(item);
            }
        });
        
        if (uniqueNodes.length > 1) {
            connections.push({ nodes: uniqueNodes, points: [] });
        }
    });

    return JSON.stringify({ components, external_ports, connections }, null, 2);
};

// --- 2. UI Components ---

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
      const handleGlobalClick = (e) => {
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
      return distinct.filter(o => o.toLowerCase().includes(lower));
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
                      {filtered.map(opt => (
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

const Notification = ({ message, onClose }) => {
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

const SettingsDialog = ({ isOpen, onClose, appSettings, setAppSettings, theme, setTheme }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-black/60 z-[9999] flex items-center justify-center backdrop-blur-sm" onClick={onClose}>
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-[600px] overflow-hidden flex flex-col max-h-[85vh] border border-slate-200 dark:border-slate-800" onClick={e => e.stopPropagation()}>
                <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-950">
                    <h3 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                        <Settings size={18} className="text-blue-600"/> Settings & Preferences
                    </h3>
                    <button onClick={onClose} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-full text-slate-500 dark:text-slate-400 transition-colors"><X size={18}/></button>
                </div>
                <div className="p-6 overflow-y-auto space-y-8">
                    {/* Theme Section */}
                    <div>
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 border-b border-slate-100 dark:border-slate-800 pb-2">Appearance</h4>
                        <div className="grid grid-cols-3 gap-4">
                            {[
                                { id: 'light', icon: Sun, label: 'Light Mode' },
                                { id: 'dark', icon: Moon, label: 'Dark Mode' },
                                { id: 'system', icon: Monitor, label: 'System' }
                            ].map(t => (
                                <button key={t.id} onClick={() => setTheme(t.id)} 
                                    className={`flex flex-col items-center justify-center p-4 rounded-lg border-2 transition-all gap-2 ${theme === t.id ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 text-slate-600 dark:text-slate-400'}`}>
                                    <t.icon size={24}/>
                                    <span className="text-xs font-medium">{t.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                    {/* Defaults Section */}
                    <div>
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 border-b border-slate-100 dark:border-slate-800 pb-2">Defaults</h4>
                        <div className="space-y-4">
                            <div>
                                <div className="flex justify-between mb-1">
                                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Default Line Width</label>
                                    <span className="text-xs font-mono text-slate-500">{appSettings.defaultLineWidth}px</span>
                                </div>
                                <input type="range" min="1" max="10" value={appSettings.defaultLineWidth} onChange={e => setAppSettings({...appSettings, defaultLineWidth: parseInt(e.target.value)})} className="w-full accent-blue-600 h-1 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer"/>
                            </div>
                            <div>
                                <div className="flex justify-between mb-1">
                                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Default Box Opacity</label>
                                    <span className="text-xs font-mono text-slate-500">{appSettings.defaultBoxOpacity}</span>
                                </div>
                                <input type="range" min="0" max="1" step="0.1" value={appSettings.defaultBoxOpacity} onChange={e => setAppSettings({...appSettings, defaultBoxOpacity: parseFloat(e.target.value)})} className="w-full accent-blue-600 h-1 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer"/>
                            </div>
                            <div className="flex items-center justify-between">
                                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Show Crosshair</label>
                                <input type="checkbox" checked={appSettings.showCrosshair} onChange={e => setAppSettings({...appSettings, showCrosshair: e.target.checked})} className="accent-blue-600 w-4 h-4 rounded cursor-pointer"/>
                            </div>
                        </div>
                    </div>
                    {/* Shortcuts Cheat Sheet */}
                    <div>
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 border-b border-slate-100 dark:border-slate-800 pb-2">Keyboard Shortcuts</h4>
                        <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
                            {[
                                ['Undo / Redo', 'Ctrl+Z / Ctrl+Y'],
                                ['Pan View', 'Left Drag'],
                                ['Zoom', 'Mouse Wheel'],
                                ['Delete Selected', 'Delete'],
                                ['Delete Network', 'Ctrl + Delete'],
                                ['Tools (S/R/E/W)', 'Select/Comp/Port/Wire'],
                                ['Toggle Ports', 'P'],
                                ['Toggle Labels', 'L'],
                                ['Hide Text Labels', 'H']
                            ].map(([k, v]) => (
                                <div key={k} className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800/50">
                                    <span className="text-slate-600 dark:text-slate-400">{k}</span>
                                    <span className="font-mono text-xs bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-slate-500 dark:text-slate-300">{v}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
                <div className="p-4 bg-slate-50 dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 flex justify-end">
                    <button onClick={onClose} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium text-sm transition-colors">Done</button>
                </div>
            </div>
        </div>
    );
};

const ModalDialog = ({ isOpen, type, initialName = '', data, options = {}, position, onConfirm, onCancel }) => {
  const [name, setName] = useState(initialName);
  const [inputType, setInputType] = useState('');
  
  useEffect(() => {
    if (isOpen) {
        setName(initialName || '');
        setInputType('');
    }
  }, [isOpen, initialName]);

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
      position: 'absolute', 
      left: Math.min(window.innerWidth - 340, position.x + 20), 
      top: Math.min(window.innerHeight - 300, position.y + 20) 
  } : {};

  const overlayClass = position ? "fixed inset-0 z-[9999]" : "fixed inset-0 bg-black/60 z-[9999] flex items-center justify-center backdrop-blur-sm";

  return (
    <div className={overlayClass} onClick={onCancel}>
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow-2xl w-80 p-5 border border-slate-200 dark:border-slate-700" 
           style={modalStyle}
           onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold mb-4 text-slate-800 dark:text-slate-100">{type === 'comp' ? 'New Component' : 'New Port'}</h3>
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
                    onFocus={(e) => e.target.select()}
                    onKeyDown={e => e.key === 'Enter' && onConfirm(name, inputType)} 
                />
            </div>
            <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">类型 (Type)</label>
                <AutocompleteInput 
                    className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 p-2 rounded text-sm focus:border-blue-500 outline-none"
                    options={type === 'comp' ? options.compTypes : []}
                    value={inputType} 
                    onChange={setInputType} 
                    placeholder="e.g. NMOS" 
                    onFocus={(e) => e.target.select()}
                    onKeyDown={e => e.key === 'Enter' && onConfirm(name, inputType)} 
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

const ConnectionSegment = ({ from, to, netName, isSelected, isRelated, isTemp, isConflict, width = 2 }) => {
  if (!from || !to) return null;
  const baseColor = isTemp ? '#666' : (isConflict ? '#ef4444' : stringToColor(netName));
  const strokeDash = isTemp || isConflict ? "5,5" : undefined;
  
  return (
    <g>
        {(isSelected || isRelated) && (
            <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={isSelected ? "#FFD700" : baseColor} strokeWidth={width + (isSelected ? 8 : 6)} strokeOpacity={isSelected ? 0.6 : 0.3} strokeLinecap="round" />
        )}
        <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={baseColor} strokeWidth={width} strokeDasharray={strokeDash} strokeOpacity={0.9} strokeLinecap="round" />
        {isConflict && <circle cx={(from.x+to.x)/2} cy={(from.y+to.y)/2} r={4} fill="#ef4444" />}
    </g>
  );
};

// --- 3. Main Application ---
const MODE = { VIEW: 'VIEW', ADD_COMP: 'ADD_COMP', ADD_PORT: 'ADD_PORT', CONNECT: 'CONNECT' };

export default function App() {
  // --- Global App Settings & State ---
  const [theme, setTheme] = useState('dark'); // 'light', 'dark'
  const [appSettings, setAppSettings] = useState({ defaultLineWidth: 2, defaultBoxOpacity: 0.2, showCrosshair: true });
  const [showSettings, setShowSettings] = useState(false);
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 }); // Mouse position in world coords
  const [screenCursor, setScreenCursor] = useState({ x: -100, y: -100 }); // For Crosshair
  const [hoveredNode, setHoveredNode] = useState(null); // For Tooltip

  
  // --- File System State ---
  const [fileList, setFileList] = useState([]); 
  const [currentFileIndex, setCurrentFileIndex] = useState(-1);
  const [searchQuery, setSearchQuery] = useState('');
  
  // --- Editor State ---
  const [nodes, setNodes] = useState<any[]>([]);
  const [edges, setEdges] = useState<any[]>([]);
  const [bgImage, setBgImage] = useState(null);
  const [mode, setMode] = useState(MODE.VIEW);
  
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [connectStartId, setConnectStartId] = useState(null); 
  
  const [past, setPast] = useState<any[]>([]);
  const [future, setFuture] = useState<any[]>([]);
  
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const containerRef = useRef(null);
  const fileInputRef = useRef(null);
  const sidebarRef = useRef(null);
  
  const [dragState, setDragState] = useState<any>(null);
  const [notification, setNotification] = useState<string | null>(null);
  
  const [dialog, setDialog] = useState<{
    isOpen: boolean;
    type: string;
    data: any;
    options?: { compTypes: string[]; portNames: string[] };
    initialName?: string;
    position?: { x: number; y: number };
    onConfirm?: (name: string, type: string) => void;
    onCancel?: () => void;
  }>({ isOpen: false, type: '', data: null });
  
  const [showPorts, setShowPorts] = useState(false);
  const [showLabels, setShowLabels] = useState(true);
  const [hideAll, setHideAll] = useState(false); // Renamed conceptually to 'hideTexts' in UI, but keep var name to minimize diff

  // --- Layout State (Resizable Sidebar) ---
  const [sidebarSplit, setSidebarSplit] = useState(40); // % height of Top Panel (File List)
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);

  // --- Unique Values for Dropdowns ---
  const uniqueComponentTypes = useMemo(() => {
      const types = new Set(DEFAULT_TYPES);
      nodes.forEach(n => {
          if (n.type === 'component' && n.data.type) types.add(n.data.type);
      });
      return Array.from(types).sort();
  }, [nodes]);

  const uniquePortNames = useMemo(() => {
      const names = new Set(DEFAULT_PORT_NAMES);
      nodes.forEach(n => {
          if (n.type === 'port' && n.data.label) names.add(n.data.label);
      });
      return Array.from(names).sort();
  }, [nodes]);

  // --- Theme Effect ---
  useEffect(() => {
      const root = window.document.documentElement;
      root.classList.remove('light', 'dark');
      if (theme === 'system') {
          const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
          root.classList.add(systemTheme);
      } else {
          root.classList.add(theme);
      }
  }, [theme]);

  // --- Sidebar Resizing Effect ---
  useEffect(() => {
      const handleMouseMove = (e) => {
          if (!isResizingSidebar || !sidebarRef.current) return;
          const sidebarRect = sidebarRef.current.getBoundingClientRect();
          // Calculate percentage based on mouse Y relative to sidebar top
          const relativeY = e.clientY - sidebarRect.top;
          const newPercentage = (relativeY / sidebarRect.height) * 100;
          // Clamp between 10% and 90%
          setSidebarSplit(Math.min(90, Math.max(10, newPercentage)));
      };
      const handleMouseUp = () => setIsResizingSidebar(false);

      if (isResizingSidebar) {
          window.addEventListener('mousemove', handleMouseMove);
          window.addEventListener('mouseup', handleMouseUp);
      }
      return () => {
          window.removeEventListener('mousemove', handleMouseMove);
          window.removeEventListener('mouseup', handleMouseUp);
      };
  }, [isResizingSidebar]);

  // --- File Management Logic ---
  const handleFileUpload = (e) => {
    const files = Array.from(e.target.files);
    const images = files.filter(f => f.type.startsWith('image/'));
    const jsons = files.filter(f => f.name.endsWith('.json'));

    const newFiles = images.map(img => {
        const baseName = img.name.substring(0, img.name.lastIndexOf('.'));
        const matchingJson = jsons.find(j => j.name === `${baseName}.json` || j.name.startsWith(baseName));
        return {
            id: getId(),
            name: img.name,
            imgFile: img,
            jsonFile: matchingJson,
            data: null,
            status: matchingJson ? 'annotated' : 'new'
        };
    });

    setFileList(prev => {
        const next = [...prev, ...newFiles];
        if (currentFileIndex === -1 && next.length > 0) {
            setTimeout(() => loadFile(0, next), 50);
        }
        return next;
    });
  };

  const saveCurrentStateToMemory = useCallback(() => {
    if (currentFileIndex !== -1 && fileList[currentFileIndex]) {
        setFileList(prev => {
            const copy = [...prev];
            copy[currentFileIndex] = {
                ...copy[currentFileIndex],
                data: { nodes, edges },
                status: nodes.length > 0 ? 'annotated' : 'new'
            };
            return copy;
        });
    }
  }, [currentFileIndex, fileList, nodes, edges]);

  const fitView = useCallback(() => {
      if (!containerRef.current || !bgImage) return;
      
      const img = new Image();
      img.onload = () => {
          const rect = containerRef.current.getBoundingClientRect();
          const k = Math.min((rect.width - 40) / img.width, (rect.height - 40) / img.height, 1);
          setTransform({ x: Math.floor((rect.width - img.width * k) / 2), y: Math.floor((rect.height - img.height * k) / 2), k });
      };
      img.src = bgImage;
  }, [bgImage]);

  const loadFile = (index, sourceList = fileList) => {
    if (index < 0 || index >= sourceList.length) return;
    const fileObj = sourceList[index];

    const reader = new FileReader();
    reader.onload = (e) => {
        setBgImage(e.target.result);
        if (!fileObj.data) {
            const img = new Image();
            img.onload = () => {
                if (containerRef.current) {
                    const rect = containerRef.current.getBoundingClientRect();
                    const k = Math.min((rect.width - 40) / img.width, (rect.height - 40) / img.height, 1);
                    setTransform({ x: Math.floor((rect.width - img.width * k) / 2), y: Math.floor((rect.height - img.height * k) / 2), k });
                }
            };
            img.src = e.target.result;
        }
    };
    reader.readAsDataURL(fileObj.imgFile);

    if (fileObj.data) {
        setNodes(fileObj.data.nodes);
        setEdges(fileObj.data.edges);
        setPast([]); setFuture([]);
    } else if (fileObj.jsonFile) {
        const jReader = new FileReader();
        jReader.onload = (e) => {
            const res = pythonDataToReactState(e.target.result);
            if (res) {
                setNodes(res.nodes);
                setEdges(res.edges);
                if (res.warnings && res.warnings.length > 0) {
                    setNotification(`Loaded with Auto-Merges:\n${res.warnings.join('\n')}`);
                }
            }
        };
        jReader.readAsText(fileObj.jsonFile);
        setPast([]); setFuture([]);
    } else {
        setNodes([]);
        setEdges([]);
        setPast([]); setFuture([]);
    }
    
    setCurrentFileIndex(index);
    setSelectedIds(new Set());
    setConnectStartId(null);
  };

  const switchFile = (direction) => {
      if (fileList.length === 0) return;
      saveCurrentStateToMemory();
      let nextIdx = currentFileIndex + direction;
      if (nextIdx < 0) nextIdx = 0;
      if (nextIdx >= fileList.length) nextIdx = fileList.length - 1;
      if (nextIdx !== currentFileIndex) {
          loadFile(nextIdx);
      }
  };

  // --- Graph Logic & Effects ---

  const highlightedNetNames = useMemo(() => {
      const nets = new Set();
      if (selectedIds.size === 0) return nets;
      selectedIds.forEach(id => {
          const edge = edges.find(e => e.id === id);
          if (edge?.data?.netName) nets.add(edge.data.netName);
          const node = nodes.find(n => n.id === id);
          if (node) {
              if (node.data?.netName) nets.add(node.data.netName);
              if (node.type === 'component') nodes.filter(n => n.parentId === id).forEach(p => p.data?.netName && nets.add(p.data.netName));
          }
      });
      return nets;
  }, [selectedIds, nodes, edges]);

  const conflicts = useMemo(() => {
    const nodeConflicts = new Set();
    nodes.forEach(node => {
        if (node.type === 'component') return; 
        const connectedEdges = edges.filter(e => e.source === node.id || e.target === node.id);
        const netNames = new Set();
        if (node.data?.netName) netNames.add(node.data.netName);
        connectedEdges.forEach(e => { if (e.data?.netName) netNames.add(e.data.netName); });
        if (netNames.size > 1) {
            nodeConflicts.add(node.id);
            connectedEdges.forEach(e => nodeConflicts.add(e.id));
        }
    });
    return nodeConflicts;
  }, [nodes, edges]);

  const netLabels = useMemo(() => {
      if (!showLabels || hideAll) return [];
      const groups = {}; 
      edges.forEach(e => {
          if (!e.data?.netName) return;
          const s = nodes.find(n => n.id === e.source);
          const t = nodes.find(n => n.id === e.target);
          if (s && t) {
              if (!groups[e.data.netName]) groups[e.data.netName] = [];
              groups[e.data.netName].push({ id: e.id, x1: s.position.x, y1: s.position.y, x2: t.position.x, y2: t.position.y });
          }
      });

      return Object.entries(groups).map(([name, segments]) => {
          if (segments.length === 0) return null;
          
          // Find segment with max length
          let bestSeg = segments[0];
          let maxLen = -1;
          
          segments.forEach(seg => {
              const len = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
              if (len > maxLen) {
                  maxLen = len;
                  bestSeg = seg;
              }
          });

          return { 
              name, 
              edgeId: bestSeg.id,
              x: (bestSeg.x1 + bestSeg.x2) / 2, 
              y: (bestSeg.y1 + bestSeg.y2) / 2 
          };
      }).filter(Boolean);
  }, [edges, nodes, showLabels, hideAll]);

  // --- Interaction Handlers ---
  
  const saveHistory = useCallback(() => {
    const current = JSON.stringify({ nodes, edges });
    setPast(prev => [...prev.slice(-19), current]);
    setFuture([]); 
  }, [nodes, edges]);

  const undo = useCallback(() => {
    if (past.length === 0) return;
    const previous = past[past.length - 1];
    const newPast = past.slice(0, -1);
    const current = JSON.stringify({ nodes, edges });
    setFuture(prev => [current, ...prev]);
    setPast(newPast);
    const data = JSON.parse(previous);
    setNodes(data.nodes);
    setEdges(data.edges);
    setSelectedIds(new Set());
  }, [past, nodes, edges]);

  const redo = useCallback(() => {
    if (future.length === 0) return;
    const next = future[0];
    const newFuture = future.slice(1);
    const current = JSON.stringify({ nodes, edges });
    setPast(prev => [...prev, current]);
    setFuture(newFuture);
    const data = JSON.parse(next);
    setNodes(data.nodes);
    setEdges(data.edges);
    setSelectedIds(new Set());
  }, [future, nodes, edges]);

  const getConnectedEdges = useCallback((startEdgeId) => {
      const adj = new Map();
      const getNodeIds = (id) => { if(!adj.has(id)) adj.set(id, []); return adj.get(id); };
      
      edges.forEach(e => {
          getNodeIds(e.source).push({ type: 'edge', id: e.id, neighbor: e.target });
          getNodeIds(e.target).push({ type: 'edge', id: e.id, neighbor: e.source });
      });

      const startEdge = edges.find(e => e.id === startEdgeId);
      if(!startEdge) return new Set();

      const queue = [startEdge.source, startEdge.target];
      const visitedNodes = new Set(queue);
      const connectedEdgeIds = new Set([startEdgeId]);

      while(queue.length > 0) {
          const currNodeId = queue.shift();
          const neighbors = adj.get(currNodeId) || [];
          neighbors.forEach(item => {
              if (item.type === 'edge') {
                  if (!connectedEdgeIds.has(item.id)) {
                      connectedEdgeIds.add(item.id);
                      if (!visitedNodes.has(item.neighbor)) {
                          visitedNodes.add(item.neighbor);
                          queue.push(item.neighbor);
                      }
                  }
              }
          });
      }
      return connectedEdgeIds;
  }, [edges]);

  const deleteSelected = useCallback((isCtrlPressed = false) => {
    if (selectedIds.size === 0) return;
    saveHistory();
    let newNodes = [...nodes], newEdges = [...edges], idsToDelete = new Set();

    if (isCtrlPressed) {
        selectedIds.forEach(id => {
            if (id.startsWith('edge_')) {
                const connected = getConnectedEdges(id);
                connected.forEach(eid => idsToDelete.add(eid));
            } else {
                idsToDelete.add(id);
                if (nodes.find(n => n.id === id)?.type === 'component') nodes.filter(n => n.parentId === id).forEach(n => idsToDelete.add(n.id));
            }
        });
    } else {
        selectedIds.forEach(id => {
            idsToDelete.add(id);
            if (nodes.find(n => n.id === id)?.type === 'component') nodes.filter(n => n.parentId === id).forEach(n => idsToDelete.add(n.id));
        });
    }

    newEdges = newEdges.filter(e => !idsToDelete.has(e.id) && !idsToDelete.has(e.source) && !idsToDelete.has(e.target));
    newNodes = newNodes.filter(n => !idsToDelete.has(n.id));
    
    const degree = new Map();
    newEdges.forEach(e => { degree.set(e.source, (degree.get(e.source)||0)+1); degree.set(e.target, (degree.get(e.target)||0)+1); });
    newNodes = newNodes.filter(n => n.type !== 'net_node' || (degree.get(n.id)||0) > 0);

    setNodes(newNodes); setEdges(newEdges); setSelectedIds(new Set());
  }, [selectedIds, nodes, edges, saveHistory, getConnectedEdges]);

  useEffect(() => {
    const handleKeyDown = (e) => {
        if (dialog.isOpen || showSettings) return; 
        const activeTag = document.activeElement.tagName.toLowerCase();
        if (activeTag === 'input' || activeTag === 'textarea') return;

        const key = e.key.toLowerCase();

        // Tool Selection Shortcuts
        if (key === 's') { setMode(MODE.VIEW); setSelectedIds(new Set()); cancelConnect(); }
        else if (key === 'r') { setMode(MODE.ADD_COMP); setSelectedIds(new Set()); cancelConnect(); }
        else if (key === 'e') { setMode(MODE.ADD_PORT); setSelectedIds(new Set()); cancelConnect(); }
        else if (key === 'w') { setMode(MODE.CONNECT); setSelectedIds(new Set()); cancelConnect(); }

        // Navigation
        else if (key === 'a') switchFile(-1);
        else if (key === 'd') switchFile(1);

        // Edit Actions
        else if (e.ctrlKey && key === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
        else if (e.ctrlKey && key === 'y') { e.preventDefault(); redo(); }
        else if (e.key === 'Delete' || e.key === 'Backspace') { deleteSelected(e.ctrlKey); }
        else if (e.key === 'Escape') { 
            if (connectStartId) cancelConnect();
            else if (mode !== MODE.VIEW) setMode(MODE.VIEW); // Esc: Back to View
            else setSelectedIds(new Set());
        }
        
        // Toggles
        else if (key === 'p') { setShowPorts(prev => !prev); }
        else if (key === 'l') { setShowLabels(prev => !prev); }
        else if (key === 'h') { setHideAll(prev => !prev); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo, dialog.isOpen, showSettings, connectStartId, currentFileIndex, fileList, nodes, edges, deleteSelected, mode]);

  const screenToWorld = useCallback((sx, sy) => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    return { x: (sx - rect.left - transform.x) / transform.k, y: (sy - rect.top - transform.y) / transform.k };
  }, [transform]);

  const cancelConnect = useCallback(() => { setConnectStartId(null); setDragState(null); }, []);

  const handleMouseDown = (e) => {
    if (e.button === 2) { if (connectStartId) cancelConnect(); return; }
    const { x: wx, y: wy } = screenToWorld(e.clientX, e.clientY);
    let hitNode = null, hitEdge = null, hitResizeHandle = null;
    const clickThreshold = 10 / transform.k;

    if (selectedIds.size === 1) {
        const selId = [...selectedIds][0];
        const selNode = nodes.find(n => n.id === selId);
        if (selNode?.type === 'component' && Math.hypot(selNode.position.x + selNode.width - wx, selNode.position.y + selNode.height - wy) < clickThreshold * 1.5) {
            hitResizeHandle = selNode;
        }
    }
    
    if (!hitResizeHandle) {
         for (let i = nodes.length - 1; i >= 0; i--) {
            if ((nodes[i].type === 'port' || nodes[i].type === 'net_node') && Math.hypot(nodes[i].position.x - wx, nodes[i].position.y - wy) < clickThreshold) { hitNode = nodes[i]; break; }
        }
    }

    if (!hitResizeHandle && !hitNode && !hitEdge && (mode === MODE.VIEW || mode === MODE.ADD_PORT || mode === MODE.ADD_COMP)) {
        for (let i = nodes.length - 1; i >= 0; i--) {
            const n = nodes[i];
            if (n.type === 'component' && wx >= n.position.x && wx <= n.position.x + n.width && wy >= n.position.y && wy <= n.position.y + n.height) { hitNode = n; break; }
        }
    }

    if (!hitResizeHandle && !hitNode && mode === MODE.VIEW) {
        for (const edge of edges) {
            const s = nodes.find(n => n.id === edge.source);
            const t = nodes.find(n => n.id === edge.target);
            if (s && t) {
                const A = wx - s.position.x, B = wy - s.position.y, C = t.position.x - s.position.x, D = t.position.y - s.position.y;
                const dot = A * C + B * D;
                const lenSq = C * C + D * D;
                let param = -1;
                if (lenSq !== 0) param = dot / lenSq;
                let xx, yy;
                if (param < 0) { xx = s.position.x; yy = s.position.y; }
                else if (param > 1) { xx = t.position.x; yy = t.position.y; }
                else { xx = s.position.x + param * C; yy = s.position.y + param * D; }
                const dist = Math.hypot(wx - xx, wy - yy);
                if (dist < 5 / transform.k) { hitEdge = edge; break; }
            }
        }
    }

    if (hitResizeHandle) {
        saveHistory(); // Save before resizing
        setDragState({ type: 'RESIZE', startX: e.clientX, startY: e.clientY, node: hitResizeHandle });
    } else if (mode === MODE.VIEW) {
        if (hitNode || hitEdge) {
            const item = hitNode || hitEdge;
            const newSel = e.ctrlKey ? new Set(selectedIds).has(item.id) ? new Set([...selectedIds].filter(x=>x!==item.id)) : new Set([...selectedIds, item.id]) : new Set([item.id]);
            setSelectedIds(newSel);
            if (hitNode) {
                saveHistory(); // Save before dragging node
                setDragState({ type: 'NODE', startX: e.clientX, startY: e.clientY, nodeIds: [...newSel] });
            }
        } else {
            if (!e.ctrlKey) setSelectedIds(new Set());
            setDragState({ type: 'PAN', startX: e.clientX, startY: e.clientY, startTrans: { ...transform } });
        }
    } else if (mode === MODE.ADD_COMP) {
        if (hitNode) {
            const newSel = new Set([hitNode.id]);
            setSelectedIds(newSel);
            saveHistory();
            setDragState({ type: 'NODE', startX: e.clientX, startY: e.clientY, nodeIds: [...newSel] });
        } else {
            setDragState({ type: 'DRAW', startX: wx, startY: wy, currX: wx, currY: wy });
        }
    } else if (mode === MODE.CONNECT) {
        if (hitNode && (hitNode.type === 'port' || hitNode.type === 'net_node')) {
            if (connectStartId) { handleConnect(connectStartId, hitNode.id); setConnectStartId(hitNode.id); } 
            else { setConnectStartId(hitNode.id); }
            setDragState({ type: 'CONNECTING', currX: wx, currY: wy });
        } else if (connectStartId) {
            saveHistory();
            const startNode = nodes.find(n => n.id === connectStartId);
            let netName = startNode?.data?.netName || `net${Math.floor(Math.random()*1000)}`;
            const newNodeId = getId();
            setNodes(prev => [...prev, { id: newNodeId, type: 'net_node', position: { x: wx, y: wy }, data: { netName } }]);
            setEdges(prev => [...prev, { id: `edge_${getId()}`, source: connectStartId, target: newNodeId, type: 'net_edge', data: { netName } }]);
            setConnectStartId(newNodeId);
            setDragState({ type: 'CONNECTING', currX: wx, currY: wy });
        } else {
            setDragState({ type: 'PAN', startX: e.clientX, startY: e.clientY, startTrans: { ...transform } });
        }
    } else if (mode === MODE.ADD_PORT) {
        if (hitNode && (hitNode.type === 'port' || hitNode.type === 'net_node')) {
            const newSel = new Set([hitNode.id]);
            setSelectedIds(newSel);
            saveHistory();
            setDragState({ type: 'NODE', startX: e.clientX, startY: e.clientY, nodeIds: [...newSel] });
        } else {
            const context = (hitNode && hitNode.type === 'component') ? { type: 'int', parent: hitNode } : { type: 'ext' };
            setDialog({ 
                isOpen: true, 
                type: 'port', 
                data: { x: wx, y: wy, context }, 
                options: { compTypes: uniqueComponentTypes, portNames: uniquePortNames },
                position: { x: e.clientX, y: e.clientY } // Pass screen coords
            }); 
        }
    }
  };

  const handleMouseMove = (e) => {
    const { x: wx, y: wy } = screenToWorld(e.clientX, e.clientY);
    setCursorPos({ x: Math.round(wx), y: Math.round(wy) }); 
    setScreenCursor({ x: e.clientX, y: e.clientY });

    // --- Hover Detection ---
    if (!dragState && !dialog.isOpen) {
        let hover = null;
        const hoverThreshold = 10 / transform.k;
        
        // Check Ports & Net Nodes
        for (let i = nodes.length - 1; i >= 0; i--) {
            if ((nodes[i].type === 'port' || nodes[i].type === 'net_node') && 
                Math.hypot(nodes[i].position.x - wx, nodes[i].position.y - wy) < hoverThreshold) { 
                hover = nodes[i]; break; 
            }
        }
        // Check Components
        if (!hover) {
            for (let i = nodes.length - 1; i >= 0; i--) {
                const n = nodes[i];
                if (n.type === 'component' && wx >= n.position.x && wx <= n.position.x + n.width && wy >= n.position.y && wy <= n.position.y + n.height) { 
                    hover = n; break; 
                }
            }
        }
        setHoveredNode(hover);
    } else {
        setHoveredNode(null);
    }

    if (dragState?.type === 'CONNECTING') { setDragState(prev => ({ ...prev, currX: wx, currY: wy })); return; }
    if (!dragState) return;

    if (dragState.type === 'PAN') {
        setTransform({ ...transform, x: dragState.startTrans.x + e.clientX - dragState.startX, y: dragState.startTrans.y + e.clientY - dragState.startY });
    } else if (dragState.type === 'NODE') {
        const dx = e.movementX / transform.k, dy = e.movementY / transform.k;
        setNodes(prev => {
            const moving = new Set(dragState.nodeIds);
            const parentIds = new Set(prev.filter(n => moving.has(n.id) && n.type === 'component').map(n => n.id));
            prev.filter(n => parentIds.has(n.parentId)).forEach(n => moving.add(n.id));
            
            return prev.map(n => {
                if (moving.has(n.id)) {
                    let nx = n.position.x + dx, ny = n.position.y + dy;
                    if (n.type === 'port' && n.parentId) {
                        const p = prev.find(x => x.id === n.parentId);
                        if (p && !parentIds.has(p.id)) {
                             nx = Math.max(p.position.x, Math.min(p.position.x + p.width, nx));
                             ny = Math.max(p.position.y, Math.min(p.position.y + p.height, ny));
                        }
                    }
                    return { ...n, position: { x: nx, y: ny } };
                }
                return n;
            });
        });
    } else if (dragState.type === 'RESIZE') {
        const dx = (e.clientX - dragState.startX) / transform.k, dy = (e.clientY - dragState.startY) / transform.k;
        setNodes(prev => prev.map(n => n.id === dragState.node.id ? { ...n, width: Math.max(20, dragState.node.width + dx), height: Math.max(20, dragState.node.height + dy) } : n));
        setDragState(prev => ({ ...prev, startX: e.clientX, startY: e.clientY, node: { ...dragState.node, width: Math.max(20, dragState.node.width + dx), height: Math.max(20, dragState.node.height + dy) } }));
    } else if (dragState.type === 'DRAW') {
        setDragState(prev => ({ ...prev, currX: wx, currY: wy }));
    }
  };

  const handleMouseUp = (e) => {
    if (dragState?.type === 'DRAW') {
        const w = Math.abs(dragState.currX - dragState.startX), h = Math.abs(dragState.currY - dragState.startY);
        if (w > 10 && h > 10) {
            setDialog({ 
                isOpen: true, 
                type: 'comp', 
                data: { x: Math.min(dragState.startX, dragState.currX), y: Math.min(dragState.startY, dragState.currY), w, h }, 
                options: { compTypes: uniqueComponentTypes, portNames: uniquePortNames },
                position: { x: e.clientX, y: e.clientY } // Pass screen coords
            });
        }
    }
    if (dragState?.type !== 'CONNECTING') setDragState(null);
  };

  const handleConnect = (sourceId, targetId) => {
      if (sourceId === targetId) return;

      const netA = nodes.find(n=>n.id===sourceId)?.data?.netName || edges.find(e=>e.source===sourceId||e.target===sourceId)?.data?.netName;
      const netB = nodes.find(n=>n.id===targetId)?.data?.netName || edges.find(e=>e.source===targetId||e.target===targetId)?.data?.netName;

      if (netA && netB && netA !== netB) {
          setDialog({ 
              isOpen: true, 
              type: 'MERGE_CONFIRM', 
              data: { netA, netB, sourceId, targetId },
              onConfirm: () => handleMergeConfirm(netA, netB, sourceId, targetId),
              onCancel: () => setDialog({ isOpen: false })
          });
          return;
      }
      
      createConnection(sourceId, targetId, netA, netB);
  };

  const createConnection = (sourceId, targetId, netA, netB) => {
      saveHistory();
      const finalNet = netA || netB || `net${Math.floor(Math.random()*10000)}`;
      setEdges(prev => [...prev, { id: `edge_${getId()}`, source: sourceId, target: targetId, type: 'net_edge', data: { netName: finalNet } }]);
      setNodes(prev => prev.map(n => (n.id === sourceId || n.id === targetId) && !n.data.netName ? { ...n, data: { ...n.data, netName: finalNet } } : n));
  };

  const handleMergeConfirm = (netA, netB, sourceId, targetId) => {
      saveHistory();
      const newNetName = netA;
      setNodes(prev => prev.map(n => n.data.netName === netB ? { ...n, data: { ...n.data, netName: newNetName } } : n));
      setEdges(prev => prev.map(e => e.data.netName === netB ? { ...e, data: { ...e.data, netName: newNetName } } : e));
      setEdges(prev => [...prev, { id: `edge_${getId()}`, source: sourceId, target: targetId, type: 'net_edge', data: { netName: newNetName } }]);
      setDialog({ isOpen: false });
  };

  const propagateNetRename = (startEdgeId, newNetName) => {
      const connected = getConnectedEdges(startEdgeId);
      const affectedNodes = new Set();
      edges.forEach(e => {
          if (connected.has(e.id)) {
              affectedNodes.add(e.source);
              affectedNodes.add(e.target);
          }
      });

      setEdges(prev => prev.map(e => connected.has(e.id) ? { ...e, data: { ...e.data, netName: newNetName } } : e));
      setNodes(prev => prev.map(n => affectedNodes.has(n.id) && (n.type === 'port' || n.type === 'net_node') ? { ...n, data: { ...n.data, netName: newNetName } } : n));
  };

  const handleDialogConfirm = (name, type) => {
      saveHistory();
      if (dialog.type === 'comp') {
          const { x, y, w, h } = dialog.data;
          setNodes(prev => [...prev, { id: `comp_${name}`, type: 'component', position: { x, y }, width: w, height: h, data: { label: name, type } }]);
      } else if (dialog.type === 'port') {
          const { x, y, context } = dialog.data;
          setNodes(prev => [...prev, { id: getId(), type: 'port', position: { x, y }, parentId: context.type === 'int' ? context.parent.id : null, data: { label: name, isExternal: context.type === 'ext', compName: context.type === 'int' ? context.parent.data.label : 'ext' } }]);
      }
      setDialog({ isOpen: false, type: '', data: null });
  };

  const downloadCurrentJson = () => {
      const blob = new Blob([reactStateToPythonData(nodes, edges)], {type:'application/json'});
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (fileList[currentFileIndex]?.name.replace(/\.[^/.]+$/, "") || "circuit") + ".json";
      a.click();
  };

  const filteredFiles = fileList.filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase()));
  const singleSelected = selectedIds.size === 1 ? (nodes.find(n => n.id === [...selectedIds][0]) || edges.find(e => e.id === [...selectedIds][0])) : null;

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-200 font-sans overflow-hidden transition-colors duration-200">
        {notification && <Notification message={notification} onClose={() => setNotification(null)} />}
        <ModalDialog isOpen={dialog.isOpen} type={dialog.type} data={dialog.data} options={dialog.options} initialName={dialog.initialName} position={dialog.position} onConfirm={dialog.onConfirm || handleDialogConfirm} onCancel={dialog.onCancel || (() => setDialog({ isOpen: false }))} />
        <SettingsDialog isOpen={showSettings} onClose={() => setShowSettings(false)} appSettings={appSettings} setAppSettings={setAppSettings} theme={theme} setTheme={setTheme} />
        
        {/* Hover Tooltip */}
        {hoveredNode && !dragState && !dialog.isOpen && (
            <div className="fixed z-[100] pointer-events-none bg-slate-900/90 backdrop-blur text-white text-xs p-2 rounded border border-slate-700 shadow-xl"
                 style={{ left: screenCursor.x + 15, top: screenCursor.y + 15 }}>
                <div className="font-bold text-blue-300 mb-0.5">{hoveredNode.type === 'component' ? 'Component' : (hoveredNode.type === 'port' ? 'Port' : 'Net Node')}</div>
                <div className="font-mono">{hoveredNode.data?.label || hoveredNode.id}</div>
                {hoveredNode.data?.type && <div className="text-slate-400">{hoveredNode.data.type}</div>}
                {hoveredNode.data?.netName && <div className="text-green-400 mt-1">Net: {hoveredNode.data.netName}</div>}
            </div>
        )}

        {/* Global Datalists removed - replaced by AutocompleteInput */}

        {/* --- Top Bar --- */}
        <div className="h-14 bg-slate-950 border-b border-slate-800 flex items-center px-4 justify-between shrink-0">
            <div className="flex items-center gap-3">
                <div className="bg-blue-600 p-1.5 rounded-lg"><Network size={20} className="text-white"/></div>
                <div>
                    <h1 className="font-bold text-lg leading-tight text-white">Circuit Studio</h1>
                    <div className="text-[10px] text-slate-500 font-medium tracking-wider">PROFESSIONAL LABELER</div>
                </div>
            </div>
            <div className="flex items-center gap-4">
                <div className="flex bg-slate-800 rounded-md p-1 border border-slate-700 items-center">
                    <button onClick={undo} disabled={past.length===0} className="p-2 hover:bg-slate-700 rounded text-slate-400 hover:text-white disabled:opacity-30"><Undo size={16}/></button>
                    <button onClick={redo} disabled={future.length===0} className="p-2 hover:bg-slate-700 rounded text-slate-400 hover:text-white disabled:opacity-30"><Redo size={16}/></button>
                </div>
                
                <button onClick={() => setShowSettings(true)} className="flex items-center gap-2 px-3 py-1.5 text-slate-300 hover:text-white hover:bg-slate-800 rounded transition-colors text-sm font-medium">
                    <Settings size={16} />
                    <span>Settings</span>
                </button>

                <button onClick={downloadCurrentJson} disabled={currentFileIndex===-1} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-md text-sm font-bold flex items-center gap-2 transition-colors shadow-lg shadow-blue-900/20 disabled:opacity-50 disabled:cursor-not-allowed">
                    <Save size={16}/> SAVE JSON
                </button>
            </div>
        </div>

        {/* --- Workspace --- */}
        <div className="flex flex-1 overflow-hidden">
            {/* Left Sidebar: Combined File Browser & Inspector */}
            <div ref={sidebarRef} className="w-72 bg-slate-900 border-r border-slate-800 flex flex-col shrink-0 z-20 shadow-xl relative">
                {/* 1. Top Section: File Browser */}
                <div style={{ height: `${sidebarSplit}%`, minHeight: '10%', maxHeight: '90%' }} className="flex flex-col min-h-0">
                    <div className="p-3 border-b border-slate-800 flex items-center gap-2 bg-slate-950/50 text-slate-200">
                        <FolderOpen size={14} className="text-blue-500"/>
                        <span className="text-xs font-bold uppercase tracking-wider">Project Files</span>
                    </div>
                    
                    <div className="p-3 border-b border-slate-800 space-y-2">
                        <button onClick={() => fileInputRef.current.click()} className="w-full bg-slate-800 hover:bg-slate-700 text-slate-200 py-1.5 rounded border border-slate-700 flex items-center justify-center gap-2 text-xs font-medium transition-colors">
                            <Plus size={14}/> Add Files
                        </button>
                        <input ref={fileInputRef} type="file" multiple accept="image/*,.json" className="hidden" onChange={handleFileUpload} />
                        <div className="relative">
                            <Search size={12} className="absolute left-2.5 top-2 text-slate-500"/>
                            <input type="text" placeholder="Filter..." className="w-full bg-slate-950 border border-slate-800 rounded py-1.5 pl-7 pr-2 text-[11px] text-slate-300 focus:border-blue-500 outline-none" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}/>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto custom-scrollbar">
                        {filteredFiles.length === 0 ? <div className="p-4 text-center text-slate-600 text-[10px] italic">No files loaded</div> : (
                            <div className="flex flex-col">
                                {filteredFiles.map((f, i) => {
                                    const realIdx = fileList.indexOf(f);
                                    const isActive = realIdx === currentFileIndex;
                                    return (
                                        <div key={f.id} onClick={() => { saveCurrentStateToMemory(); loadFile(realIdx); }} 
                                            className={`flex items-center px-3 py-2 cursor-pointer border-l-2 transition-all ${isActive ? 'bg-blue-900/20 border-blue-500 text-white' : 'border-transparent text-slate-400 hover:bg-slate-800 hover:text-slate-200'}`}>
                                            <CheckCircle2 size={10} className={`mr-2 ${f.status === 'annotated' || f.data ? 'text-green-500' : 'text-slate-700'}`}/>
                                            <span className="text-xs truncate font-medium">{f.name}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                    
                    <div className="p-2 bg-slate-950 border-t border-slate-800 flex justify-between items-center text-[10px] text-slate-500 shrink-0">
                        <button onClick={() => switchFile(-1)} className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition-colors"><ChevronLeft size={14}/></button>
                        <span className="font-mono">{fileList.length > 0 ? `${currentFileIndex + 1}/${fileList.length}` : '-/-'}</span>
                        <button onClick={() => switchFile(1)} className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition-colors"><ChevronRight size={14}/></button>
                    </div>
                </div>

                {/* Resizer Handle */}
                <div 
                    className="h-1 bg-slate-950 border-y border-slate-800 cursor-row-resize hover:bg-blue-600 transition-colors flex items-center justify-center group z-10"
                    onMouseDown={() => setIsResizingSidebar(true)}
                >
                    <GripHorizontal size={12} className="text-slate-700 group-hover:text-white/50"/>
                </div>

                {/* 2. Bottom Section: Inspector (Flexible) */}
                <div className="flex-1 flex flex-col bg-slate-900 overflow-hidden relative">
                     {/* Local Datalists removed, using global-comp-types and global-port-names defined at root */}
                     
                     <div className="h-9 border-b border-slate-800 flex items-center px-4 font-bold text-xs text-slate-400 uppercase tracking-wider bg-slate-950/50 shrink-0">
                        <Settings size={14} className="mr-2 text-slate-500"/> Properties
                     </div>
                     <div className="flex-1 overflow-y-auto p-4">
                         {singleSelected ? (
                             singleSelected.type === 'component' ? (
                                 <div className="space-y-4 animate-in fade-in slide-in-from-right-5 duration-200">
                                     <div><label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Name</label><input className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm text-slate-200 outline-none focus:border-blue-500 placeholder-slate-600" value={singleSelected.data.label} onChange={e => { saveHistory(); const v=e.target.value; setNodes(prev => prev.map(n => n.id === singleSelected.id ? { ...n, data: { ...n.data, label: v } } : n)); }} /></div>
                                     <div><label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Type</label>
                                        <AutocompleteInput 
                                            className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm text-slate-200 outline-none focus:border-blue-500 placeholder-slate-600" 
                                            options={uniqueComponentTypes}
                                            value={singleSelected.data.type} 
                                            onFocus={(e) => e.target.select()}
                                            onChange={v => { saveHistory(); setNodes(prev => prev.map(n => n.id === singleSelected.id ? { ...n, data: { ...n.data, type: v } } : n)); }} 
                                        />
                                     </div>
                                     
                                     <div className="pt-2 border-t border-slate-800">
                                         <label className="text-[10px] font-bold text-slate-400 uppercase mb-2 block">Ports</label>
                                         <div className="space-y-1">
                                             {nodes.filter(n => n.parentId === singleSelected.id).map(p => {
                                                const hasConflict = conflicts.has(p.id);
                                                return (
                                                 <div key={p.id} className="flex flex-col gap-1 mb-2">
                                                     <div className="flex gap-2">
                                                         <AutocompleteInput 
                                                            className={`flex-1 bg-slate-800 border rounded px-1.5 py-0.5 text-xs text-slate-300 outline-none focus:border-blue-500 ${hasConflict ? 'border-red-500/50 bg-red-900/10 text-red-300' : 'border-slate-700'}`} 
                                                            options={uniquePortNames}
                                                            onFocus={(e) => e.target.select()}
                                                            value={p.data.label} 
                                                            onChange={v => { saveHistory(); setNodes(prev => prev.map(n => n.id === p.id ? { ...n, data: { ...n.data, label: v } } : n)); }}
                                                         />
                                                         <input className="w-16 bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5 text-[10px] text-slate-300 outline-none focus:border-blue-500 placeholder-slate-600" value={p.data.type||''} placeholder="Type" onChange={e => { saveHistory(); const v=e.target.value; setNodes(prev => prev.map(n => n.id === p.id ? { ...n, data: { ...n.data, type: v } } : n)); }}/>
                                                     </div>
                                                     {hasConflict && <div className="text-[9px] text-red-400 flex items-center gap-1"><AlertTriangle size={10}/> Net Conflict Detected</div>}
                                                 </div>
                                                );
                                             })}
                                             <button onClick={() => { saveHistory(); setNodes(prev => [...prev, { id: getId(), type: 'port', position: { x: singleSelected.position.x + 10, y: singleSelected.position.y + 10 }, parentId: singleSelected.id, data: { label: `P${nodes.filter(n => n.parentId === singleSelected.id).length + 1}`, isExternal: false, compName: singleSelected.data.label } }]); }} className="w-full py-1 text-xs text-blue-400 border border-dashed border-blue-900 rounded hover:bg-blue-900/20 mt-2">+ Add Port</button>
                                         </div>
                                     </div>

                                     {/* Position & Size Editing (Moved to bottom) */}
                                     <div className="pt-2 border-t border-slate-800">
                                         <div className="grid grid-cols-2 gap-2">
                                             <div>
                                                 <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">X</label>
                                                 <input className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-300 font-mono outline-none focus:border-blue-500" 
                                                     type="number" value={Math.round(singleSelected.position.x)} 
                                                     onChange={e => { saveHistory(); const v=parseInt(e.target.value); setNodes(prev => prev.map(n => n.id === singleSelected.id ? { ...n, position: { ...n.position, x: v } } : n)); }} />
                                             </div>
                                             <div>
                                                 <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Y</label>
                                                 <input className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-300 font-mono outline-none focus:border-blue-500" 
                                                     type="number" value={Math.round(singleSelected.position.y)} 
                                                     onChange={e => { saveHistory(); const v=parseInt(e.target.value); setNodes(prev => prev.map(n => n.id === singleSelected.id ? { ...n, position: { ...n.position, y: v } } : n)); }} />
                                             </div>
                                             <div>
                                                 <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">W</label>
                                                 <input className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-300 font-mono outline-none focus:border-blue-500" 
                                                     type="number" value={Math.round(singleSelected.width)} 
                                                     onChange={e => { saveHistory(); const v=parseInt(e.target.value); setNodes(prev => prev.map(n => n.id === singleSelected.id ? { ...n, width: v } : n)); }} />
                                             </div>
                                             <div>
                                                 <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">H</label>
                                                 <input className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-300 font-mono outline-none focus:border-blue-500" 
                                                     type="number" value={Math.round(singleSelected.height)} 
                                                     onChange={e => { saveHistory(); const v=parseInt(e.target.value); setNodes(prev => prev.map(n => n.id === singleSelected.id ? { ...n, height: v } : n)); }} />
                                             </div>
                                         </div>
                                     </div>

                                     <button onClick={() => deleteSelected(false)} className="w-full py-2 bg-red-900/20 text-red-400 border border-red-900/50 rounded text-xs font-bold hover:bg-red-900/40 flex justify-center gap-2 mt-4"><Trash2 size={14}/> Delete Component</button>
                                 </div>
                             ) : (
                                 // Wire / Net / Port Selection
                                 <div className="space-y-4 animate-in fade-in slide-in-from-right-5 duration-200">
                                    <div className="flex items-center gap-2 mb-2 pb-2 border-b border-slate-800">
                                        <Network size={16} className="text-slate-400"/>
                                        <span className="text-xs font-bold text-slate-300">
                                           {singleSelected.type === 'net_edge' ? 'Wire Segment' : (singleSelected.type === 'port' ? 'Port' : 'Net Node')}
                                        </span>
                                    </div>
                                    
                                    {/* Port Name & Type Editing */}
                                    {singleSelected.type === 'port' && (
                                        <div className="mb-4 pb-4 border-b border-slate-800 space-y-3">
                                            <div>
                                                <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Name</label>
                                                <AutocompleteInput 
                                                    className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm text-slate-200 outline-none focus:border-blue-500 placeholder-slate-600"
                                                    options={uniquePortNames}
                                                    value={singleSelected.data.label} 
                                                    onFocus={(e) => e.target.select()}
                                                    onChange={v => { saveHistory(); setNodes(prev => prev.map(n => n.id === singleSelected.id ? { ...n, data: { ...n.data, label: v } } : n)); }}
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Type</label>
                                                <input className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm text-slate-200 outline-none focus:border-blue-500 placeholder-slate-600" 
                                                    value={singleSelected.data.type || ''} 
                                                    placeholder="e.g. IN/OUT"
                                                    onChange={e => { saveHistory(); const v=e.target.value; setNodes(prev => prev.map(n => n.id === singleSelected.id ? { ...n, data: { ...n.data, type: v } } : n)); }} 
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {/* Net Name Input with Propagation */}
                                     <div>
                                         <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Net Name</label>
                                         <div className="flex gap-2">
                                            <input className={`w-full bg-slate-800 border rounded px-2 py-1.5 text-sm text-slate-200 outline-none focus:border-blue-500 placeholder-slate-600 ${conflicts.has(singleSelected.id) ? 'border-red-500/50 bg-red-900/10' : 'border-slate-700'}`} 
                                                value={singleSelected.data?.netName || ''} 
                                                onChange={e => { 
                                                    saveHistory(); 
                                                    const v = e.target.value;
                                                    if (singleSelected.type === 'net_edge') {
                                                        propagateNetRename(singleSelected.id, v);
                                                    } else {
                                                        setNodes(prev => prev.map(n => n.id === singleSelected.id ? { ...n, data: { ...n.data, netName: v } } : n));
                                                    }
                                                }} 
                                                placeholder="No Net"
                                            />
                                         </div>
                                         {conflicts.has(singleSelected.id) && (
                                             <div className="mt-2 text-xs text-red-400 bg-red-900/20 p-2 rounded border border-red-900/30 flex items-start gap-2">
                                                 <AlertTriangle size={14} className="shrink-0 mt-0.5"/>
                                                 <span>此节点连接了多个不同的网络名称。请修正以解决冲突。</span>
                                             </div>
                                         )}
                                     </div>

                                     {/* Node Position Editing (Moved to bottom) */}
                                     {singleSelected.type !== 'net_edge' && (
                                         <div className="pt-2 border-t border-slate-800">
                                             <div className="grid grid-cols-2 gap-2">
                                                 <div>
                                                     <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">X</label>
                                                     <input className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-300 font-mono outline-none focus:border-blue-500" 
                                                         type="number" value={Math.round(singleSelected.position.x)} 
                                                         onChange={e => { saveHistory(); const v=parseInt(e.target.value); setNodes(prev => prev.map(n => n.id === singleSelected.id ? { ...n, position: { ...n.position, x: v } } : n)); }} />
                                                 </div>
                                                 <div>
                                                     <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Y</label>
                                                     <input className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-300 font-mono outline-none focus:border-blue-500" 
                                                         type="number" value={Math.round(singleSelected.position.y)} 
                                                         onChange={e => { saveHistory(); const v=parseInt(e.target.value); setNodes(prev => prev.map(n => n.id === singleSelected.id ? { ...n, position: { ...n.position, y: v } } : n)); }} />
                                                 </div>
                                             </div>
                                         </div>
                                     )}

                                     <div className="grid grid-cols-2 gap-2 mt-4">
                                        <button onClick={() => deleteSelected(false)} className="py-2 bg-slate-800 text-slate-400 rounded text-[10px] font-bold hover:bg-slate-700 flex justify-center gap-1 border border-slate-700"><Trash2 size={12}/> Del Segment</button>
                                        <button onClick={() => deleteSelected(true)} className="py-2 bg-red-900/20 text-red-400 rounded text-[10px] font-bold hover:bg-red-900/40 flex justify-center gap-1 border border-red-900/50"><Trash2 size={12}/> Del Net</button>
                                     </div>
                                 </div>
                             )
                         ) : (
                             <div className="h-full flex flex-col items-center justify-center text-slate-700 gap-2">
                                 <MousePointer2 size={48} strokeWidth={1} className="text-slate-700"/>
                                 <div className="text-center">
                                     <p className="text-sm font-bold text-slate-600">No Selection</p>
                                     <p className="text-xs text-slate-600 mt-1">Select an object to edit</p>
                                 </div>
                             </div>
                         )}
                     </div>
                </div>
            </div>

            {/* Center: Canvas */}
            <div className="flex-1 relative flex flex-col bg-slate-50 dark:bg-slate-900 overflow-hidden transition-colors duration-200">
                {/* Grid Background Pattern */}
                <div className="absolute inset-0 pointer-events-none opacity-50 dark:opacity-20" 
                    style={{ 
                        backgroundImage: `radial-gradient(${theme === 'light' ? '#94a3b8' : '#cbd5e1'} 1px, transparent 1px)`, 
                        backgroundSize: '20px 20px',
                        transform: `translate(${transform.x % 20}px, ${transform.y % 20}px)`
                    }} 
                />

                {/* Crosshair Overlay */}
                {appSettings.showCrosshair && (
                    <div className="fixed inset-0 pointer-events-none z-[100] overflow-hidden">
                        <div className="absolute bg-blue-500/30" style={{ left: screenCursor.x, top: 0, bottom: 0, width: 1 }}></div>
                        <div className="absolute bg-blue-500/30" style={{ top: screenCursor.y, left: 0, right: 0, height: 1 }}></div>
                    </div>
                )}

                {/* Floating Toolbar (Left Vertical) */}
                <div className="absolute left-4 top-1/2 -translate-y-1/2 flex flex-col gap-1 bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm p-1.5 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 z-50 ring-1 ring-black/5 dark:ring-white/5">
                    <button onClick={fitView} className="p-2 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-slate-200 rounded-md transition-colors" title="Fit Screen (Center)"><Maximize size={20} /></button>
                    <div className="h-px w-full bg-slate-200 dark:bg-slate-700 my-1"></div>
                    {[
                        { m: MODE.VIEW, icon: MousePointer2, label: 'Select (S)' },
                        { m: MODE.ADD_COMP, icon: Crop, label: 'Component (R)' },
                        { m: MODE.ADD_PORT, icon: CircleDot, label: 'Port (E)' },
                        { m: MODE.CONNECT, icon: Network, label: 'Connect (W)' },
                    ].map(t => (
                        <button key={t.m} onClick={() => { setMode(t.m); setSelectedIds(new Set()); cancelConnect(); }}
                            className={`p-2 rounded-md transition-all ${mode === t.m ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-slate-200'}`} title={t.label}>
                            <t.icon size={20} strokeWidth={mode === t.m ? 2.5 : 2}/>
                        </button>
                    ))}
                    <div className="h-px w-full bg-slate-200 dark:bg-slate-700 my-1"></div>
                    <button onClick={() => setDialog({ isOpen: true, type: 'comp', data: {x:100,y:100,w:100,h:100} })} className="p-2 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-slate-200 rounded-md transition-colors" title="New Box"><Plus size={20}/></button>
                </div>

                {/* Canvas */}
                <div ref={containerRef} className="flex-1 relative cursor-crosshair overflow-hidden" 
                    onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp}
                    onWheel={e => {
                        const rect = containerRef.current.getBoundingClientRect();
                        const d = e.deltaY > 0 ? -0.1 : 0.1;
                        const k = Math.max(0.1, Math.min(5, transform.k + d));
                        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
                        const r = k / transform.k;
                        setTransform({ x: mx - (mx - transform.x) * r, y: my - (my - transform.y) * r, k });
                    }}
                    onContextMenu={e => e.preventDefault()}>
                    
                    <div style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.k})`, transformOrigin: '0 0', position: 'absolute', top: 0, left: 0 }}>
                        {bgImage && <img src={bgImage} style={{ maxWidth: 'none', maxHeight: 'none' }} className="pointer-events-none opacity-90 select-none shadow-lg block" draggable={false} alt="" />}
                        
                        <svg className="absolute top-0 left-0 overflow-visible pointer-events-none" style={{width:1,height:1,zIndex:10}}>
                            {edges.map(e => <ConnectionSegment key={e.id} from={nodes.find(n=>n.id===e.source)?.position} to={nodes.find(n=>n.id===e.target)?.position} netName={e.data?.netName} isSelected={selectedIds.has(e.id)} isRelated={highlightedNetNames.has(e.data?.netName) && !selectedIds.has(e.id)} isConflict={conflicts.has(e.id)} width={appSettings.defaultLineWidth} />)}
                            {connectStartId && dragState?.type==='CONNECTING' && <ConnectionSegment from={nodes.find(n=>n.id===connectStartId)?.position} to={{x:dragState.currX,y:dragState.currY}} isTemp width={appSettings.defaultLineWidth} />}
                        </svg>

                        {nodes.map(n => {
                            const sel = selectedIds.has(n.id);
                            const isConflict = conflicts.has(n.id);
                            
                            if (n.type === 'component') {
                                return (
                                    <div key={n.id} className={`absolute border-2 transition-shadow ${sel ? 'shadow-[0_0_20px_rgba(37,99,235,0.5)] ring-1 ring-blue-500' : ''}`}
                                        style={{ left: n.position.x, top: n.position.y, width: n.width, height: n.height, backgroundColor: getComponentColor(n.data.type, appSettings.defaultBoxOpacity), borderColor: sel ? '#2563eb' : getComponentStrokeColor(n.data.type), zIndex: 5 }}>
                                        {!hideAll && showLabels && (
                                            <>
                                                {/* Type: Top Left */}
                                                <div className="absolute top-0 left-0 px-1 py-0.5 pointer-events-none whitespace-nowrap" 
                                                     style={{ backgroundColor: getComponentColor(n.data.type, 0.8), borderBottomRightRadius: '3px' }}>
                                                    <div className="text-[8px] font-mono text-black leading-none opacity-80">{n.data.type}</div>
                                                </div>
                                                
                                                {/* Name: Center */}
                                                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full px-1 pointer-events-none flex justify-center items-center">
                                                    <div className="font-bold text-black text-xs sm:text-sm truncate max-w-full" title={n.data.label} style={{ textShadow: '0 0 4px rgba(255,255,255,0.8)' }}>
                                                        {n.data.label}
                                                    </div>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                );
                            } else {
                                const isNet = n.type === 'net_node';
                                const bg = isConflict ? '#ef4444' : (isNet ? '#22c55e' : (n.data.isExternal ? '#f97316' : '#a855f7'));
                                
                                return (
                                    <div key={n.id} className={`absolute rounded-full border border-white shadow-sm z-20 flex items-center justify-center transition-transform ${sel ? 'scale-150 ring-2 ring-blue-500' : ''} ${isConflict ? 'animate-pulse ring-2 ring-red-500' : ''}`}
                                        style={{ left: n.position.x, top: n.position.y, width: isNet?8:10, height: isNet?8:10, backgroundColor: sel?'#FFD700':bg, transform: 'translate(-50%,-50%)' }}>
                                        {isConflict && !isNet && <div className="absolute -top-6 -right-6 text-red-600 bg-white rounded-full p-0.5 shadow-sm"><AlertTriangle size={12}/></div>}
                                        {!hideAll && !isNet && (showPorts || (n.parentId && selectedIds.has(n.parentId))) && (
                                            <div className="absolute left-2.5 -top-5 bg-indigo-600 text-white text-[9px] px-1.5 py-0.5 rounded shadow-lg whitespace-nowrap z-50 pointer-events-none border border-indigo-400/50">
                                                {n.data.label}
                                            </div>
                                        )}
                                    </div>
                                );
                            }
                        })}
                        
                        {!hideAll && showLabels && netLabels.map((l, i) => (
                            <div key={i} className="absolute z-30 px-1.5 py-0.5 bg-white/95 border rounded text-[10px] font-mono shadow-sm cursor-pointer hover:scale-110 transition-transform select-none hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700"
                                style={{ left: l.x, top: l.y, transform: 'translate(-50%,-50%)', borderColor: stringToColor(l.name), color: stringToColor(l.name) }}
                                onClick={(e) => { 
                                    e.stopPropagation(); 
                                    const edgeToSelect = edges.find(ed => ed.id === l.edgeId);
                                    if (edgeToSelect) {
                                        setSelectedIds(new Set([edgeToSelect.id]));
                                        if (mode !== MODE.VIEW) setMode(MODE.VIEW);
                                    }
                                }}>
                                {l.name}
                            </div>
                        ))}

                        {dragState?.type === 'DRAW' && <div style={{ position: 'absolute', left: Math.min(dragState.startX, dragState.currX), top: Math.min(dragState.startY, dragState.currY), width: Math.abs(dragState.currX - dragState.startX), height: Math.abs(dragState.currY - dragState.startY), border: '2px dashed #3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.1)' }} />}
                    </div>
                </div>
                
                {/* Status Bar */}
                <div className="bg-white dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 px-4 py-1.5 flex justify-between items-center text-[10px] font-medium text-slate-500 dark:text-slate-400">
                     <div className="flex gap-4">
                         <span>ZOOM: {Math.round(transform.k * 100)}%</span>
                         <span>MODE: {mode}</span>
                         <span>POS: {cursorPos.x}, {cursorPos.y}</span>
                     </div>
                     <div className="flex gap-3">
                         <span className={showLabels ? 'text-blue-600 dark:text-blue-400 font-bold' : ''}>LABELS (L)</span>
                         <span className={showPorts ? 'text-blue-600 dark:text-blue-400 font-bold' : ''}>PORTS (P)</span>
                         <span className={hideAll ? 'text-red-500 font-bold' : ''}>HIDE TEXT (H)</span>
                     </div>
                </div>
            </div>
        </div>
    </div>
  );
}