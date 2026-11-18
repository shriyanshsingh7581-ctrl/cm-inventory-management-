import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  doc,
  getDoc,
  getDocFromServer,
  initializeFirestore,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import firebaseConfig from './firebase-applet-config.json';
import { DueRecord, KycRecord, PhoneInventoryItem, UserProfile } from './types';

const app = initializeApp(firebaseConfig);

// Enable experimentalAutoDetectLongPolling so Firestore writes/reads never hang inside Android System WebView APKs
export const db = initializeFirestore(
  app,
  {
    experimentalAutoDetectLongPolling: true,
  },
  firebaseConfig.firestoreDatabaseId
);

export const auth = getAuth(app);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid ?? null,
      email: auth.currentUser?.email ?? null,
      emailVerified: auth.currentUser?.emailVerified ?? null,
      isAnonymous: auth.currentUser?.isAnonymous ?? null,
      tenantId: auth.currentUser?.tenantId ?? null,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Database Operation Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('the client is offline')
    ) {
      console.error('Please check your network configuration.');
    }
  }
}
void testConnection();

/**
 * Ensures the parent `/users/{userId}` document exists in Firestore before
 * writing to `/users/{userId}/inventory`, `/kyc_records`, or `/dues` so
 * `hasParentShop(userId)` in security rules always succeeds.
 */
const verifiedParentUsers = new Set<string>();

export async function ensureUserShopProfileInDb(
  userId: string,
  profile: UserProfile
): Promise<void> {
  if (!userId || verifiedParentUsers.has(userId)) return;
  const userRef = doc(db, 'users', userId);
  try {
    const snap = await Promise.race([
      getDoc(userRef),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 1800)),
    ]);
    if (snap && snap.exists()) {
      verifiedParentUsers.add(userId);
      return;
    }
    await Promise.race([
      setDoc(userRef, {
        uid: userId,
        email: (profile.email || auth.currentUser?.email || '').slice(0, 254),
        shopName: (profile.shopName || 'My Mobile Shop').trim().slice(0, 120),
        ownerName: (profile.ownerName || 'Shop Owner').trim().slice(0, 120),
        phone: (profile.phone || '').slice(0, 20),
        city: (profile.city || '').slice(0, 200),
        planStatus: profile.planStatus === 'pro' ? 'pro' : 'trial',
        trialDaysLeft:
          typeof profile.trialDaysLeft === 'number'
            ? Math.max(0, Math.min(365, Math.round(profile.trialDaysLeft)))
            : 12,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
      new Promise<void>((resolve) => setTimeout(resolve, 1800)),
    ]);
    verifiedParentUsers.add(userId);
  } catch {
    // Continue even if offline; Firestore local queue will sync when online
  }
}

/**
 * Executes a Firestore write with a fast timeout so Android Web-APK WebViews
 * never hang the "Save / Add Product" button waiting for long-polling ACK.
 */
export async function commitFirestoreWrite(
  writePromise: Promise<unknown>,
  operationType: OperationType,
  path: string,
  timeoutMs = 2500
): Promise<void> {
  let timedOut = false;
  const timerPromise = new Promise<'timeout'>((resolve) => {
    setTimeout(() => {
      timedOut = true;
      resolve('timeout');
    }, timeoutMs);
  });

  try {
    const outcome = await Promise.race([
      writePromise.then(() => 'done' as const),
      timerPromise,
    ]);
    if (outcome === 'timeout') {
      // Allow background completion while logging any eventual permission error
      writePromise.catch((err) => {
        try {
          handleFirestoreError(err, operationType, path);
        } catch {
          // Logged by handleFirestoreError
        }
      });
    }
  } catch (err) {
    if (!timedOut) {
      try {
        handleFirestoreError(err, operationType, path);
      } catch {
        // Logged by handleFirestoreError; do not crash UI when local cache is updated
      }
    }
  }
}

/* ============================================================================
   PER-USER LOCAL CACHE SYNC (Guaranteed Instant Save in Android APK & Web)
============================================================================ */
export interface LocalUserStoreCache {
  shopProfile?: UserProfile;
  inventory: PhoneInventoryItem[];
  kycRecords: KycRecord[];
  dues: DueRecord[];
  deletedPhoneIds?: string[];
}

function getCacheKey(userId: string): string {
  return `cm_inv_user_cache_v2_${userId}`;
}

export function loadLocalUserCache(userId: string): LocalUserStoreCache {
  if (!userId || typeof window === 'undefined') {
    return { inventory: [], kycRecords: [], dues: [], deletedPhoneIds: [] };
  }
  try {
    const raw = window.localStorage.getItem(getCacheKey(userId));
    if (!raw) {
      return { inventory: [], kycRecords: [], dues: [], deletedPhoneIds: [] };
    }
    const parsed = JSON.parse(raw) as Partial<LocalUserStoreCache>;
    return {
      shopProfile: parsed.shopProfile,
      inventory: Array.isArray(parsed.inventory)
        ? parsed.inventory.filter((p) => p && p.userId === userId)
        : [],
      kycRecords: Array.isArray(parsed.kycRecords)
        ? parsed.kycRecords.filter((k) => k && k.userId === userId)
        : [],
      dues: Array.isArray(parsed.dues)
        ? parsed.dues.filter((d) => d && d.userId === userId)
        : [],
      deletedPhoneIds: Array.isArray(parsed.deletedPhoneIds)
        ? parsed.deletedPhoneIds
        : [],
    };
  } catch {
    return { inventory: [], kycRecords: [], dues: [], deletedPhoneIds: [] };
  }
}

export function saveLocalUserCache(
  userId: string,
  patch: Partial<LocalUserStoreCache>
): LocalUserStoreCache {
  const existing = loadLocalUserCache(userId);
  const updated: LocalUserStoreCache = {
    shopProfile: patch.shopProfile ?? existing.shopProfile,
    inventory: patch.inventory ?? existing.inventory,
    kycRecords: patch.kycRecords ?? existing.kycRecords,
    dues: patch.dues ?? existing.dues,
    deletedPhoneIds: patch.deletedPhoneIds ?? existing.deletedPhoneIds ?? [],
  };
  if (userId && typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(getCacheKey(userId), JSON.stringify(updated));
    } catch {
      // If quota exceeded due to large base64 images, strip heavy photo strings in local fallback only
      try {
        const compact: LocalUserStoreCache = {
          ...updated,
          inventory: updated.inventory.map((p) => ({
            ...p,
            photoSides: '',
            photoScreenOn: '',
          })),
          kycRecords: updated.kycRecords.map((k) => ({
            ...k,
            idFrontUrl: '',
            idBackUrl: '',
            sellerPhotoUrl: '',
          })),
        };
        window.localStorage.setItem(getCacheKey(userId), JSON.stringify(compact));
      } catch {
        // Ignore storage error
      }
    }
  }
  return updated;
}

export function upsertLocalPhone(
  userId: string,
  phone: PhoneInventoryItem
): PhoneInventoryItem[] {
  const cache = loadLocalUserCache(userId);
  const filtered = cache.inventory.filter((item) => item.id !== phone.id);
  const next = [phone, ...filtered];
  const deletedIds = (cache.deletedPhoneIds || []).filter((id) => id !== phone.id);
  saveLocalUserCache(userId, { inventory: next, deletedPhoneIds: deletedIds });
  return next;
}

export function removeLocalPhone(
  userId: string,
  phoneId: string
): PhoneInventoryItem[] {
  const cache = loadLocalUserCache(userId);
  const next = cache.inventory.filter((item) => item.id !== phoneId);
  const deletedIds = Array.from(
    new Set([...(cache.deletedPhoneIds || []), phoneId])
  );
  saveLocalUserCache(userId, { inventory: next, deletedPhoneIds: deletedIds });
  return next;
}

export function upsertLocalKyc(
  userId: string,
  kyc: KycRecord
): KycRecord[] {
  const cache = loadLocalUserCache(userId);
  const filtered = cache.kycRecords.filter((item) => item.id !== kyc.id);
  const next = [kyc, ...filtered];
  saveLocalUserCache(userId, { kycRecords: next });
  return next;
}

export function upsertLocalDue(
  userId: string,
  due: DueRecord
): DueRecord[] {
  const cache = loadLocalUserCache(userId);
  const filtered = cache.dues.filter((item) => item.id !== due.id);
  const next = [due, ...filtered];
  saveLocalUserCache(userId, { dues: next });
  return next;
}
