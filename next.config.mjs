/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Seed the writable Vercel temp database from this committed snapshot.
  outputFileTracingIncludes: {
    "/api/brain/*": ["./data/brain/brain.sqlite"],
  },
  // Native engines and multi-gigabyte weights are local-runtime only. Keep them
  // out of serverless traces; status endpoints report them as unavailable.
  outputFileTracingExcludes: {
    "/*": [
      "./bin/**/*",
      "./models/**/*",
      "./data/brain/backups/**/*",
      "./data/brain/tmp/**/*",
      "./data/image-assets/**/*",
      "./data/image-inputs/**/*",
      "./data/images/**/*",
      "./data/videos/**/*",
      "./scripts/word-model-*.json",
      "./scripts/word-model-*.resume.json",
    ],
  },
};

export default nextConfig;
