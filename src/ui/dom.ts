/** DOM 小工具：建节点、取节点、计时、棋盘坐标。所有 UI 模块共用。 */

export function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function need<T extends Element>(root: HTMLElement, selector: string): T {
  const node = root.querySelector<T>(selector);
  if (!node) throw new Error(`缺少节点：${selector}`);
  return node;
}

export function later(w: Window | null, fn: () => void, ms: number): number {
  return w ? w.setTimeout(fn, ms) : (setTimeout(fn, ms) as unknown as number);
}

export function cancelTimer(w: Window | null, id: number): void {
  if (w) w.clearTimeout(id);
  else clearTimeout(id as unknown as number);
}

/** 把棋盘格下标写进 CSS 变量（--r / --c），位移全靠 CSS transform */
export function setCell(node: HTMLElement, index: number, size: number): void {
  node.style.setProperty('--r', String(Math.floor(index / size)));
  node.style.setProperty('--c', String(index % size));
}