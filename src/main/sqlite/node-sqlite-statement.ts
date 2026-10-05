import type { StatementResultingChanges } from 'node:sqlite'
import { SqliteIntegerReader } from './sqlite-integer-reader'
import type { SqliteBindings, SqliteRow, SqliteStatement } from './sqlite-statement'

export class NodeSqliteStatement implements SqliteStatement {
  private readonly integers = new SqliteIntegerReader()

  constructor(private readonly statement: SqliteStatement) {
    // Native number reads overflow their INT64_MIN guard on some builds and round insert rowids.
    statement.setReadBigInts(true)
  }

  all(...parameters: SqliteBindings): SqliteRow[] {
    this.validateBindings(parameters)
    const rows = this.statement.all(...parameters)
    for (const row of rows) {
      this.integers.row(row)
    }
    return rows
  }

  get(...parameters: SqliteBindings): SqliteRow | undefined {
    this.validateBindings(parameters)
    const row = this.statement.get(...parameters)
    return row === undefined ? undefined : this.integers.row(row)
  }

  run(...parameters: SqliteBindings): StatementResultingChanges {
    this.validateBindings(parameters)
    return this.integers.result(this.statement.run(...parameters))
  }

  *iterate(...parameters: SqliteBindings): IterableIterator<SqliteRow> {
    this.validateBindings(parameters)
    for (const row of this.statement.iterate(...parameters)) {
      yield this.integers.row(row)
    }
  }

  setReadBigInts(enabled: boolean): void {
    this.integers.readBigInts = enabled
  }

  private validateBindings(parameters: SqliteBindings): void {
    // Node 26 accepts undefined as NULL; preserve the same binding contract as Bun.
    if (parameters.some((value) => value === undefined)) {
      throw new TypeError('Undefined cannot be bound to a SQLite parameter')
    }
  }
}
