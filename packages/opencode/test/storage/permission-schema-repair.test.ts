import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { existsSync, mkdtempSync, rmSync } from "fs"
import os from "os"
import path from "path"
import { repairLegacyPermissionSchema } from "@/storage/permission-schema-repair"

describe("legacy permission schema repair", () => {
  test("backs up and rebuilds the legacy permission table", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "opencode-permission-repair-"))
    const databasePath = path.join(directory, "opencode.db")
    const sqlite = new Database(databasePath)

    try {
      sqlite.exec(`
        CREATE TABLE project (id text PRIMARY KEY);
        CREATE TABLE permission (
          id text PRIMARY KEY,
          project_id text NOT NULL,
          action text NOT NULL,
          resource text NOT NULL,
          time_created integer NOT NULL,
          time_updated integer NOT NULL
        );
        INSERT INTO project VALUES ('project_1');
        INSERT INTO permission VALUES ('permission_1', 'project_1', 'bash', '*', 10, 20);
      `)

      const repair = repairLegacyPermissionSchema(sqlite, databasePath)

      expect(repair.repaired).toBe(true)
      if (!repair.repaired) throw new Error("Expected legacy permission schema to be repaired")
      expect(existsSync(repair.backup)).toBe(true)
      expect(sqlite.query("PRAGMA table_info(permission)").all()).toEqual([
        { cid: 0, name: "project_id", type: "TEXT", notnull: 0, dflt_value: null, pk: 1 },
        { cid: 1, name: "time_created", type: "INTEGER", notnull: 1, dflt_value: null, pk: 0 },
        { cid: 2, name: "time_updated", type: "INTEGER", notnull: 1, dflt_value: null, pk: 0 },
        { cid: 3, name: "data", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
      ])
      expect(sqlite.query("SELECT * FROM permission").all()).toEqual([
        { project_id: "project_1", time_created: 10, time_updated: 20, data: "[]" },
      ])
      expect(sqlite.query(`SELECT action, resource FROM ${repair.legacyTable}`).all()).toEqual([
        { action: "bash", resource: "*" },
      ])
      expect(repairLegacyPermissionSchema(sqlite, databasePath)).toEqual({ repaired: false })
    } finally {
      sqlite.close()
      rmSync(directory, { force: true, recursive: true })
    }
  })
})
