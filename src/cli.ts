import { checkbox, input, select } from '@inquirer/prompts';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { readConfig, writeConfig, type Config } from './config.js';
import { DOWNLOADS_DIR } from './consts.js';
import { FansoneApi } from './fansone.js';
import { Video } from './video.js';
import type { Post } from './fansone.d.js';
import { Photo } from './photo.js';

const POST_ID_REGEX = /#FD(\d+)/;

type FilterMode = 'blacklist' | 'whitelist';

const parseRegexInput = (input: string): RegExp => {
    const trimmed = input.trim();
    if (!trimmed) {
        throw new Error('Empty regex input');
    }
    if (trimmed.startsWith('/') && trimmed.lastIndexOf('/') > 0) {
        const lastSlashIndex = trimmed.lastIndexOf('/');
        const pattern = trimmed.slice(1, lastSlashIndex);
        const flags = trimmed.slice(lastSlashIndex + 1);
        return new RegExp(pattern, flags);
    }
    return new RegExp(trimmed);
};

const createPostFilter = (config: Config | null) => {
    const mode = config?.filter?.mode;
    const regexInput = config?.filter?.regex?.trim();
    if (!mode || !regexInput) {
        return () => true;
    }
    let regex: RegExp;
    try {
        regex = parseRegexInput(regexInput);
    } catch (error) {
        console.warn(`帖子过滤正则无效，将忽略过滤（${(error as Error).message}）`);
        return () => true;
    }
    return (post: Post) => {
        const haystack = [
            post.title,
            post.title_zh,
            post.title_en,
            post.content,
            post.content_zh,
            post.content_en,
            post.tags,
            post.username,
            post.displayname,
        ].filter(Boolean).join(' ');
        if (regex.global || regex.sticky) {
            regex.lastIndex = 0;
        }
        const matched = regex.test(haystack);
        return mode === 'blacklist' ? !matched : matched;
    };
};

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
            const settingsMenu = await select({
                message: '设置',
                choices: [
                    { name: '下载并发数', value: 'concurrency' },
                    { name: '帖子过滤', value: 'filter' },
                    { name: '返回', value: 'back' },
                ],
            });

            if (settingsMenu === 'back') {
                continue;
            }

            if (settingsMenu === 'concurrency') {
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

            const currentMode = config?.filter?.mode;
            const currentRegex = config?.filter?.regex ?? '';
            const currentModeLabel = currentMode === 'blacklist'
                ? '黑名单'
                : currentMode === 'whitelist'
                    ? '白名单'
                    : '关闭';
            const filterMode = await select({
                message: `帖子过滤（当前: ${currentModeLabel}${currentRegex ? ` | ${currentRegex}` : ''}）`,
                choices: [
                    { name: '关闭过滤', value: 'disabled' },
                    { name: '黑名单', value: 'blacklist' },
                    { name: '白名单', value: 'whitelist' },
                    { name: '返回', value: 'back' },
                ],
            });

            const updatedConfig = (await readConfig()) || {};

            if (filterMode === 'back') {
                continue;
            }

            if (filterMode === 'disabled') {
                if (updatedConfig.filter) {
                    delete updatedConfig.filter;
                }
                await writeConfig(updatedConfig, true);
                config = await readConfig();
                console.log('帖子过滤已关闭');
                continue;
            }

            const newRegex = await input({
                message: `设置正则（当前: ${currentRegex || '未设置'}）`,
                default: currentRegex,
                validate: (value) => {
                    if (!value.trim()) {
                        return '请输入正则或选择关闭过滤';
                    }
                    try {
                        parseRegexInput(value);
                        return true;
                    } catch (error) {
                        return `正则无效：${(error as Error).message}`;
                    }
                },
            });

            updatedConfig.filter = {
                mode: filterMode as FilterMode,
                regex: newRegex.trim(),
            };
            await writeConfig(updatedConfig, true);
            config = await readConfig();
            console.log(`帖子过滤已更新为 ${filterMode === 'blacklist' ? '黑名单' : '白名单'}：${newRegex.trim()}`);
            continue;
        }

        while (true) {
            const selected = await checkbox<string>({
                message: '选择要下载的订阅（可多选）',
                choices: [
                    ...subscriptions.data.map(item => ({
                        name: item.username,
                        value: item.trade_no,
                        checked: true,
                    })),
                    { name: '返回上级', value: '__back__' },
                ],
                validate: (value) => {
                    const selectedValues = value as unknown as string[];
                    if (selectedValues?.includes('__back__')) {
                        return true;
                    }
                    if (!selectedValues || selectedValues.length === 0) {
                        return '至少选择一个订阅用户';
                    }
                    return true;
                },
            });

            if (selected.includes('__back__')) {
                break;
            }

            const selectedSubscriptions = subscriptions.data.filter(item => selected.includes(item.trade_no));

            console.log(`已选择 ${selectedSubscriptions.length} 个订阅用户`);

            let shouldReturnToMainMenu = false;

            while (true) {
            const selectedContentTypes = await checkbox<string>({
                    message: '选择要下载的内容类型（可多选）',
                    choices: [
                        { name: '图片', value: 'photo', checked: true },
                        { name: '视频', value: 'video', checked: true },
                        { name: '返回上级', value: '__back__' },
                    ],
                validate: (value) => {
                    const selectedValues = value as unknown as string[];
                    if (selectedValues?.includes('__back__')) {
                            return true;
                        }
                    if (!selectedValues || selectedValues.length === 0) {
                            return '至少选择一个内容类型';
                        }
                        return true;
                    },
                });

                if (selectedContentTypes.includes('__back__')) {
                    break;
                }

                const shouldDownloadPhotos = selectedContentTypes.includes('photo');
                const shouldDownloadVideos = selectedContentTypes.includes('video');
                const postFilter = createPostFilter(config);

                for (const [index, subscription] of selectedSubscriptions.entries()) {
                    console.log(`[${index + 1}/${selectedSubscriptions.length}] 正在下载第 ${index + 1} 个订阅用户: ${subscription.username}`);

                    if (shouldDownloadPhotos) {
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
            const filteredPhotoPosts = canViewPhotoPosts.filter(postFilter);

            const pendingPhotoPosts = filteredPhotoPosts.filter(post => !downloadedPostIds.has(post.id));
            console.log(`[${index + 1}/${selectedSubscriptions.length}] ${subscription.username} 开始下载图片帖子 剩余/过滤后/可看/总计 ${pendingPhotoPosts.length}/${filteredPhotoPosts.length}/${canViewPhotoPosts.length}/${photoPosts.length}）...`);

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
                    }

                    if (shouldDownloadVideos) {
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
            const filteredVideoPosts = canViewVideoPosts.filter(postFilter);

            const pendingPosts = filteredVideoPosts.filter(post => !downloadedPostIds.has(post.id));
            console.log(`[${index + 1}/${selectedSubscriptions.length}] ${subscription.username} 开始下载视频帖子 剩余/过滤后/可看/总计 ${pendingPosts.length}/${filteredVideoPosts.length}/${canViewVideoPosts.length}/${videoPosts.length}）...`);

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

                shouldReturnToMainMenu = true;
                break;
            }

            if (shouldReturnToMainMenu) {
                break;
            }
        }
    }
}
