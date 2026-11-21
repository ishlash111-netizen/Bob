import React, { useState, useEffect, useRef } from 'react';
import { Mail, Lock, User, Calendar, ArrowRight, ShieldCheck, X, CheckCircle2, AlertCircle, ExternalLink, Copy, Check } from 'lucide-react';
import { UserProfile } from '../types';

interface AuthModalProps {
  isOpen: boolean;
  onSuccess: (user: UserProfile, token?: string) => void;
  onClose?: () => void;
}

// Google Client ID provided in client_secret JSON with verified origins
const GOOGLE_CLIENT_ID = "973689737727-8b5slrifj74htotd92e2ai0ab02nhuld.apps.googleusercontent.com";

declare global {
  interface Window {
    google?: any;
  }
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onSuccess, onClose }) => {
  const [isRegister, setIsRegister] = useState(false); // Default to login/google
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [birthYear, setBirthYear] = useState('2000');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [gisLoaded, setGisLoaded] = useState(false);
  const [showOriginHelper, setShowOriginHelper] = useState(false);
  const [copiedOrigin, setCopiedOrigin] = useState(false);

  const googleBtnRef = useRef<HTMLDivElement>(null);

  // Generate list of years (1950 to 2018)
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: currentYear - 1950 + 1 }, (_, i) => currentYear - i);

  // Safely parse Google JWT credential payload
  const parseJwt = (token: string): any => {
    try {
      const base64Url = token.split('.')[1];
      if (!base64Url) return null;
      let base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      while (base64.length % 4) {
        base64 += '=';
      }
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split('')
          .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );
      return JSON.parse(jsonPayload);
    } catch (e) {
      console.warn("JWT parse error:", e);
      return null;
    }
  };

  // Handle Google GIS response (credential JWT verified on server)
  const handleGoogleCredentialResponse = async (response: any) => {
    try {
      setIsSubmitting(true);
      setError('');
      const credential = response.credential;

      const res = await fetch('/api/auth/google', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({ credential }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Google orqali kirishda xatolik yuz berdi");
      }

      onSuccess(data.user, data.token);
    } catch (err: any) {
      console.error("Google Auth error:", err);
      setError(err.message || "Google orqali ulanishda xatolik yuz berdi.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Check if FedCM is supported and permitted in the current document context
  const isFedCmAllowed = () => {
    try {
      if (typeof window !== 'undefined' && window.self !== window.top) {
        if (typeof document !== 'undefined' && (document as any).permissionsPolicy?.allowsFeature) {
          return (document as any).permissionsPolicy.allowsFeature('identity-credentials-get') === true;
        }
        return false;
      }
    } catch {
      return false;
    }
    return true;
  };

  // Initialize Google Identity Services (GIS) safely
  useEffect(() => {
    if (!isOpen) return;

    let checkInterval: any = null;

    const initGIS = () => {
      // In iframes lacking identity-credentials-get, avoid calling id.initialize/renderButton
      // which triggers FedCM checks, and rely on google.accounts.oauth2 popup client instead.
      if (window.google?.accounts?.id && isFedCmAllowed()) {
        try {
          window.google.accounts.id.initialize({
            client_id: GOOGLE_CLIENT_ID,
            callback: handleGoogleCredentialResponse,
            auto_select: false,
            cancel_on_tap_outside: true,
            use_fedcm_for_prompt: false,
          });

          if (googleBtnRef.current) {
            googleBtnRef.current.innerHTML = '';
            window.google.accounts.id.renderButton(googleBtnRef.current, {
              theme: 'outline',
              size: 'large',
              width: 360,
              text: 'continue_with',
              shape: 'pill',
              logo_alignment: 'left',
            });
          }
          setGisLoaded(true);
        } catch (e) {
          console.debug("Google GIS init notice:", e);
        }
      } else if (window.google?.accounts?.oauth2) {
        setGisLoaded(true);
      }
    };

    if (window.google?.accounts) {
      initGIS();
    } else {
      checkInterval = setInterval(() => {
        if (window.google?.accounts) {
          initGIS();
          clearInterval(checkInterval);
        }
      }, 300);
    }

    return () => {
      if (checkInterval) clearInterval(checkInterval);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  // Direct Google button click trigger using OAuth2 popup client (reliable in all iframe environments)
  const handleGoogleBtnClick = () => {
    setError('');

    // Primary: Google OAuth2 popup token client (no FedCM permission restrictions)
    if (window.google?.accounts?.oauth2) {
      try {
        setIsSubmitting(true);
        const tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: 'email profile openid',
          callback: async (tokenResponse: any) => {
            if (tokenResponse?.error) {
              console.warn("Google OAuth2 token notice:", tokenResponse.error);
              setIsSubmitting(false);
              if (tokenResponse.error === 'popup_closed_by_user') {
                return;
              }
              setShowOriginHelper(true);
              return;
            }

            if (tokenResponse?.access_token) {
              try {
                const res = await fetch('/api/auth/google', {
                  method: 'POST',
                  credentials: 'include',
                  headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest',
                  },
                  body: JSON.stringify({
                    accessToken: tokenResponse.access_token,
                  }),
                });

                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "Google orqali kirishda xatolik yuz berdi");

                onSuccess(data.user, data.token);
              } catch (err: any) {
                console.error("Google profile sync error:", err);
                setError(err.message || "Google hisobini ulab bo'lmadi");
              } finally {
                setIsSubmitting(false);
              }
            } else {
              setIsSubmitting(false);
            }
          },
        });

        tokenClient.requestAccessToken({ prompt: 'select_account' });
        return;
      } catch (e) {
        console.warn("OAuth2 token client execution error:", e);
        setIsSubmitting(false);
        setShowOriginHelper(true);
        return;
      }
    }

    // Secondary fallback: if top-level and FedCM allowed
    if (isFedCmAllowed() && window.google?.accounts?.id) {
      try {
        window.google.accounts.id.prompt((notification: any) => {
          if (notification.isNotDisplayed()) {
            setShowOriginHelper(true);
          }
        });
        return;
      } catch {
        setShowOriginHelper(true);
      }
    }

    setShowOriginHelper(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email.trim() || !password.trim()) {
      setError("Email va parolni kiriting.");
      return;
    }

    if (isRegister) {
      if (!firstName.trim() || !lastName.trim()) {
        setError("Iltimos, ism va familiyangizni to'liq kiriting.");
        return;
      }
      if (!birthYear) {
        setError("Tug'ilgan yilingizni tanlang.");
        return;
      }
      if (password.length < 6) {
        setError("Parol kamida 6 ta belgidan iborat bo'lishi kerak.");
        return;
      }
      if (password !== confirmPassword) {
        setError("Kiritilgan parollar bir-biriga mos kelmadi. Qaytadan tekshiring.");
        return;
      }

      setIsSubmitting(true);
      try {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: JSON.stringify({
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            email: email.trim().toLowerCase(),
            birthYear,
            password,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Ro'yxatdan o'tishda xatolik yuz berdi");
        }

        onSuccess(data.user, data.token);
      } catch (err: any) {
        setError(err.message || "Ro'yxatdan o'tishda xatolik yuz berdi.");
      } finally {
        setIsSubmitting(false);
      }
    } else {
      // Login mode
      setIsSubmitting(true);
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: JSON.stringify({
            email: email.trim().toLowerCase(),
            password,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "Kirishda xatolik yuz berdi");
          return;
        }

        onSuccess(data.user, data.token);
      } catch (err: any) {
        setError(err.message || "Tizimga kirishda xatolik yuz berdi.");
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  const copyOriginToClipboard = () => {
    try {
      navigator.clipboard.writeText(window.location.origin);
      setCopiedOrigin(true);
      setTimeout(() => setCopiedOrigin(false), 2500);
    } catch {}
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md overflow-y-auto">
      <div className="relative w-full max-w-md my-auto bg-white text-slate-900 rounded-3xl shadow-2xl border border-slate-100 overflow-hidden animate-in fade-in zoom-in duration-200">
        
        {/* Top Header Banner */}
        <div className="bg-gradient-to-tr from-blue-600 via-indigo-600 to-cyan-500 p-6 text-white text-center relative">
          {onClose && (
            <button
              onClick={onClose}
              className="absolute top-4 right-4 p-1.5 rounded-full bg-white/20 hover:bg-white/30 text-white transition-colors"
              title="Yopish (Mehmon sifatida davom etish)"
            >
              <X className="w-4 h-4" />
            </button>
          )}

          <div className="w-14 h-14 mx-auto rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center shadow-lg border border-white/30 mb-3">
            <span className="text-3xl font-extrabold text-white">U</span>
          </div>
          <h2 className="text-2xl font-black tracking-tight">UZUNITED AI</h2>
          <p className="text-xs text-blue-100 mt-1 font-medium">
            O'zbek tilidagi universal sun'iy intellekt platformasi
          </p>
          <div className="mt-2 text-[11px] bg-white/15 px-3 py-1 rounded-full inline-block backdrop-blur-sm border border-white/20 font-medium">
            Yaratuvchilar: Afzalbek Nematov & Ozodbek Shohobiddinov
          </div>
        </div>

        <div className="p-6">
          {/* GOOGLE SIGN IN - PRIMARY ACTION */}
          <div className="mb-5 space-y-2.5">
            <div className="text-center mb-1">
              <span className="text-xs font-bold text-slate-700 tracking-tight">
                Shaxsiy hisobingizga kirish uchun:
              </span>
            </div>

            {/* Google Identity Services native rendered button container (only when allowed by document policy) */}
            {isFedCmAllowed() && (
              <div 
                ref={googleBtnRef} 
                id="google-signin-btn-container" 
                className="w-full flex justify-center min-h-[44px]"
              />
            )}

            {/* Custom Google Sign-in button */}
            <button
              id="btn-custom-google-auth"
              type="button"
              onClick={handleGoogleBtnClick}
              disabled={isSubmitting}
              className="w-full py-2.5 px-4 bg-white hover:bg-slate-50 text-slate-800 font-semibold text-xs sm:text-sm rounded-full border border-slate-300 hover:border-slate-400 shadow-sm transition-all flex items-center justify-center gap-2.5 active:scale-[0.99]"
            >
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              <span>Google hisobi orqali kirish</span>
            </button>

            {/* Helpful alternative trigger */}
            <div className="text-center pt-1">
              <button
                type="button"
                onClick={() => setShowOriginHelper(prev => !prev)}
                className="text-[11px] text-blue-600 hover:text-blue-800 underline font-medium"
              >
                {showOriginHelper ? "Yordam oynasini yashirish" : "Google oynasida xatolik bo'lyaptimi? (Muqobil yo'l)"}
              </button>
            </div>

            {/* Helper toggle / origin notice */}
            {showOriginHelper && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl text-[11px] text-amber-900 space-y-2 animate-in fade-in">
                <div className="flex items-start gap-1.5 font-semibold">
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <span>Google Cloud ruxsatnomasi (Origin xatosi sababi):</span>
                </div>
                <p className="text-[10px] text-amber-800 leading-relaxed">
                  Google Cloud Console-da Authorized JavaScript Origins ro‘yxatiga joriy sayt manzili kiritilgan bo‘lishi kerak. Yoki pastdagi Email va parol orqali kirishdan foydalaning:
                </p>
                <div className="flex items-center gap-1.5 bg-white p-1.5 rounded-lg border border-amber-200">
                  <code className="text-[10px] text-slate-800 font-mono truncate flex-1">
                    {window.location.origin}
                  </code>
                  <button
                    type="button"
                    onClick={copyOriginToClipboard}
                    className="p-1 text-slate-600 hover:text-blue-600 rounded bg-slate-100 hover:bg-slate-200 shrink-0 flex items-center gap-1 text-[10px] font-bold"
                  >
                    {copiedOrigin ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedOrigin ? "Nusxalandi" : "Nusxalash"}</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="relative my-4">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200" />
            </div>
            <div className="relative flex justify-center text-[10px] uppercase font-bold tracking-wider">
              <span className="bg-white px-2 text-slate-400">Yoki Email orqali</span>
            </div>
          </div>

          {/* Tab switcher: Ro'yxatdan o'tish / Kirish */}
          <div className="flex bg-slate-100 p-1 rounded-xl mb-4">
            <button
              type="button"
              id="tab-login-mode"
              onClick={() => { setIsRegister(false); setError(''); }}
              className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${
                !isRegister
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Tizimga kirish
            </button>
            <button
              type="button"
              id="tab-register-mode"
              onClick={() => { setIsRegister(true); setError(''); }}
              className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${
                isRegister
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Ro'yxatdan o'tish
            </button>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex items-center gap-2">
              <span className="font-bold">⚠️</span>
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            {isRegister && (
              <>
                <div className="grid grid-cols-2 gap-2.5">
                  {/* Ism */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Ism <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <User className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                      <input
                        id="reg-first-name"
                        type="text"
                        required
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        placeholder="Ismingiz"
                        className="w-full pl-8 pr-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                      />
                    </div>
                  </div>

                  {/* Familiya */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Familiya <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="reg-last-name"
                      type="text"
                      required
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      placeholder="Familiyangiz"
                      className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                    />
                  </div>
                </div>

                {/* Tug'ilgan yil */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Tug'ilgan yilingiz <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <Calendar className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                    <select
                      id="reg-birth-year"
                      value={birthYear}
                      onChange={(e) => setBirthYear(e.target.value)}
                      className="w-full pl-8 pr-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                    >
                      {years.map((yr) => (
                        <option key={yr} value={yr}>
                          {yr}-yil
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </>
            )}

            {/* Email */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Email manzil <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <Mail className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                <input
                  id="auth-email-input"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="nom@gmail.com"
                  className="w-full pl-8 pr-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                />
              </div>
            </div>

            {/* Parol */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Parol <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <Lock className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                <input
                  id="auth-password-input"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Kamida 6 ta belgi"
                  className="w-full pl-8 pr-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                />
              </div>
            </div>

            {/* Parolni takrorlash (faqat ro'yxatdan o'tishda) */}
            {isRegister && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Parolni takrorlang <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <Lock className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    id="auth-confirm-password-input"
                    type="password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Parolni qayta kiriting"
                    className="w-full pl-8 pr-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                  />
                </div>
              </div>
            )}

            <button
              id="btn-auth-submit"
              type="submit"
              disabled={isSubmitting}
              className="w-full mt-3 py-2 px-4 bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold text-xs sm:text-sm rounded-xl shadow-md transition-all flex items-center justify-center gap-2"
            >
              <span>{isSubmitting ? "Yuklanmoqda..." : (isRegister ? "Ro'yxatdan o'tish" : "Tizimga kirish")}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </form>

          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
            <span className="flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
              <span>Shaxsiy ma'lumotlar xavfsiz</span>
            </span>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="text-slate-400 hover:text-slate-600 underline"
              >
                Mehmon rejimi
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
