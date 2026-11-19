import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export interface ServerScanImeiPayload {
  imageBase64: string;
  mimeType?: string;
  fastImeiOnly?: boolean;
}

export interface ServerScanImeiResult {
  imei: string;
  imei2: string;
  allImeis: string[];
  barcode: string;
  brand: string;
  model: string;
  ram: string;
  storage: string;
  colour: string;
  buyingPrice: number;
  expectedSellingPrice: number;
  sellerName: string;
  sellerMobile: string;
  sellerAddress: string;
  idType: string;
  idNumber: string;
  notes: string;
}

const IMEI_FAST_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    imei: {
      type: Type.STRING,
      description: 'Primary 15-digit IMEI 1 (digits only, or empty string)',
    },
    imei2: {
      type: Type.STRING,
      description: 'Secondary 15-digit IMEI 2 if dual-SIM (digits only, or empty string)',
    },
    allImeis: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'All 14 to 16 digit IMEI/IMEISV numbers visible anywhere in the image',
    },
    brand: {
      type: Type.STRING,
      description: 'Phone brand if visible (Samsung, Apple, Xiaomi, Vivo, Oppo, Realme, OnePlus, Motorola, Nothing, etc.)',
    },
    model: {
      type: Type.STRING,
      description: 'Phone model name if visible',
    },
    ram: {
      type: Type.STRING,
      description: 'RAM if visible e.g. 6 GB, 8 GB',
    },
    storage: {
      type: Type.STRING,
      description: 'Storage if visible e.g. 128 GB, 256 GB',
    },
    colour: {
      type: Type.STRING,
      description: 'Colour if visible',
    },
  },
  required: ['imei', 'imei2', 'allImeis'],
};

const FULL_SCAN_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    imei: {
      type: Type.STRING,
      description: 'Exact 15-digit IMEI 1 digits only, or empty string',
    },
    imei2: {
      type: Type.STRING,
      description: 'Exact 15-digit IMEI 2 digits only if present, or empty string',
    },
    allImeis: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'Every 14 to 16 digit IMEI/IMEISV number printed or encoded in the image',
    },
    barcode: { type: Type.STRING, description: 'Barcode or serial number if visible' },
    brand: {
      type: Type.STRING,
      description: 'Phone brand: Samsung, Apple, Xiaomi, Vivo, Oppo, Realme, OnePlus, Motorola, Nothing, Other, or empty',
    },
    model: { type: Type.STRING, description: 'Phone model name if visible' },
    ram: { type: Type.STRING, description: 'RAM e.g. 4 GB, 6 GB, 8 GB, 12 GB' },
    storage: { type: Type.STRING, description: 'Storage e.g. 64 GB, 128 GB, 256 GB, 512 GB' },
    colour: { type: Type.STRING, description: 'Phone colour if visible' },
    buyingPrice: { type: Type.NUMBER, description: 'Buying price in INR if visible on bill, else 0' },
    expectedSellingPrice: { type: Type.NUMBER, description: 'Selling price if visible, else 0' },
    sellerName: { type: Type.STRING, description: 'Seller or customer name on bill or ID card' },
    sellerMobile: { type: Type.STRING, description: '10-digit mobile number if visible' },
    sellerAddress: { type: Type.STRING, description: 'Address on bill or ID card' },
    idType: { type: Type.STRING, description: 'Aadhaar, PAN Card, Voter ID, Driving Licence, or Passport' },
    idNumber: { type: Type.STRING, description: 'Government ID number if visible' },
    notes: { type: Type.STRING, description: 'Extra details visible on box or bill' },
  },
  required: ['imei', 'imei2', 'allImeis'],
};

function safeParseJson<T>(raw: string): T | null {
  if (!raw) return null;
  try {
    const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
    const first = cleaned.indexOf('{');
    const last = cleaned.lastIndexOf('}');
    if (first !== -1 && last > first) {
      return JSON.parse(cleaned.slice(first, last + 1)) as T;
    }
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}

export async function runServerImeiVisionOcr(
  payload: ServerScanImeiPayload
): Promise<{ ok: true; data: Partial<ServerScanImeiResult> } | { ok: false; error: string; status: number }> {
  const ai = getGeminiClient();
  if (!ai) {
    return {
      ok: false,
      status: 503,
      error: 'GEMINI_API_KEY is not configured on the server.',
    };
  }

  const cleanBase64 = (payload.imageBase64 || '').replace(/^data:[^;]+;base64,/, '').trim();
  if (!cleanBase64) {
    return { ok: false, status: 400, error: 'Missing imageBase64 payload.' };
  }

  const mimeType = payload.mimeType || 'image/jpeg';
  const prompt = payload.fastImeiOnly
    ? `ULTRA-FAST IMEI OCR for an Indian mobile phone shop.
Read EVERY IMEI / IMEI1 / IMEI2 / IMEISV number visible in this photo (*#06# screen, mobile box sticker, back sticker, SIM tray, or bill).
Rules:
1. IMEI numbers are 15 digits (sometimes printed with slashes/spaces like 356938/03/564380/9 or 16-digit IMEISV like 3569380356438091). Strip spaces/slashes/hyphens and output exact digits.
2. Read every single digit with 100% precision. Do NOT guess or hallucinate digits if no IMEI is visible.
3. Also extract brand, model, RAM, storage, colour ONLY if clearly visible on the box/screen.
Return strictly valid JSON matching the schema.`
    : `Precision OCR & Mobile Inventory Vision AI for Indian mobile shops.
Inspect every line of text, barcode label, *#06# screen, phone box sticker, paper bill, or Government ID card (Aadhaar/PAN/DL/Voter ID).
Extract ALL 15-digit IMEI numbers (IMEI 1, IMEI 2, and any additional IMEIs in allImeis). Strip spaces/slashes/hyphens so each IMEI contains digits only.
Read every single digit accurately without skipping or inventing digits. Also extract brand, model, RAM, storage, colour, price, seller/customer name, mobile, address, and ID details if visible.
Return strictly valid JSON matching the schema.`;

  const imagePart = {
    inlineData: {
      mimeType,
      data: cleanBase64,
    },
  };
  const textPart = { text: prompt };
  const schema = payload.fastImeiOnly ? IMEI_FAST_SCHEMA : FULL_SCAN_SCHEMA;

  // Primary: gemini-3.1-flash-lite (ultra-fast minimal thinking OCR)
  // Fallback: gemini-4-hydrogen (ThinkingLevel.LOW) for maximum accuracy on difficult/blurry frames
  const attempts: Array<{ model: string; thinkingLevel?: ThinkingLevel }> = [
    { model: 'gemini-3.1-flash-lite' },
    { model: 'gemini-4-hydrogen', thinkingLevel: ThinkingLevel.LOW },
  ];

  let lastError = 'Vision OCR request failed';
  for (const attempt of attempts) {
    try {
      const response = await ai.models.generateContent({
        model: attempt.model,
        contents: { parts: [imagePart, textPart] },
        config: {
          responseMimeType: 'application/json',
          responseSchema: schema,
          ...(attempt.thinkingLevel
            ? { thinkingConfig: { thinkingLevel: attempt.thinkingLevel } }
            : {}),
        },
      });

      const rawText = (response.text ?? '').trim();
      const parsed = safeParseJson<Partial<ServerScanImeiResult>>(rawText);
      if (parsed) {
        return { ok: true, data: parsed };
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  return { ok: false, status: 502, error: lastError };
}

export async function runServerVoiceParse(
  transcript: string,
  context = 'general'
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string; status: number }> {
  const ai = getGeminiClient();
  if (!ai) {
    return {
      ok: false,
      status: 503,
      error: 'GEMINI_API_KEY is not configured on the server.',
    };
  }

  const cleanText = (transcript || '').trim();
  if (!cleanText) {
    return { ok: false, status: 400, error: 'Missing transcript.' };
  }

  const systemInstruction = `You are an intelligent voice-to-form parser for an Indian Used Mobile Inventory & KYC app ("CM Inventory Management").
The user spoke in Hindi, Hinglish (Devanagari or Roman), or English. Context: "${context}".
Convert the user's spoken text into a clean English/transliterated JSON object with optional fields: intent ("buy"|"sell"|"search"|"due"), imei, brand, model, ram, storage, colour, buyingPrice, expectedSellingPrice, sellingPrice, sellerName, sellerMobile, sellerAddress, buyerName, buyerMobile, buyerAddress, idType, idNumber, paymentMethod, dueAmount, notes, searchQuery.
Always transliterate Hindi Devanagari names/models/brands into clean English script.`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-lite',
      contents: cleanText,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
      },
    });

    const parsed = safeParseJson<Record<string, unknown>>((response.text ?? '').trim());
    if (parsed) {
      return { ok: true, data: parsed };
    }
    return { ok: false, status: 502, error: 'Could not parse structured voice response.' };
  } catch (err) {
    return {
      ok: false,
      status: 502,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
