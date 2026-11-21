/** 「关于」弹层内容：简介 + 仓库链接。文案与链接全部来自 game/meta.ts。 */
import { ABOUT_TEXT, GAME_NAME, GAME_VERSION, REPO_LINKS } from '../game/meta.ts';
import type { OverlayContent } from './overlay.ts';

export function buildAbout(): OverlayContent {
  return {
    kind: 'about',
    eyebrow: `关于 · v${GAME_VERSION}`,
    title: GAME_NAME,
    text: ABOUT_TEXT,
    actions: [
      ...REPO_LINKS.map((link) => ({ label: link.label, href: link.url })),
      { label: '关闭', primary: true, action: () => {} },
    ],
    focus: 'first',
  };
}