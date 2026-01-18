import { promises as fs } from 'node:fs';
import path from 'node:path';

export type DownloadProgress = {
    totalSegments: number;
    completedSegments: number[];
    status?: 'downloading' | 'completed';
    createdAt?: string;
    updatedAt?: string;
    outputPath?: string;
    title?: string;
    username?: string;
};

export type DownloadData = {
    videos: Record<string, DownloadProgress>;
};

const DATA_FILE = 'data.json';

const defaultData: DownloadData = {
    videos: {},
};

export async function initData(): Promise<void> {
    const dataPath = path.resolve(process.cwd(), DATA_FILE);
    if (!await fs.stat(dataPath).catch(() => false)) {
        await fs.writeFile(dataPath, JSON.stringify(defaultData, null, 2), 'utf-8');
    }
}

export async function readData(): Promise<DownloadData> {
    const dataPath = path.resolve(process.cwd(), DATA_FILE);
    try {
        const content = await fs.readFile(dataPath, 'utf-8');
        if (!content.trim()) {
            return { ...defaultData };
        }
        const data = JSON.parse(content) as DownloadData | undefined;
        if (!data || typeof data !== 'object' || !data.videos || typeof data.videos !== 'object') {
            return { ...defaultData };
        }
        return data;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return { ...defaultData };
        }
        throw error;
    }
}

export async function writeData(data: DownloadData): Promise<void> {
    const dataPath = path.resolve(process.cwd(), DATA_FILE);
    await fs.writeFile(dataPath, JSON.stringify(data, null, 2), 'utf-8');
}

