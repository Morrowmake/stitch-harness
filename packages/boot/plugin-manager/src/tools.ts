/** Agent-facing current-profile management using the same service as Web controls. */
import { assertNever } from '@deepseek-ai/dsh-util-values'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type {} from './index.ts'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-user-approval'
import { approveEscalation } from '@deepseek-ai/dsh-sandbox'
import type { ChangeResult, ManagementError, PluginEntryId, PluginInstallFailureKind, RestartReason } from './types.ts'
import { defineTool, ToolArgsError } from '@deepseek-ai/dsh-tools'
import { getDshRuntimeVersion } from '@deepseek-ai/dsh-app-boot'
import { installSubject, managementApprovalText, type ManagementChange } from './approval-text.ts'

/** What the model does next for each refusal the manager reports. */
const ERROR_STEPS: Record<ManagementError['code'], string> = {
  'management-required': 'This entry belongs to plugin management itself and cannot be changed.',
  'unaddressable': 'This entry has no unique profile patch target; tell the user to edit the profile patch file directly.',
  'unknown-plugin': 'Call list_plugins and retry with an exact entryId.',
  'invalid-spec': 'Retry with an npm package name, a git URL, a tarball URL, or an absolute local directory.',
  'already-installed': 'The package is already installed. To reload its files after an in-place change, call set_plugin with enabled true on its entry from list_plugins; to install another version, call remove_bundle first, then install_bundle again.',
  'ambiguous-install': 'The dependency change named no single package; call list_bundles to see what was installed.',
  'not-bundle': 'The package declares no dsh.bundle and cannot be managed as a plugin; install a Stitch plugin bundle instead.',
  'not-removable': 'Call list_bundles; only bundles marked removable can be removed.',
  'stop-profile': 'This profile runs without HMR; tell the user to stop Stitch and run `stitch plugin --profile <profile> remove <bundle>`.',
  'bundle-in-use': 'Call list_plugins, disable the entries from other layers that still use this bundle, then retry.',
  'stale-approval': 'Call install_bundle again without approvedBuilds to read the current pendingBuilds.',
  'incompatible-version': 'Install a version compatible with the running Stitch. A version exemption needs the user\'s explicit acceptance of crash and data-loss risk.',
  'unsupported-platform': 'This bundle cannot run on the current Host platform; ask the user to use a supported Host.',
  'unexpected-package': 'The source installed another package or version than requested and was rolled back; report this to the user.',
  'operation-error': 'Report the diagnostic to the user; retry only after its cause is addressed.',
}

/** What the model does next for each package-manager failure. */
const FAILURE_STEPS: Partial<Record<PluginInstallFailureKind, string>> = {
  'pnpm-missing': 'pnpm is not available to Stitch; tell the user to install pnpm.',
  'timeout': 'Retry, or retry with another registry.',
  'not-found': 'Check the package name and version with the user, then retry.',
  'no-matching-version': 'Retry with a published version.',
  'network': 'Retry later or pass another registry.',
  'disk-full': 'Tell the user to free disk space, then retry.',
  'permission': 'Tell the user Stitch cannot write the profile directory; retry after they fix its permissions.',
  'build-blocked': 'Ask the user whether to allow the install scripts of the packages in pendingBuilds; if they approve, retry with approvedBuilds.',
}

/** Why a change waits for a restart, as the model tells the user. */
const RESTART_STEPS: Record<RestartReason, string> = {
  'no-hmr': 'this profile applies changes only at startup',
  'package-moved': 'an installed package now resolves to another directory, or the change replaces a package the Stitch installation provides; remove a package before installing it from another location',
  'host-module': 'the change reaches modules Stitch itself loaded',
  'unmanaged-plugin': 'the change reaches a plugin running outside the plugin list',
  'module-comparison': 'Stitch could not compare loaded plugins with their files',
}

/**
 * The model-facing result of a change: the manager's result plus the next step its outcome calls for.
 * @param result The manager's result.
 * @returns The result with `nextStep` when it is not plainly applied.
 */
function withNextStep(result: ChangeResult): ChangeResult & { nextStep?: string } {
  switch (result.application) {
    case 'applied':
      return result
    case 'cancelled':
      return { ...result, nextStep: 'The installation was cancelled and its files restored; nothing changed.' }
    case 'overridden':
      return { ...result, nextStep: 'Saved, but a higher-priority layer such as the agent preset overrides it; tell the user it is not in effect.' }
    case 'restart-required': {
      const reason = result.restartReason === undefined ? '' : `: ${RESTART_STEPS[result.restartReason]}`
      return { ...result, nextStep: `Tell the user to restart Stitch to apply this change${reason}.` }
    }
    case 'failed': {
      const code = result.error?.code ?? 'operation-error'
      // A refusal code is more specific than the package manager's failure kind.
      const kind = code === 'operation-error' ? result.packageResult?.kind : undefined
      return { ...result, nextStep: (kind === undefined ? undefined : FAILURE_STEPS[kind]) ?? ERROR_STEPS[code] }
    }
    /* v8 ignore next -- ChangeResult.application is a closed union */
    default: return assertNever(result.application)
  }
}

/** Required services for the management tool. */
export const inject = ['tools', 'pluginManager', 'sandboxPolicy']

/** Register one management tool: listing runs directly, and each persistent change asks for approval.
 * @param ctx Agent-scoped tool registration context.
 */
export function apply(ctx: Context): void {
  /**
   * Ask the user to allow one change unless the session already has full access.
   * @param args Raw tool arguments, kept verbatim in the audit reason.
   * @param exec The calling execution.
   * @param describe Builds the plain-language description of the change, only when a prompt is needed.
   * @param grant The action class the user may allow for the rest of the chat; `undefined` asks every time.
   */
  const approveChange = async (
    args: object, exec: ToolRunContext, describe: () => Promise<ManagementChange>, grant: string | undefined,
  ): Promise<void> => {
    const policy = ctx.sandboxPolicy.resolve(exec.agent === undefined ? {} : { session: exec.agent.session })
    if (policy.mode !== 'danger-full-access') {
      await approveEscalation({
        requestedMode: 'danger-full-access', effectiveMode: policy.mode, subject: 'plugin management operation',
        justification: `plugin_manager ${JSON.stringify(args)}. Profile changes persist across sessions; installed Host code runs outside the workspace sandbox.`,
        grant, display: managementApprovalText(await describe()),
      }, { approver: ctx.get('approval'), agent: exec.agent, callId: exec.callId,
        toolName: 'plugin_manager', signal: exec.signal })
    }
    exec.signal.throwIfAborted()
  }
  /**
   * The display title of a configured plugin entry or bundle, falling back to its identifier.
   * @param kind Whether `target` is a plugin entry id or a bundle package name.
   * @param target The identifier the model passed.
   * @returns The title in every available language, or the identifier.
   */
  const titleOf = async (kind: 'plugin' | 'bundle', target: string) => (kind === 'plugin'
    ? (await ctx.pluginManager.listPlugins()).find(row => row.entryId === target)?.meta?.title
    : (await ctx.pluginManager.listBundles()).find(row => row.name === target)?.meta?.title) ?? target
  ctx.tools.register(defineTool({
    name: 'plugin_manager',
    shortPrompt: { summary: 'List, enable, disable, install, or remove plugins in this profile' },
    description: 'List plugins or bundles in the current profile, enable or disable them, install a bundle, or remove an installed bundle. Listing needs no approval; every change requires danger-full-access permission or approval for this call. Approval does not change the session permission mode. Changes affect every session in this profile. List first to obtain exact identifiers. Package installation can execute allowed build scripts. The application field of a change result is authoritative: applied means the change is in effect and needs no restart; any other value carries nextStep, which says what to do or tell the user. Unmet Stitch version requirements (engines.dsh, else Stitch peer dependencies) block installation and activation. Version exemptions risk crashes and data loss: warn the user and obtain explicit permission for the exact plugin and runtime versions before granting one.',
    parameters: {
      action: { type: 'string', required: true, enum: ['list_plugins', 'list_bundles', 'set_plugin', 'set_bundle', 'install_bundle', 'remove_bundle', 'list_version_exemptions', 'set_version_exemption'], description: 'Management operation.' },
      target: { type: 'string', description: 'Plugin entry id, bundle package name, or installation spec, according to action.' },
      enabled: { type: 'boolean', description: 'Required for set operations; defaults to true for installation. For set_version_exemption, true grants and false revokes.' },
      runtimeVersion: { type: 'string', description: 'For set_version_exemption: exact Stitch version from list_version_exemptions. Target must be the manifest package-name@version, not an alias or version range.' },
      acceptRisk: { type: 'boolean', description: 'For granting an exemption: true only after warning the user about possible crashes and data loss and receiving explicit permission for this exact plugin/runtime pair. General installation permission is not enough.' },
      approvedBuilds: { type: 'array', items: { type: 'string' }, description: 'For install_bundle: pass names from pendingBuilds only after the user explicitly approves running their install scripts in the conversation. This grants persistent permission for this profile.' },
      registry: { type: 'string', description: 'For install_bundle: the npm registry URL asked first, when the user names one; otherwise the configured registry is asked, and its configured fallbacks while a registry is unreachable.' },
      offset: { type: 'number', description: 'Zero-based list offset; defaults to 0.' },
      limit: { type: 'number', description: 'List page size, from 1 to 100; defaults to 25.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      const manager = ctx.pluginManager
      switch (args.action) {
        case 'list_version_exemptions':
          return JSON.stringify({ runtimeVersion: getDshRuntimeVersion(), ...manager.listVersionExemptions() })
        case 'set_version_exemption': {
          const { target, runtimeVersion, enabled } = args
          if (target === undefined || runtimeVersion === undefined || enabled === undefined) {
            throw new ToolArgsError(['target package-name@version, runtimeVersion, and enabled are required'])
          }
          // Each exemption is its own risk acceptance, so it is never allowed for the whole chat.
          await approveChange(args, exec, () => Promise.resolve({ kind: enabled ? 'exempt' : 'unexempt', name: target, runtimeVersion }), undefined)
          return JSON.stringify(withNextStep(
            await manager.setVersionExemption(target, runtimeVersion, enabled, args.acceptRisk)))
        }
        case 'list_plugins':
        case 'list_bundles': {
          const offset = args.offset ?? 0
          const limit = args.limit ?? 25
          if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
            throw new ToolArgsError(['offset must be a non-negative integer and limit must be an integer from 1 to 100'])
          }
          exec.signal.throwIfAborted()
          const rows = args.action === 'list_plugins' ? await manager.listPlugins() : await manager.listBundles()
          const entries = rows.slice(offset, offset + limit).map(({ meta: _meta, ...row }) =>
            'rows' in row
              // GUI listing and update eligibility do not change the tool's management operations.
              ? (({ update: _update, listedByDefault: _listedByDefault, ...bundle }) => ({
                ...bundle, rows: bundle.rows.map(({ meta: _rowMeta, ...declared }) => declared),
              }))(row)
              : row)
          return JSON.stringify({ entries, total: rows.length,
            nextOffset: offset + entries.length < rows.length ? offset + entries.length : null })
        }
        case 'set_plugin':
        case 'set_bundle': {
          const { target, enabled } = args
          if (target === undefined || enabled === undefined) throw new ToolArgsError(['target and enabled are required'])
          const kind = enabled ? 'enable' : 'disable'
          await approveChange(args, exec, async () => ({
            kind, name: await titleOf(args.action === 'set_plugin' ? 'plugin' : 'bundle', target),
          }), kind)
          return JSON.stringify(withNextStep(await (args.action === 'set_plugin'
            ? manager.setPluginEnabled(target as PluginEntryId, enabled)
            : manager.setBundleEnabled(target, enabled))))
        }
        case 'install_bundle': {
          const { target, approvedBuilds = [] } = args
          if (target === undefined) throw new ToolArgsError(['target package spec is required'])
          // Approving build scripts persists for the profile, so that install is never allowed for the whole chat.
          await approveChange(args, exec, () => Promise.resolve({
            kind: 'install', ...installSubject(target), enabled: args.enabled ?? true, builds: approvedBuilds,
          }), approvedBuilds.length === 0 ? 'install' : undefined)
          return JSON.stringify(withNextStep(await manager.installBundle(target, {
            ...args.enabled === undefined ? {} : { enabled: args.enabled },
            ...args.approvedBuilds === undefined ? {} : { approvedBuilds: args.approvedBuilds },
            ...args.registry === undefined ? {} : { registry: args.registry },
          })))
        }
        case 'remove_bundle': {
          const { target } = args
          if (target === undefined) throw new ToolArgsError(['target bundle name is required'])
          await approveChange(args, exec, async () => ({ kind: 'remove', name: await titleOf('bundle', target) }), 'remove')
          return JSON.stringify(withNextStep(await manager.removeBundle(target)))
        }
        /* v8 ignore next -- tool JSON validation rejects actions outside the declared enum */
        default: return assertNever(args.action)
      }
    },
    presentCall: args => ({ card: 'generic', title: 'Manage profile plugins', kind: args.action.startsWith('list_') ? 'read' : 'other', rawInput: args }),
  }))
}
