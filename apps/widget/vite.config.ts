import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

/**
 * 위젯 빌드 (설계문서 §10)
 *
 * 단일 IIFE 번들 `widget.js` 하나로 떨어뜨린다. 홈페이지는 <script> 한 줄만 넣으면 된다.
 * CSS 는 `?inline` 으로 문자열로 받아 Shadow DOM 안에 주입하므로 별도 파일이 없다.
 *
 * 산출물은 apps/web/public 에 둬서 Next.js 가 `/widget.js` 로 서빙한다.
 */
export default defineConfig({
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'preact',
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: fileURLToPath(new URL('../web/public', import.meta.url)),
    emptyOutDir: false,
    cssCodeSplit: false,
    target: 'es2019',
    lib: {
      entry: fileURLToPath(new URL('./src/main.ts', import.meta.url)),
      name: 'TheuChatbot',
      formats: ['iife'],
      fileName: () => 'widget.js',
    },
  },
})
