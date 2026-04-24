-- 软删除账号不再占用邮箱/用户名/手机号唯一约束（与后台列表隐藏 deleted 一致），
-- 避免「该邮箱已注册」但管理列表中看不到行。

DROP INDEX IF EXISTS ux_users_email_ci;
CREATE UNIQUE INDEX ux_users_email_ci
  ON users (lower(email))
  WHERE email IS NOT NULL
    AND btrim(email) <> ''
    AND account_status IS DISTINCT FROM 'deleted';

DROP INDEX IF EXISTS ux_users_username_ci;
CREATE UNIQUE INDEX ux_users_username_ci
  ON users (lower(username))
  WHERE username IS NOT NULL
    AND btrim(username) <> ''
    AND account_status IS DISTINCT FROM 'deleted';

DROP INDEX IF EXISTS ux_users_phone_nonempty;
CREATE UNIQUE INDEX ux_users_phone_nonempty
  ON users (phone)
  WHERE phone IS NOT NULL
    AND btrim(phone) <> ''
    AND account_status IS DISTINCT FROM 'deleted';
