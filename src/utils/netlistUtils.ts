import { deepMergeObj, getId, safeJsonParse } from './commonUtils';
import { SNAPPING_THRESHOLD } from './constants';

export const mergeConnectionData = (existing: any, incoming: any) => {
    const merged = deepMergeObj(existing, incoming);
    if (existing.ports && Array.isArray(existing.ports) && incoming.ports && Array.isArray(incoming.ports)) {
        // Dedup ports array: [ ['dev1', 'p1'], ['dev1', 'p1'] ] -> [ ['dev1', 'p1'] ]
        const sigs = new Set();
        const combined = [];
        for (const p of [...existing.ports, ...incoming.ports]) {
            const sig = JSON.stringify(p);
            if (!sigs.has(sig)) {
                sigs.add(sig);
                combined.push(p);
            }
        }
        merged.ports = combined;
    }
    if (existing.pixels && Array.isArray(existing.pixels) && incoming.pixels && Array.isArray(incoming.pixels)) {
         merged.pixels = [...existing.pixels, ...incoming.pixels];
    }
    return merged;
};

export const applyCorrectionItems = (baselineJson: string, items: any[], checked: boolean[]): string => {
    const data = JSON.parse(baselineJson);
    const connRenames = new Map<string, string>(); // oldKey -> newKey
    const extRenames = new Map<string, string>(); // oldKey -> newKey (for external_ports)

    // Helper to find key robustly (case-insensitive, ignore # prefix)
    const findKey = (obj: any, key: string) => {
        if (!obj) return null;
        if (obj[key]) return key;
        
        const normalized = key.trim().toLowerCase();
        // Prepare variations: with #, without #
        const normalizedHash = normalized.startsWith('#') ? normalized : '#' + normalized;
        const normalizedNoHash = normalized.startsWith('#') ? normalized.substring(1) : normalized;
        
        return Object.keys(obj).find(k => {
            const kn = k.trim().toLowerCase();
            return kn === normalized || kn === normalizedHash || kn === normalizedNoHash;
        }) || null;
    };

    // Helper to compare IDs robustly (ignore # prefix)
    const isIdMatch = (id1: string, id2: string) => {
        if (id1 === id2) return true;
        const n1 = id1.trim();
        const n2 = id2.trim();
        if (n1 === n2) return true;
        const n1NoHash = n1.startsWith('#') ? n1.substring(1) : n1;
        const n2NoHash = n2.startsWith('#') ? n2.substring(1) : n2;
        return n1NoHash === n2NoHash;
    };

    items.forEach((c, i) => {
        if (!checked[i]) return;
        if (c.to === 'ckt_netlist') {
            if (c.type === 'modify') {
                // ckt_netlist is array, find by id using robust match
                const idx = (data.ckt_netlist || []).findIndex((item: any) => isIdMatch(item.id, c.key));
                
                if (idx >= 0) {
                    const comp = data.ckt_netlist[idx];
                    // Sync port_connection changes to connection map to ensure graph consistency
                    if (c.content && c.content.port_connection) {
                        const compName = comp.name || comp.device_name;
                        for (const [portName, newNet] of Object.entries(c.content.port_connection)) {
                            const oldNet = comp.port_connection?.[portName];
                            if (oldNet && oldNet !== newNet) {
                                // Remove from oldNet (robust lookup)
                                if (data.connection) {
                                    const oldNetKey = findKey(data.connection, oldNet);
                                    if (oldNetKey && data.connection[oldNetKey].ports) {
                                        data.connection[oldNetKey].ports = data.connection[oldNetKey].ports.filter((p: any) => !(p[0] === compName && p[1] === portName));
                                    }
                                }
                                // Add to newNet
                                if (!data.connection) data.connection = {};
                                // Ensure newNet key exists
                                const newNetKey = newNet as string;
                                if (!data.connection[newNetKey]) data.connection[newNetKey] = { ports: [], pixels: [] };
                                if (!data.connection[newNetKey].ports) data.connection[newNetKey].ports = [];
                                
                                const exists = data.connection[newNetKey].ports.some((p: any) => p[0] === compName && p[1] === portName);
                                if (!exists) data.connection[newNetKey].ports.push([compName, portName]);
                            }
                        }
                    }
                    data.ckt_netlist[idx] = deepMergeObj(data.ckt_netlist[idx], c.content || {});
                }
            } else if (c.type === 'del') {
                data.ckt_netlist = (data.ckt_netlist || []).filter((item: any) => !isIdMatch(item.id, c.key));
            } else if (c.type === 'add') {
                (data.ckt_netlist = data.ckt_netlist || []).push({ id: c.key, ...c.content });
            }
        } else if (c.to === 'connection') {
            data.connection = data.connection || {};
            const realKey = findKey(data.connection, c.key);
            
            if (c.type === 'modify' && realKey) {
                const merged = deepMergeObj(data.connection[realKey], c.content || {});
                // Check multiple possible rename fields
                const newKey = merged.key || merged.rename_to || merged.name || merged.new_name || merged.new_key;
                
                if (newKey && newKey !== realKey) {
                    // Clean up special properties from the merged object
                    delete merged.key;
                    delete merged.rename_to;
                    delete merged.name;
                    delete merged.new_name;
                    delete merged.new_key;
                    
                    // Remove old key
                    delete data.connection[realKey];
                    
                    // Assign to new key (merge if exists)
                    if (data.connection[newKey]) {
                        data.connection[newKey] = mergeConnectionData(data.connection[newKey], merged);
                    } else {
                        data.connection[newKey] = merged;
                    }
                    
                    // Record rename for ckt_netlist propagation using REAL key
                    connRenames.set(realKey, newKey);
                } else {
                    delete merged.rename_to;
                    delete merged.name;
                    delete merged.new_name;
                    delete merged.new_key;
                    data.connection[realKey] = merged;
                }
            }
            else if (c.type === 'del' && realKey) delete data.connection[realKey];
            else if (c.type === 'add') {
                const content = c.content || {};
                const addKey = content.key || content.rename_to || content.name || content.new_name || content.new_key;
                const targetKey = addKey || c.key;
                
                // If renaming during add (rare but possible in some diffs)
                const newContent = { ...content };
                delete newContent.key;
                delete newContent.rename_to;
                delete newContent.name;
                delete newContent.new_name;
                delete newContent.new_key;

                if (data.connection[targetKey]) {
                    data.connection[targetKey] = mergeConnectionData(data.connection[targetKey], newContent);
                } else {
                    data.connection[targetKey] = newContent;
                }
            }
        } else if (c.to === 'external_ports') {
            data.external_ports = data.external_ports || {};
            const realKey = findKey(data.external_ports, c.key);

            if (c.type === 'modify' && realKey) {
                const merged = deepMergeObj(data.external_ports[realKey], c.content || {});
                const newKey = merged.key || merged.rename_to || merged.new_key;
                
                if (newKey && newKey !== realKey) {
                    delete merged.key;
                    delete merged.rename_to;
                    // delete merged.name; // Keep name property for external_ports
                    delete merged.new_name;
                    delete merged.new_key;
                    
                    delete data.external_ports[realKey];
                    
                    if (data.external_ports[newKey]) {
                         data.external_ports[newKey] = deepMergeObj(data.external_ports[newKey], merged);
                    } else {
                         data.external_ports[newKey] = merged;
                    }
                    extRenames.set(realKey, newKey);
                } else {
                    delete merged.rename_to;
                    // delete merged.name; // Keep name property for external_ports
                    delete merged.new_name;
                    delete merged.new_key;
                    data.external_ports[realKey] = merged;
                }
            }
            else if (c.type === 'del' && realKey) delete data.external_ports[realKey];
            else if (c.type === 'add') {
                const content = c.content || {};
                // External Ports: Key is ID. Name is a property.
                // Do NOT use content.name as key.
                const addKey = content.key || content.new_key || content.id; 
                const targetKey = addKey || c.key; 
                
                const newContent = { ...content };
                delete newContent.key;
                delete newContent.rename_to;
                // delete newContent.name; // Keep name property for external_ports
                delete newContent.new_name;
                delete newContent.new_key;
                delete newContent.id;
                
                if (data.external_ports[targetKey]) {
                    data.external_ports[targetKey] = deepMergeObj(data.external_ports[targetKey], newContent);
                } else {
                    data.external_ports[targetKey] = newContent;
                }
            }
        }
    });
    
    // Auto-propagate external_ports renames to connection references
    if (extRenames.size > 0 && data.connection) {
        Object.values(data.connection).forEach((net: any) => {
            if (Array.isArray(net.ports)) {
                net.ports.forEach((p: any) => {
                    // p is [devName, portName]. For external ports, devName is 'external' and portName is the key.
                    if (p[0] === 'external' && extRenames.has(p[1])) {
                        p[1] = extRenames.get(p[1]);
                    }
                });
            }
        });
    }

    // Auto-propagate connection renames to ckt_netlist port_connection
    if (connRenames.size > 0 && data.ckt_netlist) {
        (data.ckt_netlist as any[]).forEach((comp: any) => {
            if (!comp.port_connection) return;
            for (const portName of Object.keys(comp.port_connection)) {
                const oldNet = comp.port_connection[portName];
                // Check exact or robust match
                if (connRenames.has(oldNet)) {
                    comp.port_connection[portName] = connRenames.get(oldNet);
                } else {
                    // Try robust match for oldNet in case ckt_netlist has weird spacing
                    // We need to check if ANY key in connRenames matches this robust key
                    for (const [renamedOld, renamedNew] of connRenames) {
                        if (renamedOld.trim().toLowerCase() === oldNet.trim().toLowerCase()) {
                            comp.port_connection[portName] = renamedNew;
                            break;
                        }
                    }
                }
            }
        });
    }
    return JSON.stringify(data, null, 2);
};

// Simplified to avoid aggressive filtering that might lose valid operations
export const filterRedundantCorrections = (corrections: any[]): any[] => {
    return corrections;
};

export const getOriginalFromBaseline = (baselineJson: string, c: any): any => {
    try {
        const data = JSON.parse(baselineJson);
        if (c.to === 'ckt_netlist') return (data.ckt_netlist || []).find((item: any) => item.id === c.key);
        if (c.to === 'connection') return data.connection?.[c.key];
        if (c.to === 'external_ports') return data.external_ports?.[c.key];
    } catch {}
    return null;
};


export const autoDiffNetlists = (baselineJson: string, newJson: string): any[] | null => {
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

        // Diff external_ports - detect renames
        const basePorts = base.external_ports || {};
        const nextPorts = next.external_ports || {};
        const deletedPorts: string[] = [];
        const addedPorts: string[] = [];
        for (const key of Object.keys(basePorts)) {
            if (!nextPorts[key]) {
                deletedPorts.push(key);
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
            if (!basePorts[key]) addedPorts.push(key);
        }
        // Match deleted+added pairs as renames (by name similarity)
        for (const delKey of deletedPorts) {
            const delName = JSON.stringify(basePorts[delKey]?.name);
            let matched = false;
            for (let ai = 0; ai < addedPorts.length; ai++) {
                const addKey = addedPorts[ai];
                const addName = JSON.stringify(nextPorts[addKey]?.name);
                if (delName === addName) {
                    corrections.push({ to: 'external_ports', key: delKey, type: 'modify', reason: '端口重命名', content: { rename_to: addKey } });
                    addedPorts.splice(ai, 1);
                    matched = true;
                    break;
                }
            }
            if (!matched) corrections.push({ to: 'external_ports', key: delKey, type: 'del', reason: '已删除' });
        }
        for (const key of addedPorts) {
            corrections.push({ to: 'external_ports', key, type: 'add', reason: '新增', content: nextPorts[key] });
        }

        // Diff connection - detect renames by port matching, skip pixel-only changes
        const baseConns = base.connection || {};
        const nextConns = next.connection || {};
        const deletedConns: string[] = [];
        const addedConns: string[] = [];
        for (const key of Object.keys(baseConns)) {
            if (!nextConns[key]) {
                deletedConns.push(key);
            } else {
                const bp = JSON.stringify(baseConns[key]?.ports);
                const np = JSON.stringify(nextConns[key]?.ports);
                if (bp !== np)
                    corrections.push({ to: 'connection', key, type: 'modify', reason: '端口引用变更', content: { ports: nextConns[key].ports } });
            }
        }
        for (const key of Object.keys(nextConns)) {
            if (!baseConns[key]) addedConns.push(key);
        }
        // Match deleted+added pairs as renames (by port similarity)
        for (const delKey of deletedConns) {
            const delPorts = JSON.stringify(baseConns[delKey]?.ports);
            let matched = false;
            for (let ai = 0; ai < addedConns.length; ai++) {
                const addKey = addedConns[ai];
                const addPorts = JSON.stringify(nextConns[addKey]?.ports);
                if (delPorts === addPorts) {
                    corrections.push({ to: 'connection', key: delKey, type: 'modify', reason: '网络重命名', content: { rename_to: addKey } });
                    addedConns.splice(ai, 1);
                    matched = true;
                    break;
                }
            }
            if (!matched) corrections.push({ to: 'connection', key: delKey, type: 'del', reason: '连接删除' });
        }
        for (const key of addedConns) {
            corrections.push({ to: 'connection', key, type: 'add', reason: '新增', content: nextConns[key] });
        }

        return corrections.length > 0 ? corrections : null;
    } catch { return null; }
};

// --- 1. Data Processing (Python <-> React) ---
export const pythonDataToReactState = (jsonStr: string) => {
  try {
    const data = safeJsonParse(jsonStr);
    if (!data) return null;
    let nodes: any[] = [];
    let edges: any[] = [];
    let mergeReport = new Set<string>();
    let extraData: any = {};

    // Only support Unified Netlist Format (Old Format style)
    
    // Extract extra fields to preserve
    Object.keys(data).forEach(key => {
        if (key !== 'ckt_netlist' && key !== 'connection') {
            extraData[key] = data[key];
        }
    });

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
            // Read explicit connection if available to ensure robust connectivity reconstruction
            // This is crucial when net names are renamed via LLM but pixels remain identical
            const connectedNet = comp.port_connection?.[portName];

            nodes.push({
                id: pId,
                type: 'port',
                position: { x: center[0], y: center[1] },
                parentId: compId,
                data: { 
                    label: portName, 
                    type: portInfo.type || "", 
                    isExternal: false, 
                    compName: comp.device_name,
                    netName: connectedNet
                }
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

export const reactStateToPythonData = (nodes: any[], edges: any[], extraData: any = {}) => {
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
