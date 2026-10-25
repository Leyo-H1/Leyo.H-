# Leyo.H个人站

视频摄影作品集，当前发布版本：**10.26版本1**。仅上线白色版。

## 本地开发

使用 Node.js 24：

```sh
npm ci
npm run dev
```

首页：`http://localhost:3000/`。分类页共41部作品，媒体和音效位于 `public/portfolio/`。

## 检查

```sh
npm run check
node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/tests/*.test.mjs
```

## 部署

使用 GitHub + Vercel，导入仓库后使用根目录与 Next.js 预设。`vercel.json` 明确使用 npm 锁文件安装和现有构建命令。无需环境变量。

本地版本备份、缓存与研究截图不上传GitHub；网站运行素材随仓库一起部署。
