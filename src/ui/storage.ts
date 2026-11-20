/** 极简存档封装：优先 localStorage；file://、隐私模式等拿不到时自动退回内存。 */
export interface KV {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export function createKV(win: Window | null | undefined): KV {
  const memory = new Map<string, string>();
  let backing: Storage | null = null;
  try {
    const storage = win?.localStorage;
    if (storage) {
      const probe = '__jun2048_probe__';
      storage.setItem(probe, '1');
      storage.removeItem(probe);
      backing = storage;
    }
  } catch {
    backing = null;
  }

  return {
    get(key) {
      if (backing) {
        try {
          return backing.getItem(key);
        } catch {
          /* 退到内存 */
        }
      }
      return memory.get(key) ?? null;
    },
    set(key, value) {
      memory.set(key, value);
      if (!backing) return;
      try {
        backing.setItem(key, value);
      } catch {
        /* 配额满 / 不支持写入时保留内存副本 */
      }
    },
    remove(key) {
      memory.delete(key);
      if (!backing) return;
      try {
        backing.removeItem(key);
      } catch {
        /* 忽略 */
      }
    },
  };
}
