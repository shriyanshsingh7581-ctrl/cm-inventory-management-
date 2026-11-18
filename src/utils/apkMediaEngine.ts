import { Html5Qrcode } from 'html5-qrcode';
import {
  compressImageFileToDataUrl,
  ImeiDeviceSpec,
  lookupImeiSpecs,
} from './imeiDatabase';

// Environment-configured credentials (set VITE_GROQ_API_KEY & VITE_GEMINI_API_KEY in .env / Vercel env vars)
const GROQ_API_KEY = (import.meta.env.VITE_GROQ_API_KEY || '').trim();
const GEMINI_VISION_API_KEY = (import.meta.env.VITE_GEMINI_API_KEY || '').trim();

export interface AiExtractedScanResult {
  imei: string;
  imei2?: string;
  barcode?: string;
  brand?: string;
  model?: string;
  ram?: string;
  storage?: string;
  colour?: string;
  buyingPrice?: number;
  expectedSellingPrice?: number;
  sellerName?: string;
  sellerMobile?: string;
  sellerAddress?: string;
  idType?: string;
  idNumber?: string;
  notes?: string;
  sourceMethod: 'local_barcode' | 'ai_vision_ocr';
}

export interface AiExtractedVoiceResult {
  intent?: 'buy' | 'sell' | 'search' | 'due';
  imei?: string;
  brand?: string;
  model?: string;
  ram?: string;
  storage?: string;
  colour?: string;
  buyingPrice?: number;
  expectedSellingPrice?: number;
  sellingPrice?: number;
  sellerName?: string;
  sellerMobile?: string;
  sellerAddress?: string;
  buyerName?: string;
  buyerMobile?: string;
  buyerAddress?: string;
  idType?: string;
  idNumber?: string;
  paymentMethod?: 'Cash' | 'UPI' | 'Bank Transfer' | 'Part Due';
  dueAmount?: number;
  notes?: string;
  searchQuery?: string;
}

/**
 * Standard GSMA Luhn checksum validation for 15-digit IMEI numbers.
 */
export function isValidImeiLuhn(imei15: string): boolean {
  if (!/^\d{15}$/.test(imei15)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    let d = Number(imei15[i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  return checkDigit === Number(imei15[14]);
}

/**
 * Extracts a valid 15-digit IMEI from any raw string if present.
 * Prefers Luhn-valid 15-digit IMEIs so nearby EAN-13 or serial codes are ignored.
 */
export function extract15DigitImei(rawText: string): string {
  if (!rawText) return '';

  const candidates: string[] = [];

  // 1. Contiguous 15-digit numbers (including next to labels like IMEI1:3569... or /01)
  const contiguousMatches = rawText.match(/(?<!\d)\d{15}(?!\d)/g);
  if (contiguousMatches) {
    candidates.push(...contiguousMatches);
  }

  // 2. Spaced / hyphenated / slashed 15-digit groups (common on *#06# screens and box labels)
  const spacedMatches = rawText.match(/(?<!\d)(?:\d[\s/.-]?){14}\d(?!\d)/g);
  if (spacedMatches) {
    for (const m of spacedMatches) {
      const digits = m.replace(/\D/g, '');
      if (digits.length === 15) {
        candidates.push(digits);
      }
    }
  }

  // 3. Explicit IMEI-labeled lines with up to 16 digits (e.g. IMEI + SVN)
  const imeiLabeled = rawText.match(
    /(?:IMEI\s*[12]?\s*[:#-]?\s*)((?:\d[\s/.-]*){15,16})/gi
  );
  if (imeiLabeled) {
    for (const m of imeiLabeled) {
      const digits = m.replace(/\D/g, '');
      if (digits.length >= 15) {
        candidates.push(digits.slice(0, 15));
      }
    }
  }

  if (candidates.length > 0) {
    const luhnValid = candidates.find((c) => isValidImeiLuhn(c));
    if (luhnValid) return luhnValid;

    const standardPrefix = candidates.find(
      (c) =>
        c.startsWith('35') ||
        c.startsWith('86') ||
        c.startsWith('01') ||
        c.startsWith('99')
    );
    return standardPrefix || candidates[0];
  }

  const allDigits = rawText.replace(/\D/g, '');
  if (allDigits.length === 15) return allDigits;
  return '';
}

/**
 * Helper to convert a canvas to a File for Html5Qrcode.scanFile.
 */
function canvasToJpegFile(
  canvas: HTMLCanvasElement,
  fileName: string,
  quality = 0.92
): Promise<File | null> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          resolve(null);
          return;
        }
        resolve(new File([blob], fileName, { type: 'image/jpeg' }));
      },
      'image/jpeg',
      quality
    );
  });
}

/**
 * Renders an image File onto a properly oriented, crisp canvas (max 1400px)
 * so huge 12MP Android camera photos don't choke ZXing / Html5Qrcode.
 */
async function createNormalizedCanvasFromFile(
  imageFile: File,
  maxDim = 1400
): Promise<HTMLCanvasElement | null> {
  try {
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(imageFile);
      let { width, height } = bitmap;
      if (width > maxDim || height > maxDim) {
        const scale = Math.min(maxDim / width, maxDim / height);
        width = Math.max(1, Math.round(width * scale));
        height = Math.max(1, Math.round(height * scale));
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0, width, height);
      bitmap.close?.();
      return canvas;
    }
  } catch {
    // Fallback to Image element
  }

  return new Promise((resolve) => {
    const url = URL.createObjectURL(imageFile);
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = Math.min(maxDim / width, maxDim / height);
        width = Math.max(1, Math.round(width * scale));
        height = Math.max(1, Math.round(height * scale));
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, width, height);
      }
      URL.revokeObjectURL(url);
      resolve(ctx ? canvas : null);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

/**
 * STEP A: Local Barcode & QR Decode from an image File using:
 * 1) Native `BarcodeDetector` API on full image + center crop
 * 2) `Html5Qrcode.scanFile` on resized JPEG + original file
 */
export async function decodeBarcodeLocallyFromFile(
  imageFile: File
): Promise<string | null> {
  const normalizedCanvas = await createNormalizedCanvasFromFile(imageFile, 1400);

  // 1. Try Native BarcodeDetector first (supports multi-barcode detection on phone boxes!)
  try {
    const WinBarcodeDetector = (
      window as unknown as {
        BarcodeDetector?: new (options?: { formats?: string[] }) => {
          detect: (
            source: ImageBitmap | HTMLCanvasElement
          ) => Promise<Array<{ rawValue?: string }>>;
        };
      }
    ).BarcodeDetector;

    if (WinBarcodeDetector) {
      const detector = new WinBarcodeDetector({
        formats: [
          'code_128',
          'code_39',
          'code_93',
          'ean_13',
          'ean_8',
          'itf',
          'codabar',
          'upc_a',
          'upc_e',
          'qr_code',
          'data_matrix',
          'pdf417',
        ],
      });

      const candidatesToScan: (ImageBitmap | HTMLCanvasElement)[] = [];
      if (normalizedCanvas) {
        candidatesToScan.push(normalizedCanvas);
      } else if (typeof createImageBitmap === 'function') {
        candidatesToScan.push(await createImageBitmap(imageFile));
      }

      const allRawValues: string[] = [];
      for (const source of candidatesToScan) {
        try {
          const results = await detector.detect(source);
          for (const res of results) {
            if (res.rawValue) {
              allRawValues.push(res.rawValue.trim());
            }
          }
        } catch {
          // ignore
        }
      }

      // First look for a true 15-digit IMEI across all detected barcodes on the label
      for (const val of allRawValues) {
        const imei = extract15DigitImei(val);
        if (imei) return imei;
      }
    }
  } catch {
    // Continue to Html5Qrcode.scanFile
  }

  // 2. Try Html5Qrcode.scanFile on normalized canvas JPEG (and original file as backup)
  const tempId = `apk-hidden-qr-reader-${Date.now()}`;
  let tempDiv: HTMLDivElement | null = null;
  try {
    tempDiv = document.createElement('div');
    tempDiv.id = tempId;
    tempDiv.style.position = 'fixed';
    tempDiv.style.left = '-9999px';
    tempDiv.style.top = '-9999px';
    tempDiv.style.width = '10px';
    tempDiv.style.height = '10px';
    document.body.appendChild(tempDiv);

    const html5Qr = new Html5Qrcode(tempId);
    const filesToTry: File[] = [];
    if (normalizedCanvas) {
      const resizedFile = await canvasToJpegFile(
        normalizedCanvas,
        'scan-resized.jpg',
        0.92
      );
      if (resizedFile) filesToTry.push(resizedFile);
    }
    filesToTry.push(imageFile);

    for (const candidateFile of filesToTry) {
      try {
        const decodedText = await html5Qr.scanFile(candidateFile, false);
        if (decodedText) {
          const imei = extract15DigitImei(decodedText);
          if (imei) {
            html5Qr.clear();
            return imei;
          }
        }
      } catch {
        // try next candidate
      }
    }
    html5Qr.clear();
  } catch {
    // Local barcode decode did not find a crisp 1D/2D barcode; AI Vision OCR handles it
  } finally {
    if (tempDiv && tempDiv.parentNode) {
      tempDiv.parentNode.removeChild(tempDiv);
    }
  }

  return null;
}

/**
 * Helper to parse JSON safely from LLM markdown or raw output.
 */
function safeParseJson<T>(raw: string): T | null {
  if (!raw) return null;
  try {
    const cleaned = raw
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim();
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) as T;
    }
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}

function normalizeScanResult(
  parsed: Partial<AiExtractedScanResult> | null,
  rawTextFallback: string
): AiExtractedScanResult | null {
  if (!parsed && !rawTextFallback) return null;
  const rawImei = parsed?.imei || '';
  const cleanImei =
    extract15DigitImei(rawImei) || extract15DigitImei(rawTextFallback);
  const cleanImei2 = extract15DigitImei(parsed?.imei2 || '');
  const tacSpec: ImeiDeviceSpec | null = cleanImei
    ? lookupImeiSpecs(cleanImei)
    : null;

  const cleanBrand = (parsed?.brand || tacSpec?.brand || '').trim().slice(0, 60);
  const cleanModel = (parsed?.model || tacSpec?.model || '').trim().slice(0, 100);
  const cleanRam = normalizeRam(parsed?.ram || tacSpec?.ram || '');
  const cleanStorage = normalizeStorage(
    parsed?.storage || tacSpec?.storage || ''
  );

  if (
    !cleanImei &&
    !cleanImei2 &&
    !cleanBrand &&
    !cleanModel &&
    !parsed?.idNumber &&
    !parsed?.sellerName
  ) {
    return null;
  }

  return {
    imei: cleanImei,
    imei2: cleanImei2 !== cleanImei ? cleanImei2 : '',
    barcode: (parsed?.barcode || cleanImei || '').slice(0, 32),
    brand: cleanBrand,
    model: cleanModel,
    ram: cleanRam,
    storage: cleanStorage,
    colour: (parsed?.colour || tacSpec?.colour || '').trim().slice(0, 40),
    buyingPrice: Number(parsed?.buyingPrice) || 0,
    expectedSellingPrice: Number(parsed?.expectedSellingPrice) || 0,
    sellerName: (parsed?.sellerName || '').trim().slice(0, 120),
    sellerMobile: (parsed?.sellerMobile || '').replace(/\D/g, '').slice(-10),
    sellerAddress: (parsed?.sellerAddress || '').trim().slice(0, 300),
    idType: (parsed?.idType || '').trim().slice(0, 40),
    idNumber: (parsed?.idNumber || '').trim().slice(0, 30),
    notes: (parsed?.notes || '').trim().slice(0, 500),
    sourceMethod: 'ai_vision_ocr',
  };
}

function normalizeRam(raw: string): string {
  if (!raw) return '';
  const m = raw.match(/(\d+)\s*GB/i);
  if (m) return `${m[1]} GB`;
  return raw.trim().slice(0, 20);
}

function normalizeStorage(raw: string): string {
  if (!raw) return '';
  const m = raw.match(/(\d+)\s*(GB|TB)/i);
  if (m) return `${m[1]} ${m[2].toUpperCase()}`;
  return raw.trim().slice(0, 20);
}

/**
 * STEP B: AI Vision OCR via Gemini 2.5 Flash Vision API (Verified 200 OK JSON mode).
 * Reads 15-digit IMEI from:
 * - Mobile phone box IMEI stickers (even blurry barcodes or printed text)
 * - *#06# dialer screenshots / screens
 * - Phone back / SIM tray stickers
 * - Paper bills / invoices & Government ID cards (Aadhaar/PAN/DL)
 */
export async function extractPhoneOrBillViaAiVision(
  imageFileOrDataUrl: File | string
): Promise<AiExtractedScanResult | null> {
  const dataUrl =
    typeof imageFileOrDataUrl === 'string'
      ? imageFileOrDataUrl
      : await compressImageFileToDataUrl(imageFileOrDataUrl, 1280, 0.88);

  const base64Raw = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
  const mimeMatch = dataUrl.match(/^data:([^;]+);base64,/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';

  const systemPrompt = `You are a precision OCR & Mobile Inventory Vision AI for Indian mobile shops.
Carefully inspect every line of text, barcode label, *#06# screen, sticker, paper bill, or ID card in this image.
Find ALL 15-digit IMEI numbers (they are exactly 15 digits, often labeled IMEI, IMEI1, IMEI2, MEID, or printed under barcodes starting with 35, 86, 01, or 99).
Read every single digit carefully without skipping or guessing digits.
Return ONLY a JSON object with these exact keys (use "" for unknown strings, 0 for unknown numbers):
{
  "imei": "exact 15-digit IMEI 1 digits only",
  "imei2": "exact 15-digit IMEI 2 digits only if present",
  "barcode": "barcode or serial number if visible",
  "brand": "One of: Samsung, Apple, Xiaomi, Vivo, Oppo, Realme, OnePlus, Motorola, Nothing, Other (or empty if unknown)",
  "model": "Phone model name if visible (e.g. Galaxy A52, iPhone 13, Redmi Note 12)",
  "ram": "e.g. '4 GB', '6 GB', '8 GB', '12 GB' if visible",
  "storage": "e.g. '64 GB', '128 GB', '256 GB', '512 GB' if visible",
  "colour": "Phone colour if visible",
  "buyingPrice": 0,
  "expectedSellingPrice": 0,
  "sellerName": "Seller/customer name if visible on bill or ID card",
  "sellerMobile": "10-digit mobile number if visible",
  "sellerAddress": "Address if visible on bill or ID card",
  "idType": "Aadhaar, PAN Card, Voter ID, Driving Licence, or Passport if ID card shown",
  "idNumber": "ID number if ID card shown",
  "notes": "Any extra details visible on box or bill"
}`;

  if (!GEMINI_VISION_API_KEY) {
    return null;
  }

  try {
    const geminiResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(
        GEMINI_VISION_API_KEY
      )}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: systemPrompt },
                {
                  inlineData: {
                    mimeType,
                    data: base64Raw,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.1,
          },
        }),
      }
    );

    if (geminiResp.ok) {
      const gData = await geminiResp.json();
      const textOut = gData?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const parsed = safeParseJson<Partial<AiExtractedScanResult>>(textOut);
      const normalized = normalizeScanResult(parsed, textOut);
      if (normalized) {
        return normalized;
      }
    }
  } catch {
    // Network or parse error
  }

  return null;
}

/**
 * Combined Universal Dual-Step Scanner from a captured Camera / Gallery File or Live Video Frame:
 * - Step A: Local Barcode Decode (`BarcodeDetector` + `Html5Qrcode.scanFile`)
 * - Step B: AI Vision OCR (`gemini-2.5-flash` JSON Vision OCR)
 */
export async function scanCapturedPhotoForImeiAndSpecs(
  imageFile: File
): Promise<AiExtractedScanResult> {
  const [localDecoded, aiResult] = await Promise.all([
    decodeBarcodeLocallyFromFile(imageFile),
    extractPhoneOrBillViaAiVision(imageFile),
  ]);

  const localImei = localDecoded ? extract15DigitImei(localDecoded) : '';
  const finalImei = localImei || aiResult?.imei || '';
  const tacSpec = finalImei ? lookupImeiSpecs(finalImei) : null;

  return {
    imei: finalImei,
    imei2: aiResult?.imei2 || '',
    barcode: localDecoded || aiResult?.barcode || finalImei,
    brand: aiResult?.brand || tacSpec?.brand || '',
    model: aiResult?.model || tacSpec?.model || '',
    ram: aiResult?.ram || tacSpec?.ram || '',
    storage: aiResult?.storage || tacSpec?.storage || '',
    colour: aiResult?.colour || tacSpec?.colour || '',
    buyingPrice: aiResult?.buyingPrice || 0,
    expectedSellingPrice: aiResult?.expectedSellingPrice || 0,
    sellerName: aiResult?.sellerName || '',
    sellerMobile: aiResult?.sellerMobile || '',
    sellerAddress: aiResult?.sellerAddress || '',
    idType: aiResult?.idType || '',
    idNumber: aiResult?.idNumber || '',
    notes: aiResult?.notes || '',
    sourceMethod: localImei ? 'local_barcode' : 'ai_vision_ocr',
  };
}

/**
 * LAYER 1 & 2 AUDIO TRANSCRIPTION:
 * Sends recorded audio Blob or native audio File via FormData to Groq's Whisper API (`whisper-large-v3-turbo`).
 */
export async function transcribeAudioWithGroqWhisper(
  audioBlobOrFile: Blob | File
): Promise<string> {
  if (!GROQ_API_KEY) {
    throw new Error('Voice transcription key not configured');
  }
  const formData = new FormData();
  const fileName =
    audioBlobOrFile instanceof File && audioBlobOrFile.name
      ? audioBlobOrFile.name
      : 'voice_recording.webm';

  formData.append('file', audioBlobOrFile, fileName);
  formData.append('model', 'whisper-large-v3-turbo');
  formData.append('language', 'hi');
  formData.append('response_format', 'json');

  const response = await fetch(
    'https://api.groq.com/openai/v1/audio/transcriptions',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: formData,
    }
  );

  if (!response.ok) {
    throw new Error('Transcription failed');
  }

  const data = await response.json();
  return (data?.text || '').trim();
}

/**
 * Parses Hindi / Hinglish / English voice or typed text via Groq (`qwen/qwen3.8-27b`)
 * with Gemini 2.5 Flash fallback to auto-fill Buy Phone, Sell Phone, Stock Search, or Dues fields.
 */
export async function parseVoiceTranscriptWithGroqAi(
  transcript: string,
  context: 'buy_phone' | 'sell_phone' | 'search_stock' | 'dues' | 'general' = 'general'
): Promise<AiExtractedVoiceResult> {
  const cleanText = transcript.trim();
  if (!cleanText) return {};

  const systemInstruction = `You are an intelligent voice-to-form parser for an Indian Used Mobile Inventory & KYC app ("CM Inventory Management").
The user spoke in Hindi, Hinglish (Devanagari or Roman), or English. Context: "${context}".
Convert the user's spoken text into a clean English/transliterated JSON object with these optional fields (omit or set empty if not mentioned):
{
  "intent": "buy" | "sell" | "search" | "due",
  "imei": "15-digit IMEI if spoken",
  "brand": "One of: Samsung, Apple, Xiaomi, Vivo, Oppo, Realme, OnePlus, Motorola, Nothing, Other",
  "model": "Clean model name in English (e.g. 'iPhone 15', 'Galaxy A52', 'Redmi Note 12', 'Vivo Y21')",
  "ram": "One of: '2 GB', '3 GB', '4 GB', '6 GB', '8 GB', '12 GB', '16 GB'",
  "storage": "One of: '32 GB', '64 GB', '128 GB', '256 GB', '512 GB'",
  "colour": "One of: 'Black', 'Blue', 'White', 'Green', 'Gold', 'Silver'",
  "buyingPrice": number,
  "expectedSellingPrice": number,
  "sellingPrice": number,
  "sellerName": "Seller/customer full name in English script",
  "sellerMobile": "10-digit mobile number",
  "sellerAddress": "City/area/address in English script",
  "buyerName": "Buyer full name in English script",
  "buyerMobile": "10-digit mobile number",
  "buyerAddress": "Buyer address in English script",
  "idType": "One of: 'Aadhaar', 'Voter ID', 'Driving Licence', 'PAN Card', 'Passport'",
  "idNumber": "ID number or last 4 digits",
  "paymentMethod": "One of: 'Cash', 'UPI', 'Bank Transfer', 'Part Due'",
  "dueAmount": number,
  "notes": "Any extra details",
  "searchQuery": "Clean English search keyword for model, brand, IMEI, or seller name"
}
Always transliterate Hindi Devanagari names/models/brands into clean English script.`;

  // 1. Primary: Groq active fast JSON model (`qwen/qwen3.8-27b`)
  if (GROQ_API_KEY) {
    try {
      const response = await fetch(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${GROQ_API_KEY}`,
          },
          body: JSON.stringify({
            model: 'qwen/qwen3.8-27b',
            temperature: 0.1,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: systemInstruction },
              { role: 'user', content: cleanText },
            ],
          }),
        }
      );

      if (response.ok) {
        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content || '';
        const parsed = safeParseJson<AiExtractedVoiceResult>(content);
        if (parsed) {
          return parsed;
        }
      }
    } catch {
      // Fall through to Gemini Flash fallback
    }
  }

  // 2. Fallback: Gemini 2.5 Flash JSON mode
  if (GEMINI_VISION_API_KEY) {
    try {
      const gResp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(
          GEMINI_VISION_API_KEY
        )}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: `${systemInstruction}\n\nUser spoken text: ${cleanText}` },
                ],
              },
            ],
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0.1,
            },
          }),
        }
      );
      if (gResp.ok) {
        const gData = await gResp.json();
        const textOut = gData?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const parsed = safeParseJson<AiExtractedVoiceResult>(textOut);
        if (parsed) return parsed;
      }
    } catch {
      // Offline fallback
    }
  }

  // Offline / keyless basic heuristic extraction
  const imeiMatch = extract15DigitImei(cleanText);
  return {
    ...(imeiMatch ? { imei: imeiMatch } : {}),
    searchQuery: cleanText,
    notes: cleanText,
  };
}
