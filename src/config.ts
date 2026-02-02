import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse, stringify } from 'yaml';

export type Config = {
    fansone?: {
        cookies?: string;
    };
    download?: {
        concurrency?: number;
    };
    filter?: {
        mode?: 'blacklist' | 'whitelist';
        regex?: string;
    };
};

const CONFIG_FILE = 'config.yaml';

export async function initConfig(): Promise<void> {
    const configPath = path.resolve(process.cwd(), CONFIG_FILE);
    if (!await fs.stat(configPath).catch(() => false)) {
        await fs.writeFile(configPath, '', 'utf-8');
    }
}

export async function readConfig(): Promise<Config | null> {
    const configPath = path.resolve(process.cwd(), CONFIG_FILE);
    try {
        const content = await fs.readFile(configPath, 'utf-8');
        const data = parse(content) as Config | undefined;
        if (!data || typeof data !== 'object') {
            return {};
        }
        return data;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}

export async function writeConfig(config: Config, overwrite: boolean = false): Promise<void> {
    const configPath = path.resolve(process.cwd(), CONFIG_FILE);
    const content = stringify(overwrite ? config : { ...(await readConfig() || {}), ...config });
    await fs.writeFile(configPath, content, 'utf-8');
}