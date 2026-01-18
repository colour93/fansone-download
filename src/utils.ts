import { promises as fs } from 'node:fs';

export const dirExistsOrMkdir = async (dir: string): Promise<void> => {
    if (await fs.stat(dir).then(() => true).catch(() => false)) {
        return;
    }
    await fs.mkdir(dir, { recursive: true });
}
