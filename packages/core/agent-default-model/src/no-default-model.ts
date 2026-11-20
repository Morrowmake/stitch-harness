/** The failure a new Agent reports while no default model is configured. */

/** `HarnessError` code thrown by `AgentDefaultModelConfig.currentSelection` when no default model is configured. */
export const NO_DEFAULT_MODEL = 'NO_DEFAULT_MODEL'

/**
 * Plain guidance for a deployment whose default model is unset. Deployments
 * configured by hand set provider/model for agent-default-model in their
 * profile patch instead.
 */
export const NO_DEFAULT_MODEL_MESSAGE = 'No AI model is set up yet. Add one in Settings → Models.'
