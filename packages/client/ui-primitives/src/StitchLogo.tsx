import clsx from 'clsx'
import type { IconProps } from './icons/props.ts'
import css from './StitchLogo.module.css'

/** Class carrying the mark palette, for svgs that embed {@link StitchMarkArtwork}. */
export const STITCH_MARK_CLASS = css.mark

/**
 * Render the Stitch patchwork mark: three filled tiles and one open stitched
 * tile. The palette follows the active light or dark theme.
 * @param props.size - width and height in px (default 24).
 * @param props.className - extra class for layout placement.
 * @returns the mark svg (aria-hidden; pair with the wordmark for accessibility).
 */
export function StitchLogo({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      className={clsx(STITCH_MARK_CLASS, className)}
      viewBox="4 4 40 40"
      fill="none"
      aria-hidden="true"
    >
      <StitchMarkArtwork />
    </svg>
  )
}

/**
 * The mark's tiles in its native 48-unit artwork space (bounds 4..44), shared
 * by {@link StitchLogo} and the wordmark. Colors come from an enclosing
 * element carrying {@link STITCH_MARK_CLASS}.
 * @returns the mark's svg children.
 */
export function StitchMarkArtwork() {
  return (
    <>
      <rect x="4" y="4" width="18.5" height="18.5" rx="4.5" className={css.ink} />
      <rect x="7.25" y="7.25" width="12" height="12" rx="2.25" className={css.inkThread} strokeWidth="1.1" strokeDasharray="2.4 1.8" strokeLinecap="round" />
      <rect x="25.5" y="4" width="18.5" height="18.5" rx="4.5" className={css.accent} />
      <rect x="28.75" y="7.25" width="12" height="12" rx="2.25" className={css.accentThread} strokeWidth="1.1" strokeDasharray="2.4 1.8" strokeLinecap="round" />
      <rect x="4" y="25.5" width="18.5" height="18.5" rx="4.5" className={css.soft} />
      <rect x="7.25" y="28.75" width="12" height="12" rx="2.25" className={css.softThread} strokeWidth="1.1" strokeDasharray="2.4 1.8" strokeLinecap="round" />
      <rect x="26.4" y="26.4" width="16.7" height="16.7" rx="4" className={css.openThread} strokeWidth="1.6" strokeDasharray="3 2.2" strokeLinecap="round" />
      <path d="M34.75 31.5v6.5M31.5 34.75h6.5" className={css.openThread} strokeWidth="1.6" strokeLinecap="round" />
    </>
  )
}
