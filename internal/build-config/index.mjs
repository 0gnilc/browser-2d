import vue from '@vitejs/plugin-vue';
export function rendererConfig(root) {
  return { root, base: './', plugins: [vue()] };
}
