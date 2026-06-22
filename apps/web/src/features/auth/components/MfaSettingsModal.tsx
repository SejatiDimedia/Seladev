import React, { useState } from 'react';
import { useAuthStore } from '../../../stores/auth.store';
import { apiClient } from '../../../lib/api-client';
import { Shield, ShieldAlert, ShieldCheck, Copy, Check, Loader2, ArrowRight } from 'lucide-react';

interface MfaSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function MfaSettingsModal({ isOpen, onClose }: MfaSettingsModalProps) {
  const user = useAuthStore((state) => state.user);
  const updateUser = useAuthStore((state) => state.updateUser);

  const [step, setStep] = useState<'idle' | 'setup' | 'recovery' | 'disable'>('idle');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Setup fields
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleStartSetup = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.post('/auth/mfa/setup');
      const data = response.data.data;
      setQrCodeUrl(data.qrCodeUrl);
      setSecret(data.secret);
      setStep('setup');
    } catch (err: any) {
      setError(err.message || 'Failed to start MFA setup.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifySetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.post('/auth/mfa/activate', { token: code });
      const data = response.data.data;
      setRecoveryCodes(data.recoveryCodes);
      updateUser({ mfaEnabled: true });
      setStep('recovery');
    } catch (err: any) {
      setError(err.message || 'MFA Activation failed. Please check the code.');
    } finally {
      setLoading(false);
    }
  };

  const handleDisableMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await apiClient.post('/auth/mfa/disable', { token: code });
      updateUser({ mfaEnabled: false });
      setStep('idle');
      setCode('');
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to disable MFA. Verify the code.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyRecovery = () => {
    navigator.clipboard.writeText(recoveryCodes.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999]"></div>
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-[#09090b] border border-white/10 p-6 rounded-3xl z-[10000] shadow-xl space-y-6">
        
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-500/10 rounded-xl text-indigo-400">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-extrabold text-lg text-white">Multi-Factor Authentication</h3>
            <p className="text-xs text-neutral-400">Add an extra layer of security to your account.</p>
          </div>
        </div>

        {error && (
          <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400 font-medium">
            {error}
          </div>
        )}

        {/* Step: IDLE (MFA Status Display) */}
        {step === 'idle' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between p-4 bg-white/[0.02] border border-white/5 rounded-2xl">
              <div className="flex items-center gap-3">
                {user?.mfaEnabled ? (
                  <ShieldCheck className="w-8 h-8 text-emerald-400" />
                ) : (
                  <ShieldAlert className="w-8 h-8 text-amber-400" />
                )}
                <div>
                  <h4 className="font-bold text-sm text-white">
                    Status: {user?.mfaEnabled ? 'Enabled' : 'Disabled'}
                  </h4>
                  <p className="text-xs text-neutral-400 leading-normal">
                    {user?.mfaEnabled
                      ? 'Your account is secured with 2FA.'
                      : 'We highly recommend enabling 2FA.'}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 text-xs font-semibold">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 hover:bg-white/5 rounded-xl text-neutral-400 hover:text-white transition-colors"
              >
                Close
              </button>
              {user?.mfaEnabled ? (
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setStep('disable');
                  }}
                  className="px-4 py-2.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 rounded-xl transition-colors"
                >
                  Disable MFA
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleStartSetup}
                  disabled={loading}
                  className="px-4 py-2.5 bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl transition-colors flex items-center gap-1.5"
                >
                  {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Set Up MFA'}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Step: SETUP (Enrollment Form) */}
        {step === 'setup' && (
          <form onSubmit={handleVerifySetup} className="space-y-6">
            <div className="space-y-4 text-center">
              <p className="text-xs text-neutral-400 leading-relaxed text-left">
                1. Scan this QR code in your authenticator app (e.g. Google Authenticator, 1Password).
              </p>
              
              {qrCodeUrl && (
                <div className="p-3 bg-white rounded-2xl w-fit mx-auto shadow-md">
                  <img src={qrCodeUrl} alt="MFA QR Code" className="w-40 h-40" />
                </div>
              )}

              <p className="text-[10px] text-neutral-500 font-mono select-all">
                Or enter key manually: {secret}
              </p>

              <div className="space-y-1.5 text-left pt-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                  2. Enter Verification Code
                </label>
                <input
                  type="text"
                  required
                  pattern="[0-9]*"
                  inputMode="numeric"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="000000"
                  className="w-full px-4 py-3 bg-neutral-900 border border-white/10 rounded-xl text-sm font-bold text-center tracking-[0.3em] focus:outline-none focus:border-indigo-500 transition-colors"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setStep('idle')}
                className="px-4 py-2.5 hover:bg-white/5 rounded-xl text-neutral-400 hover:text-white transition-colors"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={loading || code.length !== 6}
                className="px-4 py-2.5 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white rounded-xl transition-colors flex items-center gap-1.5"
              >
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Activate'}
              </button>
            </div>
          </form>
        )}

        {/* Step: RECOVERY CODES DISPLAY */}
        {step === 'recovery' && (
          <div className="space-y-6">
            <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl text-xs text-emerald-400 font-medium">
              MFA has been successfully activated!
            </div>

            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <h4 className="font-bold text-xs uppercase text-neutral-400">Backup Recovery Codes</h4>
                <button
                  onClick={handleCopyRecovery}
                  className="text-xs text-indigo-400 hover:text-indigo-300 font-medium flex items-center gap-1 transition-colors"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Copied!' : 'Copy all'}
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 bg-neutral-950 p-4 rounded-2xl border border-white/5 font-mono text-xs text-center text-white select-all">
                {recoveryCodes.map((code, index) => (
                  <div key={index} className="py-1">
                    {code}
                  </div>
                ))}
              </div>

              <p className="text-[10px] text-amber-400 leading-normal">
                ⚠️ Store these codes securely. They are the only way to recover your account if you lose access to your authenticator app.
              </p>
            </div>

            <button
              onClick={() => {
                setStep('idle');
                onClose();
              }}
              className="w-full py-3 bg-white/5 hover:bg-white/10 border border-white/5 text-white font-bold rounded-xl text-sm transition-all flex items-center justify-center gap-1.5"
            >
              Done
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Step: DISABLE (Verification Prompt) */}
        {step === 'disable' && (
          <form onSubmit={handleDisableMfa} className="space-y-6">
            <p className="text-xs text-neutral-400 leading-relaxed">
              Confirm your identity by entering the 6-digit code from your authenticator app.
            </p>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                Verification Code
              </label>
              <input
                type="text"
                required
                pattern="[0-9]*"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                className="w-full px-4 py-3 bg-neutral-900 border border-white/10 rounded-xl text-sm font-bold text-center tracking-[0.3em] focus:outline-none focus:border-indigo-500 transition-colors"
              />
            </div>

            <div className="flex justify-end gap-3 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setStep('idle')}
                className="px-4 py-2.5 hover:bg-white/5 rounded-xl text-neutral-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || code.length !== 6}
                className="px-4 py-2.5 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white rounded-xl transition-colors flex items-center gap-1.5"
              >
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Confirm Disable'}
              </button>
            </div>
          </form>
        )}
      </div>
    </>
  );
}
