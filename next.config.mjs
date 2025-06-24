/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  webpack: (config, { isServer }) => {
    // Rule for ?url imports to ensure they are treated as asset/resource
    // for web workers (and other assets if needed)
    config.module.rules.push({
      // Matches `.ts` or `.js` files ending with `?url`
      test: /\.(ts|js)$/,
      resourceQuery: /url/, // Only process if `?url` is appended
      type: "asset/resource",
      generator: {
        // Output worker files to static/workers directory to keep them organized
        // and prevent conflicts with other static chunks.
        filename: isServer
          ? "../static/workers/[name].[hash][ext]" // For server, path relative to .next/server
          : "static/workers/[name].[hash][ext]",   // For client, path relative to .next/static
      },
    });

    // Important: return the modified config
    return config;
  },
}

export default nextConfig