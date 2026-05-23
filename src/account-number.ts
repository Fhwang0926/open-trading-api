export class KisAccountNumber {
  readonly number: string;
  readonly code: string;

  constructor(account: string) {
    const accountLength = account.length;
    if (accountLength === 8) {
      this.number = account;
      this.code = "01";
    } else if (accountLength === 10) {
      this.number = account.slice(0, 8);
      this.code = account.slice(8);
    } else if (accountLength === 11 && account[8] === "-") {
      this.number = account.slice(0, 8);
      this.code = account.slice(9);
    } else {
      throw new Error(`Invalid account number format: ${account}`);
    }

    if (!/^\d+$/.test(this.number) || !/^\d+$/.test(this.code)) {
      throw new Error(`Account number contains invalid characters: ${account}`);
    }
  }

  build(target: Record<string, string> = {}): Record<string, string> {
    target.CANO = this.number;
    target.ACNT_PRDT_CD = this.code;
    return target;
  }

  equals(other: KisAccountNumber): boolean {
    return this.number === other.number && this.code === other.code;
  }

  toString(): string {
    return `${this.number}-${this.code}`;
  }
}
