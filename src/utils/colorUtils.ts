// PASCAL VOC style label colormap (used by imgviz.label_colormap, X-AnyLabeling)
// This is the standard color palette for computer vision annotation tasks
// Reference: https://github.com/wkentaro/imgviz/blob/master/imgviz/label.py

// Generate full 256-color palette using the PASCAL VOC pattern
const createVocColormap = (): [number, number, number][] => {
    const cmap: [number, number, number][] = [];
    for (let i = 0; i < 256; i++) {
        cmap.push([
            ((i >> 0) & 1) * 128 + ((i >> 3) & 1) * 64 + ((i >> 6) & 1) * 32,
            ((i >> 1) & 1) * 128 + ((i >> 4) & 1) * 64 + ((i >> 7) & 1) * 32,
            ((i >> 2) & 1) * 128 + ((i >> 5) & 1) * 64 + ((i >> 8) & 1) * 32,
        ]);
    }
    // Customize first color to green (as in X-AnyLabeling)
    cmap[1] = [0, 180, 33]; // Green for first label
    return cmap;
};

const FULL_VOC_COLORMAP = createVocColormap();

// Simple hash function for string to index mapping (stable)
const stringToLabelIndex = (str: string): number => {
    let hash = 0;
    const s = String(str).toUpperCase();
    for (let i = 0; i < s.length; i++) {
        hash = (hash * 31 + s.charCodeAt(i)) >>> 0; // Use unsigned 32-bit
    }
    // Start from index 1 (skip background black at 0)
    // Avoid index 1 which is customized green, start from 2
    return (hash % 254) + 2;
};

// Convert RGB array to hex string
const rgbToHex = (r: number, g: number, b: number): string => {
    const toHex = (n: number) => n.toString(16).padStart(2, '0');
    return '#' + toHex(r) + toHex(g) + toHex(b);
};

// Color Generation (X-AnyLabeling / PASCAL VOC style)
export const stringToColor = (str: any): string => {
    if (!str) return '#999999';
    const index = stringToLabelIndex(String(str));
    const [r, g, b] = FULL_VOC_COLORMAP[index];
    return rgbToHex(r, g, b);
};

export const getComponentColor = (type: any, opacity = 0.6): string => {
    if (!type) return `rgba(0, 180, 33, ${opacity})`; // Default green
    const index = stringToLabelIndex(String(type));
    const [r, g, b] = FULL_VOC_COLORMAP[index];
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
};

export const getComponentStrokeColor = (type: any): string => {
    if (!type) return '#00b421'; // Default green
    const index = stringToLabelIndex(String(type));
    const [r, g, b] = FULL_VOC_COLORMAP[index];
    return rgbToHex(r, g, b);
};
