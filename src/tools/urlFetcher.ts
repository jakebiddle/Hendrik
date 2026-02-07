import { logError, logInfo } from "@/logger";
import { requestUrl } from "obsidian";
import TurndownService from "turndown";

const turndownService = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});

// Remove script and style tags entirely
turndownService.remove(["script", "style", "nav", "footer", "header"]);

/**
 * Fetch a URL and convert its HTML content to markdown.
 * Replaces the Brevilabs url4llm API with a local implementation.
 *
 * @param url - The URL to fetch
 * @returns Object with response (markdown content) and elapsed_time_ms
 */
export async function fetchUrlToMarkdown(
  url: string
): Promise<{ response: string; elapsed_time_ms: number }> {
  const start = Date.now();
  try {
    logInfo(`[urlFetcher] Fetching URL: ${url}`);
    const result = await requestUrl({ url, method: "GET" });
    const html = result.text;

    // Extract the body content if possible
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const bodyHtml = bodyMatch ? bodyMatch[1] : html;

    // Convert HTML to markdown
    const markdown = turndownService.turndown(bodyHtml);

    // Trim excessive whitespace
    const cleaned = markdown
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, 50000); // Limit to ~50k chars to prevent context overflow

    const elapsed = Date.now() - start;
    logInfo(`[urlFetcher] Successfully fetched ${url} (${cleaned.length} chars, ${elapsed}ms)`);
    return { response: cleaned, elapsed_time_ms: elapsed };
  } catch (error) {
    const elapsed = Date.now() - start;
    logError(`[urlFetcher] Failed to fetch ${url}:`, error);
    return { response: url, elapsed_time_ms: elapsed };
  }
}

/**
 * Fetch a YouTube transcript using the youtube-transcript package.
 *
 * @param url - YouTube video URL
 * @returns Object with transcript text
 */
export async function fetchYoutubeTranscript(
  url: string
): Promise<{ transcript: string; elapsed_time_ms: number }> {
  const start = Date.now();
  try {
    logInfo(`[urlFetcher] Fetching YouTube transcript: ${url}`);
    const { YoutubeTranscript } = await import("youtube-transcript");
    const transcript = await YoutubeTranscript.fetchTranscript(url);
    const text = transcript.map((item: { text: string }) => item.text).join(" ");
    const elapsed = Date.now() - start;
    logInfo(`[urlFetcher] Got YouTube transcript (${text.length} chars, ${elapsed}ms)`);
    return { transcript: text, elapsed_time_ms: elapsed };
  } catch (error) {
    const elapsed = Date.now() - start;
    logError(`[urlFetcher] Failed to fetch YouTube transcript for ${url}:`, error);
    return { transcript: "", elapsed_time_ms: elapsed };
  }
}

/**
 * Parse a PDF file from binary content to text.
 * Uses pdf-parse for local PDF extraction.
 *
 * @param binaryContent - PDF file as ArrayBuffer
 * @returns Extracted text content
 */
export async function parsePdfToText(binaryContent: ArrayBuffer): Promise<string> {
  try {
    logInfo("[urlFetcher] Parsing PDF locally");
    const pdfParseModule = await import("pdf-parse");
    const pdfParse = (pdfParseModule as any).default ?? pdfParseModule;
    const buffer = Buffer.from(binaryContent);
    const data = await (pdfParse as any)(buffer);
    logInfo(`[urlFetcher] Parsed PDF: ${data.numpages} pages, ${data.text.length} chars`);
    return data.text;
  } catch (error) {
    logError("[urlFetcher] Failed to parse PDF:", error);
    throw error;
  }
}

/**
 * Perform a web search using DuckDuckGo's HTML endpoint.
 * Returns structured search results for the LLM to synthesize.
 *
 * @param query - Search query
 * @returns Array of search results with title, snippet, and URL
 */
export async function webSearch(query: string): Promise<{
  results: Array<{ title: string; snippet: string; url: string }>;
  elapsed_time_ms: number;
}> {
  const start = Date.now();
  try {
    logInfo(`[webSearch] Searching: ${query}`);
    const encodedQuery = encodeURIComponent(query);
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;

    const result = await requestUrl({
      url: searchUrl,
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ObsidianCopilot/1.0)",
      },
    });

    const html = result.text;
    const results: Array<{ title: string; snippet: string; url: string }> = [];

    // Parse DuckDuckGo HTML results
    const resultRegex =
      /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let match;
    while ((match = resultRegex.exec(html)) !== null && results.length < 10) {
      const rawUrl = match[1];
      const title = match[2].replace(/<[^>]+>/g, "").trim();
      const snippet = match[3].replace(/<[^>]+>/g, "").trim();

      // DuckDuckGo wraps URLs in redirects, extract the actual URL
      let url = rawUrl;
      const uddgMatch = rawUrl.match(/uddg=([^&]+)/);
      if (uddgMatch) {
        url = decodeURIComponent(uddgMatch[1]);
      }

      if (title && url) {
        results.push({ title, snippet, url });
      }
    }

    const elapsed = Date.now() - start;
    logInfo(`[webSearch] Found ${results.length} results (${elapsed}ms)`);
    return { results, elapsed_time_ms: elapsed };
  } catch (error) {
    const elapsed = Date.now() - start;
    logError(`[webSearch] Search failed:`, error);
    return { results: [], elapsed_time_ms: elapsed };
  }
}
