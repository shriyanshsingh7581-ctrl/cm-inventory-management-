import React, { useState } from 'react';
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
} from 'firebase/auth';
import { auth } from '../firebase';
import { ExternalLink, HelpCircle, Lock, Mail, ShieldCheck, Store, User } from 'lucide-react';

interface AuthScreenProps {
  onSuccess?: () => void;
  onPendingShopDetails?: (shopName: string, ownerName: string) => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ onPendingShopDetails }) => {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('sharma.mobile@example.com');
  const [password, setPassword] = useState('MobileOne@123');
  const [shopName, setShopName] = useState('Sharma Mobile Point');
  const [ownerName, setOwnerName] = useState('Rajesh Sharma');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showProviderGuide, setShowProviderGuide] = useState(false);

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setLoading(true);

    try {
      if (onPendingShopDetails) {
        onPendingShopDetails(
          shopName.trim() || 'Sharma Mobile Point',
          ownerName.trim() || 'Shop Owner'
        );
      }

      if (mode === 'signup') {
        await createUserWithEmailAndPassword(auth, email.trim(), password);
      } else {
        try {
          await signInWithEmailAndPassword(auth, email.trim(), password);
        } catch (loginErr: unknown) {
          const code = (loginErr as { code?: string })?.code || '';
          // If the demo account hasn't been created yet, create it seamlessly
          if (
            code === 'auth/user-not-found' ||
            code === 'auth/invalid-credential'
          ) {
            await createUserWithEmailAndPassword(auth, email.trim(), password);
          } else {
            throw loginErr;
          }
        }
      }
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      const message = err instanceof Error ? err.message : String(err);
      if (code === 'auth/operation-not-allowed') {
        setShowProviderGuide(true);
        setErrorMsg(
          'Email/Password sign-in needs to be toggled ON in your Firebase Console, or tap "Sign in with Google" below for instant access.'
        );
      } else if (code === 'auth/email-already-in-use') {
        setMode('login');
        setErrorMsg('Account already exists. Switched to Sign In — tap Continue.');
      } else {
        setErrorMsg(message.replace('Firebase: ', ''));
      }
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
          shopName.trim() || 'Sharma Mobile Point',
          ownerName.trim() || 'Shop Owner'
        );
      }
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setErrorMsg(message.replace('Firebase: ', ''));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0E5E36] via-[#0B4D2C] to-[#07351E] flex flex-col justify-between p-4 sm:p-6">
      {/* Top Brand Header */}
      <div className="pt-6 pb-4 text-center max-w-md mx-auto w-full">
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
      <div className="w-full max-w-md mx-auto bg-white rounded-3xl p-5 sm:p-6 shadow-xl border border-white/20">
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
          <div>
            <label className="block text-xs font-semibold text-[#374151] mb-1">
              Shop Name
            </label>
            <div className="relative">
              <Store className="w-4 h-4 text-[#6B7280] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                required
                value={shopName}
                onChange={(e) => setShopName(e.target.value)}
                placeholder="e.g. Sharma Mobile Point"
                className="w-full h-11 pl-10 pr-3.5 rounded-xl border border-[#D1D5DB] text-sm text-[#111827] focus:outline-none focus:border-[#0F7B49]"
              />
            </div>
          </div>

          {mode === 'signup' && (
            <div>
              <label className="block text-xs font-semibold text-[#374151] mb-1">
                Owner Full Name
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-[#6B7280] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                  placeholder="e.g. Rajesh Sharma"
                  className="w-full h-11 pl-10 pr-3.5 rounded-xl border border-[#D1D5DB] text-sm text-[#111827] focus:outline-none focus:border-[#0F7B49]"
                />
              </div>
            </div>
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
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="shop@example.com"
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
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 6 characters"
                className="w-full h-11 pl-10 pr-3.5 rounded-xl border border-[#D1D5DB] text-sm text-[#111827] focus:outline-none focus:border-[#0F7B49]"
              />
            </div>
          </div>

          {errorMsg && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-2">
              <p className="font-medium">{errorMsg}</p>
              <button
                type="button"
                onClick={() => setShowProviderGuide(true)}
                className="inline-flex items-center gap-1 text-[#0F7B49] font-semibold underline"
              >
                <HelpCircle className="w-3.5 h-3.5" />
                How to enable Email/Password in Firebase Console
              </button>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full h-12 rounded-xl bg-[#0F7B49] hover:bg-[#0C633A] text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-sm active:scale-[0.99] transition-all disabled:opacity-60"
          >
            {loading
              ? 'Connecting to Shop Database...'
              : mode === 'login'
              ? 'Sign In with Email & Password'
              : 'Create Shop Account'}
          </button>
        </form>

        <div className="relative my-4">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-[#E5E7EB]" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-white px-3 text-[#6B7280]">OR INSTANT CLOUD LOGIN</span>
          </div>
        </div>

        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={loading}
          className="w-full h-12 rounded-xl bg-white border border-[#D1D5DB] hover:bg-[#F9FAFB] text-[#111827] font-semibold text-sm flex items-center justify-center gap-2.5 active:scale-[0.99] transition-all"
        >
          <ShieldCheck className="w-4 h-4 text-[#0F7B49]" />
          Continue with Google (Instant Verified Auth)
        </button>

        <div className="mt-4 pt-3 border-t border-[#F3F4F6] flex items-center justify-between text-xs text-[#6B7280]">
          <span>Multi-tenant isolated `/users/&#123;uid&#125;`</span>
          <button
            type="button"
            onClick={() => setShowProviderGuide(true)}
            className="text-[#0F7B49] font-semibold hover:underline"
          >
            Firebase Setup Guide
          </button>
        </div>
      </div>

      {/* Footer note */}
      <div className="text-center py-3 text-xs text-[#A7F3D0]/80">
        Aapki dukan ka poora record aapke phone mein · 100% Legal KYC
      </div>

      {/* Firebase Email/Password Walkthrough Modal */}
      {showProviderGuide && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="font-display font-bold text-base text-[#111827]">
                Enable Email/Password in Firebase Console
              </h3>
              <button
                type="button"
                onClick={() => setShowProviderGuide(false)}
                className="text-xs font-semibold text-[#6B7280] px-2 py-1"
              >
                Close
              </button>
            </div>
            <p className="text-xs text-[#4B5563] leading-relaxed">
              Firebase provisioning enables <strong>Google Sign-In</strong> automatically. To also use{' '}
              <strong>Email/Password</strong> authentication, enable it in 3 quick clicks:
            </p>
            <ol className="text-xs text-[#111827] space-y-2 list-decimal list-inside bg-[#F6F7F8] p-3.5 rounded-xl border border-[#E5E7EB]">
              <li>
                Open your project{' '}
                <span className="font-mono font-semibold">gen-lang-client-0109570919</span> in Firebase Console.
              </li>
              <li>
                Go to <strong>Authentication</strong> &rarr; <strong>Sign-in method</strong> tab.
              </li>
              <li>
                Click <strong>Add new provider</strong> &rarr; Select <strong>Email/Password</strong> &rarr; Toggle{' '}
                <strong>Enable</strong> and click <strong>Save</strong>.
              </li>
            </ol>
            <div className="flex flex-col gap-2">
              <a
                href="https://console.firebase.google.com/project/gen-lang-client-0109570919/authentication/providers"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full h-11 rounded-xl bg-[#111827] text-white text-xs font-semibold flex items-center justify-center gap-2"
              >
                Open Firebase Auth Console
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
              <button
                type="button"
                onClick={() => {
                  setShowProviderGuide(false);
                  handleGoogleSignIn();
                }}
                className="w-full h-11 rounded-xl bg-[#0F7B49] text-white text-xs font-semibold flex items-center justify-center gap-2"
              >
                Sign In with Google Right Now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
