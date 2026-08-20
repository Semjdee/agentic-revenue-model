// SMS sender abstraction — the OTP itself (generation, hashing, expiry,
// single-use, attempt-limiting; see modules/auth/otp.ts) is always 100%
// real. Only DELIVERY is provider-dependent: a real SMS provider (Twilio)
// sends the actual text message; without one configured, the DEMO/MOCK
// sender below reports the code back in the API response instead of
// pretending it was delivered — same "never fake a completed integration"
// rule as every other connector in this codebase.
export interface SmsSendResult {
  ok: boolean;
  isMock: boolean;
  /** Only ever populated by the mock sender — a real sender must never
   * echo the code back to the caller. */
  mockCode?: string;
  detail?: string;
}

export interface SmsSender {
  readonly isMock: boolean;
  send(phone: string, body: string, code: string): Promise<SmsSendResult>;
}
