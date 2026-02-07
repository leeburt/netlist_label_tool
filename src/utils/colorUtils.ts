// Color Generation
export const stringToColor = (str: any) => {
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

export const getComponentColor = (type: any, opacity = 0.6) => {
    if (!type) return `rgba(59, 130, 246, ${opacity})`; 
    const s = String(type).toUpperCase();
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
        hash = s.charCodeAt(i) + ((hash << 5) - hash);
    }
    const h = Math.abs(hash) % 360;
    return `hsla(${h}, 60%, 92%, ${opacity})`; 
};

export const getComponentStrokeColor = (type: any) => {
    if (!type) return '#2563eb';
    const s = String(type).toUpperCase();
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
        hash = s.charCodeAt(i) + ((hash << 5) - hash);
    }
    const h = Math.abs(hash) % 360;
    return `hsl(${h}, 60%, 40%)`;
}
