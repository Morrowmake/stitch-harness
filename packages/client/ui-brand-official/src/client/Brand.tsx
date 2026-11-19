import { BrandWordmark, StitchLogo } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'

/**
 * Render the official mark with the presentation requested by its host surface.
 * @param props - Host-supplied mark presentation.
 * @returns the Stitch mark.
 */
export function OfficialBrandMark({ size }: SidebarBrandMarkOwnerProps) {
  return <StitchLogo size={size} />
}

/**
 * Render the official name artwork without its independently slotted mark.
 * @returns the Stitch name wordmark.
 */
export function OfficialBrandName() {
  return <BrandWordmark includeMark={false} />
}
