/** Ordinary release entry; qualification imports the environment-independent factory. */
import { createElectronBuilderConfig, DESKTOP_PACKAGE_NAME } from './scripts/electron-builder-config.mjs'

export { createElectronBuilderConfig, DESKTOP_PACKAGE_NAME }
export default createElectronBuilderConfig()
