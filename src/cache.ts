export class KisCacheStorage {
  private readonly values = new Map<string, { value: unknown; expireAt?: number }>();

  set<T>(key: string, value: T, expire?: Date | number): void {
    const expireAt = expire instanceof Date ? expire.getTime() : typeof expire === "number" ? Date.now() + expire : undefined;
    this.values.set(key, { value, expireAt });
  }

  get<T>(key: string): T | undefined {
    const item = this.values.get(key);
    if (!item) return undefined;
    if (item.expireAt !== undefined && item.expireAt <= Date.now()) {
      this.values.delete(key);
      return undefined;
    }
    return item.value as T;
  }

  remove(key: string): void {
    this.values.delete(key);
  }

  clear(): void {
    this.values.clear();
  }
}
