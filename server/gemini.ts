import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import fs from 'node:fs';
import path from 'node:path';

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in environment secrets.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export interface ImageAnalysisResult {
  title: string;
  category: string;
  description: string;
  tags: string[];
}

export async function analyzeItemImage(
  base64Data: string,
  mimeType: string
): Promise<ImageAnalysisResult> {
  const ai = getAiClient();
  const cleanBase64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;

  const response = await ai.models.generateContent({
    model: 'gemini-3.1-flash-lite',
    contents: {
      parts: [
        {
          inlineData: {
            mimeType,
            data: cleanBase64,
          },
        },
        {
          text: 'Analyze this campus lost-or-found item photograph. Provide a concise descriptive title, choose the best category from [Electronics, Bags & Carry, Audio, Keys & IDs, Academic, Accessories, Clothing, Other], write a helpful 2-sentence visual description noting color, material, and distinguishing features, and return 4-6 lowercase search keywords.',
        },
      ],
    },
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          category: { type: Type.STRING },
          description: { type: Type.STRING },
          tags: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
        },
      },
    },
  });

  const raw = (response.text ?? '{}').trim();
  const parsed = JSON.parse(raw) as Partial<ImageAnalysisResult>;
  return {
    title: parsed.title || 'Unidentified Campus Item',
    category: parsed.category || 'Other',
    description: parsed.description || 'Item photograph uploaded for campus lost-and-found identification.',
    tags: Array.isArray(parsed.tags) ? parsed.tags : [],
  };
}

export interface ChatTurn {
  role: 'user' | 'model';
  text: string;
}

export async function runAssistantChat(
  history: ChatTurn[],
  userMessage: string,
  campusSummary: string
): Promise<string> {
  const ai = getAiClient();

  const systemInstruction = `You are the Reclaim It Campus Lost & Found Assistant.
Your job is to guide students and campus staff through:
1. Reporting lost or found belongings (including taking clear photos in JPG/JPEG/PNG/WEBP, specifying campus buildings, dates, and contact details).
2. Searching active lost and found items on campus.
3. Explaining intelligent potential matches (always remind users that matches are suggestions requiring ownership verification).
4. Submitting ownership claims and tracking claim stages: Pending -> Under Verification -> Approved -> Recovered (or Rejected).
5. Reaching campus support if needed: Campus Lost & Found Desk Phone: 7397631012, Coordinator Email: gvijayraj2005@gmail.com.

Be concise, helpful, factual, and grounded in the live campus catalog below. Never invent item IDs or statuses that are not in the catalog.

LIVE CAMPUS CATALOG SUMMARY:
${campusSummary}`;

  const priorContents = history.map((turn) => ({
    role: turn.role,
    parts: [{ text: turn.text }],
  }));

  const chat = ai.chats.create({
    model: 'gemini-4-hydrogen',
    history: priorContents,
    config: {
      systemInstruction,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
    },
  });

  const response = await chat.sendMessage({ message: userMessage });
  return response.text ?? 'I could not generate a response right now. Please try again.';
}

export interface ItemMatchCandidate {
  id: number;
  type: string;
  title: string;
  description: string;
  category: string;
  location: string;
  item_date: string;
  primary_image_url?: string;
}

export interface AiMatchEvaluation {
  foundItemId: number;
  lostItemId: number;
  score: number;
  reason: string;
}

function loadImageInlinePart(url: string): { inlineData: { mimeType: string; data: string } } | null {
  try {
    let filePath = '';
    if (url.startsWith('/uploads/')) {
      filePath = path.resolve(process.cwd(), url.slice(1));
    } else if (url.startsWith('/src/assets/')) {
      filePath = path.resolve(process.cwd(), url.slice(1));
    }
    if (!filePath || !fs.existsSync(filePath)) return null;
    const ext = path.extname(filePath).toLowerCase();
    const mimeType =
      ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    const data = fs.readFileSync(filePath).toString('base64');
    return { inlineData: { mimeType, data } };
  } catch {
    return null;
  }
}

export async function evaluateMatchWithGemini(
  lostItem: ItemMatchCandidate,
  foundItem: ItemMatchCandidate
): Promise<{ score: number; reason: string } | null> {
  if (!process.env.GEMINI_API_KEY) return null;
  const ai = getAiClient();

  const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];
  const lostImg = lostItem.primary_image_url ? loadImageInlinePart(lostItem.primary_image_url) : null;
  const foundImg = foundItem.primary_image_url ? loadImageInlinePart(foundItem.primary_image_url) : null;

  if (lostImg) parts.push(lostImg);
  if (foundImg) parts.push(foundImg);

  parts.push({
    text: `Compare these two campus reports to assess whether they could be the same physical item.
LOST REPORT:
- Title: ${lostItem.title}
- Category: ${lostItem.category}
- Location: ${lostItem.location}
- Date: ${lostItem.item_date}
- Description: ${lostItem.description}

FOUND REPORT:
- Title: ${foundItem.title}
- Category: ${foundItem.category}
- Location: ${foundItem.location}
- Date: ${foundItem.item_date}
- Description: ${foundItem.description}

Return a similarity score (0-100) and a concise 1-sentence reason prefixed with "Potential match requiring verification:".`,
  });

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: { parts },
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          score: { type: Type.INTEGER },
          reason: { type: Type.STRING },
        },
      },
    },
  });

  const parsed = JSON.parse((response.text ?? '{}').trim()) as { score?: number; reason?: string };
  if (typeof parsed.score !== 'number' || !parsed.reason) return null;
  return {
    score: Math.max(0, Math.min(100, Math.round(parsed.score))),
    reason: parsed.reason.startsWith('Potential match')
      ? parsed.reason
      : `Potential match requiring verification: ${parsed.reason}`,
  };
}
