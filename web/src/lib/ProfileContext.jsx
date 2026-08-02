import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api.js';

// Which family member the app is looking at: 'all' (everyone), 'me' (the
// account owner), a managed-profile id, or 'u:<userId>' for a LINKED real
// account (view-only). Persisted per browser.
const ProfileContext = createContext(null);
const KEY = 'sampada_profile';

const isLinkedScope = (v) => /^u:\d+$/.test(String(v));

export function ProfileProvider({ children }) {
  const [profiles, setProfiles] = useState([]);
  const [family, setFamily] = useState({ members: [], sent_pending: [], received_pending: [] });
  const [active, setActiveState] = useState(() => {
    try {
      return localStorage.getItem(KEY) || 'all';
    } catch {
      return 'all';
    }
  });

  const reload = useCallback(() => {
    api('/profiles')
      .then((d) => {
        setProfiles(d.profiles || []);
        setActiveState((cur) => {
          if (cur === 'all' || cur === 'me' || isLinkedScope(cur)) return cur;
          // If the active managed member was deleted, fall back to everyone.
          return (d.profiles || []).some((p) => String(p.id) === String(cur)) ? cur : 'all';
        });
      })
      .catch(() => setProfiles([]));
    api('/family')
      .then((d) => {
        const fam = {
          members: d.members || [],
          sent_pending: d.sent_pending || [],
          received_pending: d.received_pending || [],
        };
        setFamily(fam);
        // If the active linked member was unlinked, fall back to everyone.
        setActiveState((cur) =>
          isLinkedScope(cur) && !fam.members.some((m) => `u:${m.user_id}` === cur) ? 'all' : cur
        );
      })
      .catch(() => setFamily({ members: [], sent_pending: [], received_pending: [] }));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const setActive = (v) => setActiveState(String(v));

  // Persist every scope change — including automatic fallbacks when a member
  // is deleted/unlinked — so a stale scope never survives a reload.
  useEffect(() => {
    try {
      localStorage.setItem(KEY, active);
    } catch {
      /* private mode */
    }
  }, [active]);

  const activeIsLinked = isLinkedScope(active);
  const activeMember = activeIsLinked
    ? family.members.find((m) => `u:${m.user_id}` === active) || null
    : null;

  // Scope for the DASHBOARD, which understands every kind of member.
  const dashboardQuery = (prefix = '?') => (active === 'all' ? '' : `${prefix}profile=${active}`);
  // Scope for management pages (holdings/cash/assets). A linked member's data
  // is view-only on the dashboard, so those pages stay on your own account.
  const profileQuery = (prefix = '?') =>
    active === 'all' || activeIsLinked ? '' : `${prefix}profile=${active}`;
  // profile_id to attach when creating things under a member view.
  const activeProfileId =
    active !== 'all' && active !== 'me' && !activeIsLinked ? Number(active) : null;
  const activeLabel =
    active === 'all'
      ? 'Everyone'
      : active === 'me'
        ? 'Me'
        : activeIsLinked
          ? activeMember?.name || 'Linked member'
          : profiles.find((p) => String(p.id) === String(active))?.name || 'Member';

  return (
    <ProfileContext.Provider
      value={{
        profiles,
        family,
        active,
        setActive,
        reload,
        profileQuery,
        dashboardQuery,
        activeProfileId,
        activeLabel,
        activeIsLinked,
        activeMember,
      }}
    >
      {children}
    </ProfileContext.Provider>
  );
}

export const useProfile = () => useContext(ProfileContext);
