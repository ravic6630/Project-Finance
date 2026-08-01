import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api.js';

// Which family member the app is looking at: 'all' (everyone), 'me' (the
// account owner), or a profile id. Persisted per browser.
const ProfileContext = createContext(null);
const KEY = 'sampada_profile';

export function ProfileProvider({ children }) {
  const [profiles, setProfiles] = useState([]);
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
        // If the active member was deleted, fall back to everyone.
        setActiveState((cur) => {
          if (cur === 'all' || cur === 'me') return cur;
          return (d.profiles || []).some((p) => String(p.id) === String(cur)) ? cur : 'all';
        });
      })
      .catch(() => setProfiles([]));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const setActive = (v) => {
    setActiveState(String(v));
    try {
      localStorage.setItem(KEY, String(v));
    } catch {
      /* private mode */
    }
  };

  // '' | '?profile=me' | '?profile=4' — and '&profile=…' when appending.
  const profileQuery = (prefix = '?') => (active === 'all' ? '' : `${prefix}profile=${active}`);
  // profile_id to attach when creating things under a member view.
  const activeProfileId = active !== 'all' && active !== 'me' ? Number(active) : null;
  const activeLabel =
    active === 'all' ? 'Everyone' : active === 'me' ? 'Me' : profiles.find((p) => String(p.id) === String(active))?.name || 'Member';

  return (
    <ProfileContext.Provider
      value={{ profiles, active, setActive, reload, profileQuery, activeProfileId, activeLabel }}
    >
      {children}
    </ProfileContext.Provider>
  );
}

export const useProfile = () => useContext(ProfileContext);
