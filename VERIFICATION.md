# 只读验证记录

> 本文件记录对**已授权测试实例**的复核结果，是历史证据摘要。结果明细由脚本在本地生成，不纳入版本库。
>
> 验证结论是时点记录，不代表跨版本兼容性承诺。接口定义与证据标签见 [`FnMusicAPI.md`](FnMusicAPI.md)，复现方法见 [`tools/verify-readonly.mjs`](tools/verify-readonly.mjs) 文件头部的用法说明。

验证对象为用户在会话中提供并明确授权的测试实例；地址、账号与密码**不写入仓库文件**。脚本只从环境变量读取，令牌仅保留在内存中，结束后主动登出。前两轮为只读复核（第 1–4 节），后续一轮为管理面与写生命周期复核（第 5 节）。

## 1. 环境与范围

| 项目 | 结果 |
|---|---|
| 登录页 | HTTP 200，`text/html`，SPA 入口正常 |
| 服务端版本 | 覆盖升级前后的两个构建（同一 mediasrv 版本）；具体版本号属实例指纹，不在此公开 |
| 登录 | `POST /user/password-login` 成功；返回 `userToken` 与 `user`（`role=member`），无 `Set-Cookie` |
| 会话 | `GET /user/me` 成功；登出后原 token 被拒，符合 HTTP 401 / `99999` |
| 验证方式 | 仅只读请求、错误分支、成员权限拒绝、会话失效与一次 100 字节音频 Range |
| 结果 | 除 1 项信息性观察外全部通过，0 项失败、0 项跳过 |
| 覆盖 | 文档中的主要接口族与错误分支；含列表、详情、搜索、封面、歌词、分页排序、错误码、管理接口拒绝等 |

验证明细由脚本在本地产出（默认 `readonly-results.json`），不纳入版本库。结果只记录 HTTP 状态、业务码、字段形状、响应头与脱敏断言，不记录密码、令牌、Cookie、真实 GUID、coverId、服务器目录或媒体正文；样本规模数字同样不在此公开，避免构成实例指纹。

## 2. 与文档的符合情况

文档记录的主体协议与接口定义得到复现：

- `/music/api/v1` 基址、JSON `{code,msg,data}` 信封、`music-token` Cookie、SHA-256 密码摘要与 `deviceId` 登录形态；
- `sys/config`、`initialization/state`、`sys/info`、`user/me`、`user/logout`；
- 曲目 / 专辑 / 艺术家 / 流派 / 歌单 / 收藏 / 播放历史 / 共享库 / 任务列表，以及对应详情与关联列表；
- 搜索、suggest、歌词、封面读取、音频流 Range、未登录 401、成员访问管理接口返回 `100003`；
- 常规列表的 `page` / `size` / `sort` 行为，以及非法 sort 回退默认值的回显；
- 前端统一 fetch 客户端通过 HTTP header 发送 `authx`；本次所测只读请求不带该头或携带伪造值均未被拒绝，但不推断所有路由、写入请求或未来版本都不校验。

## 3. 本次发现并已纳入文档的修正

1. **封面错误分支**：首次复核时，缺参数 / 空值 / 裸 GUID / 非前缀字符串为 HTTP 400 空体，而带已知前缀但不存在的 coverId 返回 **HTTP 404 `text/plain` 短正文**；升级后复测所有非法形态又统一回到 HTTP 400 空体。客户端应按「非 JSON 错误」兼容处理，不能强制解析 JSON，也不应把 400 或 404 写成唯一分支。
2. **数据状态**：本次实例的收藏、播放历史与歌单样本不为空，因此不能沿用「最新账号为空」的叙述；但这些只是样本状态，不是接口上限或通用保证。
3. **搜索分页**：本次关键字样本只有 1 条命中，`page=1` / `page=2` 相同，只能标记为「样本不足、未证实分页生效」，不能作为忽略分页参数的证明。
4. **HLS**：未建立转码会话的合法格式 GUID 返回 HTTP 200 / `100005` JSON 错误；本次没有建立、保活或退出会话，因此仍不把会话生命周期标为最新实测成功。
5. **SPA 兜底**：不存在的 API 路径返回 HTTP 200 `text/html`，应按内容类型识别，不能因状态码 200 就当成 API 成功。

更完整的差异与未验证项清单见 [`FnMusicAPI.md` 第 1 章](FnMusicAPI.md#scope)与[第 22 章](FnMusicAPI.md#limits)。

## 4. 升级后复测

服务端升级后在同一实例复测：只读套件全部用例结果与首次一致（除 1 项信息性观察外全部通过，0 失败），登录、会话、列表 / 详情 / 搜索 / 封面 / 歌词 / 播放历史 / 歌单与成员权限拒绝均正常。

- **新接口族**：`/folder-view/*` 共 5 条路由（`list`、`playable-tracks`、`add-to-playlist`、`delete`、`recover`），对应 `capabilities.folderView` 由 `false` 变为 `true`。目录整层一次返回、不分页；`delete` / `recover` 对成员返回 `100003`。
- **行为变化**：带真实前缀但不存在的 `coverId` 由首次复核的 `404 text/plain` 回到 `400` 空体，见上文第 1 条。
- **接口计数**：升级前后前端注册表唯一路径数与方法＋路径组合数一致；接口文档整理面另含 `sys/info`、`task/detail` 与 3 个直接资源 GET。

复测明细由脚本在本地产出，同样不纳入版本库。新增接口族已写入 [`FnMusicAPI.md` 第 15 章「文件夹视图」](FnMusicAPI.md#folder-view)。

## 5. 管理面与写生命周期复核

后续一轮授权复核在同版本另一实例上进行，除只读套件外，首次取得管理面与写操作的成功分支实测证据。写操作仅作用于该轮新建的**临时实体**（临时成员账号、临时歌单、临时收藏/播放历史记录、一次性转码会话与全新 deviceId 漫游），结束时全部删除/还原并复查无残留。

- **接口面**：从前端构建提取的注册表与文档整理面一致，无新增/缺失接口。
- **管理面读取**：`user/list`、`user/exists`、`settings/server`、`settings/user`、`app-center/authed-dir/list` 与 `sub/list` 均取得成功响应；User 模型补齐 `sharedLibraryAccess`（响应形态 `{mode,sharedLibraries[]}`）、`trimNasUserId`、`trimNasUsername`、`isBanned`、`bannedUntil`。
- **用户管理**：`user/create`（密码 SHA-256，成功响应 `data:null`，重名 120004）、`user/edit`、`user/unbanned`、`user/delete` 全链路实测，删除后复查无残留。
- **成员写生命周期**：歌单创建/改名/加歌/移歌/删除（detail 复查 100005）、`folder-view/add-to-playlist`、收藏添加/取消（`isFavorite` 读回一致）、播放历史上报与删除、歌词偏移修改与还原、转码会话（建立→播放列表→心跳→退出）、随机漫游三端点（队首 `roam-previous` 返回 `data:null`）。
- **authx**：按文档第 20 章算法构造的合法签名在全部写请求与 GET 上被接受；前端签名常量仍不随仓库公开。
- **`user/exists` 细节**：`username` 可选，缺参返回 code 0 / `{isExist:false}`。

## 6. 仍未完整验证

管理员/成员写接口中仍需专用环境或另获授权的部分：`settings/*` 更新、`shared-library` 写操作/扫描/重连、`track/metadata` 写、封面上传、`artist/genre create`、`search/index/rebuild`、`folder-view delete/recover`（真实数据）、`user/passwd-change`、`initialization/*`、`user/auth-login`。跨账号资源隔离、用户禁用/授权分支（`isBanned`/`bannedUntil` 非空样本）、OAuth 成功流程、CUE 分轨与错误密码限流行为仍未验证。完整清单见 [`FnMusicAPI.md` 第 22 章](FnMusicAPI.md#limits)。

所测实例的库规模与命中数只是测试背景，不是接口上限或兼容性基线；有限成功样本不能证明所有字段必填、所有非法值被拒或所有数据集的分页行为。
