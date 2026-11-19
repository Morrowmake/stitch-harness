import clsx from 'clsx'
import type { IconProps } from './icons/props.ts'
import { STITCH_MARK_CLASS, StitchMarkArtwork } from './StitchLogo.tsx'

/** Brand name set in the wordmark; a proper noun, never translated. */
const WORDMARK = 'Stitch'

/** Display options for the brand wordmark. */
export interface BrandWordmarkProps extends IconProps {
  /** Whether to include the leading Stitch mark; defaults to true. */
  includeMark?: boolean | undefined
}

/**
 * Render the full brand wordmark: the Stitch mark followed by the name in currentColor.
 * @param props.size - height in px (default 24; width follows the selected artwork).
 * @param props.className - extra class for layout placement.
 * @param props.includeMark - whether to include the leading Stitch mark.
 * @returns the wordmark svg (aria-hidden decorative brand art).
 */
export function BrandWordmark({ size = 24, className, includeMark = true }: BrandWordmarkProps) {
  const width = includeMark ? 90 : 62
  return (
    <svg
      width={(size * width) / 24}
      height={size}
      className={clsx(STITCH_MARK_CLASS, className)}
      viewBox={includeMark ? '0 0 90 24' : '28 0 62 24'}
      fill="none"
      aria-hidden="true"
    >
      {includeMark && (
        <g transform="translate(-2.4 -2.4) scale(0.6)">
          <StitchMarkArtwork />
        </g>
      )}
      <text x="30" y="18" fill="currentColor" fontFamily="Montserrat, Inter, 'Helvetica Neue', Arial, sans-serif" fontSize="17" fontWeight="600" letterSpacing="-0.25">{WORDMARK}</text>
    </svg>
  )
}
