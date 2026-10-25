import sampleProjects from "./portfolio-projects.json";

export const categories = ["茶饮烘焙", "社媒物料", "餐饮美食", "市场活动", "人物记录", "随机意识"] as const;
export type Category = "全部" | typeof categories[number];
export type PortfolioProject = {
  slug: string;
  title: string;
  titleLines: string[];
  category: string;
  order: number;
  description: string;
  role: string;
  year: number;
  poster: string;
  video: string;
  fullVideo: string;
  width: number;
  height: number;
  duration: number;
  coverTime: number;
};

export const projects: PortfolioProject[] = sampleProjects;
export const portfolioCopy = {
  name: "影像作品集",
  subtitle: "视频摄影 · 作品选集",
  about: "作品涵盖茶饮烘焙、社媒物料、餐饮美食、市场活动、人物记录与个人创作。",
};

export function formatDuration(seconds: number) {
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60).toString().padStart(2, "0")}:${(total % 60).toString().padStart(2, "0")}`;
}
