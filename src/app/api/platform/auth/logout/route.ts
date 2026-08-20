import { clearPlatformSessionCookie } from "@/lib/platform-auth";
import { jsonOk } from "@/lib/api";

export async function POST() {
  await clearPlatformSessionCookie();
  return jsonOk({ ok: true });
}
