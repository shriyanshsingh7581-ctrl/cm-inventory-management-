import React, { useState } from 'react';
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
} from 'firebase/auth';
import { auth } from '../firebase';
import { Eye, EyeOff, Lock, Mail, ShieldCheck, Store, User } from 'lucide-react';

interface AuthScreenProps {
  onSuccess?: () => void;
  onPendingShopDetails?: (shopName: string, ownerName: string) => void;
}

function formatAuthError(err: unknown): string {
  const code = (err as { code?: string })?.code || '';
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Invalid email or password. Please check your credentials or create a new shop account.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/weak-password':
      return 'Password must be at least 6 characters long.';
    case 'auth/email-already-in-use':
      return 'An account with this email already exists. Please sign in instead.';
    case 'auth/operation-not-allowed':
      return 'Email/Password sign-in is currently unavailable. Please use "Continue with Google" below.';
    case 'auth/popup-closed-by-user':
      return 'Google sign-in was cancelled. Please try again.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a moment and try again.';
    default: {
      const raw = err instanceof Error ? err.message : String(err);
      const cleaned = raw
        .replace(/Firebase:\s*/gi, '')
        .replace(/\(auth\/[^)]+\)\.?/gi, '')
        .trim();
      return cleaned || 'Unable to sign in right now. Please try again.';
    }
  }
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ onPendingShopDetails }) => {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [shopName, setShopName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setLoading(true);

    try {
      if (onPendingShopDetails) {
        onPendingShopDetails(
          shopName.trim() || 'My Mobile Shop',
          ownerName.trim() || 'Shop Owner'
        );
      }

      if (mode === 'signup') {
        await createUserWithEmailAndPassword(auth, email.trim(), password);
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/email-already-in-use') {
        setMode('login');
      }
      setErrorMsg(formatAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setErrorMsg(null);
    setLoading(true);
    try {
      if (onPendingShopDetails) {
        onPendingShopDetails(
          shopName.trim() || 'My Mobile Shop',
          ownerName.trim() || 'Shop Owner'
        );
      }
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err: unknown) {
      setErrorMsg(formatAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh w-full bg-gradient-to-b from-[#0E5E36] via-[#0B4D2C] to-[#07351E] flex flex-col justify-between p-4 sm:p-6 overflow-y-auto touch-pan-y">
      {/* Top Brand Header */}
      <div className="pt-4 pb-4 text-center max-w-md mx-auto w-full shrink-0">
        <div className="w-24 h-24 rounded-3xl bg-white p-1 flex items-center justify-center mx-auto shadow-xl border border-white/25 mb-4 overflow-hidden">
          <img
            src="/assets/aistudio/file_00000000ec948211aa20fd47696280f7_7fc20087.png"
            alt="CM Inventory Management Logo"
            referrerPolicy="no-referrer"
            className="w-full h-full object-contain rounded-2xl"
          />
        </div>
        <h1 className="font-display font-bold text-2xl sm:text-3xl text-white tracking-tight">
          CM Inventory Management
        </h1>
        <p className="text-sm text-[#A7F3D0] mt-1.5">
          Purana phone kharido — KYC · Bill · Stock · Profit ke saath
        </p>
      </div>

      {/* Auth Card */}
      <div className="w-full max-w-md mx-auto bg-white rounded-3xl p-5 sm:p-6 shadow-xl border border-white/20 shrink-0 my-2">
        {/* Mode Switcher */}
        <div className="grid grid-cols-2 gap-1 p-1 bg-[#F3F4F6] rounded-xl mb-5">
          <button
            type="button"
            onClick={() => {
              setMode('login');
              setErrorMsg(null);
            }}
            className={`h-10 rounded-lg text-sm font-semibold transition-colors whitespace-nowrap ${
              mode === 'login'
                ? 'bg-white text-[#111827] shadow-xs'
                : 'text-[#6B7280] hover:text-[#111827]'
            }`}
          >
            Shop Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('signup');
              setErrorMsg(null);
            }}
            className={`h-10 rounded-lg text-sm font-semibold transition-colors whitespace-nowrap ${
              mode === 'signup'
                ? 'bg-white text-[#111827] shadow-xs'
                : 'text-[#6B7280] hover:text-[#111827]'
            }`}
          >
            New Shop Account
          </button>
        </div>

        <form onSubmit={handleEmailAuth} className="space-y-3.5">
          {mode === 'signup' && (
            <>
              <div>
                <label className="block text-xs font-semibold text-[#374151] mb-1">
                  Shop Name *
                </label>
                <div className="relative">
                  <Store className="w-4 h-4 text-[#6B7280] absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    required
                    value={shopName}
                    onChange={(e) => setShopName(e.target.value)}
                    placeholder="Enter your shop name"
                    className="w-full h-11 pl-10 pr-3.5 rounded-xl border border-[#D1D5DB] text-sm text-[#111827] focus:outline-none focus:border-[#0F7B49]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#374151] mb-1">
                  Owner Full Name *
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-[#6B7280] absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    required
                    value={ownerName}
                    onChange={(e) => setOwnerName(e.target.value)}
                    placeholder="Enter owner full name"
                    className="w-full h-11 pl-10 pr-3.5 rounded-xl border border-[#D1D5DB] text-sm text-[#111827] focus:outline-none focus:border-[#0F7B49]"
                  />
                </div>
              </div>
            </>
          )}

          <div>
            <label className="block text-xs font-semibold text-[#374151] mb-1">
              Email Address *
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-[#6B7280] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email address"
                className="w-full h-11 pl-10 pr-3.5 rounded-xl border border-[#D1D5DB] text-sm text-[#111827] focus:outline-none focus:border-[#0F7B49]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#374151] mb-1">
              Password *
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-[#6B7280] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type={showPassword ? 'text' : 'password'}
                required
                minLength={6}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                className="w-full h-11 pl-10 pr-11 rounded-xl border border-[#D1D5DB] text-sm text-[#111827] focus:outline-none focus:border-[#0F7B49]"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6B7280] hover:text-[#111827] p-1"
              >
                {showPassword ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          {errorMsg && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
              <p className="font-medium">{errorMsg}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full h-12 rounded-xl bg-[#0F7B49] hover:bg-[#0C633A] text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-sm active:scale-[0.99] transition-all disabled:opacity-60"
          >
            {loading
              ? 'Signing In...'
              : mode === 'login'
              ? 'Sign In'
              : 'Create Shop Account'}
          </button>
        </form>

        <div className="relative my-4">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-[#E5E7EB]" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-white px-3 text-[#6B7280]">OR INSTANT SIGN IN</span>
          </div>
        </div>

        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={loading}
          className="w-full h-12 rounded-xl bg-white border border-[#D1D5DB] hover:bg-[#F9FAFB] text-[#111827] font-semibold text-sm flex items-center justify-center gap-2.5 active:scale-[0.99] transition-all"
        >
          <ShieldCheck className="w-4 h-4 text-[#0F7B49]" />
          Continue with Google
        </button>

        <div className="mt-4 pt-3 border-t border-[#F3F4F6] text-center text-xs text-[#6B7280]">
          100% Secure Shop Cloud Account · Private &amp; Encrypted
        </div>
      </div>

      {/* Footer note */}
      <div className="text-center py-3 text-xs text-[#A7F3D0]/80 shrink-0">
        Aapki dukan ka poora record aapke phone mein · 100% Legal KYC
      </div>
    </div>
  );
};
