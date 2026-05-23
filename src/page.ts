export type KisPageStatus = "begin" | "end";

export class KisPage {
  constructor(
    readonly size: 100 | 200,
    readonly search = "",
    readonly key = ""
  ) {}

  get isEmpty(): boolean {
    return this.search.trim() === "" && this.key.trim() === "";
  }

  get isFirst(): boolean {
    return this.isEmpty;
  }

  build(target: Record<string, string> = {}): Record<string, string> {
    target[`ctx_area_fk${this.size}`] = this.search;
    target[`ctx_area_nk${this.size}`] = this.key;
    return target;
  }

  static first(size: 100 | 200): KisPage {
    return new KisPage(size);
  }

  static from(data: Record<string, unknown>, size: 100 | 200): KisPage {
    return new KisPage(size, String(data[`ctx_area_fk${size}`] ?? ""), String(data[`ctx_area_nk${size}`] ?? ""));
  }
}

export function pageStatus(header: string | null): KisPageStatus {
  return header === "F" || header === "M" ? "begin" : "end";
}
