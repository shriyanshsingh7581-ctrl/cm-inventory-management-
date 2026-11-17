import React, { useState } from 'react';
import { doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import {
  DueRecord,
  KycRecord,
  PhoneInventoryItem,
  UserProfile,
} from '../types';
import { generateKycRegisterPdf } from '../utils/pdfGenerator';
import { seedInitialShopData } from '../utils/seedData';
import {
  Bell,
  Check,
  Copy,
  Crown,
  Download,
  IndianRupee,
  Loader2,
  LogOut,
  MessageCircle,
  PlayCircle,
  Plus,
  RefreshCw,
  Share2,
  ShieldCheck,
  Store,
  TrendingUp,
  Wrench,
  X,
} from 'lucide-react';

/* ============================================================================
   1. DUES MODAL (Quick Link: Dues)
============================================================================ */
interface DuesModalProps {
  userId: string;
  dues: DueRecord[];
  onClose: () => void;
}

export const DuesModal: React.FC<DuesModalProps> = ({
  userId,
  dues,
  onClose,
}) => {
  const [showAddForm, setShowAddForm] = useState(false);
  const [partyName, setPartyName] = useState('');
  const [partyMobile, setPartyMobile] = useState('');
  const [phoneModel, setPhoneModel] = useState('');
  const [amount, setAmount] = useState('');
  const [dueType, setDueType] = useState<'To Receive' | 'To Pay'>('To Receive');
  const [saving, setSaving] = useState(false);

  const pendingDues = dues.filter((d) => d.status === 'Pending');
  const settledDues = dues.filter((d) => d.status === 'Settled');

  const handleAddDue = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = Math.max(0, parseInt(amount || '0', 10) || 0);
    if (!partyName.trim() || amt <= 0) return;

    setSaving(true);
    const dueId = `due_${Date.now()}`;
    const path = `users/${userId}/dues`;
    try {
      await setDoc(doc(db, path, dueId), {
        id: dueId,
        userId,
        partyName: partyName.trim().slice(0, 120),
        partyMobile: partyMobile.replace(/\D/g, '').slice(0, 15) || '9826011223',
        phoneModel: phoneModel.trim().slice(0, 100) || 'Phone Transaction',
        amount: amt,
        dueType,
        status: 'Pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setPartyName('');
      setPartyMobile('');
      setPhoneModel('');
      setAmount('');
      setShowAddForm(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `${path}/${dueId}`);
    } finally {
      setSaving(false);
    }
  };

  const handleSettleDue = async (due: DueRecord) => {
    const path = `users/${userId}/dues/${due.id}`;
    try {
      await updateDoc(doc(db, 'users', userId, 'dues', due.id), {
        status: 'Settled',
        amount: due.amount,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-5 space-y-4 shadow-2xl animate-sheet-up max-h-[88vh] overflow-y-auto no-scrollbar">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-red-50 text-red-600 flex items-center justify-center">
              <IndianRupee className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-display font-bold text-base text-[#111827]">
                Dues &amp; Udhaar Ledger
              </h3>
              <p className="text-xs text-[#6B7280]">
                {pendingDues.length} pending · {settledDues.length} settled
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-[#F3F4F6] flex items-center justify-center text-[#374151]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Add New Due Button / Form */}
        {!showAddForm ? (
          <button
            type="button"
            onClick={() => setShowAddForm(true)}
            className="w-full h-11 rounded-xl border border-dashed border-[#0F7B49] bg-[#F0FDF4] text-[#0F7B49] font-semibold text-xs flex items-center justify-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            Add New Customer / Seller Due
          </button>
        ) : (
          <form
            onSubmit={handleAddDue}
            className="p-3.5 rounded-2xl bg-[#F9FAFB] border border-[#E5E7EB] space-y-2.5"
          >
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                required
                value={partyName}
                onChange={(e) => setPartyName(e.target.value)}
                placeholder="Party Name *"
                className="h-10 px-3 rounded-xl bg-white border border-[#D1D5DB] text-xs"
              />
              <input
                type="tel"
                maxLength={10}
                value={partyMobile}
                onChange={(e) =>
                  setPartyMobile(e.target.value.replace(/\D/g, '').slice(0, 10))
                }
                placeholder="Mobile (10 digits)"
                className="h-10 px-3 rounded-xl bg-white border border-[#D1D5DB] text-xs"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={phoneModel}
                onChange={(e) => setPhoneModel(e.target.value)}
                placeholder="Phone model / note"
                className="h-10 px-3 rounded-xl bg-white border border-[#D1D5DB] text-xs"
              />
              <input
                type="number"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Amount ₹ *"
                className="h-10 px-3 rounded-xl bg-white border border-[#D1D5DB] text-xs font-bold"
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <select
                value={dueType}
                onChange={(e) =>
                  setDueType(e.target.value as 'To Receive' | 'To Pay')
                }
                className="h-10 px-3 rounded-xl bg-white border border-[#D1D5DB] text-xs font-semibold flex-1"
              >
                <option value="To Receive">To Receive (Customer)</option>
                <option value="To Pay">To Pay (Seller / Dealer)</option>
              </select>
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="h-10 px-3 rounded-xl border border-[#D1D5DB] text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="h-10 px-4 rounded-xl bg-[#0F7B49] text-white text-xs font-semibold"
              >
                Save
              </button>
            </div>
          </form>
        )}

        {/* Dues List */}
        <div className="space-y-2.5">
          {dues.map((due) => (
            <div
              key={due.id}
              className="p-3.5 rounded-2xl border border-[#E5E7EB] bg-white flex items-center justify-between gap-3"
            >
              <div>
                <div className="font-display font-bold text-sm text-[#111827]">
                  {due.partyName}
                </div>
                <div className="text-xs text-[#6B7280]">
                  {due.phoneModel} · {due.dueType}
                </div>
                <div className="text-sm font-bold text-[#0F7B49] mt-1">
                  ₹{due.amount.toLocaleString('en-IN')} · {due.status}
                </div>
              </div>

              {due.status === 'Pending' ? (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      const text = `Namaste ${due.partyName}, friendly reminder for pending balance of ₹${due.amount.toLocaleString('en-IN')} for ${due.phoneModel}.`;
                      window.open(
                        `https://wa.me/91${due.partyMobile}?text=${encodeURIComponent(
                          text
                        )}`,
                        '_blank',
                        'noopener,noreferrer'
                      );
                    }}
                    className="h-9 px-2.5 rounded-xl border border-[#D1D5DB] text-xs font-semibold text-[#0F7B49] flex items-center gap-1"
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                    Remind
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSettleDue(due)}
                    className="h-9 px-3 rounded-xl bg-[#0F7B49] text-white text-xs font-semibold flex items-center gap-1"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Settle
                  </button>
                </div>
              ) : (
                <span className="text-xs font-semibold text-[#6B7280]">
                  ✓ Settled
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

/* ============================================================================
   2. SHARE STOCK MODAL (Quick Link: Share stock)
============================================================================ */
interface ShareStockModalProps {
  shopProfile: UserProfile;
  inventory: PhoneInventoryItem[];
  onClose: () => void;
}

export const ShareStockModal: React.FC<ShareStockModalProps> = ({
  shopProfile,
  inventory,
  onClose,
}) => {
  const [copied, setCopied] = useState(false);
  const readyPhones = inventory.filter((p) => p.status === 'Ready');

  const catalogText = [
    `📱 *${shopProfile.shopName} — Ready Pre-Owned Phones*`,
    `📍 ${shopProfile.city || 'Indore'} | 📞 ${shopProfile.phone || '+91 98270 11223'}`,
    `--------------------------------`,
    ...readyPhones.map(
      (p, i) =>
        `${i + 1}. *${p.brand} ${p.model}* (${p.ram}/${p.storage}) — Grade ${p.grade} — *₹${p.expectedSellingPrice.toLocaleString('en-IN')}*`
    ),
    `--------------------------------`,
    `✅ 100% KYC Verified Phones with Bill & Box`,
  ].join('\n');

  const handleCopy = () => {
    navigator.clipboard.writeText(catalogText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleWhatsAppShare = () => {
    window.open(
      `https://wa.me/?text=${encodeURIComponent(catalogText)}`,
      '_blank',
      'noopener,noreferrer'
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-5 space-y-4 shadow-2xl animate-sheet-up">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#E8F5EE] text-[#0F7B49] flex items-center justify-center">
              <Share2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-display font-bold text-base text-[#111827]">
                Share Ready Stock ({readyPhones.length} Phones)
              </h3>
              <p className="text-xs text-[#6B7280]">
                Send live catalog to customers or dealer groups
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-[#F3F4F6] flex items-center justify-center text-[#374151]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <pre className="p-3.5 rounded-2xl bg-[#F6F7F8] border border-[#E5E7EB] text-xs font-sans whitespace-pre-wrap text-[#1F2937] max-h-60 overflow-y-auto no-scrollbar">
          {catalogText}
        </pre>

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={handleCopy}
            className="h-12 rounded-xl border border-[#D1D5DB] font-semibold text-xs text-[#111827] flex items-center justify-center gap-2"
          >
            {copied ? (
              <>
                <Check className="w-4 h-4 text-[#0F7B49]" />
                Copied!
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                Copy List
              </>
            )}
          </button>
          <button
            type="button"
            onClick={handleWhatsAppShare}
            className="h-12 rounded-xl bg-[#0F7B49] text-white font-semibold text-xs flex items-center justify-center gap-2"
          >
            <MessageCircle className="w-4 h-4" />
            Share on WhatsApp
          </button>
        </div>
      </div>
    </div>
  );
};

/* ============================================================================
   3. PRO PLAN MODAL (Home Banner: Buy plan)
============================================================================ */
interface ProPlanModalProps {
  userId: string;
  shopProfile: UserProfile;
  onClose: () => void;
}

export const ProPlanModal: React.FC<ProPlanModalProps> = ({
  userId,
  shopProfile,
  onClose,
}) => {
  const [activating, setActivating] = useState(false);

  const handleActivatePro = async () => {
    setActivating(true);
    const path = `users/${userId}`;
    try {
      await updateDoc(doc(db, 'users', userId), {
        planStatus: 'pro',
        trialDaysLeft: 365,
        updatedAt: serverTimestamp(),
      });
      onClose();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    } finally {
      setActivating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-5 space-y-4 shadow-2xl animate-sheet-up">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center">
              <Crown className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-display font-bold text-base text-[#111827]">
                CM Inventory Management Pro
              </h3>
              <p className="text-xs text-[#6B7280]">
                ₹1,000 / year — less than ₹3 a day
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-[#F3F4F6] flex items-center justify-center text-[#374151]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="bg-[#F9FAFB] rounded-2xl border border-[#E5E7EB] p-4 space-y-2.5 text-xs text-[#374151]">
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-[#0F7B49]" />
            <span>Unlimited Buy/Sell KYC Entries &amp; Cloud Sync</span>
          </div>
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-[#0F7B49]" />
            <span>Instant Hindi &amp; English Shapath Patra PDF Generation</span>
          </div>
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-[#0F7B49]" />
            <span>1-Click Police KYC Register PDF Download</span>
          </div>
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-[#0F7B49]" />
            <span>Cloudinary Photo Backup for Phone &amp; Aadhaar Proofs</span>
          </div>
        </div>

        {shopProfile.planStatus === 'pro' ? (
          <div className="p-3.5 rounded-xl bg-[#E8F5EE] text-[#0F7B49] text-xs font-bold text-center">
            ✓ Your shop is already on the Annual Pro Plan (365 days active)
          </div>
        ) : (
          <button
            type="button"
            disabled={activating}
            onClick={handleActivatePro}
            className="w-full h-12 rounded-xl bg-[#0F7B49] text-white font-semibold text-sm flex items-center justify-center gap-2"
          >
            {activating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              'Activate Pro Plan (₹1,000 / Year)'
            )}
          </button>
        )}
      </div>
    </div>
  );
};

/* ============================================================================
   4. NOTIFICATIONS MODAL (Top Bar Bell)
============================================================================ */
interface NotificationsModalProps {
  inventory: PhoneInventoryItem[];
  dues: DueRecord[];
  onClose: () => void;
  onNavigateStockRepair: () => void;
  onOpenDues: () => void;
}

export const NotificationsModal: React.FC<NotificationsModalProps> = ({
  inventory,
  dues,
  onClose,
  onNavigateStockRepair,
  onOpenDues,
}) => {
  const repairPhones = inventory.filter((p) => p.status === 'Under repair');
  const pendingDues = dues.filter((d) => d.status === 'Pending');

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-5 space-y-4 shadow-2xl animate-sheet-up">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#E8F5EE] text-[#0F7B49] flex items-center justify-center">
              <Bell className="w-5 h-5" />
            </div>
            <h3 className="font-display font-bold text-base text-[#111827]">
              Shop Alerts &amp; Notifications
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-[#F3F4F6] flex items-center justify-center text-[#374151]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-2.5">
          {pendingDues.length > 0 && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenDues();
              }}
              className="w-full p-3.5 rounded-2xl border border-[#E5E7EB] bg-white hover:border-[#0F7B49] flex items-center justify-between text-left"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-red-50 text-red-600 flex items-center justify-center">
                  <IndianRupee className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-display font-bold text-xs text-[#111827]">
                    {pendingDues.length} Payment Due Pending
                  </div>
                  <div className="text-xs text-[#6B7280]">
                    Tap to view ledger &amp; send WhatsApp reminder
                  </div>
                </div>
              </div>
              <span className="text-xs font-bold text-[#0F7B49]">View &rarr;</span>
            </button>
          )}

          {repairPhones.length > 0 && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onNavigateStockRepair();
              }}
              className="w-full p-3.5 rounded-2xl border border-[#E5E7EB] bg-white hover:border-[#0F7B49] flex items-center justify-between text-left"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
                  <Wrench className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-display font-bold text-xs text-[#111827]">
                    {repairPhones.length} Phones Under Repair
                  </div>
                  <div className="text-xs text-[#6B7280]">
                    Mark them Ready once service is complete
                  </div>
                </div>
              </div>
              <span className="text-xs font-bold text-[#0F7B49]">Stock &rarr;</span>
            </button>
          )}

          <div className="p-3.5 rounded-2xl border border-[#E5E7EB] bg-[#F0FDF4] flex items-center gap-3">
            <ShieldCheck className="w-5 h-5 text-[#0F7B49] shrink-0" />
            <div className="text-xs text-[#064E3B]">
              <strong>100% KYC Compliance:</strong> All phones in your stock have
              verified Aadhaar last-4 digits and signed Shapath Patra records.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ============================================================================
   5. REPORTS VIEW (Bottom Tab: Reports)
============================================================================ */
interface ReportsViewProps {
  shopProfile: UserProfile;
  inventory: PhoneInventoryItem[];
  kycRecords: KycRecord[];
  onOpenKycRegister: () => void;
}

export const ReportsView: React.FC<ReportsViewProps> = ({
  shopProfile,
  inventory,
  kycRecords,
  onOpenKycRegister,
}) => {
  const soldPhones = inventory.filter((p) => p.status === 'Sold');
  const activePhones = inventory.filter((p) => p.status !== 'Sold');

  const totalSalesAmount = soldPhones.reduce(
    (sum, p) => sum + (p.actualSellingPrice || p.expectedSellingPrice),
    0
  );
  const totalRealizedProfit = soldPhones.reduce(
    (sum, p) =>
      sum + ((p.actualSellingPrice || p.expectedSellingPrice) - p.buyingPrice),
    0
  );
  const totalStockValue = activePhones.reduce(
    (sum, p) => sum + p.buyingPrice,
    0
  );
  const expectedStockProfit = activePhones.reduce(
    (sum, p) => sum + p.expectedProfit,
    0
  );

  return (
    <div className="p-4 space-y-4 pb-24">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display font-bold text-2xl text-[#111827]">
            Reports &amp; P&amp;L
          </h1>
          <p className="text-xs text-[#6B7280]">
            Real-time financial &amp; inventory summary for {shopProfile.shopName}
          </p>
        </div>
        <button
          type="button"
          onClick={() =>
            generateKycRegisterPdf(
              kycRecords,
              shopProfile,
              '01 Oct 2026 - 28 Oct 2026',
              'download'
            )
          }
          className="h-10 px-3.5 rounded-xl bg-[#0F7B49] text-white text-xs font-semibold flex items-center gap-1.5"
        >
          <Download className="w-4 h-4" />
          Export PDF
        </button>
      </div>

      {/* Profit & Sales Cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-[#0F7B49] text-white rounded-2xl p-4">
          <div className="text-xs text-[#D1FAE5]">Realized Net Profit</div>
          <div className="font-display font-extrabold text-2xl mt-1 tabular-nums">
            ₹{totalRealizedProfit.toLocaleString('en-IN')}
          </div>
          <div className="text-xs text-[#A7F3D0] mt-1">
            {soldPhones.length} phones sold
          </div>
        </div>
        <div className="bg-white border border-[#E5E7EB] rounded-2xl p-4">
          <div className="text-xs text-[#6B7280]">Total Sales Revenue</div>
          <div className="font-display font-extrabold text-2xl text-[#111827] mt-1 tabular-nums">
            ₹{totalSalesAmount.toLocaleString('en-IN')}
          </div>
          <div className="text-xs text-[#6B7280] mt-1">
            Avg margin ₹
            {soldPhones.length > 0
              ? Math.round(totalRealizedProfit / soldPhones.length).toLocaleString(
                  'en-IN'
                )
              : 0}
            /phone
          </div>
        </div>
      </div>

      {/* Active Inventory Valuation */}
      <div className="bg-white border border-[#E5E7EB] rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-[#0F7B49]" />
            <h3 className="font-display font-bold text-sm text-[#111827]">
              Current Stock Valuation
            </h3>
          </div>
          <span className="text-xs text-[#6B7280]">
            {activePhones.length} phones in hand
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 pt-1">
          <div className="p-3 rounded-xl bg-[#F6F7F8]">
            <div className="text-xs text-[#6B7280]">Capital Invested</div>
            <div className="font-display font-bold text-lg text-[#111827] mt-0.5 tabular-nums">
              ₹{totalStockValue.toLocaleString('en-IN')}
            </div>
          </div>
          <div className="p-3 rounded-xl bg-[#E8F5EE]">
            <div className="text-xs text-[#064E3B]">Projected Profit</div>
            <div className="font-display font-bold text-lg text-[#0F7B49] mt-0.5 tabular-nums">
              +₹{expectedStockProfit.toLocaleString('en-IN')}
            </div>
          </div>
        </div>
      </div>

      {/* Grade Breakdown */}
      <div className="bg-white border border-[#E5E7EB] rounded-2xl p-4 space-y-3">
        <h3 className="font-display font-bold text-sm text-[#111827]">
          Stock Breakdown by Condition Grade
        </h3>
        <div className="grid grid-cols-4 gap-2 text-center">
          {(['A', 'B', 'C', 'D'] as const).map((g) => {
            const count = activePhones.filter((p) => p.grade === g).length;
            return (
              <div
                key={g}
                className="p-3 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB]"
              >
                <div className="font-display font-bold text-base text-[#0F7B49]">
                  Grade {g}
                </div>
                <div className="text-xs text-[#4B5563] mt-0.5">
                  {count} phones
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Quick KYC Compliance Link */}
      <button
        type="button"
        onClick={onOpenKycRegister}
        className="w-full bg-white border border-[#E5E7EB] rounded-2xl p-4 flex items-center justify-between hover:border-[#0F7B49]"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#E8F5EE] text-[#0F7B49] flex items-center justify-center">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div className="text-left">
            <div className="font-display font-bold text-sm text-[#111827]">
              Official Police KYC Register
            </div>
            <div className="text-xs text-[#6B7280]">
              {kycRecords.length} verified records · 100% KYC done
            </div>
          </div>
        </div>
        <span className="text-xs font-bold text-[#0F7B49]">Open &rarr;</span>
      </button>
    </div>
  );
};

/* ============================================================================
   6. MORE / PROFILE VIEW (Bottom Tab: More)
============================================================================ */
interface MoreViewProps {
  userId: string;
  shopProfile: UserProfile;
  onOpenKycRegister: () => void;
  onOpenDues: () => void;
}

export const MoreView: React.FC<MoreViewProps> = ({
  userId,
  shopProfile,
  onOpenKycRegister,
  onOpenDues,
}) => {
  const [shopName, setShopName] = useState(shopProfile.shopName);
  const [ownerName, setOwnerName] = useState(shopProfile.ownerName);
  const [phone, setPhone] = useState(shopProfile.phone);
  const [city, setCity] = useState(shopProfile.city);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [showRefVideo, setShowRefVideo] = useState(false);

  const handleSaveShopProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    const path = `users/${userId}`;
    try {
      await updateDoc(doc(db, 'users', userId), {
        shopName: shopName.trim().slice(0, 120) || 'Sharma Mobile Point',
        ownerName: ownerName.trim().slice(0, 120) || 'Rajesh Sharma',
        phone: phone.trim().slice(0, 20),
        city: city.trim().slice(0, 200),
        updatedAt: serverTimestamp(),
      });
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 2500);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    } finally {
      setSavingProfile(false);
    }
  };

  const handleResetDemoData = async () => {
    setSeeding(true);
    try {
      await seedInitialShopData(userId);
    } finally {
      setSeeding(false);
    }
  };

  return (
    <div className="p-4 space-y-4 pb-24">
      <div>
        <h1 className="font-display font-bold text-2xl text-[#111827]">
          Shop Settings &amp; Tools
        </h1>
        <p className="text-xs text-[#6B7280]">
          Multi-tenant isolated account: {shopProfile.email}
        </p>
      </div>

      {/* Shop Profile Form */}
      <form
        onSubmit={handleSaveShopProfile}
        className="bg-white border border-[#E5E7EB] rounded-2xl p-4 space-y-3"
      >
        <div className="flex items-center gap-2 mb-1">
          <Store className="w-4 h-4 text-[#0F7B49]" />
          <h3 className="font-display font-bold text-sm text-[#111827]">
            Shop Details (Printed on Shapath Patra PDF)
          </h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-[#6B7280] mb-1">
              Shop Name
            </label>
            <input
              type="text"
              required
              value={shopName}
              onChange={(e) => setShopName(e.target.value)}
              className="w-full h-11 px-3.5 rounded-xl border border-[#D1D5DB] text-sm font-medium text-[#111827]"
            />
          </div>
          <div>
            <label className="block text-xs text-[#6B7280] mb-1">
              Owner Name
            </label>
            <input
              type="text"
              required
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              className="w-full h-11 px-3.5 rounded-xl border border-[#D1D5DB] text-sm font-medium text-[#111827]"
            />
          </div>
          <div>
            <label className="block text-xs text-[#6B7280] mb-1">
              Shop Phone
            </label>
            <input
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full h-11 px-3.5 rounded-xl border border-[#D1D5DB] text-sm font-medium text-[#111827]"
            />
          </div>
          <div>
            <label className="block text-xs text-[#6B7280] mb-1">
              Shop Address &amp; City
            </label>
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="w-full h-11 px-3.5 rounded-xl border border-[#D1D5DB] text-sm font-medium text-[#111827]"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={savingProfile}
          className="w-full h-11 rounded-xl bg-[#0F7B49] text-white text-xs font-semibold flex items-center justify-center gap-2"
        >
          {savingProfile ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : savedNotice ? (
            '✓ Shop Profile Saved'
          ) : (
            'Update Shop Details'
          )}
        </button>
      </form>

      {/* Quick Tools */}
      <div className="bg-white border border-[#E5E7EB] rounded-2xl divide-y divide-[#F3F4F6] overflow-hidden">
        <button
          type="button"
          onClick={onOpenKycRegister}
          className="w-full p-4 flex items-center justify-between text-left hover:bg-[#F9FAFB]"
        >
          <span className="font-display font-semibold text-sm text-[#111827]">
            Police KYC Register &amp; PDF Export
          </span>
          <span className="text-xs font-semibold text-[#0F7B49]">Open &rarr;</span>
        </button>

        <button
          type="button"
          onClick={onOpenDues}
          className="w-full p-4 flex items-center justify-between text-left hover:bg-[#F9FAFB]"
        >
          <span className="font-display font-semibold text-sm text-[#111827]">
            Pending Dues &amp; Udhaar Tracker
          </span>
          <span className="text-xs font-semibold text-[#0F7B49]">Open &rarr;</span>
        </button>

        <button
          type="button"
          onClick={handleResetDemoData}
          disabled={seeding}
          className="w-full p-4 flex items-center justify-between text-left hover:bg-[#F9FAFB]"
        >
          <div className="flex items-center gap-2">
            <RefreshCw className={`w-4 h-4 text-[#0F7B49] ${seeding ? 'animate-spin' : ''}`} />
            <span className="font-display font-semibold text-sm text-[#111827]">
              Restore / Sync Reference Video Demo Stock
            </span>
          </div>
          <span className="text-xs font-semibold text-[#0F7B49]">
            {seeding ? 'Syncing...' : 'Sync Now'}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setShowRefVideo((v) => !v)}
          className="w-full p-4 flex items-center justify-between text-left hover:bg-[#F9FAFB]"
        >
          <div className="flex items-center gap-2">
            <PlayCircle className="w-4 h-4 text-[#0F7B49]" />
            <span className="font-display font-semibold text-sm text-[#111827]">
              Watch MobileOne Old Phone Walkthrough Video
            </span>
          </div>
          <span className="text-xs font-semibold text-[#0F7B49]">
            {showRefVideo ? 'Hide' : 'Play'}
          </span>
        </button>
      </div>

      {showRefVideo && (
        <div className="bg-white border border-[#E5E7EB] rounded-2xl p-3">
          <video
            src="/assets/aistudio/VID-20261113-WA0000_1__19c28332.mp4"
            controls
            className="w-full max-w-xs mx-auto rounded-xl"
          />
        </div>
      )}

      {/* Sign Out Button */}
      <button
        type="button"
        onClick={() => signOut(auth)}
        className="w-full h-12 rounded-2xl border border-red-200 bg-red-50 text-red-700 font-semibold text-sm flex items-center justify-center gap-2"
      >
        <LogOut className="w-4 h-4" />
        Sign Out of Shop Account
      </button>
    </div>
  );
};
