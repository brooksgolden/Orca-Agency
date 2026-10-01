import { describe, expect, it } from 'vitest'
import { makeBufferLine } from './terminal-link-provider-buffer-fixtures'
import { contextualFileLinkTargets } from './terminal-relative-file-link-context'

function bufferFor(
  rows: ReturnType<typeof makeBufferLine>[]
): Parameters<typeof contextualFileLinkTargets>[0] {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The parser reads only translateToString, length, and isWrapped from these terminal line fixtures.
  return { getLine: (index: number) => rows[index] } as unknown as Parameters<
    typeof contextualFileLinkTargets
  >[0]
}

function targets(lines: string[], relativePath: string, cwd = '/workspace/client'): string[] {
  const rows = lines.map((text) => makeBufferLine(text))
  rows.push(makeBufferLine(relativePath))
  return contextualFileLinkTargets(bufferFor(rows), rows.length, relativePath, cwd).map(
    (candidate) => candidate.absolutePath
  )
}

describe('terminal relative file context', () => {
  it('uses an exact absolute path printed earlier in the same pane', () => {
    expect(targets(['Wrote /workspace/app/docs/agent/linked.md'], 'docs/agent/linked.md')).toEqual([
      '/workspace/app/docs/agent/linked.md'
    ])
  })

  it('uses an explicit Windows parent path to locate a sibling file', () => {
    expect(
      targets(
        ['Wrote ..\\..\\app-code\\docs\\agent\\research-requests\\r6.md'],
        'docs/agent/research-requests/README.md',
        'C:\\Users\\alex\\dev\\clients\\Client-One'
      )
    ).toEqual(['C:/Users/alex/dev/app-code/docs/agent/research-requests/README.md'])
  })

  it('reassembles a soft-wrapped explicit path', () => {
    const rows = [
      makeBufferLine('Write(~\\dev\\app-code\\docs\\agent\\'),
      makeBufferLine('research-requests\\r6.md)', { isWrapped: true }),
      makeBufferLine('docs/agent/research-requests/README.md')
    ]
    const candidates = contextualFileLinkTargets(
      bufferFor(rows),
      3,
      'docs/agent/research-requests/README.md',
      'C:/Users/alex/dev/clients/Client-One'
    )
    expect(candidates.map((candidate) => candidate.absolutePath)).toContain(
      'C:/Users/alex/dev/app-code/docs/agent/research-requests/README.md'
    )
  })

  it('keeps competing anchors and repeated directory sequences distinct', () => {
    expect(
      targets(
        [
          '/one/docs/agent/readme-a.md',
          '/two/docs/agent/readme-b.md',
          '/repo/docs/agent/sub/docs/agent/readme-c.md'
        ],
        'docs/agent/linked.md'
      )
    ).toEqual([
      '/repo/docs/agent/linked.md',
      '/repo/docs/agent/sub/docs/agent/linked.md',
      '/two/docs/agent/linked.md',
      '/one/docs/agent/linked.md'
    ])
  })

  it('does not infer a base from ordinary prose or a different pane', () => {
    expect(targets(['The docs/agent/linked.md file is ready'], 'docs/agent/linked.md')).toEqual([])
    const otherPane = bufferFor([makeBufferLine('docs/agent/linked.md')])
    expect(contextualFileLinkTargets(otherPane, 1, 'docs/agent/linked.md', '/workspace')).toEqual(
      []
    )
  })

  it('keeps a target clickable after nine sibling paths in the same directory', () => {
    const anchors = Array.from(
      { length: 9 },
      (_value, index) => `Wrote /app-code/docs/agent/r${index + 1}.md`
    )
    const candidates = targets(anchors, 'docs/agent/README.md')
    expect(candidates).toHaveLength(9)
    expect(new Set(candidates)).toEqual(new Set(['/app-code/docs/agent/README.md']))
  })

  it('accepts a dotted first folder with exact evidence', () => {
    expect(
      targets(['Wrote /app-code/.github/workflows/build.yml'], '.github/workflows/build.yml')
    ).toEqual(['/app-code/.github/workflows/build.yml'])
  })
})
