import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { 
  Settings, Undo, Redo, Save, MousePointer2, 
  Crop, CircleDot, Network, Trash2, 
  Plus, Eye, EyeOff, AlertTriangle,
  FolderOpen, ChevronLeft, ChevronRight, Search, CheckCircle2,
  X, Layers, Info,
  Moon, Sun, GripHorizontal, Monitor, Maximize,
  Send, Bot, Sparkles, Zap, PanelRightClose, Check, Edit2, Square
} from 'lucide-react';

// --- 0. Utility Functions ---
const getId = () => `n_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
const SNAPPING_THRESHOLD = 8; 

// Default Suggestions for Autocomplete
const DEFAULT_TYPES = ['NMOS', 'PMOS', 'RES', 'CAP', 'IND', 'VSOURCE', 'ISOURCE', 'GND', 'VDD'];
const DEFAULT_PORT_NAMES = ['G', 'D', 'S', 'B', 'IN', 'OUT', 'VCC', 'VSS', 'PLUS', 'MINUS', 'A', 'B', 'Y'];
const DEFAULT_PORT_TYPES = ['port', 'gnd', 'vdd'];

const DEFAULT_LLM_HOST = 'https://a.fe8.cn/v1';

const DEFAULT_LLM_MODELS = [
    { id: 'gpt-4.1', alias: 'GPT-4.1' },
    { id: 'gpt-5.2', alias: 'GPT-5.2' },
    { id: 'claude-sonnet-4-5-20250929-thinking', alias: 'sonnet-4.5-thinking' },
    { id: 'gemini-3-pro-preview', alias: 'gemini-3-pro' }
];

    const DEFAULT_LLM_SYSTEM_PROMPT = `你是一个专业的电路设计助手，可以回答各种问题。
    当用户提供了电路网表数据(JSON格式)时，你可以分析和修改它。网表数据结构:
    - ckt_netlist: 器件数组，每项含 id, device_name, component_type, bbox, port, port_connection, name, attribute
    - external_ports: 外部端口字典，key为端口ID，含 name, type, center
    - connection: 网络连接字典，key为网络名，含 ports 和 pixels
    
    【重要规则】当用户要求修改、校对、检查、修复、优化网表时，你**必须**使用corrections结构化格式返回修改建议。
    **绝对禁止**返回完整的网表JSON数据。仅返回需要修改的部分。
    用 \`\`\`corrections 代码块包裹一个JSON数组 (不要使用 \`\`\`json):
    \`\`\`corrections
[
  {"to":"ckt_netlist","key":"#16","type":"modify","reason":"修正器件名称","content":{"name":"M1"}},
  {"to":"ckt_netlist","key":"#0","type":"modify","reason":"修正类型","content":{"component_type":"NMOS"}},
  {"to":"connection","key":"net14","type":"del","reason":"冗余连接"},
  {"to":"external_ports","key":"#1","type":"add","reason":"缺少端口","content":{"name":"VIN","type":"port","center":[100,200]}}
]
\`\`\`
字段说明:
- to: 目标节(ckt_netlist / external_ports / connection)
- key: ckt_netlist用id字段(如"#0","#16"), connection用网络名, external_ports用key
- type: modify(部分更新,只需包含要改的字段) / del(删除) / add(新增,需完整内容)
- reason: 简要说明修改原因
- content: 修改/新增的内容(del类型可省略)

每一条修改都是独立的一个对象。即使需要修改很多项，也要逐个列出。
**不要返回完整的网表JSON，只返回需要修改的项。**
对于非校对/非修改类问题，正常文字回答即可。`;

const LLM_PRESETS = [
    { icon: '✅', label: '校对网表', prompt: '@网表 @原图  请校对当前网表，检查器件类型、端口连接、网络命名等是否有错误，以corrections格式返回修改建议。' },
    { icon: '🔍', label: '检查网表', prompt: '@网表 请检查当前网表数据是否有错误、缺失连接或端口命名问题。' },
    { icon: '🔧', label: '修复网络名称', prompt: '@网表 @原图 请修复当前网表中的网络名称，以corrections格式返回修正建议。此时type是modify，然后修改网络的本身的key值' },
    { icon: '📝', label: '补全器件', prompt: '@网表 @原图 请根据电路拓扑结构，帮我添加可能缺失的器件和连接。' },
];

// --- Corrections Utilities ---
const deepMergeObj = (target: any, source: any): any => {
    const result = { ...target };
    for (const key of Object.keys(source)) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])
            && result[key] && typeof result[key] === 'object' && !Array.isArray(result[key])) {
            result[key] = deepMergeObj(result[key], source[key]);
        } else {
            result[key] = source[key];
        }
    }
    return result;
};

const applyCorrectionItems = (baselineJson: string, items: any[], checked: boolean[]): string => {
    const data = JSON.parse(baselineJson);
    items.forEach((c, i) => {
        if (!checked[i]) return;
        if (c.to === 'ckt_netlist') {
            if (c.type === 'modify') {
                const idx = (data.ckt_netlist || []).findIndex((item: any) => item.id === c.key);
                if (idx >= 0) data.ckt_netlist[idx] = deepMergeObj(data.ckt_netlist[idx], c.content || {});
            } else if (c.type === 'del') {
                data.ckt_netlist = (data.ckt_netlist || []).filter((item: any) => item.id !== c.key);
            } else if (c.type === 'add') {
                (data.ckt_netlist = data.ckt_netlist || []).push({ id: c.key, ...c.content });
            }
        } else if (c.to === 'connection') {
            data.connection = data.connection || {};
            if (c.type === 'modify' && data.connection[c.key]) {
                const merged = deepMergeObj(data.connection[c.key], c.content || {});
                // Handle rename if LLM puts 'key' in content
                if (merged.key && merged.key !== c.key) {
                    const newKey = merged.key;
                    delete merged.key;
                    delete data.connection[c.key];
                    data.connection[newKey] = merged;
                } else {
                    data.connection[c.key] = merged;
                }
            }
            else if (c.type === 'del') delete data.connection[c.key];
            else if (c.type === 'add') {
                const content = c.content || {};
                if (content.key && content.key !== c.key) {
                    const newKey = content.key;
                    const newContent = { ...content };
                    delete newContent.key;
                    data.connection[newKey] = newContent;
                } else {
                    data.connection[c.key] = content;
                }
            }
        } else if (c.to === 'external_ports') {
            data.external_ports = data.external_ports || {};
            if (c.type === 'modify' && data.external_ports[c.key]) {
                const merged = deepMergeObj(data.external_ports[c.key], c.content || {});
                if (merged.key && merged.key !== c.key) {
                    const newKey = merged.key;
                    delete merged.key;
                    delete data.external_ports[c.key];
                    data.external_ports[newKey] = merged;
                } else {
                    data.external_ports[c.key] = merged;
                }
            }
            else if (c.type === 'del') delete data.external_ports[c.key];
            else if (c.type === 'add') {
                const content = c.content || {};
                if (content.key && content.key !== c.key) {
                    const newKey = content.key;
                    const newContent = { ...content };
                    delete newContent.key;
                    data.external_ports[newKey] = newContent;
                } else {
                    data.external_ports[c.key] = content;
                }
            }
        }
    });
    return JSON.stringify(data, null, 2);
};

const getOriginalFromBaseline = (baselineJson: string, c: any): any => {
    try {
        const data = JSON.parse(baselineJson);
        if (c.to === 'ckt_netlist') return (data.ckt_netlist || []).find((item: any) => item.id === c.key);
        if (c.to === 'connection') return data.connection?.[c.key];
        if (c.to === 'external_ports') return data.external_ports?.[c.key];
    } catch {}
    return null;
};


const autoDiffNetlists = (baselineJson: string, newJson: string): any[] | null => {
    try {
        const base = JSON.parse(baselineJson);
        const next = JSON.parse(newJson);
        if (!next.ckt_netlist && !next.connection && !next.external_ports) return null;
        const corrections: any[] = [];

        // Diff ckt_netlist
        const baseItems = base.ckt_netlist || [];
        const nextItems = next.ckt_netlist || [];
        const baseMap = new Map(baseItems.map((item: any) => [item.id, item]));
        const nextMap = new Map(nextItems.map((item: any) => [item.id, item]));

        for (const [id, bItem] of baseMap) {
            const nItem = nextMap.get(id);
            if (!nItem) {
                corrections.push({ to: 'ckt_netlist', key: id, type: 'del', reason: '已删除' });
            } else if (JSON.stringify(bItem) !== JSON.stringify(nItem)) {
                const content: any = {};
                for (const k of Object.keys(nItem as any)) {
                    if (k === 'id') continue;
                    if (JSON.stringify((bItem as any)[k]) !== JSON.stringify((nItem as any)[k])) {
                        content[k] = (nItem as any)[k];
                    }
                }
                if (Object.keys(content).length > 0)
                    corrections.push({ to: 'ckt_netlist', key: id as string, type: 'modify', reason: '已修改', content });
            }
        }
        for (const [id, nItem] of nextMap) {
            if (!baseMap.has(id)) {
                const { id: _omit, ...rest } = nItem as any;
                corrections.push({ to: 'ckt_netlist', key: id as string, type: 'add', reason: '新增', content: rest });
            }
        }

        // Diff external_ports
        const basePorts = base.external_ports || {};
        const nextPorts = next.external_ports || {};
        for (const key of Object.keys(basePorts)) {
            if (!nextPorts[key]) {
                corrections.push({ to: 'external_ports', key, type: 'del', reason: '已删除' });
            } else if (JSON.stringify(basePorts[key]) !== JSON.stringify(nextPorts[key])) {
                const content: any = {};
                for (const k of Object.keys(nextPorts[key])) {
                    if (JSON.stringify(basePorts[key]?.[k]) !== JSON.stringify(nextPorts[key][k]))
                        content[k] = nextPorts[key][k];
                }
                if (Object.keys(content).length > 0)
                    corrections.push({ to: 'external_ports', key, type: 'modify', reason: '已修改', content });
            }
        }
        for (const key of Object.keys(nextPorts)) {
            if (!basePorts[key])
                corrections.push({ to: 'external_ports', key, type: 'add', reason: '新增', content: nextPorts[key] });
        }

        // Diff connection - only compare ports (skip pixel-only changes)
        const baseConns = base.connection || {};
        const nextConns = next.connection || {};
        for (const key of Object.keys(baseConns)) {
            if (!nextConns[key]) {
                corrections.push({ to: 'connection', key, type: 'del', reason: '连接删除' });
            } else {
                const bp = JSON.stringify(baseConns[key]?.ports);
                const np = JSON.stringify(nextConns[key]?.ports);
                if (bp !== np)
                    corrections.push({ to: 'connection', key, type: 'modify', reason: '端口引用变更', content: { ports: nextConns[key].ports } });
            }
        }
        for (const key of Object.keys(nextConns)) {
            if (!baseConns[key])
                corrections.push({ to: 'connection', key, type: 'add', reason: '新增', content: nextConns[key] });
        }

        return corrections.length > 0 ? corrections : null;
    } catch { return null; }
};

// Color Generation
    const stringToColor = (str: any) => {
      if (!str) return '#999999';
      const s = String(str);
      let hash = 0;
      for (let i = 0; i < s.length; i++) {
        hash = s.charCodeAt(i) + ((hash << 5) - hash);
      }
      const goldenRatio = 0.618033988749895;
      const h = (Math.abs(hash) * goldenRatio % 1) * 360;
      return `hsl(${h}, 85%, var(--net-color-lightness, 40%))`; 
    };
    
    const getComponentColor = (type: any, opacity = 0.6) => {
        if (!type) return `rgba(59, 130, 246, ${opacity})`; 
        const s = String(type).toUpperCase();
        let hash = 0;
        for (let i = 0; i < s.length; i++) {
            hash = s.charCodeAt(i) + ((hash << 5) - hash);
        }
        const h = Math.abs(hash) % 360;
        return `hsla(${h}, 60%, 92%, ${opacity})`; 
    };
    
    const getComponentStrokeColor = (type: any) => {
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
const pythonDataToReactState = (jsonStr: string) => {
  try {
    const data = JSON.parse(jsonStr);
    let nodes: any[] = [];
    let edges: any[] = [];
    let mergeReport = new Set<string>();
    let extraData: any = {};
    // Check for New Format (viz_core.py compatible)
    // Fix: Only check for 'components' to avoid incorrectly capturing Old Format files that happen to have 'external_ports'
    if (data.components) {
        // ... (existing new format logic)
        // Extract extra fields to preserve (e.g., llm_check, ckt_type, etc.)
        const knownKeys = new Set(['components', 'external_ports', 'connections']);
        Object.keys(data).forEach(key => {
            if (!knownKeys.has(key)) {
                extraData[key] = data[key];
            }
        });

        // 1. Parse Components
        // ... (existing parsing logic)
        Object.entries(data.components || {}).forEach(([compName, compInfo]: [string, any]) => {
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
             
             (compInfo.ports || []).forEach((p: any) => {
                 const pId = getId();
                 nodes.push({
                     id: pId,
                     type: 'port',
                     position: { x: p.coord[0], y: p.coord[1] },
                     parentId: compId,
                     data: { label: p.name, isExternal: false, compName: compName, type: p.type || "" }
                 });
             });
        });
        
        // 2. Parse External Ports
        Object.entries(data.external_ports || {}).forEach(([key, info]: [string, any]) => {
             const pId = getId();
             // Support both 'coord' and 'center' fields, default to [0,0] if missing to prevent crash
             const coord = info.coord || info.center || [0, 0];
             
             // Determine Label and ExternalId
             const label = info.name || "";
             const externalId = key;

             nodes.push({
                 id: pId,
                 type: 'port',
                 position: { x: coord[0], y: coord[1] },
                 data: { label: label, isExternal: true, compName: 'external', type: info.type || "", externalId: externalId }
             });
        });
        
        // 3. Parse Connections (Star Topology for now)
        (data.connections || []).forEach((conn: any, index: number) => {
            const netName = `net_${index}`;
            const validNodes: any[] = [];
            
            // Find React Node IDs for each connected item
            (conn.nodes || []).forEach((item: any) => {
                let foundNode = null;
                if (item.component === 'external') {
                    // Try match externalId, fallback to label
                    foundNode = nodes.find(n => n.type === 'port' && n.data.isExternal && n.data.externalId === item.port);
                    if (!foundNode) {
                        foundNode = nodes.find(n => n.type === 'port' && n.data.isExternal && n.data.label === item.port);
                    }
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
        
        return { nodes, edges, warnings: [], extraData };
    }

    // --- Fallback: Old Format (Keep existing logic) ---
    // isOldFormat = true; // Not needed if we don't switch output format based on flag, but based on input extraData
    
    // Extract extra fields for Old Format too
    Object.keys(data).forEach(key => {
        if (key !== 'ckt_netlist' && key !== 'connection') {
            extraData[key] = data[key];
        }
    });

    // Mark as Old Format so we export it back in the same format
    extraData.isOldFormat = true;

    // 1. Parse Components & Ports
    (data.ckt_netlist || []).forEach((comp: any) => {
        const { top_left, bottom_right } = comp.bbox;
        const x = top_left[0];
        const y = top_left[1];
        const w = bottom_right[0] - top_left[0];
        const h = bottom_right[1] - top_left[1];
        let compId = comp.device_name || comp.id; 
        if (nodes.some(n => n.id === compId)) {
             compId = `${compId}_${getId()}`;
        }

        nodes.push({
            id: compId,
            type: 'component',
            position: { x, y },
            width: w, height: h,
            data: { 
                label: (typeof comp.name === 'string' && comp.name) ? comp.name : (comp.device_name || ''), 
                type: typeof comp.component_type === 'string' ? comp.component_type : '', 
                rawId: comp.id 
            }
        });

        Object.entries(comp.port || {}).forEach(([portName, portInfo]: [string, any]) => {
            const center = portInfo.center;
            const pId = getId();
            nodes.push({
                id: pId,
                type: 'port',
                position: { x: center[0], y: center[1] },
                parentId: compId,
                data: { label: portName, type: portInfo.type || "", isExternal: false, compName: comp.device_name }
            });
        });
    });

    // 1b. Parse External Ports (if present)
    Object.entries(data.external_ports || {}).forEach(([key, info]: [string, any]) => {
         const center = info.center || info.coord;
         if (!center) return;
         const pId = getId();
         
         const label = info.name || "";
         const externalId = key;

         nodes.push({
             id: pId,
             type: 'port',
             position: { x: center[0], y: center[1] },
             data: { label: label, type: info.type || "", isExternal: true, compName: 'external', externalId: externalId }
         });
    });

    // 2. Parse Connections with Auto-Merge Logic
    const netRenames = new Map(); 

    const getEffectiveNetName = (name: string) => {
        let curr = name;
        while (netRenames.has(curr)) {
            curr = netRenames.get(curr);
        }
        return curr;
    };

    Object.entries(data.connection || {}).forEach(([rawNetName, netInfo]: [string, any]) => {
        let hasSegments = false;
        
        (netInfo.pixels || []).forEach((seg: any) => {
            hasSegments = true;
            const [p1, p2] = seg;
            let currentNetName = getEffectiveNetName(rawNetName);

            // Find best existing node to snap to (Priority: Same Net > Unassigned > None)
            const findSnapNode = (x: number, y: number) => {
                 const candidates = nodes.filter(n => 
                    (n.type === 'port' || n.type === 'net_node') && 
                    Math.abs(n.position.x - x) <= SNAPPING_THRESHOLD && 
                    Math.abs(n.position.y - y) <= SNAPPING_THRESHOLD
                 );
                 // 1. Try to find node already on this net
                 let match = candidates.find(n => n.data.netName === currentNetName);
                 if (match) return match;
                 // 2. Try to find unassigned node (e.g. port)
                 match = candidates.find(n => !n.data.netName);
                 if (match) return match;
                 
                 // 3. Do not snap to nodes of other nets (avoids auto-merge)
                 return null;
            };

            let n1 = findSnapNode(p1[0], p1[1]);
            if (!n1) {
                n1 = { id: getId(), type: 'net_node', position: { x: p1[0], y: p1[1] }, data: { netName: currentNetName } };
                nodes.push(n1);
            } else {
                 if (!n1.data.netName) n1.data.netName = currentNetName;
            }

            let n2 = findSnapNode(p2[0], p2[1]);
            if (!n2) {
                n2 = { id: getId(), type: 'net_node', position: { x: p2[0], y: p2[1] }, data: { netName: currentNetName } };
                nodes.push(n2);
            } else {
                 if (!n2.data.netName) n2.data.netName = currentNetName;
            }

            if (n1.id !== n2.id) {
                const exists = edges.some(e => (e.source === n1.id && e.target === n2.id) || (e.source === n2.id && e.target === n1.id));
                if (!exists) {
                    edges.push({ id: `edge_${getId()}`, source: n1.id, target: n2.id, type: 'net_edge', data: { netName: currentNetName } });
                }
            }
        });

        // Fallback for connections with NO pixels (Star Topology)
        if (!hasSegments && (netInfo.ports || []).length > 1) {
            let currentNetName = getEffectiveNetName(rawNetName);
            const validPortNodes: any[] = [];
            
            // Find port nodes
            netInfo.ports.forEach((nodeInfo: any) => {
                const [devName, portName] = nodeInfo;
                // Find corresponding React port node
                // Note: Components should already be parsed
                const compNode = nodes.find(n => n.type === 'component' && n.data.label === devName);
                if (compNode) {
                    const portNode = nodes.find(n => n.parentId === compNode.id && n.data.label === portName);
                    if (portNode) {
                        validPortNodes.push(portNode);
                        if (!portNode.data.netName) portNode.data.netName = currentNetName;
                    }
                } else if (devName === portName || devName === 'external') { 
                    // Try external port match
                    // Match by externalId or label
                    let extPort = nodes.find(n => n.type === 'port' && n.data.isExternal && n.data.externalId === portName);
                    if (!extPort) {
                        extPort = nodes.find(n => n.type === 'port' && n.data.isExternal && n.data.label === portName);
                    }
                    if (extPort) {
                        validPortNodes.push(extPort);
                        if (!extPort.data.netName) extPort.data.netName = currentNetName;
                    }
                }
            });

            if (validPortNodes.length > 1) {
                // Calculate Centroid
                const cx = validPortNodes.reduce((sum, n) => sum + n.position.x, 0) / validPortNodes.length;
                const cy = validPortNodes.reduce((sum, n) => sum + n.position.y, 0) / validPortNodes.length;
                
                const jId = getId();
                nodes.push({ 
                    id: jId, 
                    type: 'net_node', 
                    position: { x: cx, y: cy }, 
                    data: { netName: currentNetName } 
                });

                validPortNodes.forEach(pn => {
                    edges.push({
                        id: `edge_${getId()}`,
                        source: pn.id,
                        target: jId,
                        type: 'net_edge',
                        data: { netName: currentNetName }
                    });
                });
            }
        }
    });

    nodes.forEach(n => { if (n.data?.netName && netRenames.has(n.data.netName)) n.data.netName = getEffectiveNetName(n.data.netName); });
    edges.forEach(e => { if (e.data?.netName && netRenames.has(e.data.netName)) e.data.netName = getEffectiveNetName(e.data.netName); });

    return { nodes, edges, warnings: Array.from(mergeReport), extraData };
  } catch (e) {
    console.error("JSON Parse Error", e);
    return null;
  }
};

const reactStateToPythonData = (nodes: any[], edges: any[], extraData: any = {}) => {
    // --- Always Export to Unified Netlist Format ---
    
    const output: any = {
        ckt_netlist: [],
        ckt_type: "ckt",
        external_ports: {},
        connection: {},
        llm_check: [],
        ...extraData
    };
    
    // Remove internal flags
    delete output.isOldFormat;
    delete output.components; // Ensure old keys are removed if present in extraData
    delete output.connections;

    const ckt_netlist: any[] = [];
    const external_ports: any = {};
    
    // Helper: Get absolute position
    const getAbsPos = (node: any) => {
        if (node.parentNode) {
            const parent = nodes.find(n => n.id === node.parentNode);
            if (parent) {
                return { x: node.position.x + parent.position.x, y: node.position.y + parent.position.y };
            }
        }
        return { x: node.position.x, y: node.position.y };
    };

    // 1. Components & Ports
    nodes.filter(n => n.type === 'component').forEach(n => {
        const compName = n.data.label;
        const x1 = Math.round(n.position.x);
        const y1 = Math.round(n.position.y);
        const x2 = Math.round(n.position.x + n.width);
        const y2 = Math.round(n.position.y + n.height);
        
        const ports: any = {};
        const port_connection: any = {};
        
        nodes.filter(p => p.parentId === n.id).forEach(p => {
            const portName = p.data.label;
            const abs = getAbsPos(p);
            const absX = Math.round(abs.x);
            const absY = Math.round(abs.y);
            
            // Ports in Old Format: "portName": { "top_left": ..., "bottom_right": ..., "center": [x, y] }
            const pR = 5;
            ports[portName] = {
                type: p.data.type || "",
                center: [absX, absY],
                top_left: [absX - pR, absY - pR],
                bottom_right: [absX + pR, absY + pR]
            };
            
            if (p.data.netName) {
                port_connection[portName] = p.data.netName;
            }
        });
        
        ckt_netlist.push({
            id: n.data.rawId || "#0", 
            device_name: compName,
            component_type: n.data.type || "",
            bbox: { top_left: [x1, y1], bottom_right: [x2, y2] },
            port: ports,
            port_connection: port_connection,
            name: n.data.label,
            attribute: []
        });
    });
    
    // 1b. External Ports
    let extIdCounter = 0;
    nodes.filter(n => n.type === 'port' && n.data.isExternal).forEach(n => {
        const portName = n.data.label;
        const absX = Math.round(n.position.x);
        const absY = Math.round(n.position.y);
        const pR = 5;
        
        let exId = n.data.externalId;
        if (!exId) {
            exId = `${++extIdCounter}`;
        }
        
        // Ensure format "#ID"
        const finalKey = exId.startsWith('#') ? exId : `#${exId}`;
        
        external_ports[finalKey] = {
            name: portName,
            type: n.data.type || "",
            center: [absX, absY],
            top_left: [absX - pR, absY - pR],
            bottom_right: [absX + pR, absY + pR]
        };
    });

    // 2. Connections
    const netMap: any = {}; // netName -> { ports: [], pixels: [] }
    
    // 2a. Collect Ports
    nodes.forEach(n => {
        if (n.type === 'port' && n.data.netName) {
            const net = n.data.netName;
            if (!netMap[net]) netMap[net] = { ports: [], pixels: [] };
            
            let devName = "unknown";
            let portIdentifier = n.data.label;
            
            if (n.parentId) {
                const parent = nodes.find(p => p.id === n.parentId);
                if (parent) devName = parent.data.label;
            } else if (n.data.isExternal) {
                devName = "external";
                portIdentifier = n.data.externalId || n.data.label;
            }
            
            if (devName !== "unknown") {
                const exists = netMap[net].ports.some((p: any) => p[0] === devName && p[1] === portIdentifier);
                if (!exists) netMap[net].ports.push([devName, portIdentifier]);
            }
        }
    });
    
    // 2b. Collect Pixels (Edges)
    edges.forEach(e => {
        const srcNode = nodes.find(n => n.id === e.source);
        const tgtNode = nodes.find(n => n.id === e.target);
        
        if (srcNode && tgtNode) {
            let net = e.data?.netName || srcNode.data.netName || tgtNode.data.netName;
            
            if (net) {
                if (!netMap[net]) netMap[net] = { ports: [], pixels: [] };
                
                const p1 = getAbsPos(srcNode);
                const p2 = getAbsPos(tgtNode);
                
                netMap[net].pixels.push([
                    [Math.round(p1.x), Math.round(p1.y)],
                    [Math.round(p2.x), Math.round(p2.y)]
                ]);
            }
        }
    });
    
    output.ckt_netlist = ckt_netlist;
    output.external_ports = external_ports;
    output.connection = netMap;
    if (!output.ckt_type) output.ckt_type = "ckt";
    
    return JSON.stringify(output, null, 2);
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

const SettingsDialog = ({ isOpen, onClose, appSettings, setAppSettings, theme, setTheme }: any) => {
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
                                ['Remove File', 'Shift + Delete'],
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

const ConnectionSegment = ({ from, to, netName, isSelected, isRelated, isTemp, isConflict, width = 2 }: any) => {
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

    const filteredNodes = nodes.filter((n: any) => {
        if (n.type === 'net_node') return false;
        const label = n.data.label || '';
        const type = n.data.type || '';
        if (hiddenTypes.has(type)) return false;
        if (searchTerm && !label.toLowerCase().includes(searchTerm.toLowerCase()) && !type.toLowerCase().includes(searchTerm.toLowerCase())) return false;
        return true;
    });

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
            return Object.keys(c.content).slice(0, 3).map(k => ({
                field: k, old: '-', val: typeof c.content[k] === 'object' ? JSON.stringify(c.content[k]).slice(0, 30) : String(c.content[k])
            }));
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
                        diffs.push({ field: path, old: ov === undefined ? '-' : typeof ov === 'object' ? JSON.stringify(ov).slice(0, 25) : String(ov), val: typeof nv === 'object' ? JSON.stringify(nv).slice(0, 25) : String(nv) });
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
                        ? (firstDiff.field === '整项' ? firstDiff.val : `${firstDiff.field}: ${firstDiff.old} → ${firstDiff.val}`)
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
                                    {c.reason && (
                                        <div className="text-[10px] text-slate-400 italic mb-1 border-b border-slate-200 dark:border-slate-700/50 pb-1">
                                            {c.reason}
                                        </div>
                                    )}
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
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

const LLMChatPanel = ({ isOpen, onClose, nodes, edges, extraData, onApplyNetlist, bgImage, notify, onHighlight }: any) => {
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

    useEffect(() => { localStorage.setItem('llm_settings', JSON.stringify(settings)); }, [settings]);
    useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);

    const getNetlist = () => { try { return reactStateToPythonData(nodes, edges, extraData); } catch { return '{}'; } };

    const extractAndApplyAll = (text: string, startFrom: number = 0): number => {
        const matches = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
        let applied = startFrom;
        for (let i = startFrom; i < matches.length; i++) {
            try { 
                const block = matches[i][1].trim();
                if (block.startsWith('{') || block.startsWith('[')) {
                    JSON.parse(block); 
                    onApplyNetlist(block); 
                    applied = i + 1; 
                }
            } catch {}
        }
        return applied;
    };

    const handleCorrectionToggle = (msgIdx: number, corrIdx: number) => {
        const msg = msgs[msgIdx];
        if (!msg.corrections || !msg.baseline) return;
        const newChecked = [...(msg.correctionChecked || [])];
        newChecked[corrIdx] = !newChecked[corrIdx];
        const firstApply = !msg.correctionHistorySaved && newChecked.some(Boolean);
        setMsgs(prev => {
            const c = [...prev];
            c[msgIdx] = { ...c[msgIdx], correctionChecked: newChecked, correctionHistorySaved: firstApply || c[msgIdx].correctionHistorySaved };
            return c;
        });
        const result = applyCorrectionItems(msg.baseline, msg.corrections, newChecked);
        onApplyNetlist(result, !firstApply);
    };

    const handleCorrectionToggleAll = (msgIdx: number, val: boolean) => {
        const msg = msgs[msgIdx];
        if (!msg.corrections || !msg.baseline) return;
        const newChecked = new Array(msg.corrections.length).fill(val);
        const firstApply = !msg.correctionHistorySaved && val;
        setMsgs(prev => {
            const c = [...prev];
            c[msgIdx] = { ...c[msgIdx], correctionChecked: newChecked, correctionHistorySaved: firstApply || c[msgIdx].correctionHistorySaved };
            return c;
        });
        const result = applyCorrectionItems(msg.baseline, msg.corrections, newChecked);
        onApplyNetlist(result, !firstApply);
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

        // Truncate history up to this message
        const history = msgs.slice(0, index);
        const oldMsg = msgs[index];
        const updatedMsg = { ...oldMsg, content: newContent };
        
        // Update state with truncated history + updated message
        const newMsgs = [...history, updatedMsg];
        setMsgs(newMsgs);
        setLoading(true);

        // Re-construct apiMsgs
        let sysContent = settings.systemPrompt;
        
        // Check for new flags in the edited content
        const newHasNetlist = newContent.includes('@网表');
        const newHasImage = newContent.includes('@原图');
        // Update flags
        updatedMsg.hasNetlist = newHasNetlist;
        updatedMsg.hasImage = newHasImage;
        
        if (newHasNetlist) {
            // Ensure we have netlist. If it was already there, good. If not, get it.
            // Note: getNetlist() gets *current* state. 
            // If we are resending an old message, the state might have changed?
            // Usually we want the *current* state for the new request.
            const netlist = getNetlist();
            lastNetlistRef.current = netlist;
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
                if (!newHasNetlist) return null; // Use local flag
                 const matches = [...content.matchAll(/```(?:json|corrections)?\s*([\s\S]*?)```/g)];
                for (const m of matches) {
                    const block = m[1].trim();
                    try {
                        const parsed = JSON.parse(block);
                        if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].to && parsed[0].type) {
                            return parsed;
                        }
                        const diff = autoDiffNetlists(lastNetlistRef.current, block);
                        if (diff) return diff;
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
                    setMsgs(prev => [...prev, { role: 'assistant', content, ts: Date.now(), corrections: corrs, baseline: lastNetlistRef.current, correctionChecked: new Array(corrs.length).fill(false), reasoning }]);
                } else {
                    const applied = !newHasNetlist && extractAndApplyAll(content, 0) > 0;
                    setMsgs(prev => [...prev, { role: 'assistant', content, ts: Date.now(), applied, reasoning }]);
                }
                return;
            }

            const reader = res.body!.getReader();
            const decoder = new TextDecoder();
            let full = '';
            let fullReasoning = '';
            let appliedBlocks = 0;
            setMsgs(prev => [...prev, { role: 'assistant', content: '', ts: Date.now() }]);

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
                    const newApplied = extractAndApplyAll(full, appliedBlocks);
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
                const finalApplied = extractAndApplyAll(full, appliedBlocks);
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

        const hasNetlist = input.includes('@网表');
        const hasImage = input.includes('@原图');
        const userMsg = { role: 'user', content: input, ts: Date.now(), hasNetlist, hasImage };
        const newMsgs = [...msgs, userMsg];
        setMsgs(newMsgs);
        setInput('');
        setLoading(true);

        let sysContent = settings.systemPrompt;
        if (hasNetlist) {
            const netlist = getNetlist();
            lastNetlistRef.current = netlist;
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
                
                // Try to find any code block
                const matches = [...content.matchAll(/```(?:json|corrections)?\s*([\s\S]*?)```/g)];
                for (const m of matches) {
                    const block = m[1].trim();
                    try {
                        const parsed = JSON.parse(block);
                        // 1. Direct Corrections Array
                        if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].to && parsed[0].type) {
                            return parsed;
                        }
                        // 2. Full Netlist Auto-Diff
                        const diff = autoDiffNetlists(lastNetlistRef.current, block);
                        if (diff) return diff;
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
                    setMsgs(prev => [...prev, { role: 'assistant', content, ts: Date.now(), corrections: corrs, baseline: lastNetlistRef.current, correctionChecked: new Array(corrs.length).fill(false), reasoning }]);
                } else {
                    const applied = !hasNetlist && extractAndApplyAll(content, 0) > 0;
                    setMsgs(prev => [...prev, { role: 'assistant', content, ts: Date.now(), applied, reasoning }]);
                }
                return;
            }

            const reader = res.body!.getReader();
            const decoder = new TextDecoder();
            let full = '';
            let fullReasoning = '';
            let appliedBlocks = 0;
            setMsgs(prev => [...prev, { role: 'assistant', content: '', ts: Date.now() }]);

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
                    const newApplied = extractAndApplyAll(full, appliedBlocks);
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
                const finalApplied = extractAndApplyAll(full, appliedBlocks);
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
            <details className="mb-2 group" defaultOpen={true}>
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

const MODE = { VIEW: 'VIEW', ADD_COMP: 'ADD_COMP', ADD_PORT: 'ADD_PORT', CONNECT: 'CONNECT' };

export default function App() {
  // --- Editor State (Moved up for dependencies) ---
  const [nodes, setNodes] = useState<any[]>([]);
  const [edges, setEdges] = useState<any[]>([]);
  const [bgImage, setBgImage] = useState(null);
  const [mode, setMode] = useState(MODE.VIEW);
  
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [connectStartId, setConnectStartId] = useState<string | null>(null);  
  
  const [past, setPast] = useState<any[]>([]);
  const [future, setFuture] = useState<any[]>([]);

  // --- Global App Settings & State ---
  const [extraTypes, setExtraTypes] = useState<string[]>([]);
  const [extraPorts, setExtraPorts] = useState<string[]>([]);
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [hiddenNodeIds, setHiddenNodeIds] = useState<Set<string>>(new Set());

  const effectiveHiddenIds = useMemo(() => {
      const hidden = new Set(hiddenNodeIds);
      nodes.forEach(n => {
          if (n.data.type && hiddenTypes.has(n.data.type)) {
              hidden.add(n.id);
          }
      });
      return hidden;
  }, [nodes, hiddenNodeIds, hiddenTypes]);

  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'system'); // 'light', 'dark', 'system'
  const [appSettings, setAppSettings] = useState({ defaultLineWidth: 2, defaultBoxOpacity: 0.2, showCrosshair: true });
  const [showSettings, setShowSettings] = useState(false);
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 }); // Mouse position in world coords
  const [screenCursor, setScreenCursor] = useState({ x: -100, y: -100 }); // For Crosshair
  const [hoveredNode, setHoveredNode] = useState<any>(null); // For Tooltip

  
  // --- File System State ---
  const [fileList, setFileList] = useState<any[]>([]); 
  const [projectDirHandle, setProjectDirHandle] = useState<any>(null);
  const [currentFileIndex, setCurrentFileIndex] = useState(-1);
  const [searchQuery, setSearchQuery] = useState('');
  
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  
  const [dragState, setDragState] = useState<any>(null);
  const [notification, setNotification] = useState<string | null>(null);
  
  const [dialog, setDialog] = useState<{
    isOpen: boolean;
    type?: string;
    data?: any;
    options?: { compTypes: string[]; portNames: string[]; portTypes?: string[] };
    initialName?: string;
    initialType?: string;
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

  // --- Integration State (Task Mode) ---
  const [taskId, setTaskId] = useState<string | null>(null);
  const [extraTaskData, setExtraTaskData] = useState<any>({}); // Store preserved fields

  // --- LLM Panel State ---
  const [llmPanelOpen, setLlmPanelOpen] = useState(false);

  // --- Heartbeat Logic ---
  useEffect(() => {
    if (!taskId) return;
    
    // Send heartbeat every 2 seconds
    const interval = setInterval(() => {
        fetch(`/api/heartbeat/${taskId}`, { method: 'POST', keepalive: true })
            .catch(e => console.error("Heartbeat failed", e));
    }, 2000);
    
    // Initial heartbeat
    fetch(`/api/heartbeat/${taskId}`, { method: 'POST', keepalive: true });
    
    // Handle page close with fetch keepalive (more reliable for some network conditions than sendBeacon)
    const handlePageHide = () => {
        const url = `/api/heartbeat/${taskId}?status=finish`;
        fetch(url, {
            method: 'POST',
            keepalive: true
        }).catch(e => console.error("Exit signal failed", e));
    };
    window.addEventListener('pagehide', handlePageHide);
    
    return () => {
        clearInterval(interval);
        window.removeEventListener('pagehide', handlePageHide);
    };
  }, [taskId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    if (id) {
        setTaskId(id);
        
        Promise.all([
            fetch(`/api/get_task_json/${id}`).then(r => r.json()),
            fetch(`/api/get_task_image/${id}`).then(r => r.blob())
        ]).then(([jsonData, imgBlob]) => {
            if (jsonData.code && jsonData.code !== 200) {
                setNotification("Error: " + jsonData.message);
                return;
            }
            if (jsonData.error) { // Fallback for old error format if any
                setNotification("Error: " + jsonData.error);
                return;
            }
            
            // Process JSON
            // Handle new API response structure (data wrapper)
            let netlistData = jsonData;
            // Case 1: Standard API response with code/message
            if (jsonData.code === 200 && jsonData.data) {
                netlistData = jsonData.data;
            } 
            // Case 2: Direct data object (backward compatibility or raw file read)
            else if (jsonData.data && typeof jsonData.data === 'object' && jsonData.timestamp) {
                 netlistData = jsonData.data;
            }
            
            const parseResult = pythonDataToReactState(JSON.stringify(netlistData));
            if (!parseResult) {
                setNotification("Failed to parse task data");
                return;
            }
            const { nodes: n, edges: e, warnings, extraData } = parseResult;

            if (extraData) setExtraTaskData(extraData);
            if (warnings && warnings.length > 0) setNotification(`Loaded with warnings: ${warnings.join('\n')}`);
            
            // Create Dummy File Object
            const dummyFile = {
                id: 'task_' + id,
                name: 'task_result.json',
                imgFile: new File([imgBlob], "image.png", { type: "image/png" }),
                data: { nodes: n, edges: e },
                status: 'annotated'
            };
            
            setFileList([dummyFile]);
            
            // Set state directly
            setNodes(n);
            setEdges(e);
            setPast([]); setFuture([]);
            
            const src = URL.createObjectURL(imgBlob);
            setBgImage(src as any);
            
            // Auto-fit image
            const img = new Image();
            img.onload = () => {
                if (containerRef.current) {
                    const rect = containerRef.current.getBoundingClientRect();
                    const k = Math.min((rect.width - 40) / img.width, (rect.height - 40) / img.height, 1);
                    setTransform({ x: Math.floor((rect.width - img.width * k) / 2), y: Math.floor((rect.height - img.height * k) / 2), k });
                }
            };
            img.src = src;
            
            setCurrentFileIndex(0);
            setNotification("Task loaded successfully");

        }).catch(err => {
            console.error(err);
            setNotification("Failed to load task data");
        });
    }
  }, []);

  const handleSaveToServer = async () => {
      // 1. Get current netlist data
      const jsonStr = reactStateToPythonData(nodes, edges, extraTaskData);
      let jsonData;
      try {
          jsonData = JSON.parse(jsonStr);
      } catch (e) {
          setNotification("Error parsing data for save");
          return;
      }

      // 2. [New Logic] If no task ID (opened locally), create a new task
      if (!taskId) {
          const currentFile = fileList[currentFileIndex];
          if (!currentFile || !currentFile.imgFile) {
              setNotification("Cannot save: No image file found in current session");
              return;
          }

          setNotification("Creating new task record...");

          try {
              // Helper to convert File to Base64
              const toBase64 = (file: File) => new Promise<string>((resolve, reject) => {
                  const reader = new FileReader();
                  reader.readAsDataURL(file);
                  reader.onload = () => resolve(reader.result as string);
                  reader.onerror = error => reject(error);
              });

              const base64Img = await toBase64(currentFile.imgFile);

              // Auto-upload to create task
              const res = await fetch('/api/upload_task', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                      json_data: jsonData,
                      image_data: base64Img,
                      filename: currentFile.name || "local_upload.json"
                  })
              });

              const result = await res.json();
              
              if (result.task_id) {
                  // Success! Set ID so subsequent saves are updates
                  setTaskId(result.task_id);
                  
                  // Update URL so refresh doesn't lose context
                  const newUrl = `${window.location.pathname}?id=${result.task_id}`;
                  window.history.pushState({ path: newUrl }, '', newUrl);
                  
                  setNotification("New task created! Data saved to database.");
              } else {
                  setNotification("Failed to create task: " + (result.error || "Unknown error"));
              }
          } catch (e) {
              console.error("Auto-upload error", e);
              setNotification("Auto-create task failed: " + e);
          }
          return;
      }
      
      // 3. [Existing Logic] Have task ID, standard update
      try {
          const res = await fetch(`/api/save_task/${taskId}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(jsonData)
          });
          
          const result = await res.json();
          if (result.success) {
              setNotification("Saved successfully (Database Updated)");
              if (window.opener) {
                  window.opener.postMessage('task_updated', '*');
              }
          } else {
              setNotification("Save failed: " + result.error);
          }
      } catch (e) {
          console.error("Save error", e);
          setNotification("Save error: " + e);
      }
  };

  const handleRemoveFile = async () => {
      if (currentFileIndex === -1 || !fileList[currentFileIndex]) return;
      if (!projectDirHandle) {
          setNotification("需要通过 'Open Folder' 打开项目文件夹才能使用移除功能");
          return;
      }
      const currentFile = fileList[currentFileIndex];
      try {
          const removeDir = await projectDirHandle.getDirectoryHandle('remove', { create: true });
          if (currentFile.imgFile) {
              const dest = await removeDir.getFileHandle(currentFile.imgFile.name, { create: true });
              const w = await dest.createWritable();
              await w.write(await currentFile.imgFile.arrayBuffer());
              await w.close();
              await projectDirHandle.removeEntry(currentFile.imgFile.name);
          }
          if (currentFile.jsonFile) {
              const dest = await removeDir.getFileHandle(currentFile.jsonFile.name, { create: true });
              const w = await dest.createWritable();
              await w.write(await currentFile.jsonFile.arrayBuffer());
              await w.close();
              await projectDirHandle.removeEntry(currentFile.jsonFile.name);
          }
          const removedName = currentFile.name;
          const newList = fileList.filter((_: any, i: number) => i !== currentFileIndex);
          setFileList(newList);
          if (newList.length === 0) {
              setNodes([]); setEdges([]); setBgImage(null); setCurrentFileIndex(-1);
          } else {
              const nextIdx = Math.min(currentFileIndex, newList.length - 1);
              loadFile(nextIdx, newList);
          }
          setNotification(`已移除: ${removedName} → remove/`);
      } catch (e: any) {
          console.error("Remove file error:", e);
          setNotification("移除失败: " + (e.message || e));
      }
  };

  // --- Unique Values for Dropdowns ---
  const uniqueComponentTypes = useMemo(() => {
      const types = new Set([...DEFAULT_TYPES, ...extraTypes]);
      nodes.forEach(n => {
          if (n.type === 'component' && n.data.type) types.add(n.data.type);
      });
      return Array.from(types).sort();
  }, [nodes, extraTypes]);

  const uniquePortNames = useMemo(() => {
      const names = new Set([...DEFAULT_PORT_NAMES, ...extraPorts]);
      nodes.forEach(n => {
          if (n.type === 'port' && n.data.label) names.add(n.data.label);
      });
      return Array.from(names).sort();
  }, [nodes, extraPorts]);

  const uniquePortTypes = useMemo(() => {
      const types = new Set(DEFAULT_PORT_TYPES);
      nodes.forEach(n => {
          if (n.type === 'port' && n.data.type) types.add(n.data.type);
      });
      return Array.from(types).sort();
  }, [nodes]);

  // --- Theme Effect ---
  useEffect(() => {
      const root = window.document.documentElement;
      console.log('Theme Effect Triggered:', theme);
      
          const applyTheme = (t: any) => {
          console.log('Applying theme:', t);
          root.classList.remove('light', 'dark');
          
          let effectiveTheme = t;
          if (t === 'system') {
              effectiveTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
              console.log('System preference resolved to:', effectiveTheme);
          }
          
          root.classList.add(effectiveTheme);
          console.log('Root classes after update:', root.classList.toString());
      };

      applyTheme(theme);
      localStorage.setItem('theme', theme);

      if (theme === 'system') {
          const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
          const handleChange = () => applyTheme('system');
          mediaQuery.addEventListener('change', handleChange);
          return () => mediaQuery.removeEventListener('change', handleChange);
      }
  }, [theme]);

  // --- Sidebar Resizing Effect ---
  useEffect(() => {
      const handleMouseMove = (e: any) => {
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
  const handleAddFilesWithPicker = async () => {
      try {
          if (typeof (window as any).showOpenFilePicker === 'function') {
               const handles = await (window as any).showOpenFilePicker({
                  multiple: true,
                  types: [{
                      description: 'Circuit Files',
                      accept: {
                          'image/*': ['.png', '.jpg', '.jpeg', '.webp'],
                          'application/json': ['.json']
                      }
                  }]
              });

              const filesAndHandles = await Promise.all(handles.map(async (h: any) => ({
                  file: await h.getFile(),
                  handle: h
              })));

              const images = filesAndHandles.filter((x: any) => x.file.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(x.file.name));
              const jsons = filesAndHandles.filter((x: any) => x.file.name.endsWith('.json'));

              const newFiles = images.map((imgItem: any) => {
                  const img = imgItem.file;
                  const baseName = img.name.substring(0, img.name.lastIndexOf('.'));
                  const matchingJsonItem = jsons.find((j: any) => j.file.name === `${baseName}.json` || j.file.name.startsWith(baseName));
                  
                  return {
                      id: getId(),
                      name: img.name,
                      imgFile: img,
                      jsonFile: matchingJsonItem?.file,
                      jsonHandle: matchingJsonItem?.handle,
                      data: null,
                      status: matchingJsonItem ? 'annotated' : 'new'
                  };
              });

              setFileList(prev => {
                  const next = [...prev, ...newFiles];
                  if (currentFileIndex === -1 && next.length > 0) {
                      setTimeout(() => loadFile(0, next), 50);
                  }
                  return next;
              });
          } else {
             // Fallback
             fileInputRef.current?.click();
          }
      } catch (e: any) {
          if (e.name !== 'AbortError') {
            console.error("File Picker Error:", e);
          }
      }
  };

  const handleOpenFolder = async () => {
      // Security Check for Remote HTTP
      if (typeof (window as any).showDirectoryPicker === 'undefined') {
          setNotification("Error: 'Open Folder' requires HTTPS or Localhost due to browser security policies.");
          return;
      }
      try {
          // @ts-ignore - File System Access API
          const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
          setProjectDirHandle(dirHandle);
          
          const files: any[] = [];
          // @ts-ignore
          for await (const entry of dirHandle.values()) {
              if (entry.kind === 'file') {
                  files.push({
                      handle: entry,
                      file: await entry.getFile()
                  });
              }
          }
          
          const images = files.filter(x => x.file.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(x.file.name));
          const jsons = files.filter(x => x.file.name.endsWith('.json'));

          const newFiles = images.map((imgItem: any) => {
              const img = imgItem.file;
              const baseName = img.name.substring(0, img.name.lastIndexOf('.'));
              const matchingJsonItem = jsons.find((j: any) => j.file.name === `${baseName}.json` || j.file.name.startsWith(baseName));
              
              return {
                  id: getId(),
                  name: img.name,
                  imgFile: img,
                  imgHandle: imgItem.handle,
                  jsonFile: matchingJsonItem?.file,
                  jsonHandle: matchingJsonItem?.handle,
                  data: null,
                  status: matchingJsonItem ? 'annotated' : 'new'
              };
          });

          setFileList(prev => {
              const next = [...prev, ...newFiles];
              if (currentFileIndex === -1 && next.length > 0) {
                  setTimeout(() => loadFile(0, next), 50);
              }
              return next;
          });
      } catch (e: any) {
          if (e.name !== 'AbortError') {
            console.error("Folder Picker Error:", e);
          }
      }
  };

  const handleFileUpload = (e: any) => {
    const files = Array.from(e.target.files as any[]);
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
          if (!containerRef.current) return;
          const rect = containerRef.current.getBoundingClientRect();
          const k = Math.min((rect.width - 40) / img.width, (rect.height - 40) / img.height, 1);
          setTransform({ x: Math.floor((rect.width - img.width * k) / 2), y: Math.floor((rect.height - img.height * k) / 2), k });
      };
      img.src = bgImage;
  }, [bgImage]);

  const loadFile = (index: number, sourceList = fileList) => {
    if (index < 0 || index >= sourceList.length) return;
    const fileObj = sourceList[index];

    const reader = new FileReader();
    reader.onload = (e) => {
        if (!e.target) return;
        setBgImage(e.target.result as any);
        if (!fileObj.data) {
            const img = new Image();
            img.onload = () => {
                if (containerRef.current) {
                    const rect = containerRef.current.getBoundingClientRect();
                    const k = Math.min((rect.width - 40) / img.width, (rect.height - 40) / img.height, 1);
                    setTransform({ x: Math.floor((rect.width - img.width * k) / 2), y: Math.floor((rect.height - img.height * k) / 2), k });
                }
            };
            img.src = e.target.result as string;
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
            if (!e.target) return;
            const res = pythonDataToReactState(e.target.result as string);
            if (res) {
                setNodes(res.nodes);
                setEdges(res.edges);
                if (res.extraData) setExtraTaskData(res.extraData);
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

  const switchFile = (direction: number) => {
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
      const groups: any = {}; 
      edges.forEach(e => {
          if (!e.data?.netName) return;
          const s = nodes.find(n => n.id === e.source);
          const t = nodes.find(n => n.id === e.target);
          if (s && t) {
              if (!groups[e.data.netName]) groups[e.data.netName] = [];
              groups[e.data.netName].push({ id: e.id, x1: s.position.x, y1: s.position.y, x2: t.position.x, y2: t.position.y });
          }
      });

      return Object.entries(groups).map(([name, segments]: any) => {
          if (segments.length === 0) return null;
          
          // Find segment with max length
          let bestSeg = segments[0];
          let maxLen = -1;
          
          segments.forEach((seg: any) => {
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

  const handleApplyLLMNetlist = (jsonStr: string, skipHistory = false) => {
      const result = pythonDataToReactState(jsonStr);
      if (result) {
          if (!skipHistory) saveHistory();
          setNodes(result.nodes);
          setEdges(result.edges);
          if (result.extraData) setExtraTaskData(result.extraData);
          if (!skipHistory) setNotification("✨ AI 已自动更新网表");
      } else {
          if (!skipHistory) setNotification("AI 返回的网表格式无法解析");
      }
  };

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

  const getConnectedEdges = useCallback((startEdgeId: string) => {
      const adj = new Map();
      const getNodeIds = (id: any) => { if(!adj.has(id)) adj.set(id, []); return adj.get(id); };
      
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
          neighbors.forEach((item: any) => {
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

    // Data Consistency: Validate Net/Port relationships
    // Checks if the net has valid pixels (edges) and if ports are physically connected
    newNodes = newNodes.map(n => {
        if (n.type === 'port' && n.data?.netName) {
            const isConnected = newEdges.some(e => 
                e.data?.netName === n.data.netName && 
                (e.source === n.id || e.target === n.id)
            );
            if (!isConnected) {
                return { ...n, data: { ...n.data, netName: undefined } };
            }
        }
        return n;
    });

    setNodes(newNodes); setEdges(newEdges); setSelectedIds(new Set());
  }, [selectedIds, nodes, edges, saveHistory, getConnectedEdges]);

  useEffect(() => {
    const handleKeyDown = (e: any) => {
        if (dialog.isOpen || showSettings) return; 
        const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
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
        else if (key === 'u') { 
            e.preventDefault(); 
            if (taskId) handleSaveToServer(); 
            else downloadCurrentJson(); 
        }
        else if (e.ctrlKey && key === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
        else if (e.ctrlKey && key === 'y') { e.preventDefault(); redo(); }
        else if ((e.key === 'Delete' || e.key === 'Backspace') && e.shiftKey) { e.preventDefault(); handleRemoveFile(); }
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
  }, [undo, redo, dialog.isOpen, showSettings, connectStartId, currentFileIndex, fileList, nodes, edges, deleteSelected, mode, taskId, extraTaskData]);

  const screenToWorld = useCallback((sx: number, sy: number) => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    return { x: (sx - rect.left - transform.x) / transform.k, y: (sy - rect.top - transform.y) / transform.k };
  }, [transform]);

  const cancelConnect = useCallback(() => { setConnectStartId(null); setDragState(null); }, []);

  const handleMouseDown = (e: any) => {
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
                initialType: context.type === 'ext' ? 'port' : '',
                options: { compTypes: uniqueComponentTypes, portNames: uniquePortNames, portTypes: uniquePortTypes },
                position: { x: e.clientX, y: e.clientY }
            }); 
        }
    }
  };

  const handleMouseMove = (e: any) => {
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

    if (dragState?.type === 'CONNECTING') { setDragState((prev: any) => ({ ...prev, currX: wx, currY: wy })); return; }
    if (!dragState) return;

    if (dragState.type === 'PAN') {
        setTransform({ ...transform, x: dragState.startTrans.x + e.clientX - dragState.startX, y: dragState.startTrans.y + e.clientY - dragState.startY });
    } else if (dragState.type === 'NODE') {
        const dx = e.movementX / transform.k, dy = e.movementY / transform.k;
        setNodes((prev: any[]) => {
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
        setNodes((prev: any[]) => prev.map(n => n.id === dragState.node.id ? { ...n, width: Math.max(20, dragState.node.width + dx), height: Math.max(20, dragState.node.height + dy) } : n));
        setDragState((prev: any) => ({ ...prev, startX: e.clientX, startY: e.clientY, node: { ...dragState.node, width: Math.max(20, dragState.node.width + dx), height: Math.max(20, dragState.node.height + dy) } }));
    } else if (dragState.type === 'DRAW') {
        setDragState((prev: any) => ({ ...prev, currX: wx, currY: wy }));
    }
  };

  const handleMouseUp = (e: any) => {
    if (dragState?.type === 'DRAW') {
        const w = Math.abs(dragState.currX - dragState.startX), h = Math.abs(dragState.currY - dragState.startY);
        if (w > 10 && h > 10) {
            setDialog({ 
                isOpen: true, 
                type: 'comp', 
                data: { x: Math.min(dragState.startX, dragState.currX), y: Math.min(dragState.startY, dragState.currY), w, h }, 
                options: { compTypes: uniqueComponentTypes, portNames: uniquePortNames, portTypes: uniquePortTypes },
                position: { x: e.clientX, y: e.clientY }
            });
        }
    }
    if (dragState?.type !== 'CONNECTING') setDragState(null);
  };

  const handleConnect = (sourceId: string, targetId: string) => {
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

  const createConnection = (sourceId: any, targetId: any, netA: any, netB: any) => {
      saveHistory();
      
      let finalNet = netA || netB;
      
      if (!finalNet) {
          // Generate auto-increment net name: net1, net2, ...
          const usedNames = new Set<string>();
          nodes.forEach(n => { if (n.data?.netName) usedNames.add(n.data.netName); });
          edges.forEach(e => { if (e.data?.netName) usedNames.add(e.data.netName); });
          
          let maxNum = 0;
          usedNames.forEach(name => {
              if (!name) return;
              const match = name.match(/^net(\d+)$/i);
              if (match) {
                  const num = parseInt(match[1], 10);
                  if (!isNaN(num) && num > maxNum) maxNum = num;
              }
          });
          finalNet = `net${maxNum + 1}`;
      }

      const newEdgeId = `edge_${getId()}`;
      const newEdge = { id: newEdgeId, source: sourceId, target: targetId, type: 'net_edge', data: { netName: finalNet } };

      // Flood Fill: Propagate finalNet to all connected parts that are unnamed or same-named
      const allEdges = [...edges, newEdge];
      const adj = new Map();
      allEdges.forEach(e => {
          if (!adj.has(e.source)) adj.set(e.source, []);
          if (!adj.has(e.target)) adj.set(e.target, []);
          adj.get(e.source).push({ id: e.id, target: e.target, netName: e.data?.netName });
          adj.get(e.target).push({ id: e.id, target: e.source, netName: e.data?.netName });
      });

      const nodesToUpdate = new Set([sourceId, targetId]);
      const edgesToUpdate = new Set([newEdgeId]);
      const queue = [sourceId, targetId];
      const visited = new Set(queue);

      while(queue.length > 0) {
          const curr = queue.shift();
          const neighbors = adj.get(curr) || [];
          
          neighbors.forEach((conn: any) => {
              // Propagate if edge has no net or same net
              if (!conn.netName || conn.netName === finalNet) {
                  edgesToUpdate.add(conn.id);
                  if (!visited.has(conn.target)) {
                      visited.add(conn.target);
                      nodesToUpdate.add(conn.target);
                      queue.push(conn.target);
                  }
              }
          });
      }

      setEdges(prev => [...prev, newEdge].map(e => edgesToUpdate.has(e.id) ? { ...e, data: { ...e.data, netName: finalNet } } : e));
      setNodes((prev: any[]) => prev.map(n => nodesToUpdate.has(n.id) && (!n.data.netName || n.data.netName === finalNet) ? { ...n, data: { ...n.data, netName: finalNet } } : n));
  };

  const handleMergeConfirm = (netA: any, netB: any, sourceId: any, targetId: any) => {
      saveHistory();
      const newNetName = netA;
      
      // Update nodes belonging to netB to newNetName
      setNodes((prev: any[]) => prev.map(n => n.data.netName === netB ? { ...n, data: { ...n.data, netName: newNetName } } : n));
      
      // Update edges belonging to netB to newNetName
      // Also add the newly created connection edge
      const newEdge = { id: `edge_${getId()}`, source: sourceId, target: targetId, type: 'net_edge', data: { netName: newNetName } };
      
      setEdges(prev => {
          const updatedEdges = prev.map(e => e.data.netName === netB ? { ...e, data: { ...e.data, netName: newNetName } } : e);
          return [...updatedEdges, newEdge];
      });
      
      // Explicitly update source and target nodes if they don't have a netName yet (though merge implies they likely do)
      // This ensures consistency if one side was a "net" but the specific node wasn't labeled
      setNodes((prev: any[]) => prev.map(n => (n.id === sourceId || n.id === targetId) && (!n.data.netName || n.data.netName === netB) ? { ...n, data: { ...n.data, netName: newNetName } } : n));

      setDialog({ isOpen: false });
  };

  const propagateNetRename = (startEdgeId: any, newNetName: any) => {
      const connected = getConnectedEdges(startEdgeId);
      const affectedNodes = new Set();
      edges.forEach(e => {
          if (connected.has(e.id)) {
              affectedNodes.add(e.source);
              affectedNodes.add(e.target);
          }
      });

      setEdges(prev => prev.map(e => connected.has(e.id) ? { ...e, data: { ...e.data, netName: newNetName } } : e));
      setNodes((prev: any[]) => prev.map(n => affectedNodes.has(n.id) && (n.type === 'port' || n.type === 'net_node') ? { ...n, data: { ...n.data, netName: newNetName } } : n));
  };

  const handleDialogConfirm = (name: any, type: any) => {
      saveHistory();
      if (dialog.type === 'comp') {
          const { x, y, w, h } = dialog.data;
          setNodes((prev: any[]) => {
              const uniqueId = `comp_${name}_${getId()}`;
              return [...prev, { 
                  id: uniqueId, 
                  type: 'component', 
                  position: { x, y }, 
                  width: w, 
                  height: h, 
                  data: { label: name, type, rawId: `#${Date.now()}` } 
              }];
          });
      } else if (dialog.type === 'port') {
        const { x, y, context } = dialog.data;
        
        setNodes((prev: any[]) => {
             let externalId: string | undefined = undefined;
             // Calculate auto-increment externalId for external ports
             if (context.type === 'ext') {
                 const existingIds = prev
                    .filter(n => n.type === 'port' && n.data.isExternal && n.data.externalId !== undefined)
                    .map(n => {
                        const s = String(n.data.externalId).replace('#', '');
                        return parseInt(s, 10);
                    })
                    .filter(n => !isNaN(n));
                 
                 let nextId = 1;
                 if (existingIds.length > 0) {
                     nextId = Math.max(...existingIds) + 1;
                 }
                 externalId = `${nextId}`;
             }

             const newNode = { 
                 id: getId(), 
                 type: 'port', 
                 position: { x, y }, 
                 parentId: context.type === 'int' ? context.parent.id : null, 
                 data: { 
                     label: name || '', 
                     type: type || 'port', 
                     isExternal: context.type === 'ext', 
                     compName: context.type === 'int' ? context.parent.data.label : 'ext',
                     externalId 
                 } 
             };
             return [...prev, newNode];
        });
    } else if (dialog.type === 'CONVERT_NET_TO_PORT') {
        const nodeId = dialog.data.nodeId;
        setNodes((prev: any[]) => {
            let externalId: string | undefined = undefined;
            const existingIds = prev
                .filter(n => n.type === 'port' && n.data.isExternal && n.data.externalId !== undefined)
                .map(n => { const s = String(n.data.externalId).replace('#', ''); return parseInt(s, 10); })
                .filter(n => !isNaN(n));
            let nextId = 1;
            if (existingIds.length > 0) nextId = Math.max(...existingIds) + 1;
            externalId = `${nextId}`;

            return prev.map(n => n.id === nodeId ? {
                ...n,
                type: 'port',
                data: { ...n.data, label: name || '', type: type || 'port', isExternal: true, compName: 'external', externalId }
            } : n);
        });
    }
      setDialog({ isOpen: false, type: '', data: null });
  };

  const downloadCurrentJson = async () => {
      const dataStr = reactStateToPythonData(nodes, edges, extraTaskData);
      
      const currentFile = fileList[currentFileIndex];
      let handle = currentFile?.jsonHandle;

      // Lazy creation logic: If no handle but we have a project directory, try to create one
      if (!handle && projectDirHandle && currentFile) {
          try {
              const baseName = currentFile.name.substring(0, currentFile.name.lastIndexOf('.'));
              const jsonName = `${baseName}.json`;
              
              // Create file handle
              // @ts-ignore
              handle = await projectDirHandle.getFileHandle(jsonName, { create: true });
              
              // Update fileList state to store this new handle for future saves
              setFileList(prev => {
                  const copy = [...prev];
                  // Use finding by ID or Index to be safe, though index should be stable here
                  if (copy[currentFileIndex]) {
                      copy[currentFileIndex] = {
                          ...copy[currentFileIndex],
                          jsonHandle: handle,
                          status: 'annotated'
                      };
                  }
                  return copy;
              });
              
          } catch (e) {
              console.error("Failed to auto-create JSON file:", e);
          }
      }

      if (handle) {
          try {
              // @ts-ignore - File System Access API
              const writable = await handle.createWritable();
              await writable.write(dataStr);
              await writable.close();
              setNotification("Saved to file successfully (Overwritten)!");
              return;
          } catch (e) {
              console.error("Failed to save to handle:", e);
              // Fallback to download if write fails
              setNotification("Failed to overwrite file (Check permissions). Downloading instead.");
          }
      } else {
        // Explicit notification if we are in download mode when the user might expect overwrite
        if (window.location.protocol === 'http:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
             setNotification("Note: Remote HTTP connections cannot overwrite local files. Downloading instead.");
        } else {
             setNotification("File saved (Downloaded)");
        }
      }

      const blob = new Blob([dataStr], {type:'application/json'});
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (fileList[currentFileIndex]?.name.replace(/\.[^/.]+$/, "") || "circuit") + ".json";
      a.click();
  };

  const filteredFiles = fileList.filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase()));
  const rawSingleSelected = selectedIds.size === 1 ? (nodes.find(n => n.id === [...selectedIds][0]) || edges.find(e => e.id === [...selectedIds][0])) : null;

  // Check for Multi-Select Same Net (Whole Network Selection)
  const selectedNetName = useMemo(() => {
      if (selectedIds.size <= 1) return null;
      let name: string | null = null;
      const ids = Array.from(selectedIds);
      
      const firstItem = nodes.find(n => n.id === ids[0]) || edges.find(e => e.id === ids[0]);
      if (!firstItem?.data?.netName) return null;
      name = firstItem.data.netName;

      for (let i = 1; i < ids.length; i++) {
          const item = nodes.find(n => n.id === ids[i]) || edges.find(e => e.id === ids[i]);
          if (item?.data?.netName !== name) return null;
      }
      return name;
  }, [selectedIds, nodes, edges]);

  const singleSelected = rawSingleSelected || (selectedNetName ? {
      id: [...selectedIds][0], // Use one valid ID for operations like rename
      type: 'net_edge',
      data: { netName: selectedNetName },
      position: { x: 0, y: 0 }
  } : null);

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-200 font-sans overflow-hidden transition-colors duration-200">
        {notification && <Notification message={notification} onClose={() => setNotification(null)} />}
        <ModalDialog isOpen={dialog.isOpen} type={dialog.type} data={dialog.data} options={dialog.options} initialName={dialog.initialName} initialType={dialog.initialType} position={dialog.position} onConfirm={dialog.onConfirm || handleDialogConfirm} onCancel={dialog.onCancel || (() => setDialog({ isOpen: false }))} />
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
        <div className="h-14 bg-white dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 flex items-center px-4 justify-between shrink-0 transition-colors">
            <div className="flex items-center gap-3">
                <div className="bg-blue-600 p-1.5 rounded-lg"><Network size={20} className="text-white"/></div>
                <div>
                    <h1 className="font-bold text-lg leading-tight text-slate-900 dark:text-white">Circuit Studio</h1>
                    <div className="text-[10px] text-slate-500 font-medium tracking-wider">PROFESSIONAL LABELER</div>
                </div>
            </div>
            <div className="flex items-center gap-4">
                <div className="flex bg-slate-100 dark:bg-slate-800 rounded-md p-1 border border-slate-200 dark:border-slate-700 items-center transition-colors">
                    <button onClick={undo} disabled={past.length===0} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white disabled:opacity-30 transition-colors"><Undo size={16}/></button>
                    <button onClick={redo} disabled={future.length===0} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white disabled:opacity-30 transition-colors"><Redo size={16}/></button>
                </div>
                
                <button onClick={() => setLlmPanelOpen(!llmPanelOpen)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                        llmPanelOpen 
                            ? 'bg-gradient-to-r from-violet-600 to-blue-600 text-white shadow-lg shadow-violet-500/20' 
                            : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}>
                    <Sparkles size={16}/>
                    <span>AI</span>
                </button>

                <button onClick={() => setShowSettings(true)} className="flex items-center gap-2 px-3 py-1.5 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors text-sm font-medium">
                    <Settings size={16} />
                    <span>Settings</span>
                </button>

                <button onClick={taskId ? handleSaveToServer : downloadCurrentJson} disabled={currentFileIndex===-1 && !taskId} className={`${taskId ? 'bg-orange-600 hover:bg-orange-500 shadow-orange-900/20' : 'bg-blue-600 hover:bg-blue-500 shadow-blue-900/20'} text-white px-4 py-2 rounded-md text-sm font-bold flex items-center gap-2 transition-colors shadow-lg disabled:opacity-50 disabled:cursor-not-allowed`}>
                    <Save size={16}/> {taskId ? "SAVE & RETURN ( U )" : "SAVE JSON ( U )"}
                </button>
            </div>
        </div>

        {/* --- Workspace --- */}
        <div className="flex flex-1 overflow-hidden">
            {/* Left Sidebar: Combined File Browser & Inspector */}
            <div ref={sidebarRef} className="w-72 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col shrink-0 z-20 shadow-xl relative transition-colors">
                {/* 1. Top Section: File Browser */}
                <div style={{ height: `${sidebarSplit}%`, minHeight: '10%', maxHeight: '90%' }} className="flex flex-col min-h-0">
                    <div className="p-3 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2 bg-slate-50 dark:bg-slate-950/50 text-slate-700 dark:text-slate-200 transition-colors">
                        <FolderOpen size={14} className="text-blue-600 dark:text-blue-500"/>
                        <span className="text-xs font-bold uppercase tracking-wider">Project Files</span>
                    </div>
                    
                    <div className="p-3 border-b border-slate-200 dark:border-slate-800 space-y-2 transition-colors">
                        <div className="flex gap-2">
                            <button onClick={handleAddFilesWithPicker} className="flex-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 py-1.5 rounded border border-slate-200 dark:border-slate-700 flex items-center justify-center gap-2 text-xs font-medium transition-colors">
                                <Plus size={14}/> Add Files
                            </button>
                            <button onClick={handleOpenFolder} className="flex-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 py-1.5 rounded border border-slate-200 dark:border-slate-700 flex items-center justify-center gap-2 text-xs font-medium transition-colors">
                                <FolderOpen size={14}/> Open Folder
                            </button>
                        </div>
                        <input ref={fileInputRef} type="file" multiple accept="image/*,.json" className="hidden" onChange={handleFileUpload} />
                        <div className="relative">
                            <Search size={12} className="absolute left-2.5 top-2 text-slate-400 dark:text-slate-500"/>
                            <input type="text" placeholder="Filter..." className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded py-1.5 pl-7 pr-2 text-[11px] text-slate-900 dark:text-slate-300 focus:border-blue-500 outline-none transition-colors" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}/>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto custom-scrollbar">
                        {filteredFiles.length === 0 ? <div className="p-4 text-center text-slate-400 dark:text-slate-600 text-[10px] italic">No files loaded</div> : (
                            <div className="flex flex-col">
                                {filteredFiles.map((f) => {
                                    const realIdx = fileList.indexOf(f);
                                    const isActive = realIdx === currentFileIndex;
                                    return (
                                        <div key={f.id} onClick={() => { saveCurrentStateToMemory(); loadFile(realIdx); }} 
                                            className={`flex items-center px-3 py-2 cursor-pointer border-l-2 transition-all ${isActive ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-500 text-blue-700 dark:text-white' : 'border-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-200'}`}>
                                            <CheckCircle2 size={10} className={`mr-2 ${f.status === 'annotated' || f.data ? 'text-green-500' : 'text-slate-300 dark:text-slate-700'}`}/>
                                            <span className="text-xs truncate font-medium">{f.name}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                    
                    <div className="p-2 bg-slate-50 dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 flex justify-between items-center text-[10px] text-slate-500 shrink-0 transition-colors">
                        <button onClick={() => switchFile(-1)} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-800 rounded text-slate-400 hover:text-slate-700 dark:hover:text-white transition-colors"><ChevronLeft size={14}/></button>
                        <span className="font-mono">{fileList.length > 0 ? `${currentFileIndex + 1}/${fileList.length}` : '-/-'}</span>
                        <button onClick={() => switchFile(1)} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-800 rounded text-slate-400 hover:text-slate-700 dark:hover:text-white transition-colors"><ChevronRight size={14}/></button>
                    </div>
                </div>

                {/* Resizer Handle */}
                <div 
                    className="h-1 bg-slate-200 dark:bg-slate-950 border-y border-slate-300 dark:border-slate-800 cursor-row-resize hover:bg-blue-500 dark:hover:bg-blue-600 transition-colors flex items-center justify-center group z-10"
                    onMouseDown={() => setIsResizingSidebar(true)}
                >
                    <GripHorizontal size={12} className="text-slate-400 dark:text-slate-700 group-hover:text-white/50"/>
                </div>

                {/* 2. Bottom Section: Inspector (Flexible) */}
                <div className="flex-1 flex flex-col bg-white dark:bg-slate-900 overflow-hidden relative transition-colors">
                     {/* Local Datalists removed, using global-comp-types and global-port-names defined at root */}
                     
                     <div className="h-9 border-b border-slate-200 dark:border-slate-800 flex items-center px-4 font-bold text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider bg-slate-50 dark:bg-slate-950/50 shrink-0 transition-colors">
                        <Settings size={14} className="mr-2 text-slate-400 dark:text-slate-500"/> Properties
                     </div>
                     <div className="flex-1 overflow-y-auto p-4">
                         {singleSelected ? (
                             singleSelected.type === 'component' ? (
                                 <div className="space-y-4 animate-in fade-in slide-in-from-right-5 duration-200">
                                     <div><label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase mb-1 block">Name</label><input className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1.5 text-sm text-slate-900 dark:text-slate-200 outline-none focus:border-blue-500 placeholder-slate-400 dark:placeholder-slate-600" value={singleSelected.data.label} onChange={e => { saveHistory(); const v=e.target.value; setNodes((prev: any[]) => prev.map(n => n.id === singleSelected.id ? { ...n, data: { ...n.data, label: v } } : n)); }} /></div>
                                     <div><label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase mb-1 block">Type</label>
                                        <AutocompleteInput 
                                            className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1.5 text-sm text-slate-900 dark:text-slate-200 outline-none focus:border-blue-500 placeholder-slate-400 dark:placeholder-slate-600" 
                                            options={uniqueComponentTypes}
                                            value={singleSelected.data.type} 
                                            onFocus={(e: any) => e.target.select()}
                                            onChange={(v: any) => { saveHistory(); setNodes((prev: any[]) => prev.map(n => n.id === singleSelected.id ? { ...n, data: { ...n.data, type: v } } : n)); }} 
                                        />
                                     </div>
                                     
                                     <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
                                         <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase mb-2 block">Ports</label>
                                         <div className="space-y-1">
                                             {nodes.filter(n => n.parentId === singleSelected.id).map(p => {
                                                const hasConflict = conflicts.has(p.id);
                                                return (
                                                 <div key={p.id} className="flex flex-col gap-1 mb-2">
                                                     <div className="flex gap-2">
                                                        <AutocompleteInput 
                                                           className={`flex-1 bg-slate-50 dark:bg-slate-800 border rounded px-1.5 py-0.5 text-xs text-slate-700 dark:text-slate-300 outline-none focus:border-blue-500 ${hasConflict ? 'border-red-500/50 bg-red-900/10 text-red-300' : 'border-slate-200 dark:border-slate-700'}`} 
                                                           options={uniquePortNames}
                                                            onFocus={(e: any) => e.target.select()}
                                                            value={p.data.label} 
                                                           onChange={(v: any) => { saveHistory(); setNodes((prev: any[]) => prev.map(n => n.id === p.id ? { ...n, data: { ...n.data, label: v } } : n)); }}
                                                        />
                                                        <input className="w-16 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-1.5 py-0.5 text-[10px] text-slate-700 dark:text-slate-300 outline-none focus:border-blue-500 placeholder-slate-400 dark:placeholder-slate-600" value={p.data.type||''} placeholder="Type" onChange={e => { saveHistory(); const v=e.target.value; setNodes((prev: any[]) => prev.map(n => n.id === p.id ? { ...n, data: { ...n.data, type: v } } : n)); }}/>
                                                    </div>
                                                     {hasConflict && <div className="text-[9px] text-red-400 flex items-center gap-1"><AlertTriangle size={10}/> Net Conflict Detected</div>}
                                                 </div>
                                                );
                                             })}
                                             <button onClick={() => { saveHistory(); setNodes(prev => [...prev, { id: getId(), type: 'port', position: { x: singleSelected.position.x + 10, y: singleSelected.position.y + 10 }, parentId: singleSelected.id, data: { label: `P${nodes.filter(n => n.parentId === singleSelected.id).length + 1}`, isExternal: false, compName: singleSelected.data.label } }]); }} className="w-full py-1 text-xs text-blue-400 border border-dashed border-blue-900 rounded hover:bg-blue-900/20 mt-2">+ Add Port</button>
                                         </div>
                                     </div>

                                     {/* Position & Size Editing (Moved to bottom) */}
                                     <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
                                         <div className="grid grid-cols-2 gap-2">
                                             <div>
                                                 <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase mb-1 block">X</label>
                                                 <input className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1.5 text-xs text-slate-900 dark:text-slate-300 font-mono outline-none focus:border-blue-500" 
                                                     type="number" value={Math.round(singleSelected.position.x)} 
                                                     onChange={e => { saveHistory(); const v=parseInt(e.target.value); setNodes((prev: any[]) => prev.map(n => n.id === singleSelected.id ? { ...n, position: { ...n.position, x: v } } : n)); }} />
                                             </div>
                                             <div>
                                                 <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase mb-1 block">Y</label>
                                                 <input className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1.5 text-xs text-slate-900 dark:text-slate-300 font-mono outline-none focus:border-blue-500" 
                                                     type="number" value={Math.round(singleSelected.position.y)} 
                                                     onChange={e => { saveHistory(); const v=parseInt(e.target.value); setNodes((prev: any[]) => prev.map(n => n.id === singleSelected.id ? { ...n, position: { ...n.position, y: v } } : n)); }} />
                                             </div>
                                             <div>
                                                 <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase mb-1 block">W</label>
                                                 <input className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1.5 text-xs text-slate-900 dark:text-slate-300 font-mono outline-none focus:border-blue-500" 
                                                     type="number" value={Math.round(singleSelected.width)} 
                                                     onChange={e => { saveHistory(); const v=parseInt(e.target.value); setNodes((prev: any[]) => prev.map(n => n.id === singleSelected.id ? { ...n, width: v } : n)); }} />
                                             </div>
                                             <div>
                                                 <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase mb-1 block">H</label>
                                                 <input className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1.5 text-xs text-slate-900 dark:text-slate-300 font-mono outline-none focus:border-blue-500" 
                                                     type="number" value={Math.round(singleSelected.height)} 
                                                     onChange={e => { saveHistory(); const v=parseInt(e.target.value); setNodes((prev: any[]) => prev.map(n => n.id === singleSelected.id ? { ...n, height: v } : n)); }} />
                                             </div>
                                         </div>
                                     </div>

                                     <button onClick={() => deleteSelected(false)} className="w-full py-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900/50 rounded text-xs font-bold hover:bg-red-100 dark:hover:bg-red-900/40 flex justify-center gap-2 mt-4"><Trash2 size={14}/> Delete Component</button>
                                 </div>
                             ) : (
                                 // Wire / Net / Port Selection
                                 <div className="space-y-4 animate-in fade-in slide-in-from-right-5 duration-200">
                                    <div className="flex items-center gap-2 mb-2 pb-2 border-b border-slate-200 dark:border-slate-800">
                                        <Network size={16} className="text-slate-400"/>
                                        <span className="text-xs font-bold text-slate-300">
                                           {singleSelected.type === 'net_edge' ? 'Wire Segment' : (singleSelected.type === 'port' ? (singleSelected.data.isExternal ? 'External_Port' : 'Port') : 'Net Node')}
                                        </span>
                                    </div>
                                    
                                    {/* Port Name & Type Editing */}
                                    {singleSelected.type === 'port' && (
                                        <div className="mb-4 pb-4 border-b border-slate-200 dark:border-slate-800 space-y-3">
                                            <div>
                                                <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase mb-1 block">Name</label>
                                                <AutocompleteInput 
                                                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1.5 text-sm text-slate-900 dark:text-slate-200 outline-none focus:border-blue-500 placeholder-slate-400 dark:placeholder-slate-600"
                                                    options={uniquePortNames}
                                                    value={singleSelected.data.label} 
                                                    onFocus={(e: any) => e.target.select()}
                                                    onChange={(v: any) => { saveHistory(); setNodes((prev: any[]) => prev.map(n => n.id === singleSelected.id ? { ...n, data: { ...n.data, label: v } } : n)); }}
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase mb-1 block">Type</label>
                                                <AutocompleteInput 
                                                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1.5 text-sm text-slate-900 dark:text-slate-200 outline-none focus:border-blue-500 placeholder-slate-400 dark:placeholder-slate-600" 
                                                    options={uniquePortTypes}
                                                    value={singleSelected.data.type || ''} 
                                                    placeholder="e.g. port"
                                                    onFocus={(e: any) => e.target.select()}
                                                    onChange={(v: any) => { saveHistory(); setNodes((prev: any[]) => prev.map(n => n.id === singleSelected.id ? { ...n, data: { ...n.data, type: v } } : n)); }} 
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {/* Net Name Input with Propagation */}
                                     <div>
                                         <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase mb-1 block">Net Name</label>
                                         <div className="flex gap-2">
                                            <input className={`w-full bg-slate-50 dark:bg-slate-800 border rounded px-2 py-1.5 text-sm text-slate-900 dark:text-slate-200 outline-none focus:border-blue-500 placeholder-slate-400 dark:placeholder-slate-600 ${conflicts.has(singleSelected.id) ? 'border-red-500/50 bg-red-900/10' : 'border-slate-200 dark:border-slate-700'}`} 
                                                value={singleSelected.data?.netName || ''} 
                                                onChange={e => {  
                                                    saveHistory(); 
                                                    const v = e.target.value;
                                                    if (singleSelected.type === 'net_edge') {
                                                        propagateNetRename(singleSelected.id, v);
                                                    } else {
                                                        setNodes((prev: any[]) => prev.map(n => n.id === singleSelected.id ? { ...n, data: { ...n.data, netName: v } } : n));
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

                                     {/* Convert Net Node to External Port */}
                                     {singleSelected.type === 'net_node' && (
                                         <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
                                             <button onClick={() => {
                                                 setDialog({
                                                     isOpen: true,
                                                     type: 'CONVERT_NET_TO_PORT',
                                                     data: { nodeId: singleSelected.id },
                                                     initialType: 'port',
                                                     options: { compTypes: uniqueComponentTypes, portNames: uniquePortNames, portTypes: uniquePortTypes },
                                                 });
                                             }} className="w-full py-2 bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 border border-orange-200 dark:border-orange-900/50 rounded text-xs font-bold hover:bg-orange-100 dark:hover:bg-orange-900/40 flex justify-center gap-2">
                                                 <CircleDot size={14}/> 转为 External Port
                                             </button>
                                         </div>
                                     )}

                                     {/* Node Position Editing (Moved to bottom) */}
                                     {singleSelected.type !== 'net_edge' && (
                                         <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
                                             <div className="grid grid-cols-2 gap-2">
                                                 <div>
                                                     <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase mb-1 block">X</label>
                                                     <input className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1.5 text-xs text-slate-900 dark:text-slate-300 font-mono outline-none focus:border-blue-500" 
                                                         type="number" value={Math.round(singleSelected.position.x)} 
                                                         onChange={e => { saveHistory(); const v=parseInt(e.target.value); setNodes((prev: any[]) => prev.map(n => n.id === singleSelected.id ? { ...n, position: { ...n.position, x: v } } : n)); }} />
                                                 </div>
                                                 <div>
                                                     <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase mb-1 block">Y</label>
                                                     <input className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1.5 text-xs text-slate-900 dark:text-slate-300 font-mono outline-none focus:border-blue-500" 
                                                         type="number" value={Math.round(singleSelected.position.y)} 
                                                         onChange={e => { saveHistory(); const v=parseInt(e.target.value); setNodes((prev: any[]) => prev.map(n => n.id === singleSelected.id ? { ...n, position: { ...n.position, y: v } } : n)); }} />
                                                 </div>
                                             </div>
                                         </div>
                                     )}

                                    <div className="grid grid-cols-2 gap-2 mt-4">
                                       {!selectedNetName && (
                                           <button onClick={() => deleteSelected(false)} className="py-2 bg-slate-800 text-slate-400 rounded text-[10px] font-bold hover:bg-slate-700 flex justify-center gap-1 border border-slate-700"><Trash2 size={12}/> Del Segment</button>
                                       )}
                                       <button onClick={() => deleteSelected(true)} className={`py-2 bg-red-900/20 text-red-400 rounded text-[10px] font-bold hover:bg-red-100 dark:hover:bg-red-900/40 flex justify-center gap-1 border border-red-900/50 ${selectedNetName ? 'col-span-2' : ''}`}><Trash2 size={12}/> Del Net</button>
                                    </div>
                                 </div>
                             )
                         ) : (
                             <div className="h-full flex flex-col items-center justify-center text-slate-700 gap-2">
                                 <MousePointer2 size={48} strokeWidth={1} className="text-slate-300 dark:text-slate-700"/>
                                 <div className="text-center">
                                     <p className="text-sm font-bold text-slate-400 dark:text-slate-600">No Selection</p>
                                     <p className="text-xs text-slate-400 dark:text-slate-600 mt-1">Select an object to edit</p>
                                 </div>
                             </div>
                         )}
                     </div>
                </div>
            </div>

            {/* Center: Canvas */}
            <div className="flex-1 relative flex flex-col bg-slate-50 dark:bg-slate-900 overflow-hidden transition-colors duration-200">
                {/* Grid Background Pattern */}
                <div className="absolute inset-0 pointer-events-none opacity-40 dark:opacity-25" 
                    style={{ 
                        backgroundImage: `radial-gradient(var(--grid-dot-color) 1px, transparent 1px)`, 
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
                        if (!containerRef.current) return;
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
                            if (effectiveHiddenIds.has(n.id)) return null;
                            if (n.parentId && effectiveHiddenIds.has(n.parentId)) return null;

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
                                        {!hideAll && !isNet && n.data.label && (showPorts || n.data.isExternal || (n.parentId && selectedIds.has(n.parentId))) && (
                                            <div className="absolute left-2.5 -top-5 bg-indigo-600 text-white text-[9px] px-1.5 py-0.5 rounded shadow-lg whitespace-nowrap z-50 pointer-events-none border border-indigo-400/50">
                                                {n.data.label}
                                            </div>
                                        )}
                                    </div>
                                );
                            }
                        })}
                        
                        {!hideAll && showLabels && netLabels.map((l: any, i) => (
                            <div key={i} className="absolute z-30 px-1.5 py-0.5 bg-white/95 border rounded text-[10px] font-mono shadow-sm cursor-pointer hover:scale-110 transition-transform select-none hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700"
                                style={{ left: l.x, top: l.y, transform: 'translate(-50%,-50%)', borderColor: stringToColor(l.name), color: stringToColor(l.name) }}
                                onClick={(e) => { 
                                    e.stopPropagation(); 
                                    // Find all edges and nodes belonging to this net
                                    const netEdges = edges.filter(ed => ed.data?.netName === l.name);
                                    const netNodes = nodes.filter(n => n.type === 'net_node' && n.data?.netName === l.name);
                                    
                                    const ids = new Set([...netEdges.map(e => e.id), ...netNodes.map(n => n.id)]);

                                    // Fallback: use edgeId from label if no explicit netName matches found (shouldn't happen if l.name comes from netName)
                                    if (ids.size === 0 && l.edgeId) {
                                         const edgeToSelect = edges.find(ed => ed.id === l.edgeId);
                                         if (edgeToSelect) ids.add(edgeToSelect.id);
                                    }

                                    if (ids.size > 0) {
                                        setSelectedIds(ids);
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

            {/* Right Panel: Tags or AI */}
            {!llmPanelOpen && (
                <RightSidebar 
                    nodes={nodes}
                    componentTypes={uniqueComponentTypes}
                    portNames={uniquePortNames}
                    onAddType={(t: string) => setExtraTypes(prev => [...prev, t])}
                    onAddPort={(p: string) => setExtraPorts(prev => [...prev, p])}
                    hiddenTypes={hiddenTypes}
                    setHiddenTypes={setHiddenTypes}
                    hiddenNodeIds={hiddenNodeIds}
                    setHiddenNodeIds={setHiddenNodeIds}
                    onSelectIds={(id: any) => {
                        setSelectedIds(new Set([id]));
                        setMode(MODE.VIEW);
                    }}
                />
            )}
            <LLMChatPanel
                isOpen={llmPanelOpen}
                onClose={() => setLlmPanelOpen(false)}
                nodes={nodes}
                edges={edges}
                extraData={extraTaskData}
                onApplyNetlist={handleApplyLLMNetlist}
                bgImage={bgImage}
                notify={setNotification}
                onHighlight={(ids: any) => setSelectedIds(new Set(ids))}
            />
        </div>
    </div>
  );
}