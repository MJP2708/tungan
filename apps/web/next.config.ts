import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // @tungan/shared ships TypeScript source so the Worker and the UI compile
  // the same files rather than a build artefact that can drift.
  transpilePackages: ['@tungan/shared'],
};

export default nextConfig;
