export const getId = () => `n_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

export const deepMergeObj = (target: any, source: any): any => {
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
