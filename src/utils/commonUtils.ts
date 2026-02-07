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

/**
 * 健壮的 JSON 解析函数
 * 1. 移除单行注释 //
 * 2. 移除多行注释 /* ... *\/
 * 3. 尝试修复尾部逗号
 */
export const safeJsonParse = (str: string): any => {
    if (!str) return null;
    try {
        return JSON.parse(str);
    } catch (e) {
        try {
            // 移除注释
            let cleaned = str
                .replace(/\/\/.*$/gm, '') // Remove single-line comments
                .replace(/\/\*[\s\S]*?\*\//g, '') // Remove multi-line comments
                .replace(/,\s*([\]}])/g, '$1'); // Remove trailing commas
            return JSON.parse(cleaned);
        } catch (e2) {
            console.error("JSON Parse Failed:", e2);
            return null;
        }
    }
};
