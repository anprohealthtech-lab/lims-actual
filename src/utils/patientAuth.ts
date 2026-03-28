import { supabase } from './supabase';

export const isPatientUser = async (): Promise<boolean> => {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.user_metadata?.role === 'patient';
};

export const getCurrentPatientId = async (): Promise<string | null> => {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.user_metadata?.patient_id ?? null;
};

export const getCurrentPatientLabId = async (): Promise<string | null> => {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.user_metadata?.lab_id ?? null;
};

export const getCurrentPatientMeta = async (): Promise<{
  patient_id: string;
  lab_id: string;
  name: string;
  phone: string;
} | null> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.user_metadata?.role !== 'patient') return null;
  return {
    patient_id: user.user_metadata.patient_id,
    lab_id: user.user_metadata.lab_id,
    name: user.user_metadata.name,
    phone: user.user_metadata.phone,
  };
};

// Step 1 of login: resolve phone → virtual email via public RPC
// Returns patient name (for display) and the virtual email (for signInWithPassword)
export const resolvePatientByPhone = async (phone: string): Promise<{
  email: string;
  patient_name: string;
  lab_name: string;
} | null> => {
  const { data, error } = await supabase.rpc('resolve_patient_virtual_email', {
    p_phone: phone,
  });

  if (error || !data?.length) return null;
  return data[0];
};

// Step 2 of login: sign in with resolved email + PIN
export const patientSignIn = async (email: string, pin: string) => {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: pin });
  if (error) throw new Error('Invalid PIN. Please check and try again.');
  return data;
};

export const patientSignOut = async () => {
  await supabase.auth.signOut();
};
