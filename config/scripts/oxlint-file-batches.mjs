// Why: Windows rejects the full changed-file argv before Oxlint can report diagnostics.
export function batchOxlintFiles(files, maxArgumentChars = 6_000) {
  const batches = []
  let batch = []
  let length = 0
  for (const file of files) {
    const argumentLength = file.length + 3
    if (argumentLength > maxArgumentChars) {
      throw new Error(`Oxlint file path exceeds the argument budget: ${file}`)
    }
    if (batch.length && length + argumentLength > maxArgumentChars) {
      batches.push(batch)
      batch = []
      length = 0
    }
    batch.push(file)
    length += argumentLength
  }
  if (batch.length) {
    batches.push(batch)
  }
  return batches
}
