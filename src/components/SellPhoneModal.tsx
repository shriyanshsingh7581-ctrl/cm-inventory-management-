import React, { useState } from 'react';
import { doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { PhoneInventoryItem, UserProfile } from '../types';
import { maskGovernmentId } from '../utils/imeiDatabase';
import { generateSaleBillPdf } from '../utils/pdfGenerator';
import {
  AiExtractedVoiceResult,
  extractPhoneOrBillViaAiVision,
} from '../utils/apkMediaEngine';
import { ImeiScannerModal } from './ImeiScannerModal';
import { ApkVoiceButton } from './SmartVoiceModal';
import {
  ArrowLeft,
  Camera,
  Check,
  FileText,
  Loader2,
  MessageCircle,
  Scan,
  Smartphone,
} from 'lucide-react';

interface SellPhoneModalProps {
  userId: string;
  shopProfile: UserProfile;
  inventory: PhoneInventoryItem[];
  preselectedPhone?: PhoneInventoryItem | null;
  onClose: () => void;
}

export const SellPhoneModal: React.FC<SellPhoneModalProps> = ({
  userId,
  shopProfile,
  inventory,
  preselectedPhone = null,
  onClose,
}) => {
  const availablePhones = inventory.filter((p) => p.status !== 'Sold');
  const [selectedPhoneId, setSelectedPhoneId] = useState<string>(
    preselectedPhone?.id || availablePhones[0]?.id || ''
  );
  const selectedPhone =
    availablePhones.find((p) => p.id === selectedPhoneId) || null;

  const [sellingPrice, setSellingPrice] = useState<string>(
    selectedPhone ? String(selectedPhone.expectedSellingPrice) : ''
  );

  React.useEffect(() => {
    if (!selectedPhoneId && availablePhones.length > 0) {
      const first = preselectedPhone || availablePhones[0];
      setSelectedPhoneId(first.id);
      setSellingPrice(String(first.expectedSellingPrice));
    }
  }, [availablePhones, preselectedPhone, selectedPhoneId]);
  const [buyerName, setBuyerName] = useState('');
  const [buyerMobile, setBuyerMobile] = useState('');
  const [buyerAddress, setBuyerAddress] = useState('');
  const [buyerIdNumber, setBuyerIdNumber] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'Cash' | 'UPI' | 'Part Due'>(
    'Cash'
  );
  const [dueAmount, setDueAmount] = useState<string>('0');
  const [saving, setSaving] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [scanNotice, setScanNotice] = useState<string | null>(null);
  const [scanningBuyerId, setScanningBuyerId] = useState(false);
  const buyerIdCameraRef = React.useRef<HTMLInputElement | null>(null);
  const [soldSuccess, setSoldSuccess] = useState<{
    phone: PhoneInventoryItem;
    price: number;
    profit: number;
    buyerName: string;
    buyerMobile: string;
  } | null>(null);

  const handleSelectPhone = (id: string) => {
    setSelectedPhoneId(id);
    const found = availablePhones.find((p) => p.id === id);
    if (found) {
      setSellingPrice(String(found.expectedSellingPrice));
    }
  };

  const handleApplyVoiceToSale = (voice: AiExtractedVoiceResult) => {
    if (voice.imei) {
      const matchByImei = availablePhones.find((p) => p.imei === voice.imei);
      if (matchByImei) handleSelectPhone(matchByImei.id);
    } else if (voice.model) {
      const q = voice.model.toLowerCase();
      const matchByModel = availablePhones.find((p) =>
        `${p.brand} ${p.model}`.toLowerCase().includes(q)
      );
      if (matchByModel) handleSelectPhone(matchByModel.id);
    }
    const priceVal = voice.sellingPrice || voice.buyingPrice;
    if (priceVal && priceVal > 0) setSellingPrice(String(priceVal));
    if (voice.buyerName || voice.sellerName) {
      setBuyerName(voice.buyerName || voice.sellerName || '');
    }
    if (voice.buyerMobile || voice.sellerMobile) {
      setBuyerMobile(
        (voice.buyerMobile || voice.sellerMobile || '')
          .replace(/\D/g, '')
          .slice(-10)
      );
    }
    if (voice.buyerAddress || voice.sellerAddress) {
      setBuyerAddress(voice.buyerAddress || voice.sellerAddress || '');
    }
    if (voice.idNumber) {
      setBuyerIdNumber(voice.idNumber.replace(/\D/g, '').slice(-4));
    }
    if (
      voice.paymentMethod === 'Cash' ||
      voice.paymentMethod === 'UPI' ||
      voice.paymentMethod === 'Part Due'
    ) {
      setPaymentMethod(voice.paymentMethod);
    }
    if (voice.dueAmount && voice.dueAmount > 0) {
      setPaymentMethod('Part Due');
      setDueAmount(String(voice.dueAmount));
    }
  };

  const handleBuyerIdPhotoCaptured = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setScanningBuyerId(true);
    try {
      const ocr = await extractPhoneOrBillViaAiVision(file);
      if (ocr) {
        if (ocr.sellerName && !buyerName) setBuyerName(ocr.sellerName);
        if (ocr.sellerAddress && !buyerAddress) setBuyerAddress(ocr.sellerAddress);
        if (ocr.idNumber) {
          setBuyerIdNumber(ocr.idNumber.replace(/\D/g, '').slice(-4));
        }
      }
    } finally {
      setScanningBuyerId(false);
    }
  };

  const sellPriceNum = Math.max(0, parseInt(sellingPrice || '0', 10) || 0);
  const profitNum = selectedPhone ? sellPriceNum - selectedPhone.buyingPrice : 0;

  const handleCompleteSale = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPhone || sellPriceNum <= 0 || !buyerName.trim()) return;

    setSaving(true);
    try {
      const invDocPath = `users/${userId}/inventory/${selectedPhone.id}`;
      try {
        await updateDoc(doc(db, 'users', userId, 'inventory', selectedPhone.id), {
          status: 'Sold',
          actualSellingPrice: sellPriceNum,
          expectedProfit: profitNum,
          buyerName: buyerName.trim().slice(0, 120),
          buyerMobile: buyerMobile.replace(/\D/g, '').slice(0, 15),
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, invDocPath);
      }

      // Log SELL transaction in KYC Register
      const kycId = `kyc_sell_${Date.now()}`;
      const { last4, masked } = maskGovernmentId(
        'Aadhaar',
        buyerIdNumber.trim() || '0000'
      );
      const nowLabel = new Date().toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
      });

      const kycPath = `users/${userId}/kyc_records`;
      try {
        await setDoc(doc(db, kycPath, kycId), {
          id: kycId,
          userId,
          phoneId: selectedPhone.id,
          stockCode: selectedPhone.stockCode,
          transactionType: 'SELL',
          dateLabel: nowLabel,
          brand: selectedPhone.brand,
          model: selectedPhone.model,
          ram: selectedPhone.ram,
          storage: selectedPhone.storage,
          imei: selectedPhone.imei,
          price: sellPriceNum,
          paymentMethod,
          partyName: buyerName.trim().slice(0, 120),
          partyMobile: buyerMobile.replace(/\D/g, '').slice(0, 15),
          partyAddress: buyerAddress.trim().slice(0, 300),
          idType: 'Aadhaar',
          idLast4: last4,
          idMasked: masked,
          idFrontUrl: '',
          idBackUrl: '',
          sellerPhotoUrl: '',
          signatureDataUrl: '',
          shapathLanguage: 'Hindi',
          idVerified: true,
          shapathSigned: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, `${kycPath}/${kycId}`);
      }

      // If Part Due selected, create a To Receive due
      const pendingAmt = Math.max(0, parseInt(dueAmount || '0', 10) || 0);
      if (paymentMethod === 'Part Due' && pendingAmt > 0) {
        const dueId = `due_sale_${Date.now()}`;
        const duesPath = `users/${userId}/dues`;
        try {
          await setDoc(doc(db, duesPath, dueId), {
            id: dueId,
            userId,
            partyName: buyerName.trim().slice(0, 120),
            partyMobile: buyerMobile.replace(/\D/g, '').slice(0, 15),
            phoneModel: `${selectedPhone.brand} ${selectedPhone.model}`,
            amount: pendingAmt,
            dueType: 'To Receive',
            status: 'Pending',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } catch (error) {
          handleFirestoreError(error, OperationType.CREATE, `${duesPath}/${dueId}`);
        }
      }

      setSoldSuccess({
        phone: selectedPhone,
        price: sellPriceNum,
        profit: profitNum,
        buyerName: buyerName.trim(),
        buyerMobile: buyerMobile.replace(/\D/g, '').slice(0, 10),
      });
    } finally {
      setSaving(false);
    }
  };

  if (soldSuccess) {
    return (
      <div className="fixed inset-0 h-dvh z-50 bg-[#F6F7F8] flex flex-col">
        <div className="bg-white px-4 py-3.5 border-b border-[#E5E7EB] flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 rounded-full bg-[#F3F4F6] flex items-center justify-center text-[#111827]"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="font-display font-bold text-lg text-[#111827]">
            Sale completed
          </h2>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto touch-pan-y p-4 max-w-md mx-auto w-full space-y-4">
          <div className="bg-[#E8F5EE] border border-[#A7F3D0] rounded-2xl p-5 text-center space-y-2">
            <div className="w-12 h-12 rounded-full bg-[#0F7B49] text-white flex items-center justify-center mx-auto">
              <Check className="w-6 h-6 stroke-[2.5]" />
            </div>
            <h3 className="font-display font-bold text-lg text-[#064E3B]">
              {soldSuccess.phone.brand} {soldSuccess.phone.model} Sold!
            </h3>
            <p className="text-sm text-[#0F7B49] font-semibold">
              Sale Price: ₹{soldSuccess.price.toLocaleString('en-IN')} · Profit: ₹
              {soldSuccess.profit.toLocaleString('en-IN')}
            </p>
            <p className="text-xs text-[#374151]">
              Buyer: {soldSuccess.buyerName} (+91 {soldSuccess.buyerMobile})
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => {
                const msg = `*${shopProfile.shopName} — Sale Bill*\nPhone: ${soldSuccess.phone.brand} ${soldSuccess.phone.model}\nIMEI: ${soldSuccess.phone.imei}\nBuyer: ${soldSuccess.buyerName}\nAmount: ₹${soldSuccess.price.toLocaleString('en-IN')}\nThank you!`;
                window.open(
                  `https://wa.me/91${soldSuccess.buyerMobile}?text=${encodeURIComponent(
                    msg
                  )}`,
                  '_blank',
                  'noopener,noreferrer'
                );
              }}
              className="h-12 rounded-xl border border-[#D1D5DB] bg-white font-semibold text-xs text-[#111827] flex items-center justify-center gap-2"
            >
              <MessageCircle className="w-4 h-4 text-[#0F7B49]" />
              WhatsApp Bill
            </button>
            <button
              type="button"
              onClick={() =>
                generateSaleBillPdf(
                  soldSuccess.phone,
                  shopProfile,
                  soldSuccess.buyerName,
                  soldSuccess.buyerMobile,
                  soldSuccess.price,
                  paymentMethod
                )
              }
              className="h-12 rounded-xl bg-[#0F7B49] text-white font-semibold text-xs flex items-center justify-center gap-2"
            >
              <FileText className="w-4 h-4" />
              Download Bill PDF
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-full h-11 rounded-xl bg-[#111827] text-white font-semibold text-xs"
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 h-dvh z-50 bg-[#F6F7F8] flex flex-col">
      <input
        ref={buyerIdCameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleBuyerIdPhotoCaptured}
        className="hidden"
      />

      <div className="bg-white px-4 py-3.5 border-b border-[#E5E7EB] flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 rounded-full bg-[#F3F4F6] flex items-center justify-center text-[#111827] shrink-0"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <h2 className="font-display font-bold text-base text-[#111827] truncate">
              Sell phone from stock
            </h2>
            <p className="text-xs text-[#6B7280] truncate">
              Generates customer bill &amp; updates Today&apos;s profit
            </p>
          </div>
        </div>

        <ApkVoiceButton
          context="sell_phone"
          label="AI Voice"
          compact
          onResult={handleApplyVoiceToSale}
        />
      </div>

      {availablePhones.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-[#E8F5EE] text-[#0F7B49] flex items-center justify-center">
            <Smartphone className="w-6 h-6" />
          </div>
          <h3 className="font-display font-bold text-base text-[#111827]">
            No phones available in stock
          </h3>
          <p className="text-xs text-[#6B7280] max-w-xs">
            First add a phone using the &quot;Buy phone&quot; button on the Home screen, then you can sell it here.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="h-11 px-5 rounded-xl bg-[#0F7B49] text-white text-xs font-semibold"
          >
            Back to Home
          </button>
        </div>
      ) : (
        <form
          onSubmit={handleCompleteSale}
          className="flex-1 min-h-0 overflow-y-auto touch-pan-y p-4 max-w-xl mx-auto w-full space-y-4 pb-28 no-scrollbar"
        >
          {/* Select Phone from Stock + IMEI Scan */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-medium text-[#4B5563]">
                Select phone in stock <span className="text-red-500">*</span>
              </label>
              <button
                type="button"
                onClick={() => setShowScanner(true)}
                className="text-xs font-semibold text-[#0F7B49] flex items-center gap-1"
              >
                <Scan className="w-3.5 h-3.5" />
                Scan IMEI
              </button>
            </div>
            <select
              value={selectedPhoneId}
              onChange={(e) => {
                setScanNotice(null);
                handleSelectPhone(e.target.value);
              }}
              className="w-full h-12 px-3.5 rounded-xl bg-white border border-[#D1D5DB] text-sm font-semibold text-[#111827] focus:outline-none focus:border-[#0F7B49]"
            >
              {availablePhones.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.brand} {p.model} ({p.ram}/{p.storage}) · Cost ₹
                  {p.buyingPrice.toLocaleString('en-IN')} · IMEI ...{p.imei.slice(-4)}
                </option>
              ))}
            </select>
            {scanNotice && (
              <p className="text-xs font-semibold text-amber-700 mt-1.5">
                {scanNotice}
              </p>
            )}
          </div>

          {selectedPhone && (
            <div className="bg-white rounded-2xl border border-[#E5E7EB] p-3.5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-[#E8F5EE] text-[#0F7B49] flex items-center justify-center">
                  <Smartphone className="w-5 h-5" />
                </div>
                <div>
                  <div className="font-display font-bold text-sm text-[#111827]">
                    {selectedPhone.brand} {selectedPhone.model}
                  </div>
                  <div className="text-xs text-[#6B7280]">
                    Bought for ₹{selectedPhone.buyingPrice.toLocaleString('en-IN')} ·
                    Grade {selectedPhone.grade}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[11px] text-[#6B7280]">Expected</div>
                <div className="font-display font-bold text-sm text-[#0F7B49]">
                  ₹{selectedPhone.expectedSellingPrice.toLocaleString('en-IN')}
                </div>
              </div>
            </div>
          )}

          {/* Selling Price */}
          <div>
            <label className="block text-xs font-medium text-[#4B5563] mb-1.5">
              Final selling price (₹) <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              required
              value={sellingPrice}
              onChange={(e) => setSellingPrice(e.target.value)}
              className="w-full h-13 px-4 rounded-xl bg-white border border-[#D1D5DB] font-display font-bold text-lg text-[#111827] focus:outline-none focus:border-[#0F7B49]"
            />
            {selectedPhone && sellPriceNum > 0 && (
              <div
                className={`text-xs font-bold mt-1.5 ${
                  profitNum >= 0 ? 'text-[#0F7B49]' : 'text-red-600'
                }`}
              >
                {profitNum >= 0
                  ? `Net Profit on this sale: +₹${profitNum.toLocaleString('en-IN')}`
                  : `Net Loss: -₹${Math.abs(profitNum).toLocaleString('en-IN')}`}
              </div>
            )}
          </div>

          {/* Buyer Details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#4B5563] mb-1.5">
                Buyer full name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={buyerName}
                onChange={(e) => setBuyerName(e.target.value)}
                placeholder="Enter buyer name"
                className="w-full h-12 px-4 rounded-xl bg-white border border-[#D1D5DB] text-sm text-[#111827] focus:outline-none focus:border-[#0F7B49]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#4B5563] mb-1.5">
                Buyer mobile <span className="text-red-500">*</span>
              </label>
              <input
                type="tel"
                required
                maxLength={10}
                value={buyerMobile}
                onChange={(e) =>
                  setBuyerMobile(e.target.value.replace(/\D/g, '').slice(0, 10))
                }
                placeholder="10-digit mobile"
                className="w-full h-12 px-4 rounded-xl bg-white border border-[#D1D5DB] text-sm text-[#111827] focus:outline-none focus:border-[#0F7B49]"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium text-[#4B5563]">
                  Buyer ID last 4 digits
                </label>
                <button
                  type="button"
                  disabled={scanningBuyerId}
                  onClick={() => buyerIdCameraRef.current?.click()}
                  className="text-[11px] font-semibold text-[#0F7B49] flex items-center gap-1"
                >
                  {scanningBuyerId ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Camera className="w-3 h-3" />
                  )}
                  Scan ID
                </button>
              </div>
              <input
                type="text"
                maxLength={4}
                value={buyerIdNumber}
                onChange={(e) =>
                  setBuyerIdNumber(e.target.value.replace(/\D/g, '').slice(0, 4))
                }
                placeholder="Last 4 digits"
                className="w-full h-12 px-4 rounded-xl bg-white border border-[#D1D5DB] font-mono text-sm text-[#111827]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#4B5563] mb-1.5">
                Payment mode
              </label>
              <select
                value={paymentMethod}
                onChange={(e) =>
                  setPaymentMethod(e.target.value as 'Cash' | 'UPI' | 'Part Due')
                }
                className="w-full h-12 px-3.5 rounded-xl bg-white border border-[#D1D5DB] text-sm font-medium text-[#111827]"
              >
                <option value="Cash">Cash</option>
                <option value="UPI">UPI</option>
                <option value="Part Due">Part Due (Udhaar)</option>
              </select>
            </div>
          </div>

          {paymentMethod === 'Part Due' && (
            <div>
              <label className="block text-xs font-medium text-amber-800 mb-1.5">
                Pending Due Amount to Collect Later (₹)
              </label>
              <input
                type="number"
                value={dueAmount}
                onChange={(e) => setDueAmount(e.target.value)}
                placeholder="Enter due amount"
                className="w-full h-12 px-4 rounded-xl bg-amber-50 border border-amber-300 font-bold text-sm text-[#111827]"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-[#4B5563] mb-1.5">
              Buyer city / address
            </label>
            <input
              type="text"
              value={buyerAddress}
              onChange={(e) => setBuyerAddress(e.target.value)}
              placeholder="Enter buyer address"
              className="w-full h-12 px-4 rounded-xl bg-white border border-[#D1D5DB] text-sm text-[#111827]"
            />
          </div>

          <div className="fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-[#E5E7EB] p-4">
            <div className="max-w-xl mx-auto flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="w-1/3 h-12 rounded-xl border border-[#D1D5DB] font-semibold text-sm text-[#111827]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || !selectedPhone}
                className="w-2/3 h-12 rounded-xl bg-[#0F7B49] text-white font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Saving Sale...
                  </>
                ) : (
                  'Complete Sale & Print Bill'
                )}
              </button>
            </div>
          </div>
        </form>
      )}

      {showScanner && (
        <ImeiScannerModal
          onScanSuccess={(scannedImei) => {
            const matched = availablePhones.find((p) => p.imei === scannedImei);
            if (matched) {
              setScanNotice(null);
              handleSelectPhone(matched.id);
            } else if (scannedImei) {
              setScanNotice(
                `IMEI ${scannedImei} is not in your available unsold stock.`
              );
            }
            setShowScanner(false);
          }}
          onClose={() => setShowScanner(false)}
        />
      )}
    </div>
  );
};
