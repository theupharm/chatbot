import { fileURLToPath } from 'node:url'

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  /**
   * 모노레포 배포 대응 (설계문서 §11)
   *
   * `config/site.json` 이 apps/web 바깥에 있다. Vercel 에서 Root Directory 를 apps/web 으로
   * 잡으면 Next.js 가 추적 기준을 apps/web 으로 삼아 이 파일을 번들에 포함하지 않는다.
   * 기준점을 저장소 루트로 올려 함께 딸려가게 한다.
   */
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
}

export default nextConfig
