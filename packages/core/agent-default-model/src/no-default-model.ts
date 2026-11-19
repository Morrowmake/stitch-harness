/** The failure a new Agent reports while no default model is configured. */

/** `HarnessError` code thrown by `AgentDefaultModelConfig.currentSelection` when no default model is configured. */
export const NO_DEFAULT_MODEL = 'NO_DEFAULT_MODEL'

/** Actionable report for a deployment whose default model is unset. */
export const NO_DEFAULT_MODEL_MESSAGE = 'No model provider configured. Add one in Settings → Models, '
  + 'or set provider/model for agent-default-model in your profile patch.'
