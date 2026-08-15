# dsh-element-source

> 在 DSH 的 better-sidebar 侧边栏里点击页面 UI 元素，自动定位到它的 Vue / React / Svelte / Angular 源代码，并让聊天对话框展示这段代码——方便开发者微调前端页面。

<p align="center">
  <img src="https://img.shields.io/badge/dsh-plugin-better--sidebar-blue" alt="dsh plugin for better-sidebar" />
  <img src="https://img.shields.io/npm/v/dsh-element-source" alt="npm version" />
  <img src="https://img.shields.io/github/license/YOUR-NAME/dsh-element-source" alt="license" />
</p>

[English](README.md) | 中文

## 这是什么

开发者经常要在「页面上的某个按钮 / 某段文案」和「源代码里对应的那一行」之间来回找。这个插件把这一过程变成一次点击：

1. 在 better-sidebar 的「本地预览」Tab 里打开你的前端页面（dev server）；
2. 打开「拾取模式」，鼠标悬停高亮目标，**点击一下**；
3. 插件自动解析出对应的**源文件 + 行号**，并把一条「元素定位」消息注入聊天；
4. 助手自动用 `read` 工具读取该文件，在对话框里展示定位到的代码，等你提出修改需求。

不需要改动你的构建配置（除了让 dev 页面加载一个探针脚本），不需要装浏览器扩展，支持 Vue / React / Svelte / Angular 及任意其他框架（通用兜底）。

## 框架支持

| 框架 | 文件 | 行 | 说明 |
| --- | --- | --- | --- |
| React（dev 构建） | ✅ 精确 | ✅ 精确 | 读取 fiber 上的 JSX `__source`（`@vitejs/plugin-react` / CRA 自带，无需改构建） |
| Vue 2 / Vue 3（dev 构建） | ✅ 精确 | ~ 精确 | 读取 `__file` 定位文件；行号由模板文本匹配确定 |
| Svelte（dev 构建） | ✅ 精确 | ✅ 精确 | 读取 dev 模式注入的 `__svelte_meta` |
| Angular | ~ 尽力 | ~ 尽力 | 识别 `ng-reflect-*` 标记，走组件/文本搜索 |
| 任意框架 + 已装 code-inspector-plugin | ✅ 精确 | ✅ 精确 | 直接读取它注入的 `data-insp-*` DOM 属性 |
| 其他 / 未知框架 | ✅ | ~ | 按点击元素的文本 / 类名 / id 在会话工作区内全文搜索 |

## 工作原理

```
两种预览模式（Tab 内可切换）：
  代理模式（默认，免改项目）：GET /dsh-element-source/preview?url=…
      插件 host 取回 dev 页面 → 注入 <base href=dev地址> + 探针脚本 + 真实地址标记
      → 从 GUI 源返回（页面获得真实 origin，localStorage/登录态正常）
  直连模式：iframe 直接打开 dev 地址（页面保持自身源；需要页面里已有探针）

页面内探针（inject.js，IIFE、零依赖、可运行在沙箱 iframe 内）
  └─ 悬停高亮 → 点击 → 探针链（data-insp → React __source → Vue __file → Svelte → Angular → 通用）
     → postMessage（跨域可用）→ DSH 页面
better-sidebar「本地预览」Tab（本插件注册，可打开 localhost）
  └─ 收 postMessage → POST /dsh-element-source/api/resolve
DSH Host
  ├─ GET  /dsh-element-source/inject.js   （对外服务探针脚本）
  ├─ GET  /dsh-element-source/preview     （代理模式：取回页面 + 注入探针，仅限本机地址）
  ├─ POST /dsh-element-source/api/resolve （信任围栏保护）
  │     ├─ 路径规范化（webpack /src、Vite 绝对路径、Windows 盘符、可配置 mappings）
  │     ├─ 越界检查：定位结果必须落在会话 cwd 内
  │     └─ 文本 / 组件搜索兜底定位行号
  └─ ctx.agents.get(sessionId).steer(定位消息) → 助手 read 文件 → 聊天展示
```

### 为什么不在内置浏览器里做

better-sidebar 内置浏览器的地址栏**硬性拒绝 localhost / 127.x 本机地址**（防跨站探测本机服务的安全设计），而前端 dev server 恰恰跑在 localhost。因此本插件自带一个极简的「本地预览」Tab——只是一个能打开本机地址的 iframe + 地址栏，不做多标签 / 历史等浏览器功能。如果你要预览的是**非本机地址**（例如绑定了局域网 IP 的 dev server），内置浏览器同样可用——inject.js 通过 postMessage 回传，不受沙箱影响。

## 安装

**前置**：已装好 DSH（`dsh web` 可运行）与 [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar)（本插件的宿主）。

**macOS / Linux**（Windows 装了 Git Bash 或 WSL 也可）：

```sh
curl -fsSL https://raw.githubusercontent.com/YOUR-NAME/dsh-element-source/main/scripts/install.sh | bash
```

**Windows（PowerShell 5.1+ / pwsh）**：

```powershell
irm https://raw.githubusercontent.com/YOUR-NAME/dsh-element-source/main/scripts/install.ps1 | iex
```

手动安装（与 better-sidebar 一致）：

```sh
cd ~/.dsh/profiles/web
npx -y --package @deepseek-ai/dsh dsh plugin --profile web add dsh-element-source
```

装完**硬刷新浏览器**（Ctrl/Cmd+Shift+R）。

## 探针加载（仅直连模式需要）

**代理模式（默认）不需要改项目**——插件 host 自动注入探针。只有当你切换到**直连模式**（页面保持自身源，用于需要同源 API 的应用）时，才需要让 dev 页面自己加载探针，二选一：

**方式 A：手动加一行 script**。在你的 `index.html` 的 `<body>` 里加：

```html
<script src="http://127.0.0.1:3080/dsh-element-source/inject.js"></script>
```

（`3080` 换成你 DSH Web UI 的实际端口；也可以用局域网 IP 以便其他设备访问。）

**方式 B：Vite 插件自动注入**（Vue / React / Svelte / Angular 的 Vite 项目通用）：

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { dshElementSourcePlugin } from 'dsh-element-source/vite-plugin'

export default defineConfig({
  plugins: [dshElementSourcePlugin(), /* 你的其他插件 */],
})
```

插件只在 dev server（`apply: 'serve'`）注入，生产构建不受影响。如果你的 DSH 不在默认地址，传 `dshOrigin`：

```ts
dshElementSourcePlugin({ dshOrigin: 'http://192.168.1.5:3080' })
```

## 使用

1. 打开侧边栏，点「本地预览」Tab（**注意：这里打开的是你自己的开发页面，不是 DSH 界面本身**）；
2. **模式**：默认「代理模式（免改项目）」——插件自动转发页面并注入探针；如果你的应用需要同源 API（相对路径请求），切换到「直连模式」并按需加载探针；
3. 地址栏输入 `http://localhost:3000`（你的 dev server），回车；
4. 看**探针状态灯**变绿（代理模式自动就绪；直连模式需页面已加载探针）；
5. 勾选「选择模式」，在页面里移动鼠标——目标元素高亮；**点击**即**持久选中**（绿色框保留，再点一次或 Esc 取消）；
6. 右侧**检查器**面板：
   - **定位卡**：`文件:行号` + 定位方式，点「+ 添加到对话」把结果填入聊天输入框草稿（不会自动发送，你补充后自行发送）；
   - **组件树**：页面的 DOM 树（有界），点击节点可在页面中定位选中；
   - **设计 / CSS**：实时查看并**编辑选中元素的宽高、Padding、Margin、旋转**（回车/失焦应用，改的是内联样式）；CSS 页签展示内联样式与计算样式概览。

**两个调试辅助**：

- **探针状态灯**：控制行的小圆点——绿色「探针已就绪」表示探针已注入（点击会生效）；红色「页面未加载探针」表示没有（代理模式下不应出现；直连模式下去 index.html 加 script 行，或加 Vite 插件）。
- **沙箱开关**（仅直连模式）：默认开启（页面与 DSH 隔离）。直连页面需要 `localStorage` / 登录态时，**关掉沙箱**（页面将与 DSH 同源，带红色警告，仅用于你完全信任的页面）。代理模式下页面本就与 DSH 同源，无需开关。

## 配置

在 DSH 的 `cordis.patch.yml`（或 profile 的 patch）中按行覆盖：

```yaml
- id: element-source
  config:
    autoSteer: false        # 拾取后自动唤醒助手（默认 false：只填聊天输入框草稿）
    mappings:               # 源码路径前缀映射（monorepo / node_modules 重定向）
      - find: '@app/ui/src'
        replacement: 'D:/workspace/my-app/packages/ui/src'
    proxyHosts:             # 代理模式额外放行的 host（默认仅本机回环地址）
      - '192.168.1.10'
    sessionId: 'fixed-session'  # 固定会话（一般不需要）
```

## 安全

- `/dsh-element-source/api/resolve` 与 `/dsh-element-source/preview` 都走与 `/api` 网关相同的浏览器信任围栏（Host 头 + `trustedHosts`）；
- 解析出的文件路径**必须落在会话工作区（cwd）内**，否则拒绝；
- **代理模式**只允许本机回环地址（默认），且返回的页面与 DSH 同源——它只能承载你信任的本地 dev server；页面相对路径的 API 请求会打到 DSH 源（这是该模式的已知代价，需要同源 API 请用直连模式）；
- inject.js 是只读代码，只收集点击元素的元数据，不访问 DSH 数据；`inject.js` 路由对外公开（直连模式下 dev 页面要跨域加载它）；
- 直连模式的 iframe 默认沙箱（无 `allow-same-origin` / `allow-top-navigation`），与内置浏览器一致；
- `trust-fence.ts` 源自 DSH 的 BSD-3-Clause 实现（行为一致，独立拷贝，见文件头注释）。

## 与 code-inspector-plugin 的关系

[code-inspector](https://github.com/zh-lx/code-inspector) 是编译期方案：它作为 bundler 插件改写 JSX / SFC 编译，给元素注入 `data-insp-*` 属性，点击后用 `launch-ide` 打开本地 IDE。本插件是运行期方案：**不改构建**，读取 dev 运行时已有的元数据，目标是把定位结果交给 **DSH 聊天与侧边栏编辑器**而不是外部 IDE。两者互补——如果你已经装了 code-inspector-plugin，本插件会直接读取它注入的 `data-insp-*` 属性，获得全框架的精确行号，零额外成本。

## 开发

```sh
pnpm install
pnpm typecheck     # tsc --noEmit
pnpm test          # vitest（resolve / probes / steer / protocol）
pnpm build         # tsc 类型 + tsdown 双端产物（lib/index.js、lib/client.js、lib/inject.js、lib/vite-plugin.js）
```

产物：`lib/index.js`（host）、`lib/client.js`（浏览器端，`window.__ModuleLoader__.load` 模块表格式）、`lib/inject.js`（页面探针，经典 `<script>`，零依赖）、`lib/vite-plugin.js`（Vite 注入插件）。

## 已知限制

- 本地预览 Tab 面向**你自己的开发页面**：把 DSH 界面本身（如 `http://127.0.0.1:3080`）放进沙箱 iframe 不会渲染——GUI 无法在 opaque origin 下启动（localStorage 抛错、跨域拉取 bundle 被拦），这不是本插件的 bug；
- **代理模式**下页面从 DSH 源加载：相对路径的 API 请求会打到 DSH 源而非 dev server（需要同源数据接口的应用请用直连模式）；页面自带严格 CSP（如 `script-src 'self'`）的极少数应用可能拦掉注入的探针；
- Vue 的行号依赖模板文本匹配：纯图标 / 无文本元素会退化为「只定位文件」或组件定义行；
- Angular / Svelte 生产构建不带运行期源码信息，需 dev 构建；
- 直连模式的探针需要 dev 页面加载（手动一行或 Vite 插件）；这是跨域 iframe 无法从父页面读取 DOM 的同源策略决定的，任何 iframe 方案都绕不开；
- 直连模式沙箱开启时页面为 opaque origin，`localStorage` / 登录态受限；需要时请关掉沙箱（见「使用」）；
- 「在编辑器打开」依赖 better-sidebar 的 `editor` Tab 存在。

## License

[MIT](LICENSE)
