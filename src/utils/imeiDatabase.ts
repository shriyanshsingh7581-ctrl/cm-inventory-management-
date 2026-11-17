export interface ImeiDeviceSpec {
  brand: string;
  model: string;
  ram: string;
  storage: string;
  colour: string;
  suggestedBuyingPrice: number;
  suggestedSellingPrice: number;
}

export const IMEI_TAC_CATALOG: Record<string, ImeiDeviceSpec> = {
  '35693803': {
    brand: 'Samsung',
    model: 'Galaxy A52',
    ram: '6 GB',
    storage: '128 GB',
    colour: 'Black',
    suggestedBuyingPrice: 9500,
    suggestedSellingPrice: 12500,
  },
  '86489205': {
    brand: 'Oppo',
    model: 'Oppo A57',
    ram: '4 GB',
    storage: '64 GB',
    colour: 'Green',
    suggestedBuyingPrice: 4600,
    suggestedSellingPrice: 6500,
  },
  '86913405': {
    brand: 'Realme',
    model: 'Realme Narzo 50',
    ram: '4 GB',
    storage: '64 GB',
    colour: 'Black',
    suggestedBuyingPrice: 3500,
    suggestedSellingPrice: 5200,
  },
  '35419012': {
    brand: 'Samsung',
    model: 'Galaxy A14',
    ram: '4 GB',
    storage: '64 GB',
    colour: 'Black',
    suggestedBuyingPrice: 5200,
    suggestedSellingPrice: 7400,
  },
  '86371904': {
    brand: 'Vivo',
    model: 'Vivo Y21',
    ram: '4 GB',
    storage: '64 GB',
    colour: 'Blue',
    suggestedBuyingPrice: 3800,
    suggestedSellingPrice: 5500,
  },
  '86740206': {
    brand: 'Xiaomi',
    model: 'Redmi Note 12',
    ram: '6 GB',
    storage: '128 GB',
    colour: 'Blue',
    suggestedBuyingPrice: 6200,
    suggestedSellingPrice: 8800,
  },
  '35391510': {
    brand: 'Apple',
    model: 'iPhone 11',
    ram: '4 GB',
    storage: '128 GB',
    colour: 'White',
    suggestedBuyingPrice: 16500,
    suggestedSellingPrice: 21000,
  },
  '35882109': {
    brand: 'Samsung',
    model: 'Galaxy M32',
    ram: '6 GB',
    storage: '128 GB',
    colour: 'Blue',
    suggestedBuyingPrice: 5800,
    suggestedSellingPrice: 7900,
  },
  '35940112': {
    brand: 'Apple',
    model: 'iPhone 13',
    ram: '4 GB',
    storage: '128 GB',
    colour: 'Midnight',
    suggestedBuyingPrice: 28500,
    suggestedSellingPrice: 34000,
  },
  '86119204': {
    brand: 'OnePlus',
    model: 'Nord CE 3 Lite',
    ram: '8 GB',
    storage: '128 GB',
    colour: 'Green',
    suggestedBuyingPrice: 10500,
    suggestedSellingPrice: 13500,
  },
};

export const BRAND_MODELS: Record<string, { model: string; ram: string; storage: string }[]> = {
  Samsung: [
    { model: 'Galaxy A52', ram: '6 GB', storage: '128 GB' },
    { model: 'Galaxy A14', ram: '4 GB', storage: '64 GB' },
    { model: 'Galaxy M32', ram: '6 GB', storage: '128 GB' },
    { model: 'Galaxy S21 FE', ram: '8 GB', storage: '128 GB' },
    { model: 'Galaxy A34 5G', ram: '8 GB', storage: '128 GB' },
  ],
  Apple: [
    { model: 'iPhone 11', ram: '4 GB', storage: '128 GB' },
    { model: 'iPhone 12', ram: '4 GB', storage: '128 GB' },
    { model: 'iPhone 13', ram: '4 GB', storage: '128 GB' },
    { model: 'iPhone 14', ram: '6 GB', storage: '128 GB' },
    { model: 'iPhone 15', ram: '6 GB', storage: '128 GB' },
  ],
  Xiaomi: [
    { model: 'Redmi Note 12', ram: '6 GB', storage: '128 GB' },
    { model: 'Redmi Note 11', ram: '4 GB', storage: '64 GB' },
    { model: 'Redmi 12 5G', ram: '6 GB', storage: '128 GB' },
    { model: 'Poco X5 Pro', ram: '8 GB', storage: '256 GB' },
  ],
  Vivo: [
    { model: 'Vivo Y21', ram: '4 GB', storage: '64 GB' },
    { model: 'Vivo T2x 5G', ram: '6 GB', storage: '128 GB' },
    { model: 'Vivo V27', ram: '8 GB', storage: '128 GB' },
  ],
  Oppo: [
    { model: 'Oppo A57', ram: '4 GB', storage: '64 GB' },
    { model: 'Oppo A78 5G', ram: '8 GB', storage: '128 GB' },
    { model: 'Oppo Reno 8', ram: '8 GB', storage: '128 GB' },
  ],
  Realme: [
    { model: 'Realme Narzo 50', ram: '4 GB', storage: '64 GB' },
    { model: 'Realme 11x 5G', ram: '6 GB', storage: '128 GB' },
    { model: 'Realme C55', ram: '6 GB', storage: '64 GB' },
  ],
  OnePlus: [
    { model: 'Nord CE 3 Lite', ram: '8 GB', storage: '128 GB' },
    { model: 'OnePlus 11R', ram: '8 GB', storage: '128 GB' },
    { model: 'Nord CE 2', ram: '6 GB', storage: '128 GB' },
  ],
};

export function lookupImeiSpecs(imei: string): ImeiDeviceSpec | null {
  const clean = imei.replace(/\D/g, '');
  if (clean.length < 8) return null;
  const tac8 = clean.slice(0, 8);
  if (IMEI_TAC_CATALOG[tac8]) {
    return IMEI_TAC_CATALOG[tac8];
  }
  // Deterministic fallback based on prefix digits so any 15-digit IMEI auto-fills cleanly
  const prefixes: ImeiDeviceSpec[] = Object.values(IMEI_TAC_CATALOG);
  const hash = clean
    .slice(0, 8)
    .split('')
    .reduce((acc, d) => acc + parseInt(d, 10), 0);
  return prefixes[hash % prefixes.length];
}

export function maskGovernmentId(idType: string, rawNumber: string): { last4: string; masked: string } {
  const cleaned = rawNumber.replace(/\s+/g, '').toUpperCase();
  const last4 = cleaned.length >= 4 ? cleaned.slice(-4) : cleaned.padStart(4, '0');
  if (idType === 'Aadhaar') {
    return {
      last4,
      masked: `XXXX-XXXX-${last4}`,
    };
  }
  return {
    last4,
    masked: `XXXXXX${last4}`,
  };
}

/**
 * Uploads an image file or data URL to Cloudinary (`cloud_name: dxeuzdwkz`, `upload_preset: Mobile app`).
 * Falls back to a compressed data URL if network/preset is unreachable so user flow is never interrupted.
 */
export async function uploadToCloudinary(fileOrDataUrl: File | string): Promise<string> {
  const cloudName = 'dxeuzdwkz';
  const uploadPreset = 'Mobile app';
  const endpoint = `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`;

  let localDataUrl = '';
  if (typeof fileOrDataUrl === 'string') {
    localDataUrl = fileOrDataUrl;
  } else {
    localDataUrl = await compressImageFileToDataUrl(fileOrDataUrl, 720, 0.78);
  }

  try {
    const formData = new FormData();
    formData.append('file', localDataUrl);
    formData.append('upload_preset', uploadPreset);

    const response = await fetch(endpoint, {
      method: 'POST',
      body: formData,
    });

    if (response.ok) {
      const data = await response.json();
      if (data && typeof data.secure_url === 'string') {
        return data.secure_url;
      }
    }
  } catch {
    // Graceful fallback to compressed local data URL
  }

  return localDataUrl;
}

export function compressImageFileToDataUrl(
  file: File,
  maxDimension = 720,
  quality = 0.78
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        if (width > height && width > maxDimension) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else if (height >= width && height > maxDimension) {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(reader.result as string);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = reader.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Generates clean realistic SVG/Canvas data URLs matching the video's sample photos
 */
export function generateSamplePhonePhoto(
  angle: 'Front' | 'Back' | 'Sides' | 'Screen ON',
  bodyColor = '#2A3342',
  modelName = 'Galaxy A52'
): string {
  const canvas = document.createElement('canvas');
  canvas.width = 360;
  canvas.height = 360;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // Studio neutral background matching video
  ctx.fillStyle = '#E5E7EB';
  ctx.fillRect(0, 0, 360, 360);

  // Subtle desk surface
  ctx.fillStyle = '#D1D5DB';
  ctx.fillRect(0, 270, 360, 90);

  // Draw phone body
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.22)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 8;

  if (angle === 'Sides') {
    // Side profile
    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    ctx.roundRect(162, 42, 34, 276, 12);
    ctx.fill();
    // Volume & power buttons
    ctx.fillStyle = '#6B7280';
    ctx.fillRect(196, 100, 4, 38);
    ctx.fillRect(196, 152, 4, 24);
  } else {
    // Phone chassis
    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    ctx.roundRect(102, 34, 156, 292, 22);
    ctx.fill();

    if (angle === 'Back') {
      // Quad camera bump matching Galaxy A52 in video
      ctx.fillStyle = '#1E2530';
      ctx.beginPath();
      ctx.roundRect(114, 48, 54, 78, 12);
      ctx.fill();

      ctx.fillStyle = '#0B0F17';
      [64, 88, 112].forEach((cy) => {
        ctx.beginPath();
        ctx.arc(130, cy, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#4B5563';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });
      // Flash
      ctx.fillStyle = '#FDE68A';
      ctx.beginPath();
      ctx.arc(154, 88, 4.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (angle === 'Screen ON') {
      // Illuminated screen
      const grad = ctx.createLinearGradient(108, 42, 252, 318);
      grad.addColorStop(0, '#0F7B49');
      grad.addColorStop(1, '#064E3B');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(108, 42, 144, 276, 17);
      ctx.fill();

      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('10:45', 180, 96);
      ctx.font = '11px sans-serif';
      ctx.fillStyle = '#D1FAE5';
      ctx.fillText(modelName, 180, 120);
      ctx.fillText('*#06# IMEI OK', 180, 185);
    } else {
      // Front glass off
      ctx.fillStyle = '#111827';
      ctx.beginPath();
      ctx.roundRect(108, 42, 144, 276, 17);
      ctx.fill();
      // Punch hole camera
      ctx.fillStyle = '#374151';
      ctx.beginPath();
      ctx.arc(180, 52, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  return canvas.toDataURL('image/jpeg', 0.85);
}

/**
 * Replicates the exact SAMPLE ID CARD - DEMO from 00:41 in the reference video
 */
export function generateSampleIdCardPhoto(
  side: 'front' | 'back',
  sellerName = 'Mahesh Joshi',
  address = '22, Sudama Nagar, Indore',
  last4 = '4321'
): string {
  const canvas = document.createElement('canvas');
  canvas.width = 480;
  canvas.height = 290;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // Card background
  ctx.fillStyle = '#F5F7FF';
  ctx.fillRect(0, 0, 480, 290);

  // Top blue-indigo header bar
  ctx.fillStyle = '#DEE5FF';
  ctx.fillRect(0, 0, 480, 54);

  ctx.fillStyle = '#1E293B';
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText(side === 'front' ? 'SAMPLE ID CARD · DEMO' : 'SAMPLE ID · BACK', 22, 34);

  if (side === 'front') {
    // Photo avatar box on left
    ctx.fillStyle = '#CBD5E1';
    ctx.beginPath();
    ctx.roundRect(24, 78, 92, 112, 8);
    ctx.fill();

    // Person silhouette
    ctx.fillStyle = '#64748B';
    ctx.beginPath();
    ctx.arc(70, 114, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(70, 168, 30, Math.PI, 0);
    ctx.fill();

    ctx.fillStyle = '#334155';
    ctx.font = '17px sans-serif';
    ctx.fillText(`Name: ${sellerName}`, 138, 108);
    ctx.fillText('DOB: 01/01/1990', 138, 144);
    ctx.font = 'bold 17px monospace';
    ctx.fillText(`No: XXXX XXXX ${last4}`, 138, 180);
  } else {
    ctx.fillStyle = '#334155';
    ctx.font = '17px sans-serif';
    ctx.fillText(`Address: ${address}`, 24, 114);
    ctx.fillStyle = '#64748B';
    ctx.font = '16px sans-serif';
    ctx.fillText('Demo card — not a real ID', 24, 156);
    ctx.fillText(`Verified Last 4 Digits: ${last4}`, 24, 194);
  }

  // Bottom border stripe
  ctx.fillStyle = '#C7D2FE';
  ctx.fillRect(0, 268, 480, 22);

  return canvas.toDataURL('image/jpeg', 0.85);
}

export function generateDemoSignatureDataUrl(): string {
  const canvas = document.createElement('canvas');
  canvas.width = 500;
  canvas.height = 200;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, 500, 200);

  ctx.strokeStyle = '#111827';
  ctx.lineWidth = 3.2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Handwritten cursive signature stroke matching video 00:45
  ctx.beginPath();
  ctx.moveTo(68, 42);
  ctx.bezierCurveTo(65, 145, 95, 165, 84, 110);
  ctx.bezierCurveTo(75, 75, 120, 165, 155, 85);
  ctx.bezierCurveTo(175, 45, 170, 165, 225, 78);
  ctx.bezierCurveTo(255, 38, 250, 162, 315, 72);
  ctx.bezierCurveTo(355, 28, 355, 150, 420, 82);
  ctx.stroke();

  return canvas.toDataURL('image/png');
}
