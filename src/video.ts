import type { Post } from "./fansone.d.js";
import { FansoneApi } from "./fansone.js";
import { DOWNLOADS_DIR, TEMP_DIR } from "./consts.js";
import { dirExistsOrMkdir, getSpeedText, userDirName } from "./utils.js";
import path from 'node:path';
import { createWriteStream, promises as fs } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import PQueue from 'p-queue';
import got from 'got';
import dayjs from 'dayjs';
import cliProgress from 'cli-progress';
import { Demuxer, Muxer } from 'node-av/api';
import {
    AVMEDIA_TYPE_AUDIO,
    AVMEDIA_TYPE_VIDEO,
    AV_CODEC_ID_H264,
    AV_CODEC_ID_HEVC,
    AV_CODEC_ID_AV1,
    AV_CODEC_ID_AAC,
    AV_CODEC_ID_AAC_LATM,
    AV_CODEC_ID_MP3,
} from 'node-av/constants';
import { readData, writeData } from './data.js';
import { logger } from './logger.js';
import { readConfig } from "./config.js";

export class Video {
    private post: Post;
    private fansone: FansoneApi;

    constructor({
        post,
        fansone,
    }: {
        post: Post;
        fansone: FansoneApi;
    }) {
        this.post = post;
        this.fansone = fansone;
    }

    private async getM3u8Url() {

        switch (this.post.domain) {
            case 'video7.fansone.co':
                return `https://${this.post.domain}/${this.post.domain}/${this.post.video}/master.m3u8`;
            case 'video5.fansone.co':
                // video5 不需要签名，直接构建 URL
                return `https://${this.post.domain}/${this.post.video}/master.m3u8`;
            case 'video9194.fansone.co':
                return await this.fansone.getVideoSignedUrl({
                    videoId: this.post.video,
                    domain: 'video9194',
                });
            default: {
                // 对于其他未知域名，尝试使用签名 API
                let signedUrl = await this.fansone.getVideoSignedUrl({
                    videoId: this.post.video,
                    domain: 'video9194',
                });

                // 检查并修复 URL 格式
                // API 可能返回格式错误的 URL，签名参数在路径中而不是查询参数
                // 错误格式: https://domain/bcdn_token=xxx&token_path=xxx/path/playlist.m3u8
                // 正确格式: https://domain/path/playlist.m3u8?bcdn_token=xxx&token_path=xxx
                if (signedUrl.includes('/bcdn_token=')) {
                    const urlObj = new URL(signedUrl);
                    const pathParts = urlObj.pathname.split('/');
                    const tokenPart = pathParts[1]; // bcdn_token=xxx&token_path=xxx&expires=xxx

                    if (tokenPart && tokenPart.startsWith('bcdn_token=')) {
                        // 重建正确的 URL
                        const actualPath = '/' + pathParts.slice(2).join('/');
                        signedUrl = `${urlObj.origin}${actualPath}?${tokenPart}`;
                        logger.debug(`[Video:${this.post.id}] 修正URL格式: ${signedUrl}`);
                    }
                }

                // 将 video9194 替换为实际的域名，因为视频存储在原始域名上
                if (this.post.domain !== 'video9194.fansone.co') {
                    const actualUrl = signedUrl.replace('video9194.fansone.co', this.post.domain);
                    logger.debug(`[Video:${this.post.id}] 替换域名为实际存储位置: ${actualUrl}`);
                    return actualUrl;
                }

                return signedUrl;
            }
        }


    }


    public async downloadToLocal() {

        const outputDir = path.resolve(DOWNLOADS_DIR, userDirName(this.post), 'videos');
        await dirExistsOrMkdir(outputDir);
        const fileName = `${this.post.title.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'video'}-${dayjs(this.post.created_at).format('YYYYMMDD_HHmmss')}-#FD${this.post.id}`;

        const m3u8Url = await this.getM3u8Url();
        const tsRangeTempDir = path.resolve(TEMP_DIR, `ts-range-${this.post.id}`);

        await dirExistsOrMkdir(tsRangeTempDir);
        logger.info(`[Video:${this.post.id}] 开始下载 m3u8: ${m3u8Url}`);
        const requestHeaders = {
            referer: 'https://fansone.co/',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36 Edg/144.0.0.0'
        };

        const maxRetries = 3;
        const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
        const fetchTextWithRetry = async (url: string) => {
            for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
                try {
                    return (await got.get(url, {
                        headers: requestHeaders,
                        retry: {
                            limit: 0,
                        },
                    })).body;
                } catch (error) {
                    if (attempt >= maxRetries) {
                        throw error;
                    }
                    const wait = 500 * (2 ** (attempt - 1));
                    logger.warn(`[Video:${this.post.id}] 请求失败，${wait}ms 后重试(${attempt}/${maxRetries})`);
                    await sleep(wait);
                }
            }
            return '';
        };

        const resolveUrl = (baseUrl: string, target: string) => new URL(target, baseUrl).toString();
        const parseM3u8 = (content: string, baseUrl: string) => {
            const lines = content.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
            const segments: string[] = [];
            let nestedPlaylistUrl: string | undefined;

            for (let i = 0; i < lines.length; i += 1) {
                const line = lines[i];
                if (line.startsWith('#EXT-X-STREAM-INF')) {
                    const nextLine = lines[i + 1];
                    if (nextLine && !nextLine.startsWith('#')) {
                        nestedPlaylistUrl = resolveUrl(baseUrl, nextLine);
                        i += 1;
                    }
                    continue;
                }
                if (line.startsWith('#')) {
                    continue;
                }
                if (line.endsWith('.m3u8') && segments.length === 0 && !nestedPlaylistUrl) {
                    nestedPlaylistUrl = resolveUrl(baseUrl, line);
                    continue;
                }
                segments.push(resolveUrl(baseUrl, line));
            }

            return { segments, nestedPlaylistUrl };
        };

        let m3u8Text = await fetchTextWithRetry(m3u8Url);
        let { segments, nestedPlaylistUrl } = parseM3u8(m3u8Text, m3u8Url);

        if (segments.length === 0 && nestedPlaylistUrl) {
            logger.debug(`[Video:${this.post.id}] 使用子清单: ${nestedPlaylistUrl}`);
            m3u8Text = await fetchTextWithRetry(nestedPlaylistUrl);
            segments = parseM3u8(m3u8Text, nestedPlaylistUrl).segments;
        }

        logger.info(`[Video:${this.post.id}] 分片数量: ${segments.length}`);

        const data = await readData();
        const videoKey = String(this.post.id);
        const now = new Date().toISOString();
        const existingProgress = data.videos[videoKey];
        const completedSet = new Set<number>(existingProgress?.completedSegments ?? []);

        const existingFiles = await fs.readdir(tsRangeTempDir).catch(() => []);
        const existingSet = new Set<number>();
        for (const file of existingFiles) {
            if (!file.toLowerCase().endsWith('.ts')) {
                continue;
            }
            const index = Number.parseInt(file.replace('.ts', ''), 10);
            if (Number.isInteger(index)) {
                existingSet.add(index);
                completedSet.add(index);
            }
        }

        const persistProgress = (() => {
            let dirtyCount = 0;
            let saveChain = Promise.resolve();
            return async (force = false) => {
                dirtyCount += 1;
                if (!force && dirtyCount < 10) {
                    return;
                }
                dirtyCount = 0;
                data.videos[videoKey] = {
                    totalSegments: segments.length,
                    completedSegments: Array.from(completedSet).sort((a, b) => a - b),
                    status: 'downloading',
                    createdAt: existingProgress?.createdAt ?? now,
                    updatedAt: new Date().toISOString(),
                    title: this.post.title,
                    username: this.post.username,
                };
                saveChain = saveChain.then(() => writeData(data));
                await saveChain;
            };
        })();

        await persistProgress(true);

        const totalSegments = segments.length;
        const initialSkipped = existingSet.size;

        // 如果临时文件目录存在，且分片数量与 segments.length 一致，则跳过下载 ts，直接封装
        if (initialSkipped === totalSegments && totalSegments > 0) {
            logger.info(`[Video:${this.post.id}] 临时分片齐全，跳过下载 ts`);
        } else {
            const concurrency = (await readConfig()).download?.concurrency ?? 6;
            const queue = new PQueue({ concurrency });
            let completed = 0;
            let skipped = initialSkipped;
            let bytesDownloaded = 0;
            const startedAt = Date.now();

            const progressBar = new cliProgress.SingleBar({
                format: `[Video:${this.post.id}] {bar} {percentage}% | {value}/{total} | {speed} | 跳过:{skipped}`,
                hideCursor: true,
                clearOnComplete: true,
            }, cliProgress.Presets.shades_classic);

            progressBar.start(totalSegments, skipped, {
                speed: getSpeedText(startedAt, bytesDownloaded),
                skipped,
            });

            const updateProgress = () => {
                progressBar.update(completed + skipped, {
                    speed: getSpeedText(startedAt, bytesDownloaded),
                    skipped,
                });
            };

            const downloadSegment = async (segmentUrl: string, filePath: string) => {
                for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
                    try {
                        const stream = got.stream(segmentUrl, {
                            headers: requestHeaders,
                            retry: {
                                limit: 0,
                            },
                        });
                        let segmentBytes = 0;
                        stream.on('data', (chunk: Buffer) => {
                            segmentBytes += chunk.length;
                        });
                        await pipeline(stream, createWriteStream(filePath));
                        return segmentBytes;
                    } catch (error) {
                        if (attempt >= maxRetries) {
                            throw error;
                        }
                        const wait = 500 * (2 ** (attempt - 1));
                        logger.warn(`[Video:${this.post.id}] 分片下载失败，${wait}ms 后重试(${attempt}/${maxRetries})`);
                        await sleep(wait);
                    }
                }
                return 0;
            };

            const tasks = segments.map((segmentUrl, index) => queue.add(async () => {
                const fileName = `${String(index).padStart(6, '0')}.ts`;
                const filePath = path.resolve(tsRangeTempDir, fileName);
                const exists = await fs.stat(filePath).then(stat => stat.size > 0).catch(() => false);
                if (exists) {
                    if (!completedSet.has(index)) {
                        completedSet.add(index);
                        skipped += 1;
                        await persistProgress();
                        updateProgress();
                    }
                    return;
                }
                const segmentBytes = await downloadSegment(segmentUrl, filePath);
                completed += 1;
                bytesDownloaded += segmentBytes;
                completedSet.add(index);
                await persistProgress();
                updateProgress();
            }));

            await Promise.all(tasks);
            progressBar.stop();
            logger.info(`[Video:${this.post.id}] 下载完成，跳过: ${skipped}，成功: ${completed}`);
        }
        const outputPath = await this.remuxWithNodeAv(tsRangeTempDir, outputDir, fileName);

        data.videos[videoKey] = {
            totalSegments: segments.length,
            completedSegments: Array.from(completedSet).sort((a, b) => a - b),
            status: 'completed',
            createdAt: existingProgress?.createdAt ?? now,
            updatedAt: new Date().toISOString(),
            outputPath: outputPath ?? undefined,
            title: this.post.title,
            username: this.post.username,
        };
        await writeData(data);

        await fs.rm(tsRangeTempDir, { recursive: true });
        logger.debug(`[Video:${this.post.id}] 删除临时目录: ${tsRangeTempDir}`);
    }

    private async remuxWithNodeAv(tsDir: string, outputDir: string, fileName: string): Promise<string | null> {
        const tsFiles = (await fs.readdir(tsDir))
            .filter(file => file.toLowerCase().endsWith('.ts'))
            .sort();

        if (tsFiles.length === 0) {
            logger.warn(`[Video:${this.post.id}] 未找到 ts 分片，跳过封装`);
            return null;
        }
        const probePath = path.resolve(tsDir, tsFiles[0]);
        const probe = await Demuxer.open(probePath);

        let outputPath: string | null = null;

        try {
            const streams = probe.streams ?? [];
            const videoStream = typeof probe.video === 'function' ? probe.video() : null;
            const audioStream = typeof probe.audio === 'function' ? probe.audio() : null;

            const getCodecId = (stream: any) =>
                stream?.codecpar?.codecId
                ?? stream?.codecpar?.codec_id
                ?? null;
            const getCodecName = (stream: any, fallback?: string) =>
                stream?.codecpar?.codecName
                ?? stream?.codecpar?.codec_name
                ?? fallback
                ?? 'unknown';

            const videoCodecId = videoStream ? getCodecId(videoStream) : null;
            const audioCodecId = audioStream ? getCodecId(audioStream) : null;
            const videoCodecName = videoStream ? String(getCodecName(videoStream, String(videoCodecId ?? 'none'))) : 'none';
            const audioCodecName = audioStream ? String(getCodecName(audioStream, String(audioCodecId ?? 'none'))) : 'none';

            const isMp4FriendlyVideo = videoCodecId === AV_CODEC_ID_H264
                || videoCodecId === AV_CODEC_ID_HEVC
                || videoCodecId === AV_CODEC_ID_AV1;
            const isMp4FriendlyAudio = audioCodecId === null
                || audioCodecId === AV_CODEC_ID_AAC
                || audioCodecId === AV_CODEC_ID_AAC_LATM
                || audioCodecId === AV_CODEC_ID_MP3;
            const outputFormat = isMp4FriendlyVideo && isMp4FriendlyAudio ? 'mp4' : 'matroska';
            const outputExt = outputFormat === 'mp4' ? 'mp4' : 'mkv';

            await dirExistsOrMkdir(outputDir);
            const outputPath = path.resolve(outputDir, `${fileName}.${outputExt}`);

            logger.info(`[Video:${this.post.id}] 推断格式: video=${videoCodecName}(${videoCodecId ?? 'none'}), audio=${audioCodecName}(${audioCodecId ?? 'none'})`);
            logger.info(`[Video:${this.post.id}] 封装输出: ${outputPath}`);

            const muxer = await Muxer.open(outputPath, {
                input: probe,
                format: outputFormat,
                options: outputFormat === 'mp4' ? { movflags: 'faststart' } : undefined,
            });

            try {
                const streamIndexMap = new Map<number, number>();
                const resetCodecTagForMp4 = (stream: any) => {
                    if (outputFormat !== 'mp4' || !stream?.codecpar) {
                        return;
                    }
                    if (typeof stream.codecpar.codecTag === 'number') {
                        stream.codecpar.codecTag = 0;
                    }
                    if (typeof stream.codecpar.codec_tag === 'number') {
                        stream.codecpar.codec_tag = 0;
                    }
                };
                if (videoStream) {
                    resetCodecTagForMp4(videoStream);
                    const outIndex = muxer.addStream(videoStream);
                    streamIndexMap.set(videoStream.index, outIndex);
                }
                if (audioStream) {
                    resetCodecTagForMp4(audioStream);
                    const outIndex = muxer.addStream(audioStream);
                    streamIndexMap.set(audioStream.index, outIndex);
                }
                for (const stream of streams) {
                    if (!streamIndexMap.has(stream.index) && stream?.codecpar?.codecType !== AVMEDIA_TYPE_VIDEO && stream?.codecpar?.codecType !== AVMEDIA_TYPE_AUDIO) {
                        resetCodecTagForMp4(stream);
                        const outIndex = muxer.addStream(stream);
                        streamIndexMap.set(stream.index, outIndex);
                    }
                }

                for (const tsFile of tsFiles) {
                    const segPath = path.resolve(tsDir, tsFile);
                    const seg = await Demuxer.open(segPath);
                    try {
                        for await (const packet of seg.packets()) {
                            if (!packet) {
                                continue;
                            }
                            const targetIndex = streamIndexMap.get(packet.streamIndex);
                            if (targetIndex !== undefined) {
                                await muxer.writePacket(packet, targetIndex);
                            }
                            if (typeof packet.free === 'function') {
                                packet.free();
                            }
                        }
                    } finally {
                        await seg.close();
                    }
                }
            } finally {
                await muxer.close();
            }
        } finally {
            await probe.close();
        }

        logger.info(`[Video:${this.post.id}] 封装完成`);
        return outputPath;
    }

}