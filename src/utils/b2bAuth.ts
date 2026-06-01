import { supabase } from './supabase';

async function getFunctionErrorMessage(error: any): Promise<string> {
  const fallback = error?.message || 'Failed to create B2B portal user';

  try {
    const context = error?.context;
    if (context && typeof context.json === 'function') {
      const body = await context.json();
      return body?.error || body?.message || fallback;
    }
  } catch (parseError) {
    console.warn('Could not parse B2B auth error response:', parseError);
  }

  return fallback;
}

/**
 * Create an auth user for a B2B account
 * This allows the account to access the B2B portal
 */
export async function createB2BAccountUser(accountData: {
  email: string;
  password: string;
  accountId: string;
  accountName: string;
  labId: string;
}) {
  try {
    // Call the dedicated create-b2b-user edge function
    // This creates an auth.users record with role: 'b2b_account' in user_metadata
    const { data, error } = await supabase.functions.invoke('create-b2b-user', {
      body: {
        email: accountData.email,
        password: accountData.password,
        account_id: accountData.accountId,
        account_name: accountData.accountName,
        name: accountData.accountName,
        lab_id: accountData.labId,
      }
    });

    if (error) {
      console.error('Error creating B2B auth user:', error);
      return { success: false, error: await getFunctionErrorMessage(error) };
    }

    return { success: true, data };
  } catch (error) {
    console.error('Unexpected error creating B2B auth user:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

/**
 * Check if current user is a B2B account user
 */
export async function isB2BUser(): Promise<boolean> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    return user?.user_metadata?.role === 'b2b_account';
  } catch {
    return false;
  }
}

/**
 * Get current B2B account ID from user metadata
 */
export async function getCurrentB2BAccountId(): Promise<string | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user?.user_metadata?.role === 'b2b_account') {
      return user.user_metadata.account_id || null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Get current B2B account details
 */
export async function getCurrentB2BAccount() {
  try {
    const accountId = await getCurrentB2BAccountId();
    if (!accountId) return null;

    const { data, error } = await supabase
      .from('accounts')
      .select('*')
      .eq('id', accountId)
      .single();

    if (error) {
      console.error('Error fetching B2B account:', error);
      return null;
    }

    return data;
  } catch (error) {
    console.error('Error in getCurrentB2BAccount:', error);
    return null;
  }
}
