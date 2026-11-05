# OpenFnMusicAPI — 飞牛音乐 HTTP API 接口文档

> 非官方逆向文档，整理自公开 Web 前端与对已授权实例的一次只读复核。本文是接口说明，不是官方兼容性承诺，也不是覆盖所有成功分支的 SDK 规范。

- 版本、能力开关与实例信息请以 `GET /sys/config` 的实际回显为准，不要把某一构建的版本号或字段集合硬编码为通用契约。
- 本文自包含，不引用任何仓库外证据文件、报告或历史客户端。
- 下文路径均相对于 `/music/api/v1`，除非明确写出完整路径。示例中的 `<…>` 为占位符，必须替换；不包含真实密码、令牌、会话 Cookie、实例地址或服务器目录。
- 只应对自己拥有或已获授权的实例使用本文；写入、清理、改密、上传、扫描与会话控制等操作需另行确认权限与可回滚性。

## 目录

1. [范围、证据等级与使用约定](<#scope>)
2. [基础协议与错误处理](<#protocol>)
3. [认证、会话与系统信息](<#auth>)
4. [分页、排序与过滤](<#paging>)
5. [曲目与元数据](<#tracks>)
6. [原文件播放、转码与 HLS](<#playback>)
7. [歌词与随机漫游](<#lyrics-roam>)
8. [专辑、艺术家与流派](<#catalog>)
9. [搜索](<#search>)
10. [收藏](<#favorites>)
11. [播放历史与事件](<#history-events>)
12. [歌单](<#playlists>)
13. [封面读取与上传](<#covers>)
14. [共享音乐库](<#libraries>)
15. [文件夹视图](<#folder-view>)
16. [用户管理、设置与授权目录](<#administration>)
17. [任务](<#tasks>)
18. [数据模型](<#models>)
19. [错误码](<#errors>)
20. [authx 签名](<#authx>)
21. [最小接入示例与实现建议](<#examples>)
22. [限制与证据来源](<#limits>)

<a id="scope"></a>
## 1. 范围、证据等级与使用约定

### 1.1 接口范围

公开前端代码中可整理出一组请求封装与 3 个直接资源 GET（封面、音频流、HLS 播放列表）；另有已知但不在前端注册表中的 `GET /sys/info` 与 `GET /task/detail`。本文按接口族组织说明，HLS 的初始化文件、分片等按资源 URL 家族描述，不逐文件计数。

**这不是服务端全部路由清单的证明。** 一次授权只读复核覆盖了主要列表、详情、搜索、封面、歌词、分页排序、错误分支、成员权限拒绝与会话失效；多个成功分支、管理端写入和有状态会话仍未完整验证。样本不足的分页比较只作有限观察，不应算作分页能力证明。

### 1.2 证据标签

接口表“证据”列使用以下标签；标签只说明证据来源与分支，不保证该接口的所有字段和边界均已验证。

| 标签 | 含义 |
|---|---|
| **V** | 授权只读复核取得成功响应；可能只是空列表。具体限制在该行或随后说明 |
| **E** | 只读复核只取得权限拒绝、参数错误或资源不存在响应；成功分支未验证 |
| **H** | 历史观察有请求/行为记录，本次复核未执行；“H·拒绝”仅有拒绝证据 |
| **F** | 前端定义或调用参数提供的线索；成功分支没有可靠实测证据 |
| **待确认** | 参数、模型或行为尚不能确定，不应补猜为事实 |

- **V/E 是本次只读复核状态；H/F 不是“本次已测”。** 历史字段和边界会在正文显式说明；任何标签都不是跨版本兼容承诺。
- 表中 `data` 均指 JSON 信封内的 `data`，不是完整 HTTP 响应。
- `guid!` 表示已知调用方式中要求提供；`?` 表示可选或条件字段。F 级请求中的必填性仍需管理员/专用场景验证。
- “成员”指已登录且具备相应资源权限的普通用户；“管理员”若仅有 member→100003 证据，不代表管理员成功行为已验证。
- 除公开配置、初始化状态及登录流程外，客户端应携带有效 Cookie；不假定所有路径都已逐项做过未登录测试。
- **GET 不一定只读**：漫游会维护状态。写入、清理、改密、事件上报、扫描、转码和上传均应在确认授权后调用。

<a id="protocol"></a>
## 2. 基础协议与错误处理

### 2.1 地址与传输

```text
ORIGIN = http(s)://<host>:<port>
BASE   = ORIGIN + /music/api/v1
例：   GET BASE/track/list?page=1&size=20
```

| 项目 | 约定 |
|---|---|
| GET 参数 | URL query；参数名大小写敏感 |
| 常规 POST | `Content-Type: application/json`；请求体为 JSON |
| 封面上传 | `multipart/form-data`，字段 `file`；由 HTTP 客户端生成 boundary |
| 鉴权 | `Cookie: music-token=<userToken>`；未验证 Bearer Token 可替代 Cookie |
| JSON 成功 | `code` 为 `0`；前端接受集合为 `[0,200]` |
| GUID | 实体样本为 32 位十六进制字符串，不带 UUID 连字符；不要将 taskId/coverId 等都当作同一类型 |
| 时长/偏移 | 曲目 `duration`、歌词 `offset`：毫秒 |
| 实体时间 | `createdAt`、`updatedAt`：Unix 秒 |
| 上报/签名时间 | `occurredAt`、心跳 `timestamp`、authx `timestamp`：毫秒 |

HTTP 明文链路不提供机密性。即使密码先做 SHA-256，登录材料和 Cookie 仍需保护；建议配置 HTTPS。

### 2.2 JSON 信封

```json
{
  "code": 0,
  "msg": "",
  "data": {
    "list": [],
    "total": 0
  }
}
```

`data` 可以是对象、数组或 null；错误响应也可能不含 `data`。不要要求每次成功都有 `list`/`total`。

**推荐解析顺序：**

1. 检查 HTTP 状态和 `Content-Type`。
2. JSON 响应解析 `code`，不能因 HTTP 200 就认定业务成功。
3. 音频、图片、HLS 应按对应格式处理，不要求 JSON `code`。
4. 处理无正文的错误，如封面 HTTP 400、历史观察到的 HLS HTTP 410。
5. 转码类即使 `code:0`，仍需检查 `data.status`、`errno`、`errmsg`。
6. `text/html` 可能是 SPA 兜底页而不是 API 成功。所测不存在路径返回 HTTP 200 HTML；该现象不能证明所有路径、方法或前缀均未实现。

### 2.3 缓存

| 所测响应 | Cache-Control |
|---|---|
| JSON API 样本 | 未见该头；不推广为所有 JSON 响应保证 |
| `/music/` SPA HTML | `no-cache, no-store, must-revalidate` |
| 封面成功响应 | `public, max-age=2592000, immutable` |
| FLAC/MP3 音频 Range 206 | `private, max-age=86400, must-revalidate, no-transform` |

音频缓存策略来自 206 样本，未据此验证完整文件 200 响应。私有媒体缓存应按账号/服务器隔离，登出后不要继续向其它用户暴露。

<a id="auth"></a>
## 3. 认证、会话与系统信息

### 3.1 接口表

| 接口 | 权限/用途 | 请求 | data / 行为 | 证据 |
|---|---|---|---|---|
| `GET /sys/config` | 公开配置 | 无 | 系统版本、NAS OAuth 配置、能力开关 | V |
| `GET /sys/info` | 成员 | 无 | `{connect:{id,status,entitlement:{type,endTime}}}` | V；非前端注册表路径 |
| `GET /initialization/state` | 公开 | 无 | `{initialized:true}`，值随实例状态变化 | V |
| `POST /initialization/prepare` | 首次初始化流程 | 完整请求契约待确认 | 成功模型待确认 | F；历史空 body 为100001 |
| `POST /initialization/confirm` | 首次初始化流程 | 完整请求契约待确认 | 成功模型待确认 | F；历史空 body 为100001 |
| `POST /user/password-login` | 登录 | `{username,password,deviceId}` | `{userToken,user}` | V |
| `POST /user/auth-login` | NAS OAuth/SSO | `{code,deviceId}` | 前端预期 `{userToken,user}` | F；成功未测 |
| `GET /user/me` | 成员 | 无 | `User` | V |
| `POST /user/logout` | 当前登录会话 | `{}` | `null`；使当前 token 失效 | V |

### 3.2 密码登录

```http
POST /music/api/v1/user/password-login
Content-Type: application/json
```

```json
{
  "username": "<username>",
  "password": "<明文密码的 SHA-256 小写十六进制>",
  "deviceId": "<客户端生成并持久化的32位hex>"
}
```

响应结构示例（值均为占位或示意）：

```json
{
  "code": 0,
  "msg": "",
  "data": {
    "userToken": "<token>",
    "user": {
      "guid": "<userGUID>",
      "name": "<username>",
      "role": "member",
      "lastAccessedAt": null,
      "createdAt": 1700000000,
      "updatedAt": 1700000000
    }
  }
}
```

- 所测登录响应没有通过 `Set-Cookie` 下发令牌；客户端需从 JSON 取出 token，并在后续请求发送 Cookie。不要假定其它版本或 SSO 流程一定相同。
- Web 前端用 `Path=/; SameSite=Strict` 写 `music-token`。Node.js 的原生 fetch 不会替你把 JSON 中的 token 转成 Cookie。
- `deviceId` 的前端生成方式为 UUID 去连字符，或随机 16 字节的 hex。其前端存储键为 `music-device__id`，登录态可能追加 `:<serverGUID>:<userGUID>`。
- 历史记录：缺 deviceId 返回100001；任意非空字符串样本曾被接受。仍建议生成稳定的32位hex，不依赖宽松校验。
- 错误密码可能返回 HTTP 200 / 120001，也可能出现短期登录拒绝。**失败次数阈值和恢复时间不是稳定契约**；不要以故意错密方式在现用账号验证限流。
- 密码请求格式的成功验证**不能证明服务端采用何种存储或比对算法**，本文不再推断“原样存储”。

### 3.3 会话处理

```http
Cookie: music-token=<token>
```

授权复核中：未登录访问 me、stream、cover 得到 HTTP 401 / `99999`；登出后再用原 token 请求 me 同样被拒。公开配置不应被笼统归为“退出后所有接口都401”。

建议会话令牌存入操作系统凭据存储；捕获401时清除本地登录态并引导重新登录，不在日志、URL或版本库中保存 token。

### 3.4 系统配置与 OAuth

`sys/config.data` 的所测字段：

```json
{
  "nasOAuth": { "clientId": "<clientId>" },
  "serverGUID": "<serverGUID>",
  "serverName": "<serverName>",
  "serverVersion": "<按实际回显>",
  "mediasrvVersion": "<按实际回显>",
  "capabilities": { "folderView": false, "libraryReconnect": true }
}
```

字段应按可用性判断，不将能力开关或版本值硬编码为所有实例相同。所测样本未返回 `nasOAuth.url`、`initialized` 或 `allowPasswordLogin`；初始化状态请调用独立端点。

前端 OAuth 跳转格式为：

```text
<nasOAuth.url>/signin?client_id=<clientId>&redirect_uri=<origin>/music/oauth/result&app_name=<品牌名>
```

应正确 URL 编码 query。缺少 nasOAuth.url 时无法按这一前端流程发起授权，**不等于后端 auth-login 路由不存在**。成功 OAuth 与首次初始化均需要额外环境验证。

<a id="paging"></a>
## 4. 分页、排序与过滤

### 4.1 分页差异

常规列表采用 `page`（1起始）、`size`，响应通常为 `{list,total,sort?}`。未确认所有接口的最大 size、缺省 size 或越界页行为；一次大 size 样本取到当时全部曲目，不代表不存在服务端上限。

| 接口族 | 分页结论 |
|---|---|
| 曲目列表 | 只读复核确认 page/size 可改变返回页 |
| 专辑、艺术家、关联曲目/专辑列表 | 前端/历史采用 page、size；只读复核成功请求部分分页样本，未穷举边界 |
| 收藏、播放历史 | 历史记录支持分页；非空语义依样本而变，本次未穷举 |
| 流派 | 空库样本仅验证空列表及 sort 回显 |
| `artist/list-all`、`shared-library/list` | 使用 `{list}`，没有已确认的分页契约 |
| 列表搜索 track/album/artist | 所测 page/size 未证实生效，详见搜索章节 |
| 歌单列表、歌单搜索 | 历史称忽略分页；小样本不能独立证实 |
| search/suggest | 分组限额建议，不是全量列表 |

### 4.2 排序矩阵

以下是**历史候选字段测试整理**；只读复核对各组接口测试了若干合法字段、非法字段及歌单曲目的默认回显。它不是服务端代码导出的完整白名单。

| 列表路径 | 默认 sort | 历史接受的字段 | 历史回退示例 |
|---|---|---|---|
| `/track/list` | `createdAt,desc` | title、createdAt | duration、trackNo、year、artistName |
| `/album/list` | `newTrackAddedAt,desc` | name、releaseYear、trackCount、newTrackAddedAt、artistName | createdAt、releaseDate |
| `/artist/list` | `trackCount,desc` | name、trackCount、albumCount | createdAt、updatedAt |
| `/genre/list` | `trackCount,desc` | name、trackCount | createdAt |
| `/favorite-track/list` | `favoriteAt,desc` | favoriteAt、title | createdAt、duration |
| `/track/album-detail/list` | `trackNo,asc` | trackNo、title | discNo、duration |
| `/track/artist-detail/list` | `createdAt,desc` | createdAt | title、trackNo |
| `/album/artist-detail/list` | `newTrackAddedAt,desc` | name、releaseYear、trackCount、newTrackAddedAt | createdAt |
| `/track/playlist-detail/list` | `trackAddedAt,desc` | title、trackAddedAt | trackNo、createdAt、duration |

历史格式边界：方向缺省、空字段、额外逗号会回退默认；字段大小写敏感，方向 `ASC` 可规范化为 `asc`。非法 sort 往往仍返回 code0，**优先看响应 sort 回显**，空列表的回显不能证明实际排列顺序。

播放历史、歌单列表、搜索没有已确认的 sort 回显；历史所测搜索排序参数未改变结果。并列时间戳不保证稳定顺序，不能从单次批量添加顺序推断最终曲目顺序。

### 4.3 维度过滤

不要将 `artistGUID`、`albumGUID`、`genreGUID` 直接加到 track/list 当作有效过滤。只读复核中假 artistGUID 未影响样本结果；其它候选过滤字段由历史记录称被忽略。用相应 `*-detail/list`，搜索用 search 端点。**不推断所有可能的过滤字段均不存在。**

<a id="tracks"></a>
## 5. 曲目与元数据

| 接口 | 权限 | query / body | data | 证据 |
|---|---|---|---|---|
| `GET /track/list` | 成员 | `page?`,`size?`,`sort?` | `{list:Track[],total,sort}` | V |
| `GET /track/metadata` | 成员 | `guid!`：曲目GUID | `{track:TrackDetail,audioSpec:AudioSpec}` | V |
| `POST /track/metadata` | 管理员用途 | 元数据对象，见下 | 成功响应待确认 | H·拒绝 / F请求体 |

metadata 缺 guid →100002，格式非法 →100002，格式正确但不存在 →100005。所测样本中，详情 track 多出 `accessStatus`、`hasLyric`，列表项不含两者；客户端应容忍字段差异。

### 元数据更新请求（F）

```json
{
  "guid": "<trackGUID>",
  "title": "<title>",
  "album": "<album name>",
  "albumArtist": "<album artist>",
  "artistGUIDs": ["<artistGUID>"],
  "genreGUIDs": ["<genreGUID>"],
  "discNumber": 1,
  "trackNo": 1,
  "year": 2024,
  "lyrics": "<lyric text>",
  "coverGUID": "<封面实体的裸GUID>",
  "coverId": "<含前缀的coverId>"
}
```

这是前端组装形态，**不是已确认所有字段必填或可任意省略的 schema**。注意响应曲目用 `discNo`，此更新请求使用 `discNumber`；artistGUIDs/genreGUIDs 为 GUID 数组而非名称。前端同时提交 coverGUID 和 coverId。历史成员请求曾被100003拒绝，管理员成功分支未测。

<a id="playback"></a>
## 6. 原文件播放、转码与 HLS

### 6.1 接口表

| 接口 | 权限/副作用 | 请求 | 返回 | 证据 |
|---|---|---|---|---|
| `GET /track/stream` | 成员，读取媒体 | `guid!`；可加 Range 头 | 原文件字节流或JSON错误 | V；FLAC/MP3各一个Range样本 |
| `POST /track/transcode` | 成员用途；建立转码会话 | `{guid,output:{codec,bitrate,channel,start}}` | `{status,errno,errmsg,hlsTime,url}` | H / F |
| `GET /track/hls/:guid/preset.m3u8` | 成员用途；依赖会话 | 路径参数 guid | HLS播放列表 | H |
| `POST /track/transcode/heartbeat` | 保活会话 | `{guid,timestamp}` | `{status,errno,errmsg}` | H / F |
| `POST /track/transcode/quit` | 退出会话 | `{guid}` | `{status,errno,errmsg}` | H |

### 6.2 直连与 Range

```http
GET /music/api/v1/track/stream?guid=<trackGUID>
Cookie: music-token=<token>
Range: bytes=0-99
```

所测小范围请求返回 HTTP206、与 Range 等长的正文及正确的 Content-Range；内容类型依源文件而定，如 `audio/flac`、`audio/mpeg`。不存在的格式合法 guid 返回 HTTP200 / JSON code100005；未登录返回401 / 99999。

只读复核不下载完整文件，不做浏览器可解码性或音质保证；FLAC等格式是否可原生播放取决于浏览器。历史前端播放策略区分 `native`、`wasm_prefetch`、`wasm_full`、`hls`，不是所有非原生格式都立即转码。CUE 虚拟分轨缺少测试数据，不能按普通整文件播放推断其行为。

### 6.3 转码请求与状态（H/F）

```json
{
  "guid": "<trackGUID>",
  "output": { "codec": "flac", "bitrate": 320, "channel": 2, "start": 0 }
}
```

历史响应示例：

```json
{
  "code": 0,
  "msg": "",
  "data": {
    "status": "success",
    "errno": "",
    "errmsg": "",
    "hlsTime": 2,
    "url": "/music/api/v1/track/hls/<trackGUID>/preset.m3u8"
  }
}
```

- 前端 codec 固定 flac；bitrate 提供128、256、320档，默认320。不要与 AudioSpec 中单位为bps的 bitrate 直接混用；其确切转码意义仍需输出验证。
- 前端 channel 候选为1/2/6/8，按源声道与设备能力选择。历史省略 channel 的请求曾成功，不等于所有输出配置都有效。
- `start:0` 为已知示例；非零 start 的单位、定位精度及输出行为**待确认**。
- 历史其它codec/bitrate样本返回code0，**不能据此宣称服务端不校验或生成的输出一定可播**。
- 前端/历史使用 success/ready 判断可用状态；完整状态机、等待轮询策略及并发会话隔离未完整验证。必须检查 data.status，而不是仅检查code。

### 6.4 HLS 资源与生命周期（H）

历史播放列表类型为 `application/vnd.apple.mpegurl`，采用fMP4：

```m3u8
#EXTM3U
#EXT-X-VERSION:7
#EXT-X-ALLOW-CACHE:NO
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-MAP:URI="init.mp4"
#EXTINF:2.000000,
00000.m4s
```

以上是头部/首片段示例，不是完整播放列表。应基于返回的 url 解析 init.mp4、00000.m4s 等相对URI，不自行假定所有分片命名或数量。历史分片类型为 `video/iso.segment`。

- 前端会按固定间隔发送 `{guid,timestamp:<毫秒>}` 心跳；具体间隔、失效时间与回收策略应随版本验证，不依赖某次观测的固定秒数。
- 历史无心跳会话会在一段时间后失效，但不同观测区间不能合并为精确统一阈值；有心跳也不证明「无限保活」。
- 从未建立会话的合法 guid 曾返回 100005；回收后播放列表曾返回 **HTTP410 空体**；非法 guid 曾返回 100002。
- quit 后短时间内仍可能取到播放列表，不能假定立即404；对已回收会话执行 quit 可能返回 code0 但 `data.status="failed"`，应检查 `errno` / `errmsg`。

本次只读复核未执行本节会话操作。实现时处理过期并重新建会话；不要主动退出其它用户/设备的会话来做验证。

<a id="lyrics-roam"></a>
## 7. 歌词与随机漫游

### 7.1 歌词

| 接口 | 权限 | query | data | 证据 |
|---|---|---|---|---|
| `GET /lyric/list` | 成员 | `trackGUID!` | `{list:Lyric[],preferred:guid或null}` | V；一个真实样本 |

```json
{
  "list": [
    {
      "guid": "<lyricGUID>",
      "source": 2,
      "content": "[00:01.00]示例歌词",
      "createdAt": 1700000000,
      "updatedAt": 1700000000,
      "isLRC": true,
      "offset": 0
    }
  ],
  "preferred": "<lyricGUID>"
}
```

- 参数是 **trackGUID**。误写 trackGuid 在所测样本返回100002；其它错误拼写亦不应使用。
- content 可包含标准LRC及逐行JSON元信息。历史JSON片段含 `t`（毫秒）及 `c` 富文本数组，元素可能有tx/li/or。逐行尝试解析，不把整份content强行当成JSON或纯LRC。
- offset 为毫秒。修改通过 event/report 的 lyric_offset_change，不是GET端点参数。
- source 的后端语义**未确认**。历史前端出现相互矛盾的枚举映射；样本值2/3不能可靠映射为“云端/内嵌/手工”。显示原始值或使用未知来源兜底。
- 历史不存在trackGUID返回100005。无歌词曲目的 `{list:[],preferred:null}` 是待验证预期，不是已确认的成功样本。

### 7.2 漫游：GET 但有状态变化

| 接口 | query | 历史 data | 证据 |
|---|---|---|---|
| `GET /track/roam-start` | `deviceId!` | `{current:RoamItem,next:RoamItem}` | H / F |
| `GET /track/roam-next` | `deviceId!`,`relativeRoamId!` | `{previous:RoamItem,next:RoamItem}`等相对邻项 | H / F |
| `GET /track/roam-previous` | `deviceId!`,`relativeRoamId!` | 相对邻项；队首样本为null | H / F |

`RoamItem = {roamId,track:Track}`。使用返回的roamId作为后续relativeRoamId，不使用trackGUID替代；前端映射出的file字段不是后端返回字段。

历史缺deviceId或非法relativeRoamId返回100002；相对键current/next/previous应做可选处理。只读复核为避免改变漫游状态而跳过全部3条。若只需无重复随机播放整个已取列表，也可在客户端自行洗牌。

<a id="catalog"></a>
## 8. 专辑、艺术家与流派

### 8.1 专辑

| 接口 | query | data | 证据 |
|---|---|---|---|
| `GET /album/list` | `page?`,`size?`,`sort?` | `{list:Album[],total,sort}` | V |
| `GET /album/detail` | `guid!`：专辑GUID | `Album` | V |
| `GET /track/album-detail/list` | `albumGUID!`,`page?`,`size?`,`sort?` | `{list:Track[],total,sort}` | V |

均为成员读取。专辑详情缺guid为100002，不存在guid为100005。关联曲目端点使用albumGUID，不是guid。

### 8.2 艺术家

| 接口 | 权限 | query / body | data | 证据 |
|---|---|---|---|---|
| `GET /artist/list` | 成员 | `page?`,`size?`,`sort?` | `{list:Artist[],total,sort}` | V |
| `GET /artist/list-all` | 成员 | 无已确认必填参数 | `{list:Artist[]}`，不是裸数组 | V |
| `GET /artist/detail` | 成员 | `guid!`：艺术家GUID | `Artist` | V |
| `GET /track/artist-detail/list` | 成员 | `artistGUID!`,`page?`,`size?`,`sort?` | `{list:Track[],total,sort}` | V |
| `GET /album/artist-detail/list` | 成员 | `artistGUID!`,`page?`,`size?`,`sort?` | `{list:Album[],total,sort}` | V |
| `POST /artist/create` | 管理员用途 | `{name,coverId:null}`：前端形态 | 成功模型待确认 | H·拒绝 / F |

艺术家详情缺guid为100002，不存在guid为100005。历史create成员请求返回100003；没有管理员创建成功样本。

### 8.3 流派

| 接口 | 权限 | query / body | data | 证据 |
|---|---|---|---|---|
| `GET /genre/list` | 成员 | `page?`,`size?`,`sort?` | `{list,total,sort}`；实体字段未完整验证 | V；空列表 |
| `GET /genre/detail` | 成员 | `guid!` | 成功对象待确认 | E；仅缺参/不存在 |
| `GET /track/genre-detail/list` | 成员 | `genreGUID!`,`page?`,`size?`,`sort?` | `{list:Track[],total,sort?}` | V；假guid空列表 |
| `POST /genre/create` | 管理员用途 | `{name}`：前端形态 | 成功模型待确认 | H·拒绝 / F |

**genre/detail 用guid，track/genre-detail/list用genreGUID。** 不能因空列表code0就证明存在真实流派关系。流派创建历史成员请求返回100003；管理员成功分支未测。

<a id="search"></a>
## 9. 搜索

| 接口 | 权限 | query / body | data | 证据 |
|---|---|---|---|---|
| `GET /search/track` | 成员 | `q!` | `{list:(Track+score)[],total}` | V |
| `GET /search/album` | 成员 | `q!` | `{list:(Album+score)[],total}` | V |
| `GET /search/artist` | 成员 | `q!` | `{list:(Artist+score)[],total}` | V |
| `GET /search/playlist` | 成员 | `q?`，可省略 | `{list:(Playlist+score)[],total}` | V；关键字样本可能为空 |
| `GET /search/suggest` | 成员 | `q!` | 按track/album/artist/playlist分组的建议 | V |
| `POST /search/index/rebuild` | 管理员用途；重建索引 | `{}` | 成功模型待确认 | H·拒绝；140001仅枚举 |

### 分页与搜索参数

- 历史及一次只读复核中，列表搜索的 `page` / `size` 未证实生效；当命中数不足以跨页比较时，只能标记「样本不足」，**不能把相同结果作为忽略分页参数的证明**。可对已收到结果做客户端分页，但不保证大库没有服务端隐藏上限。
- playlist 缺 q 可成功；若关键字查询为 0 条或样本过少，无法确认分页。
- 其它 4 个 GET 缺 q 返回 100002。历史空字符串也返回 100002，纯空格样本曾被接受；空格语义不应视为稳定契约。
- 历史sort/offset/limit样本未生效，不应作为可靠分页/排序契约。
- score是搜索结果的相关度字段，不限于曲目。普通列表不保证存在；playlist的score来自历史非空结果，本次未复现其非空结构。

suggest形态（结构示意，不表示所有组永远存在或为空）：

```json
{
  "track": { "total": 0, "items": [] },
  "album": { "total": 0, "items": [] },
  "artist": { "total": 0, "items": [] },
  "playlist": { "total": 0, "items": [] }
}
```

历史部分组最多返回5条，size未改变结果；应把它作为限额建议，而不是全量搜索。重建索引不是只读操作，不能为了检查路由随意调用。

<a id="favorites"></a>
## 10. 收藏

| 接口 | 权限/副作用 | 请求 | data / 行为 | 证据 |
|---|---|---|---|---|
| `GET /favorite-track/list` | 成员 | `page?`,`size?`,`sort?` | `{list:Track[],total,sort}` | V；空/非空依账号状态 |
| `POST /favorite-track/create` | 成员；添加收藏 | `{trackGUID}` | 历史为null；重复收藏仍code0 | H |
| `POST /favorite-track/delete` | 成员；取消收藏 | `{trackGUID}` | 历史不存在目标也code0 | H |
| `GET /favorite-track/purge-track-count` | 成员 | 无 | `{total:失效收藏数}` | V |
| `POST /favorite-track/purge-track` | 成员；清理全部失效收藏 | `{}` | 历史报告清理成功；完整data模型未保留 | H |

历史create不存在曲目为100005，缺trackGUID为100001；delete具幂等样本但不保证所有错误都被忽略。isFavorite用于渲染当前用户状态。只读复核没有添加/删除收藏，不能据此复测非空分页的全部语义。

**清理失效收藏不可视为无害探测或可完整回滚。** 不要对用户既有收藏执行purge来验证接口。

<a id="history-events"></a>
## 11. 播放历史与事件

### 11.1 播放历史

| 接口 | 请求 | data / 行为 | 证据 |
|---|---|---|---|
| `GET /play-history/list` | `page?`,`size?` | `{list:Track[],total}`，无已确认sort回显 | V；空/非空依账号状态 |
| `POST /play-history/delete` | `{trackGUIDs:[...]}` | 删除相应曲目历史；成功data待确认 | H |

成员使用。历史记录支持分页并按最近播放在前排列，列表元素不是额外带播放时间字段的独立History对象；空账号不能复测非空行为。

删除参数是复数 **trackGUIDs数组**；历史传单数trackGUID返回100001。先上报再删除不等于恢复原有历史，不应作为现用账号的“无副作用测试”。

### 11.2 事件上报

| 接口 | 请求 | 行为 | 证据 |
|---|---|---|---|
| `POST /event/report` | `{events:[{eventType,occurredAt,payload}]}` | 更新播放历史、歌词偏移等用户状态 | H / F；本次未执行 |

```json
{
  "events": [
    {
      "eventType": "track_play",
      "occurredAt": 1700000000000,
      "payload": { "trackGUID": "<trackGUID>" }
    },
    {
      "eventType": "lyric_offset_change",
      "occurredAt": 1700000000000,
      "payload": {
        "trackGUID": "<trackGUID>",
        "lyricGUID": "<lyricGUID>",
        "offset": 500
      }
    }
  ]
}
```

这是结构示例；发生事件时使用实际毫秒时间，不要原样发送示例时间。

| eventType | 已知用途/证据 |
|---|---|
| track_play | 前端调用；历史观察会产生播放记录 |
| lyric_offset_change | 前端调用；历史观察会改变歌词offset |
| lyric_preference_change | 仅发现枚举，完整payload与生效行为未确认 |
| sorting_change | 仅发现枚举，完整payload与生效行为未确认 |

历史边界：空events或缺events为100001；未知类型、缺payload、假曲目GUID曾返回code0，但可能被静默忽略。**code0不证明事件已生效**，需读回状态核对。卸载时的前端sendBeacon通路使用JSON Blob及Cookie，不带authx。

<a id="playlists"></a>
## 12. 歌单

普通成员可操作其有权限的歌单；跨用户隔离、共享关系和管理员代操作没有完整验证。

| 接口 | query / body | data / 行为 | 证据 |
|---|---|---|---|
| `GET /playlist/list` | 无已确认必填参数 | `{list:PlaylistBase[],total}` | V；只有1个歌单，分页未证实 |
| `GET /playlist/detail` | `guid!`：歌单GUID | `PlaylistDetail` | V |
| `GET /playlist/batch-detail` | `guids?`：逗号分隔GUID字符串 | `{list:PlaylistDetail[]}`；缺参为空列表 | V |
| `POST /playlist/create` | `{name,coverId:null}` | `PlaylistBase` | H |
| `POST /playlist/edit` | `{guid,name,coverId}` | 改名称/封面；完整data待确认 | H |
| `POST /playlist/delete` | `{guid}` | 删除歌单；完整data待确认 | H |
| `POST /playlist/add-track` | `{guid,trackGUIDs:[...]}` | 添加曲目；完整data待确认 | H |
| `POST /playlist/remove-track` | `{guid,trackGUIDs:[...]}` | 移除曲目；完整data待确认 | H |
| `POST /playlist/purge-track` | `{guid}` | 清理歌单失效曲目；完整data待确认 | H |
| `GET /playlist/purge-track-count` | `guid!` | `{total:失效曲目数}` | V |
| `GET /track/playlist-detail/list` | `playlistGUID!`,`page?`,`size?`,`sort?` | `{list:Track[],total,sort}` | V |

### 字段与批量查询

- `PlaylistBase = {guid,name,coverId,createdAt,updatedAt}`。
- `PlaylistDetail` 在上述字段上增加trackCount。所测 list/detail 条件性差异已确认；create不含trackCount与search含trackCount来自历史记录。
- 前端按**每批100个GUID**拆分batch-detail；这不是已证明的服务端硬性上限。
- list历史样本忽略page/size；歌单数较少的样本不能复证。客户端应按实际返回长度/total判断，不依赖未证实的分页。
- playlist曲目默认sort为trackAddedAt,desc，**有回显**；不要使用前端展示层的createdAt替代此排序字段。

### 写入边界（H）

- create缺name/空name →100002；非字符串name →100001；重名曾返回160001。
- edit需要name；历史只传guid和coverId返回100002。不要假定它是任意字段PATCH。
- add/remove使用trackGUIDs数组，guid指**歌单**；关联列表用playlistGUID。
- delete后历史detail返回100005；删除既有歌单是破坏性操作。
- 上传封面与关联歌单分两步，见下一节；不要把封面上传成功当作歌单已更新。

<a id="covers"></a>
## 13. 封面读取与上传

| 接口 | 权限/请求 | 返回 | 证据 |
|---|---|---|---|
| `GET /static/cover` | 成员；`coverId!`,`size?` | 图片字节流，或JSON/空体错误 | V |
| `POST /static/cover/playlist` | 成员用途；multipart字段file | 历史为 `{coverId}` | H |
| `POST /static/cover/track` | 管理员用途；multipart字段file | 成功模型待确认 | H·拒绝 / F |

### 读取

coverId包含前缀，已知有 `album_`、`artist_`、`track_`、`playlist_`；不要只发送裸GUID。

- 前端尺寸选项：160、600、1024、1600、2000；Original/0时前端省略size。
- **服务端不传size**：历史及所测样本返回原图；**前端缺省调用**：会补size=600。两者不要混淆。
- 尺寸参数可能改变图片格式与字节数；大于源图尺寸的请求可能直接返回原图。不同实例的编码、尺寸与缓存行为不保证一致，不能仅凭字节数相同证明参数被拒。
- 未登录返回401/99999。封面错误是**非 JSON 错误分支**：缺 coverId、空值、裸 GUID、非前缀字符串，以及带真实前缀但资源不存在的 coverId，各版本均表现为 HTTP400 空体（个别版本曾出现 404 `text/plain`）。客户端应按 HTTP 状态与 Content-Type 兼容处理，不能强制解析 JSON，也不要把 400 或 404 写成唯一分支。
- `<img>`直接URL不带authx，但仍依赖Cookie权限。图片缓存不可代替访问控制。

### 上传与关联（H/F）

使用原生FormData时让客户端生成Content-Type及boundary，**不能JSON.stringify(FormData)**。历史参考客户端存在此问题，见README的限制说明。

歌单封面上传返回coverId后，用playlist/edit携带guid、name、coverId关联；曲目封面关联需要管理员track/metadata。历史无file返回100002；曲目封面普通成员返回100003。

本清单没有已确认的独立封面删除API。上传后不关联可能留下孤儿文件，因此不要在现用实例反复上传测试图；HTTP400/404 等错误正文也不应直接展示为可信文本。

<a id="libraries"></a>
## 14. 共享音乐库

| 接口 | 权限 | query / body | data / 已知行为 | 证据 |
|---|---|---|---|---|
| `GET /shared-library/list` | 成员 | 无 | `{list:SharedLibrary[]}` | V |
| `GET /shared-library/detail` | 成员 | `guid!` | `SharedLibrary` | V |
| `POST /shared-library/create` | 管理员用途 | `{path,autoDownloadLyric,metadataPreference}` | 成功模型待确认 | H·拒绝 / F |
| `POST /shared-library/edit` | 管理员用途 | `{guid,path,autoDownloadLyric,metadataPreference}` | 成功模型待确认 | H·参数错误 / F |
| `POST /shared-library/delete` | 管理员用途；删除库 | `{guid}` | 成功模型待确认 | H·拒绝 |
| `POST /shared-library/scan` | 管理员用途；扫描 | `{guid}` | 成功模型待确认 | H·拒绝 |
| `POST /shared-library/scan-all` | 管理员用途；扫描全部 | 前端无body | 成功模型待确认 | H·拒绝 / F |
| `POST /shared-library/reconnect/check` | 管理员用途 | `{guid,path}` | 成功模型待确认 | H·拒绝 / F |
| `POST /shared-library/reconnect` | 管理员用途；重连 | `{guid,path}` | 成功模型待确认 | H·拒绝 / F |

- detail缺guid为100002，不存在为100005；读取成功不代表成员可维护库。
- 前端create/edit形态里没有name，而读取模型可以含name（可能为空）。不要用“修改name”替代实际请求。
- metadataPreference候选：`local_preferred`、`cloud_preferred`、`local_only`；autoDownloadLyric为布尔开关。完整必填规则未从管理员成功分支确认。
- 历史create空body或仅name返回100001，含path后出现100003；delete/scan缺guid曾返回100001，带guid为100003。
- reconnect/check与reconnect历史只有guid时100001，同时guid+path时100003。此观察支持正确调用形态，**不能推导整个服务端的校验执行顺序**。
- reconnect不是因为参数错误就“未实现”；也不要用真实库做重连/扫描/删除探测。

<a id="folder-view"></a>
## 15. 文件夹视图

文件夹视图按音乐库的目录树浏览与播放，不依赖曲目元数据。前端在 `GET /sys/config` 的 `capabilities.folderView` 为 `true` 时展示入口；该开关只表示能力可用，不是权限位，成员与管理员共用同一 `music-token` 会话。

| 接口 | 权限 | query / body | data / 已知行为 | 证据 |
|---|---|---|---|---|
| `GET /folder-view/list` | 成员 | `parentPath!`,`sort?` | `{folder:{name,path,itemCount,folders[],tracks[]},sort}` | V |
| `POST /folder-view/playable-tracks` | 成员 | `{folderPaths:[],trackGUIDs:[]}` | `{tracks:Track[]}` | V |
| `POST /folder-view/add-to-playlist` | 成员 | `{folderPaths:[],trackGUIDs:[],playlistGUID}` | 待确认 | F；空参数 100002 |
| `POST /folder-view/delete` | 管理员用途 | `{folderPaths:[],trackGUIDs:[]}` | 待确认 | E；成员 100003 |
| `POST /folder-view/recover` | 管理员用途 | `{folderPaths:[],trackGUIDs:[]}` | 待确认 | E；成员 100003 |

### 15.1 目录列表

- `parentPath` 为库根目录或库内绝对路径。缺失或空字符串返回 100002；路径不存在返回 100005。两者都是 HTTP 200 + JSON，不是 4xx。
- `data.folder` 含 `name`、`path`、`itemCount`、`folders[]`、`tracks[]`；目录项含 `name`、`path`、`itemCount`、`isAdminDeleted`。
- 曲目项是精简模型：`guid`、`title`、`album`、`artists`、`audioSpec`、`coverId`、`duration`、`isCue`、`isFavorite`、`isAdminDeleted`；不含 `trackNo`、`discNo`、`year`、`genres`、`isrc` 与时间戳，需要时另取详情或 `track/metadata`。
- **不分页**：`page`、`size` 被忽略，整层目录一次返回；`itemCount` 与数组长度可能不一致，不要用它推导页数。
- `sort` 采用与列表一致的 `字段,方向`：默认 `title,asc`，`title,desc` 生效；无法识别的值静默回退默认值，不返回错误。
- 目录项与曲目项都带 `isAdminDeleted`，用于标记被管理员软删除的对象；成员是否能看到 `isAdminDeleted:true` 的条目未验证。
- `path` 是服务端绝对路径。客户端应只用 `name` 展示，不要原样显示路径或写入日志。

### 15.2 可播放集合

- `POST /folder-view/playable-tracks` 接受 `folderPaths` 与/或 `trackGUIDs`，把选中目录或曲目展开成 `{tracks:[]}` 播放队列，不落库、不改变用户状态。
- 空数组返回 100002；不存在的路径返回 100005；`tracks` 可能为空数组。
- 展开出的曲目仍走 `GET /track/stream` 或转码流程，本接口不返回播放地址。

### 15.3 管理语义

- `delete`、`recover` 对成员返回 100003（admin only），即目录删除与恢复是管理员软删除能力，与 `isAdminDeleted` 对应。
- `add-to-playlist` 对成员开放，是正常写操作：需要 `playlistGUID`，空参 100002；是否去重、是否会写入失效曲目未验证。
- 不要对真实库做删除、恢复或批量加歌单探测；这些操作无法可靠回滚。

### 15.4 与曲目列表的差异

- 目录视图没有分页、搜索与收藏筛选，过滤能力只到目录层级。
- 曲目模型比 `GET /track/list` 更小，`score` 一类搜索字段不存在。
- 同一曲目在目录视图与普通列表中的 `guid` 一致，可跨接口复用。
- 是否隐藏不可播放文件、CUE 分轨或隐藏目录未验证；客户端应容忍 `folders`、`tracks` 为空以及未知字段。

<a id="administration"></a>
## 16. 用户管理、设置与授权目录

### 16.1 用户管理与改密

| 接口 | 权限/用途 | query / body | data / 已知行为 | 证据 |
|---|---|---|---|---|
| `GET /user/list` | 管理员用途 | 完整查询规则待确认 | 成员100003；成功模型待确认 | E |
| `GET /user/exists` | 管理员用途 | 前端使用username | 成员100003，成功模型/参数有效性未测 | E / F |
| `POST /user/create` | 前端管理员功能 | `{username,password,sharedLibraryAccess}` | 历史样本100001，成功模型待确认 | F / H·参数错误 |
| `POST /user/edit` | 前端管理员功能 | `{guid,username,password?,sharedLibraryAccess}` | 历史样本100001，成功模型待确认 | F / H·参数错误 |
| `POST /user/delete` | 管理员用途；删除用户 | `{guid}` | 历史成员100003 | H·拒绝 |
| `POST /user/unbanned` | 管理员用途；解除禁用 | `{guid}` | 历史成员100003 | H·拒绝 |
| `POST /user/passwd-change` | 当前用户改密 | `{password:"<sha256小写hex>"}` | 历史成功；完整data待确认 | H；本次未执行 |

- user/exists建议遵循前端username参数；成员无论是否传参都可能被拒，不能用100003证明参数正确。
- user/create/edit的100001不是明确权限拒绝，不能宣称“任何body均失败”或成功请求所需字段已完备。
- 登录/改密遵循SHA-256格式；管理员create/edit的密码处理仍需结合其前端调用与隔离实例成功验证，不应把未知字符串直接作为明文发送。
- sharedLibraryAccess形态见模型章节，不能因为请求里有该字段就假定User响应也含该字段。
- passwd-change作用于当前会话用户；历史即使附加guid也未改变目标用户。不要用它管理员式地修改他人密码。
- 历史缺/空password为100001，纯空白字符串为120006。**不要重跑空值/错密/同值改密来“证明安全”**，这仍是敏感写操作或认证探测。

### 16.2 设置

| 接口 | 用途/请求 | data / 权限 | 证据 |
|---|---|---|---|
| `GET /settings/server` | 读取服务设置 | 成员100003；管理员成功模型待确认 | E |
| `POST /settings/server` | 更新设置；完整body待确认 | 历史成员100003；成功未测 | H·拒绝 / F |
| `GET /settings/user` | 读取用户相关设置 | 成员100003；不要按路径名误判为普通用户自助设置 | E |
| `POST /settings/user` | 更新用户相关设置；完整body待确认 | 历史成员100003；成功未测 | H·拒绝 / F |

前端资料涉及sharedLibraryAccess，但现有证据不足以写出完整settings/user请求结构、必填字段或响应模型。此处明确留空，不拼凑其它用户接口的请求体作为保证。

### 16.3 授权目录

| 接口 | query / body | data / 权限 | 证据 |
|---|---|---|---|
| `GET /app-center/authed-dir/list` | 无已确认必填参数 | 成员100003；成功模型待确认 | E |
| `GET /app-center/authed-dir/sub/list` | `parent!`：非空父目录参数 | 缺parent为100002；提供后成员100003 | E |
| `POST /app-center/authed-dir/sub/create` | `{parent,name}` | 历史成员100003；成功模型待确认 | H·拒绝；参数来自历史探测 |

parent/name不应替换为guid/path等猜测字段。目录创建是写入操作；子目录成功列表结构、路径规范化、越界访问限制均未完成验证。

<a id="tasks"></a>
## 17. 任务

| 接口 | query / body | data / 已知行为 | 证据 |
|---|---|---|---|
| `GET /task/list` | 无已确认必填参数 | `{list:[]}`；真实任务模型待确认 | V；成员空列表 |
| `GET /task/detail` | 成功参数**待确认**；曾试taskId/guid/id | 假taskId返回200010001 | E；非前端注册表路径 |
| `POST /task/cancel` | `{taskId}` | 历史不存在目标：JSON code404 | H·错误分支 |
| `POST /task/delete` | `{taskId}` | 历史不存在目标：200010001 | H·错误分支 |
| `POST /task/retry` | `{taskId}` | 历史不存在目标：200010001 | H·错误分支 |

- 缺taskId的历史POST返回1001，并含Go字段校验详情；cancel提及TaskCancelRequest.TaskId，delete/retry提及TaskCommandRequest.TaskId。
- JSON code404与HTTP404不是同一概念；200010001的消息为task not found。
- 样本中没有真实任务，**不能证明task/detail的正确参数名，也不能证明成员可以控制真实任务**。
- 参数错误或不存在目标的响应不构成成功权限/任务生命周期验证；不要对真实任务尝试cancel/delete/retry做“只读探测”。

<a id="models"></a>
## 18. 数据模型

本节是所测字段与前端线索的整理，**不是严格JSON Schema**。客户端应容忍未知字段、缺省字段和null；字段存在性依接口而变。以下“类型”表示常见形态，不保证所有库中都有非空值。

### 18.1 Track / TrackDetail

| 字段 | 常见类型 | 说明 |
|---|---|---|
| guid | string | 曲目GUID |
| title | string | 标题 |
| coverId | string或null | 通常可引用album_封面 |
| year | number或null | 年份 |
| discNo、trackNo | number或null | 光盘/音轨序号；更新请求注意discNumber |
| isrc | string或null | ISRC |
| duration | number | 毫秒 |
| isCue | boolean | 是否CUE虚拟曲目；true分支未测 |
| createdAt、updatedAt | number | Unix秒 |
| album | 专辑简对象或null | 不保证含专辑列表中的统计字段 |
| artists | 艺术家简对象数组 | 不保证含trackCount/albumCount |
| genres | 数组 | 所测样本为空，元素完整模型未确认 |
| audioSpec | AudioSpec | 音频规格 |
| isFavorite | boolean | 当前用户收藏状态 |
| accessStatus | 状态值 | 详情样本额外出现，完整枚举未确认 |
| hasLyric | boolean | 详情样本额外出现 |

TrackDetail指metadata.data.track；所测track/list元素不含最后两个字段。metadata.data还单独返回audioSpec。搜索命中另加score，不应将它写成普通Track必填字段。

### 18.2 AudioSpec

| 字段 | 含义 |
|---|---|
| bitDepth | 位深 |
| sampleRate | 采样率Hz |
| channel | 声道数 |
| bitrate | 码率bps；与转码请求的档位值不同 |
| codec、container、format | 编码、容器、格式；container样本可为空字符串 |
| duration | 毫秒 |
| path | 服务器本地路径，仅作元信息，不能视为客户端可访问URL |
| size | 原文件字节数 |

前端还读取过extension，但所测响应不含该字段，不应作为必填项。

### 18.3 专辑、艺术家、歌单

| 模型 | 所测/历史字段 |
|---|---|
| Album | guid、name、coverId、releaseDate、barcode、createdAt、updatedAt、artists、trackCount |
| Artist | guid、name、coverId、createdAt、updatedAt、trackCount、albumCount |
| PlaylistBase | guid、name、coverId、createdAt、updatedAt |
| PlaylistDetail | PlaylistBase + trackCount |
| SearchHit | 对应实体 + score（相关度） |

releaseDate通常为yyyy-MM-dd，缺值需容错。前端读取过originalReleaseYear/originalReleaseDate，但本实例历史样本未返回。嵌入Track的Album/Artist简对象不保证具有这些独立列表的全部字段。

歌单detail/batch-detail的trackCount已有证据，list没有；create不含与search含trackCount由历史记录支持。

### 18.4 用户、库、歌词与辅助模型

```text
User = {
  guid, name, role: "member" | "admin",
  lastAccessedAt: number | null, createdAt, updatedAt
}

SharedLibrary = {
  guid, name, path, autoDownloadLyric,
  metadataPreference, contentLastChangedAt, accessStatus
}

SharedLibraryAccess = {
  mode: "all" | "partial" | "none",
  guids: string[]
}

Lyric = {
  guid, source, content, createdAt, updatedAt, isLRC, offset
}

RoamItem = { roamId, track: Track }

SysInfo = {
  connect: { id, status, entitlement: { type, endTime } }
}
```

- SharedLibraryAccess来自前端请求体，不是已证明总会出现在User响应中的字段；partial时使用guids表达所选库。
- SharedLibrary.name样本可为空；accessStatus只观察到数值样本，完整枚举未知。
- metadataPreference：local_preferred / cloud_preferred / local_only。
- Lyric.source语义不确定；preferred属于lyric/list响应外层，不是单个Lyric必填字段。
- SysInfo.endTime为历史授权信息中的时间字段；客户端应按实际服务语义处理，不把示例授权值当成账号保证。
- Genre、Task、管理员设置/用户列表的完整成功模型尚未取得，不用其它模型推断替代。

<a id="errors"></a>
## 19. 错误码

**业务码与HTTP状态独立。** 下表“来源”区分只读复核、历史观察和前端枚举；枚举名称不保证实际触发条件已验证。

| code | 名称/含义 | 来源与限定 |
|---|---|---|
| 0 | 成功 | 所测成功JSON均为0 |
| 200 | 前端也接受为成功 | F；本次未观察 |
| 1001 | 字段validator错误 | H；如任务POST缺taskId |
| 404 | 目标不存在 | H；task/cancel的JSON业务码，不是全部任务共用码 |
| 99999 | INVALID TOKEN | V；未登录或退出后me等返回HTTP401 |
| 100001 | Unknown | H/F；参数缺失等也可能触发，不能据此反推权限或校验顺序 |
| 100002 | InvalidArgs | V；缺query、非法guid等 |
| 100003 | AdminRequired | E；member请求被拒，管理员成功未测 |
| 100004 | Forbidden | F；触发场景未验证 |
| 100005 | NotFound | V；格式合法但不存在的资源 |
| 110001 | AppAlreadyInitialized | F |
| 110002 | AppNotInitialized | F |
| 110003 | InitRequiresNASAdmin | F |
| 110004 | InitSessionNotFound | F |
| 120001 | Unauthorized | H/F；错误密码及临时登录拒绝均曾出现，不保证具体限流阈值 |
| 120002 | UserDisabled | F |
| 120003 | OAuthUserAlreadyExists | F |
| 120004 | UsernameExists | F |
| 120005 | InvalidUsername | F |
| 120006 | PasswordRequired | H/F；改密纯空白password曾触发，缺/空字段样本反而为100001 |
| 130001 | CueMissingOffset | F；无CUE样本 |
| 140001 | SearchIndexRebuildInProgress | F；未触发 |
| 150001 | SharedLibraryNameExists | F |
| 150002 | SharedLibraryPathExists | F |
| 150003 | SharedLibraryNoWritePermission | F |
| 150004 | SharedLibraryHitMaxCount | F |
| 150005 | SharedLibrarySubPathExists | F |
| 160001 | PlaylistNameExists | H/F；历史歌单重名样本 |
| 160002 | PlaylistHitMaxCount | F |
| 200010001 | task not found | E：task/detail；H：task/delete、task/retry；不在前端错误枚举里 |

封面错误可能是 HTTP400 空体或 HTTP404 非 JSON 短正文；HLS 会话回收后曾观察到 HTTP410 空体。这些都要与 JSON 业务码分开处理。转码 `errno` 字符串也不是信封 `code`。

<a id="authx"></a>
## 20. authx 签名

### 20.1 是否必须

前端统一 fetch 客户端通过 HTTP **header** `authx` 发送签名（不是 query 参数）；媒体直接 URL、图片以及 sendBeacon 等通路不一定发送。一次授权复核中的只读请求、登录和退出不带该 header 仍成功，携带伪造值的只读样本也成功。**不能由此保证所有路由、请求类型或未来版本都不校验，也不能证明服务端读取了伪造值。**

以下是前端逆向得到的算法说明（F），不是经过全量签名向量验证的独立SDK。服务端宽松接受不能作为签名实现正确的证明。

### 20.2 构造过程

```text
nonce     = 100000..999999 的随机6位十进制字符串
timestamp = 当前毫秒时间戳字符串
pathname  = 最终URL的pathname，包含/music/api/v1前缀，不含query

GET:
  从最终URL.searchParams取得查询参数（此时值已经是字符串）
  丢弃值恰为字符串 "undefined" 或 "null" 的项；保留空字符串
  按key字典序规范化并用URLSearchParams编码拼接
  将结果中的 "+" 改为 "%20"
  对裸 % 做 replace(/%(?![0-9A-Fa-f]{2})/g, "%25")
  尝试decodeURIComponent；失败则回退到未解码的规范化原文
  bodyHash = md5(上述payload)

POST JSON:
  bodyHash = md5(JSON.stringify(body))
  无body时使用 md5("")

sign = md5(SALT + "_" + pathname + "_" + nonce + "_" + timestamp
           + "_" + bodyHash + "_" + API_KEY)
authx = "nonce=" + nonce + "&timestamp=" + timestamp + "&sign=" + sign
```

前端构建中可找到两个公开常量，本文**不复制其字面量**：

```text
SALT    = <从授权实例的前端构建读取>
API_KEY = <从授权实例的前端构建读取>
```

客户端可见的常量不是用户令牌，也不能提供「客户端持有秘密」的安全保证。若目标版本需要签名，应从自己获授权实例的前端构建中读取并与该版本一起做兼容性验证；不要将某一构建的值当成跨版本凭据或写入公开 SDK。

### 20.3 实现边界

- 必须以**最终URL**为准；内联`?a=b`也应参与query规范化，不可混入pathname。
- URLSearchParams的值均为字符串；JavaScript对象真正的null/undefined如何转换，应在URL构造层明确决定，不能把两层规则混写。
- 重复key、特殊Unicode、数组序列化及multipart签名的完整等价规则尚未在本文提供独立测试向量，不宜直接猜测。
- JSON签名应与实际发送的序列化字节一致；避免签名一次、发送时再用不同规则重新序列化。
- multipart必须原样发送FormData，不能照抄JSON bodyHash规则后宣称兼容。
- 早期参考客户端的最终URL/参数过滤和FormData发送存在缺陷，**不作为推荐SDK**。实现时应以实际发送的最终 URL、序列化字节和 FormData 为准，不照抄历史封装。

<a id="examples"></a>
## 21. 最小接入示例与实现建议

### 21.1 Node.js：登录 → 查询 → 退出

下例用于可信环境中的一次读取示范，使用环境变量与交互式输入，不输出令牌，不显式发送 authx；符合所测请求形态，但不是浏览器 Cookie/CORS 示范或完整 SDK。要求 Node.js 24。不要把密码、地址或令牌硬编码到示例中；优先使用 HTTPS。

将origin替换为授权实例地址，在Bash中整体执行。凭据限制在子shell中；EXIT清理不会覆盖登录、查询或登出失败的非零退出状态。

```bash
(
set -euo pipefail
trap 'unset FNMUSIC_PASSWORD FNMUSIC_USERNAME' EXIT
export FNMUSIC_ORIGIN='https://<host>:<port>'
read -r -p '用户名: ' FNMUSIC_USERNAME
read -r -s -p '密码: ' FNMUSIC_PASSWORD
printf '\n'
export FNMUSIC_USERNAME FNMUSIC_PASSWORD
node --input-type=module <<'NODE'
import crypto from 'node:crypto';
const { FNMUSIC_ORIGIN: origin, FNMUSIC_USERNAME: username,
        FNMUSIC_PASSWORD: password } = process.env;
if (!origin || !username || !password) throw new Error('缺少环境变量');
let token = '';
async function jsonApi(method, path, body) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Cookie = `music-token=${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(new URL('/music/api/v1' + path, origin), {
    method, headers, redirect: 'error', signal: AbortSignal.timeout(15000),
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!(res.headers.get('content-type') || '').includes('application/json')) {
    throw new Error(`非JSON响应，HTTP ${res.status}`);
  }
  const result = await res.json();
  if (!res.ok || ![0, 200].includes(result.code)) {
    throw new Error(`请求失败，HTTP ${res.status} / code ${result.code}`);
  }
  return result.data;
}
try {
  const login = await jsonApi('POST', '/user/password-login', {
    username,
    password: crypto.createHash('sha256').update(password, 'utf8').digest('hex'),
    deviceId: crypto.randomBytes(16).toString('hex')
  });
  token = login?.userToken;
  if (typeof token !== 'string' || !token) throw new Error('登录响应缺少token');
  const tracks = await jsonApi('GET', '/track/list?page=1&size=5');
  console.log({ total: tracks.total, returned: tracks.list.length });
} finally {
  if (token) {
    try { await jsonApi('POST', '/user/logout', {}); }
    finally { token = ''; }
  }
}
NODE
)
```

这是一次性脚本，deviceId每次新建；正式客户端应生成一次后持久化。生产接入还需凭据存储、会话更新、网络重试、二进制读取、取消请求和版本兼容等设计；不要对写请求自动无条件重试。

### 21.2 接入检查清单

1. 配置BASE、获取sys/config及initialization/state；不要假定配置字段跨版本固定。
2. SHA-256密码登录，读取JSON中的token，自行设置Cookie。
3. 区分HTTP错误、JSON业务错误、二进制与SPA HTML。
4. 所有列表分别处理分页；不要为search/suggest套用普通列表模型。
5. 用专用关联列表过滤，按服务端sort回显判断排序。
6. 优先取原始stream并检查Range；不支持的音频格式选择解码/转码策略。
7. 如启用HLS，按状态机管理心跳、退出和410恢复；不依赖固定失效秒数。
8. 封面上传与资源关联分开；FormData不做JSON序列化。
9. 将缺失字段、未知source/状态枚举、空库作为正常兼容场景。
10. 对写入功能分别验证权限、幂等、读回与恢复，不把code0当作业务效果保证；单独处理 HTTP400/404/410 等非 JSON 或空体错误。

<a id="limits"></a>
## 22. 限制与证据来源

### 22.1 仍未完整验证

- 管理员成功分支、跨账号资源隔离、用户禁用/授权分支。
- 写入生命周期、上传持久化、媒体库维护、真实任务控制。
- OAuth及首次初始化成功流程。
- 会话级转码、HLS回收、漫游：本文保留H/F，不标V。
- 多歌单分页、非空收藏/历史/流派/任务、CUE、无歌词曲目等数据场景。
- 后端隐藏接口、其它方法/前缀、WebSocket/SSE、代理差异与全部参数组合。

所测实例的库规模与命中数只是测试背景，不是接口上限或兼容性基线。有限成功样本不能证明所有字段必填、所有非法值被拒或所有数据集的分页行为。

### 22.2 资料优先级

| 资料 | 用途 |
|---|---|
| 本文 | 自包含的当前接口说明；消除历史修订叙述的冲突 |
| 公开 Web 前端 | 路径、请求参数、错误枚举与客户端签名算法的来源 |
| 授权实例的一次只读复核 | 成功/错误/权限/会话分支的验证；详细证据不随本文发布 |
| 历史观察 | 仅用于标 H/F 的未复现线索，不优先于本文的明确限定 |

本文不附带请求级证据、账号、实例地址、前端常量字面量或私有脚本。历史脚本可能包含凭据、Cookie 持久化和不可完整回滚的操作；示例脱敏**不代表任何本地目录已经完成脱敏**。共享项目之前应单独审计文件、临时产物与版本历史。
