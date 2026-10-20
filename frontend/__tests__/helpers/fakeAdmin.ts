import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * A small in-memory stand-in for the admin client, for code that reads and
 * writes jobs, transcripts, webhook receipts and failed events. It follows
 * PostgREST's answers closely enough for those chains: `.select()` after an
 * update returns the changed rows, `maybeSingle()` one row or null, and an
 * insert that breaks a unique key answers with code 23505. Like PostgREST v14,
 * an update filtered with `or` must return the columns that filter names.
 */

export type Row = Record<string, unknown>

type Result = { data: unknown; error: { message: string; code?: string } | null }

// Columns that must be unique together, per table.
const UNIQUE_KEYS: Record<string, string[]> = {
    webhook_receipts: ['provider', 'request_id'],
}

export class FakeAdmin {
    tables: Record<string, Row[]> = { jobs: [], transcripts: [], webhook_receipts: [], failed_events: [] }
    /** Updates of these tables fail without committing. */
    failingUpdates = new Set<string>()

    from(table: string) {
        this.tables[table] ??= []
        return new FakeQuery(this, table)
    }

    rows(table: string): Row[] {
        return this.tables[table] ?? []
    }

    asClient(): SupabaseClient {
        return this as unknown as SupabaseClient
    }
}

type Filter = (row: Row) => boolean

class FakeQuery implements PromiseLike<Result> {
    private filters: Filter[] = []
    private patch: Row | null = null
    private inserted: Row | null = null
    private returning = false
    private cardinality: 'one' | 'maybe' | null = null
    private returnedColumns: string[] | null = null
    private orColumns: string[] = []

    constructor(private db: FakeAdmin, private table: string) {}

    select(columns = '*') {
        if (this.patch || this.inserted) {
            this.returning = true
            this.returnedColumns = columns === '*' ? null : columns.split(',').map((column) => column.trim())
        }
        return this
    }
    insert(row: Row) {
        this.inserted = row
        return this
    }
    update(patch: Row) {
        this.patch = patch
        return this
    }
    eq(column: string, value: unknown) {
        this.filters.push((row) => row[column] === value)
        return this
    }
    neq(column: string, value: unknown) {
        this.filters.push((row) => row[column] !== value)
        return this
    }
    in(column: string, values: unknown[]) {
        this.filters.push((row) => values.includes(row[column]))
        return this
    }
    /** Supports the `col.is.null` and `col.eq.value` forms, joined by commas. */
    or(expression: string) {
        const alternatives = expression.split(',').map((part) => {
            const [column, op, ...rest] = part.split('.')
            this.orColumns.push(column)
            const value = rest.join('.')
            if (op === 'is' && value === 'null') return (row: Row) => row[column] === null || row[column] === undefined
            if (op === 'eq') return (row: Row) => String(row[column]) === value
            throw new Error(`FakeAdmin: unsupported or() part ${part}`)
        })
        this.filters.push((row) => alternatives.some((matches) => matches(row)))
        return this
    }
    order() {
        return this
    }
    limit() {
        return this
    }
    maybeSingle() {
        this.cardinality = 'maybe'
        return Promise.resolve(this.run())
    }
    single() {
        this.cardinality = 'one'
        return Promise.resolve(this.run())
    }
    then<A, B>(
        onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
        onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null
    ) {
        return Promise.resolve(this.run()).then(onfulfilled, onrejected)
    }

    private matches(): Row[] {
        return this.db.rows(this.table).filter((row) => this.filters.every((matches) => matches(row)))
    }

    private answer(rows: Row[]): Result {
        if (this.cardinality === 'maybe') return { data: rows[0] ?? null, error: null }
        if (this.cardinality === 'one') {
            return rows.length === 1
                ? { data: rows[0], error: null }
                : { data: null, error: { message: 'expected one row', code: 'PGRST116' } }
        }
        return { data: rows, error: null }
    }

    private run(): Result {
        if (this.inserted) {
            const row: Row = { id: crypto.randomUUID(), ...this.inserted }
            const key = UNIQUE_KEYS[this.table]
            if (key && this.db.rows(this.table).some((existing) => key.every((column) => existing[column] === row[column]))) {
                return { data: null, error: { message: 'duplicate key value', code: '23505' } }
            }
            this.db.rows(this.table).push(row)
            return this.returning ? this.answer([row]) : { data: null, error: null }
        }
        if (this.patch) {
            if (this.db.failingUpdates.has(this.table)) return { data: null, error: { message: 'write failed' } }
            const missing = this.returnedColumns && this.orColumns.find((column) => !this.returnedColumns!.includes(column))
            if (this.returning && missing) {
                return { data: null, error: { message: `column ${this.table}.${missing} does not exist`, code: '42703' } }
            }
            const rows = this.matches()
            for (const row of rows) Object.assign(row, this.patch)
            return this.returning ? this.answer(rows) : { data: null, error: null }
        }
        return this.answer(this.matches())
    }
}
