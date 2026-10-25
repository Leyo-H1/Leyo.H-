import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standard output supports both npm run dev and npm start for local review.
  trailingSlash: true,
  devIndicators: false,
};

export default nextConfig;
