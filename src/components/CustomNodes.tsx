import React, { memo } from 'react';
import { Handle, Position, NodeProps, NodeResizer } from 'reactflow';

// --- Styles based on Python main.py ---

export const ComponentNode = memo(({ data, selected }: NodeProps) => {
  return (
    <>
      <div 
        className="relative w-full h-full transition-colors"
        style={{
            backgroundColor: 'rgba(0, 0, 255, 0.05)',
            borderWidth: selected ? '4px' : '2px',
            borderColor: selected ? 'red' : 'blue',
            boxSizing: 'border-box'
        }}
      >
        <NodeResizer 
            minWidth={20} 
            minHeight={20} 
            isVisible={selected} 
            lineClassName="border-blue-400" 
            handleClassName="h-3 w-3 bg-blue-500 border border-white rounded" 
        />
        
        <div 
            className="absolute -top-7 left-0 whitespace-nowrap px-1"
            style={{
                color: selected ? 'red' : 'blue',
                fontSize: '16px',
                fontWeight: 'bold',
                textShadow: '0 1px 2px rgba(255,255,255,0.8)'
            }}
        >
            {data.label}
        </div>
      </div>
    </>
  );
});

export const PortNode = memo(({ data, selected }: NodeProps) => {
    const isExt = data.isExternal;
    const size = isExt ? 20 : 10;
    
    const bgColor = selected ? 'yellow' : (isExt ? 'orange' : 'purple');
    const borderColor = selected ? 'black' : 'white';
    const borderWidth = selected ? 2 : 1;

    return (
        <div 
            style={{ 
                width: size, 
                height: size, 
                borderRadius: '50%', 
                backgroundColor: bgColor,
                border: `${borderWidth}px solid ${borderColor}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
            }}
        >
            <Handle type="source" position={Position.Top} style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)', opacity: 0, width: 1, height: 1 }} />
            <Handle type="target" position={Position.Top} style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)', opacity: 0, width: 1, height: 1 }} />
             <title>{data.label}</title>
        </div>
    );
});

export const JunctionNode = memo(({ selected, data }: NodeProps) => {
    const size = 8;
    // Python: Green normally. Red if selected OR network highlighted.
    // We added isHighlighted to data in store.
    const isHigh = selected || data.isHighlighted;
    const color = isHigh ? 'red' : '#00cc00';
    
    return (
        <div 
            style={{ 
                width: size, 
                height: size, 
                borderRadius: '50%', 
                backgroundColor: color,
                border: '1px solid white'
            }}
        >
             <Handle type="source" position={Position.Top} style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)', opacity: 0, width: 1, height: 1 }} />
             <Handle type="target" position={Position.Top} style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)', opacity: 0, width: 1, height: 1 }} />
        </div>
    );
});

// New Image Node for Background
export const ImageNode = memo(({ data }: NodeProps) => {
    return (
        <div style={{ width: data.width, height: data.height, pointerEvents: 'none' }}>
            <img 
                src={data.src} 
                alt="Background" 
                style={{ width: '100%', height: '100%', objectFit: 'fill', display: 'block', pointerEvents: 'none' }} 
            />
        </div>
    );
});
