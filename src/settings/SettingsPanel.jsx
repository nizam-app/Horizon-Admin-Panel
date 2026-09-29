import { useCallback, useEffect, useState } from 'react';
import { Lock, Settings, UserRound } from 'lucide-react';
import * as api from '../api.js';
import { workspaceRoleLabel } from '../auth/roles.js';
import { HrField, HrTextInput } from '../hr/HrForm.jsx';
import { HrPageHeader, hrCardClass, hrPrimaryBtn, hrSecondaryBtn } from '../hr/HrUi.jsx';
import { useHrLoadError } from '../hrPanelUtils.js';
import { alertError, alertSuccess } from '../swal.js';

const SECTIONS = [
  { id: 'profile', label: 'Profile', icon: UserRound },
  { id: 'security', label: 'Security', icon: Lock },
];

export function SettingsPanel({ token, onAuthError, onProfileSaved }) {
  const [section, setSection] = useState('profile');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [profile, setProfile] = useState(null);
  const [displayName, setDisplayName] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState('');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordErrors, setPasswordErrors] = useState({});

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const user = await api.getStaffMe(token);
      setProfile(user);
      setDisplayName(user?.displayName || '');
    } catch (e) {
      setError(useHrLoadError(e, onAuthError));
    } finally {
      setLoading(false);
    }
  }, [token, onAuthError]);

  useEffect(() => {
    load();
  }, [load]);

  const saveProfile = async (ev) => {
    ev.preventDefault();
    const name = String(displayName ?? '').trim();
    if (!name) {
      setProfileError('Display name is required');
      return;
    }
    setProfileError('');
    setProfileSaving(true);
    try {
      const user = await api.updateStaffMe(token, { displayName: name });
      setProfile(user);
      setDisplayName(user.displayName || name);
      onProfileSaved?.({ displayName: user.displayName });
      await alertSuccess('Your profile has been updated.', 'Profile saved');
    } catch (e) {
      await alertError(e?.message || 'Could not save profile');
    } finally {
      setProfileSaving(false);
    }
  };

  const savePassword = async (ev) => {
    ev.preventDefault();
    const errs = {};
    if (!currentPassword) errs.currentPassword = 'Enter your current password';
    if (!newPassword) errs.newPassword = 'Enter a new password';
    else if (String(newPassword).length < 6) errs.newPassword = 'At least 6 characters';
    if (newPassword !== confirmPassword) errs.confirmPassword = 'Passwords do not match';
    if (Object.keys(errs).length) {
      setPasswordErrors(errs);
      return;
    }
    setPasswordErrors({});
    setPasswordSaving(true);
    try {
      await api.changeStaffPassword(token, { currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      await alertSuccess('Use your new password next time you sign in.', 'Password changed');
    } catch (e) {
      await alertError(e?.message || 'Could not change password');
    } finally {
      setPasswordSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <HrPageHeader
        title="Settings"
        description="Manage your account profile and security. More workspace options will appear here later."
        icon={Settings}
      />

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">{error}</div>
      ) : null}

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <nav
          className="flex shrink-0 gap-1 overflow-x-auto rounded-2xl border border-zinc-200/90 bg-white p-1.5 shadow-card ring-1 ring-zinc-950/[0.03] lg:w-52 lg:flex-col lg:overflow-visible"
          aria-label="Settings sections"
        >
          {SECTIONS.map(({ id, label, icon: Icon }) => {
            const active = section === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setSection(id)}
                className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition ${
                  active
                    ? 'bg-indigo-50 text-indigo-900 ring-1 ring-indigo-200/80'
                    : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900'
                }`}
                aria-current={active ? 'true' : undefined}
              >
                <Icon className="h-4 w-4 shrink-0" strokeWidth={2} />
                {label}
              </button>
            );
          })}
        </nav>

        <div className="min-w-0 flex-1">
          {loading ? (
            <div className={`${hrCardClass} px-5 py-12 text-center text-sm text-zinc-500`}>Loading account…</div>
          ) : section === 'profile' ? (
            <form onSubmit={saveProfile} className={`${hrCardClass} p-5 sm:p-6`}>
              <h2 className="text-base font-semibold text-zinc-950">Profile</h2>
              <p className="mt-1 text-sm text-zinc-600">Your name appears in the sidebar and audit trails.</p>
              <div className="mt-6 max-w-md space-y-4">
                <HrField label="Display name">
                  <HrTextInput
                    value={displayName}
                    onChange={(ev) => {
                      setDisplayName(ev.target.value);
                      setProfileError('');
                    }}
                    placeholder="Full name"
                    required
                    autoComplete="name"
                  />
                  {profileError ? <p className="mt-1 text-2xs text-rose-600">{profileError}</p> : null}
                </HrField>
                <HrField label="Email">
                  <HrTextInput value={profile?.email || ''} readOnly disabled className="bg-zinc-50 text-zinc-600" />
                  <p className="mt-1 text-2xs text-zinc-500">Contact an administrator to change your login email.</p>
                </HrField>
                <div>
                  <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-zinc-500">Role</p>
                  <span className="inline-flex rounded-full border border-indigo-200/80 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-900">
                    {workspaceRoleLabel(profile?.role)}
                  </span>
                </div>
                {profile?.updatedAt ? (
                  <p className="text-2xs text-zinc-400">
                    Last updated {new Date(profile.updatedAt).toLocaleString()}
                  </p>
                ) : null}
              </div>
              <div className="mt-8 flex flex-wrap gap-2">
                <button type="submit" disabled={profileSaving} className={hrPrimaryBtn}>
                  {profileSaving ? 'Saving…' : 'Save profile'}
                </button>
                <button type="button" className={hrSecondaryBtn} onClick={() => load()} disabled={profileSaving}>
                  Reset
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={savePassword} className={`${hrCardClass} p-5 sm:p-6`}>
              <h2 className="text-base font-semibold text-zinc-950">Security</h2>
              <p className="mt-1 text-sm text-zinc-600">Change your password. You will stay signed in on this device.</p>
              <div className="mt-6 max-w-md space-y-4">
                <HrField label="Current password">
                  <HrTextInput
                    type="password"
                    value={currentPassword}
                    onChange={(ev) => {
                      setCurrentPassword(ev.target.value);
                      setPasswordErrors((p) => ({ ...p, currentPassword: '' }));
                    }}
                    autoComplete="current-password"
                  />
                  {passwordErrors.currentPassword ? (
                    <p className="mt-1 text-2xs text-rose-600">{passwordErrors.currentPassword}</p>
                  ) : null}
                </HrField>
                <HrField label="New password">
                  <HrTextInput
                    type="password"
                    value={newPassword}
                    onChange={(ev) => {
                      setNewPassword(ev.target.value);
                      setPasswordErrors((p) => ({ ...p, newPassword: '' }));
                    }}
                    autoComplete="new-password"
                  />
                  {passwordErrors.newPassword ? (
                    <p className="mt-1 text-2xs text-rose-600">{passwordErrors.newPassword}</p>
                  ) : null}
                </HrField>
                <HrField label="Confirm new password">
                  <HrTextInput
                    type="password"
                    value={confirmPassword}
                    onChange={(ev) => {
                      setConfirmPassword(ev.target.value);
                      setPasswordErrors((p) => ({ ...p, confirmPassword: '' }));
                    }}
                    autoComplete="new-password"
                  />
                  {passwordErrors.confirmPassword ? (
                    <p className="mt-1 text-2xs text-rose-600">{passwordErrors.confirmPassword}</p>
                  ) : null}
                </HrField>
              </div>
              <div className="mt-8">
                <button type="submit" disabled={passwordSaving} className={hrPrimaryBtn}>
                  {passwordSaving ? 'Updating…' : 'Change password'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
