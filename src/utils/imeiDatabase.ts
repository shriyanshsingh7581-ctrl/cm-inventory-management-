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
  return null;
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

  // Ensure fallback DataURL stays safely under Firestore 150,000-byte field size limit
  if (typeof fileOrDataUrl !== 'string' && localDataUrl.length > 130000) {
    localDataUrl = await compressImageFileToDataUrl(fileOrDataUrl, 480, 0.55);
  }
  if (localDataUrl.length > 145000 && typeof fileOrDataUrl !== 'string') {
    localDataUrl = await compressImageFileToDataUrl(fileOrDataUrl, 360, 0.45);
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
