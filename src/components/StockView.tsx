import React, { useMemo, useRef, useState } from 'react';
import {
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  commitFirestoreWrite,
  db,
  ensureUserShopProfileInDb,
  OperationType,
  removeLocalPhone,
  upsertLocalKyc,
  upsertLocalPhone,
} from '../firebase';
import {
  KycRecord,
  PhoneGrade,
  PhoneInventoryItem,
  UserProfile,
} from '../types';
import {
  BRAND_MODELS,
  lookupImeiSpecs,
  maskGovernmentId,
  uploadToCloudinary,
} from '../utils/imeiDatabase';
import {
  generateShapathPatraPdf,
  generateStockCatalogPdf,
} from '../utils/pdfGenerator';
import { shareOnWhatsAppApk } from '../utils/apkShareAndPdfEngine';
import { ImeiScannerModal } from './ImeiScannerModal';
import { ApkVoiceButton } from './SmartVoiceModal';
import {
  Camera,
  Check,
  CheckSquare,
  Download,
  Edit3,
  FileText,
  Loader2,
  MessageCircle,
  Plus,
  Scan,
  Search,
  Smartphone,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';

interface StockViewProps {
  userId: string;
  shopProfile: UserProfile;
  inventory: PhoneInventoryItem[];
  kycRecords: KycRecord[];
  initialFilter?: 'All' | 'Ready' | 'Under repair' | 'Sold' | '30+ days';
  onSellPhone: (phone: PhoneInventoryItem) => void;
  onShareStock: () => void;
  onOpenScannerSearch: () => void;
  onOpenFullBuyWizard?: () => void;
  onStockAddedOrUpdated: (
    phone: PhoneInventoryItem,
    kyc?: KycRecord
  ) => void;
  onStockDeleted?: (phoneId: string) => void;
}

export const StockView: React.FC<StockViewProps> = ({
  userId,
  shopProfile,
  inventory,
  kycRecords,
  initialFilter = 'All',
  onSellPhone,
  onShareStock,
  onOpenScannerSearch,
  onOpenFullBuyWizard,
  onStockAddedOrUpdated,
  onStockDeleted,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<
    'All' | 'Ready' | 'Under repair' | 'Sold'
  >(initialFilter === '30+ days' ? 'All' : initialFilter);
  const [secondaryFilter, setSecondaryFilter] = useState<
    'Grade A' | 'Grade B' | 'Grade C' | '30+ days' | null
  >(initialFilter === '30+ days' ? '30+ days' : null);

  const [selectedPhone, setSelectedPhone] = useState<PhoneInventoryItem | null>(
    null
  );
  const [isEditingSelected, setIsEditingSelected] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Add / Edit Product Modal State
  const [showAddProductModal, setShowAddProductModal] = useState(false);
  const [showImeiScannerForForm, setShowImeiScannerForForm] = useState(false);
  const [savingProduct, setSavingProduct] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const productPhotoInputRef = useRef<HTMLInputElement | null>(null);

  const [formBrand, setFormBrand] = useState('Samsung');
  const [formModel, setFormModel] = useState('');
  const [formRam, setFormRam] = useState('8 GB');
  const [formStorage, setFormStorage] = useState('128 GB');
  const [formColour, setFormColour] = useState('Black');
  const [formImei, setFormImei] = useState('');
  const [formBuyingPrice, setFormBuyingPrice] = useState('');
  const [formExpectedPrice, setFormExpectedPrice] = useState('');
  const [formGrade, setFormGrade] = useState<PhoneGrade>('A');
  const [formStatus, setFormStatus] = useState<'Ready' | 'Under repair'>('Ready');
  const [formSellerName, setFormSellerName] = useState('');
  const [formSellerMobile, setFormSellerMobile] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formPhotoUrl, setFormPhotoUrl] = useState('');

  React.useEffect(() => {
    setStatusFilter(initialFilter === '30+ days' ? 'All' : initialFilter);
    setSecondaryFilter(initialFilter === '30+ days' ? '30+ days' : null);
  }, [initialFilter]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3200);
  };

  const resetAddProductForm = () => {
    setFormBrand('Samsung');
    setFormModel('');
    setFormRam('8 GB');
    setFormStorage('128 GB');
    setFormColour('Black');
    setFormImei('');
    setFormBuyingPrice('');
    setFormExpectedPrice('');
    setFormGrade('A');
    setFormStatus('Ready');
    setFormSellerName('');
    setFormSellerMobile('');
    setFormNotes('');
    setFormPhotoUrl('');
    setFormError(null);
  };

  const openEditFormForPhone = (phone: PhoneInventoryItem) => {
    setFormBrand(phone.brand || 'Samsung');
    setFormModel(phone.model || '');
    setFormRam(phone.ram || '8 GB');
    setFormStorage(phone.storage || '128 GB');
    setFormColour(phone.colour || 'Black');
    setFormImei(phone.imei || '');
    setFormBuyingPrice(String(phone.buyingPrice || 0));
    setFormExpectedPrice(String(phone.expectedSellingPrice || 0));
    setFormGrade(phone.grade || 'A');
    setFormStatus(
      phone.status === 'Under repair' ? 'Under repair' : 'Ready'
    );
    setFormSellerName(phone.sellerName || '');
    setFormSellerMobile(phone.sellerMobile || '');
    setFormNotes(phone.notes || '');
    setFormPhotoUrl(phone.photoFront || '');
    setFormError(null);
    setIsEditingSelected(true);
  };

  // Active (unsold) phones count & total cost
  const activeStock = useMemo(
    () => inventory.filter((p) => p.status !== 'Sold'),
    [inventory]
  );
  const readyCount = useMemo(
    () => inventory.filter((p) => p.status === 'Ready').length,
    [inventory]
  );
  const repairCount = useMemo(
    () => inventory.filter((p) => p.status === 'Under repair').length,
    [inventory]
  );
  const soldCount = useMemo(
    () => inventory.filter((p) => p.status === 'Sold').length,
    [inventory]
  );
  const totalActiveCost = useMemo(
    () => activeStock.reduce((sum, p) => sum + p.buyingPrice, 0),
    [activeStock]
  );

  const filteredPhones = useMemo(() => {
    return inventory.filter((item) => {
      if (statusFilter === 'All') {
        if (item.status === 'Sold') return false;
      } else if (item.status !== statusFilter) {
        return false;
      }

      if (secondaryFilter === 'Grade A' && item.grade !== 'A') return false;
      if (secondaryFilter === 'Grade B' && item.grade !== 'B') return false;
      if (secondaryFilter === 'Grade C' && item.grade !== 'C') return false;
      if (secondaryFilter === '30+ days' && item.daysInStock < 30) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchModel = `${item.brand} ${item.model}`
          .toLowerCase()
          .includes(q);
        const matchImei = item.imei.toLowerCase().includes(q);
        const matchSeller = item.sellerName.toLowerCase().includes(q);
        const matchCode = item.stockCode.toLowerCase().includes(q);
        return matchModel || matchImei || matchSeller || matchCode;
      }

      return true;
    });
  }, [inventory, statusFilter, secondaryFilter, searchQuery]);

  // Handle adding a brand-new product directly from the Stock screen
  const handleAddProductSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const cleanBrand = formBrand.trim() || 'Mobile';
    const cleanModel = formModel.trim();
    if (!cleanModel) {
      setFormError('कृपया मॉडल का नाम लिखें (Please enter Model name).');
      return;
    }

    const buyNum = Math.max(0, Math.round(Number(formBuyingPrice) || 0));
    const sellNum = Math.max(
      0,
      Math.round(
        Number(formExpectedPrice) > 0
          ? Number(formExpectedPrice)
          : buyNum > 0
          ? buyNum + 2000
          : 0
      )
    );

    const rawImeiDigits = formImei.replace(/\D/g, '');
    const finalImei =
      rawImeiDigits.length >= 6
        ? rawImeiDigits.slice(0, 32)
        : `STOCK-${String(Date.now()).slice(-6)}`;

    setSavingProduct(true);
    try {
      const nextCount = inventory.length + 1;
      const stockCode = `OP-${formGrade}-${String(nextCount).padStart(4, '0')}`;
      const phoneId = `phone_${Date.now()}`;
      const kycId = `kyc_${Date.now()}`;
      const dateLabel = new Date().toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
      });
      const { last4, masked } = maskGovernmentId('Aadhaar', '0000');

      const newPhone: PhoneInventoryItem = {
        id: phoneId,
        userId,
        stockCode: stockCode.slice(0, 40),
        noImeiDeadPhone: false,
        imei: finalImei,
        imei2: '',
        brand: cleanBrand.slice(0, 60),
        model: cleanModel.slice(0, 100),
        ram: (formRam || '8 GB').trim().slice(0, 20),
        storage: (formStorage || '128 GB').trim().slice(0, 20),
        colour: (formColour || 'Black').trim().slice(0, 40),
        photoFront: formPhotoUrl.length <= 148000 ? formPhotoUrl : '',
        photoBack: formPhotoUrl.length <= 148000 ? formPhotoUrl : '',
        photoSides: '',
        photoScreenOn: '',
        accessories: ['Box', 'Charger'],
        conditionScreen: 'OK',
        conditionBody: 'OK',
        conditionCamera: 'OK',
        conditionBiometrics: 'OK',
        conditionCharging: 'OK',
        conditionAudio: 'OK',
        conditionButtons: 'OK',
        batteryHealth: 90,
        checksPassed: 8,
        grade: formGrade,
        buyingPrice: buyNum,
        expectedSellingPrice: sellNum,
        actualSellingPrice: 0,
        expectedProfit: sellNum - buyNum,
        notes: formNotes.trim().slice(0, 500),
        sellerName: formSellerName.trim().slice(0, 120) || 'Direct Stock Entry',
        sellerMobile: formSellerMobile.replace(/\D/g, '').slice(0, 15),
        sellerAddress: shopProfile.city || 'Shop Counter',
        idType: 'Aadhaar',
        idMasked: masked,
        paymentMethod: 'Cash',
        paidAmount: buyNum,
        status: formStatus,
        sourceType: 'Customer',
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
        stockCode: newPhone.stockCode,
        transactionType: 'BUY',
        dateLabel: dateLabel.slice(0, 40),
        brand: newPhone.brand,
        model: newPhone.model,
        ram: newPhone.ram,
        storage: newPhone.storage,
        imei: newPhone.imei,
        price: newPhone.buyingPrice,
        paymentMethod: 'Cash',
        partyName: newPhone.sellerName,
        partyMobile: newPhone.sellerMobile,
        partyAddress: newPhone.sellerAddress,
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
      };

      // 1. Update local storage & React state immediately
      upsertLocalPhone(userId, newPhone);
      upsertLocalKyc(userId, newKyc);
      onStockAddedOrUpdated(newPhone, newKyc);
      setShowAddProductModal(false);
      resetAddProductForm();
      showToast(`✓ ${newPhone.brand} ${newPhone.model} added to Stock!`);

      // 2. Sync to Firestore in background
      void (async () => {
        await ensureUserShopProfileInDb(userId, shopProfile);
        const invPath = `users/${userId}/inventory`;
        await commitFirestoreWrite(
          setDoc(doc(db, invPath, phoneId), {
            ...newPhone,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }),
          OperationType.CREATE,
          `${invPath}/${phoneId}`
        );
        const kycPath = `users/${userId}/kyc_records`;
        await commitFirestoreWrite(
          setDoc(doc(db, kycPath, kycId), {
            ...newKyc,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }),
          OperationType.CREATE,
          `${kycPath}/${kycId}`
        );
      })();
    } finally {
      setSavingProduct(false);
    }
  };

  // Handle saving edited stock details for an existing phone
  const handleSaveEditedStockDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPhone) return;
    setFormError(null);

    const cleanBrand = formBrand.trim() || selectedPhone.brand;
    const cleanModel = formModel.trim() || selectedPhone.model;
    const buyNum = Math.max(0, Math.round(Number(formBuyingPrice) || 0));
    const sellNum = Math.max(0, Math.round(Number(formExpectedPrice) || 0));
    const profitNum = sellNum - buyNum;
    const cleanImei = formImei.trim().slice(0, 32) || selectedPhone.imei;

    setUpdatingStatus(true);
    try {
      const updatedPhone: PhoneInventoryItem = {
        ...selectedPhone,
        brand: cleanBrand.slice(0, 60),
        model: cleanModel.slice(0, 100),
        ram: (formRam || '8 GB').slice(0, 20),
        storage: (formStorage || '128 GB').slice(0, 20),
        colour: (formColour || 'Black').slice(0, 40),
        imei: cleanImei,
        grade: formGrade,
        buyingPrice: buyNum,
        expectedSellingPrice: sellNum,
        expectedProfit: profitNum,
        status:
          selectedPhone.status === 'Sold' ? 'Sold' : formStatus,
        sellerName:
          formSellerName.trim().slice(0, 120) || selectedPhone.sellerName,
        sellerMobile:
          formSellerMobile.replace(/\D/g, '').slice(0, 15) ||
          selectedPhone.sellerMobile,
        notes: formNotes.trim().slice(0, 500),
      };

      upsertLocalPhone(userId, updatedPhone);
      onStockAddedOrUpdated(updatedPhone);
      setSelectedPhone(updatedPhone);
      setIsEditingSelected(false);
      showToast(`✓ Stock details saved for ${updatedPhone.brand} ${updatedPhone.model}`);

      const docPath = `users/${userId}/inventory/${selectedPhone.id}`;
      void commitFirestoreWrite(
        updateDoc(doc(db, 'users', userId, 'inventory', selectedPhone.id), {
          imei: updatedPhone.imei,
          imei2: updatedPhone.imei2,
          brand: updatedPhone.brand,
          model: updatedPhone.model,
          ram: updatedPhone.ram,
          storage: updatedPhone.storage,
          colour: updatedPhone.colour,
          grade: updatedPhone.grade,
          buyingPrice: updatedPhone.buyingPrice,
          expectedSellingPrice: updatedPhone.expectedSellingPrice,
          expectedProfit: updatedPhone.expectedProfit,
          notes: updatedPhone.notes,
          status: updatedPhone.status,
          sellerName: updatedPhone.sellerName,
          sellerMobile: updatedPhone.sellerMobile,
          sellerAddress: updatedPhone.sellerAddress,
          updatedAt: serverTimestamp(),
        }),
        OperationType.UPDATE,
        docPath
      );
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleToggleRepairReady = async (phone: PhoneInventoryItem) => {
    setUpdatingStatus(true);
    const nextStatus = phone.status === 'Under repair' ? 'Ready' : 'Under repair';
    const updatedPhone: PhoneInventoryItem = { ...phone, status: nextStatus };

    upsertLocalPhone(userId, updatedPhone);
    onStockAddedOrUpdated(updatedPhone);
    setSelectedPhone(updatedPhone);
    showToast(`✓ Marked as ${nextStatus}`);

    const docPath = `users/${userId}/inventory/${phone.id}`;
    await commitFirestoreWrite(
      updateDoc(doc(db, 'users', userId, 'inventory', phone.id), {
        status: nextStatus,
        expectedSellingPrice: phone.expectedSellingPrice,
        expectedProfit: phone.expectedProfit,
        notes: phone.notes,
        updatedAt: serverTimestamp(),
      }),
      OperationType.UPDATE,
      docPath
    );
    setUpdatingStatus(false);
  };

  const handleDeletePhone = async (phone: PhoneInventoryItem) => {
    removeLocalPhone(userId, phone.id);
    onStockDeleted?.(phone.id);
    setSelectedPhone(null);
    showToast(`Removed ${phone.brand} ${phone.model} from stock`);

    const docPath = `users/${userId}/inventory/${phone.id}`;
    void commitFirestoreWrite(
      deleteDoc(doc(db, 'users', userId, 'inventory', phone.id)),
      OperationType.DELETE,
      docPath
    );
  };

  const handleProductPhotoUpload = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setUploadingPhoto(true);
    try {
      const uploaded = await uploadToCloudinary(file);
      if (uploaded) setFormPhotoUrl(uploaded);
    } finally {
      setUploadingPhoto(false);
    }
  };

  return (
    <div className="space-y-3.5 pb-24">
      <input
        ref={productPhotoInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleProductPhotoUpload}
        className="hidden"
      />

      {/* Top Stock Header + Add Product + WhatsApp + PDF + Scan */}
      <div className="bg-white px-4 pt-4 pb-3 border-b border-[#E5E7EB]">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div>
            <h1 className="font-display font-bold text-2xl text-[#111827]">
              Stock
            </h1>
            <p className="text-xs text-[#6B7280] tabular-nums">
              {activeStock.length} phones · cost ₹
              {totalActiveCost.toLocaleString('en-IN')}
            </p>
          </div>

          <div className="flex items-center gap-1.5">
            {/* + Add Product Button */}
            <button
              type="button"
              onClick={() => {
                resetAddProductForm();
                setShowAddProductModal(true);
              }}
              className="h-10 px-3 rounded-xl bg-[#0F7B49] hover:bg-[#0C633A] text-white font-display font-bold text-xs flex items-center gap-1.5 shadow-2xs active:scale-[0.98]"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
              Add Product
            </button>

            {/* WhatsApp Share Stock Button */}
            <button
              type="button"
              onClick={onShareStock}
              title="Share Stock on WhatsApp"
              className="w-10 h-10 rounded-xl border border-[#A7F3D0] bg-[#E8F5EE] hover:bg-[#D1FAE5] flex items-center justify-center text-[#0F7B49]"
            >
              <MessageCircle className="w-4 h-4" />
            </button>

            {/* Download Stock Catalog PDF Button */}
            <button
              type="button"
              onClick={() =>
                generateStockCatalogPdf(inventory, shopProfile, 'download')
              }
              title="Download Stock PDF"
              className="w-10 h-10 rounded-xl border border-[#D1D5DB] bg-white hover:bg-[#F9FAFB] flex items-center justify-center text-[#111827]"
            >
              <Download className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() =>
                setStatusFilter((prev) => (prev === 'Ready' ? 'All' : 'Ready'))
              }
              title="Filter Ready Phones"
              className="w-10 h-10 rounded-xl border border-[#D1D5DB] bg-white hover:bg-[#F9FAFB] flex items-center justify-center text-[#111827]"
            >
              <CheckSquare className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={onOpenScannerSearch}
              title="Scan IMEI to Search"
              className="w-10 h-10 rounded-xl border border-[#D1D5DB] bg-white hover:bg-[#F9FAFB] flex items-center justify-center text-[#111827]"
            >
              <Scan className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Toast confirmation banner */}
        {toastMessage && (
          <div className="mb-3 p-2.5 rounded-xl bg-[#E8F5EE] border border-[#A7F3D0] text-xs font-bold text-[#064E3B] flex items-center justify-between">
            <span>{toastMessage}</span>
            <button
              type="button"
              onClick={() => setToastMessage(null)}
              className="text-[#0F7B49]"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Search Input + 3-Layer APK Voice Search */}
        <div className="flex items-center gap-2 mb-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-[#9CA3AF] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search model, IMEI or seller"
              className="w-full h-11 pl-10 pr-9 rounded-xl bg-[#F9FAFB] border border-[#E5E7EB] text-sm text-[#111827] focus:outline-none focus:bg-white focus:border-[#0F7B49]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6B7280]"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <ApkVoiceButton
            context="search_stock"
            label="Voice"
            compact
            className="h-11 px-3 rounded-xl bg-[#E8F5EE] hover:bg-[#D1FAE5] text-[#0F7B49] text-xs font-bold flex items-center gap-1.5 shrink-0"
            onResult={(voice, raw) => {
              const q =
                voice.imei ||
                voice.searchQuery ||
                voice.model ||
                voice.brand ||
                voice.sellerName ||
                raw;
              if (q) setSearchQuery(q.trim());
            }}
          />
        </div>

        {/* Primary Status Filter Row */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-2">
          {(
            [
              { id: 'All', label: `All ${activeStock.length}` },
              { id: 'Ready', label: `Ready ${readyCount}` },
              { id: 'Under repair', label: `Under repair ${repairCount}` },
              { id: 'Sold', label: `Sold ${soldCount}` },
            ] as const
          ).map((tab) => {
            const active = statusFilter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`h-9 px-3.5 rounded-full border text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                  active
                    ? 'bg-[#E8F5EE] border-[#0F7B49] text-[#0F7B49]'
                    : 'bg-white border-[#E5E7EB] text-[#374151]'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Secondary Grade & Aging Filter Row */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pt-1">
          {(['Grade A', 'Grade B', 'Grade C', '30+ days'] as const).map(
            (chip) => {
              const active = secondaryFilter === chip;
              return (
                <button
                  key={chip}
                  type="button"
                  onClick={() =>
                    setSecondaryFilter((prev) => (prev === chip ? null : chip))
                  }
                  className={`h-8 px-3 rounded-lg border text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                    active
                      ? 'bg-[#111827] border-[#111827] text-white'
                      : 'bg-white border-[#E5E7EB] text-[#4B5563]'
                  }`}
                >
                  {chip}
                </button>
              );
            }
          )}
        </div>
      </div>

      {/* Stock List Cards */}
      <div className="px-4 space-y-2.5">
        {filteredPhones.length === 0 ? (
          <div className="bg-white rounded-2xl border border-[#E5E7EB] p-8 text-center space-y-3">
            <Smartphone className="w-8 h-8 text-[#0F7B49] mx-auto" />
            <div className="font-display font-bold text-sm text-[#111827]">
              No phones in this view yet
            </div>
            <p className="text-xs text-[#6B7280]">
              Add your first phone or clear active filters above.
            </p>
            <div className="flex items-center justify-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  resetAddProductForm();
                  setShowAddProductModal(true);
                }}
                className="h-10 px-4 rounded-xl bg-[#0F7B49] text-white text-xs font-bold flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                Add Product Now
              </button>
              {onOpenFullBuyWizard && (
                <button
                  type="button"
                  onClick={onOpenFullBuyWizard}
                  className="h-10 px-3.5 rounded-xl border border-[#D1D5DB] text-[#111827] text-xs font-semibold"
                >
                  8-Step KYC Buy
                </button>
              )}
            </div>
          </div>
        ) : (
          filteredPhones.map((phone) => {
            const titleLabel = phone.model
              .toLowerCase()
              .startsWith(phone.brand.toLowerCase())
              ? phone.model
              : `${phone.brand} ${phone.model}`;
            const ageText =
              phone.daysInStock === 0 || phone.purchaseDate === 'today'
                ? 'today'
                : `${phone.daysInStock} days`;

            return (
              <button
                key={phone.id}
                type="button"
                onClick={() => {
                  setSelectedPhone(phone);
                  setIsEditingSelected(false);
                }}
                className="w-full bg-white rounded-2xl border border-[#E5E7EB] p-3 flex items-center justify-between gap-3 text-left hover:border-[#0F7B49] transition-colors active:scale-[0.995]"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-13 h-13 rounded-xl bg-[#E5E7EB] overflow-hidden shrink-0 border border-[#E5E7EB] flex items-center justify-center">
                    {phone.photoFront || phone.photoBack ? (
                      <img
                        src={phone.photoFront || phone.photoBack}
                        alt={titleLabel}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Smartphone className="w-5 h-5 text-[#6B7280]" />
                    )}
                  </div>

                  <div className="min-w-0">
                    <div className="font-display font-bold text-sm text-[#111827] truncate">
                      {titleLabel} · {phone.ram.replace(' ', '')}/
                      {phone.storage.replace(' ', '')}
                    </div>
                    <div className="text-xs text-[#6B7280] mt-0.5">
                      {ageText} · Grade {phone.grade} · IMEI ...
                      {phone.imei.slice(-4)}
                    </div>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <div className="font-display font-bold text-sm text-[#111827] tabular-nums">
                    ₹{phone.buyingPrice.toLocaleString('en-IN')}
                  </div>
                  <div
                    className={`text-xs font-semibold mt-0.5 whitespace-nowrap ${
                      phone.status === 'Ready'
                        ? 'text-[#0F7B49]'
                        : phone.status === 'Under repair'
                        ? 'text-[#D97706]'
                        : 'text-[#6B7280]'
                    }`}
                  >
                    {phone.status}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* ====================================================================
          FAST ADD PRODUCT / STOCK DETAILS MODAL
      ==================================================================== */}
      {showAddProductModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
          <form
            onSubmit={handleAddProductSubmit}
            className="w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-5 space-y-3.5 shadow-2xl animate-sheet-up max-h-[90dvh] overflow-y-auto touch-pan-y no-scrollbar"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-[#E8F5EE] text-[#0F7B49] flex items-center justify-center">
                  <Plus className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-display font-bold text-base text-[#111827]">
                    Add Product / Stock Details
                  </h3>
                  <p className="text-xs text-[#6B7280]">
                    Instant 1-step stock entry
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <ApkVoiceButton
                  context="buy_phone"
                  label="Voice"
                  compact
                  onResult={(voice) => {
                    if (voice.brand) setFormBrand(voice.brand);
                    if (voice.model) setFormModel(voice.model);
                    if (voice.ram) setFormRam(voice.ram);
                    if (voice.storage) setFormStorage(voice.storage);
                    if (voice.imei) setFormImei(voice.imei);
                    if (voice.buyingPrice && voice.buyingPrice > 0) {
                      setFormBuyingPrice(String(voice.buyingPrice));
                    }
                    if (
                      voice.expectedSellingPrice &&
                      voice.expectedSellingPrice > 0
                    ) {
                      setFormExpectedPrice(String(voice.expectedSellingPrice));
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowAddProductModal(false)}
                  className="w-9 h-9 rounded-full bg-[#F3F4F6] flex items-center justify-center text-[#374151]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {formError && (
              <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-xs font-semibold text-red-700">
                {formError}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-xs font-medium text-[#4B5563] mb-1">
                  Brand *
                </label>
                <select
                  value={formBrand}
                  onChange={(e) => {
                    const b = e.target.value;
                    setFormBrand(b);
                    const preset = BRAND_MODELS[b]?.[0];
                    if (preset && !formModel) {
                      setFormModel(preset.model);
                      setFormRam(preset.ram);
                      setFormStorage(preset.storage);
                    }
                  }}
                  className="w-full h-11 px-3 rounded-xl bg-white border border-[#D1D5DB] text-xs font-semibold text-[#111827]"
                >
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
              <div>
                <label className="block text-xs font-medium text-[#4B5563] mb-1">
                  Model Name *
                </label>
                <input
                  type="text"
                  required
                  value={formModel}
                  onChange={(e) => setFormModel(e.target.value)}
                  placeholder="e.g. iPhone 15 / Vivo V29"
                  className="w-full h-11 px-3 rounded-xl bg-white border border-[#D1D5DB] text-xs font-semibold text-[#111827]"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              <div>
                <label className="block text-xs font-medium text-[#4B5563] mb-1">
                  RAM
                </label>
                <select
                  value={formRam}
                  onChange={(e) => setFormRam(e.target.value)}
                  className="w-full h-10 px-2.5 rounded-xl bg-white border border-[#D1D5DB] text-xs font-semibold"
                >
                  <option value="4 GB">4 GB</option>
                  <option value="6 GB">6 GB</option>
                  <option value="8 GB">8 GB</option>
                  <option value="12 GB">12 GB</option>
                  <option value="16 GB">16 GB</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#4B5563] mb-1">
                  Storage
                </label>
                <select
                  value={formStorage}
                  onChange={(e) => setFormStorage(e.target.value)}
                  className="w-full h-10 px-2.5 rounded-xl bg-white border border-[#D1D5DB] text-xs font-semibold"
                >
                  <option value="64 GB">64 GB</option>
                  <option value="128 GB">128 GB</option>
                  <option value="256 GB">256 GB</option>
                  <option value="512 GB">512 GB</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#4B5563] mb-1">
                  Grade
                </label>
                <select
                  value={formGrade}
                  onChange={(e) => setFormGrade(e.target.value as PhoneGrade)}
                  className="w-full h-10 px-2.5 rounded-xl bg-white border border-[#D1D5DB] text-xs font-semibold"
                >
                  <option value="A">Grade A</option>
                  <option value="B">Grade B</option>
                  <option value="C">Grade C</option>
                  <option value="D">Grade D</option>
                </select>
              </div>
            </div>

            {/* IMEI + Scan */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-[#4B5563]">
                  IMEI Number (Optional — or Scan)
                </label>
                <button
                  type="button"
                  onClick={() => setShowImeiScannerForForm(true)}
                  className="text-xs font-bold text-[#0F7B49] flex items-center gap-1"
                >
                  <Scan className="w-3.5 h-3.5" />
                  Scan IMEI
                </button>
              </div>
              <input
                type="text"
                maxLength={15}
                value={formImei}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, '').slice(0, 15);
                  setFormImei(val);
                  if (val.length === 15) {
                    const spec = lookupImeiSpecs(val);
                    if (spec) {
                      setFormBrand(spec.brand);
                      setFormModel(spec.model);
                      setFormRam(spec.ram);
                      setFormStorage(spec.storage);
                    }
                  }
                }}
                placeholder="15-digit IMEI (auto-generated if left blank)"
                className="w-full h-11 px-3 rounded-xl bg-white border border-[#D1D5DB] font-mono text-xs text-[#111827]"
              />
            </div>

            {/* Buying & Selling Price */}
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-xs font-medium text-[#4B5563] mb-1">
                  Buying Price (₹) *
                </label>
                <input
                  type="number"
                  required
                  value={formBuyingPrice}
                  onChange={(e) => setFormBuyingPrice(e.target.value)}
                  placeholder="e.g. 12000"
                  className="w-full h-11 px-3 rounded-xl bg-white border border-[#D1D5DB] text-sm font-bold text-[#111827]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#4B5563] mb-1">
                  Expected Sell Price (₹)
                </label>
                <input
                  type="number"
                  value={formExpectedPrice}
                  onChange={(e) => setFormExpectedPrice(e.target.value)}
                  placeholder="e.g. 14500"
                  className="w-full h-11 px-3 rounded-xl bg-white border border-[#D1D5DB] text-sm font-bold text-[#0F7B49]"
                />
              </div>
            </div>

            {/* Optional Seller & Photo */}
            <div className="grid grid-cols-2 gap-2.5">
              <input
                type="text"
                value={formSellerName}
                onChange={(e) => setFormSellerName(e.target.value)}
                placeholder="Seller / Dealer name (optional)"
                className="h-10 px-3 rounded-xl bg-white border border-[#D1D5DB] text-xs"
              />
              <button
                type="button"
                disabled={uploadingPhoto}
                onClick={() => productPhotoInputRef.current?.click()}
                className="h-10 px-3 rounded-xl border border-[#D1D5DB] bg-[#F9FAFB] text-xs font-semibold text-[#111827] flex items-center justify-center gap-1.5"
              >
                {uploadingPhoto ? (
                  <Loader2 className="w-4 h-4 animate-spin text-[#0F7B49]" />
                ) : (
                  <Camera className="w-4 h-4 text-[#0F7B49]" />
                )}
                {formPhotoUrl ? '✓ Photo Added' : 'Add Photo'}
              </button>
            </div>

            <div className="flex gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setShowAddProductModal(false)}
                className="w-1/3 h-12 rounded-xl border border-[#D1D5DB] font-semibold text-xs text-[#111827]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingProduct}
                className="w-2/3 h-12 rounded-xl bg-[#0F7B49] hover:bg-[#0C633A] text-white font-display font-bold text-sm flex items-center justify-center gap-2 shadow-xs"
              >
                {savingProduct ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    Add Product to Stock
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ====================================================================
          INTERACTIVE PHONE DETAIL & EDIT STOCK MODAL
      ==================================================================== */}
      {selectedPhone && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-5 space-y-4 shadow-2xl animate-sheet-up max-h-[90dvh] overflow-y-auto touch-pan-y no-scrollbar">
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="text-xs font-mono font-semibold text-[#0F7B49]">
                  {selectedPhone.stockCode} · Grade {selectedPhone.grade}
                </span>
                <h3 className="font-display font-bold text-lg text-[#111827]">
                  {selectedPhone.brand} {selectedPhone.model} (
                  {selectedPhone.ram}/{selectedPhone.storage})
                </h3>
                <p className="text-xs font-mono text-[#6B7280]">
                  IMEI: {selectedPhone.imei}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                {!isEditingSelected && (
                  <button
                    type="button"
                    onClick={() => openEditFormForPhone(selectedPhone)}
                    className="h-9 px-3 rounded-xl bg-[#E8F5EE] text-[#0F7B49] text-xs font-bold flex items-center gap-1"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    Edit
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedPhone(null);
                    setIsEditingSelected(false);
                  }}
                  className="w-9 h-9 rounded-full bg-[#F3F4F6] flex items-center justify-center text-[#374151]"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {isEditingSelected ? (
              <form
                onSubmit={handleSaveEditedStockDetails}
                className="space-y-3 bg-[#F9FAFB] p-3.5 rounded-2xl border border-[#E5E7EB]"
              >
                <div className="text-xs font-bold text-[#0F7B49]">
                  Edit Stock Details
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] text-[#6B7280] mb-1">
                      Brand
                    </label>
                    <input
                      type="text"
                      required
                      value={formBrand}
                      onChange={(e) => setFormBrand(e.target.value)}
                      className="w-full h-10 px-3 rounded-xl bg-white border border-[#D1D5DB] text-xs font-semibold"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[#6B7280] mb-1">
                      Model
                    </label>
                    <input
                      type="text"
                      required
                      value={formModel}
                      onChange={(e) => setFormModel(e.target.value)}
                      className="w-full h-10 px-3 rounded-xl bg-white border border-[#D1D5DB] text-xs font-semibold"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[11px] text-[#6B7280] mb-1">
                      RAM
                    </label>
                    <select
                      value={formRam}
                      onChange={(e) => setFormRam(e.target.value)}
                      className="w-full h-10 px-2 rounded-xl bg-white border border-[#D1D5DB] text-xs font-semibold"
                    >
                      <option value="4 GB">4 GB</option>
                      <option value="6 GB">6 GB</option>
                      <option value="8 GB">8 GB</option>
                      <option value="12 GB">12 GB</option>
                      <option value="16 GB">16 GB</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] text-[#6B7280] mb-1">
                      Storage
                    </label>
                    <select
                      value={formStorage}
                      onChange={(e) => setFormStorage(e.target.value)}
                      className="w-full h-10 px-2 rounded-xl bg-white border border-[#D1D5DB] text-xs font-semibold"
                    >
                      <option value="64 GB">64 GB</option>
                      <option value="128 GB">128 GB</option>
                      <option value="256 GB">256 GB</option>
                      <option value="512 GB">512 GB</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] text-[#6B7280] mb-1">
                      Grade
                    </label>
                    <select
                      value={formGrade}
                      onChange={(e) =>
                        setFormGrade(e.target.value as PhoneGrade)
                      }
                      className="w-full h-10 px-2 rounded-xl bg-white border border-[#D1D5DB] text-xs font-semibold"
                    >
                      <option value="A">Grade A</option>
                      <option value="B">Grade B</option>
                      <option value="C">Grade C</option>
                      <option value="D">Grade D</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] text-[#6B7280] mb-1">
                      Buy Price (₹)
                    </label>
                    <input
                      type="number"
                      required
                      value={formBuyingPrice}
                      onChange={(e) => setFormBuyingPrice(e.target.value)}
                      className="w-full h-10 px-3 rounded-xl bg-white border border-[#D1D5DB] text-xs font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[#6B7280] mb-1">
                      Expected Sell (₹)
                    </label>
                    <input
                      type="number"
                      required
                      value={formExpectedPrice}
                      onChange={(e) => setFormExpectedPrice(e.target.value)}
                      className="w-full h-10 px-3 rounded-xl bg-white border border-[#D1D5DB] text-xs font-bold text-[#0F7B49]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] text-[#6B7280] mb-1">
                    IMEI Number
                  </label>
                  <input
                    type="text"
                    value={formImei}
                    onChange={(e) => setFormImei(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl bg-white border border-[#D1D5DB] font-mono text-xs"
                  />
                </div>

                <div>
                  <label className="block text-[11px] text-[#6B7280] mb-1">
                    Notes
                  </label>
                  <input
                    type="text"
                    value={formNotes}
                    onChange={(e) => setFormNotes(e.target.value)}
                    placeholder="Add stock notes"
                    className="w-full h-10 px-3 rounded-xl bg-white border border-[#D1D5DB] text-xs"
                  />
                </div>

                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setIsEditingSelected(false)}
                    className="w-1/3 h-10 rounded-xl border border-[#D1D5DB] bg-white text-xs font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={updatingStatus}
                    className="w-2/3 h-10 rounded-xl bg-[#0F7B49] text-white text-xs font-bold flex items-center justify-center gap-1.5"
                  >
                    {updatingStatus ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <Check className="w-4 h-4" />
                        Save Stock Details
                      </>
                    )}
                  </button>
                </div>
              </form>
            ) : (
              <>
                {/* Price & Seller Summary */}
                <div className="grid grid-cols-3 gap-2 bg-[#F6F7F8] p-3 rounded-2xl border border-[#E5E7EB] text-center">
                  <div>
                    <div className="text-[11px] text-[#6B7280]">Buy Price</div>
                    <div className="font-display font-bold text-sm text-[#111827]">
                      ₹{selectedPhone.buyingPrice.toLocaleString('en-IN')}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-[#6B7280]">
                      Expected Sell
                    </div>
                    <div className="font-display font-bold text-sm text-[#0F7B49]">
                      ₹
                      {selectedPhone.expectedSellingPrice.toLocaleString(
                        'en-IN'
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-[#6B7280]">Status</div>
                    <div
                      className={`font-display font-bold text-sm ${
                        selectedPhone.status === 'Ready'
                          ? 'text-[#0F7B49]'
                          : 'text-[#D97706]'
                      }`}
                    >
                      {selectedPhone.status}
                    </div>
                  </div>
                </div>

                <div className="text-xs text-[#374151] space-y-1.5 bg-white border border-[#E5E7EB] rounded-2xl p-3.5">
                  <div>
                    <span className="text-[#6B7280]">Seller:</span>{' '}
                    <strong>{selectedPhone.sellerName}</strong>{' '}
                    {selectedPhone.sellerMobile
                      ? `(+91 ${selectedPhone.sellerMobile})`
                      : ''}
                  </div>
                  <div>
                    <span className="text-[#6B7280]">Address:</span>{' '}
                    {selectedPhone.sellerAddress}
                  </div>
                  <div>
                    <span className="text-[#6B7280]">KYC ID:</span>{' '}
                    {selectedPhone.idType} ({selectedPhone.idMasked})
                  </div>
                  <div>
                    <span className="text-[#6B7280]">Comes with:</span>{' '}
                    {selectedPhone.accessories.join(', ') || 'Phone only'}
                  </div>
                  <div>
                    <span className="text-[#6B7280]">Battery &amp; Checks:</span>{' '}
                    {selectedPhone.batteryHealth}% Battery ·{' '}
                    {selectedPhone.checksPassed}/8 Checks OK
                  </div>
                  {selectedPhone.notes && (
                    <div>
                      <span className="text-[#6B7280]">Notes:</span>{' '}
                      {selectedPhone.notes}
                    </div>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="space-y-2.5 pt-1">
                  {selectedPhone.status !== 'Sold' && (
                    <div className="grid grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        disabled={updatingStatus}
                        onClick={() => handleToggleRepairReady(selectedPhone)}
                        className="h-11 rounded-xl border border-[#D1D5DB] font-semibold text-xs text-[#111827] flex items-center justify-center gap-1.5 hover:bg-[#F9FAFB]"
                      >
                        <Wrench className="w-4 h-4 text-[#D97706]" />
                        {selectedPhone.status === 'Under repair'
                          ? 'Mark Ready to Sell'
                          : 'Move to Repair'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const phoneToSell = selectedPhone;
                          setSelectedPhone(null);
                          onSellPhone(phoneToSell);
                        }}
                        className="h-11 rounded-xl bg-[#0F7B49] text-white font-semibold text-xs flex items-center justify-center gap-1.5"
                      >
                        Sell This Phone
                      </button>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={() => {
                        const msg = [
                          `📱 *${shopProfile.shopName} — Available Phone*`,
                          `Model: *${selectedPhone.brand} ${selectedPhone.model}* (${selectedPhone.ram}/${selectedPhone.storage})`,
                          `Condition: *Grade ${selectedPhone.grade}* (${selectedPhone.batteryHealth}% Battery)`,
                          `Price: *₹${(selectedPhone.expectedSellingPrice || selectedPhone.buyingPrice).toLocaleString('en-IN')}*`,
                          `✅ 100% KYC Verified`,
                        ].join('\n');
                        void shareOnWhatsAppApk(msg);
                      }}
                      className="h-11 rounded-xl bg-[#E8F5EE] hover:bg-[#D1FAE5] text-[#0F7B49] font-semibold text-xs flex items-center justify-center gap-1.5"
                    >
                      <MessageCircle className="w-4 h-4" />
                      WhatsApp Share
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        const linkedKyc: KycRecord =
                          kycRecords.find(
                            (k) =>
                              k.id === selectedPhone.kycId ||
                              k.phoneId === selectedPhone.id
                          ) || {
                            id: selectedPhone.kycId || `kyc_${selectedPhone.id}`,
                            userId: selectedPhone.userId,
                            phoneId: selectedPhone.id,
                            stockCode: selectedPhone.stockCode,
                            transactionType: 'BUY',
                            dateLabel: selectedPhone.purchaseDate || 'today',
                            brand: selectedPhone.brand,
                            model: selectedPhone.model,
                            ram: selectedPhone.ram,
                            storage: selectedPhone.storage,
                            imei: selectedPhone.imei,
                            price: selectedPhone.buyingPrice,
                            paymentMethod: selectedPhone.paymentMethod,
                            partyName: selectedPhone.sellerName,
                            partyMobile: selectedPhone.sellerMobile,
                            partyAddress: selectedPhone.sellerAddress,
                            idType: selectedPhone.idType,
                            idLast4: selectedPhone.idMasked.slice(-4) || '0000',
                            idMasked: selectedPhone.idMasked,
                            idFrontUrl: '',
                            idBackUrl: '',
                            sellerPhotoUrl: '',
                            signatureDataUrl: '',
                            shapathLanguage: 'Hindi',
                            idVerified: true,
                            shapathSigned: true,
                          };
                        generateShapathPatraPdf(
                          selectedPhone,
                          linkedKyc,
                          shopProfile,
                          linkedKyc.shapathLanguage || 'Hindi',
                          'download'
                        );
                      }}
                      className="h-11 rounded-xl bg-[#F3F4F6] hover:bg-[#E5E7EB] text-[#111827] font-semibold text-xs flex items-center justify-center gap-1.5"
                    >
                      <FileText className="w-4 h-4 text-[#0F7B49]" />
                      Download PDF
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => void handleDeletePhone(selectedPhone)}
                    className="w-full h-10 rounded-xl border border-red-200 bg-red-50 text-red-700 font-semibold text-xs flex items-center justify-center gap-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete Product from Stock
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {showImeiScannerForForm && (
        <ImeiScannerModal
          onScanSuccess={(scannedImei, aiSpecs) => {
            setShowImeiScannerForForm(false);
            if (scannedImei) setFormImei(scannedImei);
            if (aiSpecs?.brand) setFormBrand(aiSpecs.brand);
            if (aiSpecs?.model) setFormModel(aiSpecs.model);
            if (aiSpecs?.ram) setFormRam(aiSpecs.ram);
            if (aiSpecs?.storage) setFormStorage(aiSpecs.storage);
          }}
          onClose={() => setShowImeiScannerForForm(false)}
        />
      )}
    </div>
  );
};
