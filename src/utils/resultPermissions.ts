const normalizeDepartment = (department?: string | null) =>
  (department || '').trim().toLowerCase();

export const isRadiologyDepartment = (department?: string | null) => {
  const normalized = normalizeDepartment(department);
  return normalized.includes('radiology') || normalized.includes('xray') || normalized.includes('x-ray');
};

export const getResultEntryPermissionForDepartment = (department?: string | null) =>
  isRadiologyDepartment(department) ? 'results.enter_radiology' : 'results.enter_general';

export const getVerificationPermissionForDepartment = (department?: string | null) =>
  isRadiologyDepartment(department) ? 'results.verify_radiology' : 'results.verify';

export const getSectionEditPermissionForDepartment = (department?: string | null, editorRole: 'doctor' | 'technician') => {
  if (isRadiologyDepartment(department)) {
    return 'sections.edit_radiology';
  }

  return editorRole === 'doctor' ? 'sections.edit_doctor' : 'sections.edit_technician';
};

export const getSectionVerificationPermissionForDepartment = (department?: string | null) =>
  isRadiologyDepartment(department) ? 'results.verify_radiology' : 'results.verify_section_only';
