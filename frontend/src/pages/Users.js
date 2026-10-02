import React, { useCallback, useEffect, useState } from 'react';

import { api, errorMessage } from '../api/client';
import Alert from '../components/Alert';
import EmptyState from '../components/EmptyState';
import Spinner from '../components/Spinner';
import { useAuth } from '../context/AuthContext';
import { formatRelative } from '../utils/format';

const ROLES = [
  { value: 'homeowner', label: 'Homeowner' },
  { value: 'management', label: 'Management' },
];

// Roles the portal no longer hands out. The backend still understands them, so
// an account created before they were dropped keeps working; the row for one
// offers its own role alongside the current list rather than rendering a select
// with nothing matching, which would read as though they were someone else.
const RETIRED_ROLE_LABELS = { staff: 'Maintenance staff' };

const roleOptions = (role) => (ROLES.some((r) => r.value === role)
  ? ROLES
  : [...ROLES, { value: role, label: RETIRED_ROLE_LABELS[role] || role }]);

/**
 * A table cell value that is edited in place: type, then Enter (or click away)
 * to save, Escape to put it back. The parent keys it on the saved value, so a
 * successful save re-mounts it with the new value while a rejected one leaves
 * what was typed on screen next to the error explaining it.
 */
function InlineEdit({
  value, onSave, label, placeholder, disabled, type = 'text', allowEmpty = false,
  same = (a, b) => a === b, className,
}) {
  const current = value ?? '';
  return (
    <input
      className={className}
      type={type}
      defaultValue={current}
      aria-label={label}
      placeholder={placeholder}
      disabled={disabled}
      title="Press Enter to save, Escape to cancel"
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          e.currentTarget.value = current;
          e.currentTarget.blur();
        }
      }}
      onBlur={(e) => {
        const next = e.target.value.trim();
        // Unchanged, or emptied where empty is not allowed: put it back
        // rather than send something the API will refuse.
        if (same(next, current) || (!next && !allowEmpty)) {
          e.target.value = current;
          return;
        }
        onSave(next);
      }}
    />
  );
}

export default function Users() {
  const { user: currentUser, setUser } = useAuth();

  const [filters, setFilters] = useState({ q: '', role: '', includeInactive: false });
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState(null);

  // Which account is awaiting confirmation of a reset, and the credential
  // handed back by the last one. `issued` holds the only copy of that password
  // that will ever exist, so it stays on screen until dismissed.
  const [confirmingReset, setConfirmingReset] = useState(null);
  const [issued, setIssued] = useState(null);
  const [copied, setCopied] = useState(false);

  // Deleting is irreversible and the API refuses it for anyone who appears on
  // a ticket, so it gets the same in-row confirmation the reset does.
  const [confirmingDelete, setConfirmingDelete] = useState(null);

  const [search, setSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setFilters((f) => ({ ...f, q: search })), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = Object.fromEntries(
        Object.entries(filters).filter(([, v]) => v !== '' && v !== false),
      );
      const data = await api.listUsers({ ...params, limit: 100 });
      setUsers(data.users);
    } catch (err) {
      setError(errorMessage(err, 'Could not load the directory'));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const patch = async (id, payload, message) => {
    setBusyId(id);
    setError('');
    setNotice('');
    try {
      const updated = await api.updateUser(id, payload);
      setUsers((current) => current.map((u) => (u.id === id ? updated : u)));
      // The header shows the signed-in manager's own name and address.
      if (id === currentUser?.id) setUser(updated);
      setNotice(message);
    } catch (err) {
      setError(errorMessage(err, 'Could not update that account'));
    } finally {
      setBusyId(null);
    }
  };

  const resetPassword = async (target) => {
    setBusyId(target.id);
    setError('');
    setNotice('');
    setIssued(null);
    setCopied(false);
    try {
      const { user: updated, temporaryPassword } = await api.resetUserPassword(target.id);
      setUsers((current) => current.map((u) => (u.id === target.id ? updated : u)));
      setIssued({ fullName: target.fullName, password: temporaryPassword });
    } catch (err) {
      setError(errorMessage(err, 'Could not reset that password'));
    } finally {
      setBusyId(null);
      setConfirmingReset(null);
    }
  };

  const remove = async (target) => {
    setBusyId(target.id);
    setError('');
    setNotice('');
    try {
      await api.deleteUser(target.id);
      setUsers((current) => current.filter((u) => u.id !== target.id));
      setNotice(`${target.fullName} deleted`);
    } catch (err) {
      // A refusal explains itself -- usually that the account is on a ticket
      // and should be deactivated instead. Closing the confirmation puts the
      // Deactivate button back within reach while that message is on screen.
      setError(errorMessage(err, 'Could not delete that account'));
    } finally {
      setBusyId(null);
      setConfirmingDelete(null);
    }
  };

  const copyPassword = async () => {
    try {
      await navigator.clipboard.writeText(issued.password);
      setCopied(true);
    } catch {
      // Clipboard access is refused outside a secure context and in some
      // browsers. The password is on screen either way, so this is not worth
      // an error -- the manager can select it by hand.
      setCopied(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>People</h1>
          <p>Homeowners and managers with access to the portal.</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="filters" style={{ marginBottom: 0 }}>
          <div className="field grow">
            <label htmlFor="q">Search</label>
            <input id="q" placeholder="Name, email or address"
              value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="role">Role</label>
            <select id="role" value={filters.role}
              onChange={(e) => setFilters((f) => ({ ...f, role: e.target.value }))}>
              <option value="">Any role</option>
              {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="checkbox" style={{ marginTop: 22 }}>
              <input type="checkbox" checked={filters.includeInactive}
                onChange={(e) => setFilters((f) => ({ ...f, includeInactive: e.target.checked }))} />
              Show deactivated
            </label>
          </div>
        </div>
      </div>

      <Alert onDismiss={() => setError('')}>{error}</Alert>
      <Alert kind="success" onDismiss={() => setNotice('')}>{notice}</Alert>

      {issued && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--accent)' }}>
          <h3 style={{ marginTop: 0 }}>Temporary password for {issued.fullName}</h3>
          <p style={{ color: 'var(--text-muted)' }}>
            Read this out or hand it over now. It is not stored anywhere and
            cannot be shown again &mdash; if it is lost, reset the password once more.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <code className="temp-password">
              {issued.password}
            </code>
            <button type="button" className="secondary sm" onClick={copyPassword}>
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button type="button" className="secondary sm" onClick={() => setIssued(null)}>
              Done
            </button>
          </div>
          <p className="field-hint" style={{ marginTop: 12 }}>
            They will be asked to choose their own password the first time they
            sign in with it, and any device they were already signed in on has
            been signed out.
          </p>
        </div>
      )}

      {loading ? <Spinner center /> : users.length === 0 ? (
        <div className="card"><EmptyState title="Nobody matches">Try a different search.</EmptyState></div>
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table className="people-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Address</th>
                  <th>Role</th>
                  <th />
                  <th>Joined</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const isSelf = u.id === currentUser?.id;
                  return (
                    <tr key={u.id} style={u.isActive ? undefined : { opacity: 0.55 }}>
                      <td>
                        {/* First and last separately: splitting one box at a
                            space gets "Mary Ann Smith" wrong. */}
                        <div className="inline-name">
                          <InlineEdit
                            key={`f-${u.firstName}`}
                            value={u.firstName}
                            label={`First name of ${u.fullName}`}
                            placeholder="First"
                            disabled={busyId === u.id}
                            onSave={(next) => patch(u.id, { firstName: next },
                              `Renamed to ${next} ${u.lastName}`)}
                          />
                          <InlineEdit
                            key={`l-${u.lastName}`}
                            value={u.lastName}
                            label={`Last name of ${u.fullName}`}
                            placeholder="Last"
                            disabled={busyId === u.id}
                            onSave={(next) => patch(u.id, { lastName: next },
                              `Renamed to ${u.firstName} ${next}`)}
                          />
                        </div>
                        {isSelf && <span style={{ color: 'var(--text-faint)' }}> (you)</span>}
                        {!u.isActive && <span className="badge badge-overdue" style={{ marginLeft: 8 }}>Deactivated</span>}
                        {u.mustChangePassword && (
                          <span className="badge badge-internal" style={{ marginLeft: 8 }}
                            title="Issued a temporary password they have not replaced yet">
                            Temporary password
                          </span>
                        )}
                      </td>
                      <td>
                        <InlineEdit
                          key={u.email}
                          className="wide-field"
                          type="email"
                          value={u.email}
                          label={`Email of ${u.fullName}`}
                          disabled={busyId === u.id}
                          same={(a, b) => a.toLowerCase() === b.toLowerCase()}
                          onSave={(next) => patch(u.id, { email: next }, `${u.fullName} is now ${next}`)}
                        />
                      </td>
                      <td>
                        <InlineEdit
                          key={`a-${u.unitNumber}`}
                          className="wide-field"
                          value={u.unitNumber}
                          label={`Address of ${u.fullName}`}
                          placeholder="Add address"
                          allowEmpty
                          disabled={busyId === u.id}
                          onSave={(next) => patch(u.id, { unitNumber: next },
                            next ? `${u.fullName}'s address is now ${next}` : `Cleared ${u.fullName}'s address`)}
                        />
                      </td>
                      <td>
                        <select
                          className="role-select"
                          value={u.role}
                          disabled={busyId === u.id || isSelf}
                          title={isSelf ? 'You cannot change your own role' : undefined}
                          onChange={(e) => patch(u.id, { role: e.target.value },
                            `${u.fullName} is now ${e.target.value}`)}
                        >
                          {roleOptions(u.role).map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                        </select>
                      </td>
                      <td>
                        {confirmingReset === u.id ? (
                          <div className="rowconfirm">
                            <span>
                              Reset {u.fullName}&rsquo;s password? They will be
                              signed out everywhere.
                            </span>
                            <span className="rowconfirm-actions">
                              <button type="button" className="sm" disabled={busyId === u.id}
                                onClick={() => resetPassword(u)}>
                                {busyId === u.id ? 'Resetting...' : 'Reset'}
                              </button>
                              <button type="button" className="secondary sm" disabled={busyId === u.id}
                                onClick={() => setConfirmingReset(null)}>
                                Cancel
                              </button>
                            </span>
                          </div>
                        ) : confirmingDelete === u.id ? (
                          <div className="rowconfirm">
                            <span>
                              Delete {u.fullName} permanently? This cannot be
                              undone.
                            </span>
                            <span className="rowconfirm-actions">
                              <button type="button" className="danger sm" disabled={busyId === u.id}
                                onClick={() => remove(u)}>
                                {busyId === u.id ? 'Deleting...' : 'Delete'}
                              </button>
                              <button type="button" className="secondary sm" disabled={busyId === u.id}
                                onClick={() => setConfirmingDelete(null)}>
                                Cancel
                              </button>
                            </span>
                          </div>
                        ) : (
                          <div className="rowactions">
                            <button
                              type="button"
                              className="secondary sm"
                              disabled={busyId === u.id || isSelf || !u.isActive}
                              title={
                                isSelf ? 'Change your own password from your profile'
                                  : !u.isActive ? 'Reactivate the account first'
                                    : 'Issue a temporary password'
                              }
                              onClick={() => { setConfirmingReset(u.id); setConfirmingDelete(null); setIssued(null); }}
                            >
                              Reset password
                            </button>
                            <button
                              type="button"
                              className={u.isActive ? 'secondary sm' : 'sm'}
                              disabled={busyId === u.id || isSelf}
                              title={isSelf ? 'You cannot deactivate your own account' : undefined}
                              onClick={() => patch(u.id, { isActive: !u.isActive },
                                `${u.fullName} ${u.isActive ? 'deactivated' : 'reactivated'}`)}
                            >
                              {u.isActive ? 'Deactivate' : 'Reactivate'}
                            </button>
                            <button
                              type="button"
                              className="secondary sm"
                              disabled={busyId === u.id || isSelf}
                              title={
                                isSelf ? 'You cannot delete your own account'
                                  : 'Remove the account permanently'
                              }
                              onClick={() => { setConfirmingDelete(u.id); setConfirmingReset(null); setIssued(null); }}
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </td>
                      <td className="joined">{formatRelative(u.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
