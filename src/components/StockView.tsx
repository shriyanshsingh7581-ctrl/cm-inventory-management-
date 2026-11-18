import React, { useMemo, useState } from 'react';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { KycRecord, PhoneInventoryItem, UserProfile } from '../types';
import { generateShapathPatraPdf } from '../utils/pdfGenerator';
import { ApkVoiceButton } from './SmartVoiceModal';
import {
  CheckSquare,
  FileText,
  Scan,
  Search,
  Share2,
  Smartphone,
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
}

/**
 * Replicates the Stock screen at 00:57 in the reference video:
 * - Header: Stock (9 phones · cost ₹78,000) + Share, Select, Scan icons
 * - Search bar: Search model, IMEI or seller
 * - Status tabs: All 9 | Ready 6 | Under repair 3 | Sold 4
 * - Secondary filter chips: Grade A | Grade B | Grade C | 30+ days
 * - Interactive Phone Cards with thumbnail, title, age · grade, price & status
 */
export const StockView: React.FC<StockViewProps> = ({
  userId,
  shopProfile,
  inventory,
  kycRecords,
  initialFilter = 'All',
  onSellPhone,
  onShareStock,
  onOpenScannerSearch,
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
  const [updatingStatus, setUpdatingStatus] = useState(false);

  React.useEffect(() => {
    setStatusFilter(initialFilter === '30+ days' ? 'All' : initialFilter);
    setSecondaryFilter(initialFilter === '30+ days' ? '30+ days' : null);
  }, [initialFilter]);

  // Active (unsold) phones count & total cost matching video header "9 phones · cost ₹78,000"
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
      // Status filter
      if (statusFilter === 'All') {
        if (item.status === 'Sold') return false;
      } else if (item.status !== statusFilter) {
        return false;
      }

      // Secondary filter
      if (secondaryFilter === 'Grade A' && item.grade !== 'A') return false;
      if (secondaryFilter === 'Grade B' && item.grade !== 'B') return false;
      if (secondaryFilter === 'Grade C' && item.grade !== 'C') return false;
      if (secondaryFilter === '30+ days' && item.daysInStock < 30) return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchModel = `${item.brand} ${item.model}`.toLowerCase().includes(q);
        const matchImei = item.imei.toLowerCase().includes(q);
        const matchSeller = item.sellerName.toLowerCase().includes(q);
        const matchCode = item.stockCode.toLowerCase().includes(q);
        return matchModel || matchImei || matchSeller || matchCode;
      }

      return true;
    });
  }, [inventory, statusFilter, secondaryFilter, searchQuery]);

  const handleToggleRepairReady = async (phone: PhoneInventoryItem) => {
    setUpdatingStatus(true);
    const nextStatus = phone.status === 'Under repair' ? 'Ready' : 'Under repair';
    const docPath = `users/${userId}/inventory/${phone.id}`;
    try {
      await updateDoc(doc(db, 'users', userId, 'inventory', phone.id), {
        status: nextStatus,
        expectedSellingPrice: phone.expectedSellingPrice,
        expectedProfit: phone.expectedProfit,
        notes: phone.notes,
        updatedAt: serverTimestamp(),
      });
      setSelectedPhone({ ...phone, status: nextStatus });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, docPath);
    } finally {
      setUpdatingStatus(false);
    }
  };

  return (
    <div className="space-y-3.5 pb-24">
      {/* Top Stock Header matching video 00:57 */}
      <div className="bg-white px-4 pt-4 pb-3 border-b border-[#E5E7EB]">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="font-display font-bold text-2xl text-[#111827]">
              Stock
            </h1>
            <p className="text-xs text-[#6B7280] tabular-nums">
              {activeStock.length} phones · cost ₹
              {totalActiveCost.toLocaleString('en-IN')}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onShareStock}
              title="Share Stock Catalog"
              className="w-10 h-10 rounded-xl border border-[#D1D5DB] bg-white hover:bg-[#F9FAFB] flex items-center justify-center text-[#111827]"
            >
              <Share2 className="w-4 h-4" />
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

        {/* Primary Status Filter Row matching 00:57 */}
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

        {/* Secondary Grade & Aging Filter Row matching 00:57 */}
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

      {/* Stock List Cards matching video 00:57 */}
      <div className="px-4 space-y-2.5">
        {filteredPhones.length === 0 ? (
          <div className="bg-white rounded-2xl border border-[#E5E7EB] p-8 text-center space-y-2">
            <Smartphone className="w-8 h-8 text-[#9CA3AF] mx-auto" />
            <div className="font-display font-bold text-sm text-[#111827]">
              No phones match this filter
            </div>
            <p className="text-xs text-[#6B7280]">
              Try clearing your search or switching tabs above.
            </p>
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
                onClick={() => setSelectedPhone(phone)}
                className="w-full bg-white rounded-2xl border border-[#E5E7EB] p-3 flex items-center justify-between gap-3 text-left hover:border-[#0F7B49] transition-colors active:scale-[0.995]"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {/* Phone Thumbnail */}
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

                  {/* Title & Age/Grade */}
                  <div className="min-w-0">
                    <div className="font-display font-bold text-sm text-[#111827] truncate">
                      {titleLabel} · {phone.ram.replace(' ', '')}/
                      {phone.storage.replace(' ', '')}
                    </div>
                    <div className="text-xs text-[#6B7280] mt-0.5">
                      {ageText} · {phone.grade}
                    </div>
                  </div>
                </div>

                {/* Right Price & Unboxed Status Text matching video 00:57 */}
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

      {/* Interactive Phone Detail Sheet */}
      {selectedPhone && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-5 space-y-4 shadow-2xl animate-sheet-up max-h-[88vh] overflow-y-auto no-scrollbar">
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
              <button
                type="button"
                onClick={() => setSelectedPhone(null)}
                className="w-9 h-9 rounded-full bg-[#F3F4F6] flex items-center justify-center text-[#374151]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Price & Seller Summary */}
            <div className="grid grid-cols-3 gap-2 bg-[#F6F7F8] p-3 rounded-2xl border border-[#E5E7EB] text-center">
              <div>
                <div className="text-[11px] text-[#6B7280]">Buy Price</div>
                <div className="font-display font-bold text-sm text-[#111827]">
                  ₹{selectedPhone.buyingPrice.toLocaleString('en-IN')}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-[#6B7280]">Expected Sell</div>
                <div className="font-display font-bold text-sm text-[#0F7B49]">
                  ₹{selectedPhone.expectedSellingPrice.toLocaleString('en-IN')}
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
                <strong>{selectedPhone.sellerName}</strong> (+91{' '}
                {selectedPhone.sellerMobile})
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
                className="w-full h-11 rounded-xl bg-[#F3F4F6] hover:bg-[#E5E7EB] text-[#111827] font-semibold text-xs flex items-center justify-center gap-2"
              >
                <FileText className="w-4 h-4 text-[#0F7B49]" />
                Download Shapath Patra PDF
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
