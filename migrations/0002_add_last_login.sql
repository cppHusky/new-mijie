-- 记录最近登录时间，用于清理长期未登录的账号（180 天，管理员豁免）
ALTER TABLE users ADD COLUMN last_login_at INTEGER;

-- 存量用户以注册时间作为宽限起点
UPDATE users SET last_login_at = created_at WHERE last_login_at IS NULL;
