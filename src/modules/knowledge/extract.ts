import dns from "node:dns/promises";
import net from "node:net";
import { PDFParse } from "pdf-parse";

// ============================================================================
// Knowledge auto-extraction (docs backlog — Knowledge Base "Add Knowledge"
// dialog has always offered URL/PDF as source types, but URL required
// pasting the page text by hand and PDF was disabled outright with
// "Coming soon". This module does the actual extraction; the API routes
// in src/app/api/internal/knowledge/extract-url and extract-pdf call it
// and hand the result back to the dialog for the owner to review/edit
// before saving — extraction never writes to the Knowledge Base directly,
// the existing POST /api/internal/knowledge/documents flow still owns
// that (spec: the owner is always the one who confirms what the AI can
// say, not an automated pipeline).
// ============================================================================

const MAX_FETCH_BYTES = 3 * 1024 * 1024; // 3MB — enough for any real article/policy page
const FETCH_TIMEOUT_MS = 10_000;
const MAX_EXTRACTED_CHARS = 40_000; // generous; chunkText() splits this further

export class ExtractionError extends Error {}

// --- SSRF guard -------------------------------------------------------------
// This fetches a URL the tenant admin supplies, server-side, from inside
// the app's own network — without a guard, "http://169.254.169.254/..." or
// "http://localhost:5432" is a live SSRF vector against cloud metadata
// endpoints and internal infra, not a hypothetical one. Block private/
// loopback/link-local ranges on both the literal hostname AND the
// resolved IP (DNS rebinding), not just a hostname string match.
function isPrivateOrReservedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 127) return true; // loopback
    if (a === 10) return true; // private
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 169 && b === 254) return true; // link-local incl. cloud metadata
    if (a === 0) return true;
    return false;
  }
  const lower = ip.toLowerCase();
  if (lower === "::1") return true; // loopback
  if (lower.startsWith("fe80:")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local
  return false;
}

async function assertSafeUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ExtractionError("That doesn't look like a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ExtractionError("Only http/https URLs are supported.");
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new ExtractionError("That URL points at a local address, which can't be fetched from here.");
  }
  if (net.isIP(hostname) && isPrivateOrReservedIp(hostname)) {
    throw new ExtractionError("That URL points at a private/internal address, which can't be fetched from here.");
  }
  if (!net.isIP(hostname)) {
    let addresses: string[];
    try {
      addresses = (await dns.lookup(hostname, { all: true })).map((a) => a.address);
    } catch {
      throw new ExtractionError("Couldn't resolve that domain.");
    }
    if (addresses.some(isPrivateOrReservedIp)) {
      throw new ExtractionError("That domain resolves to a private/internal address, which can't be fetched from here.");
    }
  }
  return url;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function htmlToReadableText(html: string): { title: string | null; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1]).trim().replace(/\s+/g, " ") : null;

  let body = html
    // Strip whole elements whose content is never real page copy.
    .replace(/<(script|style|noscript|svg|iframe|nav|footer|header|form)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    // Block-level tags become paragraph breaks so the extracted text keeps some structure.
    .replace(/<\/(p|div|li|h[1-6]|br|tr|section|article)\s*>/gi, "\n")
    .replace(/<(br|hr)\s*\/?>/gi, "\n")
    // Drop every remaining tag.
    .replace(/<[^>]+>/g, " ");

  body = decodeEntities(body);
  body = body
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");

  return { title, text: body };
}

/** Fetch a URL server-side and extract its readable text + page title. Throws ExtractionError with a user-facing message on any failure — never returns a silently empty/fake result. */
export async function extractFromUrl(rawUrl: string): Promise<{ title: string; content: string }> {
  const url = await assertSafeUrl(rawUrl);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "user-agent": "AIRevenueAgent-KnowledgeBot/1.0 (+content import for a connected business's AI sales agent)" },
    });
  } catch (err) {
    throw new ExtractionError(err instanceof Error && err.name === "AbortError" ? "The page took too long to respond." : "Couldn't reach that URL.");
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) throw new ExtractionError(`The page responded with an error (HTTP ${res.status}).`);
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html") && !contentType.includes("text/plain") && !contentType.includes("application/xhtml")) {
    throw new ExtractionError(`That URL didn't return a web page (content-type: ${contentType || "unknown"}).`);
  }

  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_FETCH_BYTES) throw new ExtractionError("That page is too large to import.");

  const html = Buffer.from(buf).toString("utf-8");
  const { title, text } = htmlToReadableText(html);
  if (!text.trim()) throw new ExtractionError("Couldn't find any readable text on that page.");

  return {
    title: title || url.hostname,
    content: text.slice(0, MAX_EXTRACTED_CHARS),
  };
}

/** Extract text from an uploaded PDF buffer. Throws ExtractionError with a user-facing message on any failure. */
export async function extractFromPdf(buffer: Buffer): Promise<{ content: string }> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    const text = result.text
      // pdf-parse joins multi-page text with "-- N of M --" separator
      // lines — real page markers, not content, so strip them rather than
      // let them bleed into what the AI treats as business knowledge.
      .replace(/^\s*--\s*\d+\s*of\s*\d+\s*--\s*$/gim, "")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (!text) throw new ExtractionError("Couldn't find any extractable text in that PDF (it may be a scanned image without a text layer).");
    return { content: text.slice(0, MAX_EXTRACTED_CHARS) };
  } catch (err) {
    if (err instanceof ExtractionError) throw err;
    throw new ExtractionError("Couldn't read that PDF — it may be corrupted, password-protected, or not a valid PDF.");
  } finally {
    await parser.destroy();
  }
}
