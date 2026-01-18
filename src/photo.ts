import path from "node:path";
import { createWriteStream, promises as fs } from "node:fs";
import { pipeline } from "node:stream/promises";
import got from "got";
import cliProgress from "cli-progress";
import { DOWNLOADS_DIR } from "./consts.js";
import type { Post } from "./fansone.d.js";
import { dirExistsOrMkdir, getSpeedText, userDirName } from "./utils.js";
import dayjs from "dayjs";
import PQueue from "p-queue";
import { readConfig } from "./config.js";
import { logger } from "./logger.js";

export class Photo {
    private post: Post;

    constructor({
        post,
    }: {
        post: Post;
    }) {
        this.post = post;
    }

    async downloadToLocal() {
        const { images } = this.post;
        const imageUrls = images.split(',').map(url => url.trim()).filter(Boolean);

        const outputDir = path.resolve(DOWNLOADS_DIR, userDirName(this.post), 'photos');
        await dirExistsOrMkdir(outputDir);
        const fileName = `${this.post.title.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'photo'}-${dayjs(this.post.created_at).format('YYYYMMDD_HHmmss')}-#FD${this.post.id}`;

        const concurrency = (await readConfig()).download?.concurrency ?? 6;
        const queue = new PQueue({ concurrency });
        const maxRetries = 3;
        const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
        let completed = 0;
        let skipped = 0;
        let bytesDownloaded = 0;
        const startedAt = Date.now();

        const getExtFromUrl = (url: string) => {
            try {
                const ext = path.extname(new URL(url).pathname);
                if (ext) {
                    return ext.slice(1).toLowerCase();
                }
            } catch {
                // ignore parsing errors
            }
            return 'jpg';
        };

        const progressBar = new cliProgress.SingleBar({
            format: `[Photo:${this.post.id}] {bar} {percentage}% | {value}/{total} | {speed} | 跳过:{skipped}`,
            hideCursor: true,
            clearOnComplete: true,
        }, cliProgress.Presets.shades_classic);

        progressBar.start(imageUrls.length, 0, {
            speed: getSpeedText(startedAt, bytesDownloaded),
            skipped,
        });

        const updateProgress = () => {
            progressBar.update(completed + skipped, {
                speed: getSpeedText(startedAt, bytesDownloaded),
                skipped,
            });
        };

        const downloadImage = async (url: string, targetPath: string) => {
            for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
                try {
                    const stream = got.stream(url, { retry: { limit: 0 } });
                    let size = 0;
                    stream.on('data', (chunk: Buffer) => {
                        size += chunk.length;
                    });
                    await pipeline(stream, createWriteStream(targetPath));
                    return size;
                } catch (error) {
                    if (attempt >= maxRetries) {
                        throw error;
                    }
                    const wait = 500 * (2 ** (attempt - 1));
                    logger.warn(`[Photo:${this.post.id}] 下载失败，${wait}ms 后重试(${attempt}/${maxRetries})`);
                    await sleep(wait);
                }
            }
            return 0;
        };

        const tasks = imageUrls.map((url, index) => queue.add(async () => {
            const ext = getExtFromUrl(url);
            const targetPath = path.resolve(outputDir, `${fileName}-${index}.${ext}`);
            const exists = await fs.stat(targetPath).then(stat => stat.size > 0).catch(() => false);
            if (exists) {
                skipped += 1;
                updateProgress();
                return;
            }
            const size = await downloadImage(url, targetPath);
            bytesDownloaded += size;
            completed += 1;
            updateProgress();
        }));

        await Promise.all(tasks);
        progressBar.stop();
        logger.info(`[Photo:${this.post.id}] 下载完成，跳过: ${skipped}，成功: ${completed}`);
    }
}