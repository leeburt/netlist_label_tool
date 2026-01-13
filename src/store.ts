import { create } from 'zustand';
import {
  Connection,
  Edge,
  EdgeChange,
  Node,
  NodeChange,
  OnNodesChange,
  OnEdgesChange,
  OnConnect,
  applyNodeChanges,
  applyEdgeChanges,
} from 'reactflow';
import { v4 as uuidv4 } from 'uuid';

export type AppMode = 'VIEW' | 'ADD_COMP' | 'ADD_PORT' | 'CONNECT';

export interface AppState {
  nodes: Node[];
  edges: Edge[];
  mode: AppMode;
  imgSrc: string | null;
  imgSize: { w: number; h: number };
  
  history: { nodes: Node[]; edges: Edge[] }[];
  historyPointer: number;
  
  connectStartNodeId: string | null; // For Click-Click connection

  setMode: (mode: AppMode) => void;
  setConnectStartNodeId: (id: string | null) => void;
  setImage: (src: string, w: number, h: number) => void;
  loadJson: (jsonString: string) => void;
  exportJson: () => string;
  
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  
  addComponent: (box: { x: number; y: number; w: number; h: number }, name: string, type?: string) => void;
  addPort: (coord: { x: number; y: number }, parentId?: string, name?: string, type?: string) => void;
  removePort: (id: string) => void;
  deleteSelection: () => void;
  
  updateNodeLabel: (id: string, label: string) => void;
  updateNodeType: (id: string, type: string) => void;
  updateHighlighting: (selectedNodes: Node[], selectedEdges: Edge[]) => void;
  
  undo: () => void;
  redo: () => void;
  saveHistory: () => void;
}

const useStore = create<AppState>((set, get) => ({
  nodes: [],
  edges: [],
  mode: 'VIEW',
  imgSrc: null,
  imgSize: { w: 1000, h: 1000 },
  history: [],
  historyPointer: -1,
  connectStartNodeId: null,

  setMode: (mode) => set({ mode, connectStartNodeId: null }),
  setConnectStartNodeId: (id) => set({ connectStartNodeId: id }),
  
  setImage: (src, w, h) => {
      // Add or update the background image node
      const { nodes } = get();
      const imgNodeId = 'bg-image-node';
      const otherNodes = nodes.filter(n => n.id !== imgNodeId);
      
      const imgNode: Node = {
          id: imgNodeId,
          type: 'image',
          position: { x: 0, y: 0 },
          data: { src, width: w, height: h },
          style: { width: w, height: h, zIndex: -999, pointerEvents: 'none' }, // Ensure it's at the bottom and click-through
          selectable: false,
          draggable: false,
      };
      
      set({ 
          imgSrc: src, 
          imgSize: { w, h },
          nodes: [imgNode, ...otherNodes] // Prepend to ensure render order (though zIndex handles it)
      });
  },

  saveHistory: () => {
    const { nodes, edges, history, historyPointer } = get();
    const newHistory = history.slice(0, historyPointer + 1);
    newHistory.push({ nodes: [...nodes], edges: [...edges] });
    if (newHistory.length > 20) newHistory.shift();
    set({ history: newHistory, historyPointer: newHistory.length - 1 });
  },

  undo: () => {
    const { history, historyPointer } = get();
    if (historyPointer > 0) {
      const prev = history[historyPointer - 1];
      set({
        nodes: prev.nodes,
        edges: prev.edges,
        historyPointer: historyPointer - 1,
      });
    }
  },

  redo: () => {
    const { history, historyPointer } = get();
    if (historyPointer < history.length - 1) {
      const next = history[historyPointer + 1];
      set({
        nodes: next.nodes,
        edges: next.edges,
        historyPointer: historyPointer + 1,
      });
    }
  },

  onNodesChange: (changes: NodeChange[]) => {
    // 1. Apply Changes
    const currentNodes = get().nodes;
    const updatedNodes = applyNodeChanges(changes, currentNodes);
    
    // 2. Centroid Logic: If any node moved, check if it affects a junction
    // We need to re-calculate junction positions for any junction connected to moved nodes.
    
    // Find moved nodes
    const movedNodeIds = new Set<string>();
    changes.forEach(c => {
        if (c.type === 'position' && c.position) {
            movedNodeIds.add(c.id);
        }
    });

    if (movedNodeIds.size > 0) {
        const currentEdges = get().edges;
        const junctionsToUpdate = new Set<string>();

        // Find junctions connected to moved nodes
        // A moved node could be a Port or a Component (which contains Ports)
        // If Component moved, all its children Ports implicitly moved (in absolute terms)
        // But React Flow handles parent-child dragging efficiently. 
        // We just need to know which junctions are connected to these ports.
        
        currentEdges.forEach(e => {
            if (movedNodeIds.has(e.source) || movedNodeIds.has(e.target)) {
                // If the other end is a junction, mark it
                const targetNode = updatedNodes.find(n => n.id === e.target);
                const sourceNode = updatedNodes.find(n => n.id === e.source);
                
                if (targetNode?.type === 'junction') junctionsToUpdate.add(targetNode.id);
                if (sourceNode?.type === 'junction') junctionsToUpdate.add(sourceNode.id);
            }
        });

        // Also, if a Component moved, its children ports moved.
        updatedNodes.forEach(n => {
            if (n.parentNode && movedNodeIds.has(n.parentNode)) {
                 // This port moved because parent moved
                 // Check edges connected to this port
                 currentEdges.forEach(e => {
                    if (e.source === n.id || e.target === n.id) {
                        const targetNode = updatedNodes.find(tn => tn.id === e.target);
                        const sourceNode = updatedNodes.find(sn => sn.id === e.source);
                        if (targetNode?.type === 'junction') junctionsToUpdate.add(targetNode.id);
                        if (sourceNode?.type === 'junction') junctionsToUpdate.add(sourceNode.id);
                    }
                 });
            }
        });

        // Update Junction Positions
        const finalNodes = updatedNodes.map(node => {
            if (junctionsToUpdate.has(node.id)) {
                // Calculate centroid of all connected ports
                const connectedEdges = currentEdges.filter(e => e.source === node.id || e.target === node.id);
                let sumX = 0, sumY = 0, count = 0;
                
                connectedEdges.forEach(e => {
                    const otherId = e.source === node.id ? e.target : e.source;
                    const otherNode = updatedNodes.find(n => n.id === otherId);
                    if (otherNode) {
                        // Calculate ABSOLUTE position of the port CENTER
                        let px = otherNode.position.x;
                        let py = otherNode.position.y;
                        const pSize = Number(otherNode.style?.width) || 10;
                        const pRadius = pSize / 2;
                        
                        px += pRadius;
                        py += pRadius;
                        
                        if (otherNode.parentNode) {
                            const parent = updatedNodes.find(p => p.id === otherNode.parentNode);
                            if (parent) {
                                px += parent.position.x;
                                py += parent.position.y;
                            }
                        }
                        sumX += px;
                        sumY += py;
                        count++;
                    }
                });
                
                if (count > 0) {
                    const jSize = 8;
                    const jRadius = jSize / 2;
                    return {
                        ...node,
                        position: { x: (sumX / count) - jRadius, y: (sumY / count) - jRadius }
                    };
                }
            }
            return node;
        });
        
        set({ nodes: finalNodes });
    } else {
        set({ nodes: updatedNodes });
    }
  },

  onEdgesChange: (changes: EdgeChange[]) => {
    set({
      edges: applyEdgeChanges(changes, get().edges),
    });
  },

  onConnect: (connection: Connection) => {
    const { nodes, edges, saveHistory } = get();
    const sourceId = connection.source;
    const targetId = connection.target;
    if (!sourceId || !targetId || sourceId === targetId) return;

    saveHistory();

    // Helper: Find existing junction connected to a node (port)
    const findJunction = (nodeId: string) => {
        return edges.find(e => 
            (e.source === nodeId && nodes.find(n => n.id === e.target)?.type === 'junction') || 
            (e.target === nodeId && nodes.find(n => n.id === e.source)?.type === 'junction')
        );
    };

    // Get the edge connecting to a junction, if any
    const edgeA = findJunction(sourceId);
    const edgeB = findJunction(targetId);
    
    // Get the Junction ID
    const jIdA = edgeA ? (edgeA.source === sourceId ? edgeA.target : edgeA.source) : null;
    const jIdB = edgeB ? (edgeB.source === targetId ? edgeB.target : edgeB.source) : null;

    let newNodes = [...nodes];
    let newEdges = [...edges];

    const createEdge = (src: string, tgt: string) => ({
        id: uuidv4(),
        source: src,
        target: tgt,
        type: 'straight', // Straight lines as requested
        style: { stroke: '#00cc00', strokeWidth: 2 }
    });

    let activeJunctionId: string | null = null;

    if (jIdA && jIdB) {
        if (jIdA === jIdB) return; // Already same network
        // Merge Networks: Move all edges from J2 (B) to J1 (A)
        newEdges = newEdges.map(e => {
            if (e.source === jIdB) return { ...e, source: jIdA };
            if (e.target === jIdB) return { ...e, target: jIdA };
            return e;
        });
        // Remove J2
        newNodes = newNodes.filter(n => n.id !== jIdB);
        activeJunctionId = jIdA;
    } else if (jIdA) {
        // Connect B to existing J1
        newEdges.push(createEdge(targetId, jIdA));
        activeJunctionId = jIdA;
    } else if (jIdB) {
        // Connect A to existing J2
        newEdges.push(createEdge(sourceId, jIdB));
        activeJunctionId = jIdB;
    } else {
        // New Network: Create J, Connect A->J, B->J
        const jId = uuidv4();
        
        // Calculate Init Pos
        const nodeA = nodes.find(n => n.id === sourceId);
        const nodeB = nodes.find(n => n.id === targetId);
        
        const getAbsPos = (n?: Node) => {
            if (!n) return { x: 0, y: 0 };
            let x = n.position.x, y = n.position.y;
            if (n.parentNode) {
                const p = nodes.find(pn => pn.id === n.parentNode);
                if (p) { x += p.position.x; y += p.position.y; }
            }
            return { x, y };
        };
        
        const posA = getAbsPos(nodeA);
        const posB = getAbsPos(nodeB);
        
        newNodes.push({
            id: jId,
            type: 'junction',
            position: { x: (posA.x + posB.x) / 2, y: (posA.y + posB.y) / 2 },
            data: {},
            style: { width: 1, height: 1 } // Size handled by CustomNode
        });

        newEdges.push(createEdge(sourceId, jId));
        newEdges.push(createEdge(targetId, jId));
        activeJunctionId = jId;
    }

    // --- NET NAME PROPAGATION ---
    if (activeJunctionId) {
        const connectedNodeIds = new Set<string>();
        const queue = [activeJunctionId];
        connectedNodeIds.add(activeJunctionId);
        const existingNames = new Set<string>();

        let head = 0;
        while(head < queue.length){
            const curr = queue[head++];
            newEdges.forEach(e => {
                let neighbor = null;
                if (e.source === curr) neighbor = e.target;
                else if (e.target === curr) neighbor = e.source;
                
                if (neighbor && !connectedNodeIds.has(neighbor)) {
                    connectedNodeIds.add(neighbor);
                    queue.push(neighbor);
                }
            });
        }

        connectedNodeIds.forEach(nid => {
            const node = newNodes.find(n => n.id === nid);
            if (node?.data?.netName) existingNames.add(node.data.netName);
        });

        // Pick name: prefer one that exists
        let winnerName: string | undefined = undefined;
        if (existingNames.size > 0) {
            winnerName = Array.from(existingNames).sort()[0]; 
        } else {
            // Generate a new name if none exists
            winnerName = `Net_${Date.now().toString().slice(-6)}`;
        }

        // Apply to all
        if (winnerName) {
            newNodes = newNodes.map(n => {
                if (connectedNodeIds.has(n.id) && n.data?.netName !== winnerName) {
                    return { ...n, data: { ...n.data, netName: winnerName } };
                }
                return n;
            });
            newEdges = newEdges.map(e => {
                 if (connectedNodeIds.has(e.source) && connectedNodeIds.has(e.target)) {
                     return { ...e, data: { ...e.data, netName: winnerName } };
                 }
                 return e;
            });
        }
    }

    set({ nodes: newNodes, edges: newEdges });
  },

  addComponent: (box, name, type = '') => {
    const { nodes, saveHistory } = get();
    saveHistory();
    // Python code adds component with name. We use name as label.
    const newNode: Node = {
      id: uuidv4(),
      type: 'component',
      position: { x: box.x, y: box.y },
      style: { width: box.w, height: box.h },
      data: { label: name, type, originalId: name },
    };
    set({ nodes: [...nodes, newNode] });
  },

  addPort: (coord, _parentId, name, type = '') => {
    const { nodes, saveHistory } = get();
    saveHistory();
    const pName = name || `P${nodes.length}`;
    
    // 1. Semantic Rule: Determine Parent by Geometry
    // We ignore _parentId (unless we want to support forced override, but user said "rule: if inside -> internal")
    let parentId: string | undefined = undefined;
    
    // Find component containing this point
    // Nodes are top-level or children. Components are usually top-level.
    const components = nodes.filter(n => n.type === 'component');
    for (const comp of components) {
        const x = comp.position.x;
        const y = comp.position.y;
        const w = Number(comp.style?.width) || 0;
        const h = Number(comp.style?.height) || 0;
        
        if (coord.x >= x && coord.x <= x + w && coord.y >= y && coord.y <= y + h) {
            parentId = comp.id;
            break; // Found the component
        }
    }

    let position = { x: coord.x, y: coord.y };
    // If we have a parent (Component), store relative coordinates
    if (parentId) {
        const parent = nodes.find(n => n.id === parentId);
        if (parent) {
            position = {
                x: coord.x - parent.position.x,
                y: coord.y - parent.position.y
            };
        }
    }

    const newNode: Node = {
      id: uuidv4(),
      type: 'port',
      position,
      parentNode: parentId,
      extent: parentId ? 'parent' : undefined,
      data: { label: pName, isExternal: !parentId, type },
      // Style is handled by CustomNode, but we can set default dims here for hit testing
      style: { width: parentId ? 10 : 20, height: parentId ? 10 : 20 } 
    };

    if (!parentId) {
        // Generate externalId for external ports
        const existingIds = nodes
            .filter(n => n.data.isExternal && n.data.externalId !== undefined)
            .map(n => {
                const s = String(n.data.externalId).replace('#', '');
                return parseInt(s, 10);
            })
            .filter(n => !isNaN(n));
            
        let nextId = 1; // Default start from 1
        if (existingIds.length > 0) {
            nextId = Math.max(...existingIds) + 1;
        }
        newNode.data.externalId = nextId.toString();
        // If name wasn't provided, maybe default to P{id}? 
        // Logic above set pName = name || `P${nodes.length}`. 
        // We can keep pName as label.
    }

    set({ nodes: [...nodes, newNode] });
  },

  removePort: (id: string) => {
      const { nodes, edges, saveHistory } = get();
      saveHistory();
      
      const nodeToRemove = nodes.find(n => n.id === id);
      if (!nodeToRemove) return;

      // 1. Identify Edges to Remove
      const edgesToRemove = new Set<string>();
      edges.forEach(e => {
          if (e.source === id || e.target === id) edgesToRemove.add(e.id);
      });
      
      // 2. Filter Nodes and Edges
      let finalNodes = nodes.filter(n => n.id !== id);
      let finalEdges = edges.filter(e => !edgesToRemove.has(e.id));
      
      // 3. Cleanup Junctions (if they have < 2 connections)
      const junctions = finalNodes.filter(n => n.type === 'junction');
      const junctionIdsToRemove = new Set<string>();
      
      junctions.forEach(j => {
          const connectedCount = finalEdges.filter(e => e.source === j.id || e.target === j.id).length;
          if (connectedCount < 2) {
              junctionIdsToRemove.add(j.id);
          }
      });
      
      if (junctionIdsToRemove.size > 0) {
          finalNodes = finalNodes.filter(n => !junctionIdsToRemove.has(n.id));
          finalEdges = finalEdges.filter(e => !junctionIdsToRemove.has(e.source) && !junctionIdsToRemove.has(e.target));
      }

      set({ nodes: finalNodes, edges: finalEdges });
  },

  deleteSelection: () => {
    const { nodes, edges, saveHistory } = get();
    saveHistory();
    
    const selectedNodes = nodes.filter(n => n.selected);
    const selectedEdges = edges.filter(e => e.selected);
    
    if (selectedNodes.length === 0 && selectedEdges.length === 0) return;

    const nodeIdsToRemove = new Set(selectedNodes.map(n => n.id));
    
    // Identify edges to remove:
    // 1. Edges directly selected
    // 2. Edges connected to removed nodes
    
    let finalEdges = edges.filter(e => !e.selected && !nodeIdsToRemove.has(e.source) && !nodeIdsToRemove.has(e.target));
    let finalNodes = nodes.filter(n => !nodeIdsToRemove.has(n.id));

    // Cleanup: If a junction has < 2 connections, remove it?
    // Python: "If valid_nodes >= 2, keep".
    // So if a junction has 0 or 1 edge left, we should remove the junction and the remaining edge.
    // Loop until stable or just one pass? One pass usually enough.
    
    const junctions = finalNodes.filter(n => n.type === 'junction');
    const junctionIdsToRemove = new Set<string>();
    
    junctions.forEach(j => {
        const connectedCount = finalEdges.filter(e => e.source === j.id || e.target === j.id).length;
        if (connectedCount < 2) {
            junctionIdsToRemove.add(j.id);
        }
    });

    if (junctionIdsToRemove.size > 0) {
        finalNodes = finalNodes.filter(n => !junctionIdsToRemove.has(n.id));
        finalEdges = finalEdges.filter(e => !junctionIdsToRemove.has(e.source) && !junctionIdsToRemove.has(e.target));
    }

    set({ nodes: finalNodes, edges: finalEdges });
  },

  updateNodeLabel: (id, label) => {
    const { nodes, saveHistory } = get();
    saveHistory();
    set({
      nodes: nodes.map(n => n.id === id ? { ...n, data: { ...n.data, label } } : n)
    });
  },

  updateNodeType: (id, type) => {
    const { nodes, saveHistory } = get();
    saveHistory();
    set({
      nodes: nodes.map(n => n.id === id ? { ...n, data: { ...n.data, type } } : n)
    });
  },

  updateHighlighting: (selectedNodes, selectedEdges) => {
      // Logic matching Python:
      // 1. If conn_edge selected -> Highlight that edge.
      // 2. If conn_center (junction) selected -> Highlight network.
      // 3. If Component/Port selected -> Highlight connected networks.
      
      const { nodes, edges } = get();
      
      const nodesToHighlight = new Set<string>();
      const edgesToHighlight = new Set<string>();

      // A. Edge Selection
      selectedEdges.forEach(e => {
          edgesToHighlight.add(e.id);
      });

      // B. Junction Selection (Entire Network)
      const selectedJunctions = selectedNodes.filter(n => n.type === 'junction');
      selectedJunctions.forEach(j => {
          // Find all connected edges and ports recursively? 
          // Python: "If center selected -> High all".
          // In our model, all ports connect to junction.
          // So just highlight all edges connected to this junction.
          edges.forEach(e => {
              if (e.source === j.id || e.target === j.id) {
                  edgesToHighlight.add(e.id);
              }
          });
          nodesToHighlight.add(j.id);
      });

      // C. Component/Port Selection (Connected Networks)
      const selectedCompsOrPorts = selectedNodes.filter(n => n.type === 'component' || n.type === 'port');
      selectedCompsOrPorts.forEach(n => {
          // If Component, find all its ports
          let portIds: string[] = [];
          if (n.type === 'component') {
              portIds = nodes.filter(child => child.parentNode === n.id).map(child => child.id);
          } else {
              portIds = [n.id];
          }
          
          portIds.forEach(pid => {
             // Find edges connected to this port
             edges.forEach(e => {
                 if (e.source === pid || e.target === pid) {
                     // The other end is likely a junction
                     const junctionId = e.source === pid ? e.target : e.source;
                     const junction = nodes.find(jn => jn.id === junctionId);
                     if (junction && junction.type === 'junction') {
                         // Highlight this entire network (junction + all its edges)
                         nodesToHighlight.add(junction.id);
                         edges.forEach(je => {
                             if (je.source === junctionId || je.target === junctionId) {
                                 edgesToHighlight.add(je.id);
                             }
                         });
                     } else {
                         // Direct connection? Just highlight edge
                         edgesToHighlight.add(e.id);
                     }
                 }
             });
          });
      });
      
      // Update Edges Data
      const newEdges = edges.map(e => {
          const isHigh = edgesToHighlight.has(e.id);
          if (e.data?.isNetworkHighlighted !== isHigh) {
              return { ...e, data: { ...e.data, isNetworkHighlighted: isHigh } };
          }
          return e;
      });
      
      // Update Nodes Selection/Highlight if needed? 
      // React Flow handles selection visual for nodes (selected prop).
      // But we might want to force "highlight" style even if not selected (e.g. junction red if component selected).
      // Python: Junction turns red if network high.
      // We can update node data or style.
      // But CustomNodes uses `selected` prop.
      // We should probably update `data.isHighlighted` for nodes too.
      
      const newNodes = nodes.map(n => {
          const isHigh = nodesToHighlight.has(n.id);
          if (n.data?.isHighlighted !== isHigh) {
              return { ...n, data: { ...n.data, isHighlighted: isHigh } };
          }
          return n;
      });
      
      // Only set if changed to avoid loop
      if (newEdges.some((e, i) => e !== edges[i]) || newNodes.some((n, i) => n !== nodes[i])) {
          set({ nodes: newNodes, edges: newEdges });
      }
  },

  loadJson: (jsonStr) => {
    try {
        const data = JSON.parse(jsonStr);
        const newNodes: Node[] = [];
        const newEdges: Edge[] = [];
        
        // Preserve existing background image
        const { nodes: currentNodes } = get();
        const imgNode = currentNodes.find(n => n.type === 'image');
        if (imgNode) newNodes.push(imgNode);

        if (data.ckt_netlist) {
            // === NEW FORMAT (netlist.json) ===
            
            // 1. Components
            data.ckt_netlist.forEach((comp: any) => {
                 const bbox = comp.bbox; 
                 const x = bbox.top_left[0];
                 const y = bbox.top_left[1];
                 const w = bbox.bottom_right[0] - x;
                 const h = bbox.bottom_right[1] - y;
                 const compId = uuidv4();
                 
                 newNodes.push({
                    id: compId,
                    type: 'component',
                    position: { x, y },
                    style: { width: w, height: h },
                    data: { label: comp.device_name, type: comp.component_type, originalName: comp.device_name }
                 });

                 // Ports
                 Object.entries(comp.port || {}).forEach(([pName, pInfo]: [string, any]) => {
                      const pCenter = pInfo.center;
                      const portSize = 10;
                      // Relative Top-Left = Center - ParentTL - Radius
                      const px = pCenter[0] - x - (portSize / 2);
                      const py = pCenter[1] - y - (portSize / 2);
                      
                      newNodes.push({
                          id: uuidv4(),
                          type: 'port',
                          parentNode: compId,
                          position: { x: px, y: py },
                          data: { label: pName, componentName: comp.device_name, portName: pName, isExternal: false },
                          style: { width: portSize, height: portSize }
                      });
                 });
            });

            // 2. External Ports
            Object.entries(data.external_ports || {}).forEach(([key, info]: [string, any]) => {
                const portSize = 20;
                const radius = portSize / 2;
                const center = info.center;
                const extIdStr = key.replace('#', '');
                
                newNodes.push({
                    id: uuidv4(),
                    type: 'port',
                    position: { x: center[0] - radius, y: center[1] - radius },
                    data: { label: info.name, isExternal: true, type: info.type || "", externalId: extIdStr },
                    style: { width: portSize, height: portSize }
                });
            });

            // 3. Connections
            Object.entries(data.connection || {}).forEach(([netName, netData]: [string, any]) => {
                const netPorts = netData.ports || [];
                const portNodeIds: string[] = [];
                
                netPorts.forEach(([devName, pName]: [string, string]) => {
                     const comp = newNodes.find(n => n.type === 'component' && n.data.label === devName);
                     if (comp) {
                         const pNode = newNodes.find(n => n.parentNode === comp.id && n.data.label === pName);
                         if (pNode) portNodeIds.push(pNode.id);
                     }
                });
                
                // Match external ports by name = netName
                const extPortNode = newNodes.find(n => n.type === 'port' && n.data.isExternal && n.data.label === netName);
                if (extPortNode) portNodeIds.push(extPortNode.id);
                
                if (portNodeIds.length >= 2) {
                    // Calculate centroid
                    let sumX = 0, sumY = 0;
                    portNodeIds.forEach(pid => {
                        const p = newNodes.find(n => n.id === pid)!;
                        let px = p.position.x + (Number(p.style?.width)/2);
                        let py = p.position.y + (Number(p.style?.height)/2);
                        if (p.parentNode) {
                            const par = newNodes.find(n => n.id === p.parentNode)!;
                            px += par.position.x;
                            py += par.position.y;
                        }
                        sumX += px; sumY += py;
                    });
                    
                    const jId = uuidv4();
                    const cx = sumX / portNodeIds.length;
                    const cy = sumY / portNodeIds.length;
                    
                    newNodes.push({
                        id: jId,
                        type: 'junction',
                        position: { x: cx - 4, y: cy - 4 },
                        data: { netName },
                        style: { width: 8, height: 8 }
                    });
                    
                    portNodeIds.forEach(pid => {
                        newEdges.push({
                            id: uuidv4(),
                            source: pid,
                            target: jId,
                            type: 'straight',
                            style: { stroke: '#00cc00', strokeWidth: 2 },
                            data: { netName }
                        });
                        
                        const p = newNodes.find(n => n.id === pid)!;
                        if (p.data) p.data.netName = netName;
                    });
                }
            });

        } else {
            // === OLD FORMAT ===
            Object.entries(data.components || {}).forEach(([name, comp]: [string, any]) => {
                const box = comp.box; 
                const x = Math.min(box[0], box[2]);
                const y = Math.min(box[1], box[3]);
                const w = Math.abs(box[2] - box[0]);
                const h = Math.abs(box[3] - box[1]);
                const compId = uuidv4();
                
                newNodes.push({
                    id: compId,
                    type: 'component',
                    position: { x, y },
                    style: { width: w, height: h },
                    data: { label: name, type: comp.type, originalName: name }
                });

                (comp.ports || []).forEach((p: any) => {
                    const portSize = 10;
                    const px = p.coord[0] - x - (portSize / 2);
                    const py = p.coord[1] - y - (portSize / 2);
                    newNodes.push({
                        id: uuidv4(),
                        type: 'port',
                        parentNode: compId,
                        position: { x: px, y: py },
                        data: { label: p.name, componentName: name, portName: p.name, isExternal: false, type: p.type || "" },
                        style: { width: portSize, height: portSize }
                    });
                });
            });

            Object.entries(data.external_ports || {}).forEach(([key, info]: [string, any]) => {
                 const portSize = 20;
                 const coord = info.coord || info.center || [0, 0];
                 const label = info.name || key;
                 const externalId = key;
                 newNodes.push({
                     id: uuidv4(),
                     type: 'port',
                     position: { x: coord[0] - 10, y: coord[1] - 10 },
                     data: { label: label, isExternal: true, type: info.type || "", externalId: externalId },
                     style: { width: portSize, height: portSize }
                 });
            });

            const findPortId = (compName: string, portIdentifier: string) => {
                if (compName === 'external') {
                    let node = newNodes.find(n => n.data.isExternal && n.data.externalId === portIdentifier);
                    if (!node) node = newNodes.find(n => n.data.isExternal && n.data.label === portIdentifier);
                    return node?.id;
                } else {
                    const comp = newNodes.find(n => n.type === 'component' && n.data.originalName === compName);
                    if (!comp) return null;
                    return newNodes.find(n => n.parentNode === comp.id && n.data.label === portIdentifier)?.id;
                }
            };

            (data.connections || []).forEach((conn: any) => {
                const junctionId = uuidv4();
                let sumX = 0, sumY = 0, count = 0;
                const validPortIds: string[] = [];
                
                conn.nodes.forEach((n: any) => {
                     const pid = findPortId(n.component, n.port);
                     if (pid) {
                         validPortIds.push(pid);
                         const pNode = newNodes.find(node => node.id === pid)!;
                         let px = pNode.position.x + (Number(pNode.style?.width)/2);
                         let py = pNode.position.y + (Number(pNode.style?.height)/2);
                         if (pNode.parentNode) {
                             const parent = newNodes.find(pn => pn.id === pNode.parentNode);
                             if (parent) { px += parent.position.x; py += parent.position.y; }
                         }
                         sumX += px; sumY += py; count++;
                     }
                });

                if (count > 0 && validPortIds.length >= 2) {
                     newNodes.push({
                         id: junctionId,
                         type: 'junction',
                         position: { x: (sumX / count) - 4, y: (sumY / count) - 4 },
                         data: {},
                         style: { width: 8, height: 8 }
                     });
                     
                     validPortIds.forEach(pid => {
                         newEdges.push({
                             id: uuidv4(),
                             source: pid,
                             target: junctionId,
                             type: 'straight',
                             style: { stroke: '#00cc00', strokeWidth: 2 }
                         });
                     });
                }
            });
        }
        
        set({ nodes: newNodes, edges: newEdges, history: [] });
    } catch (e) {
        console.error("Failed to load JSON", e);
    }
  },

  exportJson: () => {
      const { nodes, edges } = get();

      // Helper: Get Absolute Position and Center
      const getAbsGeometry = (nodeId: string) => {
          const node = nodes.find(n => n.id === nodeId);
          if (!node) return { tl: [0, 0], br: [0, 0], center: [0, 0] };
          
          let x = node.position.x;
          let y = node.position.y;
          const w = Number(node.style?.width) || 0;
          const h = Number(node.style?.height) || 0;

          if (node.parentNode) {
              const parent = nodes.find(p => p.id === node.parentNode);
              if (parent) {
                  x += parent.position.x;
                  y += parent.position.y;
              }
          }
          
          return {
              tl: [Math.round(x), Math.round(y)],
              br: [Math.round(x + w), Math.round(y + h)],
              center: [Math.round(x + w / 2), Math.round(y + h / 2)]
          };
      };

      // 1. Group Edges and Ports into Nets
      const nets = new Map<string, { ports: string[], edges: string[] }>();
      const visitedEdges = new Set<string>();
      
      const adjacency = new Map<string, string[]>(); 
      edges.forEach(e => {
          if (!adjacency.has(e.source)) adjacency.set(e.source, []);
          if (!adjacency.has(e.target)) adjacency.set(e.target, []);
          adjacency.get(e.source)!.push(e.id);
          adjacency.get(e.target)!.push(e.id);
      });

      let netCounter = 0;
      const visitedNodes = new Set<string>();

      nodes.forEach(rootNode => {
          if ((rootNode.type === 'port' || rootNode.type === 'junction') && !visitedNodes.has(rootNode.id)) {
              const currentNetPorts: string[] = [];
              const currentNetEdges: string[] = [];
              const currentNetNodes: string[] = [];
              
              const queue = [rootNode.id];
              visitedNodes.add(rootNode.id);
              currentNetNodes.push(rootNode.id);
              if (rootNode.type === 'port') currentNetPorts.push(rootNode.id);

              let head = 0;
              while (head < queue.length) {
                  const currId = queue[head++];
                  const edgeIds = adjacency.get(currId) || [];
                  
                  edgeIds.forEach(eid => {
                      if (!visitedEdges.has(eid)) {
                          visitedEdges.add(eid);
                          currentNetEdges.push(eid);
                          
                          const edge = edges.find(e => e.id === eid);
                          if (edge) {
                              const neighborId = edge.source === currId ? edge.target : edge.source;
                              if (!visitedNodes.has(neighborId)) {
                                  visitedNodes.add(neighborId);
                                  queue.push(neighborId);
                                  currentNetNodes.push(neighborId);
                                  const n = nodes.find(no => no.id === neighborId);
                                  if (n?.type === 'port') currentNetPorts.push(neighborId);
                              }
                          }
                      }
                  });
              }

              if (currentNetPorts.length > 0 || currentNetEdges.length > 0) {
                  // Determine Net Name
                  let netName = "";
                  const names = new Set<string>();
                  
                  currentNetNodes.forEach(nid => {
                      const n = nodes.find(no => no.id === nid);
                      if (n?.data?.netName) names.add(n.data.netName);
                  });
                  
                  const extPorts = currentNetNodes.map(nid => nodes.find(n => n.id === nid))
                                              .filter(n => n?.type === 'port' && n.data.isExternal);
                  
                  if (extPorts.length > 0) {
                       if (extPorts[0]?.data.label) {
                           netName = extPorts[0].data.label;
                       }
                  }
                  
                  if (!netName) {
                      if (names.size > 0) {
                          netName = Array.from(names).sort()[0];
                      } else {
                          netName = `Net_${netCounter++}`;
                      }
                  }
                  
                  nets.set(netName, { ports: currentNetPorts, edges: currentNetEdges });
              }
          }
      });

      const portToNet = new Map<string, string>();
      nets.forEach((val, key) => {
          val.ports.forEach(p => portToNet.set(p, key));
      });

      const output = {
          ckt_netlist: [] as any[],
          ckt_type: "ckt",
          external_ports: {} as any,
          connection: {} as any,
          llm_check: [] as any[]
      };

      let compIdCounter = 0;
      nodes.filter(n => n.type === 'component').forEach(c => {
          const compId = `#${compIdCounter++}`;
          const geo = getAbsGeometry(c.id);
          
          const portObj: any = {};
          const portConn: any = {};
          
          nodes.filter(n => n.parentNode === c.id).forEach(p => {
              const pGeo = getAbsGeometry(p.id);
              portObj[p.data.label] = {
                  top_left: pGeo.tl,
                  bottom_right: pGeo.br,
                  center: pGeo.center
              };
              const nName = portToNet.get(p.id);
              if (nName) portConn[p.data.label] = nName;
          });

          output.ckt_netlist.push({
              id: compId,
              component_type: c.data.type || "",
              port_connection: portConn,
              name: "",
              attribute: [],
              device_name: c.data.label,
              bbox: {
                  top_left: geo.tl,
                  bottom_right: geo.br
              },
              port: portObj
          });
      });

          let extIdCounter = 0;
          nodes.filter(n => n.type === 'port' && n.data.isExternal).forEach(p => {
              let eid = p.data.externalId;
              
              if (!eid) {
                  // If no externalId, generate next available
                  eid = `${++extIdCounter}`;
                  // Ensure uniqueness if manually set IDs exist
                  // (Simple increment might collide if mixed, but this is fallback)
              }
              
              // Ensure format is "#ID"
              const finalKey = eid.startsWith('#') ? eid : `#${eid}`;
    
              const geo = getAbsGeometry(p.id);
              output.external_ports[finalKey] = {
                  name: p.data.label,
                  type: p.data.type || "",
                  center: geo.center,
                  top_left: geo.tl,
                  bottom_right: geo.br
              };
          });

      nets.forEach((val, netName) => {
          const portList: string[][] = [];
          val.ports.forEach(pid => {
              const pNode = nodes.find(n => n.id === pid);
              if (pNode && pNode.parentNode) {
                  const parent = nodes.find(par => par.id === pNode.parentNode);
                  if (parent) {
                      portList.push([parent.data.label, pNode.data.label]);
                  }
              }
          });
          
          const pixels: number[][][] = [];
          val.edges.forEach(eid => {
              const e = edges.find(edge => edge.id === eid);
              if (e) {
                  const s = getAbsGeometry(e.source).center;
                  const t = getAbsGeometry(e.target).center;
                  pixels.push([s, t]);
              }
          });
          
          if (portList.length > 0 || pixels.length > 0) {
              output.connection[netName] = {
                  ports: portList,
                  pixels: pixels
              };
          }
      });

      return JSON.stringify(output, null, 2);
  }

}));

export default useStore;
