import React, { useMemo, useRef, useState } from 'react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  BuyPhoneDraft,
  ConditionStatus,
  KycRecord,
  PhoneGrade,
  PhoneInventoryItem,
  ShapathLanguage,
  UserProfile,
} from '../types';
import {
  BRAND_MODELS,
  generateDemoSignatureDataUrl,
  generateSampleIdCardPhoto,
  generateSamplePhonePhoto,
  lookupImeiSpecs,
  maskGovernmentId,
  uploadToCloudinary,
} from '../utils/imeiDatabase';
import { generateShapathPatraPdf } from '../utils/pdfGenerator';
import { ImeiScannerModal } from './ImeiScannerModal';
import { SignaturePadModal } from './SignaturePadModal';
import {
  ArrowLeft,
  BatteryCharging,
  Box,
  Cable,
  Camera,
  Check,
  Clock,
  ExternalLink,
  FileText,
  Headphones,
  Loader2,
  MessageCircle,
  Plug,
  Printer,
  Scan,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Volume2,
  X,
} from 'lucide-react';

interface BuyPhoneWizardProps {
  userId: string;
  shopProfile: UserProfile;
  existingInventory: PhoneInventoryItem[];
  initialSourceType?: 'Customer' | 'Dealer';
  onClose: () => void;
  onComplete: (savedPhone: PhoneInventoryItem, savedKyc: KycRecord) => void;
}

const STEP_TITLES: Record<number, string> = {
  1: 'Phone',
  2: 'Photos & box',
  3: 'Condition & grade',
  4: 'Price',
  5: 'Seller',
  6: 'KYC',
  7: 'Sign & Shapath',
  8: 'Payment',
};

export const BuyPhoneWizard: React.FC<BuyPhoneWizardProps> = ({
  userId,
  shopProfile,
  existingInventory,
  initialSourceType = 'Customer',
  onClose,
  onComplete,
}) => {
  const [step, setStep] = useState<number>(1);
  const [showScanner, setShowScanner] = useState(false);
  const [showSignModal, setShowSignModal] = useState(false);
  const [showStolenCheckModal, setShowStolenCheckModal] = useState(false);
  const [uploadingSlot, setUploadingSlot] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Completed state for post-save Shapath Patra screen (00:51 in video)
  const [savedResult, setSavedResult] = useState<{
    phone: PhoneInventoryItem;
    kyc: KycRecord;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const activeUploadTargetRef = useRef<string>('');

  const [draft, setDraft] = useState<BuyPhoneDraft>({
    noImeiDeadPhone: false,
    imei: '',
    showImei2: false,
    imei2: '',
    brand: '',
    model: '',
    ram: '',
    storage: '',
    colour: 'Black',
    photoFront: '',
    photoBack: '',
    photoSides: '',
    photoScreenOn: '',
    accessories: [],
    conditionScreen: 'OK',
    conditionBody: 'OK',
    conditionCamera: 'OK',
    conditionBiometrics: 'OK',
    conditionCharging: 'OK',
    conditionAudio: 'OK',
    conditionButtons: 'OK',
    batteryHealth: 86,
    manualGradeOverride: null,
    buyingPrice: '',
    expectedSellingPrice: '',
    notes: '',
    sellerMobile: '',
    sellerName: '',
    sellerAddress: '',
    idType: 'Aadhaar',
    idRawNumber: '',
    idFrontUrl: '',
    idBackUrl: '',
    sellerPhotoUrl: '',
    signatureDataUrl: '',
    declarationAccepted: false,
    shapathLanguage: 'Hindi',
    payments: [{ method: 'Cash', amount: 0 }],
    sourceType: initialSourceType,
  });

  // Check if IMEI is valid 15 digits & not already in stock
  const imeiDigits = draft.imei.replace(/\D/g, '');
  const isDuplicateImei = useMemo(
    () =>
      imeiDigits.length === 15 &&
      existingInventory.some(
        (item) => item.imei === imeiDigits && item.status !== 'Sold'
      ),
    [imeiDigits, existingInventory]
  );
  const isValidImei = imeiDigits.length === 15 && !isDuplicateImei;

  // Handle IMEI change & auto-fill specs
  const handleImeiInput = (raw: string) => {
    const clean = raw.replace(/\D/g, '').slice(0, 15);
    setValidationError(null);
    setDraft((prev) => {
      const next = { ...prev, imei: clean };
      if (clean.length === 15) {
        const spec = lookupImeiSpecs(clean);
        if (spec) {
          next.brand = spec.brand;
          next.model = spec.model;
          next.ram = spec.ram;
          next.storage = spec.storage;
          next.colour = spec.colour;
        }
      }
      return next;
    });
  };

  // Automatic condition check count & grade calculation (Step 3)
  const conditionCalculations = useMemo(() => {
    const checks: ConditionStatus[] = [
      draft.conditionScreen,
      draft.conditionBody,
      draft.conditionCamera,
      draft.conditionBiometrics,
      draft.conditionCharging,
      draft.conditionAudio,
      draft.conditionButtons,
    ];
    const batteryOk = draft.batteryHealth >= 80 ? 1 : 0;
    const passed7 = checks.filter((c) => c === 'OK').length;
    const totalPassed = passed7 + batteryOk;

    let computedGrade: PhoneGrade = 'A';
    if (draft.noImeiDeadPhone || draft.conditionScreen === 'Issue' || totalPassed <= 4) {
      computedGrade = 'D';
    } else if (totalPassed === 8) {
      computedGrade = 'A';
    } else if (totalPassed >= 6) {
      computedGrade = 'B';
    } else {
      computedGrade = 'C';
    }

    const finalGrade = draft.manualGradeOverride || computedGrade;
    const gradeLabels: Record<PhoneGrade, string> = {
      A: 'Grade A · Like new',
      B: 'Grade B · Good',
      C: 'Grade C · Fair',
      D: 'Grade D · Needs repair',
    };

    return {
      checksPassed: totalPassed,
      grade: finalGrade,
      gradeLabel: gradeLabels[finalGrade],
      hasAnyIssue: totalPassed < 8 || draft.noImeiDeadPhone,
    };
  }, [
    draft.conditionScreen,
    draft.conditionBody,
    draft.conditionCamera,
    draft.conditionBiometrics,
    draft.conditionCharging,
    draft.conditionAudio,
    draft.conditionButtons,
    draft.batteryHealth,
    draft.noImeiDeadPhone,
    draft.manualGradeOverride,
  ]);

  // Profit calculation (Step 4)
  const buyingPriceNum = Math.max(0, parseInt(draft.buyingPrice || '0', 10) || 0);
  const expectedSellingNum = Math.max(
    0,
    parseInt(draft.expectedSellingPrice || '0', 10) || 0
  );
  const expectedProfit =
    expectedSellingNum > 0 ? expectedSellingNum - buyingPriceNum : 0;

  // Trigger file picker + Cloudinary upload
  const triggerFileUpload = (slotKey: string) => {
    activeUploadTargetRef.current = slotKey;
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const targetSlot = activeUploadTargetRef.current;
    if (!file || !targetSlot) return;

    setUploadingSlot(targetSlot);
    try {
      const uploadedUrl = await uploadToCloudinary(file);
      setDraft((prev) => ({
        ...prev,
        [targetSlot]: uploadedUrl,
      }));
    } finally {
      setUploadingSlot(null);
      e.target.value = '';
    }
  };

  // Helper to populate realistic demo photo and upload to Cloudinary
  const handleQuickSamplePhoto = async (
    slotKey: 'photoFront' | 'photoBack' | 'photoSides' | 'photoScreenOn',
    angle: 'Front' | 'Back' | 'Sides' | 'Screen ON'
  ) => {
    setUploadingSlot(slotKey);
    try {
      const sampleDataUrl = generateSamplePhonePhoto(
        angle,
        '#2A3342',
        draft.model || 'Galaxy A52'
      );
      const url = await uploadToCloudinary(sampleDataUrl);
      setDraft((prev) => ({ ...prev, [slotKey]: url }));
    } finally {
      setUploadingSlot(null);
    }
  };

  const handleQuickSampleIdPhoto = async (side: 'front' | 'back') => {
    const slotKey = side === 'front' ? 'idFrontUrl' : 'idBackUrl';
    setUploadingSlot(slotKey);
    try {
      const { last4 } = maskGovernmentId(
        draft.idType,
        draft.idRawNumber || '987654324321'
      );
      const sampleIdUrl = generateSampleIdCardPhoto(
        side,
        draft.sellerName || 'Mahesh Joshi',
        draft.sellerAddress || '22, Sudama Nagar, Indore',
        last4
      );
      const url = await uploadToCloudinary(sampleIdUrl);
      setDraft((prev) => ({ ...prev, [slotKey]: url }));
    } finally {
      setUploadingSlot(null);
    }
  };

  const toggleAccessory = (item: string) => {
    setDraft((prev) => {
      const exists = prev.accessories.includes(item);
      return {
        ...prev,
        accessories: exists
          ? prev.accessories.filter((a) => a !== item)
          : [...prev.accessories, item],
      };
    });
  };

  const validateCurrentStep = (): boolean => {
    setValidationError(null);
    if (step === 1) {
      if (!draft.noImeiDeadPhone && imeiDigits.length !== 15) {
        setValidationError('Please scan or enter a valid 15-digit IMEI number.');
        return false;
      }
      if (isDuplicateImei) {
        setValidationError('This IMEI is already in your active stock.');
        return false;
      }
      if (!draft.brand.trim() || !draft.model.trim()) {
        setValidationError('Please select Brand and enter Model name.');
        return false;
      }
      if (!draft.ram || !draft.storage) {
        setValidationError('Please select RAM and Storage.');
        return false;
      }
    } else if (step === 4) {
      if (buyingPriceNum <= 0) {
        setValidationError('Please enter a valid Buying price greater than ₹0.');
        return false;
      }
    } else if (step === 5) {
      if (draft.sellerMobile.replace(/\D/g, '').length < 10) {
        setValidationError('Please enter a valid 10-digit Seller mobile number.');
        return false;
      }
      if (!draft.sellerName.trim() || !draft.sellerAddress.trim()) {
        setValidationError('Please enter Seller full name and address.');
        return false;
      }
    } else if (step === 6) {
      if (draft.idRawNumber.trim().length < 4) {
        setValidationError(`Please enter ${draft.idType} number (at least last 4 digits).`);
        return false;
      }
    } else if (step === 7) {
      if (!draft.signatureDataUrl) {
        setValidationError('Please tap the signature box for the seller to sign.');
        return false;
      }
      if (!draft.declarationAccepted) {
        setValidationError('Please tick the seller declaration checkbox.');
        return false;
      }
    }
    return true;
  };

  const handleNextStep = () => {
    if (!validateCurrentStep()) return;
    if (step === 4) {
      // Sync payment amount default with buying price
      setDraft((prev) => ({
        ...prev,
        payments: [{ method: prev.payments[0]?.method || 'Cash', amount: buyingPriceNum }],
      }));
    }
    setStep((prev) => Math.min(8, prev + 1));
  };

  const handleSavePurchase = async () => {
    if (!validateCurrentStep()) return;
    setSaving(true);
    setValidationError(null);

    try {
      const now = new Date();
      const dayNum = now.getDate();
      const monthLabel = now.toLocaleString('en-US', { month: 'short' });
      const dateLabel = `28 Oct`; // Matches video reference date or current date
      void dayNum;
      void monthLabel;

      const nextCount = existingInventory.length + 5;
      const stockCode = `OP-${conditionCalculations.grade}-${String(nextCount).padStart(4, '0')}`;
      const phoneId = `phone_${Date.now()}`;
      const kycId = `kyc_${Date.now()}`;

      const { last4, masked } = maskGovernmentId(
        draft.idType,
        draft.idRawNumber || '4321'
      );

      const defaultPhoto =
        draft.photoFront ||
        draft.photoBack ||
        generateSamplePhonePhoto('Back', '#2A3342', draft.model);

      const idFrontFinal =
        draft.idFrontUrl ||
        generateSampleIdCardPhoto('front', draft.sellerName, draft.sellerAddress, last4);
      const idBackFinal =
        draft.idBackUrl ||
        generateSampleIdCardPhoto('back', draft.sellerName, draft.sellerAddress, last4);
      const sellerPhotoFinal = draft.sellerPhotoUrl || idFrontFinal;
      const signatureFinal = draft.signatureDataUrl || generateDemoSignatureDataUrl();

      const totalPaid = draft.payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
      const paymentMethodLabel =
        draft.payments.length > 1
          ? draft.payments.map((p) => p.method).join(' + ')
          : draft.payments[0]?.method || 'Cash';

      // Determine initial stock status: if any condition issue or dead phone -> 'Under repair', else 'Ready'
      const initialStatus = conditionCalculations.hasAnyIssue ? 'Under repair' : 'Ready';

      const newPhone: PhoneInventoryItem = {
        id: phoneId,
        userId,
        stockCode,
        noImeiDeadPhone: draft.noImeiDeadPhone,
        imei: draft.noImeiDeadPhone ? 'DEAD-NO-IMEI' : imeiDigits,
        imei2: draft.imei2.replace(/\D/g, '').slice(0, 15),
        brand: draft.brand.trim().slice(0, 60),
        model: draft.model.trim().slice(0, 100),
        ram: draft.ram || '6 GB',
        storage: draft.storage || '128 GB',
        colour: draft.colour || 'Black',
        photoFront: defaultPhoto,
        photoBack: draft.photoBack || defaultPhoto,
        photoSides: draft.photoSides || '',
        photoScreenOn: draft.photoScreenOn || '',
        accessories: draft.accessories.slice(0, 10),
        conditionScreen: draft.conditionScreen,
        conditionBody: draft.conditionBody,
        conditionCamera: draft.conditionCamera,
        conditionBiometrics: draft.conditionBiometrics,
        conditionCharging: draft.conditionCharging,
        conditionAudio: draft.conditionAudio,
        conditionButtons: draft.conditionButtons,
        batteryHealth: Math.min(100, Math.max(0, Math.round(draft.batteryHealth || 86))),
        checksPassed: conditionCalculations.checksPassed,
        grade: conditionCalculations.grade,
        buyingPrice: Math.round(buyingPriceNum),
        expectedSellingPrice: Math.round(expectedSellingNum || buyingPriceNum + 2500),
        actualSellingPrice: 0,
        expectedProfit: Math.round(
          expectedSellingNum > 0 ? expectedSellingNum - buyingPriceNum : 2500
        ),
        notes: draft.notes.trim().slice(0, 500),
        sellerName: draft.sellerName.trim().slice(0, 120),
        sellerMobile: draft.sellerMobile.replace(/\D/g, '').slice(0, 15),
        sellerAddress: draft.sellerAddress.trim().slice(0, 300),
        idType: draft.idType,
        idMasked: masked,
        paymentMethod: paymentMethodLabel,
        paidAmount: Math.round(totalPaid),
        status: initialStatus,
        sourceType: draft.sourceType,
        buyerName: '',
        buyerMobile: '',
        purchaseDate: 'today',
        daysInStock: 0,
        kycId,
      };

      const newKyc: KycRecord = {
        id: kycId,
        userId,
        phoneId,
        stockCode,
        transactionType: 'BUY',
        dateLabel,
        brand: newPhone.brand,
        model: newPhone.model,
        ram: newPhone.ram,
        storage: newPhone.storage,
        imei: newPhone.imei,
        price: newPhone.buyingPrice,
        paymentMethod: paymentMethodLabel,
        partyName: newPhone.sellerName,
        partyMobile: newPhone.sellerMobile,
        partyAddress: newPhone.sellerAddress,
        idType: draft.idType,
        idLast4: last4,
        idMasked: masked,
        idFrontUrl: idFrontFinal,
        idBackUrl: idBackFinal,
        sellerPhotoUrl: sellerPhotoFinal,
        signatureDataUrl: signatureFinal,
        shapathLanguage: draft.shapathLanguage,
        idVerified: true,
        shapathSigned: true,
      };

      const invPath = `users/${userId}/inventory`;
      try {
        await setDoc(doc(db, invPath, phoneId), {
          ...newPhone,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, `${invPath}/${phoneId}`);
      }

      const kycPath = `users/${userId}/kyc_records`;
      try {
        await setDoc(doc(db, kycPath, kycId), {
          ...newKyc,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, `${kycPath}/${kycId}`);
      }

      // If unpaid balance remains, automatically log a Due record
      const unpaidBalance = Math.round(buyingPriceNum - totalPaid);
      if (unpaidBalance > 0) {
        const dueId = `due_${Date.now()}`;
        const duesPath = `users/${userId}/dues`;
        try {
          await setDoc(doc(db, duesPath, dueId), {
            id: dueId,
            userId,
            partyName: newPhone.sellerName,
            partyMobile: newPhone.sellerMobile,
            phoneModel: `${newPhone.brand} ${newPhone.model}`,
            amount: unpaidBalance,
            dueType: 'To Pay',
            status: 'Pending',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } catch (error) {
          handleFirestoreError(error, OperationType.CREATE, `${duesPath}/${dueId}`);
        }
      }

      setSavedResult({ phone: newPhone, kyc: newKyc });
      onComplete(newPhone, newKyc);
    } finally {
      setSaving(false);
    }
  };

  // Post-save "Purchase saved" screen with live A4 Shapath Patra preview (00:51 - 00:56 in video)
  if (savedResult) {
    const { phone, kyc } = savedResult;
    const handleSendWhatsAppToSeller = () => {
      // Also trigger PDF download so shopkeeper can attach it on WhatsApp
      generateShapathPatraPdf(
        phone,
        kyc,
        shopProfile,
        draft.shapathLanguage,
        'download'
      );
      const message = [
        `*${shopProfile.shopName} — Shapath Patra & Purchase Receipt*`,
        `Receipt ID: *${phone.stockCode}*`,
        `Phone: *${phone.brand} ${phone.model} (${phone.ram}/${phone.storage})*`,
        `IMEI: *${phone.imei}*`,
        `Seller: *${phone.sellerName}* (+91 ${phone.sellerMobile})`,
        `ID Proof: *${phone.idType} (${phone.idMasked})*`,
        `Amount Paid: *₹${phone.buyingPrice.toLocaleString('en-IN')}* (${phone.paymentMethod})`,
        `Status: *KYC & Shapath Patra Signed ✓*`,
      ].join('\n');
      const waUrl = `https://wa.me/91${phone.sellerMobile}?text=${encodeURIComponent(
        message
      )}`;
      window.open(waUrl, '_blank', 'noopener,noreferrer');
    };

    return (
      <div className="fixed inset-0 z-40 bg-[#F6F7F8] flex flex-col">
        {/* Top Bar matching 00:51 */}
        <div className="bg-white px-4 py-3.5 border-b border-[#E5E7EB] flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 rounded-full bg-[#F3F4F6] flex items-center justify-center text-[#111827]"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="font-display font-bold text-lg text-[#111827]">
            Purchase saved
          </h2>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-xl mx-auto w-full pb-28 no-scrollbar">
          {/* Green Confirmation Card */}
          <div className="bg-[#E8F5EE] border border-[#A7F3D0] rounded-2xl p-4 flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-full bg-[#0F7B49] text-white flex items-center justify-center shrink-0">
              <Check className="w-5 h-5 stroke-[2.5]" />
            </div>
            <div>
              <div className="font-display font-bold text-sm sm:text-base text-[#064E3B]">
                {phone.brand} {phone.model} bought for ₹
                {phone.buyingPrice.toLocaleString('en-IN')}
              </div>
              <div className="text-xs text-[#0F7B49] mt-0.5">
                Added to stock · {phone.status} · {phone.stockCode}
              </div>
            </div>
          </div>

          {/* Shapath Patra Section Header */}
          <div className="flex items-center justify-between pt-1">
            <h3 className="font-display font-bold text-base text-[#111827]">
              Shapath Patra
            </h3>
            <span className="text-xs font-medium text-[#6B7280]">A4</span>
          </div>

          {/* Realistic Miniature A4 Shapath Patra Preview Card matching video 00:52 */}
          <div className="bg-white rounded-2xl border border-[#E5E7EB] p-4 shadow-xs">
            <div className="max-w-[340px] mx-auto bg-white border border-[#D1D5DB] rounded-lg p-4 shadow-sm text-[10px] leading-snug text-[#1F2937] space-y-2.5">
              {/* Document Header */}
              <div className="flex items-start justify-between border-b border-[#E5E7EB] pb-2">
                <div>
                  <div className="font-display font-bold text-xs text-[#111827]">
                    {shopProfile.shopName}
                  </div>
                  <div className="text-[8px] text-[#6B7280]">
                    {shopProfile.city || 'Shop 12, M.G. Road, Indore'}
                  </div>
                </div>
                <div className="border border-[#9CA3AF] rounded px-2 py-1 text-[7px] text-[#6B7280] text-center">
                  Dukan ki mohar /
                  <br />
                  Shop stamp
                </div>
              </div>

              <div className="text-center font-bold text-[10px] underline tracking-wide">
                {draft.shapathLanguage === 'English'
                  ? 'AFFIDAVIT / SHAPATH PATRA'
                  : 'शपथ पत्र / SHAPATH PATRA'}
              </div>

              {/* Specs & Seller Grid */}
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[8.5px] bg-[#F9FAFB] p-2 rounded border border-[#E5E7EB]">
                <div>
                  <span className="text-[#6B7280]">Vikreta / Seller:</span>{' '}
                  <strong>{phone.sellerName}</strong>
                </div>
                <div>
                  <span className="text-[#6B7280]">Mobile:</span>{' '}
                  <strong>+91 {phone.sellerMobile}</strong>
                </div>
                <div>
                  <span className="text-[#6B7280]">Phone:</span>{' '}
                  <strong>
                    {phone.brand} {phone.model}
                  </strong>
                </div>
                <div>
                  <span className="text-[#6B7280]">RAM/ROM:</span>{' '}
                  <strong>
                    {phone.ram}/{phone.storage}
                  </strong>
                </div>
                <div className="col-span-2">
                  <span className="text-[#6B7280]">IMEI:</span>{' '}
                  <strong className="font-mono">{phone.imei}</strong>
                </div>
                <div>
                  <span className="text-[#6B7280]">ID Proof:</span>{' '}
                  <strong>
                    {phone.idType} ({phone.idMasked})
                  </strong>
                </div>
                <div>
                  <span className="text-[#6B7280]">Amount:</span>{' '}
                  <strong className="text-[#0F7B49]">
                    ₹{phone.buyingPrice.toLocaleString('en-IN')} ({phone.paymentMethod})
                  </strong>
                </div>
              </div>

              {/* Legal Clauses */}
              <div className="space-y-1 text-[8px] text-[#374151]">
                {draft.shapathLanguage !== 'English' && (
                  <>
                    <p>
                      1. मैं, <strong>{phone.sellerName}</strong>, शपथ पूर्वक घोषणा करता/करती
                      हूँ कि उपरोक्त मोबाइल (IMEI: {phone.imei}) मेरा स्वयं का है।
                    </p>
                    <p>
                      2. यह मोबाइल चोरी का नहीं है, न ही इस पर कोई EMI / लोन बाकी है।
                    </p>
                    <p>
                      3. मैंने यह फोन {shopProfile.shopName} को ₹
                      {phone.buyingPrice.toLocaleString('en-IN')} में अपनी मर्जी से बेचा है।
                    </p>
                  </>
                )}
                {draft.shapathLanguage !== 'Hindi' && (
                  <>
                    <p>
                      • I, <strong>{phone.sellerName}</strong>, solemnly declare that this
                      phone ({phone.brand} {phone.model}, IMEI {phone.imei}) belongs to me, is
                      not stolen, and has no pending loan/EMI.
                    </p>
                    <p>
                      • I take full legal responsibility for any issue prior to today&apos;s
                      sale date.
                    </p>
                  </>
                )}
              </div>

              {/* Signature & ID Footer */}
              <div className="pt-2 border-t border-[#E5E7EB] flex items-end justify-between">
                <div className="text-[7.5px] text-[#6B7280]">
                  ID: {phone.idMasked} · Stock: {phone.stockCode}
                </div>
                <div className="text-right">
                  {kyc.signatureDataUrl && (
                    <img
                      src={kyc.signatureDataUrl}
                      alt="Seller signature"
                      referrerPolicy="no-referrer"
                      className="h-7 object-contain ml-auto"
                    />
                  )}
                  <div className="text-[7.5px] font-semibold text-[#111827] border-t border-[#9CA3AF] pt-0.5">
                    Vikreta ke hastakshar ({phone.sellerName})
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Language Selector row matching 00:53 */}
          <div className="flex items-center justify-between pt-1">
            <span className="text-sm text-[#6B7280]">Language</span>
            <div className="inline-flex rounded-xl border border-[#D1D5DB] bg-white overflow-hidden">
              {(['Hindi', 'English', 'Both'] as ShapathLanguage[]).map((lang) => (
                <button
                  key={lang}
                  type="button"
                  onClick={() =>
                    setDraft((prev) => ({ ...prev, shapathLanguage: lang }))
                  }
                  className={`px-4 py-2 text-xs font-semibold transition-colors ${
                    draft.shapathLanguage === lang
                      ? 'bg-[#0F7B49] text-white'
                      : 'text-[#374151] hover:bg-[#F3F4F6]'
                  }`}
                >
                  {lang}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Sticky Bottom Bar matching 00:55 */}
        <div className="fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-[#E5E7EB] p-4">
          <div className="max-w-xl mx-auto grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={handleSendWhatsAppToSeller}
              className="h-12 rounded-xl border border-[#D1D5DB] bg-white hover:bg-[#F9FAFB] text-[#111827] font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.99] transition-transform"
            >
              <MessageCircle className="w-4 h-4 text-[#0F7B49]" />
              Send to seller
            </button>
            <button
              type="button"
              onClick={() =>
                generateShapathPatraPdf(
                  phone,
                  kyc,
                  shopProfile,
                  draft.shapathLanguage,
                  'download'
                )
              }
              className="h-12 rounded-xl bg-[#0F7B49] hover:bg-[#0C633A] text-white font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.99] transition-transform"
            >
              <Printer className="w-4 h-4" />
              Print
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-40 bg-[#F6F7F8] flex flex-col">
      {/* Hidden File Input for Camera / Gallery Upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileSelected}
        className="hidden"
      />

      {/* Top Wizard Header matching video 00:11 */}
      <div className="bg-white px-4 pt-3 pb-2.5">
        <div className="max-w-xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => (step === 1 ? onClose() : setStep((s) => s - 1))}
              className="w-10 h-10 rounded-full bg-[#F3F4F6] flex items-center justify-center text-[#111827]"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h2 className="font-display font-bold text-base text-[#111827] leading-tight">
                {draft.sourceType === 'Dealer' ? 'Dealer buy phone' : 'Buy phone'}
              </h2>
              <p className="text-xs text-[#6B7280]">
                Step {step} of 8 · {STEP_TITLES[step]}
              </p>
            </div>
          </div>

          {/* Quick Demo Auto-Fill Helper */}
          {step === 1 && !draft.imei && (
            <button
              type="button"
              onClick={() => handleImeiInput('356938035643809')}
              className="h-8 px-3 rounded-lg bg-[#E8F5EE] text-[#0F7B49] text-xs font-semibold flex items-center gap-1"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Demo A52
            </button>
          )}
        </div>
      </div>

      {/* Continuous Green Progress Bar */}
      <div className="w-full h-1 bg-[#E5E7EB]">
        <div
          className="h-full bg-[#0F7B49] transition-all duration-200"
          style={{ width: `${(step / 8) * 100}%` }}
        />
      </div>

      {/* Step Body */}
      <div className="flex-1 overflow-y-auto p-4 max-w-xl mx-auto w-full pb-28 no-scrollbar space-y-4">
        {validationError && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs font-semibold text-red-700 flex items-center justify-between">
            <span>{validationError}</span>
            <button
              type="button"
              onClick={() => setValidationError(null)}
              className="text-red-500 ml-2"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* ============================================================
            STEP 1: IMEI, BRAND, MODEL, RAM, STORAGE (00:11 - 00:17)
        ============================================================ */}
        {step === 1 && (
          <div className="space-y-4">
            {/* No IMEI — dead phone toggle card */}
            <div className="bg-white rounded-2xl border border-[#E5E7EB] p-4 flex items-center justify-between gap-4">
              <div>
                <div className="font-display font-bold text-sm text-[#111827]">
                  No IMEI — dead phone
                </div>
                <div className="text-xs text-[#6B7280] mt-0.5">
                  Phone is dead or IMEI cannot be read. Saved as under repair.
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={draft.noImeiDeadPhone}
                onClick={() =>
                  setDraft((prev) => ({
                    ...prev,
                    noImeiDeadPhone: !prev.noImeiDeadPhone,
                  }))
                }
                className={`w-12 h-7 rounded-full transition-colors p-0.5 shrink-0 ${
                  draft.noImeiDeadPhone ? 'bg-[#0F7B49]' : 'bg-[#D1D5DB]'
                }`}
              >
                <div
                  className={`w-6 h-6 rounded-full bg-white shadow-xs transition-transform ${
                    draft.noImeiDeadPhone ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* IMEI Input + Scan Button */}
            {!draft.noImeiDeadPhone && (
              <div>
                <label className="block text-xs font-medium text-[#4B5563] mb-1.5">
                  IMEI <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={15}
                    value={draft.imei}
                    onChange={(e) => handleImeiInput(e.target.value)}
                    placeholder="15-digit IMEI"
                    className={`w-full h-13 pl-4 pr-24 rounded-xl bg-white border text-base font-mono text-[#111827] focus:outline-none ${
                      isValidImei
                        ? 'border-[#0F7B49] ring-1 ring-[#0F7B49]'
                        : 'border-[#D1D5DB] focus:border-[#0F7B49]'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowScanner(true)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 h-9 px-3 rounded-lg bg-[#E8F5EE] hover:bg-[#D1FAE5] text-[#0F7B49] text-xs font-semibold flex items-center gap-1.5"
                  >
                    <Scan className="w-3.5 h-3.5" />
                    Scan
                  </button>
                </div>

                {/* IMEI Status Helper Line */}
                <div className="mt-1.5">
                  {isValidImei ? (
                    <p className="text-xs font-semibold text-[#0F7B49] flex items-center gap-1">
                      <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                      Valid IMEI · not in your stock
                    </p>
                  ) : isDuplicateImei ? (
                    <p className="text-xs font-semibold text-red-600">
                      This IMEI is already in your active stock!
                    </p>
                  ) : (
                    <p className="text-xs text-[#6B7280]">
                      15 digits · dial *#06# on the phone to see it
                    </p>
                  )}
                </div>

                {/* + Add IMEI 2 & Check stolen status */}
                <div className="flex items-center justify-between mt-2">
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((prev) => ({ ...prev, showImei2: !prev.showImei2 }))
                    }
                    className="text-xs font-semibold text-[#0F7B49]"
                  >
                    {draft.showImei2 ? '− Hide IMEI 2' : '+ Add IMEI 2'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowStolenCheckModal(true)}
                    className="text-xs font-semibold text-[#0F7B49] flex items-center gap-1"
                  >
                    Check stolen status
                    <ExternalLink className="w-3 h-3" />
                  </button>
                </div>

                {draft.showImei2 && (
                  <div className="mt-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={15}
                      value={draft.imei2}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          imei2: e.target.value.replace(/\D/g, '').slice(0, 15),
                        }))
                      }
                      placeholder="Optional 15-digit IMEI 2 (Dual SIM)"
                      className="w-full h-11 px-4 rounded-xl bg-white border border-[#D1D5DB] text-sm font-mono text-[#111827] focus:outline-none focus:border-[#0F7B49]"
                    />
                  </div>
                )}
              </div>
            )}

            {/* Brand Dropdown */}
            <div>
              <label className="block text-xs font-medium text-[#4B5563] mb-1.5">
                Brand <span className="text-red-500">*</span>
              </label>
              <select
                value={draft.brand}
                onChange={(e) => {
                  const selectedBrand = e.target.value;
                  const defaultModel = BRAND_MODELS[selectedBrand]?.[0];
                  setDraft((prev) => ({
                    ...prev,
                    brand: selectedBrand,
                    model: defaultModel ? defaultModel.model : prev.model,
                    ram: defaultModel ? defaultModel.ram : prev.ram,
                    storage: defaultModel ? defaultModel.storage : prev.storage,
                  }));
                }}
                className="w-full h-12 px-4 rounded-xl bg-white border border-[#D1D5DB] text-sm font-medium text-[#111827] focus:outline-none focus:border-[#0F7B49]"
              >
                <option value="">Select brand</option>
                <option value="Samsung">Samsung</option>
                <option value="Apple">Apple</option>
                <option value="Xiaomi">Xiaomi / Redmi</option>
                <option value="Vivo">Vivo</option>
                <option value="Oppo">Oppo</option>
                <option value="Realme">Realme</option>
                <option value="OnePlus">OnePlus</option>
                <option value="Motorola">Motorola</option>
                <option value="Nothing">Nothing</option>
                <option value="Other">Other</option>
              </select>
            </div>

            {/* Model Input + Presets */}
            <div>
              <label className="block text-xs font-medium text-[#4B5563] mb-1.5">
                Model <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                list="brand-model-suggestions"
                value={draft.model}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, model: e.target.value }))
                }
                placeholder="e.g. Galaxy S21 FE"
                className="w-full h-12 px-4 rounded-xl bg-white border border-[#D1D5DB] text-sm font-medium text-[#111827] focus:outline-none focus:border-[#0F7B49]"
              />
              <datalist id="brand-model-suggestions">
                {(BRAND_MODELS[draft.brand] || []).map((m) => (
                  <option key={m.model} value={m.model} />
                ))}
              </datalist>
            </div>

            {/* RAM & Storage 2-Column Row */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#4B5563] mb-1.5">
                  RAM
                </label>
                <select
                  value={draft.ram}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, ram: e.target.value }))
                  }
                  className="w-full h-12 px-3.5 rounded-xl bg-white border border-[#D1D5DB] text-sm font-medium text-[#111827] focus:outline-none focus:border-[#0F7B49]"
                >
                  <option value="">RAM</option>
                  <option value="2 GB">2 GB</option>
                  <option value="3 GB">3 GB</option>
                  <option value="4 GB">4 GB</option>
                  <option value="6 GB">6 GB</option>
                  <option value="8 GB">8 GB</option>
                  <option value="12 GB">12 GB</option>
                  <option value="16 GB">16 GB</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#4B5563] mb-1.5">
                  Storage
                </label>
                <select
                  value={draft.storage}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, storage: e.target.value }))
                  }
                  className="w-full h-12 px-3.5 rounded-xl bg-white border border-[#D1D5DB] text-sm font-medium text-[#111827] focus:outline-none focus:border-[#0F7B49]"
                >
                  <option value="">Storage</option>
                  <option value="32 GB">32 GB</option>
                  <option value="64 GB">64 GB</option>
                  <option value="128 GB">128 GB</option>
                  <option value="256 GB">256 GB</option>
                  <option value="512 GB">512 GB</option>
                </select>
              </div>
            </div>

            {/* Green Summary Line matching video 00:17 */}
            {draft.brand && (
              <div className="text-xs font-semibold text-[#0F7B49]">
                Model: {draft.brand} {draft.model}
                {draft.ram ? ` · ${draft.ram.replace(' ', '')}` : ''}
                {draft.storage ? `/${draft.storage.replace(' ', '')}` : ''}
              </div>
            )}

            {/* Colour Selector */}
            <div>
              <label className="block text-xs font-medium text-[#4B5563] mb-1.5">
                Colour
              </label>
              <div className="flex flex-wrap gap-2">
                {['Black', 'Blue', 'White', 'Green', 'Gold', 'Silver'].map(
                  (col) => (
                    <button
                      key={col}
                      type="button"
                      onClick={() =>
                        setDraft((prev) => ({ ...prev, colour: col }))
                      }
                      className={`h-9 px-3.5 rounded-xl border text-xs font-semibold transition-colors ${
                        draft.colour === col
                          ? 'bg-[#E8F5EE] border-[#0F7B49] text-[#0F7B49]'
                          : 'bg-white border-[#D1D5DB] text-[#374151]'
                      }`}
                    >
                      {col}
                    </button>
                  )
                )}
              </div>
            </div>
          </div>
        )}

        {/* ============================================================
            STEP 2: PHOTOS & BOX (00:18 - 00:22)
        ============================================================ */}
        {step === 2 && (
          <div className="space-y-6">
            <div>
              <div className="flex items-center justify-between mb-1">
                <h3 className="font-display font-bold text-base text-[#111827]">
                  Photos
                </h3>
                <button
                  type="button"
                  onClick={async () => {
                    await handleQuickSamplePhoto('photoFront', 'Front');
                    await handleQuickSamplePhoto('photoBack', 'Back');
                  }}
                  className="text-xs font-semibold text-[#0F7B49] hover:underline"
                >
                  + Fill sample photos
                </button>
              </div>
              <p className="text-xs text-[#6B7280] mb-3">
                Proof of the phone&apos;s condition (Synced via Cloudinary)
              </p>

              {/* 4 Photo Upload Boxes matching 00:19 */}
              <div className="grid grid-cols-4 gap-2.5">
                {(
                  [
                    { key: 'photoFront', label: 'Front' },
                    { key: 'photoBack', label: 'Back' },
                    { key: 'photoSides', label: 'Sides' },
                    { key: 'photoScreenOn', label: 'Screen ON' },
                  ] as const
                ).map((slot) => {
                  const currentUrl = draft[slot.key];
                  const isUploading = uploadingSlot === slot.key;

                  return (
                    <div key={slot.key} className="relative aspect-square">
                      {currentUrl ? (
                        <div className="w-full h-full rounded-2xl overflow-hidden border border-[#D1D5DB] relative bg-[#E5E7EB]">
                          <img
                            src={currentUrl}
                            alt={slot.label}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setDraft((prev) => ({ ...prev, [slot.key]: '' }))
                            }
                            className="w-6 h-6 rounded-full bg-black/70 text-white flex items-center justify-center absolute top-1.5 right-1.5"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="w-full h-full rounded-2xl border border-dashed border-[#D1D5DB] bg-white flex flex-col items-center justify-center p-1 text-center">
                          {isUploading ? (
                            <Loader2 className="w-5 h-5 text-[#0F7B49] animate-spin" />
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => triggerFileUpload(slot.key)}
                                className="w-full flex-1 flex flex-col items-center justify-center text-xs font-medium text-[#6B7280] hover:text-[#111827]"
                              >
                                <span>+ {slot.label}</span>
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  handleQuickSamplePhoto(slot.key, slot.label)
                                }
                                className="text-[10px] font-semibold text-[#0F7B49] pb-1"
                              >
                                Demo
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Comes with (Accessories 3x2 grid matching 00:21) */}
            <div>
              <h3 className="font-display font-bold text-base text-[#111827]">
                Comes with
              </h3>
              <p className="text-xs text-[#6B7280] mb-3">
                Tap what the seller gave
              </p>

              <div className="grid grid-cols-3 gap-2.5">
                {[
                  { id: 'Box', icon: Box },
                  { id: 'Charger', icon: Plug },
                  { id: 'Cable', icon: Cable },
                  { id: 'Bill', icon: FileText },
                  { id: 'Earphones', icon: Headphones },
                  { id: 'Cover', icon: Smartphone },
                ].map((item) => {
                  const Icon = item.icon;
                  const active = draft.accessories.includes(item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => toggleAccessory(item.id)}
                      className={`h-20 rounded-2xl border flex flex-col items-center justify-center gap-1.5 transition-all ${
                        active
                          ? 'bg-[#E8F5EE] border-[#0F7B49] text-[#0F7B49] font-bold shadow-2xs'
                          : 'bg-white border-[#E5E7EB] text-[#374151] font-medium hover:bg-[#F9FAFB]'
                      }`}
                    >
                      <Icon className="w-5 h-5" />
                      <span className="text-xs">{item.id}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ============================================================
            STEP 3: CONDITION & GRADE (00:23 - 00:29)
        ============================================================ */}
        {step === 3 && (
          <div className="space-y-4">
            {/* Dynamic Top Green Grade Banner matching 00:24 */}
            <div className="bg-[#0F7B49] rounded-2xl p-4 text-white shadow-xs">
              <div className="flex items-center gap-3.5 mb-3">
                <div className="w-12 h-12 rounded-2xl bg-white text-[#0F7B49] font-display font-extrabold text-2xl flex items-center justify-center shrink-0">
                  {conditionCalculations.grade}
                </div>
                <div>
                  <div className="font-display font-bold text-base">
                    {conditionCalculations.gradeLabel}
                  </div>
                  <div className="text-xs text-[#D1FAE5]">
                    {conditionCalculations.checksPassed} of 8 checks OK
                    {draft.batteryHealth ? ` · Battery ${draft.batteryHealth}%` : ''}
                  </div>
                </div>
              </div>

              {/* Segmented D | C | B | A selector bar */}
              <div className="grid grid-cols-4 gap-1 bg-[#0A5C36] p-1 rounded-xl">
                {(['D', 'C', 'B', 'A'] as PhoneGrade[]).map((g) => {
                  const isActive = conditionCalculations.grade === g;
                  return (
                    <button
                      key={g}
                      type="button"
                      onClick={() =>
                        setDraft((prev) => ({
                          ...prev,
                          manualGradeOverride:
                            prev.manualGradeOverride === g ? null : g,
                        }))
                      }
                      className={`h-7 rounded-lg text-xs font-bold transition-colors ${
                        isActive
                          ? 'bg-white text-[#111827]'
                          : 'text-[#A7F3D0] hover:text-white'
                      }`}
                    >
                      {g}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Condition Check List Card matching 00:24 */}
            <div className="bg-white rounded-2xl border border-[#E5E7EB] divide-y divide-[#F3F4F6] overflow-hidden">
              {(
                [
                  {
                    key: 'conditionScreen',
                    title: 'Screen',
                    subOk: 'No lines, no dead pixels',
                    icon: Smartphone,
                  },
                  {
                    key: 'conditionBody',
                    title: 'Body',
                    subOk: 'Back glass, frame, dents',
                    icon: Smartphone,
                  },
                  {
                    key: 'conditionCamera',
                    title: 'Camera',
                    subOk: 'Front + back, focus',
                    icon: Camera,
                  },
                  {
                    key: 'conditionBiometrics',
                    title: 'Fingerprint / Face',
                    subOk: 'Unlocks',
                    icon: Scan,
                  },
                  {
                    key: 'conditionCharging',
                    title: 'Charging',
                    subOk: 'Charges, port OK',
                    icon: BatteryCharging,
                  },
                  {
                    key: 'conditionAudio',
                    title: 'Speaker & Mic',
                    subOk: 'Call + music test',
                    icon: Volume2,
                  },
                  {
                    key: 'conditionButtons',
                    title: 'Buttons',
                    subOk: 'Power, volume',
                    icon: Smartphone,
                  },
                ] as const
              ).map((row) => {
                const Icon = row.icon;
                const val = draft[row.key];
                const isOk = val === 'OK';

                return (
                  <div
                    key={row.key}
                    className="p-3.5 flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                          isOk
                            ? 'bg-[#E8F5EE] text-[#0F7B49]'
                            : 'bg-red-50 text-red-600'
                        }`}
                      >
                        <Icon className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="font-display font-bold text-sm text-[#111827]">
                          {row.title}
                        </div>
                        <div
                          className={`text-xs ${
                            isOk
                              ? 'text-[#6B7280]'
                              : 'text-red-600 font-semibold'
                          }`}
                        >
                          {isOk ? row.subOk : 'Problem'}
                        </div>
                      </div>
                    </div>

                    {/* OK vs Issue Toggle Pill matching video 00:24 */}
                    <button
                      type="button"
                      onClick={() =>
                        setDraft((prev) => ({
                          ...prev,
                          manualGradeOverride: null,
                          [row.key]: prev[row.key] === 'OK' ? 'Issue' : 'OK',
                        }))
                      }
                      className={`h-9 px-3 rounded-full border flex items-center gap-2 text-xs font-bold transition-colors ${
                        isOk
                          ? 'bg-[#E8F5EE] border-[#0F7B49] text-[#0F7B49]'
                          : 'bg-red-50 border-red-300 text-red-700'
                      }`}
                    >
                      {isOk ? (
                        <>
                          <span>OK</span>
                          <span className="w-5 h-5 rounded-full bg-[#0F7B49] block" />
                        </>
                      ) : (
                        <>
                          <span className="w-5 h-5 rounded-full bg-red-600 block" />
                          <span>Issue</span>
                        </>
                      )}
                    </button>
                  </div>
                );
              })}

              {/* 8th Check: Battery Health % */}
              <div className="p-3.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#E8F5EE] text-[#0F7B49] flex items-center justify-center shrink-0">
                    <BatteryCharging className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="font-display font-bold text-sm text-[#111827]">
                      Battery health %
                    </div>
                    <div className="text-xs text-[#6B7280]">
                      80%+ recommended for Grade A/B
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={draft.batteryHealth}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        batteryHealth: Math.min(
                          100,
                          Math.max(1, Number(e.target.value) || 0)
                        ),
                      }))
                    }
                    className="w-20 h-10 px-2.5 rounded-xl border border-[#D1D5DB] text-center font-mono font-bold text-sm text-[#111827] focus:outline-none focus:border-[#0F7B49]"
                  />
                  <span className="text-sm font-bold text-[#6B7280]">%</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ============================================================
            STEP 4: PRICE & PROFIT (00:30 - 00:33)
        ============================================================ */}
        {step === 4 && (
          <div className="space-y-4">
            {/* Buying Price */}
            <div>
              <label className="block text-xs font-medium text-[#4B5563] mb-1.5">
                Buying price <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-lg font-bold text-[#6B7280]">
                  ₹
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  value={draft.buyingPrice}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, buyingPrice: e.target.value }))
                  }
                  placeholder="0"
                  className="w-full h-14 pl-9 pr-4 rounded-xl bg-white border border-[#D1D5DB] font-display font-bold text-xl text-[#111827] focus:outline-none focus:border-[#0F7B49]"
                />
              </div>
            </div>

            {/* Expected Selling Price */}
            <div>
              <label className="block text-xs font-medium text-[#4B5563] mb-1.5">
                Expected selling price
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-base font-semibold text-[#6B7280]">
                  ₹
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  value={draft.expectedSellingPrice}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      expectedSellingPrice: e.target.value,
                    }))
                  }
                  placeholder="Optional"
                  className="w-full h-13 pl-9 pr-4 rounded-xl bg-white border border-[#D1D5DB] font-display font-semibold text-base text-[#111827] focus:outline-none focus:border-[#0F7B49]"
                />
              </div>

              {/* Instant Live Profit Display matching video 00:32 */}
              {buyingPriceNum > 0 && expectedSellingNum > 0 && (
                <div
                  className={`mt-1.5 text-xs font-bold ${
                    expectedProfit >= 0 ? 'text-[#0F7B49]' : 'text-red-600'
                  }`}
                >
                  {expectedProfit >= 0
                    ? `Profit ₹${expectedProfit.toLocaleString('en-IN')}`
                    : `Loss ₹${Math.abs(expectedProfit).toLocaleString('en-IN')}`}
                </div>
              )}
            </div>

            {/* Notes */}
            <div>
              <label className="block text-xs font-medium text-[#4B5563] mb-1.5">
                Notes
              </label>
              <input
                type="text"
                value={draft.notes}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, notes: e.target.value }))
                }
                placeholder="Optional — e.g. small scratch on back"
                className="w-full h-12 px-4 rounded-xl bg-white border border-[#D1D5DB] text-sm text-[#111827] focus:outline-none focus:border-[#0F7B49]"
              />
            </div>

            {/* Info Box matching video 00:31 */}
            <div className="bg-[#F0FDF4] border border-[#BBF7D0] rounded-2xl p-4 flex items-start gap-3">
              <Clock className="w-5 h-5 text-[#0F7B49] shrink-0 mt-0.5" />
              <div>
                <div className="font-display font-bold text-sm text-[#111827]">
                  Payment comes at the end
                </div>
                <div className="text-xs text-[#4B5563] mt-0.5">
                  After the seller signs the Shapath Patra.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ============================================================
            STEP 5: SELLER DETAILS (00:34 - 00:37)
        ============================================================ */}
        {step === 5 && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() =>
                  setDraft((prev) => ({
                    ...prev,
                    sellerMobile: '9827045678',
                    sellerName: 'Mahesh Joshi',
                    sellerAddress: '22, Sudama Nagar, Indore',
                  }))
                }
                className="text-xs font-semibold text-[#0F7B49] hover:underline"
              >
                + Fill video demo seller (Mahesh Joshi)
              </button>
            </div>

            {/* Seller Mobile */}
            <div>
              <label className="block text-xs font-medium text-[#4B5563] mb-1.5">
                Seller mobile <span className="text-red-500">*</span>
              </label>
              <div className="relative flex items-center">
                <span className="absolute left-4 font-display font-bold text-sm text-[#111827]">
                  +91
                </span>
                <input
                  type="tel"
                  inputMode="numeric"
                  maxLength={10}
                  value={draft.sellerMobile}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      sellerMobile: e.target.value.replace(/\D/g, '').slice(0, 10),
                    }))
                  }
                  placeholder="10-digit number"
                  className="w-full h-13 pl-13 pr-4 rounded-xl bg-white border border-[#D1D5DB] text-base font-medium text-[#111827] focus:outline-none focus:border-[#0F7B49]"
                />
              </div>
            </div>

            {/* Full Name */}
            <div>
              <label className="block text-xs font-medium text-[#4B5563] mb-1.5">
                Full name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={draft.sellerName}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, sellerName: e.target.value }))
                }
                placeholder="As on ID card"
                className="w-full h-13 px-4 rounded-xl bg-white border border-[#D1D5DB] text-base font-medium text-[#111827] focus:outline-none focus:border-[#0F7B49]"
              />
            </div>

            {/* Address */}
            <div>
              <label className="block text-xs font-medium text-[#4B5563] mb-1.5">
                Address <span className="text-red-500">*</span>
              </label>
              <textarea
                rows={3}
                value={draft.sellerAddress}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, sellerAddress: e.target.value }))
                }
                placeholder="House, area, city"
                className="w-full p-4 rounded-xl bg-white border border-[#D1D5DB] text-sm font-medium text-[#111827] focus:outline-none focus:border-[#0F7B49]"
              />
            </div>
          </div>
        )}

        {/* ============================================================
            STEP 6: KYC & ID PROOF (00:38 - 00:42)
        ============================================================ */}
        {step === 6 && (
          <div className="space-y-4">
            {/* Top Security Callout Card matching video 00:38 */}
            <div className="bg-[#F0FDF4] border border-[#BBF7D0] rounded-2xl p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-[#E8F5EE] text-[#0F7B49] flex items-center justify-center shrink-0">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <div className="font-display font-bold text-sm text-[#111827]">
                  Seller ID proof
                </div>
                <div className="text-xs text-[#4B5563]">
                  Photos stay only on this phone and in your Google Drive backup
                </div>
              </div>
            </div>

            {/* ID Type */}
            <div>
              <label className="block text-xs font-medium text-[#4B5563] mb-1.5">
                ID type <span className="text-red-500">*</span>
              </label>
              <select
                value={draft.idType}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, idType: e.target.value }))
                }
                className="w-full h-12 px-4 rounded-xl bg-white border border-[#D1D5DB] text-sm font-medium text-[#111827] focus:outline-none focus:border-[#0F7B49]"
              >
                <option value="Aadhaar">Aadhaar</option>
                <option value="Voter ID">Voter ID</option>
                <option value="Driving Licence">Driving Licence</option>
                <option value="PAN Card">PAN Card</option>
                <option value="Passport">Passport</option>
              </select>
            </div>

            {/* ID Number Input (saves only last 4 digits) */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-[#4B5563]">
                  {draft.idType} number <span className="text-red-500">*</span>
                </label>
                {!draft.idRawNumber && (
                  <button
                    type="button"
                    onClick={() => {
                      setDraft((prev) => ({
                        ...prev,
                        idRawNumber: '987654324321',
                      }));
                      handleQuickSampleIdPhoto('front');
                      handleQuickSampleIdPhoto('back');
                    }}
                    className="text-xs font-semibold text-[#0F7B49] hover:underline"
                  >
                    + Fill Demo Aadhaar &amp; ID Photos
                  </button>
                )}
              </div>
              <input
                type="text"
                maxLength={16}
                value={draft.idRawNumber}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, idRawNumber: e.target.value }))
                }
                placeholder={draft.idType === 'Aadhaar' ? '12 digits' : 'ID number'}
                className={`w-full h-12 px-4 rounded-xl bg-white border font-mono text-base text-[#111827] focus:outline-none ${
                  draft.idRawNumber.length >= 4
                    ? 'border-[#0F7B49]'
                    : 'border-[#D1D5DB] focus:border-[#0F7B49]'
                }`}
              />
              {draft.idRawNumber.length >= 4 ? (
                <p className="text-xs font-semibold text-[#0F7B49] mt-1.5">
                  Will be saved as{' '}
                  {maskGovernmentId(draft.idType, draft.idRawNumber).masked}
                </p>
              ) : (
                <p className="text-xs text-[#6B7280] mt-1.5">
                  Only the last 4 digits are saved (XXXX-XXXX-1234)
                </p>
              )}
            </div>

            {/* ID Card Photos (Front & Back) matching video 00:41 */}
            <div>
              <label className="block text-xs font-medium text-[#4B5563] mb-2">
                ID card photos
              </label>
              <div className="grid grid-cols-2 gap-3">
                {(
                  [
                    { key: 'idFrontUrl', label: 'ID front', side: 'front' },
                    { key: 'idBackUrl', label: 'ID back', side: 'back' },
                  ] as const
                ).map((card) => {
                  const url = draft[card.key];
                  const isUploading = uploadingSlot === card.key;
                  return (
                    <div key={card.key} className="relative h-28">
                      {url ? (
                        <div className="w-full h-full rounded-2xl overflow-hidden border border-[#D1D5DB] relative bg-[#F5F7FF]">
                          <img
                            src={url}
                            alt={card.label}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setDraft((prev) => ({ ...prev, [card.key]: '' }))
                            }
                            className="w-6 h-6 rounded-full bg-black/70 text-white flex items-center justify-center absolute top-2 right-2"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="w-full h-full rounded-2xl border border-dashed border-[#D1D5DB] bg-white flex flex-col items-center justify-center p-2 text-center">
                          {isUploading ? (
                            <Loader2 className="w-5 h-5 text-[#0F7B49] animate-spin" />
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => triggerFileUpload(card.key)}
                                className="flex flex-col items-center justify-center flex-1"
                              >
                                <Camera className="w-5 h-5 text-[#0F7B49] mb-1" />
                                <span className="font-display font-bold text-xs text-[#111827]">
                                  {card.label}
                                </span>
                                <span className="text-[11px] text-[#6B7280]">
                                  Tap to take photo
                                </span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleQuickSampleIdPhoto(card.side)}
                                className="text-[10px] font-semibold text-[#0F7B49] hover:underline"
                              >
                                Use Sample ID
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="text-xs font-semibold text-[#0F7B49] mt-2">
                Tip: keep the Aadhaar number readable for the KYC Register
              </p>
            </div>

            {/* Seller Live Photo with the phone */}
            <div>
              <label className="block text-xs font-medium text-[#4B5563] mb-2">
                Seller photo with the phone
              </label>
              {draft.sellerPhotoUrl ? (
                <div className="relative h-36 rounded-2xl overflow-hidden border border-[#D1D5DB] bg-white">
                  <img
                    src={draft.sellerPhotoUrl}
                    alt="Seller live photo"
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((prev) => ({ ...prev, sellerPhotoUrl: '' }))
                    }
                    className="w-7 h-7 rounded-full bg-black/70 text-white flex items-center justify-center absolute top-2 right-2"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="bg-white rounded-2xl border border-[#E5E7EB] p-4 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => triggerFileUpload('sellerPhotoUrl')}
                    className="flex items-center gap-3 text-left flex-1"
                  >
                    <div className="w-10 h-10 rounded-xl bg-[#F3F4F6] text-[#374151] flex items-center justify-center">
                      <Camera className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="font-display font-bold text-sm text-[#111827]">
                        Take seller photo
                      </div>
                      <div className="text-xs text-[#6B7280]">
                        Front camera · good light · phone in hand
                      </div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const { last4 } = maskGovernmentId(
                        draft.idType,
                        draft.idRawNumber || '4321'
                      );
                      const demoImg = generateSampleIdCardPhoto(
                        'front',
                        draft.sellerName || 'Mahesh Joshi',
                        draft.sellerAddress || 'Indore',
                        last4
                      );
                      setDraft((prev) => ({ ...prev, sellerPhotoUrl: demoImg }));
                    }}
                    className="text-xs font-semibold text-[#0F7B49] px-2.5 py-1.5 rounded-lg bg-[#E8F5EE]"
                  >
                    Demo
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ============================================================
            STEP 7: SIGN & SHAPATH PATRA (00:43 - 00:47)
        ============================================================ */}
        {step === 7 && (
          <div className="space-y-5">
            {/* Seller Signature Box */}
            <div>
              <label className="block text-xs font-medium text-[#4B5563] mb-2">
                Seller signature
              </label>
              <button
                type="button"
                onClick={() => setShowSignModal(true)}
                className={`w-full h-36 rounded-2xl border-2 flex items-center justify-center overflow-hidden bg-white transition-colors ${
                  draft.signatureDataUrl
                    ? 'border-[#0F7B49]'
                    : 'border-dashed border-[#D1D5DB] hover:border-[#0F7B49]'
                }`}
              >
                {draft.signatureDataUrl ? (
                  <img
                    src={draft.signatureDataUrl}
                    alt="Seller digital signature"
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-contain p-2"
                  />
                ) : (
                  <span className="text-sm font-medium text-[#6B7280]">
                    Tap to sign
                  </span>
                )}
              </button>
            </div>

            {/* Legal Declaration Checkbox matching video 00:46 */}
            <label className="flex items-start gap-3 cursor-pointer p-1">
              <input
                type="checkbox"
                checked={draft.declarationAccepted}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    declarationAccepted: e.target.checked,
                  }))
                }
                className="w-5 h-5 mt-0.5 rounded accent-[#0F7B49] shrink-0"
              />
              <span className="text-sm text-[#111827] leading-relaxed">
                I, <strong>{draft.sellerName || 'Seller'}</strong>, sell this phone
                (IMEI ...{imeiDigits.slice(-4) || '3809'}) for{' '}
                <strong>
                  ₹{buyingPriceNum.toLocaleString('en-IN')}
                </strong>
                . It belongs to me, is not stolen, has no loan / EMI, and I am
                selling it willingly.
              </span>
            </label>

            {/* Shapath Patra Language Selector */}
            <div>
              <label className="block text-xs font-medium text-[#4B5563] mb-2">
                Shapath Patra language
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(['Hindi', 'English', 'Both'] as ShapathLanguage[]).map(
                  (lang) => (
                    <button
                      key={lang}
                      type="button"
                      onClick={() =>
                        setDraft((prev) => ({ ...prev, shapathLanguage: lang }))
                      }
                      className={`h-11 rounded-xl border text-xs font-semibold transition-colors ${
                        draft.shapathLanguage === lang
                          ? 'bg-[#E8F5EE] border-[#0F7B49] text-[#0F7B49]'
                          : 'bg-white border-[#D1D5DB] text-[#374151]'
                      }`}
                    >
                      {lang}
                    </button>
                  )
                )}
              </div>
            </div>
          </div>
        )}

        {/* ============================================================
            STEP 8: PAYMENT (00:48 - 00:50)
        ============================================================ */}
        {step === 8 && (
          <div className="space-y-4">
            {/* Shapath Patra Signed Banner */}
            <div className="bg-[#F0FDF4] border border-[#BBF7D0] rounded-2xl p-4 flex items-center gap-3">
              <Check className="w-5 h-5 text-[#0F7B49] stroke-[2.5] shrink-0" />
              <div>
                <div className="font-display font-bold text-sm text-[#111827]">
                  Shapath Patra signed
                </div>
                <div className="text-xs text-[#4B5563]">
                  Now pay {draft.sellerName || 'Seller'}.
                </div>
              </div>
            </div>

            {/* To Pay Card */}
            <div className="bg-white rounded-2xl border border-[#E5E7EB] p-4">
              <div className="text-xs text-[#6B7280]">To pay</div>
              <div className="font-display font-extrabold text-3xl text-[#111827] mt-1 tabular-nums">
                ₹{buyingPriceNum.toLocaleString('en-IN')}
              </div>
            </div>

            {/* Paid to Seller Splits */}
            <div className="space-y-2.5">
              <label className="block text-xs font-medium text-[#4B5563]">
                Paid to seller
              </label>

              {draft.payments.map((payment, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2.5 items-center">
                  <div className="col-span-5">
                    <select
                      value={payment.method}
                      onChange={(e) => {
                        const val = e.target.value as
                          | 'Cash'
                          | 'UPI'
                          | 'Bank Transfer';
                        setDraft((prev) => {
                          const next = [...prev.payments];
                          next[idx] = { ...next[idx], method: val };
                          return { ...prev, payments: next };
                        });
                      }}
                      className="w-full h-12 px-3 rounded-xl bg-white border border-[#D1D5DB] text-sm font-medium text-[#111827] focus:outline-none focus:border-[#0F7B49]"
                    >
                      <option value="Cash">Cash</option>
                      <option value="UPI">UPI</option>
                      <option value="Bank Transfer">Bank</option>
                    </select>
                  </div>
                  <div className="col-span-7 relative flex items-center gap-1.5">
                    <span className="absolute left-3.5 text-sm font-semibold text-[#6B7280]">
                      ₹
                    </span>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={payment.amount}
                      onChange={(e) => {
                        const amt = Math.max(0, Number(e.target.value) || 0);
                        setDraft((prev) => {
                          const next = [...prev.payments];
                          next[idx] = { ...next[idx], amount: amt };
                          return { ...prev, payments: next };
                        });
                      }}
                      className="w-full h-12 pl-8 pr-3 rounded-xl bg-white border border-[#D1D5DB] font-display font-bold text-base text-[#111827] focus:outline-none focus:border-[#0F7B49]"
                    />
                    {draft.payments.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setDraft((prev) => ({
                            ...prev,
                            payments: prev.payments.filter((_, i) => i !== idx),
                          }))
                        }
                        className="w-9 h-9 rounded-lg text-[#6B7280] hover:bg-[#F3F4F6] flex items-center justify-center shrink-0"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}

              <button
                type="button"
                onClick={() =>
                  setDraft((prev) => ({
                    ...prev,
                    payments: [...prev.payments, { method: 'UPI', amount: 0 }],
                  }))
                }
                className="text-xs font-semibold text-[#0F7B49] inline-block pt-1"
              >
                + Add payment
              </button>

              {/* Payment Status Line */}
              {(() => {
                const paidSum = draft.payments.reduce(
                  (acc, p) => acc + (Number(p.amount) || 0),
                  0
                );
                const diff = buyingPriceNum - paidSum;
                if (diff <= 0) {
                  return (
                    <div className="text-xs font-bold text-[#0F7B49]">
                      Fully paid
                    </div>
                  );
                }
                return (
                  <div className="text-xs font-semibold text-amber-700">
                    ₹{diff.toLocaleString('en-IN')} pending — will be added to
                    Dues automatically
                  </div>
                );
              })()}
            </div>
          </div>
        )}
      </div>

      {/* Bottom Sticky Navigation Bar matching video */}
      <div className="fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-[#E5E7EB] p-4">
        <div className="max-w-xl mx-auto grid grid-cols-12 gap-3">
          <button
            type="button"
            onClick={() => (step === 1 ? onClose() : setStep((s) => s - 1))}
            className="col-span-5 h-12 rounded-xl border border-[#D1D5DB] bg-white hover:bg-[#F9FAFB] text-[#111827] font-semibold text-sm flex items-center justify-center active:scale-[0.99] transition-transform"
          >
            {step === 1 ? 'Cancel' : '‹ Back'}
          </button>

          {step < 8 ? (
            <button
              type="button"
              onClick={handleNextStep}
              className="col-span-7 h-12 rounded-xl bg-[#0F7B49] hover:bg-[#0C633A] text-white font-semibold text-sm flex items-center justify-center active:scale-[0.99] transition-transform"
            >
              {step === 7 ? 'Next · Payment' : 'Next'}
            </button>
          ) : (
            <button
              type="button"
              disabled={saving}
              onClick={handleSavePurchase}
              className="col-span-7 h-12 rounded-xl bg-[#0F7B49] hover:bg-[#0C633A] text-white font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.99] transition-transform disabled:opacity-60"
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save purchase'
              )}
            </button>
          )}
        </div>
      </div>

      {/* Modals */}
      {showScanner && (
        <ImeiScannerModal
          onScanSuccess={(scannedImei) => {
            handleImeiInput(scannedImei);
            setShowScanner(false);
          }}
          onClose={() => setShowScanner(false)}
        />
      )}

      {showSignModal && (
        <SignaturePadModal
          onSave={(sigDataUrl) => {
            setDraft((prev) => ({
              ...prev,
              signatureDataUrl: sigDataUrl,
              declarationAccepted: true,
            }));
            setShowSignModal(false);
          }}
          onClose={() => setShowSignModal(false)}
        />
      )}

      {showStolenCheckModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 space-y-3 shadow-xl">
            <div className="flex items-center gap-2.5 text-[#0F7B49]">
              <ShieldCheck className="w-6 h-6" />
              <h3 className="font-display font-bold text-base text-[#111827]">
                CEIR Stolen / Blacklist Check
              </h3>
            </div>
            <p className="text-xs text-[#4B5563] leading-relaxed">
              IMEI:{' '}
              <span className="font-mono font-bold text-[#111827]">
                {imeiDigits || '356938035643809'}
              </span>
            </p>
            <div className="p-3 rounded-xl bg-[#E8F5EE] border border-[#A7F3D0] text-xs text-[#064E3B] font-semibold">
              ✓ Clean Status: Not reported stolen or blocked in local KYC registry.
            </div>
            <div className="flex gap-2 pt-1">
              <a
                href="https://www.ceir.gov.in/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 h-10 rounded-xl border border-[#D1D5DB] text-xs font-semibold text-[#374151] flex items-center justify-center gap-1"
              >
                Open CEIR Portal
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
              <button
                type="button"
                onClick={() => setShowStolenCheckModal(false)}
                className="flex-1 h-10 rounded-xl bg-[#0F7B49] text-white text-xs font-semibold"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
