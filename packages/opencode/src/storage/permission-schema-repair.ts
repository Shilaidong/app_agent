import { copyFileSync, existsSync } from "fs"
import path from "path"

type Statement = {
  all(): unknown[]
}

type SqliteClient = {
  exec(sql: string): void
  prepare?: (sql: string) => Statement
  query?: (sql: string) => Statement
}

type Column = {
  name: string
  pk: number
}

type RepairResult =
  | { repaired: false }
  | {
      repaired: true
      backup: string
      legacyTable: string
    }

export function repairLegacyPermissionSchema(client: SqliteClient, databasePath: string): RepairResult {
  const columns = tableInfo(client)
  if (columns.length === 0 || isCurrent(columns)) return { repaired: false }

  const legacyTable = `permission_legacy_${Date.now()}`
  const backup = backupDatabase(client, databasePath)
  let transactionStarted = false

  try {
    client.exec("PRAGMA foreign_keys = OFF")
    client.exec("BEGIN IMMEDIATE")
    transactionStarted = true
    client.exec(`
      CREATE TABLE permission_repaired (
        project_id text PRIMARY KEY,
        time_created integer NOT NULL,
        time_updated integer NOT NULL,
        data text NOT NULL,
        CONSTRAINT fk_permission_project_id_project_id_fk FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE
      )
    `)
    client.exec(`
      INSERT INTO permission_repaired (project_id, time_created, time_updated, data)
      SELECT project_id, MIN(time_created), MAX(time_updated), '[]'
      FROM permission
      WHERE project_id IN (SELECT id FROM project)
      GROUP BY project_id
    `)
    client.exec(`ALTER TABLE permission RENAME TO ${legacyTable}`)
    client.exec("ALTER TABLE permission_repaired RENAME TO permission")
    client.exec("COMMIT")
  } catch (error) {
    if (transactionStarted) client.exec("ROLLBACK")
    throw error
  } finally {
    client.exec("PRAGMA foreign_keys = ON")
  }

  return { repaired: true, backup, legacyTable }
}

function tableInfo(client: SqliteClient): Column[] {
  const statement = client.prepare?.("PRAGMA table_info(permission)") ?? client.query?.("PRAGMA table_info(permission)")
  if (!statement) throw new Error("SQLite client does not support schema inspection")
  return statement.all().filter(isColumn)
}

function isColumn(value: unknown): value is Column {
  if (!value || typeof value !== "object") return false
  return "name" in value && typeof value.name === "string" && "pk" in value && typeof value.pk === "number"
}

function isCurrent(columns: Column[]) {
  return ["project_id", "time_created", "time_updated", "data"].every((name) => columns.some((column) => column.name === name)) &&
    columns.some((column) => column.name === "project_id" && column.pk === 1)
}

function backupDatabase(client: SqliteClient, databasePath: string) {
  if (databasePath === ":memory:" || !existsSync(databasePath)) {
    throw new Error("Cannot repair a legacy permission schema without a database file backup")
  }

  client.exec("PRAGMA wal_checkpoint(TRUNCATE)")
  const backup = path.join(path.dirname(databasePath), `${path.basename(databasePath)}.before-permission-repair-${Date.now()}`)
  copyFileSync(databasePath, backup)
  return backup
}
