import { promises as fs } from 'node:fs';
import type { Post } from './fansone.d.js';

export const dirExistsOrMkdir = async (dir: string): Promise<void> => {
    if (await fs.stat(dir).then(() => true).catch(() => false)) {
        return;
    }
    await fs.mkdir(dir, { recursive: true });
}

export const userDirName = (post: Post) => `${post.displayname} (@${post.username})`;

export const formatBytes = (bytes: number) => {
    if (bytes <= 0) {
        return '0 B';
    }
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / (1024 ** index);
    return `${value.toFixed(value < 10 && index > 0 ? 2 : 1)} ${units[index]}`;
};

export const getSpeedText = (startedAt: number, bytesDownloaded: number) => {
    const elapsedSec = (Date.now() - startedAt) / 1000;
    const speed = elapsedSec > 0 ? bytesDownloaded / elapsedSec : 0;
    return `${formatBytes(speed)}/s`;
};