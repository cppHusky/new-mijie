import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';

// setup 文件在 per-test-file 存储隔离之外运行，可能执行多次；
// applyD1Migrations 只应用尚未应用的迁移，重复调用安全。
await applyD1Migrations((env as any).DB, (env as any).TEST_MIGRATIONS);
