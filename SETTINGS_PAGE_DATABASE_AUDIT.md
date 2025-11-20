# Settings Page - Database Integration Audit

## Current Status: ⚠️ Using Mock Data

The Settings page is currently using hardcoded mock data. Below is what needs to be connected to the database.

---

## 1. User Management (CRITICAL)

### Currently Mock (Lines 226-242)
```typescript
const [users] = useState<User[]>([...]) // Hardcoded 4 users
```

### What's Missing
- ❌ Not loading from `users` table
- ❌ Not filtering by current user's lab (`lab_id`)
- ❌ Not fetching actual user roles via `user_roles` table

### Database Tables Needed
```sql
SELECT * FROM public.users WHERE lab_id = (current_user_lab_id)
SELECT * FROM public.user_roles WHERE is_active = true
SELECT * FROM public.permissions WHERE is_active = true
```

### Required Data Points

**From users table:**
```typescript
{
  id: string;              // ✅
  name: string;           // ✅
  email: string;          // ✅
  role: string;           // ❌ Should map from user_roles.role_name
  department: string;     // ✅ (though called department in mock, it's in DB)
  status: string;         // ✅ (from users.status)
  lastLogin: string;      // ✅ (from users.last_login)
  permissions: string[];  // ❌ Need to join with role_permissions → permissions
  phone: string;          // ✅
  joinDate: string;       // ✅ (from users.join_date)
}
```

---

## 2. Permissions Management

### Currently Mock (Lines 277-290)
```typescript
const [permissions] = useState<Permission[]>([...]) // Hardcoded 9 permissions
```

### What's Missing
- ❌ Not loading from `permissions` table
- ❌ Not loading role permissions from `role_permissions` junction table

### Database Tables Needed
```sql
SELECT p.* 
FROM public.permissions p
WHERE p.is_active = true
ORDER BY p.category, p.permission_name

SELECT rp.permission_id
FROM public.role_permissions rp
WHERE rp.role_id = (role_id)
```

### Required Data Points
```typescript
{
  id: string;              // permission_id from permissions table
  name: string;           // permission_name
  description: string;    // description
  category: string;       // category
  isDefault: boolean;     // can derive from role assignment count
}
```

---

## 3. Lab Context (MISSING)

### Issue
Settings currently shows all users globally. In a **lab-level architecture**, should be:
- ❌ Not filtering by user's lab_id
- ❌ Not showing lab-specific permissions
- ❌ Not showing lab-specific roles

### Fix Required
```typescript
// Add lab context
const { user } = useAuth();
const labId = user?.lab_id; // Get from auth context

// Then fetch:
const { data: labUsers } = await supabase
  .from('users')
  .select('*')
  .eq('lab_id', labId);  // ← LAB FILTER MISSING
```

---

## 4. User Roles (NOW FIXED ✅)

### Current State
- ✅ user_roles table has proper RLS policies
- ✅ Can now SELECT from user_roles without recursion error
- ✅ Settings page shows roles in UI

### But Component Not Using It
- ❌ UserFormComponent shows hardcoded role dropdown
- ❌ Not fetching role list from `user_roles` table

### Required
```typescript
const [availableRoles, setAvailableRoles] = useState<UserRole[]>([]);

useEffect(() => {
  const loadRoles = async () => {
    const { data } = await database.user_roles.getActive(); // or supabase query
    setAvailableRoles(data);
  };
  loadRoles();
}, []);
```

---

## 5. Database Functions NOT Implemented

### Missing in `src/utils/supabase.ts`
```typescript
// ❌ database.users.getByLab(labId)
// ❌ database.permissions.getAll()
// ❌ database.users.create()
// ❌ database.users.update()
// ❌ database.users.delete()
// ❌ database.role_permissions.getByRole()
```

---

## 6. Data Flow Audit

### Team Tab (User Management)
```
Settings.tsx (Team Tab)
├── [MOCK] users state (hardcoded)
├── [MOCK] permissions state (hardcoded)
├── [MOCK] filtering by role
└── [MOCK] user search/filter
```

**Should be:**
```
Settings.tsx (Team Tab)
├── useAuth() → get current user + lab_id
├── useEffect() → load users by lab_id
├── useEffect() → load user_roles
├── database.users.getByLab(labId)
├── database.user_roles.getActive()
└── Real data displayed
```

### Permissions Tab
```
Settings.tsx (Permissions Tab)
├── [MOCK] permissions list
├── [MOCK] no role-permission mapping
└── [MOCK] no data persistence
```

**Should be:**
```
Settings.tsx (Permissions Tab)
├── database.permissions.getAll()
├── database.role_permissions.getByRole(roleId)
├── Display actual permission assignments
└── Save changes to database
```

---

## 7. Implementation Checklist

### Phase 1: Add Lab Context ⏳
- [ ] Import `useAuth` in Settings.tsx
- [ ] Get `labId` from auth context
- [ ] Add error boundary for lab context missing

### Phase 2: Implement Database Functions ⏳
Add to `src/utils/supabase.ts`:
```typescript
const users = {
  getByLab: async (labId: string) => {
    return await supabase
      .from('users')
      .select('*, user_roles(role_name, role_code)')
      .eq('lab_id', labId)
      .order('name');
  },
  
  create: async (userData: Partial<User>, labId: string) => {
    return await supabase.from('users').insert({
      ...userData,
      lab_id: labId,
    });
  },
  
  update: async (userId: string, userData: Partial<User>) => {
    return await supabase
      .from('users')
      .update(userData)
      .eq('id', userId);
  },
  
  delete: async (userId: string) => {
    return await supabase
      .from('users')
      .update({ is_active: false })
      .eq('id', userId);
  }
};

const user_roles = {
  getActive: async () => {
    return await supabase
      .from('user_roles')
      .select('*')
      .eq('is_active', true)
      .order('role_name');
  },
  
  getWithPermissions: async (roleId: string) => {
    return await supabase
      .from('role_permissions')
      .select('permission_id')
      .eq('role_id', roleId);
  }
};
```

### Phase 3: Update Settings Component ⏳
- [ ] Replace mock user data with database fetch
- [ ] Replace mock permissions with database fetch
- [ ] Add useEffect hooks for data loading
- [ ] Update UserFormComponent to use real roles
- [ ] Add loading/error states
- [ ] Implement actual CRUD operations

### Phase 4: Link Form Submissions ⏳
- [ ] handleAddUser → database.users.create()
- [ ] handleEditUser → database.users.update()
- [ ] handleDeleteUser → database.users.delete()
- [ ] handlePermissionChange → role_permissions table updates

---

## 8. Key Database Relationships

```
users
├── id (PK)
├── name, email, phone
├── role_id → user_roles.id
├── lab_id → labs.id
├── status
├── last_login
└── join_date

user_roles
├── id (PK)
├── role_name, role_code
├── is_active
└── is_system_role

role_permissions (Junction)
├── role_id → user_roles.id
├── permission_id → permissions.id
└── created_at

permissions
├── id (PK)
├── permission_name, permission_code
├── category
├── is_active
└── is_default
```

---

## 9. Lab-Level Architecture Requirements

### Current Implementation ❌
- Global view of all users
- No lab isolation
- No multi-tenant filtering

### Required for Lab Architecture ✅
```typescript
// Settings.tsx must have:
const { user } = useAuth(); // Get current user
const labId = user?.lab_id;  // Get user's lab

// All queries must include:
.eq('lab_id', labId)  // Filter by lab

// Users can only see/manage:
- Users in their lab
- Roles available in their lab
- Permissions assigned to their roles
```

---

## 10. Current vs Required State

| Feature | Current | Required | Status |
|---------|---------|----------|--------|
| Load users | Mock/hardcoded | Database (by lab) | ❌ |
| Load permissions | Mock/hardcoded | Database | ❌ |
| Load roles | N/A | Database (fixed ✅) | ⏳ |
| Lab filtering | No | Yes | ❌ |
| Add user | Mock only | Persist to DB | ❌ |
| Edit user | Mock only | Persist to DB | ❌ |
| Delete user | Mock only | Soft delete | ❌ |
| User roles | Hardcoded dropdown | Dynamic from DB | ❌ |
| Permissions tab | Mock list | Real assignments | ❌ |

---

## Summary

**Settings page is working UI-wise but has NO real database integration.** 

To make it production-ready for lab-level management:

1. ✅ **Done**: Fixed RLS policy on user_roles (no more recursion)
2. ⏳ **Next**: Add database functions for users, roles, permissions
3. ⏳ **Then**: Update Settings.tsx to fetch real data
4. ⏳ **Then**: Implement CRUD operations with database persistence
5. ⏳ **Finally**: Add lab-level filtering throughout

**Priority**: High - Settings page is core to lab administration
