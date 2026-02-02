-- Add "Connect WhatsApp" permission
-- This permission allows users to connect and manage WhatsApp sessions

INSERT INTO permissions (permission_name, permission_code, description, category) 
VALUES ('Connect WhatsApp', 'connect_whatsapp', 'Connect and manage WhatsApp session for sending messages', 'WhatsApp Integration')
ON CONFLICT (permission_code) DO NOTHING;

-- Grant this permission to admin role by default
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM user_roles r, permissions p
WHERE r.role_code = 'admin' AND p.permission_code = 'connect_whatsapp'
ON CONFLICT DO NOTHING;

-- Also grant to manager role by default
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM user_roles r, permissions p
WHERE r.role_code = 'manager' AND p.permission_code = 'connect_whatsapp'
ON CONFLICT DO NOTHING;
