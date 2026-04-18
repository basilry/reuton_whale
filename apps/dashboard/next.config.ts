import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async redirects() {
    return [
      {
        source: "/insights",
        destination: "/",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
