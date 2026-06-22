import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../../../stores/auth.store';
import { useOrgStore } from '../../../stores/org.store';
import { apiClient } from '../../../lib/api-client';
import { Shield, Key, Loader2, ArrowRight, Eye, EyeOff } from 'lucide-react';

export function LoginPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((state) => state.setAuth);
  const setMfaRequired = useAuthStore((state) => state.setMfaRequired);
  const mfaToken = useAuthStore((state) => state.mfaToken);
  const requiresMfa = useAuthStore((state) => state.requiresMfa);
  const setActiveOrgId = useOrgStore((state) => state.setActiveOrgId);
  const setOrganizations = useOrgStore((state) => state.setOrganizations);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otpToken, setOtpToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const loadUserOrganizations = async () => {
    try {
      const response = await apiClient.get('/me/organizations');
      const orgs = response.data.data;
      setOrganizations(orgs);
      
      // Select first org if none selected or if active org is not in list
      if (orgs.length > 0) {
        const activeOrgId = useOrgStore.getState().activeOrgId;
        const exists = orgs.some((o: any) => o.id === activeOrgId);
        if (!exists) {
          setActiveOrgId(orgs[0].id);
        }
      } else {
        setActiveOrgId(null);
      }
    } catch (err) {
      console.error('Failed to load organizations', err);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await apiClient.post('/auth/login', { email, password });
      const { requiresMfa, mfaToken, accessToken, user } = response.data.data;

      if (requiresMfa) {
        setMfaRequired(mfaToken, user);
      } else {
        setAuth(accessToken, user);
        await loadUserOrganizations();
        navigate('/');
      }
    } catch (err: any) {
      setError(err.message || 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleMfaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await apiClient.post('/auth/login/mfa', {
        mfaToken,
        token: otpToken,
      });
      const { accessToken, user } = response.data.data;

      setAuth(accessToken, user);
      await loadUserOrganizations();
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'Verification code is invalid or has expired.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto space-y-8 glass-card p-8 rounded-3xl border border-white/10 relative overflow-hidden">
      {/* Decorative background glows */}
      <div className="absolute -top-10 -right-10 w-40 h-40 bg-indigo-500/10 rounded-full blur-2xl pointer-events-none"></div>
      <div className="absolute -bottom-10 -left-10 w-40 h-40 bg-purple-500/10 rounded-full blur-2xl pointer-events-none"></div>

      <div className="text-center space-y-2">
        <h2 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-white via-neutral-200 to-neutral-500 bg-clip-text text-transparent">
          {requiresMfa ? 'Security Verification' : 'Welcome Back'}
        </h2>
        <p className="text-sm text-neutral-400">
          {requiresMfa
            ? 'Enter the 6-digit verification code from your authenticator app.'
            : 'Access the SELADEV Control Plane.'}
        </p>
      </div>

      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400 font-medium">
          {error}
        </div>
      )}

      {!requiresMfa ? (
        <form onSubmit={handleLogin} className="space-y-6">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Email Address</label>
            <input
              type="email"
              name="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="w-full px-4 py-3 bg-neutral-900 border border-white/10 rounded-xl text-sm focus:outline-none focus:border-indigo-500 transition-colors placeholder:text-neutral-600"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <label className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Password</label>
            </div>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                name="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full pl-4 pr-11 py-3 bg-neutral-900 border border-white/10 rounded-xl text-sm focus:outline-none focus:border-indigo-500 transition-colors placeholder:text-neutral-600"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-white transition-colors"
              >
                {showPassword ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-3.5 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white font-bold rounded-xl text-sm transition-all shadow-lg shadow-indigo-500/20 disabled:opacity-50 disabled:cursor-not-allowed group"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                Sign In
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </>
            )}
          </button>
        </form>
      ) : (
        <form onSubmit={handleMfaSubmit} className="space-y-6">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-indigo-400" />
              <label className="text-xs font-semibold uppercase tracking-wider text-neutral-400">MFA Code</label>
            </div>
            <input
              type="text"
              name="code"
              autoComplete="one-time-code"
              required
              pattern="[0-9]*"
              inputMode="numeric"
              maxLength={6}
              value={otpToken}
              onChange={(e) => setOtpToken(e.target.value.replace(/\D/g, ''))}
              placeholder="000000"
              className="w-full px-4 py-3 bg-neutral-900 border border-white/10 rounded-xl text-sm tracking-[0.5em] text-center font-bold focus:outline-none focus:border-indigo-500 transition-colors placeholder:text-neutral-600"
            />
          </div>

          <button
            type="submit"
            disabled={loading || otpToken.length !== 6}
            className="w-full flex items-center justify-center gap-2 py-3.5 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white font-bold rounded-xl text-sm transition-all shadow-lg shadow-indigo-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                Verify & Continue
                <Key className="w-4 h-4" />
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => useAuthStore.getState().clearAuth()}
            className="w-full text-center text-xs text-neutral-500 hover:text-neutral-400 transition-colors"
          >
            Cancel and Return
          </button>
        </form>
      )}

      {!requiresMfa && (
        <div className="text-center pt-2">
          <p className="text-xs text-neutral-500">
            Don't have an account?{' '}
            <Link to="/register" className="text-indigo-400 hover:text-indigo-300 font-semibold transition-colors">
              Create one
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}
