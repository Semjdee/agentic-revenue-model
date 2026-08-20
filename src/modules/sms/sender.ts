import type { SmsSender, SmsSendResult } from "./types";

/** DEMO/MOCK sender — active whenever real Twilio credentials aren't
 * configured. Never claims delivery it didn't perform: returns the code
 * in the result so the DEMO consent-style UI can show it directly
 * (labelled clearly as a demo, same as the WhatsApp/Instagram mock
 * consent screens), instead of a real text message. */
class MockSmsSender implements SmsSender {
  readonly isMock = true;
  async send(phone: string, _body: string, code: string): Promise<SmsSendResult> {
    return { ok: true, isMock: true, mockCode: code, detail: `[MOCK] Would SMS ${phone}: your code is ${code}` };
  }
}

/** Real sender via Twilio's REST API — activates automatically once
 * TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER are set.
 * Uses plain fetch (no Twilio SDK dependency needed for a single
 * send-SMS call). Genuinely fails (ok: false) on a non-2xx response
 * rather than assuming success. */
class TwilioSmsSender implements SmsSender {
  readonly isMock = false;
  constructor(private accountSid: string, private authToken: string, private fromNumber: string) {}

  async send(phone: string, body: string): Promise<SmsSendResult> {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;
    const auth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64");
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: phone, From: this.fromNumber, Body: body }).toString(),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => `HTTP ${res.status}`);
      return { ok: false, isMock: false, detail: detail.slice(0, 300) };
    }
    return { ok: true, isMock: false };
  }
}

export function getSmsSender(): SmsSender {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (sid && token && from) return new TwilioSmsSender(sid, token, from);
  return new MockSmsSender();
}
