# 实用工具 · 汇率 / 二维码 / JSON / Unix 时间

基于 Tauri 2 + Rust + React + TypeScript 的 Windows 桌面应用。按 `plan` 中的汇率界面、二维码上传/结果/提示和绿色选项卡参考图实现。

## 使用

- **汇率换算**：保留双向金额输入、币种交换、刷新汇率及 API 配置；初始汇率是示例数据，点击刷新才联网。
- **软件更新**：桌面程序启动时检查 `kafuluote/utools` 的 GitHub 最新正式发布版，也可点击“检查更新”。发现更高版本后显示更新说明和下载提示；优先打开匹配版本的 Windows x64 安装包，其次便携 ZIP，没有匹配附件时打开发布页面。启动检查失败时保持安静，手动检查显示网络或限流错误。下载由浏览器完成，安装需手动执行。
- **本地二维码**：点击上传区选择图片，可多选；支持拖放图片、复制截图后按 `Ctrl+V` 或点击“粘贴图片”。每张图片可识别多个标准二维码。
- **Unix 时间转换**：参考 `plan/unix时间转换`，显示实时当前时间戳，可选择秒/毫秒；支持时间戳转北京时间、逐项输入年月日时分秒转时间戳、14 位 `YYYYMMDDHHMMSS` 快速转换，以及每项结果复制。所有转换使用所选单位，北京时间固定 UTC+8，不受电脑时区影响；支持 0、负数和 2038 年之后的时间戳。毫秒转日期保留三位毫秒，日期输入精度为秒；无效日期、闰年和范围均校验，支持北京时间 0001–9999 年。切换选项卡保留输入与结果，隐藏时停止实时计时，返回后更新当前时间。全部本地计算，无网络请求。
- **JSON 解析器**：参考 `plan/json解析器`，左侧输入、右侧实时校验与高亮显示。支持格式化（`Ctrl+Enter`）、压缩、行号、节点折叠/展开、点击值编辑、保留转义、浅色/深色主题及全屏编辑；可导入 UTF-8 JSON 文件、复制完整结果、导出 `.json`。长整数、数值原文和重复键均保留。输入最多 100 万字符 / 10 万节点 / 256 层，文件最多 3 MB；结果最多显示 3000 行，复制和导出包含完整内容（桌面端最多 5 MB）。JSON 在前端本地解析，不上传、不保存内容历史；切换选项卡保留本次输入。
- 解码结果可直接选中、逐项复制或导出 UTF-8 文本；“继续解码”回到上传区。切换选项卡保留输入和本次解码结果。关闭后再次启动，自动恢复上次访问的选项卡；首次启动默认显示“汇率换算”。
- 图片只在 Rust 后端本地解析，无上传、无自动跳转、无持久化解码历史；二维码页面不调用汇率接口。

支持 PNG、JPG、WebP、BMP、GIF、TIFF、ICO；GIF/TIFF 读取首帧或首张。每次 1–32 张，单张不超过 20 MB / 1600 万像素 / 单边 8192 像素。透明背景会合成白底，未识别时尝试反色。文本优先按 UTF-8 解码，再尝试 GB18030（标记为推测）；二进制载荷以 HEX 展示。小程序码等平台专用码、严重模糊或遮挡图片可能无法解码。

## 直接运行

打包后双击 `release/portable/exchange-tools.exe`，或解压 `release/exchange-tools-0.5.0-windows-x64-portable.zip` 后运行。不需要 Node.js、Rust 或开发服务器。运行机器需有 Microsoft Edge WebView2 Runtime；安装包会在缺失时安装该运行时。

旧版 `release/exchange-tools-0.1.0-windows-x64-portable.zip` 保留。原汇率计算逻辑和 API 配置仍在 `src/main.tsx`、`src/conversion.ts`。

## 开发与验证

```powershell
npm install
npm run tauri dev
npm run build
npm test
cargo test --manifest-path src-tauri/Cargo.toml --lib --release
```

`npm run dev` 只启动前端预览（固定 1420 端口）；本地文件、剪贴板和二维码解码需要 Tauri 桌面环境。二维码相关命令在后台工作线程执行，错误按图片反馈，多图中某张失败不会丢失其他图片的成功结果。

Rust 测试覆盖 Unicode 与空白保留、所有支持格式、旋转、反色、透明背景、同图多码（包括相同内容）、空白图片、损坏文件、大小限制、GB18030 和二进制载荷。原双向换算测试继续保留。

## Windows 打包

安装 Rust、Visual Studio C++ Build Tools 和 WebView2 后：

```powershell
npm run package:windows
```

生成可直接运行的便携 EXE、便携 ZIP 和中文 NSIS 安装包：

- `release/portable/exchange-tools.exe`
- `release/exchange-tools-0.5.0-windows-x64-portable.zip`
- `release/exchange-tools-0.5.0-windows-x64-setup.exe`

也可以直接运行 `npm run tauri build`，原始产物位于 `src-tauri/target/release/` 与 `src-tauri/target/release/bundle/nsis/`。

## Git 与版本发布

源码仓库：`git@github.com:kafuluote/utools.git`，主分支 `main`。
`.gitignore` 排除依赖、前端构建、Rust 编译、Tauri 自动生成 schema、`release/` 打包文件和本地环境配置；保留 npm/Cargo 锁文件、图标、测试样例和打包脚本。

发布前同步修改 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml` 和 `src-tauri/tauri.conf.json` 的版本号，运行验证与 Windows 打包。在 GitHub 的 Releases 中创建正式发布版，标签使用 `v0.5.0` 这样的语义版本，并上传 `release/` 中的安装包和便携 ZIP。构建文件作为 Release 附件上传，不提交到 Git。草稿和预发布版本不提示更新；尚无正式发布版时，手动检查会显示相应提示。
