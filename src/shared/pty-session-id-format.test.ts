import { describe, expect, it } from 'vitest'
import { isPtySessionMintedFor, ptySessionOwnerIds } from './pty-session-id-format'

// Shaped like the September 2026 folder migration: repo id and path both changed, instance kept.
const OLD_ID = 'b3336966::C:/dev/claude/General::workspace:f23cd281'
const NEW_ID = 'f63d7fa2::C:/dev/claude/Local Apps/Orca::workspace:f23cd281'

describe('PTY session ownership across identity migrations', () => {
  it('lets a migrated workspace own sessions minted under its prior id', () => {
    const owners = ptySessionOwnerIds(NEW_ID, {
      orca: [{ id: NEW_ID, priorWorktreeIds: [OLD_ID] }]
    })
    expect(owners).toEqual([NEW_ID, OLD_ID])
    expect(isPtySessionMintedFor(`${OLD_ID}@@867d8f22`, owners)).toBe(true)
    expect(isPtySessionMintedFor(`${NEW_ID}@@abcd1234`, owners)).toBe(true)
  })

  it('never lends a prior id that a live workspace uses again', () => {
    const owners = ptySessionOwnerIds(NEW_ID, {
      orca: [{ id: NEW_ID, priorWorktreeIds: [OLD_ID] }],
      general: [{ id: OLD_ID }]
    })
    expect(owners).toEqual([NEW_ID])
    expect(isPtySessionMintedFor(`${OLD_ID}@@867d8f22`, owners)).toBe(false)
  })

  it('rejects foreign, unminted and degenerate session ids', () => {
    const owners = ptySessionOwnerIds(NEW_ID, {
      orca: [{ id: NEW_ID, priorWorktreeIds: [OLD_ID] }]
    })
    expect(isPtySessionMintedFor('other::C:/dev/claude/Personal@@867d8f22', owners)).toBe(false)
    expect(isPtySessionMintedFor('867d8f22-bare-uuid', owners)).toBe(false)
    expect(isPtySessionMintedFor('@@867d8f22', [''])).toBe(false)
    // Why exact: a prefix of the prior id is a different workspace.
    expect(isPtySessionMintedFor('b3336966::C:/dev/claude/General@@867d8f22', owners)).toBe(false)
  })

  it('keeps only the workspace itself when it has no recorded history', () => {
    expect(ptySessionOwnerIds(NEW_ID, {})).toEqual([NEW_ID])
  })
  it('does not borrow aliases from an ambiguous cross-host workspace id', () => {
    expect(
      ptySessionOwnerIds(NEW_ID, {
        local: [{ id: NEW_ID, priorWorktreeIds: [OLD_ID] }],
        remote: [{ id: NEW_ID, priorWorktreeIds: ['foreign-old'] }]
      })
    ).toEqual([NEW_ID])
  })
})
