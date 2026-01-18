import path from 'node:path';

export const DOWNLOADS_DIR = path.resolve(process.cwd(), 'downloads');
export const TEMP_DIR = path.resolve(DOWNLOADS_DIR, 'temp');