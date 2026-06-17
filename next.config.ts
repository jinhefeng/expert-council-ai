import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 排除打包 ws 库，使其在 Node.js 原生环境中加载，避免 Webpack 伪装 bufferutil 空模块导致崩溃
  serverExternalPackages: ["ws"]
};

export default nextConfig;
