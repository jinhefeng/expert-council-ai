import type { Metadata } from "next";
import "./globals.css";
import { initWSRelayServer } from "@/lib/ws-relay-server";

// 启动本地小龙虾 WebSocket 转发网关
initWSRelayServer();

export const metadata: Metadata = {
  title: "Expert Council AI",
  description: "AI experts discuss and evaluate solutions.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
