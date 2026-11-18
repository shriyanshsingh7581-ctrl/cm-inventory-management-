import { deleteDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';

export const LEGACY_SEEDED_PHONE_IDS = new Set([
  'phone_oppo_a57',
  'phone_realme_narzo50',
  'phone_samsung_a14',
  'phone_vivo_y21',
  'phone_redmi_note12',
  'phone_iphone_11',
  'phone_samsung_m32',
  'phone_redmi_note11',
  'phone_sold_vivo_v27',
  'phone_sold_oneplus_ce3',
]);

export const LEGACY_SEEDED_KYC_IDS = new Set([
  'kyc_oppo_a57',
  'kyc_realme_narzo50',
  'kyc_samsung_a14',
  'kyc_vivo_y21',
  'kyc_redmi_note12',
  'kyc_iphone_11',
  'kyc_samsung_m32',
  'kyc_redmi_note11',
  'kyc_sold_vivo_v27',
  'kyc_sold_oneplus_ce3',
]);

export const LEGACY_SEEDED_DUE_IDS = new Set(['due_initial_1']);

const LEGACY_PHONE_PREFIXES = [
  'phone_oppo_',
  'phone_realme_',
  'phone_samsung_',
  'phone_vivo_',
  'phone_redmi_',
  'phone_iphone_',
  'phone_oneplus_',
  'phone_sold_',
];

const LEGACY_KYC_PREFIXES = [
  'kyc_oppo_',
  'kyc_realme_',
  'kyc_samsung_',
  'kyc_vivo_',
  'kyc_redmi_',
  'kyc_iphone_',
  'kyc_oneplus_',
  'kyc_sold_',
];

const LEGACY_DUE_PREFIXES = ['due_initial_'];

export function isLegacySeededPhoneId(docId: string): boolean {
  if (LEGACY_SEEDED_PHONE_IDS.has(docId)) return true;
  return LEGACY_PHONE_PREFIXES.some((prefix) => docId.startsWith(prefix));
}

export function isLegacySeededKycId(docId: string): boolean {
  if (LEGACY_SEEDED_KYC_IDS.has(docId)) return true;
  return LEGACY_KYC_PREFIXES.some((prefix) => docId.startsWith(prefix));
}

export function isLegacySeededDueId(docId: string): boolean {
  if (LEGACY_SEEDED_DUE_IDS.has(docId)) return true;
  return LEGACY_DUE_PREFIXES.some((prefix) => docId.startsWith(prefix));
}

/**
 * Removes any legacy auto-seeded mock records from a user's isolated account
 * so that every user only sees their own real inventory, KYC, and dues data.
 */
export async function purgeLegacySeededData(
  userId: string,
  phoneIdsToDelete: string[],
  kycIdsToDelete: string[],
  dueIdsToDelete: string[]
): Promise<void> {
  const deletions: Promise<void>[] = [];

  for (const phoneId of phoneIdsToDelete) {
    deletions.push(
      deleteDoc(doc(db, 'users', userId, 'inventory', phoneId)).catch(() => {})
    );
  }

  for (const kycId of kycIdsToDelete) {
    deletions.push(
      deleteDoc(doc(db, 'users', userId, 'kyc_records', kycId)).catch(() => {})
    );
  }

  for (const dueId of dueIdsToDelete) {
    deletions.push(
      deleteDoc(doc(db, 'users', userId, 'dues', dueId)).catch(() => {})
    );
  }

  if (deletions.length > 0) {
    await Promise.all(deletions);
  }
}
