import { checkbox, input, select } from '@inquirer/prompts';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { readConfig, writeConfig } from './config.js';
import { DOWNLOADS_DIR } from './consts.js';
import { FansoneApi } from './fansone.js';
import { Video } from './video.js';
import type { Post } from './fansone.d.js';
import { Photo } from './photo.js';

const POST_ID_REGEX = /#FD(\d+)/;

const collectDownloadedPostIds = async (baseDir: string): Promise<Set<number>> => {
    const downloaded = new Set<number>();
    const stack = [baseDir];
    while (stack.length > 0) {
        const currentDir = stack.pop()!;
        const entries = await fs.readdir(currentDir, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
            const fullPath = path.resolve(currentDir, entry.name);
            if (entry.isDirectory()) {
                stack.push(fullPath);
                continue;
            }
            if (!entry.isFile()) {
                continue;
            }
            const match = entry.name.match(POST_ID_REGEX);
            if (match) {
                const postId = Number(match[1]);
                if (Number.isInteger(postId)) {
                    downloaded.add(postId);
                }
            }
        }
    }
    return downloaded;
};

export async function runCli(): Promise<void> {
    let config = await readConfig();

    const fansone = new FansoneApi(config?.fansone);

    await fansone.init();

    await writeConfig({
        fansone: {
            cookies: fansone.cookiesString,
        },
    })

    const subscriptions = await fansone.getSubscriptions({
        page: 1,
        limit: 10000000,
        type: 'subscribing',
    });

    const { username } = fansone.getUserInfo();
    const downloadedPostIds = await collectDownloadedPostIds(DOWNLOADS_DIR);

    while (true) {
        const menu = await select({
            message: `用户: ${username ?? '-'} | 订阅数: ${subscriptions.count}`,
            choices: [
                { name: '下载订阅资源', value: 'download' },
                { name: '设置', value: 'settings' },
                { name: '退出', value: 'exit' },
            ],
        });

        if (menu === 'exit') {
            break;
        }

        if (menu === 'settings') {
            const currentConcurrency = config?.download?.concurrency ?? 6;
            const newConcurrency = await input({
                message: `设置下载并发数（当前: ${currentConcurrency}）`,
                default: String(currentConcurrency),
                validate: (value) => {
                    const num = Number(value);
                    if (!Number.isInteger(num) || num <= 0) {
                        return '请输入大于 0 的整数';
                    }
                    return true;
                },
            });
            await writeConfig({
                download: {
                    concurrency: Number(newConcurrency),
                },
            });
            config = await readConfig();
            console.log(`并发数已更新为 ${config?.download?.concurrency ?? currentConcurrency}`);
            continue;
        }

        const selected = await checkbox({
            message: '选择要下载的订阅（可多选）',
            choices: [
                { name: '全选', value: '__all__' },
                ...subscriptions.data.map(item => ({
                    name: item.username,
                    value: item.trade_no,
                })),
            ],
        });

        const selectedSubscriptions = selected.includes('__all__')
            ? subscriptions.data
            : subscriptions.data.filter(item => selected.includes(item.trade_no));

        console.log(`已选择 ${selectedSubscriptions.length} 个订阅用户`);

        for (const [index, subscription] of selectedSubscriptions.entries()) {
            console.log(`[${index + 1}/${selectedSubscriptions.length}] 正在下载第 ${index + 1} 个订阅用户: ${subscription.username}`);

            // 获取图片 post 列表
            let photoPosts: Post[] = [];
            console.log(`[${index + 1}/${selectedSubscriptions.length}] ${subscription.username} 正在获取第一页图片帖子列表...`);
            const firstPagePhotoPosts = await fansone.getPosts({
                page: 1,
                limit: 100,
                type: 'picture',
                username: subscription.username,
            });
            photoPosts.push(...firstPagePhotoPosts.data);
            console.log(`[${index + 1}/${selectedSubscriptions.length}] ${subscription.username} 图片帖子总数: ${firstPagePhotoPosts.count}`);

            for (let page = 2; page <= Math.ceil(firstPagePhotoPosts.count / 100); page++) {
                console.log(`[${index + 1}/${selectedSubscriptions.length}] ${subscription.username} 正在获取第 ${page} 页图片帖子列表...`);
                const currentPagePhotoPosts = await fansone.getPosts({
                    page,
                    limit: 100,
                    type: 'picture',
                    username: subscription.username,
                });
                photoPosts.push(...currentPagePhotoPosts.data);
            }

            // 仅保留可以查看的图片
            const canViewPhotoPosts = photoPosts.filter(post => post.can_view != 0);

            const pendingPhotoPosts = canViewPhotoPosts.filter(post => !downloadedPostIds.has(post.id));
            console.log(`[${index + 1}/${selectedSubscriptions.length}] ${subscription.username} 开始下载图片帖子 剩余/可看/总计 ${pendingPhotoPosts.length}/${canViewPhotoPosts.length}/${photoPosts.length}）...`);

            for (const [photoIndex, photoPost] of pendingPhotoPosts.entries()) {
                console.log(`[${index + 1}/${selectedSubscriptions.length}] ${subscription.username} (${photoIndex + 1}/${pendingPhotoPosts.length}) 正在下载图片帖子: ${photoPost.title}`);
                try {
                    const photo = new Photo({
                        post: photoPost,
                    });
                    await photo.downloadToLocal();
                    downloadedPostIds.add(photoPost.id);
                } catch (error) {
                    console.error(`[${index + 1}/${selectedSubscriptions.length}] ${subscription.username} (${photoIndex + 1}/${pendingPhotoPosts.length}) 下载图片帖子失败: ${photoPost.title}`, error);
                }
            }

            // 获取视频 post 列表
            let videoPosts: Post[] = [];

            console.log(`[${index + 1}/${selectedSubscriptions.length}] ${subscription.username} 正在获取第一页视频帖子列表...`);
            const firstPageVideoPosts = await fansone.getPosts({
                page: 1,
                limit: 100,
                type: 'video',
                username: subscription.username,
            });
            videoPosts.push(...firstPageVideoPosts.data);

            console.log(`[${index + 1}/${selectedSubscriptions.length}] ${subscription.username} 视频帖子总数: ${firstPageVideoPosts.count}`);

            for (let page = 2; page <= Math.ceil(firstPageVideoPosts.count / 100); page++) {
                console.log(`[${index + 1}/${selectedSubscriptions.length}] ${subscription.username} 正在获取第 ${page} 页视频帖子列表...`);
                const currentPageVideoPosts = await fansone.getPosts({
                    page,
                    limit: 100,
                    type: 'video',
                    username: subscription.username,
                });
                videoPosts.push(...currentPageVideoPosts.data);
            }

            // 仅保留可以查看的视频
            const canViewVideoPosts = videoPosts.filter(post => post.can_view != 0);

            const pendingPosts = canViewVideoPosts.filter(post => !downloadedPostIds.has(post.id));
            console.log(`[${index + 1}/${selectedSubscriptions.length}] ${subscription.username} 开始下载视频帖子 剩余/可看/总计 ${pendingPosts.length}/${canViewVideoPosts.length}/${videoPosts.length}）...`);

            for (const [videoIndex, videoPost] of pendingPosts.entries()) {
                console.log(`[${index + 1}/${selectedSubscriptions.length}] ${subscription.username} (${videoIndex + 1}/${pendingPosts.length}) 正在下载视频帖子: ${videoPost.title}`);

                try {
                    const video = new Video({
                        post: videoPost,
                        fansone,
                    });
                    await video.downloadToLocal();
                    downloadedPostIds.add(videoPost.id);
                } catch (error) {
                    console.error(`[${index + 1}/${selectedSubscriptions.length}] ${subscription.username} (${videoIndex + 1}/${pendingPosts.length}) 下载视频帖子失败: ${videoPost.title}`, error);
                }

            }
        }
    }
}
