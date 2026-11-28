import type { Zone } from '../../../types/marketplace'

/**
 * Resolve the destination for a gateway Skip action.
 *
 * A zone is selected only by clicking/starting its card transition. Hover
 * state and a zone saved by an earlier visit must not change this visit's
 * no-selection default.
 */
export function resolveGatewaySkipZone(selectedZone: Zone | null): Zone {
  return selectedZone ?? 'kids'
}
