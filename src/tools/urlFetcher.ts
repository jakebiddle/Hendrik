import { logError, logInfo } from "@/logger";
import { extractYoutubeVideoId } from "@/utils";
import { requestUrl } from "obsidian";
import TurndownService from "turndown";

const turndownService = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});

// Remove script and style tags entirely
turndownService.remove(["script", "style", "nav", "footer", "header"]);

const YOUTUBE_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.83 Safari/537.36,gzip(gfe)";

const RE_XML_TRANSCRIPT = /<text start="([^"]*)" dur="([^"]*)">([^<]*)<\/text>/g;

interface YouTubeCaptionTrack {
  baseUrl: string;
  languageCode?: string;
  kind?: string;
}

interface YouTubeCaptionsPayload {
  playerCaptionsTracklistRenderer?: {
    captionTracks?: YouTubeCaptionTrack[];
  };
}

/**
 * Decodes common HTML/XML entities and numeric character references.
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_match, dec: string) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    });
}

/**
 * Parses YouTube's watch page HTML and returns available caption tracks.
 */
function extractCaptionTracksFromWatchHtml(html: string): YouTubeCaptionTrack[] {
  const splitByCaptions = html.split('"captions":');
  if (splitByCaptions.length <= 1) {
    return [];
  }

  const captionsJson = splitByCaptions[1].split(',"videoDetails')[0].replace(/\n/g, "");
  try {
    const captions = JSON.parse(captionsJson) as YouTubeCaptionsPayload;
    return captions.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  } catch {
    return [];
  }
}

/**
 * Chooses the best caption track with preference for English tracks.
 */
function chooseCaptionTrack(captionTracks: YouTubeCaptionTrack[]): YouTubeCaptionTrack | null {
  if (captionTracks.length === 0) {
    return null;
  }

  const preferredLanguageCodes = ["en", "en-US", "en-GB"];
  for (const languageCode of preferredLanguageCodes) {
    const exactMatch = captionTracks.find((track) => track.languageCode === languageCode);
    if (exactMatch) {
      return exactMatch;
    }
  }

  const englishPrefixMatch = captionTracks.find((track) => track.languageCode?.startsWith("en"));
  if (englishPrefixMatch) {
    return englishPrefixMatch;
  }

  return captionTracks[0];
}

/**
 * Extracts plain transcript text from YouTube timedtext XML response.
 */
function extractTranscriptTextFromXml(xml: string): string {
  const results = [...xml.matchAll(RE_XML_TRANSCRIPT)];
  if (results.length === 0) {
    return "";
  }

  return results
    .map((result) => decodeHtmlEntities(result[3]))
    .join(" ")
    .trim();
}

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
 * Fetches a YouTube transcript using Obsidian's requestUrl to avoid renderer CORS limits.
 * Supports YouTube watch/shorts/embed/youtu.be URLs.
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

    const videoId = extractYoutubeVideoId(url);
    if (!videoId) {
      logError(`[urlFetcher] Invalid YouTube URL (missing video id): ${url}`);
      return { transcript: "", elapsed_time_ms: Date.now() - start };
    }

    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const watchPageResponse = await requestUrl({
      url: watchUrl,
      method: "GET",
      headers: {
        "User-Agent": YOUTUBE_USER_AGENT,
        "Accept-Language": "en-US,en;q=0.9",
      },
      throw: false,
    });

    if (watchPageResponse.status >= 400) {
      logError(
        `[urlFetcher] Failed to load YouTube watch page (${watchPageResponse.status}): ${watchUrl}`
      );
      return { transcript: "", elapsed_time_ms: Date.now() - start };
    }

    const watchHtml = watchPageResponse.text ?? "";
    const captionTracks = extractCaptionTracksFromWatchHtml(watchHtml);
    const selectedTrack = chooseCaptionTrack(captionTracks);
    if (!selectedTrack?.baseUrl) {
      const elapsed = Date.now() - start;
      logInfo(`[urlFetcher] No caption tracks found for ${url} (${elapsed}ms)`);
      return { transcript: "", elapsed_time_ms: elapsed };
    }

    const transcriptResponse = await requestUrl({
      url: selectedTrack.baseUrl,
      method: "GET",
      headers: {
        "User-Agent": YOUTUBE_USER_AGENT,
        "Accept-Language": "en-US,en;q=0.9",
      },
      throw: false,
    });

    if (transcriptResponse.status >= 400) {
      logError(
        `[urlFetcher] Failed to load transcript XML (${transcriptResponse.status}): ${selectedTrack.baseUrl}`
      );
      return { transcript: "", elapsed_time_ms: Date.now() - start };
    }

    const transcriptXml = transcriptResponse.text ?? "";
    const text = extractTranscriptTextFromXml(transcriptXml);
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
