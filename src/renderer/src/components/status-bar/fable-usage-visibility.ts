import type { ProviderRateLimits } from '../../../../shared/rate-limit-types'

export function visibleFableUsage(limits: ProviderRateLimits, show: boolean): ProviderRateLimits {
  return show || !limits.fableWeekly ? limits : { ...limits, fableWeekly: null }
}
