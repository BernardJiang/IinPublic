export const serializeForGun = (data: any): any => {
    if (Array.isArray(data)) {
        return JSON.stringify(data);
    }
    if (typeof data === 'object' && data !== null) {
        const newData: any = {};
        for (const key in data) {
            newData[key] = serializeForGun(data[key]);
        }
        return newData;
    }
    return data;
};

export const deserializeFromGun = (data: any, parseArrays: boolean = true): any => {
    if (typeof data === 'string' && parseArrays) {
        if (data.startsWith('[') && data.endsWith(']')) {
            try {
                return JSON.parse(data);
            } catch { }
        }
    }
    if (typeof data === 'object' && data !== null) {
        // Gun adds _ meta, ignore or process?
        // For now we mutate or return copy
        if (Array.isArray(data)) return data; // Unexpected but return

        const newData: any = {};
        for (const key in data) {
            if (key === '_') continue; // Skip meta
            newData[key] = deserializeFromGun(data[key], parseArrays);
        }
        return newData;
    }
    return data;
};
