export interface GameConfig {
  startTime?: string;
  endTime?: string;
  gamerule?: string;
  about?: string;
}

export async function getGameConfig(db: D1Database): Promise<GameConfig> {
  const row = await db
    .prepare("SELECT value FROM config WHERE key = 'game-config'")
    .first<{ value: string }>();
  if (!row) return {};
  try {
    return JSON.parse(row.value) as GameConfig;
  } catch {
    return {};
  }
}

/** 按比赛时区（wrangler.jsonc 的 TIMEZONE，默认 Asia/Shanghai）格式化时间戳为玩家可读文案 */
export function formatGameTime(iso: string, timezone?: string): string {
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: timezone || 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/** 返回 null 表示在时间窗口内；否则为给玩家的提示文案。管理员不受限。 */
export function checkGameWindow(config: GameConfig, isAdmin: boolean, timezone?: string): string | null {
  if (isAdmin) return null;
  const now = Date.now();
  if (config.startTime && new Date(config.startTime).getTime() > now) {
    return `游戏未开始（开始时间：${formatGameTime(config.startTime, timezone)}），请参阅游戏规则。`;
  }
  if (config.endTime && new Date(config.endTime).getTime() < now) {
    return '游戏已结束，无法提交。';
  }
  return null;
}
