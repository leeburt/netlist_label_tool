import React, { memo } from 'react';
import { BaseEdge, EdgeLabelRenderer, EdgeProps, getStraightPath, useStore } from 'reactflow';

export const CustomEdge = memo(({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  selected,
  data
}: EdgeProps) => {
  const [edgePath, labelX, labelY] = getStraightPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
  });

  // Highlight logic matching Python:
  // 1. If edge itself is selected -> High (Red, Thick)
  // 2. If it's part of a "Network Highlight" (passed via data.isNetworkHighlighted) -> High
  
  const isHighlighted = selected || data?.isNetworkHighlighted;
  
  // Python: Red if high, else #00cc00. Dimmed if dim_mode? 
  // Python: stroke="{l_color}" stroke-width="{l_width}"
  // high: red, width 4. normal: #00cc00, width 2.
  
  const strokeColor = isHighlighted ? '#ff0000' : '#00cc00';
  const strokeWidth = isHighlighted ? 4 : 2;

  return (
    <>
      <BaseEdge 
          path={edgePath} 
          markerEnd={markerEnd} 
          style={{
              ...style,
              stroke: strokeColor,
              strokeWidth: strokeWidth,
              transition: 'stroke 0.2s, stroke-width 0.2s'
          }} 
      />
      {/* Invisible wider path for easier clicking */}
      <path
        d={edgePath}
        fill="none"
        strokeOpacity={0}
        strokeWidth={20}
      />
    </>
  );
});



