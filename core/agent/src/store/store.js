import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { buildManagedTaskAccess } from "../managed-access.js";

const SESSION_STATUSES = new Set(["start", "running", "idle", "paused", "done", "archived"]);
const MAX_PENDING_WECHAT_NOTIFICATIONS = 20;

export class BridgeStore {
  constructor({ dataDir, consoleBaseUrl, databasePath, externalAccess } = {}) {
    this.dataDir = dataDir || process.cwd();
    this.consoleBaseUrl = consoleBaseUrl;
    this.externalAccess = externalAccess || (() => ({ ready: true, reason: "ready", origin: new URL(this.consoleBaseUrl).origin }));
    this.stateFile = path.join(this.dataDir, "state.json");
    this.databasePath = databasePath || path.join(this.dataDir, "state.sqlite");
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.db = new DatabaseSync(this.databasePath);
    this.init();
  }

  init() {
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.migrateSingleMachineTables();
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        role TEXT NOT NULL,
        parent_session_id TEXT,
        channel TEXT,
        sender_id TEXT,
        sender_name TEXT,
        workspace_root TEXT NOT NULL,
        agent_type TEXT NOT NULL,
        agent_alias TEXT NOT NULL,
        status TEXT NOT NULL,
        title TEXT NOT NULL,
        task_description TEXT NOT NULL,
        summary TEXT NOT NULL,
        cli_session_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at);
      CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_session_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_role_status ON sessions(role, status, updated_at);

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        kind TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
        UNIQUE(session_id, seq)
      );
      CREATE INDEX IF NOT EXISTS idx_events_session_seq ON events(session_id, seq);

      CREATE TABLE IF NOT EXISTS token_usage (
        session_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        input_tokens INTEGER NOT NULL,
        cached_input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        reasoning_output_tokens INTEGER NOT NULL,
        total_tokens INTEGER NOT NULL,
        last_input_tokens INTEGER NOT NULL,
        last_cached_input_tokens INTEGER NOT NULL,
        last_output_tokens INTEGER NOT NULL,
        last_reasoning_output_tokens INTEGER NOT NULL,
        last_total_tokens INTEGER NOT NULL,
        model_context_window INTEGER,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(session_id, thread_id),
        FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_token_usage_updated ON token_usage(updated_at);

      CREATE TABLE IF NOT EXISTS token_usage_daily (
        day TEXT PRIMARY KEY,
        input_tokens INTEGER NOT NULL,
        cached_input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        reasoning_output_tokens INTEGER NOT NULL,
        total_tokens INTEGER NOT NULL,
        request_count INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS channel_sessions (
        key TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS channel_state (
        channel TEXT PRIMARY KEY,
        last_recipient_id TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pending_wechat_notifications (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        recipient_id TEXT NOT NULL,
        content TEXT NOT NULL,
        notification_key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(recipient_id, notification_key)
      );
      CREATE INDEX IF NOT EXISTS idx_pending_wechat_recipient
        ON pending_wechat_notifications(recipient_id, created_at, id);

      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        workspace_root TEXT NOT NULL,
        description TEXT NOT NULL,
        routing_tags_json TEXT NOT NULL,
        context_summary TEXT NOT NULL,
        app_server_json TEXT NOT NULL,
        agent_command_aliases_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(name)
      );
      CREATE INDEX IF NOT EXISTS idx_workspaces_updated ON workspaces(updated_at);

      CREATE TABLE IF NOT EXISTS commands (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        command_type TEXT NOT NULL,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        result_json TEXT NOT NULL,
        error TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_commands_session ON commands(session_id, created_at);

      CREATE TABLE IF NOT EXISTS scheduled_tasks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        cron TEXT NOT NULL,
        timezone TEXT NOT NULL,
        prompt TEXT NOT NULL,
        workspace_name TEXT NOT NULL,
        workspace_root TEXT NOT NULL,
        recipient_id TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        next_run_at TEXT,
        last_run_at TEXT,
        last_session_id TEXT,
        run_count INTEGER NOT NULL,
        last_error TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_next ON scheduled_tasks(enabled, next_run_at);

      CREATE TABLE IF NOT EXISTS automation_sources (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        account_ref TEXT NOT NULL,
        capabilities_json TEXT NOT NULL,
        sensitivity TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        health TEXT NOT NULL,
        last_event_at TEXT,
        last_error TEXT NOT NULL,
        config_version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_automation_sources_kind ON automation_sources(kind, enabled);

      CREATE TABLE IF NOT EXISTS automation_rules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        source_id TEXT,
        event_type TEXT NOT NULL,
        conditions_json TEXT NOT NULL,
        action_json TEXT NOT NULL,
        permissions_json TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(source_id) REFERENCES automation_sources(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_automation_rules_source ON automation_rules(source_id, enabled);

      CREATE TABLE IF NOT EXISTS automation_rule_versions (
        rule_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        snapshot_json TEXT NOT NULL,
        reason TEXT NOT NULL,
        actor TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(rule_id, version),
        FOREIGN KEY(rule_id) REFERENCES automation_rules(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS automation_events (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        title TEXT NOT NULL,
        sender_json TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        risk_json TEXT NOT NULL,
        status TEXT NOT NULL,
        dedupe_key TEXT NOT NULL,
        received_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(source_id, dedupe_key),
        FOREIGN KEY(source_id) REFERENCES automation_sources(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_automation_events_received ON automation_events(received_at DESC);

      CREATE TABLE IF NOT EXISTS automation_runs (
        id TEXT PRIMARY KEY,
        rule_id TEXT,
        event_id TEXT,
        status TEXT NOT NULL,
        matched INTEGER NOT NULL,
        reason TEXT NOT NULL,
        template_id TEXT,
        session_id TEXT,
        result_json TEXT NOT NULL,
        error TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(rule_id) REFERENCES automation_rules(id) ON DELETE SET NULL,
        FOREIGN KEY(event_id) REFERENCES automation_events(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_automation_runs_created ON automation_runs(created_at DESC);

      CREATE TABLE IF NOT EXISTS automation_mail_sender_policies (
        sender_key TEXT PRIMARY KEY,
        policy TEXT NOT NULL,
        origin TEXT NOT NULL,
        reason TEXT NOT NULL,
        daily_limit INTEGER,
        safe_count INTEGER NOT NULL,
        violation_count INTEGER NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_automation_mail_policies_updated
        ON automation_mail_sender_policies(updated_at DESC);

      CREATE TABLE IF NOT EXISTS automation_mail_usage (
        day TEXT NOT NULL,
        scope_key TEXT NOT NULL,
        received_count INTEGER NOT NULL,
        dispatched_count INTEGER NOT NULL,
        suppressed_count INTEGER NOT NULL,
        risk_count INTEGER NOT NULL,
        first_received_at TEXT NOT NULL,
        last_received_at TEXT NOT NULL,
        PRIMARY KEY(day, scope_key)
      );
      CREATE INDEX IF NOT EXISTS idx_automation_mail_usage_day
        ON automation_mail_usage(day, last_received_at DESC);

      CREATE TABLE IF NOT EXISTS automation_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        purpose TEXT NOT NULL,
        source_fingerprint TEXT NOT NULL,
        runtime TEXT NOT NULL,
        version INTEGER NOT NULL,
        status TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        code_object_id TEXT NOT NULL,
        success_count INTEGER NOT NULL,
        failure_count INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_automation_templates_fingerprint ON automation_templates(source_fingerprint, status);

      CREATE TABLE IF NOT EXISTS data_operations (
        id TEXT PRIMARY KEY,
        actor TEXT NOT NULL,
        session_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        sql_hash TEXT NOT NULL,
        operation_kind TEXT NOT NULL,
        status TEXT NOT NULL,
        snapshot_id TEXT,
        schema_changed INTEGER NOT NULL,
        error TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_data_operations_created ON data_operations(created_at DESC);

      CREATE TABLE IF NOT EXISTS data_catalog_metadata (
        object_name TEXT NOT NULL,
        field_name TEXT NOT NULL,
        display_name TEXT NOT NULL,
        description TEXT NOT NULL,
        sensitivity TEXT NOT NULL,
        display_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(object_name, field_name)
      );

      CREATE TABLE IF NOT EXISTS private_file_batches (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_private_file_batches_session
        ON private_file_batches(session_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS private_file_batch_items (
        batch_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        reference_name TEXT NOT NULL,
        file_name TEXT NOT NULL,
        file_kind TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        PRIMARY KEY(batch_id, position),
        FOREIGN KEY(batch_id) REFERENCES private_file_batches(id) ON DELETE CASCADE
      );
    `);
    this.archiveLegacyMemoryTable();
    this.migrateJsonStateIfNeeded();
    this.backfillTokenUsageDailyIfNeeded();
    this.enforceSessionRoleInvariants();
  }

  close() {
    this.db.close();
  }

  pruneHistory({ retentionDays = 30, vacuum = false, now = new Date() } = {}) {
    const days = Math.min(Math.max(Number.parseInt(String(retentionDays), 10) || 30, 7), 365);
    const current = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
    const cutoff = new Date(current.getTime() - days * 86400000).toISOString();
    const changes = {};
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const row of this.db.prepare(`
        SELECT id, created_at, metadata_json FROM sessions
        WHERE role = 'main' AND cli_session_id IS NOT NULL AND status NOT IN ('start', 'running')
      `).all()) {
        const metadata = fromJson(row.metadata_json, {});
        const threadStartedAt = String(metadata.cliThreadStartedAt || row.created_at || "");
        if (!threadStartedAt || threadStartedAt >= cutoff) continue;
        metadata.previousCliSessionRotatedAt = current.toISOString();
        delete metadata.cliThreadStartedAt;
        this.db.prepare("UPDATE sessions SET cli_session_id = NULL, metadata_json = ? WHERE id = ?")
          .run(toJson(metadata), row.id);
        changes.rotatedMainThreads = (changes.rotatedMainThreads || 0) + 1;
      }
      changes.events = this.db.prepare("DELETE FROM events WHERE created_at < ?").run(cutoff).changes;
      changes.commands = this.db.prepare("DELETE FROM commands WHERE created_at < ?").run(cutoff).changes;
      changes.pendingNotifications = this.db.prepare("DELETE FROM pending_wechat_notifications WHERE created_at < ?").run(cutoff).changes;
      changes.privateFileBatches = this.db.prepare("DELETE FROM private_file_batches WHERE created_at < ?").run(cutoff).changes;
      changes.automationRuns = this.db.prepare("DELETE FROM automation_runs WHERE created_at < ?").run(cutoff).changes;
      changes.tokenThreads = this.db.prepare("DELETE FROM token_usage WHERE updated_at < ?").run(cutoff).changes;
      const dailyCutoff = new Date(current.getTime() - 183 * 86400000).toISOString().slice(0, 10);
      changes.tokenDays = this.db.prepare("DELETE FROM token_usage_daily WHERE day < ?").run(dailyCutoff).changes;
      changes.sessions = this.db.prepare(`
        DELETE FROM sessions
        WHERE role = 'worker' AND updated_at < ? AND status NOT IN ('start', 'running')
      `).run(cutoff).changes;
      changes.orphanCommands = this.db.prepare("DELETE FROM commands WHERE session_id NOT IN (SELECT id FROM sessions)").run().changes;
      changes.orphanNotifications = this.db.prepare("DELETE FROM pending_wechat_notifications WHERE session_id NOT IN (SELECT id FROM sessions)").run().changes;
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    const changed = Object.values(changes).reduce((total, value) => total + Number(value || 0), 0);
    if (changed) {
      this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      if (vacuum) this.db.exec("VACUUM");
    }
    return { retentionDays: days, cutoff, changed, ...changes };
  }

  listSessions({ includeArchived = false } = {}) {
    const rows = includeArchived
      ? this.db.prepare("SELECT * FROM sessions ORDER BY updated_at DESC, id DESC").all()
      : this.db.prepare("SELECT * FROM sessions WHERE status != 'archived' ORDER BY updated_at DESC, id DESC").all();
    return rows.map((row) => this.hydrateSession(row.id)).filter(Boolean);
  }

  listMainSessions({ includeArchived = false } = {}) {
    const rows = includeArchived
      ? this.db.prepare("SELECT id FROM sessions WHERE role = 'main' ORDER BY updated_at DESC, id DESC").all()
      : this.db.prepare("SELECT id FROM sessions WHERE role = 'main' AND status != 'archived' ORDER BY updated_at DESC, id DESC").all();
    return rows.map((row) => this.hydrateSession(row.id)).filter(Boolean);
  }

  hasCompletedLocalConversation() {
    const row = this.db.prepare(`
      SELECT 1
      FROM events AS event
      INNER JOIN sessions AS session ON session.id = event.session_id
      WHERE event.kind = 'session.assistant_message'
        AND LENGTH(TRIM(COALESCE(json_extract(event.payload_json, '$.content'), ''))) > 0
        AND (
          json_extract(event.payload_json, '$.metadata.streamState') IS NULL
          OR json_extract(event.payload_json, '$.metadata.streamState') = 'completed'
        )
        AND (
          (session.role = 'main' AND session.channel = 'desktop')
          OR (
            session.role = 'worker'
            AND (session.channel IS NULL OR session.channel = '')
            AND json_extract(session.metadata_json, '$.createdBy') IN ('api', 'web')
          )
        )
      LIMIT 1
    `).get();
    return Boolean(row);
  }

  listRecoverableWorkerSessions() {
    return this.db.prepare(`
      SELECT * FROM sessions
      WHERE role = 'worker'
        AND parent_session_id IS NOT NULL
        AND status IN ('start', 'running')
      ORDER BY created_at ASC, id ASC
    `).all().map((row) => this.getSessionRecord(row.id)).filter(Boolean);
  }

  listSessionsPage({ includeArchived = false, limit = 20, cursor = "", query = "", hydrate = true } = {}) {
    const pageSize = Math.min(Math.max(Number(limit) || 20, 1), 50);
    const search = String(query || "").trim().slice(0, 200);
    const where = [];
    const params = [];
    if (!includeArchived) where.push("status != 'archived'");
    if (search) {
      const pattern = `%${escapeSqlLike(search)}%`;
      where.push("(title LIKE ? ESCAPE '\\' OR workspace_root LIKE ? ESCAPE '\\' OR status LIKE ? ESCAPE '\\' OR metadata_json LIKE ? ESCAPE '\\')");
      params.push(pattern, pattern, pattern, pattern);
    }
    const decodedCursor = decodeSessionCursor(cursor);
    if (decodedCursor) {
      where.push("(updated_at < ? OR (updated_at = ? AND id < ?))");
      params.push(decodedCursor.updatedAt, decodedCursor.updatedAt, decodedCursor.id);
    }
    const whereSql = where.length ? ` WHERE ${where.join(" AND ")}` : "";
    const rows = this.db.prepare(`
      SELECT * FROM sessions${whereSql}
      ORDER BY updated_at DESC, id DESC
      LIMIT ?
    `).all(...params, pageSize + 1);
    const hasMore = rows.length > pageSize;
    const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
    const last = pageRows.at(-1);
    return {
      sessions: pageRows.map((row) => hydrate ? this.hydrateSession(row.id) : this.summarizeSessionRow(row)).filter(Boolean),
      nextCursor: hasMore && last ? encodeSessionCursor(last.updated_at, last.id) : "",
      hasMore,
    };
  }

  countSessions({ includeArchived = false } = {}) {
    const sql = includeArchived
      ? "SELECT COUNT(*) AS count FROM sessions"
      : "SELECT COUNT(*) AS count FROM sessions WHERE status != 'archived'";
    return Number(this.db.prepare(sql).get()?.count || 0);
  }

  getSession(id) {
    const row = this.getSessionRow(id);
    return row ? this.hydrateSession(row.id) : null;
  }

  getSessionSummary(id) {
    const row = this.getSessionRow(id);
    return row ? this.summarizeSessionRow(row) : null;
  }

  getSessionRecord(id) {
    const row = this.getSessionRow(id);
    if (!row) return null;
    const session = rowToSession(row);
    return { ...session, path: this.sessionPath(row.id), ...this.sessionAccess(row.id, session.role) };
  }

  summarizeSessionRow(row) {
    const session = rowToSession(row);
    const access = this.sessionAccess(session.id, session.role);
    return {
      ...session,
      path: this.sessionPath(session.id),
      ...access,
      eventCount: Number(this.db.prepare("SELECT COUNT(*) AS count FROM events WHERE session_id = ?").get(session.id)?.count || 0),
      childSessionCount: Number(this.db.prepare("SELECT COUNT(*) AS count FROM sessions WHERE parent_session_id = ?").get(session.id)?.count || 0),
    };
  }

  createSession(input = {}) {
    return this.createSessionRecord({ ...input, role: "worker" });
  }

  createSessionRecord(input = {}) {
    const now = new Date().toISOString();
    const id = input.id || `sess_${crypto.randomBytes(8).toString("hex")}`;
    const session = {
      id,
      role: input.role === "main" ? "main" : "worker",
      parentSessionId: input.parentSessionId || null,
      channel: input.channel || null,
      senderId: input.senderId || null,
      senderName: input.senderName || null,
      workspaceRoot: input.workspaceRoot || process.cwd(),
      agentType: input.agentType || "codex",
      agentAlias: input.agentAlias || "codex",
      status: normalizeStatus(input.status || "start"),
      title: input.title || titleFromTask(input.taskDescription || input.content || "新会话"),
      taskDescription: input.taskDescription || input.content || "",
      summary: input.summary || "",
      cliSessionId: input.cliSessionId || null,
      createdAt: input.createdAt || now,
      updatedAt: input.updatedAt || now,
      metadata: input.metadata || {},
    };
    this.insertSession(session);
    return this.hydrateSession(id);
  }

  getOrCreateMainSessionForChannel({ channel, senderId, senderName, workspaceRoot }) {
    const normalizedChannel = String(channel || "").trim().toLowerCase();
    const normalizedSenderId = String(senderId || "").trim();
    if (!isMainConversationChannel(normalizedChannel)) throw new Error("only WeChat channels can own a main session");
    if (!normalizedSenderId) throw new Error("WeChat senderId is required for a main session");
    const key = `${normalizedChannel}:${normalizedSenderId}`;
    const existing = this.db.prepare("SELECT session_id FROM channel_sessions WHERE key = ?").get(key);
    let existingRow = existing?.session_id ? this.getSessionRow(existing.session_id) : null;
    if (!existingRow) {
      existingRow = this.db.prepare(`
        SELECT * FROM sessions
        WHERE role = 'main' AND channel = ? AND sender_id = ?
        ORDER BY updated_at DESC, id DESC
        LIMIT 1
      `).get(normalizedChannel, normalizedSenderId);
      if (existingRow) {
        this.db.prepare("INSERT OR REPLACE INTO channel_sessions (key, session_id, updated_at) VALUES (?, ?, ?)")
          .run(key, existingRow.id, new Date().toISOString());
      }
    }
    if (!existingRow) {
      existingRow = this.db.prepare(`
        SELECT * FROM sessions
        WHERE role = 'main' AND channel = 'desktop'
        ORDER BY updated_at DESC, id DESC
        LIMIT 1
      `).get();
      if (existingRow) {
        const current = rowToSession(existingRow);
        this.upsertSession({
          ...current,
          channel: normalizedChannel,
          senderId: normalizedSenderId,
          senderName: senderName || current.senderName,
          title: current.title || "与 PA 的对话",
          updatedAt: new Date().toISOString(),
          metadata: {
            ...current.metadata,
            channelSessionKey: key,
            desktopConversationBoundAt: new Date().toISOString(),
          },
        });
        existingRow = this.getSessionRow(existingRow.id);
        this.db.prepare("INSERT OR REPLACE INTO channel_sessions (key, session_id, updated_at) VALUES (?, ?, ?)")
          .run(key, existingRow.id, new Date().toISOString());
      }
    }
    if (existingRow && existingRow.role === "main" && existingRow.channel === normalizedChannel && existingRow.sender_id === normalizedSenderId) {
      const session = rowToSession(existingRow);
      const nextWorkspaceRoot = String(workspaceRoot || "").trim();
      const workspaceChanged = Boolean(nextWorkspaceRoot && nextWorkspaceRoot !== session.workspaceRoot);
      this.updateSession(existingRow.id, {
        senderName: senderName || session.senderName,
        ...(workspaceChanged ? {
          workspaceRoot: nextWorkspaceRoot,
          cliSessionId: null,
          metadata: {
            ...session.metadata,
            previousWorkspaceRoot: session.workspaceRoot,
            workspaceReboundAt: new Date().toISOString(),
          },
        } : {}),
        updatedAt: new Date().toISOString(),
      });
      return this.getSessionRecord(existingRow.id);
    }
    if (existing?.session_id) this.db.prepare("DELETE FROM channel_sessions WHERE key = ?").run(key);

    const session = this.createSessionRecord({
      role: "main",
      channel: normalizedChannel,
      senderId: normalizedSenderId,
      senderName,
      workspaceRoot,
      title: `${senderName || senderId} 主会话`,
      taskDescription: `${normalizedChannel} main dispatcher session`,
      status: "idle",
      metadata: { channelSessionKey: key },
    });
    this.db.prepare("INSERT OR REPLACE INTO channel_sessions (key, session_id, updated_at) VALUES (?, ?, ?)")
      .run(key, session.id, new Date().toISOString());
    return this.getSessionRecord(session.id);
  }

  getOrCreateDesktopMainSession({ workspaceRoot } = {}) {
    const existingRow = this.db.prepare(`
      SELECT * FROM sessions
      WHERE role = 'main'
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
    `).get();
    if (existingRow) return this.getSessionRecord(existingRow.id);
    return this.createSessionRecord({
      role: "main",
      channel: "desktop",
      senderId: "local-owner",
      senderName: "本机用户",
      workspaceRoot,
      title: "与 PA 的对话",
      taskDescription: "Personal Agent main conversation",
      status: "idle",
      metadata: { createdBy: "desktop" },
    });
  }

  updateSession(id, patch = {}) {
    const current = this.getSessionRow(id);
    if (!current) return null;
    const currentSession = rowToSession(current);
    const session = {
      ...currentSession,
      ...patch,
    };
    const validMainIdentity = session.senderId && (isMainConversationChannel(session.channel) || session.channel === "desktop");
    session.role = currentSession.role === "main" && validMainIdentity ? "main" : "worker";
    if (patch.status) session.status = normalizeStatus(patch.status);
    session.updatedAt = patch.updatedAt || new Date().toISOString();
    this.upsertSession(session);
    return this.getSessionRecord(id);
  }

  enforceSessionRoleInvariants() {
    this.db.prepare(`
      UPDATE sessions
      SET role = 'worker'
      WHERE role = 'main'
        AND (
          channel IS NULL
          OR channel NOT IN ('wechat', 'wechat-personal', 'desktop')
          OR sender_id IS NULL
          OR TRIM(sender_id) = ''
        )
    `).run();
    this.db.prepare("DELETE FROM channel_sessions WHERE key NOT LIKE 'wechat:%' AND key NOT LIKE 'wechat-personal:%'").run();

    const duplicates = this.db.prepare(`
      SELECT channel, sender_id
      FROM sessions
      WHERE role = 'main' AND channel IN ('wechat', 'wechat-personal')
      GROUP BY channel, sender_id
      HAVING COUNT(*) > 1
    `).all();
    for (const duplicate of duplicates) {
      const key = `${duplicate.channel}:${duplicate.sender_id}`;
      const mapped = this.db.prepare("SELECT session_id FROM channel_sessions WHERE key = ?").get(key)?.session_id;
      const candidates = this.db.prepare(`
        SELECT id FROM sessions
        WHERE role = 'main' AND channel = ? AND sender_id = ?
        ORDER BY updated_at DESC, id DESC
      `).all(duplicate.channel, duplicate.sender_id);
      const retained = candidates.some((candidate) => candidate.id === mapped) ? mapped : candidates[0]?.id;
      if (!retained) continue;
      this.db.prepare(`
        UPDATE sessions SET role = 'worker'
        WHERE role = 'main' AND channel = ? AND sender_id = ? AND id != ?
      `).run(duplicate.channel, duplicate.sender_id, retained);
      this.db.prepare("INSERT OR REPLACE INTO channel_sessions (key, session_id, updated_at) VALUES (?, ?, ?)")
        .run(key, retained, new Date().toISOString());
    }

    for (const main of this.db.prepare(`
      SELECT id, channel, sender_id FROM sessions
      WHERE role = 'main' AND channel IN ('wechat', 'wechat-personal')
    `).all()) {
      this.db.prepare("INSERT OR REPLACE INTO channel_sessions (key, session_id, updated_at) VALUES (?, ?, ?)")
        .run(`${main.channel}:${main.sender_id}`, main.id, new Date().toISOString());
    }

    const desktopMains = this.db.prepare(`
      SELECT id FROM sessions
      WHERE role = 'main' AND channel = 'desktop'
      ORDER BY updated_at DESC, id DESC
    `).all();
    for (const duplicate of desktopMains.slice(1)) {
      this.db.prepare("UPDATE sessions SET role = 'worker' WHERE id = ?").run(duplicate.id);
    }

    this.db.prepare(`
      DELETE FROM channel_sessions
      WHERE session_id NOT IN (
        SELECT id FROM sessions WHERE role = 'main' AND channel IN ('wechat', 'wechat-personal')
      )
    `).run();
    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_wechat_main_sender
      ON sessions(sender_id)
      WHERE role = 'main' AND channel = 'wechat'
    `);
    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_wechat_personal_main_sender
      ON sessions(sender_id)
      WHERE role = 'main' AND channel = 'wechat-personal'
    `);
    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_desktop_main
      ON sessions(channel)
      WHERE role = 'main' AND channel = 'desktop'
    `);
  }

  appendEvent(sessionId, kind, payload = {}) {
    const sessionRow = this.getSessionRow(sessionId);
    if (!sessionRow) throw new Error(`unknown session: ${sessionId}`);
    const now = payload.createdAt || new Date().toISOString();
    const seqRow = this.db.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM events WHERE session_id = ?").get(sessionId);
    const seq = Number(seqRow?.seq || 1);
    const event = {
      id: `evt_${crypto.randomBytes(8).toString("hex")}`,
      sessionId,
      seq,
      kind,
      payload: sanitizePayload(payload),
      createdAt: now,
    };
    this.db.prepare(`
      INSERT INTO events (id, session_id, seq, kind, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(event.id, event.sessionId, event.seq, event.kind, toJson(event.payload), event.createdAt);

    if (event.kind === "session.token_usage") {
      this.upsertTokenUsage(event);
    }

    const session = rowToSession(sessionRow);
    applyEventToSession(session, event);
    this.upsertSession(session);
    return event;
  }

  listEvents(sessionId, { afterSeq = 0 } = {}) {
    return this.db.prepare(`
      SELECT * FROM events WHERE session_id = ? AND seq > ? ORDER BY seq ASC
    `).all(sessionId, Number(afterSeq || 0)).map(rowToEvent);
  }

  getLatestEvent(sessionId, kinds = []) {
    const normalizedKinds = Array.isArray(kinds) ? kinds.map(String).filter(Boolean) : [];
    if (!normalizedKinds.length) {
      const row = this.db.prepare("SELECT * FROM events WHERE session_id = ? ORDER BY seq DESC LIMIT 1").get(sessionId);
      return row ? rowToEvent(row) : null;
    }
    const placeholders = normalizedKinds.map(() => "?").join(", ");
    const row = this.db.prepare(`
      SELECT * FROM events
      WHERE session_id = ? AND kind IN (${placeholders})
      ORDER BY seq DESC LIMIT 1
    `).get(sessionId, ...normalizedKinds);
    return row ? rowToEvent(row) : null;
  }

  getTokenUsageSummary({ limit = 8, range = "today" } = {}) {
    const normalizedRange = normalizeTokenRange(range);
    const cutoffDay = tokenRangeCutoffDay(normalizedRange);
    const aggregate = cutoffDay ? this.db.prepare(`
      SELECT
        COALESCE(SUM(input_tokens), 0) AS input_tokens,
        COALESCE(SUM(cached_input_tokens), 0) AS cached_input_tokens,
        COALESCE(SUM(output_tokens), 0) AS output_tokens,
        COALESCE(SUM(reasoning_output_tokens), 0) AS reasoning_output_tokens,
        COALESCE(SUM(total_tokens), 0) AS total_tokens,
        COALESCE(SUM(request_count), 0) AS request_count,
        MAX(updated_at) AS updated_at
      FROM token_usage_daily
      WHERE day >= ?
    `).get(cutoffDay) : this.db.prepare(`
      SELECT
        COALESCE(SUM(input_tokens), 0) AS input_tokens,
        COALESCE(SUM(cached_input_tokens), 0) AS cached_input_tokens,
        COALESCE(SUM(output_tokens), 0) AS output_tokens,
        COALESCE(SUM(reasoning_output_tokens), 0) AS reasoning_output_tokens,
        COALESCE(SUM(total_tokens), 0) AS total_tokens,
        COUNT(DISTINCT session_id) AS session_count,
        COUNT(*) AS thread_count,
        0 AS request_count,
        MAX(updated_at) AS updated_at
      FROM token_usage
    `).get();
    const lifetimeCounts = this.db.prepare(`
      SELECT COUNT(DISTINCT session_id) AS session_count, COUNT(*) AS thread_count FROM token_usage
    `).get() || {};
    const requestCount = cutoffDay
      ? Number(aggregate?.request_count || 0)
      : Number(this.db.prepare("SELECT COALESCE(SUM(request_count), 0) AS count FROM token_usage_daily").get()?.count || 0);
    const recentLimit = Math.min(Math.max(Number(limit) || 8, 1), 20);
    const recentSessions = this.db.prepare(`
      SELECT
        usage.session_id,
        sessions.title,
        sessions.workspace_root,
        SUM(usage.input_tokens) AS input_tokens,
        SUM(usage.cached_input_tokens) AS cached_input_tokens,
        SUM(usage.output_tokens) AS output_tokens,
        SUM(usage.reasoning_output_tokens) AS reasoning_output_tokens,
        SUM(usage.total_tokens) AS total_tokens,
        COUNT(*) AS thread_count,
        MAX(usage.updated_at) AS updated_at
      FROM token_usage AS usage
      JOIN sessions ON sessions.id = usage.session_id
      GROUP BY usage.session_id, sessions.title, sessions.workspace_root
      ORDER BY updated_at DESC, usage.session_id DESC
      LIMIT ?
    `).all(recentLimit).map(rowToTokenUsageSession);
    return {
      inputTokens: Number(aggregate.input_tokens || 0),
      cachedInputTokens: Number(aggregate.cached_input_tokens || 0),
      outputTokens: Number(aggregate.output_tokens || 0),
      reasoningOutputTokens: Number(aggregate.reasoning_output_tokens || 0),
      totalTokens: Number(aggregate.total_tokens || 0),
      sessionCount: Number(lifetimeCounts.session_count || 0),
      threadCount: Number(lifetimeCounts.thread_count || 0),
      requestCount,
      cacheRate: Number(aggregate.input_tokens || 0) > 0
        ? Math.round((Number(aggregate.cached_input_tokens || 0) / Number(aggregate.input_tokens || 0)) * 100)
        : 0,
      updatedAt: aggregate.updated_at || null,
      recentSessions,
      range: normalizedRange,
      dailyUsage: this.listTokenUsageDays(84),
    };
  }

  listTokenUsageDays(days = 84) {
    const count = Math.min(Math.max(Number(days) || 84, 7), 183);
    const endDay = shanghaiDayKey(new Date());
    const end = new Date(`${endDay}T00:00:00.000Z`);
    const start = new Date(end.getTime() - (count - 1) * 86400000);
    const startDay = start.toISOString().slice(0, 10);
    const values = new Map(this.db.prepare(`
      SELECT day, total_tokens, request_count FROM token_usage_daily WHERE day >= ? ORDER BY day ASC
    `).all(startDay).map((row) => [row.day, {
      totalTokens: Number(row.total_tokens || 0),
      requestCount: Number(row.request_count || 0),
    }]));
    return Array.from({ length: count }, (_, index) => {
      const day = new Date(start.getTime() + index * 86400000).toISOString().slice(0, 10);
      return { day, totalTokens: values.get(day)?.totalTokens || 0, requestCount: values.get(day)?.requestCount || 0 };
    });
  }

  createPrivateFileBatch({ sessionId, attachments = [], createdAt } = {}) {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId || !this.getSessionRow(normalizedSessionId)) throw new Error("valid sessionId is required");
    const items = attachments.slice(0, 100).map((attachment, index) => ({
      position: index + 1,
      referenceName: normalizePrivateFileText(attachment.referenceName, 40, `文件${index + 1}`),
      fileName: normalizePrivateFileText(attachment.fileName || attachment.displayName, 180, `微信文件-${index + 1}`),
      kind: attachment.kind === "image" ? "image" : "file",
      relativePath: normalizePrivateRelativePath(attachment.relativePath),
      sizeBytes: Math.max(Number(attachment.sizeBytes ?? attachment.size) || 0, 0),
    }));
    if (!items.length) throw new Error("private file batch requires at least one attachment");
    const timestamp = createdAt || new Date().toISOString();
    const dayStart = `${timestamp.slice(0, 10)}T00:00:00.000Z`;
    const sequence = Number(this.db.prepare(`
      SELECT COUNT(*) AS count FROM private_file_batches
      WHERE session_id = ? AND created_at >= ?
    `).get(normalizedSessionId, dayStart)?.count || 0) + 1;
    const id = `files_${crypto.randomBytes(10).toString("hex")}`;
    const date = new Date(timestamp);
    const dateLabel = Number.isNaN(date.getTime())
      ? "本次"
      : new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric" }).format(date);
    const title = `${dateLabel}文件包 ${String(sequence).padStart(2, "0")}`;

    this.db.exec("BEGIN");
    try {
      this.db.prepare("INSERT INTO private_file_batches (id, session_id, title, created_at) VALUES (?, ?, ?, ?)")
        .run(id, normalizedSessionId, title, timestamp);
      const insert = this.db.prepare(`
        INSERT INTO private_file_batch_items (
          batch_id, position, reference_name, file_name, file_kind, relative_path, size_bytes
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const item of items) {
        insert.run(id, item.position, item.referenceName, item.fileName, item.kind, item.relativePath, item.sizeBytes);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.getPrivateFileBatch(id);
  }

  getPrivateFileBatch(id) {
    const batch = this.db.prepare("SELECT * FROM private_file_batches WHERE id = ?").get(String(id || ""));
    if (!batch) return null;
    const items = this.db.prepare(`
      SELECT * FROM private_file_batch_items WHERE batch_id = ? ORDER BY position ASC
    `).all(batch.id).map((row) => ({
      position: Number(row.position),
      referenceName: row.reference_name,
      fileName: row.file_name,
      kind: row.file_kind,
      relativePath: row.relative_path,
      sizeBytes: Number(row.size_bytes || 0),
    }));
    return {
      id: batch.id,
      sessionId: batch.session_id,
      title: batch.title,
      createdAt: batch.created_at,
      items,
    };
  }

  upsertTokenUsage(event) {
    const metadata = event.payload?.metadata && typeof event.payload.metadata === "object" ? event.payload.metadata : {};
    const tokenUsage = event.payload?.tokenUsage || metadata.tokenUsage;
    const threadId = String(event.payload?.threadId || metadata.threadId || "").trim();
    if (!threadId || !tokenUsage || typeof tokenUsage !== "object") return;
    const total = normalizeTokenBreakdown(tokenUsage.total);
    const last = normalizeTokenBreakdown(tokenUsage.last);
    const contextWindow = finiteTokenCount(tokenUsage.modelContextWindow, null);
    const previousRow = this.db.prepare(`
      SELECT input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens, total_tokens
      FROM token_usage WHERE session_id = ? AND thread_id = ?
    `).get(event.sessionId, threadId);
    this.recordTokenUsageDaily(event, total, previousRow ? {
      inputTokens: Number(previousRow.input_tokens || 0),
      cachedInputTokens: Number(previousRow.cached_input_tokens || 0),
      outputTokens: Number(previousRow.output_tokens || 0),
      reasoningOutputTokens: Number(previousRow.reasoning_output_tokens || 0),
      totalTokens: Number(previousRow.total_tokens || 0),
    } : null);
    this.db.prepare(`
      INSERT INTO token_usage (
        session_id, thread_id, input_tokens, cached_input_tokens,
        output_tokens, reasoning_output_tokens, total_tokens,
        last_input_tokens, last_cached_input_tokens, last_output_tokens,
        last_reasoning_output_tokens, last_total_tokens,
        model_context_window, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, thread_id) DO UPDATE SET
        input_tokens = excluded.input_tokens,
        cached_input_tokens = excluded.cached_input_tokens,
        output_tokens = excluded.output_tokens,
        reasoning_output_tokens = excluded.reasoning_output_tokens,
        total_tokens = excluded.total_tokens,
        last_input_tokens = excluded.last_input_tokens,
        last_cached_input_tokens = excluded.last_cached_input_tokens,
        last_output_tokens = excluded.last_output_tokens,
        last_reasoning_output_tokens = excluded.last_reasoning_output_tokens,
        last_total_tokens = excluded.last_total_tokens,
        model_context_window = excluded.model_context_window,
        updated_at = excluded.updated_at
    `).run(
      event.sessionId,
      threadId,
      total.inputTokens,
      total.cachedInputTokens,
      total.outputTokens,
      total.reasoningOutputTokens,
      total.totalTokens,
      last.inputTokens,
      last.cachedInputTokens,
      last.outputTokens,
      last.reasoningOutputTokens,
      last.totalTokens,
      contextWindow,
      event.createdAt,
    );
  }

  recordTokenUsageDaily(event, total, previous = null) {
    const delta = {
      inputTokens: tokenCounterDelta(total.inputTokens, previous?.inputTokens),
      cachedInputTokens: tokenCounterDelta(total.cachedInputTokens, previous?.cachedInputTokens),
      outputTokens: tokenCounterDelta(total.outputTokens, previous?.outputTokens),
      reasoningOutputTokens: tokenCounterDelta(total.reasoningOutputTokens, previous?.reasoningOutputTokens),
      totalTokens: tokenCounterDelta(total.totalTokens, previous?.totalTokens),
    };
    if (!delta.totalTokens && !delta.inputTokens && !delta.outputTokens) return;
    const updatedAt = event.createdAt || new Date().toISOString();
    const day = shanghaiDayKey(new Date(updatedAt));
    this.db.prepare(`
      INSERT INTO token_usage_daily (
        day, input_tokens, cached_input_tokens, output_tokens,
        reasoning_output_tokens, total_tokens, request_count, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
      ON CONFLICT(day) DO UPDATE SET
        input_tokens = input_tokens + excluded.input_tokens,
        cached_input_tokens = cached_input_tokens + excluded.cached_input_tokens,
        output_tokens = output_tokens + excluded.output_tokens,
        reasoning_output_tokens = reasoning_output_tokens + excluded.reasoning_output_tokens,
        total_tokens = total_tokens + excluded.total_tokens,
        request_count = request_count + 1,
        updated_at = excluded.updated_at
    `).run(
      day,
      delta.inputTokens,
      delta.cachedInputTokens,
      delta.outputTokens,
      delta.reasoningOutputTokens,
      delta.totalTokens,
      updatedAt,
    );
  }

  backfillTokenUsageDailyIfNeeded() {
    const count = Number(this.db.prepare("SELECT COUNT(*) AS count FROM token_usage_daily").get()?.count || 0);
    if (count) return;
    const previousByThread = new Map();
    const rows = this.db.prepare(`
      SELECT * FROM events WHERE kind = 'session.token_usage' ORDER BY created_at ASC, session_id ASC, seq ASC
    `).all();
    for (const row of rows) {
      const event = rowToEvent(row);
      const metadata = event.payload?.metadata && typeof event.payload.metadata === "object" ? event.payload.metadata : {};
      const tokenUsage = event.payload?.tokenUsage || metadata.tokenUsage;
      const threadId = String(event.payload?.threadId || metadata.threadId || "").trim();
      if (!threadId || !tokenUsage?.total) continue;
      const total = normalizeTokenBreakdown(tokenUsage.total);
      const key = `${event.sessionId}:${threadId}`;
      this.recordTokenUsageDaily(event, total, previousByThread.get(key) || null);
      previousByThread.set(key, total);
    }
  }

  setLastWechatRecipient(recipientId) {
    if (!recipientId) return;
    this.db.prepare(`
      INSERT INTO channel_state (channel, last_recipient_id, updated_at)
      VALUES ('wechat', ?, ?)
      ON CONFLICT(channel) DO UPDATE SET
        last_recipient_id = excluded.last_recipient_id,
        updated_at = excluded.updated_at
    `).run(recipientId, new Date().toISOString());
  }

  getLastWechatRecipient() {
    const row = this.db.prepare("SELECT last_recipient_id FROM channel_state WHERE channel = 'wechat'").get();
    return row?.last_recipient_id || "";
  }

  enqueuePendingWechatNotification(input = {}) {
    const sessionId = String(input.sessionId || "").trim();
    const recipientId = String(input.recipientId || "").trim();
    const content = String(input.content || "").trim();
    if (!sessionId || !recipientId || !content) return null;
    const notificationKey = String(input.notificationKey || "").trim() || crypto
      .createHash("sha256")
      .update(`${sessionId}\0${content}`)
      .digest("hex");
    const id = `pwn_${crypto.randomBytes(8).toString("hex")}`;
    const createdAt = new Date().toISOString();
    this.db.prepare(`
      INSERT OR IGNORE INTO pending_wechat_notifications (
        id, session_id, recipient_id, content, notification_key, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, sessionId, recipientId, content, notificationKey, createdAt);

    const overflow = this.db.prepare(`
      SELECT id FROM pending_wechat_notifications
      WHERE recipient_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT -1 OFFSET ?
    `).all(recipientId, MAX_PENDING_WECHAT_NOTIFICATIONS);
    const remove = this.db.prepare("DELETE FROM pending_wechat_notifications WHERE id = ?");
    for (const row of overflow) remove.run(row.id);

    return this.db.prepare(`
      SELECT * FROM pending_wechat_notifications
      WHERE recipient_id = ? AND notification_key = ?
    `).get(recipientId, notificationKey) || null;
  }

  listPendingWechatNotifications(recipientId, { limit = MAX_PENDING_WECHAT_NOTIFICATIONS } = {}) {
    const normalizedRecipientId = String(recipientId || "").trim();
    if (!normalizedRecipientId) return [];
    const pageSize = Math.min(Math.max(Number(limit) || MAX_PENDING_WECHAT_NOTIFICATIONS, 1), MAX_PENDING_WECHAT_NOTIFICATIONS);
    return this.db.prepare(`
      SELECT id, session_id AS sessionId, recipient_id AS recipientId,
        content, notification_key AS notificationKey, created_at AS createdAt
      FROM pending_wechat_notifications
      WHERE recipient_id = ?
      ORDER BY created_at ASC, id ASC
      LIMIT ?
    `).all(normalizedRecipientId, pageSize);
  }

  deletePendingWechatNotification(id) {
    return this.db.prepare("DELETE FROM pending_wechat_notifications WHERE id = ?").run(String(id || "")).changes > 0;
  }

  upsertWorkspace(input = {}) {
    const now = new Date().toISOString();
    const name = String(input.name || input.workspaceName || input.workspaceRoot || "default").trim();
    const workspaceRoot = String(input.workspaceRoot || input.workspace || process.cwd()).trim();
    if (!name) throw new Error("workspace name is required");
    const existing = this.db.prepare("SELECT * FROM workspaces WHERE name = ?").get(name);
    const id = existing?.id || `ws_${crypto.randomBytes(8).toString("hex")}`;
    const createdAt = existing?.created_at || input.createdAt || now;
    this.db.prepare(`
      INSERT INTO workspaces (
        id, name, workspace_root, description, routing_tags_json,
        context_summary, app_server_json, agent_command_aliases_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        workspace_root = excluded.workspace_root,
        description = excluded.description,
        routing_tags_json = excluded.routing_tags_json,
        context_summary = excluded.context_summary,
        app_server_json = excluded.app_server_json,
        agent_command_aliases_json = excluded.agent_command_aliases_json,
        updated_at = excluded.updated_at
    `).run(
      id,
      name,
      workspaceRoot,
      String(input.description || ""),
      toJson(Array.isArray(input.routingTags) ? input.routingTags : []),
      String(input.contextSummary || ""),
      toJson(input.appServer || {}),
      toJson(Array.isArray(input.agentCommandAliases) ? input.agentCommandAliases : []),
      createdAt,
      now,
    );
    return this.getWorkspace({ name });
  }

  upsertWorkspacesFromHeartbeat(input = {}) {
    const rows = [];
    const workspaces = Array.isArray(input.workspaces) && input.workspaces.length
      ? input.workspaces
      : [{
          name: input.name,
          workspaceRoot: input.workspaceRoot,
          routingTags: input.routingTags,
          contextSummary: input.contextSummary,
        }];
    for (const workspace of workspaces) {
      rows.push(this.upsertWorkspace({
        ...workspace,
        appServer: input.appServer,
        agentCommandAliases: input.agentCommandAliases,
      }));
    }
    return rows;
  }

  getWorkspace({ name } = {}) {
    const row = this.db.prepare("SELECT * FROM workspaces WHERE name = ?").get(name);
    return row ? rowToWorkspace(row) : null;
  }

  listWorkspaces() {
    const rows = this.db.prepare("SELECT * FROM workspaces ORDER BY updated_at DESC").all();
    return rows.map(rowToWorkspace);
  }

  createCommand(input = {}) {
    const now = new Date().toISOString();
    const command = {
      id: input.id || `cmd_${crypto.randomBytes(8).toString("hex")}`,
      sessionId: input.sessionId,
      commandType: input.commandType,
      status: input.status || "queued",
      payload: input.payload || {},
      result: input.result || {},
      error: input.error || "",
      createdAt: input.createdAt || now,
      updatedAt: input.updatedAt || now,
    };
    if (!command.sessionId) throw new Error("sessionId is required");
    if (!command.commandType) throw new Error("commandType is required");
    this.db.prepare(`
      INSERT INTO commands (
        id, session_id, command_type,
        status, payload_json, result_json, error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      command.id,
      command.sessionId,
      command.commandType,
      command.status,
      toJson(command.payload),
      toJson(command.result),
      command.error,
      command.createdAt,
      command.updatedAt,
    );
    return command;
  }

  updateCommand(id, patch = {}) {
    const current = this.getCommand(id);
    if (!current) return null;
    const command = {
      ...current,
      ...patch,
      payload: patch.payload || current.payload,
      result: patch.result || current.result,
      updatedAt: patch.updatedAt || new Date().toISOString(),
    };
    this.db.prepare(`
      UPDATE commands SET
        status = ?,
        payload_json = ?,
        result_json = ?,
        error = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      command.status,
      toJson(command.payload),
      toJson(command.result),
      command.error || "",
      command.updatedAt,
      id,
    );
    return this.getCommand(id);
  }

  getCommand(id) {
    const row = this.db.prepare("SELECT * FROM commands WHERE id = ?").get(id);
    return row ? rowToCommand(row) : null;
  }

  listCommands({ sessionId } = {}) {
    const rows = sessionId
      ? this.db.prepare("SELECT * FROM commands WHERE session_id = ? ORDER BY created_at ASC").all(sessionId)
      : this.db.prepare("SELECT * FROM commands ORDER BY created_at DESC").all();
    return rows.map(rowToCommand);
  }

  createScheduledTask(input = {}) {
    const now = new Date().toISOString();
    const task = normalizeScheduledTask({
      ...input,
      id: input.id || `task_${crypto.randomBytes(8).toString("hex")}`,
      createdAt: input.createdAt || now,
      updatedAt: input.updatedAt || now,
    });
    this.db.prepare(`
      INSERT INTO scheduled_tasks (
        id, name, cron, timezone, prompt, workspace_name, workspace_root,
        recipient_id, enabled, next_run_at, last_run_at, last_session_id,
        run_count, last_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      task.id,
      task.name,
      task.cron,
      task.timezone,
      task.prompt,
      task.workspaceName,
      task.workspaceRoot,
      task.recipientId,
      task.enabled ? 1 : 0,
      task.nextRunAt,
      task.lastRunAt,
      task.lastSessionId,
      task.runCount,
      task.lastError,
      task.createdAt,
      task.updatedAt,
    );
    return this.getScheduledTask(task.id);
  }

  updateScheduledTask(id, patch = {}) {
    const current = this.getScheduledTask(id);
    if (!current) return null;
    const next = normalizeScheduledTask({
      ...current,
      ...patch,
      updatedAt: patch.updatedAt || new Date().toISOString(),
    });
    this.db.prepare(`
      UPDATE scheduled_tasks SET
        name = ?,
        cron = ?,
        timezone = ?,
        prompt = ?,
        workspace_name = ?,
        workspace_root = ?,
        recipient_id = ?,
        enabled = ?,
        next_run_at = ?,
        last_run_at = ?,
        last_session_id = ?,
        run_count = ?,
        last_error = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      next.name,
      next.cron,
      next.timezone,
      next.prompt,
      next.workspaceName,
      next.workspaceRoot,
      next.recipientId,
      next.enabled ? 1 : 0,
      next.nextRunAt,
      next.lastRunAt,
      next.lastSessionId,
      next.runCount,
      next.lastError,
      next.updatedAt,
      id,
    );
    return this.getScheduledTask(id);
  }

  deleteScheduledTask(id) {
    const current = this.getScheduledTask(id);
    if (!current) return false;
    this.db.prepare("DELETE FROM scheduled_tasks WHERE id = ?").run(id);
    return true;
  }

  getScheduledTask(id) {
    const row = this.db.prepare("SELECT * FROM scheduled_tasks WHERE id = ?").get(id);
    return row ? rowToScheduledTask(row) : null;
  }

  listScheduledTasks({ enabled } = {}) {
    let rows;
    if (enabled === true) {
      rows = this.db.prepare("SELECT * FROM scheduled_tasks WHERE enabled = 1 ORDER BY next_run_at IS NULL, next_run_at ASC, updated_at DESC").all();
    } else if (enabled === false) {
      rows = this.db.prepare("SELECT * FROM scheduled_tasks WHERE enabled = 0 ORDER BY updated_at DESC").all();
    } else {
      rows = this.db.prepare("SELECT * FROM scheduled_tasks ORDER BY enabled DESC, next_run_at IS NULL, next_run_at ASC, updated_at DESC").all();
    }
    return rows.map(rowToScheduledTask);
  }

  hydrateSession(id) {
    const row = this.getSessionRow(id);
    if (!row) return null;
    const session = rowToSession(row);
    const events = this.listEvents(id);
    const access = this.sessionAccess(id, session.role);
    return {
      ...session,
      path: this.sessionPath(id),
      ...access,
      messages: coalesceMessages(events.map(eventToMessage).filter(Boolean)),
      events,
      childSessions: this.db.prepare(`
        SELECT * FROM sessions WHERE parent_session_id = ? ORDER BY updated_at DESC
      `).all(id).map((child) => {
        const childSession = rowToSession(child);
        const childAccess = this.sessionAccess(childSession.id, childSession.role);
        return {
          id: childSession.id,
          role: childSession.role,
          status: childSession.status,
          title: childSession.title,
          taskDescription: childSession.taskDescription,
          updatedAt: childSession.updatedAt,
          path: this.sessionPath(childSession.id),
          ...childAccess,
        };
      }),
    };
  }

  sessionAccess(id, role = "worker") {
    return buildManagedTaskAccess(id, this.externalAccess, { role });
  }

  sessionUrl(id, role = "worker") {
    return this.sessionAccess(id, role).url;
  }

  sessionPath(id) {
    return `/app/chat/session/${encodeURIComponent(id)}/live`;
  }

  sessionLinkNotice(id, role = "worker") {
    return this.sessionAccess(id, role).linkNotice;
  }

  getSessionRow(id) {
    return this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);
  }

  insertSession(session) {
    this.db.prepare(`
      INSERT INTO sessions (
        id, role, parent_session_id, channel, sender_id, sender_name,
        workspace_root, agent_type, agent_alias, status, title,
        task_description, summary, cli_session_id, created_at, updated_at,
        metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      session.id,
      session.role,
      session.parentSessionId,
      session.channel,
      session.senderId,
      session.senderName,
      session.workspaceRoot,
      session.agentType,
      session.agentAlias,
      session.status,
      session.title,
      session.taskDescription,
      session.summary,
      session.cliSessionId,
      session.createdAt,
      session.updatedAt,
      toJson(session.metadata),
    );
  }

  upsertSession(session) {
    this.db.prepare(`
      INSERT INTO sessions (
        id, role, parent_session_id, channel, sender_id, sender_name,
        workspace_root, agent_type, agent_alias, status, title,
        task_description, summary, cli_session_id, created_at, updated_at,
        metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        role = excluded.role,
        parent_session_id = excluded.parent_session_id,
        channel = excluded.channel,
        sender_id = excluded.sender_id,
        sender_name = excluded.sender_name,
        workspace_root = excluded.workspace_root,
        agent_type = excluded.agent_type,
        agent_alias = excluded.agent_alias,
        status = excluded.status,
        title = excluded.title,
        task_description = excluded.task_description,
        summary = excluded.summary,
        cli_session_id = excluded.cli_session_id,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        metadata_json = excluded.metadata_json
    `).run(
      session.id,
      session.role,
      session.parentSessionId,
      session.channel,
      session.senderId,
      session.senderName,
      session.workspaceRoot,
      session.agentType,
      session.agentAlias,
      session.status,
      session.title,
      session.taskDescription,
      session.summary,
      session.cliSessionId,
      session.createdAt,
      session.updatedAt,
      toJson(session.metadata),
    );
  }

  migrateJsonStateIfNeeded() {
    const count = this.db.prepare("SELECT COUNT(*) AS count FROM sessions").get()?.count || 0;
    if (count > 0 || !fs.existsSync(this.stateFile)) return;
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(this.stateFile, "utf8"));
    } catch {
      return;
    }
    const normalized = normalizeJsonState(parsed);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const session of Object.values(normalized.sessions)) {
        this.upsertSession(session);
      }
      for (const [sessionId, events] of Object.entries(normalized.events)) {
        for (const event of events) {
          if (!normalized.sessions[sessionId]) continue;
          this.db.prepare(`
            INSERT OR IGNORE INTO events (id, session_id, seq, kind, payload_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(event.id, event.sessionId, event.seq, event.kind, toJson(event.payload), event.createdAt);
        }
      }
      for (const [key, sessionId] of Object.entries(normalized.channelSessions)) {
        if (!normalized.sessions[sessionId]) continue;
        this.db.prepare("INSERT OR REPLACE INTO channel_sessions (key, session_id, updated_at) VALUES (?, ?, ?)")
          .run(key, sessionId, new Date().toISOString());
      }
      const wechat = normalized.channels.wechat;
      if (wechat.lastRecipientId) this.db.prepare(`
        INSERT OR REPLACE INTO channel_state (channel, last_recipient_id, updated_at)
        VALUES ('wechat', ?, ?)
      `).run(wechat.lastRecipientId, wechat.updatedAt || new Date().toISOString());
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  upsertAutomationSource(input = {}) {
    const source = normalizeAutomationSource(input);
    this.db.prepare(`
      INSERT INTO automation_sources (
        id, name, kind, account_ref, capabilities_json, sensitivity,
        enabled, health, last_event_at, last_error, config_version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        kind = excluded.kind,
        account_ref = excluded.account_ref,
        capabilities_json = excluded.capabilities_json,
        sensitivity = excluded.sensitivity,
        enabled = excluded.enabled,
        health = excluded.health,
        last_event_at = COALESCE(excluded.last_event_at, automation_sources.last_event_at),
        last_error = excluded.last_error,
        config_version = automation_sources.config_version + 1,
        updated_at = excluded.updated_at
    `).run(
      source.id, source.name, source.kind, source.accountRef, toJson(source.capabilities), source.sensitivity,
      source.enabled ? 1 : 0, source.health, source.lastEventAt, source.lastError,
      source.configVersion, source.createdAt, source.updatedAt,
    );
    return this.getAutomationSource(source.id);
  }

  getAutomationSource(id) {
    const row = this.db.prepare("SELECT * FROM automation_sources WHERE id = ?").get(id);
    return row ? rowToAutomationSource(row) : null;
  }

  listAutomationSources() {
    return this.db.prepare("SELECT * FROM automation_sources ORDER BY enabled DESC, updated_at DESC, name").all().map(rowToAutomationSource);
  }

  createAutomationRule(input = {}, { actor = "agent", reason = "created" } = {}) {
    const rule = normalizeAutomationRule(input);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`
        INSERT INTO automation_rules (
          id, name, description, source_id, event_type, conditions_json,
          action_json, permissions_json, enabled, version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        rule.id, rule.name, rule.description, rule.sourceId, rule.eventType,
        toJson(rule.conditions), toJson(rule.action), toJson(rule.permissions),
        rule.enabled ? 1 : 0, rule.version, rule.createdAt, rule.updatedAt,
      );
      this.insertAutomationRuleVersion(rule, { actor, reason });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.getAutomationRule(rule.id);
  }

  updateAutomationRule(id, patch = {}, { actor = "agent", reason = "updated" } = {}) {
    const current = this.getAutomationRule(id);
    if (!current) return null;
    const next = normalizeAutomationRule({ ...current, ...patch, id, version: current.version + 1, createdAt: current.createdAt, updatedAt: new Date().toISOString() });
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`
        UPDATE automation_rules SET
          name = ?, description = ?, source_id = ?, event_type = ?, conditions_json = ?,
          action_json = ?, permissions_json = ?, enabled = ?, version = ?, updated_at = ?
        WHERE id = ?
      `).run(
        next.name, next.description, next.sourceId, next.eventType, toJson(next.conditions),
        toJson(next.action), toJson(next.permissions), next.enabled ? 1 : 0,
        next.version, next.updatedAt, id,
      );
      this.insertAutomationRuleVersion(next, { actor, reason });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.getAutomationRule(id);
  }

  insertAutomationRuleVersion(rule, { actor, reason }) {
    this.db.prepare(`
      INSERT INTO automation_rule_versions (rule_id, version, snapshot_json, reason, actor, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(rule.id, rule.version, toJson(rule), String(reason || "updated"), String(actor || "agent"), new Date().toISOString());
  }

  getAutomationRule(id) {
    const row = this.db.prepare("SELECT * FROM automation_rules WHERE id = ?").get(id);
    return row ? rowToAutomationRule(row) : null;
  }

  listAutomationRules({ enabled } = {}) {
    const rows = enabled === undefined
      ? this.db.prepare("SELECT * FROM automation_rules ORDER BY enabled DESC, updated_at DESC, name").all()
      : this.db.prepare("SELECT * FROM automation_rules WHERE enabled = ? ORDER BY updated_at DESC, name").all(enabled ? 1 : 0);
    return rows.map(rowToAutomationRule);
  }

  createAutomationEvent(input = {}) {
    const event = normalizeAutomationEvent(input);
    this.db.prepare(`
      INSERT INTO automation_events (
        id, source_id, event_type, title, sender_json, payload_json,
        risk_json, status, dedupe_key, received_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_id, dedupe_key) DO NOTHING
    `).run(
      event.id, event.sourceId, event.eventType, event.title, toJson(event.sender),
      toJson(event.payload), toJson(event.risk), event.status, event.dedupeKey,
      event.receivedAt, event.createdAt,
    );
    const stored = this.db.prepare("SELECT * FROM automation_events WHERE source_id = ? AND dedupe_key = ?").get(event.sourceId, event.dedupeKey);
    this.db.prepare("UPDATE automation_sources SET last_event_at = ?, health = 'healthy', last_error = '', updated_at = ? WHERE id = ?")
      .run(event.receivedAt, new Date().toISOString(), event.sourceId);
    return rowToAutomationEvent(stored);
  }

  getAutomationEvent(id) {
    const row = this.db.prepare("SELECT * FROM automation_events WHERE id = ?").get(id);
    return row ? rowToAutomationEvent(row) : null;
  }

  findAutomationEvent(sourceId, dedupeKey) {
    const row = this.db.prepare("SELECT * FROM automation_events WHERE source_id = ? AND dedupe_key = ?")
      .get(String(sourceId || ""), String(dedupeKey || ""));
    return row ? rowToAutomationEvent(row) : null;
  }

  listAutomationEvents({ sourceId = "", limit = 100, offset = 0 } = {}) {
    const bounded = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const start = Math.max(Number(offset) || 0, 0);
    const rows = sourceId
      ? this.db.prepare("SELECT * FROM automation_events WHERE source_id = ? ORDER BY received_at DESC LIMIT ? OFFSET ?").all(sourceId, bounded, start)
      : this.db.prepare("SELECT * FROM automation_events ORDER BY received_at DESC LIMIT ? OFFSET ?").all(bounded, start);
    return rows.map(rowToAutomationEvent);
  }

  countAutomationEvents({ sourceId = "" } = {}) {
    const row = sourceId
      ? this.db.prepare("SELECT COUNT(*) AS count FROM automation_events WHERE source_id = ?").get(sourceId)
      : this.db.prepare("SELECT COUNT(*) AS count FROM automation_events").get();
    return Number(row?.count || 0);
  }

  createAutomationRun(input = {}) {
    const run = normalizeAutomationRun(input);
    this.db.prepare(`
      INSERT INTO automation_runs (
        id, rule_id, event_id, status, matched, reason, template_id,
        session_id, result_json, error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      run.id, run.ruleId, run.eventId, run.status, run.matched ? 1 : 0,
      run.reason, run.templateId, run.sessionId, toJson(run.result), run.error,
      run.createdAt, run.updatedAt,
    );
    return this.getAutomationRun(run.id);
  }

  updateAutomationRun(id, patch = {}) {
    const current = this.getAutomationRun(id);
    if (!current) return null;
    const next = normalizeAutomationRun({ ...current, ...patch, id, createdAt: current.createdAt, updatedAt: new Date().toISOString() });
    this.db.prepare(`
      UPDATE automation_runs SET status = ?, matched = ?, reason = ?, template_id = ?,
        session_id = ?, result_json = ?, error = ?, updated_at = ? WHERE id = ?
    `).run(next.status, next.matched ? 1 : 0, next.reason, next.templateId, next.sessionId, toJson(next.result), next.error, next.updatedAt, id);
    return this.getAutomationRun(id);
  }

  getAutomationRun(id) {
    const row = this.db.prepare("SELECT * FROM automation_runs WHERE id = ?").get(id);
    return row ? rowToAutomationRun(row) : null;
  }

  listAutomationRuns({ eventId = "", statuses = [], limit = 100, offset = 0 } = {}) {
    const bounded = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const start = Math.max(Number(offset) || 0, 0);
    const normalizedStatuses = Array.isArray(statuses) ? statuses.map(String).filter(Boolean) : [];
    const where = [];
    const params = [];
    if (eventId) {
      where.push("event_id = ?");
      params.push(String(eventId));
    }
    if (normalizedStatuses.length) {
      where.push(`status IN (${normalizedStatuses.map(() => "?").join(", ")})`);
      params.push(...normalizedStatuses);
    }
    const rows = this.db.prepare(`SELECT * FROM automation_runs${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, bounded, start);
    return rows.map(rowToAutomationRun);
  }

  countAutomationRuns({ statuses = [] } = {}) {
    const normalizedStatuses = Array.isArray(statuses) ? statuses.map(String).filter(Boolean) : [];
    const row = normalizedStatuses.length
      ? this.db.prepare(`SELECT COUNT(*) AS count FROM automation_runs WHERE status IN (${normalizedStatuses.map(() => "?").join(", ")})`).get(...normalizedStatuses)
      : this.db.prepare("SELECT COUNT(*) AS count FROM automation_runs").get();
    return Number(row?.count || 0);
  }

  evaluateMailProtection(input = {}, limits = {}) {
    const now = input.receivedAt || new Date().toISOString();
    const day = String(now).slice(0, 10);
    const normalizedSender = normalizeMailSenderKey(input.sender);
    const senderMissing = !normalizedSender;
    const senderKey = normalizedSender || "unknown-sender";
    const domain = senderKey.includes("@") ? senderKey.split("@").pop() : "";
    const risk = mailRiskSignals(input.risk);
    const settings = {
      senderDailyLimit: positiveInteger(limits.senderDailyLimit, 12),
      trustedSenderDailyLimit: positiveInteger(limits.trustedSenderDailyLimit, 30),
      domainDailyLimit: positiveInteger(limits.domainDailyLimit, 60),
      globalDailyLimit: positiveInteger(limits.globalDailyLimit, 150),
      autoTrustSafeCount: positiveInteger(limits.autoTrustSafeCount, 8),
      autoBlockViolationCount: positiveInteger(limits.autoBlockViolationCount, 3),
    };
    this.db.exec("BEGIN IMMEDIATE");
    try {
      let policy = this.getAutomationMailPolicy(senderKey);
      const expired = Boolean(policy?.expiresAt && new Date(policy.expiresAt).getTime() <= new Date(now).getTime());
      if (expired) policy = this.upsertAutomationMailPolicy({ sender: senderKey, policy: "neutral", origin: "automatic", reason: "temporary policy expired", safeCount: policy.safeCount, violationCount: policy.violationCount, expiresAt: null }, { transaction: false });
      if (!policy) policy = this.upsertAutomationMailPolicy({ sender: senderKey, policy: "neutral", origin: "automatic", reason: "first observed sender", safeCount: 0, violationCount: 0 }, { transaction: false });

      const scopes = [`sender:${senderKey}`, ...(domain ? [`domain:${domain}`] : []), "global"];
      for (const scope of scopes) this.incrementAutomationMailUsage(day, scope, { received: 1, risk: risk.highRisk ? 1 : 0, now });
      const senderUsage = this.getAutomationMailUsage(day, `sender:${senderKey}`);
      const domainUsage = domain ? this.getAutomationMailUsage(day, `domain:${domain}`) : null;
      const globalUsage = this.getAutomationMailUsage(day, "global");
      const senderLimit = policy.dailyLimit || (policy.policy === "trusted" ? settings.trustedSenderDailyLimit : settings.senderDailyLimit);
      const quotaReason = senderUsage.receivedCount > senderLimit
        ? `sender daily limit ${senderLimit} exceeded`
        : domainUsage && domainUsage.receivedCount > settings.domainDailyLimit
          ? `domain daily limit ${settings.domainDailyLimit} exceeded`
          : globalUsage.receivedCount > settings.globalDailyLimit
            ? `global daily limit ${settings.globalDailyLimit} exceeded`
            : "";
      const violation = Boolean(risk.highRisk || quotaReason || senderMissing);
      const safeCount = violation ? policy.safeCount : policy.safeCount + 1;
      const violationCount = violation ? policy.violationCount + 1 : Math.max(policy.violationCount - 1, 0);
      let nextPolicy = policy.policy;
      let policyReason = policy.reason;
      if (policy.origin !== "agent") {
        if (violationCount >= settings.autoBlockViolationCount) {
          nextPolicy = "blocked";
          policyReason = risk.highRisk ? "automatically blocked after repeated high-risk mail" : "automatically blocked after repeated quota violations";
        } else if (nextPolicy !== "blocked" && safeCount >= settings.autoTrustSafeCount && risk.authenticated) {
          nextPolicy = "trusted";
          policyReason = "automatically trusted after repeated authenticated mail";
        }
      }
      policy = this.upsertAutomationMailPolicy({
        sender: senderKey,
        policy: nextPolicy,
        origin: policy.origin,
        reason: policyReason,
        dailyLimit: policy.dailyLimit,
        safeCount,
        violationCount,
        firstSeenAt: policy.firstSeenAt,
        lastSeenAt: now,
        expiresAt: policy.expiresAt,
      }, { transaction: false });
      const suppressedReason = policy.policy === "blocked" ? policy.reason || "sender is blocked" : risk.highRisk ? risk.reason : quotaReason || (senderMissing ? "sender address is missing" : "");
      const dispatch = !suppressedReason;
      for (const scope of scopes) this.incrementAutomationMailUsage(day, scope, dispatch ? { dispatched: 1, now } : { suppressed: 1, now });
      this.db.exec("COMMIT");
      return {
        dispatch,
        reason: suppressedReason || "within protection limits",
        sender: senderKey,
        domain,
        policy,
        usage: {
          sender: senderUsage.receivedCount,
          senderLimit,
          domain: domainUsage?.receivedCount || 0,
          domainLimit: settings.domainDailyLimit,
          global: globalUsage.receivedCount,
          globalLimit: settings.globalDailyLimit,
        },
        risk,
      };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  upsertAutomationMailPolicy(input = {}, { transaction = true } = {}) {
    const now = new Date().toISOString();
    const senderKey = normalizeMailSenderKey(input.sender || input.senderKey || input.sender_key);
    if (!senderKey) throw new Error("mail sender is required");
    const current = this.getAutomationMailPolicy(senderKey);
    const policy = ["neutral", "trusted", "blocked"].includes(String(input.policy)) ? String(input.policy) : current?.policy || "neutral";
    const values = {
      senderKey,
      policy,
      origin: input.origin === "agent" ? "agent" : input.origin || current?.origin || "automatic",
      reason: String(input.reason || current?.reason || "policy updated").slice(0, 500),
      dailyLimit: input.dailyLimit === null ? null : input.dailyLimit === undefined ? current?.dailyLimit ?? null : positiveInteger(input.dailyLimit, null),
      safeCount: Math.max(Number(input.safeCount ?? current?.safeCount ?? 0) || 0, 0),
      violationCount: Math.max(Number(input.violationCount ?? current?.violationCount ?? 0) || 0, 0),
      firstSeenAt: input.firstSeenAt || current?.firstSeenAt || now,
      lastSeenAt: input.lastSeenAt || current?.lastSeenAt || now,
      expiresAt: input.expiresAt === null ? null : input.expiresAt || current?.expiresAt || null,
      createdAt: current?.createdAt || now,
      updatedAt: now,
    };
    const write = () => this.db.prepare(`
      INSERT INTO automation_mail_sender_policies (
        sender_key, policy, origin, reason, daily_limit, safe_count, violation_count,
        first_seen_at, last_seen_at, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(sender_key) DO UPDATE SET
        policy = excluded.policy, origin = excluded.origin, reason = excluded.reason,
        daily_limit = excluded.daily_limit, safe_count = excluded.safe_count,
        violation_count = excluded.violation_count, first_seen_at = excluded.first_seen_at,
        last_seen_at = excluded.last_seen_at, expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
    `).run(values.senderKey, values.policy, values.origin, values.reason, values.dailyLimit, values.safeCount, values.violationCount, values.firstSeenAt, values.lastSeenAt, values.expiresAt, values.createdAt, values.updatedAt);
    if (transaction) {
      this.db.exec("BEGIN IMMEDIATE");
      try { write(); this.db.exec("COMMIT"); } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    } else write();
    return this.getAutomationMailPolicy(senderKey);
  }

  getAutomationMailPolicy(sender) {
    const row = this.db.prepare("SELECT * FROM automation_mail_sender_policies WHERE sender_key = ?").get(normalizeMailSenderKey(sender));
    return row ? rowToAutomationMailPolicy(row) : null;
  }

  listAutomationMailPolicies({ limit = 100, offset = 0 } = {}) {
    const bounded = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const start = Math.max(Number(offset) || 0, 0);
    return this.db.prepare("SELECT * FROM automation_mail_sender_policies ORDER BY CASE policy WHEN 'blocked' THEN 0 WHEN 'trusted' THEN 1 ELSE 2 END, updated_at DESC LIMIT ? OFFSET ?")
      .all(bounded, start).map(rowToAutomationMailPolicy);
  }

  getAutomationMailUsageSummary(day = new Date().toISOString().slice(0, 10)) {
    const global = this.getAutomationMailUsage(day, "global");
    return {
      day,
      ...global,
      policyCount: Number(this.db.prepare("SELECT COUNT(*) AS count FROM automation_mail_sender_policies").get()?.count || 0),
      trustedCount: Number(this.db.prepare("SELECT COUNT(*) AS count FROM automation_mail_sender_policies WHERE policy = 'trusted'").get()?.count || 0),
      blockedCount: Number(this.db.prepare("SELECT COUNT(*) AS count FROM automation_mail_sender_policies WHERE policy = 'blocked'").get()?.count || 0),
    };
  }

  incrementAutomationMailUsage(day, scopeKey, delta = {}) {
    const now = delta.now || new Date().toISOString();
    this.db.prepare(`
      INSERT INTO automation_mail_usage (day, scope_key, received_count, dispatched_count, suppressed_count, risk_count, first_received_at, last_received_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(day, scope_key) DO UPDATE SET
        received_count = received_count + excluded.received_count,
        dispatched_count = dispatched_count + excluded.dispatched_count,
        suppressed_count = suppressed_count + excluded.suppressed_count,
        risk_count = risk_count + excluded.risk_count,
        last_received_at = excluded.last_received_at
    `).run(day, scopeKey, Number(delta.received || 0), Number(delta.dispatched || 0), Number(delta.suppressed || 0), Number(delta.risk || 0), now, now);
  }

  getAutomationMailUsage(day, scopeKey) {
    const row = this.db.prepare("SELECT * FROM automation_mail_usage WHERE day = ? AND scope_key = ?").get(day, scopeKey);
    return row ? rowToAutomationMailUsage(row) : { day, scopeKey, receivedCount: 0, dispatchedCount: 0, suppressedCount: 0, riskCount: 0, firstReceivedAt: null, lastReceivedAt: null };
  }

  upsertAutomationTemplate(input = {}) {
    const template = normalizeAutomationTemplate(input);
    this.db.prepare(`
      INSERT INTO automation_templates (
        id, name, purpose, source_fingerprint, runtime, version, status, sha256,
        code_object_id, success_count, failure_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name, purpose = excluded.purpose, source_fingerprint = excluded.source_fingerprint,
        runtime = excluded.runtime, version = excluded.version, status = excluded.status,
        sha256 = excluded.sha256, code_object_id = excluded.code_object_id,
        success_count = excluded.success_count, failure_count = excluded.failure_count,
        updated_at = excluded.updated_at
    `).run(
      template.id, template.name, template.purpose, template.sourceFingerprint,
      template.runtime, template.version, template.status, template.sha256,
      template.codeObjectId, template.successCount, template.failureCount,
      template.createdAt, template.updatedAt,
    );
    return this.getAutomationTemplate(template.id);
  }

  getAutomationTemplate(id) {
    const row = this.db.prepare("SELECT * FROM automation_templates WHERE id = ?").get(id);
    return row ? rowToAutomationTemplate(row) : null;
  }

  resolveAutomationTemplate(sourceFingerprint) {
    const fingerprint = String(sourceFingerprint || "").trim();
    if (!fingerprint) return null;
    const row = this.db.prepare(`
      SELECT * FROM automation_templates
      WHERE source_fingerprint = ? AND status = 'active'
      ORDER BY version DESC, updated_at DESC
      LIMIT 1
    `).get(fingerprint);
    return row ? rowToAutomationTemplate(row) : null;
  }

  listAutomationTemplates() {
    return this.db.prepare("SELECT * FROM automation_templates ORDER BY updated_at DESC, name").all().map(rowToAutomationTemplate);
  }

  recordDataOperation(input = {}) {
    const operation = {
      id: String(input.id || `dop_${crypto.randomBytes(10).toString("hex")}`),
      actor: String(input.actor || "agent"),
      sessionId: String(input.sessionId || ""),
      runId: String(input.runId || ""),
      sqlHash: String(input.sqlHash || ""),
      kind: String(input.kind || "write"),
      status: String(input.status || "succeeded"),
      snapshotId: input.snapshotId ? String(input.snapshotId) : null,
      schemaChanged: Boolean(input.schemaChanged),
      error: String(input.error || ""),
      createdAt: input.createdAt || new Date().toISOString(),
    };
    this.db.prepare(`
      INSERT OR REPLACE INTO data_operations (
        id, actor, session_id, run_id, sql_hash, operation_kind, status,
        snapshot_id, schema_changed, error, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      operation.id, operation.actor, operation.sessionId, operation.runId, operation.sqlHash,
      operation.kind, operation.status, operation.snapshotId, operation.schemaChanged ? 1 : 0,
      operation.error, operation.createdAt,
    );
    return operation;
  }

  listDataOperations({ limit = 100 } = {}) {
    return this.db.prepare("SELECT * FROM data_operations ORDER BY created_at DESC LIMIT ?")
      .all(Math.min(Math.max(Number(limit) || 100, 1), 500)).map((row) => ({
        id: row.id, actor: row.actor, sessionId: row.session_id, runId: row.run_id,
        sqlHash: row.sql_hash, kind: row.operation_kind, status: row.status,
        snapshotId: row.snapshot_id || null, schemaChanged: Boolean(row.schema_changed),
        error: row.error || "", createdAt: row.created_at,
      }));
  }

  upsertDataCatalogMetadata(input = {}) {
    const objectName = String(input.objectName || input.object || "").trim();
    const fieldName = String(input.fieldName || input.field || "").trim();
    if (!objectName) throw new Error("objectName is required");
    const updatedAt = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO data_catalog_metadata (
        object_name, field_name, display_name, description, sensitivity, display_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(object_name, field_name) DO UPDATE SET
        display_name = excluded.display_name, description = excluded.description,
        sensitivity = excluded.sensitivity, display_json = excluded.display_json,
        updated_at = excluded.updated_at
    `).run(
      objectName, fieldName, String(input.displayName || ""), String(input.description || ""),
      String(input.sensitivity || "private"), toJson(input.display || {}), updatedAt,
    );
    return this.getDataCatalogMetadata(objectName, fieldName);
  }

  getDataCatalogMetadata(objectName, fieldName = "") {
    const row = this.db.prepare("SELECT * FROM data_catalog_metadata WHERE object_name = ? AND field_name = ?").get(objectName, fieldName);
    return row ? rowToDataCatalogMetadata(row) : null;
  }

  listDataCatalogMetadata({ objectName = "" } = {}) {
    const rows = objectName
      ? this.db.prepare("SELECT * FROM data_catalog_metadata WHERE object_name = ? ORDER BY field_name").all(objectName)
      : this.db.prepare("SELECT * FROM data_catalog_metadata ORDER BY object_name, field_name").all();
    return rows.map(rowToDataCatalogMetadata);
  }

  migrateSingleMachineTables() {
    this.dropLegacyIndexes();
    if (this.tableHasAnyColumn("workspaces", ["employee_id", "machine_json"])) {
      this.migrateLegacyWorkspaces();
    }
    if (this.tableHasAnyColumn("commands", ["employee_id", "machine_fingerprint"])) {
      this.migrateLegacyCommands();
    }
    if (this.tableExists("machines")) {
      this.db.exec("DROP TABLE IF EXISTS machines");
    }
    this.dropLegacyIndexes();
  }

  archiveLegacyMemoryTable() {
    if (!this.tableExists("memories")) return null;
    const baseName = "legacy_memories_readonly";
    const target = this.tableExists(baseName) ? `${baseName}_${Date.now()}` : baseName;
    this.db.exec(`ALTER TABLE memories RENAME TO ${quoteIdentifier(target)}`);
    return target;
  }

  migrateLegacyWorkspaces() {
    const tableName = `workspaces_legacy_${Date.now()}`;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.exec(`ALTER TABLE workspaces RENAME TO ${quoteIdentifier(tableName)}`);
      this.db.exec(`
        CREATE TABLE workspaces (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          workspace_root TEXT NOT NULL,
          description TEXT NOT NULL,
          routing_tags_json TEXT NOT NULL,
          context_summary TEXT NOT NULL,
          app_server_json TEXT NOT NULL,
          agent_command_aliases_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(name)
        )
      `);
      const rows = this.db.prepare(`
        SELECT id, name, workspace_root, description, routing_tags_json,
          context_summary, app_server_json, agent_command_aliases_json,
          created_at, updated_at
        FROM ${quoteIdentifier(tableName)}
        ORDER BY updated_at ASC
      `).all();
      const insert = this.db.prepare(`
        INSERT INTO workspaces (
          id, name, workspace_root, description, routing_tags_json,
          context_summary, app_server_json, agent_command_aliases_json,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET
          workspace_root = excluded.workspace_root,
          description = excluded.description,
          routing_tags_json = excluded.routing_tags_json,
          context_summary = excluded.context_summary,
          app_server_json = excluded.app_server_json,
          agent_command_aliases_json = excluded.agent_command_aliases_json,
          updated_at = excluded.updated_at
      `);
      for (const row of rows) {
        insert.run(
          row.id || `ws_${crypto.randomBytes(8).toString("hex")}`,
          row.name || "default",
          row.workspace_root || process.cwd(),
          row.description || "",
          row.routing_tags_json || "[]",
          row.context_summary || "",
          row.app_server_json || "{}",
          row.agent_command_aliases_json || "[]",
          row.created_at || new Date().toISOString(),
          row.updated_at || new Date().toISOString(),
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  migrateLegacyCommands() {
    const tableName = `commands_legacy_${Date.now()}`;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.exec(`ALTER TABLE commands RENAME TO ${quoteIdentifier(tableName)}`);
      this.db.exec(`
        CREATE TABLE commands (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          command_type TEXT NOT NULL,
          status TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          result_json TEXT NOT NULL,
          error TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);
      this.db.prepare(`
        INSERT INTO commands (
          id, session_id, command_type, status, payload_json,
          result_json, error, created_at, updated_at
        )
        SELECT id, session_id, command_type, status, payload_json,
          result_json, error, created_at, updated_at
        FROM ${quoteIdentifier(tableName)}
      `).run();
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  tableHasAnyColumn(tableName, columnNames) {
    const columns = this.tableColumns(tableName);
    return columnNames.some((column) => columns.has(column));
  }

  tableColumns(tableName) {
    if (!this.tableExists(tableName)) return new Set();
    const rows = this.db.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all();
    return new Set(rows.map((row) => row.name));
  }

  tableExists(tableName) {
    return Boolean(this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
  }

  dropLegacyIndexes() {
    this.db.exec(`
      DROP INDEX IF EXISTS idx_workspaces_employee;
      DROP INDEX IF EXISTS idx_machines_employee;
      DROP INDEX IF EXISTS idx_commands_session;
    `);
  }
}

function coalesceMessages(messages) {
  const output = [];
  const indexes = new Map();
  for (const message of messages) {
    const key = message.id;
    if (indexes.has(key)) {
      output[indexes.get(key)] = message;
      continue;
    }
    indexes.set(key, output.length);
    output.push(message);
  }
  return output;
}

function normalizeJsonState(input) {
  const sessions = {};
  for (const [id, session] of Object.entries(input.sessions && typeof input.sessions === "object" ? input.sessions : {})) {
    sessions[id] = normalizeSession({ ...session, id });
  }
  const events = {};
  for (const [sessionId, rows] of Object.entries(input.events && typeof input.events === "object" ? input.events : {})) {
    events[sessionId] = Array.isArray(rows) ? rows.map((event, index) => normalizeEvent({ ...event, sessionId, seq: event.seq || index + 1 })) : [];
  }
  return {
    sessions,
    events,
    channelSessions: input.channelSessions && typeof input.channelSessions === "object" ? input.channelSessions : {},
    channels: {
      wechat: {
        lastRecipientId: input.channels?.wechat?.lastRecipientId || "",
        updatedAt: input.channels?.wechat?.updatedAt || "",
      },
    },
  };
}

function normalizeSession(input) {
  const now = new Date().toISOString();
  return {
    id: input.id,
    role: input.role === "main" ? "main" : "worker",
    parentSessionId: input.parentSessionId || null,
    channel: input.channel || null,
    senderId: input.senderId || null,
    senderName: input.senderName || null,
    workspaceRoot: input.workspaceRoot || process.cwd(),
    agentType: input.agentType || "codex",
    agentAlias: input.agentAlias || "codex",
    status: normalizeStatus(input.status || "idle"),
    title: input.title || titleFromTask(input.taskDescription || input.content || "新会话"),
    taskDescription: input.taskDescription || input.content || "",
    summary: input.summary || "",
    cliSessionId: input.cliSessionId || null,
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || input.createdAt || now,
    metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : {},
  };
}

function normalizePrivateFileText(value, maxLength, fallback) {
  const text = String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return (text || fallback).slice(0, maxLength);
}

function normalizePrivateRelativePath(value) {
  const relativePath = String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!relativePath || relativePath.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("invalid private file batch path");
  }
  return relativePath;
}

function normalizeTokenRange(value) {
  const range = String(value || "today").trim().toLowerCase();
  return ["today", "7d", "30d", "all"].includes(range) ? range : "today";
}

function tokenRangeCutoffDay(range) {
  if (range === "all") return null;
  const days = range === "30d" ? 30 : range === "7d" ? 7 : 1;
  const today = shanghaiDayKey(new Date());
  const date = new Date(`${today}T00:00:00.000Z`);
  return new Date(date.getTime() - (days - 1) * 86400000).toISOString().slice(0, 10);
}

function shanghaiDayKey(value) {
  const date = value instanceof Date && !Number.isNaN(value.getTime()) ? value : new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

function tokenCounterDelta(current, previous) {
  const nextValue = Math.max(Number(current) || 0, 0);
  const previousValue = Math.max(Number(previous) || 0, 0);
  return nextValue >= previousValue ? nextValue - previousValue : nextValue;
}

function normalizeAutomationSource(input) {
  const now = new Date().toISOString();
  const kind = String(input.kind || "generic").trim();
  const accountRef = String(input.accountRef || input.account_ref || "").trim();
  const name = String(input.name || accountRef || kind).trim();
  if (!name) throw new Error("automation source name is required");
  return {
    id: String(input.id || `src_${crypto.randomBytes(8).toString("hex")}`),
    name,
    kind,
    accountRef,
    capabilities: Array.isArray(input.capabilities) ? input.capabilities.map(String) : [],
    sensitivity: String(input.sensitivity || "private"),
    enabled: input.enabled !== false && input.enabled !== 0 && input.enabled !== "0",
    health: String(input.health || "unknown"),
    lastEventAt: input.lastEventAt || null,
    lastError: String(input.lastError || ""),
    configVersion: Math.max(Number(input.configVersion || 1), 1),
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
  };
}

function normalizeAutomationRule(input) {
  const now = new Date().toISOString();
  const name = String(input.name || "").trim();
  if (!name) throw new Error("automation rule name is required");
  return {
    id: String(input.id || `rule_${crypto.randomBytes(8).toString("hex")}`),
    name,
    description: String(input.description || ""),
    sourceId: input.sourceId || input.source_id || null,
    eventType: String(input.eventType || input.event_type || "message.received"),
    conditions: input.conditions && typeof input.conditions === "object" ? input.conditions : {},
    action: input.action && typeof input.action === "object" ? input.action : {},
    permissions: input.permissions && typeof input.permissions === "object" ? input.permissions : {},
    enabled: input.enabled !== false && input.enabled !== 0 && input.enabled !== "0",
    version: Math.max(Number(input.version || 1), 1),
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
  };
}

function normalizeAutomationEvent(input) {
  const now = new Date().toISOString();
  const sourceId = String(input.sourceId || input.source_id || "").trim();
  if (!sourceId) throw new Error("automation event sourceId is required");
  const payload = input.payload && typeof input.payload === "object" ? input.payload : {};
  const dedupeKey = String(input.dedupeKey || input.dedupe_key || crypto.createHash("sha256").update(toJson(payload)).digest("hex"));
  return {
    id: String(input.id || `aevt_${crypto.randomBytes(10).toString("hex")}`),
    sourceId,
    eventType: String(input.eventType || input.event_type || "message.received"),
    title: String(input.title || ""),
    sender: input.sender && typeof input.sender === "object" ? input.sender : {},
    payload,
    risk: input.risk && typeof input.risk === "object" ? input.risk : {},
    status: String(input.status || "received"),
    dedupeKey,
    receivedAt: input.receivedAt || input.occurredAt || now,
    createdAt: input.createdAt || now,
  };
}

function normalizeAutomationRun(input) {
  const now = new Date().toISOString();
  return {
    id: String(input.id || `arun_${crypto.randomBytes(10).toString("hex")}`),
    ruleId: input.ruleId || input.rule_id || null,
    eventId: input.eventId || input.event_id || null,
    status: String(input.status || "pending"),
    matched: Boolean(input.matched),
    reason: String(input.reason || ""),
    templateId: input.templateId || input.template_id || null,
    sessionId: input.sessionId || input.session_id || null,
    result: input.result && typeof input.result === "object" ? input.result : {},
    error: String(input.error || ""),
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
  };
}

function normalizeAutomationTemplate(input) {
  const now = new Date().toISOString();
  const name = String(input.name || "").trim();
  if (!name) throw new Error("automation template name is required");
  return {
    id: String(input.id || `tpl_${crypto.randomBytes(8).toString("hex")}`),
    name,
    purpose: String(input.purpose || ""),
    sourceFingerprint: String(input.sourceFingerprint || input.source_fingerprint || ""),
    runtime: String(input.runtime || "javascript-esm"),
    version: Math.max(Number(input.version || 1), 1),
    status: String(input.status || "draft"),
    sha256: String(input.sha256 || ""),
    codeObjectId: String(input.codeObjectId || input.code_object_id || ""),
    successCount: Math.max(Number(input.successCount || 0), 0),
    failureCount: Math.max(Number(input.failureCount || 0), 0),
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
  };
}

function rowToAutomationSource(row) {
  return {
    id: row.id, name: row.name, kind: row.kind, accountRef: row.account_ref,
    capabilities: fromJson(row.capabilities_json, []), sensitivity: row.sensitivity,
    enabled: Boolean(row.enabled), health: row.health, lastEventAt: row.last_event_at || null,
    lastError: row.last_error || "", configVersion: Number(row.config_version || 1),
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function rowToAutomationRule(row) {
  return {
    id: row.id, name: row.name, description: row.description || "", sourceId: row.source_id || null,
    eventType: row.event_type, conditions: fromJson(row.conditions_json, {}),
    action: fromJson(row.action_json, {}), permissions: fromJson(row.permissions_json, {}),
    enabled: Boolean(row.enabled), version: Number(row.version || 1),
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function rowToAutomationEvent(row) {
  return {
    id: row.id, sourceId: row.source_id, eventType: row.event_type, title: row.title || "",
    sender: fromJson(row.sender_json, {}), payload: fromJson(row.payload_json, {}),
    risk: fromJson(row.risk_json, {}), status: row.status, dedupeKey: row.dedupe_key,
    receivedAt: row.received_at, createdAt: row.created_at,
  };
}

function rowToAutomationRun(row) {
  return {
    id: row.id, ruleId: row.rule_id || null, eventId: row.event_id || null,
    status: row.status, matched: Boolean(row.matched), reason: row.reason || "",
    templateId: row.template_id || null, sessionId: row.session_id || null,
    result: fromJson(row.result_json, {}), error: row.error || "",
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function rowToAutomationMailPolicy(row) {
  return {
    senderKey: row.sender_key,
    policy: row.policy,
    origin: row.origin,
    reason: row.reason || "",
    dailyLimit: row.daily_limit === null ? null : Number(row.daily_limit),
    safeCount: Number(row.safe_count || 0),
    violationCount: Number(row.violation_count || 0),
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToAutomationMailUsage(row) {
  return {
    day: row.day,
    scopeKey: row.scope_key,
    receivedCount: Number(row.received_count || 0),
    dispatchedCount: Number(row.dispatched_count || 0),
    suppressedCount: Number(row.suppressed_count || 0),
    riskCount: Number(row.risk_count || 0),
    firstReceivedAt: row.first_received_at || null,
    lastReceivedAt: row.last_received_at || null,
  };
}

function normalizeMailSenderKey(value) {
  const text = typeof value === "object" && value
    ? value.address || value.email || value.sender || ""
    : value;
  return String(text || "").trim().toLowerCase().slice(0, 320);
}

function mailRiskSignals(input = {}) {
  const authentication = String(input.authenticationResults || "").toLowerCase();
  const spamStatus = String(input.spamStatus || input.status || "").toLowerCase();
  const spamScore = Number(input.spamScore);
  const explicitSpam = /(^|[;\s])(yes|true|spam)([;\s]|$)/.test(spamStatus) || (Number.isFinite(spamScore) && spamScore >= 8);
  const dmarcFailed = /\bdmarc=fail\b/.test(authentication);
  const spfFailed = /\bspf=fail\b/.test(authentication);
  const dkimFailed = /\bdkim=fail\b/.test(authentication);
  const authenticationFailed = dmarcFailed || (spfFailed && dkimFailed);
  const authenticated = /\bdmarc=pass\b/.test(authentication) || (/\bspf=pass\b/.test(authentication) && /\bdkim=pass\b/.test(authentication));
  const highRisk = explicitSpam || authenticationFailed;
  return {
    highRisk,
    explicitSpam,
    authenticationFailed,
    authenticated,
    spamScore: Number.isFinite(spamScore) ? spamScore : null,
    reason: explicitSpam ? "mail gateway marked the message as spam" : authenticationFailed ? "mail authentication failed" : "no high-risk mail signal",
  };
}

function positiveInteger(value, fallback) {
  if (value === null && fallback === null) return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function rowToAutomationTemplate(row) {
  return {
    id: row.id, name: row.name, purpose: row.purpose || "", sourceFingerprint: row.source_fingerprint,
    runtime: row.runtime, version: Number(row.version || 1), status: row.status,
    sha256: row.sha256 || "", codeObjectId: row.code_object_id || "",
    successCount: Number(row.success_count || 0), failureCount: Number(row.failure_count || 0),
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function rowToDataCatalogMetadata(row) {
  return {
    objectName: row.object_name, fieldName: row.field_name, displayName: row.display_name || "",
    description: row.description || "", sensitivity: row.sensitivity || "private",
    display: fromJson(row.display_json, {}), updatedAt: row.updated_at,
  };
}

function normalizeScheduledTask(input) {
  const name = String(input.name || "").trim();
  const cron = String(input.cron || "").trim();
  const prompt = String(input.prompt || input.taskDescription || input.content || "").trim();
  if (!name) throw new Error("task name is required");
  if (!cron) throw new Error("cron is required");
  if (!prompt) throw new Error("prompt is required");
  return {
    id: input.id,
    name,
    cron,
    timezone: String(input.timezone || "local").trim() || "local",
    prompt,
    workspaceName: String(input.workspaceName || input.workspace || "").trim(),
    workspaceRoot: String(input.workspaceRoot || "").trim(),
    recipientId: String(input.recipientId || input.recipient_id || "").trim(),
    enabled: input.enabled !== false && input.enabled !== 0 && input.enabled !== "0",
    nextRunAt: input.nextRunAt || null,
    lastRunAt: input.lastRunAt || null,
    lastSessionId: input.lastSessionId || null,
    runCount: Number(input.runCount || 0),
    lastError: String(input.lastError || ""),
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: input.updatedAt || input.createdAt || new Date().toISOString(),
  };
}

function encodeSessionCursor(updatedAt, id) {
  return Buffer.from(JSON.stringify({ updatedAt, id }), "utf8").toString("base64url");
}

function decodeSessionCursor(cursor) {
  const normalized = String(cursor || "").trim();
  if (!normalized) return null;
  try {
    const value = JSON.parse(Buffer.from(normalized, "base64url").toString("utf8"));
    if (!value?.updatedAt || !value?.id) throw new Error("missing fields");
    return { updatedAt: String(value.updatedAt), id: String(value.id) };
  } catch {
    throw new Error("invalid session cursor");
  }
}

function escapeSqlLike(value) {
  return String(value).replace(/[\\%_]/g, "\\$&");
}

function normalizeEvent(input) {
  return {
    id: input.id || `evt_${crypto.randomBytes(8).toString("hex")}`,
    sessionId: input.sessionId,
    seq: Number(input.seq || 1),
    kind: input.kind || "session.status",
    payload: sanitizePayload(input.payload || {}),
    createdAt: input.createdAt || new Date().toISOString(),
  };
}

function normalizeStatus(status) {
  return SESSION_STATUSES.has(status) ? status : "idle";
}

function titleFromTask(task) {
  return String(task || "新会话").replace(/\s+/g, " ").trim().slice(0, 80) || "新会话";
}

function sanitizePayload(payload) {
  if (!payload || typeof payload !== "object") return {};
  return JSON.parse(JSON.stringify(payload));
}

function normalizeTokenBreakdown(value) {
  const input = value && typeof value === "object" ? value : {};
  return {
    inputTokens: finiteTokenCount(input.inputTokens),
    cachedInputTokens: finiteTokenCount(input.cachedInputTokens),
    outputTokens: finiteTokenCount(input.outputTokens),
    reasoningOutputTokens: finiteTokenCount(input.reasoningOutputTokens),
    totalTokens: finiteTokenCount(input.totalTokens),
  };
}

function finiteTokenCount(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

function applyEventToSession(session, event) {
  const payload = event.payload || {};
  session.updatedAt = event.createdAt;
  if (typeof payload.cliSessionId === "string" && payload.cliSessionId.trim()) {
    const cliSessionId = payload.cliSessionId.trim();
    if (session.cliSessionId !== cliSessionId) {
      session.metadata = { ...(session.metadata || {}), cliThreadStartedAt: event.createdAt };
    }
    session.cliSessionId = cliSessionId;
  }
  switch (event.kind) {
    case "session.started":
      session.status = "running";
      break;
    case "session.complete":
      session.status = payload.idle ? "idle" : payload.success === false ? "paused" : "idle";
      break;
    case "session.error":
      session.status = "paused";
      break;
    case "session.status":
      if (payload.status) session.status = normalizeStatus(payload.status);
      break;
    default:
      break;
  }
  if (typeof payload.taskDescription === "string" && payload.taskDescription.trim()) {
    session.taskDescription = payload.taskDescription.trim();
  }
  if (typeof payload.summary === "string" && payload.summary.trim()) {
    session.summary = payload.summary.trim();
  }
}

function eventToMessage(event) {
  const payload = event.payload || {};
  const content = String(payload.content || "").trim();
  const metadata = payload.metadata && typeof payload.metadata === "object" ? payload.metadata : {};
  const base = {
    id: payload.persistedMessageId || event.id,
    sessionId: event.sessionId,
    sequence: event.seq,
    content,
    kind: event.kind,
    source: payload.source || "open-agent-bridge",
    toolName: payload.toolName || "",
    level: payload.level || "info",
    metadata,
    createdAt: event.createdAt,
  };
  if (event.kind === "session.user_message") return { ...base, role: "user" };
  if (event.kind === "session.assistant_message") return { ...base, role: "assistant" };
  if (event.kind === "session.reasoning") return { ...base, role: "agent" };
  if (event.kind === "session.tool_use" || event.kind === "session.tool_result") return { ...base, role: "tool" };
  if (event.kind === "session.error") {
    if (metadata.willRetry === true) return null;
    return { ...base, role: "error", content: content || "Session error" };
  }
  if (event.kind === "authorization.request" || event.kind === "authorization.decision") return { ...base, role: "system" };
  if (content) return { ...base, role: "system" };
  return null;
}

function rowToSession(row) {
  return {
    id: row.id,
    role: row.role,
    parentSessionId: row.parent_session_id || null,
    channel: row.channel || null,
    senderId: row.sender_id || null,
    senderName: row.sender_name || null,
    workspaceRoot: row.workspace_root,
    agentType: row.agent_type,
    agentAlias: row.agent_alias,
    status: normalizeStatus(row.status),
    title: row.title,
    taskDescription: row.task_description,
    summary: row.summary,
    cliSessionId: row.cli_session_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    metadata: fromJson(row.metadata_json, {}),
  };
}

function rowToEvent(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    seq: Number(row.seq),
    kind: row.kind,
    payload: fromJson(row.payload_json, {}),
    createdAt: row.created_at,
  };
}

function rowToWorkspace(row) {
  return {
    id: row.id,
    name: row.name,
    workspaceRoot: row.workspace_root,
    description: row.description,
    routingTags: fromJson(row.routing_tags_json, []),
    contextSummary: row.context_summary,
    appServer: fromJson(row.app_server_json, {}),
    agentCommandAliases: fromJson(row.agent_command_aliases_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToTokenUsageSession(row) {
  return {
    sessionId: row.session_id,
    title: row.title,
    workspaceRoot: row.workspace_root,
    inputTokens: Number(row.input_tokens || 0),
    cachedInputTokens: Number(row.cached_input_tokens || 0),
    outputTokens: Number(row.output_tokens || 0),
    reasoningOutputTokens: Number(row.reasoning_output_tokens || 0),
    totalTokens: Number(row.total_tokens || 0),
    threadCount: Number(row.thread_count || 0),
    updatedAt: row.updated_at || null,
  };
}

function rowToCommand(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    commandType: row.command_type,
    status: row.status,
    payload: fromJson(row.payload_json, {}),
    result: fromJson(row.result_json, {}),
    error: row.error || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToScheduledTask(row) {
  return {
    id: row.id,
    name: row.name,
    cron: row.cron,
    timezone: row.timezone,
    prompt: row.prompt,
    workspaceName: row.workspace_name,
    workspaceRoot: row.workspace_root,
    recipientId: row.recipient_id,
    enabled: Boolean(row.enabled),
    nextRunAt: row.next_run_at || null,
    lastRunAt: row.last_run_at || null,
    lastSessionId: row.last_session_id || null,
    runCount: Number(row.run_count || 0),
    lastError: row.last_error || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toJson(value) {
  return JSON.stringify(value ?? {});
}

function fromJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function isMainConversationChannel(channel) {
  return channel === "wechat" || channel === "wechat-personal";
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}
