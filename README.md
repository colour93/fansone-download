# fansone-download

> 基于 playwright 登录获取 cookies, axios 请求 api, got 下载分片，node-av (ffmpeg) 推测并合并文件的 fansone 订阅下载器。

## 怎么用？

首先 node >= 22, 因为要安装 node-av 这个包 (它是 ffmpeg 的 node binding, 有 pre-built bin)。

然后

```sh
corepack enable pnpm
pnpm i
pnpm start
```

即可~

配置默认保存在 `config.yaml`, 断点续传等数据保存在 `data.json`, 登录时使用 playwright 有头浏览器, 所以可能当前版本还需要 GUI 系统, 当然你也可以在有 GUI 的系统中登录后把 cookies 拷过来。

下载后的文件放置在 `downloads` 下, 按照 `userDisplayName(@username)` + `videos`/`photos` + `title-date(YYYYMMDD_HHmmss)-#FDpostId(-index).ext` 组织文件。

## Q&A

1. 因为 node-av 崩溃？

> 可以到 node-av 仓库中 release 手动下载 pre-built 的 binary, 放置于 `node_modules/node-av/binary/node-av.node`