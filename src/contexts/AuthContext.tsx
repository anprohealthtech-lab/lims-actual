import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '../utils/supabase';

// Lab status type
type LabStatus = 'trial' | 'active' | 'inactive' | 'suspended' | null;

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  labStatus: LabStatus;
  labStatusLoading: boolean;
  labName: string | null;
  labLogo: string | null;
  labActiveUpto: Date | null;
  trialDaysRemaining: number | null;
  blockSendOnDue: boolean;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signUp: (email: string, password: string, userData?: any) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
  refreshLabStatus: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    // During development, sometimes the context isn't ready yet
    // Return a default loading state instead of throwing
    console.warn('useAuth called before AuthProvider is ready. This is usually harmless during development.');
    return {
      user: null,
      session: null,
      loading: true,
      labStatus: null as LabStatus,
      labStatusLoading: true,
      labName: null,
      labLogo: null,
      labActiveUpto: null,
      trialDaysRemaining: null,
      blockSendOnDue: false,
      signIn: async () => ({ error: new Error('Auth not ready') }),
      signUp: async () => ({ error: new Error('Auth not ready') }),
      signOut: async () => { },
      refreshLabStatus: async () => { }
    };
  }
  return context;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [labStatus, setLabStatus] = useState<LabStatus>(null);
  const [labStatusLoading, setLabStatusLoading] = useState(true);
  const [labName, setLabName] = useState<string | null>(null);
  const [labLogo, setLabLogo] = useState<string | null>(null);
  const [labActiveUpto, setLabActiveUpto] = useState<Date | null>(null);
  const [trialDaysRemaining, setTrialDaysRemaining] = useState<number | null>(null);
  const [blockSendOnDue, setBlockSendOnDue] = useState<boolean>(false);

  // Track if lab status has been fetched for current user to avoid duplicate fetches
  const labStatusFetchedForUser = useRef<string | null>(null);

  // Fetch lab status for the current user
  const fetchLabStatus = useCallback(async (currentUser: User | null, force: boolean = false) => {
    if (!currentUser?.email) {
      setLabStatus(null);
      setLabName(null);
      setLabLogo(null);
      setLabActiveUpto(null);
      setTrialDaysRemaining(null);
      setLabStatusLoading(false);
      labStatusFetchedForUser.current = null;
      return;
    }

    // Skip if already fetched for this user (unless forced)
    if (!force && labStatusFetchedForUser.current === currentUser.email) {
      return;
    }

    // B2B account users are not lab staff — skip lab status check
    if (currentUser.user_metadata?.role === 'b2b_account') {
      setLabStatus('active');
      setLabStatusLoading(false);
      labStatusFetchedForUser.current = currentUser.email;
      return;
    }

    setLabStatusLoading(true);
    try {
      // First, get the user's lab_id from the users table
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('lab_id')
        .eq('email', currentUser.email)
        .eq('status', 'Active')
        .maybeSingle();

      if (userError || !userData?.lab_id) {
        console.warn('Could not find lab_id for user:', currentUser.email);
        // Default to active if no lab found (for backward compatibility)
        setLabStatus('active');
        setLabName(null);
        setLabLogo(null);
        setLabActiveUpto(null);
        setTrialDaysRemaining(null);
        setLabStatusLoading(false);
        labStatusFetchedForUser.current = currentUser.email;
        return;
      }

      // Now fetch the lab's plan_status and name
      const { data: labData, error: labError } = await supabase
        .from('labs')
        .select('name, plan_status, active_upto, block_send_on_due')
        .eq('id', userData.lab_id)
        .single();

      if (labError || !labData) {
        console.error('Could not fetch lab data:', labError);
        // Default to active if lab data not found
        setLabStatus('active');
        setLabName(null);
        setLabLogo(null);
        setLabActiveUpto(null);
        setTrialDaysRemaining(null);
        setLabStatusLoading(false);
        labStatusFetchedForUser.current = currentUser.email;
        return;
      }

      // Check if subscription has expired (if active_upto is set)
      let status = labData.plan_status as LabStatus;
      let activeUpto: Date | null = null;
      let daysRemaining: number | null = null;

      if (labData.active_upto) {
        activeUpto = new Date(labData.active_upto);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (activeUpto < today) {
          // Subscription has expired - treat as inactive
          status = 'inactive';
          daysRemaining = 0;
        } else {
          // Calculate days remaining (rounded up)
          const msRemaining = activeUpto.getTime() - Date.now();
          daysRemaining = Math.ceil(msRemaining / (1000 * 60 * 60 * 24));
        }
      }

      setLabStatus(status);
      setLabName(labData.name);
      setLabActiveUpto(activeUpto);
      setTrialDaysRemaining(daysRemaining);
      setBlockSendOnDue((labData as any).block_send_on_due ?? false);
      labStatusFetchedForUser.current = currentUser.email;

      // Fetch lab logo from lab_branding_assets (prefer default, fallback to any logo)
      const { data: logoAssets } = await supabase
        .from('lab_branding_assets')
        .select('file_url, is_default')
        .eq('lab_id', userData.lab_id)
        .eq('asset_type', 'logo')
        .order('is_default', { ascending: false })
        .limit(1);

      setLabLogo(logoAssets?.[0]?.file_url || null);
    } catch (err) {
      console.error('Error fetching lab status:', err);
      // Default to active on error to not block users
      setLabStatus('active');
      setLabName(null);
      setLabLogo(null);
      setLabActiveUpto(null);
      setTrialDaysRemaining(null);
      labStatusFetchedForUser.current = currentUser.email;
    } finally {
      setLabStatusLoading(false);
    }
  }, []);

  // Refresh lab status (can be called externally) - always forces a refresh
  const refreshLabStatus = useCallback(async () => {
    await fetchLabStatus(user, true);
  }, [user, fetchLabStatus]);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) {
        console.error('Error getting initial session:', error);
      }
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
      // Fetch lab status after getting initial session
      fetchLabStatus(session?.user ?? null);
    }).catch((error) => {
      console.error('Unexpected error getting session:', error);
      setLoading(false);
      setLabStatusLoading(false);
    });

    // Listen for auth changes - but only fetch lab status on actual sign in/out
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);

      // Only fetch lab status on actual sign in/out events, not on token refresh or other events
      if (event === 'SIGNED_IN') {
        // New sign in - fetch lab status
        fetchLabStatus(session?.user ?? null, true);
      } else if (event === 'SIGNED_OUT') {
        // Sign out - clear lab status
        setLabStatus(null);
        setLabName(null);
        setLabLogo(null);
        setLabActiveUpto(null);
        setTrialDaysRemaining(null);
        setLabStatusLoading(false);
        labStatusFetchedForUser.current = null;
      }
      // For TOKEN_REFRESHED, INITIAL_SESSION, USER_UPDATED - don't re-fetch lab status
    });

    return () => subscription.unsubscribe();
  }, [fetchLabStatus]);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error };
  };

  const signUp = async (email: string, password: string, userData?: any) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: userData,
      },
    });
    return { error };
  };

  const signOut = async () => {
    setLabStatus(null);
    setLabName(null);
    setLabLogo(null);
    setLabActiveUpto(null);
    setTrialDaysRemaining(null);
    labStatusFetchedForUser.current = null;
    await supabase.auth.signOut();
  };

  const value = {
    user,
    session,
    loading,
    labStatus,
    labStatusLoading,
    labName,
    labLogo,
    labActiveUpto,
    trialDaysRemaining,
    blockSendOnDue,
    signIn,
    signUp,
    signOut,
    refreshLabStatus,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};