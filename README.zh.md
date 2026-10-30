# dsh-element-source

**给 DeepSeek Harness 内置浏览器用的点击定位源码插件。**

在 DSH 桌面端的「内置浏览器」里打开你的前端 dev 页面，从浏览器自己的工具栏开启拾取，
再点击目标元素右下角的 **「添加到对话」** 气泡。元素对应的源码文件（连同行号）会以
**文件引用 chip** 的形式进入当前会话输入框；点击这个 chip 会在内置预览里**直接滚动到对应行**。
默认不会发送任何消息。

<p align="center">
  <img src="https://raw.githubusercontent.com/GULI-lab/DSH-element-source/main/assets/element-source.png" alt="在 DSH 内置浏览器里拾取元素，源码以文件引用 chip 进入聊天" width="900" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/DSH-built--in%20browser-blue" alt="DSH 内置浏览器" />
  <img src="https://img.shields.io/badge/platform-desktop%20app-lightgrey" alt="桌面端" />
  <img src="https://img.shields.io/npm/v/dsh-element-source" alt="npm 版本" />
  <img src="https://img.shields.io/github/license/GULI-lab/DSH-element-source" alt="开源协议" />
</p>

[English](README.md) | 中文

## 0.2.0 —— 围绕内置浏览器重建

这是一次有意为之的产品面重置：**插件只围绕 DeepSeek Harness 内置浏览器工作，不做别的。**

- **只支持内置浏览器。** 旧的「本地预览」Tab、右侧停靠侧边栏、iframe 预览和预览代理全部删除；
  请使用 DSH 桌面端自带的内置浏览器。
- **不再兼容 dsh-better-sidebar。** 与它的集成、侧边栏「本地预览」Tab 和兜底侧边栏都已移除；
  两者同时安装不再是受支持配置。如果你只是为了本插件才装 dsh-better-sidebar，可以卸载它。
- **浏览器工具栏里只多一个图标。** 在开发页面上，插件把「选择元素」图标追加为
  **浏览器工具栏的最后一项**（在「外部打开 ↗」右侧），地址栏自动让位；没有插件的地址栏、
  标签页或侧边栏。页面一旦不是开发页面，图标会被移除。
- **拾取默认开启，页面受保护。** 拾取模式下普通页面点击和右键菜单都会被拦截
  （不导航、不切主题、不提交表单），只有「添加到对话」气泡执行定位——
  你本想选中元素的那一次点击，绝不会变成对页面的操作。
- **定位结果变成文件引用 chip。** 当前会话输入框会收到「文件 + 行号」的 chip；
  点击 chip 能在内置预览里直接滚到那一行。插件永远不会替你发送消息。
- **安装到 desktop profile。** 内置浏览器在桌面端里，所以一键安装脚本默认使用 `desktop` profile。

**为什么移除旧预览？** 内置浏览器已经提供地址栏、标签页、历史、Cookie 和 Electron 会话；
再造一套 iframe/代理只是重复，还会和 dsh-better-sidebar 抢同一个入口。
插件现在只做两件事：把选择器加到浏览器工具栏，把定位结果交给当前聊天输入框。

## 前置条件

| 条件 | 说明 |
| --- | --- |
| DSH | **DSH 桌面端 0.2.x**，且内置浏览器可用。纯网页的 `dsh web` 页面没有 Electron `<webview>`，不会出现选择图标。 |
| 前端 | 正在运行的 dev server（Vite / webpack 等），页面必须是 **开发构建**。 |
| 工作区 | 当前会话的工作目录必须是前端项目根目录；解析结果落在工作区外会被拒绝。 |
| 框架 | React、Vue 2/3、Svelte、Angular、code-inspector，或通用文本搜索兜底。 |

生产构建没有运行期源码元数据，因此选择图标只在开发页面出现。

## 安装

一条命令安装到 **desktop** profile：

macOS / Linux：

```sh
curl -fsSL https://raw.githubusercontent.com/GULI-lab/DSH-element-source/main/scripts/install.sh | DSH_PROFILE=desktop bash
```

Windows PowerShell 5.1+ / pwsh：

```powershell
$env:DSH_PROFILE = "desktop"
irm https://raw.githubusercontent.com/GULI-lab/DSH-element-source/main/scripts/install.ps1 | iex
```

手动安装：

```sh
cd ~/.dsh/profiles/desktop
npx -y --package @deepseek-ai/dsh dsh plugin --profile desktop add dsh-element-source
```

如果你的桌面端使用别的 profile 名称，把 `desktop` 换成实际名称。
安装完成后重启 DSH，或重新加载桌面端窗口，让浏览器端代码生效。

本地源码试用：

```sh
git clone https://github.com/GULI-lab/DSH-element-source
cd ~/.dsh/profiles/desktop
npx -y --package @deepseek-ai/dsh dsh plugin --profile desktop add link:/path/to/DSH-element-source
```

## 使用

1. 启动前端 dev server，例如 `http://localhost:3000`。
2. 打开 **DSH 内置浏览器**，访问这个地址。
3. 如果页面是开发构建，浏览器工具栏**最后一项**（↗ 右侧）会出现 **选择元素图标**；
   拾取开启时图标高亮，默认**已开启**。
4. 鼠标悬停目标元素：出现虚线轮廓，以及元素右下角（元素外侧）的
   **「添加到对话」** 气泡——不会盖住元素内容。
5. **点气泡，不要点页面。** 拾取开启时页面点击会被拦截，只有气泡会执行定位。
   定位结果会以文件引用 chip 的形式进入当前会话输入框，例如 `LoginPage.tsx:90`。
6. 在输入框补充你的修改需求并发送。助手会读取文件、展示定位到的代码，然后等你提出修改。
7. 点击输入框里的 chip，可在内置文件预览中**直接滚到对应行**。

按 `Esc` 或点工具栏图标可关闭拾取，页面点击恢复正常；图标颜色和提示文字会反映当前状态。

> 拾取默认开启，这是为了避免「想定位却点成了页面操作」。代价是普通点击被拦截；
> 需要正常操作页面时，先按 `Esc` 或点工具栏图标关闭。

### 输入框里收到什么

- 主路径：一个 **文件引用 chip**，例如 `LoginPage.tsx:90`，与内置 `@` 文件菜单使用同一套
  `@path` 引用语义；序列化后是 `@path:90`，模型能拿到具体行号；chip 可点击，
  点击后在内置预览里跳到对应行。
- 兜底：如果输入框的引用 API 不可用，则追加纯文本 `[元素定位] src/App.vue:12`。
- 默认不发送。只有把 `autoSteer` 设为 `true`，拾取成功后才会额外唤醒当前会话助手，
  并发送一条双语定位消息。

## 配置

在 profile 的 `cordis.patch.yml` 中覆盖插件行：

```yaml
- id: element-source
  config:
    autoSteer: false        # 拾取后是否唤醒助手（默认 false：只填输入框草稿）
    mappings:               # 源码路径前缀映射（monorepo / node_modules 重定向）
      - find: '@app/ui/src'
        replacement: 'D:/workspace/my-app/packages/ui/src'
    sessionId: 'fixed-session'  # 固定会话（一般不需要）
```

- `autoSteer`：默认 `false`。设为 `true` 时，定位成功后会同时唤醒当前会话助手，
  但不会替你发送输入框里的草稿。
- `mappings`：路径前缀重写，在规范化之前应用；最终路径仍必须落在会话工作区内。
- `sessionId`：把解析固定到某个会话；默认使用当前会话。

`proxyHosts` 已移除；不再有预览代理。

## 工作原理

```text
DSH 桌面端
└─ 内置浏览器 <webview>
   ├─ dev 页面：在 dom-ready / did-navigate / did-navigate-in-page 时注入探针
   │    悬停 → 「添加到对话」气泡 → 拾取结果写入 window.__dshEsPicks
   ├─ 工具栏：把选择元素图标追加为最后一项（仅 dev 页面；
   │           页面变为非开发页面时自动移除）
   └─ 客户端 overlay 每 300ms 轮询 webview
        拾取 → POST /dsh-element-source/api/pick   （公开、只写的队列）
        host → GET  /dsh-element-source/api/pending （信任围栏 + 真实会话）
                 在会话 cwd 内解析 → file[:line[:column]]
        client → 当前会话输入框中的文件引用 chip
                 chip 点击 → 内置文件预览滚动到对应行
```

没有页面代理，也没有第二套 UI。探针直接注入 Electron `<webview>`，页面保留真实 origin
和自己的网络行为。解析有预算（2.5 秒搜索上限、60 秒结果缓存），大 monorepo 里拾取也不会
卡住输入框。

## 框架支持

| 框架 | 文件 | 行 | 说明 |
| --- | --- | --- | --- |
| React（dev 构建） | 精确 | 精确 | 读取 fiber 上的 JSX `__source`（@vitejs/plugin-react / CRA 注入） |
| Vue 2 / Vue 3（dev 构建） | 精确 | 近似 | `__file` 定位文件；行号由模板文本匹配 |
| Svelte（dev 构建） | 精确 | 精确 | 读取 dev 模式的 `__svelte_meta` |
| Angular | 尽力 | 尽力 | 识别 `ng-reflect-*` 标记，再走组件/文本搜索 |
| 任意框架 + code-inspector-plugin | 精确 | 精确 | 直接读取注入的 `data-insp-*` DOM 属性 |
| 其他 / 未知框架 | 可以 | 近似 | 在会话工作区内按文本 / 类名 / id 全文搜索 |

## 可选：在内置浏览器之外调试

内置浏览器是受支持的主路径，也只有它会显示工具栏图标。如果你必须在普通浏览器里检查页面，
可以自行加载探针；拾取仍会通过同一队列进入 DSH 桌面端。

方式 A：script 标签：

```html
<script src="http://127.0.0.1:3080/dsh-element-source/inject.js"></script>
```

方式 B：Vite 插件：

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { dshElementSourcePlugin } from 'dsh-element-source/vite-plugin'

export default defineConfig({
  plugins: [dshElementSourcePlugin(), /* 你的其他插件 */],
})
```

Vite 插件只在 dev 注入（`apply: 'serve'`），生产构建不受影响。如果 DSH 不在默认地址：

```ts
dshElementSourcePlugin({ dshOrigin: 'http://192.168.1.5:3080' })
```

这种模式没有工具栏图标；探针在开发页面自动开启并显示「添加到对话」气泡。
DSH 桌面端必须保持运行，拾取才会被当前会话取走。

## 安全

- `POST /dsh-element-source/api/pick` 是公开且允许跨域的，因为页面运行在隔离的 webview 里；
  它只写不读，队列有界（32 条），不返回拾取数据。
- `GET /dsh-element-source/api/pending` 与 DSH `/api` 网关使用同一套浏览器信任围栏，
  并要求真实会话。
- 解析使用会话的权威 `cwd`；落在工作区外的文件会被拒绝。`mappings` 只能重写前缀，
  不能逃出工作区。
- `inject.js` 是公开的只读探针代码，只收集元素元数据和可选的框架源码元数据，
  不访问 DSH 数据。
- 不再有预览代理，也不再任意抓取 URL，旧代理的 origin 取舍问题一并消失。

## 从 0.1.x 迁移

| 旧行为 | 新行为 |
| --- | --- |
| 独立「本地预览」Tab / 右侧边栏 | 只使用 DSH 内置浏览器 |
| dsh-better-sidebar 集成 | 已移除，不再支持 |
| `GET /dsh-element-source/preview` 代理 | 已移除（404） |
| `proxyHosts` 配置 | 已移除 |
| 安装到 `web` profile | 安装到 `desktop` profile |
| 拾取后向输入框插入纯文本 | 文件引用 chip（+ 纯文本兜底） |

`autoSteer`、`mappings`、`sessionId` 仍然有效。
0.1.x 安装可能还留下 dsh-better-sidebar，不再需要时请单独卸载。

## 常见问题

| 现象 | 检查项 |
| --- | --- |
| 工具栏没有选择图标 | 使用 DSH 桌面端的内置浏览器，而不是普通浏览器里的 `dsh web` 页面；页面必须是开发构建；确认插件装在 `desktop` profile，然后重启应用。 |
| 有图标，但悬停没有「添加到对话」气泡 | 探针可能没激活：页面可能是生产构建，或页面在插件之前加载。刷新页面再悬停。 |
| 拾取成功，但输入框没有结果 | 当前会话需要工作目录。把会话工作区切到项目根目录，并确认 DSH 应用在运行。 |
| 提示定位结果在工作区外 | 解析出的文件不在会话 cwd 内。把会话工作目录切到项目根目录。 |
| 点 chip 打开预览停在顶部，没跳到行 | 行号按本次运行插入的 chip 记录；App 重启后恢复的旧 chip 会退化为从顶部打开，重新拾取一次即可恢复跳行。 |
| dsh-better-sidebar 里还显示旧的「本地预览」Tab | 那是 0.1.x 的旧集成。安装新版本并重启；如果 better-sidebar 只为这个插件安装，可以卸载。 |
| `autoSteer` 没有唤醒助手 | 会话必须有在线 agent；单纯拾取不会发送消息。 |

## 已知限制

- **仅桌面端。** 纯网页的 `dsh web` 没有 Electron `<webview>` 页面，工具栏图标和探针都不会出现。
- **仅开发页面。** 生产构建没有运行期源码元数据，图标会隐藏并从该页面移除。
- **工具栏 DOM 是内置实现。** 选择图标追加在内置浏览器工具栏上；未来 DSH UI 重构可能需要插件同步更新。
- **工作区限制。** 如果会话工作区不是项目根目录，定位会落到错误目录或被拒绝；请先切换会话工作区。
- **Vue 行号是启发式。** 纯图标 / 无文本元素可能退化为文件级或组件定义行。
- **Angular / Svelte 需要 dev 构建。** 生产构建没有可用源码元数据。
- **autoSteer 需要会话助手在线。** 它只唤醒已有 agent，不会替你发送输入框草稿。
- **不支持 dsh-better-sidebar。** 旧侧边栏入口已不存在，也没有兜底侧边栏。

## 开发

```sh
pnpm install
pnpm typecheck     # tsc --noEmit
pnpm test          # vitest：draft / probes / protocol / resolve / steer
pnpm build         # tsc 类型 + tsdown 产物
```

产物：`lib/index.js`（host）、`lib/client.js`（浏览器端）、`lib/inject.js`（页面探针）、
`lib/vite-plugin.js`（可选 Vite 注入）。

## 参与贡献

欢迎贡献！开发环境搭建与提交流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。
发现 bug 或有新想法，欢迎开 [issue](https://github.com/GULI-lab/DSH-element-source/issues)。

## License

[MIT](LICENSE) © dsh-element-source contributors
