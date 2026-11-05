# OpenFnMusicAPI

飞牛音乐（FnMusic）Web 端 HTTP API 的非官方逆向文档与只读验证工具。

本仓库收录可公开阅读的全部资料：项目说明、脱敏后的 API 文档与只读验证脚本。文档与脚本自包含，不依赖仓库外的文件。

> **非官方项目。** 本项目与飞牛（FnMusic）官方无关联，不提供官方兼容性承诺。文档整理自公开 Web 前端、历史探测记录与对**已授权实例**的只读复核；它不是完整 SDK 规范，也不证明已覆盖服务端全部路由或所有成功分支。
>
> 请仅对自己拥有或已获书面授权的实例使用本仓库资料，并自行确认访问权限、适用法规与数据保护要求。

## 项目简介

OpenFnMusicAPI 收录飞牛音乐 Web 端 HTTP API 的可公开资料，为互操作性与安全研究提供有据可查的参考，同时避免把实例凭据、内部证据和可直接复用的签名配方带入公开仓库。

- **接口文档**：按接口族组织 22 章，覆盖基础协议、认证会话、媒体播放、个人数据、管理接口、数据模型与错误码。
- **证据标注**：每个接口标注证据等级（V/E/H/F），区分本次实测、仅错误分支、历史观察与前端线索，不把推测写成事实。
- **只读验证**：附带无第三方依赖的 Node.js 脚本，可在授权实例上复跑只读用例，并产出脱敏的本地结果。
- **安全边界**：authx 仅描述构成要素，不提供完整签名模板；未验证成功的管理类写接口不收录请求字段形态。

本仓库**不包含**官方 SDK、完整客户端、实例地址、账号密码、令牌、Cookie、真实 GUID、封面 ID、服务器目录，也不包含写入、上传、扫描、改密或转码会话等有副作用操作的自动化脚本。

## 仓库内容

| 文件 | 说明 |
|---|---|
| [`FnMusicAPI.md`](FnMusicAPI.md) | 自包含的 HTTP API 接口文档（22 章） |
| [`tools/verify-readonly.mjs`](tools/verify-readonly.mjs) | 只读验证脚本；凭据仅从环境变量读取，输出脱敏 |
| [`VERIFICATION.md`](VERIFICATION.md) | 授权实例的只读验证记录、已知差异与复测结论 |
| [`LICENSE`](LICENSE) | MIT License |

## 文档导览

完整目录与约定见 [`FnMusicAPI.md`](FnMusicAPI.md)。建议先读第 1 章（证据标签与使用约定）和第 2 章（基础协议与错误处理），再按需查阅具体接口族。

| 主题 | 章节 |
|---|---|
| 基础与协议 | [范围与证据](FnMusicAPI.md#scope)、[基础协议](FnMusicAPI.md#protocol)、[认证与会话](FnMusicAPI.md#auth)、[分页与排序](FnMusicAPI.md#paging)、[错误码](FnMusicAPI.md#errors)、[authx 签名](FnMusicAPI.md#authx) |
| 媒体与目录 | [曲目与元数据](FnMusicAPI.md#tracks)、[播放、转码与 HLS](FnMusicAPI.md#playback)、[歌词与漫游](FnMusicAPI.md#lyrics-roam)、[专辑、艺术家与流派](FnMusicAPI.md#catalog)、[搜索](FnMusicAPI.md#search)、[封面](FnMusicAPI.md#covers) |
| 个人数据 | [收藏](FnMusicAPI.md#favorites)、[播放历史与事件](FnMusicAPI.md#history-events)、[歌单](FnMusicAPI.md#playlists)、[共享音乐库](FnMusicAPI.md#libraries)、[文件夹视图](FnMusicAPI.md#folder-view) |
| 管理与运维 | [用户管理、设置与授权目录](FnMusicAPI.md#administration)、[任务](FnMusicAPI.md#tasks) |
| 模型与实现 | [数据模型](FnMusicAPI.md#models)、[最小接入示例](FnMusicAPI.md#examples)、[限制与证据来源](FnMusicAPI.md#limits) |

## 快速开始

### 获取仓库

```bash
git clone https://github.com/Qiu-liang/OpenFnMusicAPI.git
cd OpenFnMusicAPI
```

### 阅读接口文档

直接打开 [`FnMusicAPI.md`](FnMusicAPI.md)。文中路径默认相对于：

```text
https://<host>:<port>/music/api/v1
```

所有示例中的 `<…>` 都是占位符，需要替换为目标实例的真实值。登录 → 查询 → 退出的最小示例见[第 21 章](FnMusicAPI.md#examples)。

### 运行只读验证

要求 Node.js 24+，无需安装依赖。在仓库根目录执行：

```bash
FNMUSIC_ORIGIN='https://<host>:<port>' \
FNMUSIC_USERNAME='<username>' \
FNMUSIC_PASSWORD='<password>' \
node tools/verify-readonly.mjs
```

可用 `FNMUSIC_OUT` 指定输出文件，默认写入 `./readonly-results.json`。脚本只执行只读请求、错误分支、成员权限拒绝、会话失效与一次 100 字节音频 Range，并主动跳过改密、用户管理、收藏/历史/歌单写入、封面上传、媒体库维护、索引重建、任务控制、转码会话、随机漫游、OAuth 与首次初始化等有副作用或需要专用环境的分支（详见结果文件中的 `skippedByDesign`）。

运行前请确认：

- 实例归你所有，或已获得书面授权；
- 使用专用或临时凭据，优先通过 HTTPS 访问；
- 不要在 shell 历史、代理日志或 `set -x` 中留下密码；
- 结果文件虽已脱敏，仍属于本地研究证据，对外分享前请自行复核。

## 验证概览

验证在已授权实例上进行，范围限于只读请求、错误分支、成员权限拒绝、会话失效与一次小范围音频 Range：

- 登录、会话、登出及登出后令牌失效行为与文档描述一致；
- 曲目、专辑、艺术家、流派、歌单、收藏、播放历史、共享库、搜索、歌词、封面与音频 Range 的主要读取路径得到复现；
- 未登录 `401`、成员访问管理接口 `100003`、参数错误、SPA 兜底 `text/html` 等错误分支得到覆盖；
- 除 1 项信息性观察外全部通过，0 项失败；升级后复测补充了文件夹视图接口族。

验证结论与已知差异见 [`VERIFICATION.md`](VERIFICATION.md)。这些结果是**时点记录**，不是跨版本兼容性承诺；管理员成功分支、写入生命周期、上传、OAuth、首次初始化、HLS 会话生命周期等仍未完整验证，详见[第 22 章](FnMusicAPI.md#limits)。

## 安全与隐私

| 文件 | 边界 |
|---|---|
| `README.md` | 不含实例地址、凭据、具体版本号与样本规模 |
| `FnMusicAPI.md` | 已移除凭据、内网定位信息、私有证据链接、前端签名常量与实例指纹；authx 仅保留要素级描述；未验证成功的管理类写接口不收录请求字段形态 |
| `tools/verify-readonly.mjs` | 凭据仅从环境变量读取；输出对地址、用户名、密码、令牌、GUID、coverId 与 IP 做脱敏 |
| `VERIFICATION.md` | 仅保留验证结论与差异，不收录请求级证据、凭据与实例定位信息 |
| `.gitignore` | 忽略本地产物（验证结果 JSON、`.DS_Store`、日志、依赖） |

- 脚本产出的 `readonly-results.json` 不进入版本库；对外分享前仍应做一次敏感值扫描。
- 仓库历史与本地工作区应分别审计，示例脱敏不代表任何本地目录已经完成脱敏。
- authx 的完整构造配方不会公开：从公开前端提取常量后，一段精确到拼接顺序与编码边界的算法会直接构成对未授权实例的签名伪造能力。需要签名的版本，请从自己获授权的实例前端自行推导，并与目标版本一起验证。

## 参与贡献

欢迎提交 issue 与 PR，但请遵守以下约定：

1. **不要提交**实例地址、账号、密码、令牌、Cookie、真实 GUID/coverId、服务器目录或验证结果 JSON。
2. 新增或修正接口时，请注明证据来源与等级（V/E/H/F），并说明验证环境；没有可靠证据的内容请标为「待确认」。
3. 保持文档自包含：不要引用仓库外的私有报告、聊天记录或证据链接。
4. 涉及 authx 的贡献只描述构成要素与实现边界，不提交可直接复用的签名常量或完整模板。
5. 只在你有权操作的实例上验证；不要用错误密码、空密码或重复登录探测限流。

## 许可证与免责声明

本项目采用 [MIT License](LICENSE)。API 名称、品牌与服务端行为不随该许可证授权，仍归各自权利人所有。

本项目仅用于授权实例的互操作性与安全研究。作者不对误用、服务中断、账号锁定、数据丢失或违反适用法规的使用承担责任。
