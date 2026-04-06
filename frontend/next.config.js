const CopyPlugin = require('copy-webpack-plugin');
const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: __dirname,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        pathname: '/**',
      },
    ],
  },
  webpack: (config, { isServer }) => {
    config.experiments = { ...config.experiments, asyncWebAssembly: true };
    config.module.rules.push({
      test: /\.wasm$/,
      type: 'asset/resource',
    });
    if (!isServer) {
      config.plugins.push(
        new CopyPlugin({
          patterns: [
            {
              from: path.resolve(__dirname, 'node_modules/web-ifc/web-ifc.wasm'),
              to: path.resolve(__dirname, 'public/web-ifc.wasm'),
            },
          ],
        }),
      );
    }
    return config;
  },
  /**
   * When the browser uses same-origin API URLs (`/api/v1/...`, production default if
   * NEXT_PUBLIC_BACKEND_URL is unset), Next.js must proxy to the NestJS host.
   * Set BACKEND_PROXY_TARGET (or INTERNAL_API_URL) on the frontend host, e.g.:
   *   http://localhost:3000  or  https://your-api.onrender.com
   * Do not include /api/v1 — it is appended automatically.
   */
  async rewrites() {
    const raw = process.env.BACKEND_PROXY_TARGET || process.env.INTERNAL_API_URL;
    if (!raw) {
      return [];
    }
    const base = String(raw).replace(/\/$/, '');
    return [
      {
        source: '/api/v1/:path*',
        destination: `${base}/api/v1/:path*`,
      },
    ];
  },

  // PWA headers for service worker and manifest
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=0, must-revalidate',
          },
          {
            key: 'Service-Worker-Allowed',
            value: '/',
          },
        ],
      },
      {
        source: '/manifest.json',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=3600',
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
