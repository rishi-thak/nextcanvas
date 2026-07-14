const { withCanvas } = require('nextcanvas/next');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

module.exports = withCanvas(nextConfig);
