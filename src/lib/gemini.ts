import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/**
 * Checks if an error is a Gemini API quota error (429)
 */
export function isQuotaError(error: any): boolean {
  const msg = error?.message?.toLowerCase() || '';
  return msg.includes('quota') || msg.includes('429') || msg.includes('too many requests') || msg.includes('limit');
}

/**
 * Formats a Gemini error for user display
 */
export function formatGeminiError(error: any): string {
  if (isQuotaError(error)) {
    return "AI capacity limit reached. Please wait 1-2 minutes or try a smaller file/selection.";
  }
  return error?.message || "An unexpected AI error occurred.";
}

function cleanJsonString(str: string): string {
  // Remove markdown code block markers
  let cleaned = str.replace(/```json\s?/, "").replace(/```\s?$/, "").trim();
  // Basic attempt to strip trailing commas before closing braces/brackets
  cleaned = cleaned.replace(/,\s*([\]}])/g, "$1");
  return cleaned;
}

function safeJsonParse<T>(str: string, fallback: T): T {
  try {
    const cleaned = cleanJsonString(str);
    return JSON.parse(cleaned) as T;
  } catch (e) {
    return fallback;
  }
}

function getFallbackMimeType(file: File): string {
  if (file.type) return file.type;
  
  const extension = file.name.split('.').pop()?.toLowerCase();
  switch (extension) {
    case 'md':
    case 'markdown':
      return 'text/markdown';
    case 'txt':
      return 'text/plain';
    case 'pdf':
      return 'application/pdf';
    case 'js':
    case 'ts':
    case 'tsx':
    case 'jsx':
      return 'text/javascript';
    case 'py':
      return 'text/x-python';
    case 'html':
      return 'text/html';
    case 'css':
      return 'text/css';
    case 'csv':
      return 'text/csv';
    case 'json':
      return 'application/json';
    case 'yaml':
    case 'yml':
      return 'text/yaml';
    case 'xml':
      return 'text/xml';
    case 'sql':
      return 'text/x-sql';
    default:
      return 'text/plain'; // Default to plain text
  }
}

export async function defineSelection(selection: string, context: string): Promise<string> {
  // PRIORITY TASK: Fast response for user-initiated definition
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `PRIORITY TASK: Define this term from the user's focus.
    
    Context (first 1000 chars): ${context.substring(0, 1000)}...
    Focus Term: ${selection}
    
    REQUIRED FORMAT:
    Line 1: [Simplified Chinese Translation]
    Line 2: [Ultra-concise English definition, max 12 words]
    
    Return ONLY these two lines. Speed is critical.`,
  });

  return response.text?.trim() || "Could not generate definition.";
}

export async function extractFullContent(file: File): Promise<{ content: string; terms: Record<string, string> }> {
  const mimeType = getFallbackMimeType(file);
  const base64Data = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.readAsDataURL(file);
  });

  const processWithTimeout = async () => {
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error("Processing timed out. Please try a smaller file.")), 300000)
    );

    const apiPromise = ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType,
              data: base64Data,
            },
          },
          {
            text: "Extract the full text of this document and convert it to clean Github Flavored Markdown. Preserve formatting and structure. Return ONLY the markdown content.",
          },
        ],
      },
    });

    return Promise.race([apiPromise, timeoutPromise]) as Promise<any>;
  };

  const response = await processWithTimeout();
  
  return {
    content: response.text || "",
    terms: {}, // Disabled automatic glossary to save AI capacity
  };
}

export async function processFile(file: File): Promise<{ content: string; terms: Record<string, string>; isFast: boolean }> {
  const mimeType = getFallbackMimeType(file);
  const isPlainDoc = mimeType.startsWith('text/') || mimeType === 'application/json';

  if (isPlainDoc) {
    const localContent = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsText(file);
    });

    return {
      content: localContent,
      terms: {}, // Will be filled by async call in UI
      isFast: true
    };
  }
  
  const result = await extractFullContent(file);
  return { ...result, isFast: false };
}
