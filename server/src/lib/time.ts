export const now = () => new Date().toISOString();
export const minutes = (n: number) => n * 60 * 1000;
export const days = (n: number) => n * 24 * 60 * 60 * 1000;
export const addMs = (ms: number, from = Date.now()) => new Date(from + ms).toISOString();
