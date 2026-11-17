/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from './firebase';
import {
  DueRecord,
  KycRecord,
  PhoneInventoryItem,
  UserProfile,
} from './types';
import { seedInitialShopData } from './utils/seedData';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AuthScreen } from './components/AuthScreen';
import { BuyPhoneWizard } from './components/BuyPhoneWizard';
import { SellPhoneModal } from './components/SellPhoneModal';
import { StockView } from './components/StockView';
import { KycRegisterView } from './components/KycRegisterView';
import { ImeiScannerModal } from './components/ImeiScannerModal';
import {
  DuesModal,
  MoreView,
  NotificationsModal,
  ProPlanModal,
  ReportsView,
  ShareStockModal,
} from './components/QuickModals';
import {
  BarChart3,
  Bell,
  Camera,
  ChevronRight,
  FileCheck2,
  Home as HomeIcon,
  IndianRupee,
  LayoutGrid,
  Loader2,
  MoreHorizontal,
  Receipt,
  Share2,
  ShieldCheck,
  Smartphone,
  Truck,
} from 'lucide-react';

export function AppContent() {
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [shopProfile, setShopProfile] = useState<UserProfile | null>(null);
  const [inventory, setInventory] = useState<PhoneInventoryItem[]>([]);
  const [kycRecords, setKycRecords] = useState<KycRecord[]>([]);
  const [dues, setDues] = useState<DueRecord[]>([]);
  const [seedingInitial, setSeedingInitial] = useState(false);

  // Navigation & Active Modals
  const [activeTab, setActiveTab] = useState<'Home' | 'Stock' | 'Reports' | 'More'>(
    'Home'
  );
  const [stockInitialFilter, setStockInitialFilter] = useState<
    'All' | 'Ready' | 'Under repair' | 'Sold' | '30+ days'
  >('All');

  const [buyWizardMode, setBuyWizardMode] = useState<
    'Customer' | 'Dealer' | null
  >(null);
  const [sellModalPhone, setSellModalPhone] = useState<
    PhoneInventoryItem | 'open' | null
  >(null);
  const [showKycRegister, setShowKycRegister] = useState(false);
  const [showDuesModal, setShowDuesModal] = useState(false);
  const [showShareStockModal, setShowShareStockModal] = useState(false);
  const [showProPlanModal, setShowProPlanModal] = useState(false);
  const [showNotificationsModal, setShowNotificationsModal] = useState(false);
  const [showScannerSearch, setShowScannerSearch] = useState(false);

  const pendingShopMetaRef = useRef<{ shopName: string; ownerName: string }>({
    shopName: 'Sharma Mobile Point',
    ownerName: 'Rajesh Sharma',
  });
  const seededOnceRef = useRef<string | null>(null);

  // 1. Listen to Firebase Authentication State
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      setAuthReady(true);

      if (user) {
        const userDocRef = doc(db, 'users', user.uid);
        try {
          const snap = await getDoc(userDocRef);
          if (!snap.exists()) {
            const newProfile: UserProfile = {
              uid: user.uid,
              email: user.email || 'shop@mobileone.app',
              shopName:
                pendingShopMetaRef.current.shopName || 'Sharma Mobile Point',
              ownerName:
                user.displayName ||
                pendingShopMetaRef.current.ownerName ||
                'Rajesh Sharma',
              phone: '+91 98270 11223',
              city: 'Shop 12, M.G. Road, Indore',
              planStatus: 'trial',
              trialDaysLeft: 12,
            };
            await setDoc(userDocRef, {
              ...newProfile,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
            setShopProfile(newProfile);

            // Seed initial reference stock & KYC records on brand-new shop registration
            if (seededOnceRef.current !== user.uid) {
              seededOnceRef.current = user.uid;
              setSeedingInitial(true);
              await seedInitialShopData(user.uid);
              setSeedingInitial(false);
            }
          } else {
            setShopProfile(snap.data() as UserProfile);
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
        }
      } else {
        setShopProfile(null);
        setInventory([]);
        setKycRecords([]);
        setDues([]);
      }
    });

    return () => unsub();
  }, []);

  // 2. Attach real-time Firestore listeners once authenticated and shop profile exists
  useEffect(() => {
    if (!authReady || !currentUser || !shopProfile) return;

    const uid = currentUser.uid;

    const unsubProfile = onSnapshot(
      doc(db, 'users', uid),
      (snap) => {
        if (snap.exists()) {
          setShopProfile(snap.data() as UserProfile);
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, `users/${uid}`);
      }
    );

    const invQuery = query(
      collection(db, 'users', uid, 'inventory'),
      where('userId', '==', uid)
    );
    const unsubInventory = onSnapshot(
      invQuery,
      async (snap) => {
        const items = snap.docs.map((d) => d.data() as PhoneInventoryItem);
        // Sort newest ("today") first so newly purchased phones appear at the very top of Stock!
        items.sort((a, b) => {
          if (a.purchaseDate === 'today' && b.purchaseDate !== 'today') return -1;
          if (b.purchaseDate === 'today' && a.purchaseDate !== 'today') return 1;
          return a.daysInStock - b.daysInStock;
        });
        setInventory(items);

        // If existing account has 0 phones and hasn't been seeded in this session, auto-seed
        if (
          items.length === 0 &&
          seededOnceRef.current !== uid &&
          !seedingInitial
        ) {
          seededOnceRef.current = uid;
          setSeedingInitial(true);
          try {
            await seedInitialShopData(uid);
          } finally {
            setSeedingInitial(false);
          }
        }
      },
      (error) => {
        handleFirestoreError(
          error,
          OperationType.LIST,
          `users/${uid}/inventory`
        );
      }
    );

    const kycQuery = query(
      collection(db, 'users', uid, 'kyc_records'),
      where('userId', '==', uid)
    );
    const unsubKyc = onSnapshot(
      kycQuery,
      (snap) => {
        const records = snap.docs.map((d) => d.data() as KycRecord);
        records.sort((a, b) => {
          if (a.dateLabel === '28 Oct' && b.dateLabel !== '28 Oct') return -1;
          if (b.dateLabel === '28 Oct' && a.dateLabel !== '28 Oct') return 1;
          return b.id.localeCompare(a.id);
        });
        setKycRecords(records);
      },
      (error) => {
        handleFirestoreError(
          error,
          OperationType.LIST,
          `users/${uid}/kyc_records`
        );
      }
    );

    const duesQuery = query(
      collection(db, 'users', uid, 'dues'),
      where('userId', '==', uid)
    );
    const unsubDues = onSnapshot(
      duesQuery,
      (snap) => {
        const records = snap.docs.map((d) => d.data() as DueRecord);
        setDues(records);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, `users/${uid}/dues`);
      }
    );

    return () => {
      unsubProfile();
      unsubInventory();
      unsubKyc();
      unsubDues();
    };
  }, [authReady, currentUser, shopProfile?.uid, seedingInitial]);

  // 3. Computed Home Screen Metrics (matching video 00:04 and updating dynamically on new buys/sells!)
  const dashboardMetrics = useMemo(() => {
    const activeStock = inventory.filter((p) => p.status !== 'Sold');
    const readyToSell = activeStock.filter((p) => p.status === 'Ready');
    const underRepair = activeStock.filter((p) => p.status === 'Under repair');
    const inStock30Plus = activeStock.filter((p) => p.daysInStock >= 30);

    const soldPhones = inventory.filter((p) => p.status === 'Sold');
    const todaySoldCount = soldPhones.length;
    const todaySalesRevenue = soldPhones.reduce(
      (sum, p) => sum + (p.actualSellingPrice || p.expectedSellingPrice),
      0
    );
    const todayProfit = soldPhones.reduce(
      (sum, p) =>
        sum + ((p.actualSellingPrice || p.expectedSellingPrice) - p.buyingPrice),
      0
    );

    // Phones bought "today" during this session
    const boughtTodayPhones = inventory.filter((p) => p.purchaseDate === 'today');
    const todayPurchasesAmount = boughtTodayPhones.reduce(
      (sum, p) => sum + p.buyingPrice,
      0
    );

    const pendingDuesCount = dues.filter((d) => d.status === 'Pending').length;

    return {
      totalActiveStock: activeStock.length,
      readyCount: readyToSell.length,
      underRepairCount: underRepair.length,
      oldStockCount: inStock30Plus.length,
      todayProfit,
      todaySoldCount,
      todaySalesRevenue,
      todayPurchasesAmount,
      todayPurchasesCount: boughtTodayPhones.length,
      pendingDuesCount,
    };
  }, [inventory, dues]);

  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#0E5E36] flex flex-col items-center justify-center p-6 text-white">
        <div className="w-24 h-24 rounded-3xl bg-white p-1.5 flex items-center justify-center mb-4 shadow-xl overflow-hidden">
          <img
            src="/assets/aistudio/file_00000000ec948211aa20fd47696280f7_7fc20087.png"
            alt="CM Inventory Management"
            referrerPolicy="no-referrer"
            className="w-full h-full object-contain rounded-2xl"
          />
        </div>
        <div className="font-display font-bold text-lg text-white mb-2">
          CM Inventory Management
        </div>
        <Loader2 className="w-6 h-6 animate-spin text-[#A7F3D0]" />
      </div>
    );
  }

  if (!currentUser) {
    return (
      <AuthScreen
        onPendingShopDetails={(sName, oName) => {
          pendingShopMetaRef.current = { shopName: sName, ownerName: oName };
        }}
      />
    );
  }

  const activeShop: UserProfile = shopProfile || {
    uid: currentUser.uid,
    email: currentUser.email || 'shop@mobileone.app',
    shopName: 'Sharma Mobile Point',
    ownerName: 'Rajesh Sharma',
    phone: '+91 98270 11223',
    city: 'Shop 12, M.G. Road, Indore',
    planStatus: 'trial',
    trialDaysLeft: 12,
  };

  const shopInitial = (activeShop.shopName || 'S').charAt(0).toUpperCase();

  return (
    <div className="min-h-screen bg-[#F6F7F8] text-[#111827]">
      {/* Responsive Shell: Full-bleed native mobile app on phones/APK, and clean multi-column workspace on wide desktop screens */}
      <div className="max-w-6xl mx-auto lg:grid lg:grid-cols-12 lg:gap-6 lg:py-6 lg:px-6">
        {/* Primary Native Mobile App Column */}
        <div className="lg:col-span-7 xl:col-span-6 bg-[#F6F7F8] lg:bg-white lg:rounded-3xl lg:border lg:border-[#E5E7EB] lg:shadow-sm lg:overflow-x-clip min-h-dvh lg:min-h-[820px] flex flex-col relative">
          {/* ==============================================================
              HOME TAB (Exact match to video 00:04)
          ============================================================== */}
          {activeTab === 'Home' && (
            <div className="flex-1 pb-24">
              {/* Top Bar matching video 00:04 + CM Inventory Management Logo */}
              <header className="bg-white px-4 pt-3.5 pb-3 border-b border-[#E5E7EB] flex items-center justify-between">
                <div className="flex items-center gap-2.5 min-w-0">
                  <img
                    src="/assets/aistudio/file_00000000ec948211aa20fd47696280f7_7fc20087.png"
                    alt="CM Inventory Management Logo"
                    referrerPolicy="no-referrer"
                    className="w-10 h-10 rounded-xl object-contain shrink-0 border border-[#E5E7EB] bg-white p-0.5"
                  />
                  <div className="min-w-0">
                    <h1 className="font-display font-bold text-base sm:text-lg text-[#111827] leading-tight truncate">
                      {activeShop.shopName}
                    </h1>
                    <p className="text-xs text-[#6B7280] truncate">
                      CM Inventory Management · Wednesday, 28 Oct
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2.5">
                  {/* Notification Bell with Red Indicator */}
                  <button
                    type="button"
                    onClick={() => setShowNotificationsModal(true)}
                    aria-label="Notifications"
                    className="w-10 h-10 rounded-full bg-[#F3F4F6] hover:bg-[#E5E7EB] flex items-center justify-center relative text-[#374151] transition-colors"
                  >
                    <Bell className="w-5 h-5" />
                    {(dashboardMetrics.pendingDuesCount > 0 ||
                      dashboardMetrics.underRepairCount > 0) && (
                      <span className="w-2.5 h-2.5 rounded-full bg-red-500 border-2 border-white absolute top-2 right-2.5" />
                    )}
                  </button>

                  {/* Profile Avatar Circle ("S") */}
                  <button
                    type="button"
                    onClick={() => setActiveTab('More')}
                    aria-label="Shop Profile"
                    className="w-10 h-10 rounded-full bg-[#0F7B49] text-white font-display font-bold text-base flex items-center justify-center shadow-2xs"
                  >
                    {shopInitial}
                  </button>
                </div>
              </header>

              <main className="p-4 space-y-4">
                {seedingInitial && (
                  <div className="bg-[#E8F5EE] border border-[#A7F3D0] rounded-2xl p-3 flex items-center gap-2.5 text-xs font-semibold text-[#064E3B]">
                    <Loader2 className="w-4 h-4 animate-spin text-[#0F7B49]" />
                    Syncing your shop inventory &amp; KYC records...
                  </div>
                )}

                {/* Top Primary Actions: Buy phone & Sell phone (00:04) */}
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setBuyWizardMode('Customer')}
                    className="h-14 rounded-2xl bg-[#0F7B49] hover:bg-[#0C633A] text-white font-display font-bold text-base flex items-center justify-center gap-2.5 shadow-xs active:scale-[0.99] transition-all"
                  >
                    <Camera className="w-5 h-5" />
                    Buy phone
                  </button>
                  <button
                    type="button"
                    onClick={() => setSellModalPhone('open')}
                    className="h-14 rounded-2xl bg-white hover:bg-[#F9FAFB] border border-[#D1D5DB] text-[#111827] font-display font-bold text-base flex items-center justify-center gap-2.5 shadow-2xs active:scale-[0.99] transition-all"
                  >
                    <Receipt className="w-5 h-5 text-[#111827]" />
                    Sell phone
                  </button>
                </div>

                {/* Quick Links Strip: Dealer buy | Dues (1) | KYC Register | Share stock (00:04) */}
                <div className="bg-white rounded-2xl border border-[#E5E7EB] p-3.5 grid grid-cols-4 gap-2">
                  <button
                    type="button"
                    onClick={() => setBuyWizardMode('Dealer')}
                    className="flex flex-col items-center justify-center gap-1.5 py-1 group"
                  >
                    <div className="w-12 h-12 rounded-2xl bg-[#F3F4F6] group-hover:bg-[#E8F5EE] text-[#111827] group-hover:text-[#0F7B49] flex items-center justify-center transition-colors">
                      <Truck className="w-5 h-5" />
                    </div>
                    <span className="text-xs font-medium text-[#374151] whitespace-nowrap">
                      Dealer buy
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowDuesModal(true)}
                    className="flex flex-col items-center justify-center gap-1.5 py-1 group relative"
                  >
                    <div className="w-12 h-12 rounded-2xl bg-[#F3F4F6] group-hover:bg-[#E8F5EE] text-[#111827] group-hover:text-[#0F7B49] flex items-center justify-center relative transition-colors">
                      <IndianRupee className="w-5 h-5" />
                      {dashboardMetrics.pendingDuesCount > 0 && (
                        <span className="w-5 h-5 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center absolute -top-1 -right-1 shadow-xs">
                          {dashboardMetrics.pendingDuesCount}
                        </span>
                      )}
                    </div>
                    <span className="text-xs font-medium text-[#374151] whitespace-nowrap">
                      Dues
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowKycRegister(true)}
                    className="flex flex-col items-center justify-center gap-1.5 py-1 group"
                  >
                    <div className="w-12 h-12 rounded-2xl bg-[#F3F4F6] group-hover:bg-[#E8F5EE] text-[#111827] group-hover:text-[#0F7B49] flex items-center justify-center transition-colors">
                      <FileCheck2 className="w-5 h-5" />
                    </div>
                    <span className="text-xs font-medium text-[#374151] whitespace-nowrap">
                      KYC Register
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowShareStockModal(true)}
                    className="flex flex-col items-center justify-center gap-1.5 py-1 group"
                  >
                    <div className="w-12 h-12 rounded-2xl bg-[#F3F4F6] group-hover:bg-[#E8F5EE] text-[#111827] group-hover:text-[#0F7B49] flex items-center justify-center transition-colors">
                      <Share2 className="w-5 h-5" />
                    </div>
                    <span className="text-xs font-medium text-[#374151] whitespace-nowrap">
                      Share stock
                    </span>
                  </button>
                </div>

                {/* Free Trial Pro Banner matching 00:04 */}
                <div className="bg-[#FFFBEB] border border-[#FDE68A] rounded-2xl p-4 flex items-center justify-between gap-3">
                  <div>
                    <div className="font-display font-bold text-sm text-[#92400E]">
                      {activeShop.planStatus === 'pro'
                        ? 'CM Inventory Management Pro Active · 365 days'
                        : `Free trial (Pro) · ${activeShop.trialDaysLeft} days left`}
                    </div>
                    <div className="text-xs text-[#B45309] mt-0.5 leading-snug">
                      Plans from ₹1,000 a year — less than ₹3 a day
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowProPlanModal(true)}
                    className="h-10 px-4 rounded-xl bg-[#0F7B49] hover:bg-[#0C633A] text-white font-semibold text-xs whitespace-nowrap shrink-0 transition-colors"
                  >
                    {activeShop.planStatus === 'pro' ? 'Pro Active' : 'Buy plan'}
                  </button>
                </div>

                {/* Today Section matching 00:04 */}
                <section className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <h2 className="font-display font-bold text-base text-[#111827]">
                      Today
                    </h2>
                    <button
                      type="button"
                      onClick={() => setActiveTab('Reports')}
                      className="text-xs font-semibold text-[#0F7B49] hover:underline"
                    >
                      Reports
                    </button>
                  </div>

                  <div className="grid grid-cols-3 gap-2.5">
                    {/* Profit Card (Solid Green) */}
                    <button
                      type="button"
                      onClick={() => setActiveTab('Reports')}
                      className="bg-[#0F7B49] text-white rounded-2xl p-3.5 text-left shadow-2xs"
                    >
                      <div className="text-xs text-[#D1FAE5]">Profit</div>
                      <div className="font-display font-extrabold text-xl mt-1 tabular-nums">
                        ₹{dashboardMetrics.todayProfit.toLocaleString('en-IN')}
                      </div>
                      <div className="text-[11px] text-[#A7F3D0] mt-1">
                        {dashboardMetrics.todaySoldCount} sold
                      </div>
                    </button>

                    {/* Sales Card */}
                    <button
                      type="button"
                      onClick={() => {
                        setStockInitialFilter('Sold');
                        setActiveTab('Stock');
                      }}
                      className="bg-white border border-[#E5E7EB] rounded-2xl p-3.5 text-left"
                    >
                      <div className="text-xs text-[#6B7280]">Sales</div>
                      <div className="font-display font-extrabold text-xl text-[#111827] mt-1 tabular-nums">
                        ₹
                        {dashboardMetrics.todaySalesRevenue.toLocaleString(
                          'en-IN'
                        )}
                      </div>
                      <div className="text-[11px] text-[#6B7280] mt-1">
                        {dashboardMetrics.todaySoldCount} phones
                      </div>
                    </button>

                    {/* Purchases Card */}
                    <button
                      type="button"
                      onClick={() => {
                        setStockInitialFilter('All');
                        setActiveTab('Stock');
                      }}
                      className="bg-white border border-[#E5E7EB] rounded-2xl p-3.5 text-left"
                    >
                      <div className="text-xs text-[#6B7280]">Purchases</div>
                      <div className="font-display font-extrabold text-xl text-[#111827] mt-1 tabular-nums">
                        ₹
                        {dashboardMetrics.todayPurchasesAmount.toLocaleString(
                          'en-IN'
                        )}
                      </div>
                      <div className="text-[11px] text-[#6B7280] mt-1">
                        {dashboardMetrics.todayPurchasesCount} phones
                      </div>
                    </button>
                  </div>
                </section>

                {/* Stock Summary Section matching 00:04 */}
                <section className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <h2 className="font-display font-bold text-base text-[#111827]">
                      Stock · {dashboardMetrics.totalActiveStock} phones
                    </h2>
                    <button
                      type="button"
                      onClick={() => {
                        setStockInitialFilter('All');
                        setActiveTab('Stock');
                      }}
                      className="text-xs font-semibold text-[#0F7B49] hover:underline"
                    >
                      View all
                    </button>
                  </div>

                  <div className="bg-white rounded-2xl border border-[#E5E7EB] divide-y divide-[#F3F4F6] overflow-hidden">
                    <button
                      type="button"
                      onClick={() => {
                        setStockInitialFilter('Ready');
                        setActiveTab('Stock');
                      }}
                      className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-[#F9FAFB] transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <span className="w-2.5 h-2.5 rounded-full bg-[#0F7B49]" />
                        <span className="font-medium text-sm text-[#111827]">
                          Ready to sell
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 font-display font-bold text-sm text-[#111827] tabular-nums">
                        <span>{dashboardMetrics.readyCount}</span>
                        <ChevronRight className="w-4 h-4 text-[#9CA3AF]" />
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setStockInitialFilter('Under repair');
                        setActiveTab('Stock');
                      }}
                      className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-[#F9FAFB] transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <span className="w-2.5 h-2.5 rounded-full bg-[#D97706]" />
                        <span className="font-medium text-sm text-[#111827]">
                          Under repair
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 font-display font-bold text-sm text-[#111827] tabular-nums">
                        <span>{dashboardMetrics.underRepairCount}</span>
                        <ChevronRight className="w-4 h-4 text-[#9CA3AF]" />
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setStockInitialFilter('30+ days');
                        setActiveTab('Stock');
                      }}
                      className="w-full px-4 py-3.5 flex items-center justify-between hover:bg-[#F9FAFB] transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <span className="w-2.5 h-2.5 rounded-full bg-[#DC2626]" />
                        <span className="font-medium text-sm text-[#111827]">
                          In stock 30+ days
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 font-display font-bold text-sm text-[#111827] tabular-nums">
                        <span>{dashboardMetrics.oldStockCount}</span>
                        <ChevronRight className="w-4 h-4 text-[#9CA3AF]" />
                      </div>
                    </button>
                  </div>
                </section>
              </main>
            </div>
          )}

          {/* ==============================================================
              STOCK TAB (Exact match to video 00:57)
          ============================================================== */}
          {activeTab === 'Stock' && (
            <StockView
              userId={currentUser.uid}
              shopProfile={activeShop}
              inventory={inventory}
              kycRecords={kycRecords}
              initialFilter={stockInitialFilter}
              onSellPhone={(phone) => setSellModalPhone(phone)}
              onShareStock={() => setShowShareStockModal(true)}
              onOpenScannerSearch={() => setShowScannerSearch(true)}
            />
          )}

          {/* ==============================================================
              REPORTS TAB
          ============================================================== */}
          {activeTab === 'Reports' && (
            <ReportsView
              shopProfile={activeShop}
              inventory={inventory}
              kycRecords={kycRecords}
              onOpenKycRegister={() => setShowKycRegister(true)}
            />
          )}

          {/* ==============================================================
              MORE TAB
          ============================================================== */}
          {activeTab === 'More' && (
            <MoreView
              userId={currentUser.uid}
              shopProfile={activeShop}
              onOpenKycRegister={() => setShowKycRegister(true)}
              onOpenDues={() => setShowDuesModal(true)}
            />
          )}

          {/* ==============================================================
              BOTTOM NAVIGATION BAR (Home | Stock | Reports | More)
          ============================================================== */}
          <nav className="fixed lg:sticky bottom-0 left-0 right-0 z-30 bg-white border-t border-[#E5E7EB] h-16 grid grid-cols-4 items-center">
            {(
              [
                { id: 'Home', label: 'Home', icon: HomeIcon },
                { id: 'Stock', label: 'Stock', icon: LayoutGrid },
                { id: 'Reports', label: 'Reports', icon: BarChart3 },
                { id: 'More', label: 'More', icon: MoreHorizontal },
              ] as const
            ).map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    if (tab.id === 'Stock') {
                      setStockInitialFilter('All');
                    }
                    setActiveTab(tab.id);
                  }}
                  className={`h-full flex flex-col items-center justify-center gap-1 transition-colors ${
                    isActive
                      ? 'text-[#0F7B49] font-bold'
                      : 'text-[#6B7280] hover:text-[#111827] font-medium'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  <span className="text-[11px] leading-none">{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Desktop Companion Panel (Visible on lg+ viewports so desktop never looks like an empty void) */}
        <aside className="hidden lg:flex lg:col-span-5 xl:col-span-6 flex-col gap-5">
          {/* Desktop Live Overview Card */}
          <div className="bg-white rounded-3xl border border-[#E5E7EB] p-6 space-y-4 shadow-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <img
                  src="/assets/aistudio/file_00000000ec948211aa20fd47696280f7_7fc20087.png"
                  alt="CM Inventory Management"
                  referrerPolicy="no-referrer"
                  className="w-12 h-12 rounded-2xl object-contain border border-[#E5E7EB] bg-white p-0.5 shrink-0"
                />
                <div>
                  <h2 className="font-display font-bold text-base text-[#111827]">
                    CM Inventory Management · Live Sync
                  </h2>
                  <p className="text-xs text-[#6B7280]">
                    Cloud Sync Active · Shop Account: {activeShop.shopName}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowKycRegister(true)}
                className="h-9 px-3.5 rounded-xl bg-[#E8F5EE] text-[#0F7B49] text-xs font-semibold"
              >
                Open KYC Register &rarr;
              </button>
            </div>

            {/* Recent Stock Quick Table */}
            <div className="space-y-2">
              <div className="text-xs font-bold text-[#4B5563] flex items-center justify-between">
                <span>LATEST STOCK IN CLOUD ({dashboardMetrics.totalActiveStock} PHONES)</span>
                <span className="text-[#0F7B49]">100% KYC Verified</span>
              </div>
              <div className="divide-y divide-[#F3F4F6] border border-[#E5E7EB] rounded-2xl overflow-hidden">
                {inventory
                  .filter((p) => p.status !== 'Sold')
                  .slice(0, 5)
                  .map((p) => (
                    <div
                      key={p.id}
                      className="px-3.5 py-2.5 flex items-center justify-between text-xs bg-white"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Smartphone className="w-4 h-4 text-[#0F7B49] shrink-0" />
                        <div className="truncate">
                          <span className="font-bold text-[#111827]">
                            {p.brand} {p.model}
                          </span>{' '}
                          <span className="text-[#6B7280]">
                            ({p.ram}/{p.storage}) · Grade {p.grade}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="font-bold text-[#111827] tabular-nums">
                          ₹{p.buyingPrice.toLocaleString('en-IN')}
                        </span>
                        <span
                          className={`font-semibold ${
                            p.status === 'Ready'
                              ? 'text-[#0F7B49]'
                              : 'text-[#D97706]'
                          }`}
                        >
                          {p.status}
                        </span>
                      </div>
                    </div>
                  ))}
              </div>
            </div>

            {/* Quick Action Shortcuts */}
            <div className="grid grid-cols-2 gap-3 pt-1">
              <button
                type="button"
                onClick={() => setBuyWizardMode('Customer')}
                className="h-11 rounded-xl bg-[#0F7B49] text-white text-xs font-semibold flex items-center justify-center gap-2"
              >
                <Camera className="w-4 h-4" />
                Launch 8-Step Buy Wizard
              </button>
              <button
                type="button"
                onClick={() => setShowKycRegister(true)}
                className="h-11 rounded-xl border border-[#D1D5DB] text-[#111827] text-xs font-semibold flex items-center justify-center gap-2 hover:bg-[#F9FAFB]"
              >
                <ShieldCheck className="w-4 h-4 text-[#0F7B49]" />
                View &amp; Download KYC PDF
              </button>
            </div>
          </div>

          {/* Reference Walkthrough Video Player on Desktop */}
          <div className="bg-white rounded-3xl border border-[#E5E7EB] p-5 space-y-3 shadow-xs">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-display font-bold text-sm text-[#111827]">
                  Reference App Walkthrough Video
                </h3>
                <p className="text-xs text-[#6B7280]">
                  Compare side-by-side with the interactive app on the left
                </p>
              </div>
            </div>
            <video
              src="/assets/aistudio/VID-20261113-WA0000_1__19c28332.mp4"
              controls
              className="w-full max-h-[340px] rounded-2xl bg-[#111827] object-contain"
            />
          </div>
        </aside>
      </div>

      {/* ====================================================================
          FULL-SCREEN FLOW OVERLAYS & MODALS
      ==================================================================== */}
      {buyWizardMode && (
        <BuyPhoneWizard
          userId={currentUser.uid}
          shopProfile={activeShop}
          existingInventory={inventory}
          initialSourceType={buyWizardMode}
          onClose={() => setBuyWizardMode(null)}
          onComplete={() => {
            // Phone & KYC record are automatically synced via Firestore onSnapshot
          }}
        />
      )}

      {sellModalPhone && (
        <SellPhoneModal
          userId={currentUser.uid}
          shopProfile={activeShop}
          inventory={inventory}
          preselectedPhone={sellModalPhone === 'open' ? null : sellModalPhone}
          onClose={() => setSellModalPhone(null)}
        />
      )}

      {showKycRegister && (
        <KycRegisterView
          shopProfile={activeShop}
          kycRecords={kycRecords}
          inventory={inventory}
          onBack={() => setShowKycRegister(false)}
        />
      )}

      {showDuesModal && (
        <DuesModal
          userId={currentUser.uid}
          dues={dues}
          onClose={() => setShowDuesModal(false)}
        />
      )}

      {showShareStockModal && (
        <ShareStockModal
          shopProfile={activeShop}
          inventory={inventory}
          onClose={() => setShowShareStockModal(false)}
        />
      )}

      {showProPlanModal && (
        <ProPlanModal
          userId={currentUser.uid}
          shopProfile={activeShop}
          onClose={() => setShowProPlanModal(false)}
        />
      )}

      {showNotificationsModal && (
        <NotificationsModal
          inventory={inventory}
          dues={dues}
          onClose={() => setShowNotificationsModal(false)}
          onNavigateStockRepair={() => {
            setStockInitialFilter('Under repair');
            setActiveTab('Stock');
          }}
          onOpenDues={() => setShowDuesModal(true)}
        />
      )}

      {showScannerSearch && (
        <ImeiScannerModal
          onScanSuccess={(scannedImei) => {
            setShowScannerSearch(false);
            const found = inventory.find((p) => p.imei === scannedImei);
            if (found) {
              setSellModalPhone(found);
            } else {
              setBuyWizardMode('Customer');
            }
          }}
          onClose={() => setShowScannerSearch(false)}
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}
