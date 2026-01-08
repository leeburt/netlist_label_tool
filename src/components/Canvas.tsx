import React, { useRef, useState, useCallback, useEffect } from 'react';
import ReactFlow, { 
    Background, 
    Controls, 
    MiniMap, 
    useNodesState, 
    useEdgesState,
    ReactFlowProvider,
    useReactFlow,
    Node,
    Edge,
    Panel,
    NodeDragHandler,
    OnSelectionChangeParams
} from 'reactflow';
import useStore from '../store';
import { ComponentNode, PortNode, JunctionNode, ImageNode } from './CustomNodes';
import { CustomEdge } from './CustomEdge';

const nodeTypes = {
  component: ComponentNode,
  port: PortNode,
  junction: JunctionNode,
  image: ImageNode,
};

const edgeTypes = {
  straight: CustomEdge,
  default: CustomEdge, 
};

const CanvasInner = () => {
    const { 
        nodes, edges, mode, imgSrc, imgSize, connectStartNodeId,
        onNodesChange, onEdgesChange, onConnect,
        addComponent, addPort, setMode, updateHighlighting, setConnectStartNodeId
    } = useStore();

    const reactFlowInstance = useReactFlow();
    const [tempDraw, setTempDraw] = useState<{ start: { x: number, y: number }, curr: { x: number, y: number } } | null>(null);

    // --- Selection Change Handler for Highlighting Logic ---
    const onSelectionChange = useCallback(({ nodes: selectedNodes, edges: selectedEdges }: OnSelectionChangeParams) => {
        updateHighlighting(selectedNodes, selectedEdges);
    }, [updateHighlighting]);

    // --- Keyboard Shortcuts ---
    // React Flow handles Backspace/Delete natively to delete selected.
    // We should implement Ctrl+Z/Y for Undo/Redo.
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.ctrlKey || e.metaKey) {
                if (e.key === 'z') {
                    e.preventDefault();
                    useStore.getState().undo();
                } else if (e.key === 'y') {
                    e.preventDefault();
                    useStore.getState().redo();
                }
            }
            if (e.key === 'Delete' || e.key === 'Backspace') {
                 useStore.getState().deleteSelection();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);


    // --- Interaction Handlers ---

    const onPaneMouseDown = useCallback((event: React.MouseEvent) => {
        if (mode === 'ADD_COMP') {
            const { x, y } = reactFlowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY });
            setTempDraw({ start: { x, y }, curr: { x, y } });
        }
        // Force focus to prevent selection issues
        if (event.target instanceof HTMLElement) event.target.focus();
    }, [mode, reactFlowInstance]);

    const onPaneMouseMove = useCallback((event: React.MouseEvent) => {
        if (mode === 'ADD_COMP' && tempDraw) {
            const { x, y } = reactFlowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY });
            setTempDraw(prev => prev ? { ...prev, curr: { x, y } } : null);
        }
    }, [mode, tempDraw, reactFlowInstance]);

    const onPaneMouseUp = useCallback((event: React.MouseEvent) => {
        if (mode === 'ADD_COMP' && tempDraw) {
            const { x, y } = reactFlowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY });
            const start = tempDraw.start;
            const w = Math.abs(x - start.x);
            const h = Math.abs(y - start.y);
            const tlX = Math.min(start.x, x);
            const tlY = Math.min(start.y, y);
            
            if (w > 10 && h > 10) {
                 const name = `C${Date.now().toString().slice(-4)}`;
                 addComponent({ x: tlX, y: tlY, w, h }, name, "Unknown");
            }
            setTempDraw(null);
        }
    }, [mode, tempDraw, reactFlowInstance, addComponent]);

    const onPaneClick = useCallback((event: React.MouseEvent) => {
        if (mode === 'ADD_PORT') {
             const { x, y } = reactFlowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY });
             const name = `Ext${Date.now().toString().slice(-4)}`;
             addPort({ x, y }, undefined, name);
        }
    }, [mode, reactFlowInstance, addPort]);

    const onNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
        // Prevent clicking image node
        if (node.type === 'image') return;

        if (mode === 'ADD_PORT' && node.type === 'component') {
            event.stopPropagation();
            const { x, y } = reactFlowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY });
            const name = `P${Date.now().toString().slice(-4)}`;
            // Pass absolute coordinate, store handles relative logic
            addPort({ x, y }, node.id, name);
        } else if (mode === 'CONNECT') {
            event.stopPropagation();
            // Click-Click Connection Logic
            // 1. If Port -> Start or End
            // 2. If Junction -> End (merge)
            // Python: 
            // - If not start: if port -> start.
            // - If start: if port -> connect. if junction/edge -> merge.
            
            if (!connectStartNodeId) {
                if (node.type === 'port') {
                    setConnectStartNodeId(node.id);
                    // Optional: Visual feedback for start node? 
                    // Store could update a "highlighted" state or similar. 
                    // For now, rely on Sidebar/Toast info if we had it.
                }
            } else {
                if (node.id === connectStartNodeId) {
                    setConnectStartNodeId(null); // Cancel
                } else {
                    // Create connection
                    // onConnect expects Connection object
                    onConnect({ source: connectStartNodeId, target: node.id, sourceHandle: null, targetHandle: null });
                    setConnectStartNodeId(null);
                }
            }
        }
    }, [mode, reactFlowInstance, addPort, connectStartNodeId, setConnectStartNodeId, onConnect]);


    // Temp Draw Layer
    let drawOverlay = null;
    if (tempDraw) {
        // Convert Flow coordinates back to Screen coordinates for rendering the overlay
        // We use fixed positioning to ensure it renders correctly regardless of the viewport transform
        const startScreen = reactFlowInstance.flowToScreenPosition(tempDraw.start);
        const currScreen = reactFlowInstance.flowToScreenPosition(tempDraw.curr);

        const x = Math.min(startScreen.x, currScreen.x);
        const y = Math.min(startScreen.y, currScreen.y);
        const w = Math.abs(startScreen.x - currScreen.x);
        const h = Math.abs(startScreen.y - currScreen.y);
        
        drawOverlay = (
            <div 
                style={{
                    position: 'fixed',
                    left: x,
                    top: y,
                    width: w,
                    height: h,
                    border: '2px dashed red',
                    backgroundColor: 'rgba(255, 0, 0, 0.1)',
                    pointerEvents: 'none',
                    zIndex: 9999
                }}
            />
        );
    }

    return (
        <div className="w-full h-full relative bg-gray-500">
             <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                onSelectionChange={onSelectionChange}
                onPaneMouseDown={onPaneMouseDown}
                onPaneMouseMove={onPaneMouseMove}
                onPaneMouseUp={onPaneMouseUp}
                onPaneClick={onPaneClick}
                onNodeClick={onNodeClick}
                fitView
                minZoom={0.1}
                deleteKeyCode={null} 
                panOnDrag={mode !== 'ADD_COMP'}
                selectionOnDrag={false}
                style={{ cursor: mode === 'ADD_COMP' ? 'crosshair' : (mode === 'ADD_PORT' ? 'copy' : 'default') }}
            >
                {/* Background Image is now a Node, so we don't need this div layer */}
                
                {drawOverlay}
                
                {/* Grid Dots */}
                <Background color="#ccc" gap={20} size={1} />
                
                {/* Controls */}
                <Controls showInteractive={false} />
                <MiniMap style={{ height: 120 }} zoomable pannable />
                
                {/* Info Panel Overlay */}
                <Panel position="top-right" className="bg-white/90 p-2 rounded shadow-lg border border-gray-200 text-xs">
                    <div className="font-mono">
                        <div className="font-bold text-slate-700">Canvas Info</div>
                        <div>Mode: <span className="font-bold text-blue-600">{mode}</span></div>
                        {imgSize.w > 0 && <div className="text-gray-500">Image: {imgSize.w}x{imgSize.h}</div>}
                    </div>
                    {imgSrc && (
                        <div className="mt-2 border-t pt-2">
                             <div className="font-bold text-gray-500 mb-1">Ref Image</div>
                             <img src={imgSrc} className="w-32 h-auto border rounded opacity-80" />
                        </div>
                    )}
                </Panel>
            </ReactFlow>
        </div>
    );
}

export default function Canvas() {
    return (
        <ReactFlowProvider>
            <CanvasInner />
        </ReactFlowProvider>
    );
}
