import { Timestamp } from 'firebase/firestore';

export type ConditionStatus = 'OK' | 'Issue';
export type PhoneGrade = 'A' | 'B' | 'C' | 'D';
export type StockStatus = 'Ready' | 'Under repair' | 'Sold';
export type ShapathLanguage = 'Hindi' | 'English' | 'Both';

export interface UserProfile {
  uid: string;
  email: string;
  shopName: string;
  ownerName: string;
  phone: string;
  city: string;
  planStatus: 'trial' | 'pro';
  trialDaysLeft: number;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface PhoneInventoryItem {
  id: string;
  userId: string;
  stockCode: string;
  noImeiDeadPhone: boolean;
  imei: string;
  imei2: string;
  brand: string;
  model: string;
  ram: string;
  storage: string;
  colour: string;
  photoFront: string;
  photoBack: string;
  photoSides: string;
  photoScreenOn: string;
  accessories: string[];
  conditionScreen: ConditionStatus;
  conditionBody: ConditionStatus;
  conditionCamera: ConditionStatus;
  conditionBiometrics: ConditionStatus;
  conditionCharging: ConditionStatus;
  conditionAudio: ConditionStatus;
  conditionButtons: ConditionStatus;
  batteryHealth: number;
  checksPassed: number;
  grade: PhoneGrade;
  buyingPrice: number;
  expectedSellingPrice: number;
  actualSellingPrice: number;
  expectedProfit: number;
  notes: string;
  sellerName: string;
  sellerMobile: string;
  sellerAddress: string;
  idType: string;
  idMasked: string;
  paymentMethod: string;
  paidAmount: number;
  status: StockStatus;
  sourceType: 'Customer' | 'Dealer';
  buyerName: string;
  buyerMobile: string;
  purchaseDate: string;
  daysInStock: number;
  kycId: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface KycRecord {
  id: string;
  userId: string;
  phoneId: string;
  stockCode: string;
  transactionType: 'BUY' | 'SELL';
  dateLabel: string;
  brand: string;
  model: string;
  ram: string;
  storage: string;
  imei: string;
  price: number;
  paymentMethod: string;
  partyName: string;
  partyMobile: string;
  partyAddress: string;
  idType: string;
  idLast4: string;
  idMasked: string;
  idFrontUrl: string;
  idBackUrl: string;
  sellerPhotoUrl: string;
  signatureDataUrl: string;
  shapathLanguage: ShapathLanguage;
  idVerified: boolean;
  shapathSigned: boolean;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface DueRecord {
  id: string;
  userId: string;
  partyName: string;
  partyMobile: string;
  phoneModel: string;
  amount: number;
  dueType: 'To Receive' | 'To Pay';
  status: 'Pending' | 'Settled';
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface PaymentSplit {
  method: 'Cash' | 'UPI' | 'Bank Transfer';
  amount: number;
}

export interface BuyPhoneDraft {
  noImeiDeadPhone: boolean;
  imei: string;
  showImei2: boolean;
  imei2: string;
  brand: string;
  model: string;
  ram: string;
  storage: string;
  colour: string;
  photoFront: string;
  photoBack: string;
  photoSides: string;
  photoScreenOn: string;
  accessories: string[];
  conditionScreen: ConditionStatus;
  conditionBody: ConditionStatus;
  conditionCamera: ConditionStatus;
  conditionBiometrics: ConditionStatus;
  conditionCharging: ConditionStatus;
  conditionAudio: ConditionStatus;
  conditionButtons: ConditionStatus;
  batteryHealth: number;
  manualGradeOverride: PhoneGrade | null;
  buyingPrice: string;
  expectedSellingPrice: string;
  notes: string;
  sellerMobile: string;
  sellerName: string;
  sellerAddress: string;
  idType: string;
  idRawNumber: string;
  idFrontUrl: string;
  idBackUrl: string;
  sellerPhotoUrl: string;
  signatureDataUrl: string;
  declarationAccepted: boolean;
  shapathLanguage: ShapathLanguage;
  payments: PaymentSplit[];
  sourceType: 'Customer' | 'Dealer';
}
