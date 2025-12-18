# User Location Access Implementation

## Overview

This system allows administrators to assign users to specific locations and designate a primary location for each user. This is useful for restricting phlebotomists to collection centers, lab managers to main labs, and technicians to specific processing locations.

## Database Schema

### Existing `user_centers` Junction Table

```sql
CREATE TABLE public.user_centers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.users(id),
  location_id uuid REFERENCES public.locations(id),
  is_primary boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now()
);
```

**Key Fields:**
- `user_id`: FK to users table
- `location_id`: FK to locations table
- `is_primary`: Boolean flag indicating the user's primary work location
- Each user can have multiple location assignments
- Empty assignments = access to all locations (backward compatible)

## Database API (`src/utils/supabase.ts`)

The centralized database API already includes helper functions for location access:

### `getCurrentUserLocations()`
Returns array of location IDs the current user can access.

```typescript
const locationIds = await database.getCurrentUserLocations();
// Returns: ['location-uuid-1', 'location-uuid-2', ...]
```

### `getCurrentUserPrimaryLocation()`
Returns the user's primary location ID or null.

```typescript
const primaryLocationId = await database.getCurrentUserPrimaryLocation();
// Returns: 'primary-location-uuid' or null
```

### `shouldFilterByLocation()`
Checks if location filtering should be applied for the current user.

```typescript
const { shouldFilter, locationIds, canViewAll } = await database.shouldFilterByLocation();
// Returns: { shouldFilter: boolean, locationIds: string[], canViewAll: boolean }
```

## Settings UI Implementation

### Location Selection Form (`src/pages/Settings.tsx`)

**User Form Component** includes:

1. **Primary Location Dropdown**
   - Single select dropdown
   - Labeled "Primary Location"
   - Auto-adds to accessible locations when selected
   - Optional (can be unset)

2. **Location Access Checkboxes**
   - Grid layout (3 columns on desktop)
   - Shows all locations with checkboxes
   - Primary location is highlighted with blue border + "Primary" badge
   - Empty selection = access to all locations

**State Management:**
```typescript
const [selectedPrimaryLocation, setSelectedPrimaryLocation] = useState<string>('');
const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
```

**Data Flow:**

1. **On Load** (edit user):
   ```typescript
   const { data: userCenters } = await supabase
     .from('user_centers')
     .select('location_id, is_primary')
     .eq('user_id', user.id);
   
   const primaryCenter = userCenters.find(c => c.is_primary);
   setSelectedPrimaryLocation(primaryCenter?.location_id || '');
   setSelectedLocations(userCenters.map(c => c.location_id));
   ```

2. **On Save**:
   ```typescript
   // Save user record first
   const { data: newUser } = await supabase
     .from('users')
     .insert({ name, email, role_id, ... })
     .select('id')
     .single();
   
   // Delete existing location assignments (if updating)
   await supabase
     .from('user_centers')
     .delete()
     .eq('user_id', userId);
   
   // Insert new location assignments
   const userCenters = selectedLocations.map(locationId => ({
     user_id: userId,
     location_id: locationId,
     is_primary: locationId === selectedPrimaryLocation,
   }));
   
   await supabase
     .from('user_centers')
     .insert(userCenters);
   ```

## UI Features

### Visual Indicators
- **Primary location** has blue border and "Primary" badge
- **Checkboxes** show all assigned locations
- **Empty selection** means access to all locations (shown in help text)

### User Experience
1. Admin opens Settings → Team Management
2. Clicks "+ Add User" or edits existing user
3. Selects primary location from dropdown (optional)
4. Checks additional accessible locations
5. Primary location auto-adds to accessible locations
6. Unchecking primary location clears the primary flag
7. Saves → Creates records in `user_centers` table

## Use Cases

### Phlebotomist
- **Primary Location**: Collection Center A
- **Accessible Locations**: Collection Center A, Collection Center B
- **Result**: Can only see orders from assigned centers

### Lab Manager
- **Primary Location**: Main Lab
- **Accessible Locations**: Empty (unchecked all)
- **Result**: Can access all locations

### Lab Technician
- **Primary Location**: Processing Lab
- **Accessible Locations**: Processing Lab, Main Lab
- **Result**: Restricted to specific labs

## Row-Level Security (Future Enhancement)

The `user_centers` table can be used in RLS policies to filter data by location:

```sql
CREATE POLICY orders_location_access ON orders
FOR SELECT USING (
  -- Check if user has access to order's location
  EXISTS (
    SELECT 1 FROM user_centers
    WHERE user_id = auth.uid()
    AND location_id = orders.location_id
  )
  OR
  -- Or user has no location restrictions (empty assignments = all access)
  NOT EXISTS (
    SELECT 1 FROM user_centers
    WHERE user_id = auth.uid()
  )
);
```

## Migration Status

✅ **No migration needed** - `user_centers` table already exists in the database schema.

## Testing Checklist

- [ ] Create new user with primary location
- [ ] Create new user with multiple locations
- [ ] Create new user with no locations (should access all)
- [ ] Edit user to change primary location
- [ ] Edit user to add/remove locations
- [ ] Verify `user_centers` records created correctly
- [ ] Verify primary location has `is_primary = true`
- [ ] Test location filtering in order lists
- [ ] Test API helper functions

## API Helper Functions Reference

```typescript
// Get current user's accessible locations
const locations = await database.getCurrentUserLocations();

// Get current user's primary location
const primaryLoc = await database.getCurrentUserPrimaryLocation();

// Check if location filtering should be applied
const { shouldFilter, locationIds, canViewAll } = await database.shouldFilterByLocation();

// Use in queries
if (shouldFilter && !canViewAll) {
  query = query.in('location_id', locationIds);
}
```

## Notes

- **Backward Compatible**: Empty location assignments = access to all locations
- **Normalized Design**: Junction table follows database best practices
- **Performance**: GIN index on `user_centers(user_id, location_id)` for fast lookups
- **Flexible**: Supports multiple location assignments per user
- **Clear UX**: Visual indicators (badges, borders) show primary location
