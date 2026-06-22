# 仓库协作规则

## 项目概览

Jedi 是一个 Web/Electron 风格的 AI 智能体桌面应用。Web 运行时由 `server/` 中的 Express + Socket.io 后端和 `src/renderer/` 中的 Vue 3 + Vite 渲染端组成。桌面端和智能体相关的共享逻辑主要位于 `src/main/`。

## 关键目录

- `server/`：Express Web 服务、API 路由、上传处理、Web 鉴权和会话集成。
- `src/main/`：核心应用服务、管理器、数据库、IPC handlers、插件运行时、智能体会话逻辑。
- `src/renderer/`：Vue 渲染端应用，多页面 Vite 入口，共享组件、组合式函数、样式、主题和语言文件。
- `tests/`：Vitest 单元测试和集成测试。
- `e2e/`：Playwright 端到端测试；如果目录不存在，按任务需要再补充。
- `scripts/`：报告生成、微信采集、打包、数据维护等运维脚本。
- `skills/` 和 `qingbo-wechat-search/`：内置技能及技能相关资源。

## 常用命令

- 安装依赖：`npm install`
- 启动 Web 开发环境：`npm run dev`
- 仅启动 Vite：`npm run dev:vite`
- 仅启动后端服务：`npm run dev:server`
- 构建 Web 资源：`npm run build`
- 运行测试：`npm test`
- 运行覆盖率：`npm run test:coverage`
- 运行 Playwright E2E：`npm run test:e2e`
- 安装或运行环境变化后重建 SQLite 原生模块：`npm run rebuild:sqlite`

Vite 开发服务固定使用 `5173` 端口；后端服务默认使用 `3456` 端口。

## 测试说明

Vitest 使用 `vitest.config.mjs`，测试环境为 Node，并通过 `tests/setup.js` 做全局初始化。测试文件匹配 `tests/**/*.test.js` 和 `tests/**/*.spec.js`。默认覆盖率不统计渲染端源码，核心覆盖范围集中在 `src/main/**/*.js`。

Playwright 配置位于 `playwright.config.js`，测试目录为 `e2e/`，单 worker 串行执行，并保留失败时的截图、视频或报告产物。

## 编码约定

- 后端和 `src/main/` 中已有 `require` 风格的模块，优先继续使用 CommonJS。
- `src/renderer/` 中优先遵循 ES modules 和 Vue 单文件组件写法。
- 路径别名保持与 Vite/Vitest 配置一致：`@`、`@components`、`@composables`、`@utils`、`@styles`、`@theme`、`@locales`、`@api`，测试中还可使用 `@main`。
- 修改代码前先参考文件局部风格，不做无关重构或大范围格式化。
- 注释只解释不明显的行为或关键上下文，避免复述代码本身。

## 运行时数据

Web 服务通过 `server/user-data-path.js` 解析用户数据目录，并在启动时打印当前 `userDataPath`。除非任务明确要求，不要提交生成的运行时数据、本地数据库、日志、覆盖率报告、Playwright 报告或构建产物。

## Git 约定

当前远端主分支是 `origin/master`；除非任务另有说明，本地开发通常基于 `master`。较大改动前先执行 `git status --short --branch`，并保留用户已有的无关改动。

## 输出语言

默认使用中文与用户沟通，包括进度说明、结果总结和排错解释。只有在用户明确要求英文，或需要保留代码、命令、报错原文时，才使用英文。
