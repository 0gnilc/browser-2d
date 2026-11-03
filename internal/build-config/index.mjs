import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
export function rendererConfig(root) {
  return { root, base: './', plugins: [vue(), tailwindcss()] };
}
