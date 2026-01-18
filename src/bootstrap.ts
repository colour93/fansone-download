import { initConfig } from "./config.js";
import { initData } from "./data.js";
import { dirExistsOrMkdir } from "./utils.js";
import path from 'node:path';

export const bootstrap = async () => {
    await dirExistsOrMkdir(path.resolve(process.cwd(), 'downloads', 'temp'));
    await initConfig();
    await initData();
}