import { createApp } from './ui/app.ts';

const root = document.getElementById('app');
if (root) {
  const app = createApp(root);
  // 调试入口：控制台里可以用 __jun2048.state 查看局面
  (window as unknown as Record<string, unknown>).__jun2048 = app;
}
