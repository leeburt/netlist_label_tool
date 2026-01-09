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
        // Recalculate J1 Position will happen on next move or we can trigger it immediately? 
        // Ideally trigger immediate update. For simplicity, we just merge.
    } else if (jIdA) {
        // Connect B to existing J1
        newEdges.push(createEdge(targetId, jIdA));
    } else if (jIdB) {
        // Connect A to existing J2
        newEdges.push(createEdge(sourceId, jIdB));
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

  addPort: (coord, parentId, name, type = '') => {
    const { nodes, saveHistory } = get();
    saveHistory();
    const pName = name || `P${nodes.length}`;
    
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
    set({ nodes: [...nodes, newNode] });
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
        
        // ... (Previous loadJson logic was mostly correct, let's keep it but ensure IDs match)
        // I will copy the previous logic here but refined.
        
        // 1. Components
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
                     data: { label: p.name, componentName: name, portName: p.name, isExternal: false },
                     style: { width: portSize, height: portSize }
                 });
            });
        });

        // 2. External Ports
        Object.entries(data.external_ports || {}).forEach(([name, info]: [string, any]) => {
             const portSize = 20;
             const radius = portSize / 2;
             newNodes.push({
                 id: uuidv4(),
                 type: 'port',
                 position: { x: info.coord[0] - radius, y: info.coord[1] - radius },
                 data: { label: name, isExternal: true, type: info.type || "" },
                 style: { width: portSize, height: portSize }
             });
        });

        // 3. Connections
        const findPortId = (compName: string, portName: string) => {
            if (compName === 'external') {
                return newNodes.find(n => n.data.label === portName && n.data.isExternal)?.id;
            } else {
                const comp = newNodes.find(n => n.type === 'component' && n.data.originalName === compName);
                if (!comp) return null;
                return newNodes.find(n => n.parentNode === comp.id && n.data.label === portName)?.id;
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
                     const pNode = newNodes.find(node => node.id === pid);
                     if (pNode) {
                         let px = pNode.position.x;
                         let py = pNode.position.y;
                         const pSize = pNode.style?.width as number || 10;
                         const pRadius = pSize / 2;
                         
                         // Position is Top-Left. We need Center.
                         px += pRadius;
                         py += pRadius;
                         
                         if (pNode.parentNode) {
                             const parent = newNodes.find(pn => pn.id === pNode.parentNode);
                             if (parent) { px += parent.position.x; py += parent.position.y; }
                         }
                         sumX += px; sumY += py; count++;
                     }
                 }
            });

            if (count > 0 && validPortIds.length >= 2) {
                 const jSize = 8;
                 const jRadius = jSize / 2;
                 newNodes.push({
                     id: junctionId,
                     type: 'junction',
                     position: { x: (sumX / count) - jRadius, y: (sumY / count) - jRadius },
                     data: {},
                     style: { width: jSize, height: jSize }
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

        // Preserve existing background image node if it exists
        const { nodes: currentNodes } = get();
        const imgNode = currentNodes.find(n => n.type === 'image');
        if (imgNode) {
            newNodes.unshift(imgNode);
        }

        set({ nodes: newNodes, edges: newEdges, history: [] });
    } catch (e) {
        console.error("Failed to load JSON", e);
    }
  },

  exportJson: () => {
      const { nodes, edges } = get();
      const output = {
          components: {} as any,
          external_ports: {} as any,
          connections: [] as any
      };
      
      nodes.filter(n => n.type === 'component').forEach(c => {
           const box = [
               Math.round(c.position.x), 
               Math.round(c.position.y), 
               Math.round(c.position.x + (Number(c.style?.width) || 0)), 
               Math.round(c.position.y + (Number(c.style?.height) || 0))
           ];
           
           const ports = nodes.filter(n => n.parentNode === c.id).map(p => {
               const pSize = Number(p.style?.width) || 10;
               const radius = pSize / 2;
               return {
                   name: p.data.label,
                   coord: [
                       Math.round(c.position.x + p.position.x + radius),
                       Math.round(c.position.y + p.position.y + radius)
                   ]
               };
           });
           
           output.components[c.data.label] = {
               type: c.data.type || "",
               box: box,
               ports: ports
           };
      });

      nodes.filter(n => n.type === 'port' && !n.parentNode).forEach(p => {
          const pSize = Number(p.style?.width) || 20;
          const radius = pSize / 2;
          output.external_ports[p.data.label] = {
              type: p.data.type || "external", 
              coord: [Math.round(p.position.x + radius), Math.round(p.position.y + radius)]
          };
      });

      nodes.filter(n => n.type === 'junction').forEach(j => {
           const connectedEdges = edges.filter(e => e.source === j.id || e.target === j.id);
           const connNodes: any[] = [];
           
           connectedEdges.forEach(e => {
               const otherId = e.source === j.id ? e.target : e.source;
                     const node = nodes.find(n => n.id === otherId);
               if (node && node.type === 'port') {
                   // Calculate center coordinate for export
                   // const pSize = Number(node.style?.width) || 10;
                   // const radius = pSize / 2;
                   
                   if (node.parentNode) {
                       const parent = nodes.find(p => p.id === node.parentNode);
                       if (parent) {
                           connNodes.push({ component: parent.data.label, port: node.data.label });
                       }
                   } else {
                       connNodes.push({ component: "external", port: node.data.label });
                   }
               }
           });
           
           if (connNodes.length >= 2) {
               output.connections.push({ nodes: connNodes });
           }
      });

      return JSON.stringify(output, null, 2);
  }

}));

export default useStore;
