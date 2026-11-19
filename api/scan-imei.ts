import { runServerImeiVisionOcr } from '../server/geminiService.ts';

interface VercelReq {
  method?: string;
  body?: {
    imageBase64?: string;
    mimeType?: string;
    fastImeiOnly?: boolean;
  };
}

interface VercelRes {
  status: (code: number) => VercelRes;
  json: (body: unknown) => void;
  setHeader: (key: string, value: string) => void;
  end: () => void;
}

export default async function handler(req: VercelReq, res: VercelRes) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { imageBase64, mimeType, fastImeiOnly } = req.body || {};
  const result = await runServerImeiVisionOcr({
    imageBase64: imageBase64 || '',
    mimeType,
    fastImeiOnly: Boolean(fastImeiOnly),
  });

  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  res.status(200).json(result.data);
}
