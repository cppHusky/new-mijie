-- puzzle-framework 初始 schema（v1.2 定稿，见 AGENTS.md 第 8 节）

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  qq TEXT,
  admin INTEGER NOT NULL DEFAULT 0,
  banned INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  remark TEXT,
  total_points REAL NOT NULL DEFAULT 0,
  passed_count INTEGER NOT NULL DEFAULT 0,
  last_progress_at INTEGER,
  created_at INTEGER NOT NULL
);

-- (玩家, 题目) 四维度持久化：解锁 / 访问 / 通关 / 得分
CREATE TABLE problem_state (
  username TEXT NOT NULL,
  pid TEXT NOT NULL,
  unlocked_at INTEGER,
  visited_at INTEGER,
  passed_at INTEGER,
  score REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (username, pid)
);

-- award 幂等的真理之源：只允许 INSERT OR IGNORE
CREATE TABLE score_events (
  username TEXT NOT NULL,
  pid TEXT NOT NULL,
  score_id TEXT NOT NULL,
  points REAL NOT NULL,
  awarded_at INTEGER NOT NULL,
  PRIMARY KEY (username, pid, score_id)
);

CREATE TABLE game_storage (
  username TEXT NOT NULL,
  pid TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT,
  PRIMARY KEY (username, pid, key)
);

CREATE TABLE records (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL,
  pid TEXT NOT NULL,
  ans_json TEXT,
  server INTEGER NOT NULL DEFAULT 0,
  passed INTEGER NOT NULL DEFAULT 0,
  gained_points REAL NOT NULL DEFAULT 0,
  msg TEXT,
  content TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_records_pid ON records(pid);
CREATE INDEX idx_records_user ON records(username);

CREATE TABLE config (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE notices (
  id INTEGER PRIMARY KEY,
  content TEXT,
  author TEXT,
  created_at INTEGER
);
