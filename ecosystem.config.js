module.exports = {
  apps: [
    {
      name: "expert-council-ai",
      // 直接指向 Next.js 生产启动脚本，比 pm2 start npm 启动更高效稳定
      script: "node_modules/next/dist/bin/next",
      args: "start",
      instances: 1, // 关键说明：由于 WebSocket 网关（ws-relay-server）在进程内存中保存连接句柄，为了防止多实例间的状态串线与连接隔离失败，建议使用单实例部署
      exec_mode: "fork",
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        // 如果有特定的 WASM 或构建缓存参数，可在生产环境一并注入
        NEXT_TEST_WASM: "1",
        NEXT_TEST_WASM_DIR: "./node_modules/@next/swc-wasm-nodejs"
      },
      error_file: "./logs/pm2-error.log",
      out_file: "./logs/pm2-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z"
    }
  ]
};
