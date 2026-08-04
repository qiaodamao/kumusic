# 符号音乐 - 听我想听

![](/img/HeoMusic3.webp)

一个基于[Aplayer](https://github.com/DIYgod/APlayer)和[MetingJS](https://github.com/metowolf/MetingJS)的静态音乐播放器，使用腾讯云 EdgeOne 边缘函数作为后端 API。

## 预览

[符号音乐 - 听我想听](https://music.shijuefuhao.com/)

## 基本操作

`Space空格键`：暂停/播放音乐

`上/下方向键`：增加/减少音量

`左/右方向键`：上一曲/下一曲

## 修改歌单

### 方式一：修改配置文件（推荐）

编辑 [config.js](./config.js)，修改以下三个变量：

```js
var userId = "21158650";        // 歌单 ID
var userServer = "netease";     // 音源（目前仅支持 netease 网易云音乐）
var userType = "playlist";      // 类型：playlist 歌单 / song 单曲 / album 专辑 / artist 歌手热门歌曲
```

提交推送后即生效。

#### 获取歌单 ID

打开网易云音乐网页版（https://music.163.com/），进入想用的歌单，看地址栏：

```
https://music.163.com/#/playlist?id=21158650
                                ↑ 这串数字就是歌单 ID
```

### 方式二：URL 参数（不改代码，临时指定）

直接在网址后加参数即可，优先级高于 config.js：

```
https://music.shijuefuhao.com/?server=netease&type=playlist&id=歌单ID
```

示例：

```
https://music.shijuefuhao.com/?id=21158650&server=netease
```

## 支持的音源

| 音源 | 是否支持 | 说明 |
|---|---|---|
| `netease`（网易云音乐） | ✅ 支持 | 已通过 EdgeOne 边缘函数实现 |
| `tencent`（QQ音乐） | ❌ 不支持 | QQ 音乐接口需要 sign 签名，且算法被 jsvmp 保护，无法匿名调用 |
| `kugou`（酷狗） | ❌ 不支持 | 未实现 |
| `xiami`（小米音乐） | ❌ 不支持 | 虾米音乐已于 2021 年停服 |
| `baidu`（百度音乐） | ❌ 不支持 | 未实现 |

后端 API 由 [edge-functions/api/index.js](./edge-functions/api/index.js) 提供，仅实现了网易云音源的加密协议（weapi + AES-CBC + RSA-NO-PADDING）。

## 本地音乐 / 外链音乐（可选）

在 [config.js](./config.js) 中配置 `localMusic` 数组后，会**优先使用本地音乐**，不再走在线 API。两种模式的判断逻辑见 [js/main.js](./js/main.js)：

- `localMusic` 有内容 → 加载 [js/localEngine.js](./js/localEngine.js)（纯前端播放，不调 API）
- `localMusic` 为空 → 加载 [js/Meting.js](./js/Meting.js)（走 EdgeOne 边缘函数获取网易云歌单）

### 方式一：直接配置 localMusic 数组

在 [config.js](./config.js) 中添加：

```js
var localMusic = [{
    name: '七里香',
    artist: '周杰伦',
    url: '/music/七里香.mp3',
    cover: '/music/七里香.png',
    lrc: '/music/七里香.lrc'
},
{
    name: '东风破',
    artist: '周杰伦',
    url: '/music/东风破.mp3',
    cover: '/music/东风破.png',
    lrc: '/music/东风破.lrc'
}];
```

### 方式二：用 remoteMusic 指向 JSON 链接

适合歌曲较多或需要动态更新的场景，会覆盖 `localMusic`：

```js
var remoteMusic = './music.json';
```

`music.json` 内容示例：

```json
[
  {
    "name": "七里香",
    "artist": "周杰伦",
    "url": "/music/七里香.mp3",
    "cover": "/music/七里香.png",
    "lrc": "/music/七里香.lrc"
  }
]
```

### 字段说明

| 字段 | 必填 | 说明 |
|---|---|---|
| `name` | 是 | 歌曲名 |
| `artist` | 是 | 歌手名 |
| `url` | 是 | 音频文件路径 |
| `cover` | 否 | 封面图路径 |
| `lrc` | 否 | 歌词文件路径（LRC 格式） |

### 注意事项

1. **路径规则**：以 `/` 开头时是相对网站根目录。例如 `/music/xxx.mp3` 对应 `https://music.shijuefuhao.com/music/xxx.mp3`，需将音乐文件放到项目的 `music/` 目录并一起推送部署。

2. **中文文件名**：[js/localEngine.js](./js/localEngine.js) 会自动对非 ASCII 字符（如中文）做 URL 编码，直接写中文路径也能正常播放。

3. **外链音乐**：`url` / `cover` 也可填完整的 https 链接（如 `https://example.com/song.mp3`），适合文件存放在 CDN 或其他服务器的场景。

4. **文件体积**：mp3 文件较大时建议走外链或 CDN，避免 GitHub 仓库膨胀影响部署速度。

## 部署

### 静态资源

将项目推送到 GitHub 仓库，在腾讯云 EdgeOne 控制台绑定仓库即可自动部署静态资源。

### 后端 API

后端 API 由 [edge-functions/api/index.js](./edge-functions/api/index.js) 实现，作为 EdgeOne 边缘函数部署，路由为 `/api`。

调用方式：
```
https://music.shijuefuhao.com/api?server=netease&type=playlist&id=歌单ID
```

## 致谢

开源地址：<a href="https://github.com/zhheo/HeoMusic" target="_blank">HeoMusic</a>

## 许可

项目中包含已经过修改的 MIT 协议项目

[Aplayer](https://github.com/DIYgod/APlayer)

[MetingJS](https://github.com/metowolf/Meting)

[MetingAPI](https://github.com/injahow/meting-api)

项目中包含的未经过修改的 MIT 协议项目

[color-thief](https://github.com/lokesh/color-thief)

图标采用remixicon，使用 Apache 协议