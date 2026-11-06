const CAPACITY_SIGNATURE = 'Selectedmodelisatcapacity.Pleasetryadifferentmodel.'
const BAD_REQUEST_SIGNATURE = '{"detail":"BadRequest"}'
const CSI_PATTERN = `${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`
const CSI_SEQUENCE = new RegExp(CSI_PATTERN, 'g')

export type CodexCapacityFailureKind = 'capacity' | 'bad-request'

export function detectCodexCapacityFailure(text: string): CodexCapacityFailureKind | undefined {
  // ConPTY may put erase-line CSI at either a mid-word wrap or a word boundary.
  // Removing the newline with no replacement corrupts one of those two shapes,
  // so compare the exact notices after removing all CSI and whitespace instead.
  // The rendered-screen/composer proof still gates every write.
  const normalized = text.replace(CSI_SEQUENCE, '').replace(/\s+/g, '')
  const capacityIndex = normalized.lastIndexOf(CAPACITY_SIGNATURE)
  const badRequestIndex = normalized.lastIndexOf(BAD_REQUEST_SIGNATURE)
  if (capacityIndex === -1 && badRequestIndex === -1) {
    return undefined
  }
  return badRequestIndex > capacityIndex ? 'bad-request' : 'capacity'
}
