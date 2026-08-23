import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { transact } from '../src/transaction.ts'

let db: DatabaseSync | undefined
afterEach(() => {
  db?.close()
  db = undefined
})

function open(): DatabaseSync {
  const opened = new DatabaseSync(':memory:')
  opened.exec('CREATE TABLE t (n INTEGER PRIMARY KEY) STRICT')
  db = opened
  return opened
}

describe('immediate transactions', () => {
  it('commits what the body wrote and returns its value', () => {
    const opened = open()
    const value = transact(opened, () => {
      opened.prepare('INSERT INTO t (n) VALUES (1)').run()
      return 'done'
    })
    expect(value).toBe('done')
    expect(opened.prepare('SELECT COUNT(*) AS n FROM t').get()).toMatchObject({ n: 1 })
  })

  it('rolls back and rethrows when the body throws', () => {
    const opened = open()
    expect(() => transact(opened, () => {
      opened.prepare('INSERT INTO t (n) VALUES (2)').run()
      throw new Error('body failed')
    })).toThrow('body failed')
    expect(opened.prepare('SELECT COUNT(*) AS n FROM t').get()).toMatchObject({ n: 0 })
  })
})
