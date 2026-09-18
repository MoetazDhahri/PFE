export const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

export const appPath = (path: string) => `${basePath}${path}`;