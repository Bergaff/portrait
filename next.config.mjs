/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  
  // Настройка прокси для перенаправления запросов с фронтенда на FastAPI бэкенд
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://127.0.0.1:8000/api/:path*', // или http://localhost:8000/api/:path*
      },
    ]
  },
}

export default nextConfig
