/** @type {import('next').NextConfig} */
const nextConfig = {
  // pdf-parse (knowledge auto-extraction, src/modules/knowledge/extract.ts)
  // pulls in pdfjs-dist, which does its own environment feature-detection
  // at module-init time — webpack's RSC bundling of that breaks with
  // "Object.defineProperty called on non-object" when it's bundled
  // instead of left as a real Node require. Excluding it from bundling
  // (Next 14's experimental flag; becomes the stable `serverExternalPackages`
  // in Next 15) fixes that without needing a dynamic-import workaround.
  experimental: {
    serverComponentsExternalPackages: ["pdf-parse"],
  },
};

export default nextConfig;
