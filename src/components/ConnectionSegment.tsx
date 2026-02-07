import { stringToColor } from '../utils/colorUtils';

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

export default ConnectionSegment;
