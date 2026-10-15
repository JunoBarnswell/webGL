import js from '@eslint/js';
import tseslint from 'typescript-eslint';
export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/bin/**', '**/obj/**', 'artifacts/**', '.local/**', '.tools/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: Object.fromEntries(['window','document','console','fetch','URL','Blob','File','FileReader','Headers','FormData','AbortController','AbortSignal','crypto','navigator','localStorage','sessionStorage','requestAnimationFrame','cancelAnimationFrame','ResizeObserver','PointerEvent','KeyboardEvent','HTMLElement','HTMLInputElement','HTMLSelectElement','HTMLTextAreaElement','HTMLCanvasElement','Image','ImageBitmap','Audio','Event','CustomEvent','performance','setTimeout','clearTimeout','setInterval','clearInterval','structuredClone','atob','btoa','TextEncoder','TextDecoder','process','Buffer','NodeJS'].map(name => [name, 'readonly'])) },
    rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }], '@typescript-eslint/no-explicit-any': 'error', 'no-undef': 'off' }
  }
);
