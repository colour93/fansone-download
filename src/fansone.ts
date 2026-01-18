import axios, { AxiosInstance } from "axios";
import { type Config } from "./config.js";
import { createBrowser } from "./browser.js";
import { BasePageResponse, BaseResponse, Post, Subscription } from "./fansone.d.js";

export class FansoneApi {

    private axios: AxiosInstance;
    public cookiesString?: string;
    private userInfo: {
        username?: string;
        userId?: string;
        uid?: string;
    } = {};

    constructor(config: Config['fansone'] | undefined) {
        this.axios = axios.create({
            baseURL: 'https://fansone.co/api'
        })
        if (config?.cookies) {
            this.cookiesString = config.cookies;
            this.parseCookiesUserInfo();
            this.axios.defaults.headers.common['Cookie'] = this.cookiesString;
        }
    }

    public async init(relogin: boolean = false) {
        if (!this.cookiesString || relogin) {
            console.log('请在浏览器窗口中输入用户信息并登录，登录成功后自动关闭浏览器窗口');
            const cookiesString = await this.loginByBrowser();
            this.cookiesString = cookiesString;
            this.parseCookiesUserInfo();
            this.axios.defaults.headers.common['Cookie'] = cookiesString;
        }
    }

    public getUserInfo() {
        return { ...this.userInfo };
    }

    private parseCookiesUserInfo() {
        this.cookiesString.split('; ').forEach(cookie => {
            const [name, value] = cookie.split('=');
            if (name === 'uid') {
                this.userInfo.uid = value;
            }
            if (name === 'userId') {
                this.userInfo.userId = value;
            }
            if (name === 'username') {
                this.userInfo.username = value;
            }
        });
    }

    private async loginByBrowser() {
        const browser = await createBrowser();
        const page = await browser.newPage();
        await page.goto('https://fansone.co/login');
        await page.waitForURL('https://fansone.co/explore/general', {
            timeout: 120_000,
        });
        const cookies = await page.context().cookies();
        const cookiesString = cookies.map(cookie => cookie.name + '=' + cookie.value).join('; ');
        await browser.close();
        return cookiesString;
    }

    private async withRetry<T>(fn: () => Promise<T>, label: string, maxRetries = 3): Promise<T> {
        for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
            try {
                return await fn();
            } catch (error) {
                if (attempt >= maxRetries) {
                    throw error;
                }
                const wait = 500 * (2 ** (attempt - 1));
                console.warn(`${label} 失败，${wait}ms 后重试(${attempt}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, wait));
            }
        }
        throw new Error(`${label} 失败`);
    }

    public async getSubscriptions({
        page = 1,
        limit = 100,
        type = 'subscribing'
    }: {
        page?: number;
        limit?: number;
        type?: 'subscribing' | 'expired' | 'all';
    }) {
        const response = await this.withRetry(
            () => this.axios.get<BasePageResponse<Subscription>>('/subscription', {
                params: {
                    uid: this.userInfo.uid,
                    page,
                    limit,
                    type,
                },
            }),
            '获取订阅失败',
        );
        if (response.status !== 200 || !response.data.success) {
            throw new Error('获取订阅失败');
        }
        return response.data;
    }

    public async getPosts({
        page = 1,
        limit = 100,
        type = 'all',
        username,
    }: {
        page?: number;
        limit?: number;
        type?: 'all' | 'video' | 'picture';
        username: string;
    }) {
        const response = await this.withRetry(
            () => this.axios.get<BasePageResponse<Post>>('/post', {
                params: {
                    page,
                    limit,
                    type,
                    username,
                    uid: this.userInfo.uid,
                    isEnablePager: false,
                },
            }),
            '获取帖子失败',
        );
        if (response.status !== 200 || !response.data.success) {
            throw new Error('获取帖子失败');
        }
        return response.data;
    }

    public async getVideoSignedUrl({
        videoId,
        domain,
    }: {
        videoId: string;
        domain: string;
    }) {
        const response = await this.withRetry(
            () => this.axios.get<BaseResponse<{
                url: string;
            }>>('/bunny/signed-url', {
                params: {
                    videoId,
                    domain,
                },
            }),
            '获取视频签名 URL 失败',
        );
        if (response.status !== 200 || !response.data.success) {
            throw new Error('获取视频签名 URL 失败');
        }
        return response.data.url;
    }
}