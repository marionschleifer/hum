export const migrations: string[] = [
  `
  CREATE TABLE themes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    is_accounto INTEGER NOT NULL DEFAULT 0,
    archived_at TEXT
  );

  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    theme_id TEXT NOT NULL REFERENCES themes(id),
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    source_ref TEXT,
    archived_at TEXT
  );

  CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    notes TEXT,
    parent_id TEXT REFERENCES tasks(id),
    theme_id TEXT REFERENCES themes(id),
    project_id TEXT REFERENCES projects(id),
    status TEXT NOT NULL CHECK (status IN ('inbox', 'open', 'done', 'dropped')),
    essential INTEGER NOT NULL DEFAULT 0,
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('high', 'normal', 'low')),
    size TEXT CHECK (size IN ('S', 'M', 'L')),
    size_confirmed INTEGER NOT NULL DEFAULT 0,
    deadline TEXT,
    recurrence TEXT,
    labels TEXT NOT NULL DEFAULT '[]',
    source TEXT NOT NULL,
    source_ref TEXT,
    postpone_count INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    done_at TEXT,
    dropped_at TEXT
  );
  CREATE INDEX tasks_status ON tasks(status);
  CREATE INDEX tasks_parent ON tasks(parent_id);
  CREATE UNIQUE INDEX tasks_source_ref ON tasks(source, source_ref) WHERE source_ref IS NOT NULL;

  CREATE TABLE completions (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id),
    completed_on TEXT NOT NULL,
    completed_at TEXT NOT NULL,
    actual_minutes INTEGER
  );
  CREATE INDEX completions_task ON completions(task_id, completed_on);

  CREATE TABLE captures (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    raw_text TEXT NOT NULL,
    ai_output TEXT,
    error TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE passkeys (
    id TEXT PRIMARY KEY,
    public_key TEXT NOT NULL,
    sign_count INTEGER NOT NULL,
    label TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE challenges (
    challenge TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('register', 'login')),
    expires_at TEXT NOT NULL
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE api_tokens (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_used_at TEXT
  );

  CREATE TABLE meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  INSERT INTO themes (id, name, color, sort_order, is_accounto) VALUES
    ('work', 'Work', '#2f6fde', 1, 0),
    ('personal', 'Personal', '#2a9d8f', 2, 0),
    ('exercise', 'Exercise', '#e76f51', 3, 0);
  `,
  `
  CREATE TABLE google_accounts (
    email TEXT PRIMARY KEY,
    refresh_token TEXT NOT NULL,
    scope TEXT NOT NULL,
    connected_at TEXT NOT NULL
  );

  CREATE TABLE oauth_states (
    state TEXT PRIMARY KEY,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE calendar_title_rules (
    title_key TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    theme_id TEXT REFERENCES themes(id),
    created_at TEXT NOT NULL
  );

  CREATE TABLE day_plans (
    date TEXT PRIMARY KEY,
    energy TEXT NOT NULL CHECK (energy IN ('high', 'normal', 'lower', 'sick')),
    energy_note TEXT,
    budgets TEXT NOT NULL,
    ai_note TEXT,
    created_at TEXT NOT NULL,
    replanned_at TEXT
  );

  CREATE TABLE day_plan_items (
    date TEXT NOT NULL REFERENCES day_plans(date),
    task_id TEXT NOT NULL REFERENCES tasks(id),
    theme_id TEXT NOT NULL REFERENCES themes(id),
    sort_order INTEGER NOT NULL,
    minutes INTEGER NOT NULL,
    size_assumed INTEGER NOT NULL DEFAULT 0,
    reason TEXT,
    PRIMARY KEY (date, task_id)
  );
  `,
  `
  ALTER TABLE day_plans ADD COLUMN too_big TEXT NOT NULL DEFAULT '{}';
  `,
  `
  CREATE TABLE hidden_events (
    event_id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    start TEXT NOT NULL,
    hidden_at TEXT NOT NULL
  );
  `,
  `
  ALTER TABLE tasks ADD COLUMN first_on TEXT;
  ALTER TABLE tasks ADD COLUMN not_before TEXT;
  ALTER TABLE day_plans ADD COLUMN wrapped_up_at TEXT;

  CREATE TABLE postponements (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id),
    date TEXT NOT NULL,
    reason TEXT NOT NULL CHECK (reason IN ('no_time', 'blocked', 'didnt_want', 'not_relevant', 'other')),
    note TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX postponements_task ON postponements(task_id, date);

  CREATE TABLE suggestions (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id),
    date TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('do_first', 'break_down', 'reschedule', 'drop')),
    reason TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'dismissed')),
    created_at TEXT NOT NULL,
    resolved_at TEXT
  );

  CREATE TABLE learnings (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    source TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  `,
  `
  CREATE TABLE training_sessions (
    id TEXT PRIMARY KEY,
    week_start TEXT NOT NULL,
    date TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('strength', 'intervals', 'easy', 'tempo', 'long', 'rest')),
    min_minutes INTEGER,
    max_minutes INTEGER,
    status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'done', 'skipped', 'sick')),
    travel INTEGER NOT NULL DEFAULT 0,
    note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX training_sessions_week ON training_sessions(week_start, date);
  `,
  `
  ALTER TABLE tasks ADD COLUMN deadline_fixed INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE tasks ADD COLUMN stakes TEXT CHECK (stakes IN ('high', 'low'));

  CREATE TABLE deadline_decisions (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id),
    date TEXT NOT NULL,
    deadline TEXT NOT NULL,
    decision TEXT NOT NULL CHECK (decision IN ('let_go')),
    created_at TEXT NOT NULL
  );
  CREATE INDEX deadline_decisions_task ON deadline_decisions(task_id, deadline);
  `,
  `
  INSERT INTO meta (key, value)
  SELECT 'training_template', '${JSON.stringify([
    { day: 0, kind: "strength", minMinutes: 60 },
    { day: 1, kind: "intervals" },
    { day: 2, kind: "easy", minMinutes: 40, maxMinutes: 50 },
    { day: 3, kind: "strength", minMinutes: 60 },
    { day: 4, kind: "tempo", minMinutes: 30, maxMinutes: 30 },
    { day: 5, kind: "rest" },
    { day: 6, kind: "long", minMinutes: 75, maxMinutes: 100 },
  ])}'
  WHERE EXISTS (SELECT 1 FROM passkeys) OR EXISTS (SELECT 1 FROM training_sessions);
  `,
  `
  ALTER TABLE day_plans ADD COLUMN open_work TEXT NOT NULL DEFAULT '{}';
  ALTER TABLE day_plans ADD COLUMN time_spent TEXT;
  `,
];
