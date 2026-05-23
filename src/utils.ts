import { Decimal } from "decimal.js";
import type { KisApiMetadata, StockSignType } from "./types.js";
import { STOCK_SIGN_TYPE_MAP } from "./types.js";

export type AnyRecord = Record<string, any>;

export function asDecimal(value: unknown, fallback: Decimal.Value = 0): Decimal {
  if (value === null || value === undefined || value === "") return new Decimal(fallback);
  return new Decimal(value as Decimal.Value);
}

export function asOptionalDecimal(value: unknown): Decimal | null {
  if (value === null || value === undefined || value === "") return null;
  return new Decimal(value as Decimal.Value);
}

export function asInt(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === "") return fallback;
  return Number.parseInt(String(value), 10);
}

export function asBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = String(value ?? "").toLowerCase();
  return normalized === "y" || normalized === "true" || normalized === "1";
}

export function safeDivide(a: Decimal.Value, b: Decimal.Value): Decimal {
  const denominator = new Decimal(b);
  if (denominator.isZero()) return new Decimal(0);
  return new Decimal(a).div(denominator);
}

export function toKstDate(value: string, format: "date" | "datetime" | "time" = "datetime"): Date {
  if (!value) return new Date(Number.NaN);
  if (format === "date") {
    return new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00+09:00`);
  }
  if (format === "time") {
    return new Date(`1970-01-01T${value.slice(0, 2)}:${value.slice(2, 4)}:${value.slice(4, 6)}+09:00`);
  }
  return new Date(
    `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(8, 10)}:${value.slice(
      10,
      12
    )}:${value.slice(12, 14)}+09:00`
  );
}

export function parseKisTokenDate(value: string): Date {
  return new Date(value.replace(" ", "T") + "+09:00");
}

export function formatDate(date: Date): string {
  const y = date.getFullYear().toString().padStart(4, "0");
  const m = (date.getMonth() + 1).toString().padStart(2, "0");
  const d = date.getDate().toString().padStart(2, "0");
  return `${y}${m}${d}`;
}

export function formatTime(date: Date): string {
  const h = date.getHours().toString().padStart(2, "0");
  const m = date.getMinutes().toString().padStart(2, "0");
  const s = date.getSeconds().toString().padStart(2, "0");
  return `${h}${m}${s}`;
}

export function signFromCode(code: unknown): StockSignType {
  return STOCK_SIGN_TYPE_MAP[String(code)] ?? "steady";
}

export function apiMeta(data: AnyRecord, response?: Response): KisApiMetadata {
  return {
    rtCd: data.rt_cd == null ? undefined : String(data.rt_cd),
    msgCd: data.msg_cd == null ? undefined : String(data.msg_cd),
    message: data.msg1 == null ? undefined : String(data.msg1).trim(),
    trId: response?.headers.get("tr_id") ?? null,
    raw: data
  };
}

export function output<T = AnyRecord>(data: AnyRecord, key = "output"): T {
  return (data[key] ?? {}) as T;
}

export function outputArray<T = AnyRecord>(data: AnyRecord, key: string): T[] {
  const value = data[key];
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

export function compactRecord<T extends AnyRecord>(record: T): T {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined && value !== null)) as T;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function normalizeDateInput(value: Date | string | undefined, fallback = new Date()): Date {
  if (!value) return fallback;
  if (value instanceof Date) return value;
  const compact = value.replaceAll("-", "");
  if (/^\d{8}$/.test(compact)) return toKstDate(compact, "date");
  return new Date(value);
}

export function mergeDecimal(values: Iterable<Decimal.Value>): Decimal {
  let result = new Decimal(0);
  for (const value of values) result = result.plus(value);
  return result;
}
