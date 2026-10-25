import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "影像作品集",
  description: "视频摄影作品集，包含茶饮烘焙、社媒物料、餐饮美食、市场活动、人物记录与个人创作。",
  icons: { icon: "/portfolio/icon.svg" },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
