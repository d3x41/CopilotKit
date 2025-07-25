import { RunnableConfig } from "@langchain/core/runnables";
import { dispatchCustomEvent } from "@langchain/core/callbacks/dispatch";
import { convertJsonSchemaToZodSchema, randomId, CopilotKitMisuseError } from "@copilotkit/shared";
import { Annotation, MessagesAnnotation, interrupt } from "@langchain/langgraph";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { AIMessage } from "@langchain/core/messages";

interface IntermediateStateConfig {
  stateKey: string;
  tool: string;
  toolArgument?: string;
}

interface OptionsConfig {
  emitToolCalls?: boolean | string | string[];
  emitMessages?: boolean;
  emitAll?: boolean;
  emitIntermediateState?: IntermediateStateConfig[];
}

export const CopilotKitPropertiesAnnotation = Annotation.Root({
  actions: Annotation<any[]>,
});

export const CopilotKitStateAnnotation = Annotation.Root({
  copilotkit: Annotation<typeof CopilotKitPropertiesAnnotation.State>,
  ...MessagesAnnotation.spec,
});

export type CopilotKitState = typeof CopilotKitStateAnnotation.State;
export type CopilotKitProperties = typeof CopilotKitPropertiesAnnotation.State;

/**
 * Customize the LangGraph configuration for use in CopilotKit.
 *
 * To the CopilotKit SDK, run:
 *
 * ```bash
 * npm install @copilotkit/sdk-js
 * ```
 *
 * ### Examples
 *
 * Disable emitting messages and tool calls:
 *
 * ```typescript
 * import { copilotkitCustomizeConfig } from "@copilotkit/sdk-js";
 *
 * config = copilotkitCustomizeConfig(
 *   config,
 *   emitMessages=false,
 *   emitToolCalls=false
 * )
 * ```
 *
 * To emit a tool call as streaming LangGraph state, pass the destination key in state,
 * the tool name and optionally the tool argument. (If you don't pass the argument name,
 * all arguments are emitted under the state key.)
 *
 * ```typescript
 * import { copilotkitCustomizeConfig } from "@copilotkit/sdk-js";
 *
 * config = copilotkitCustomizeConfig(
 *   config,
 *   emitIntermediateState=[
 *     {
 *       "stateKey": "steps",
 *       "tool": "SearchTool",
 *       "toolArgument": "steps",
 *     },
 *   ],
 * )
 * ```
 */
export function copilotkitCustomizeConfig(
  /**
   * The LangChain/LangGraph configuration to customize.
   */
  baseConfig: RunnableConfig,
  /**
   * Configuration options:
   * - `emitMessages: boolean?`
   *   Configure how messages are emitted. By default, all messages are emitted. Pass false to
   *   disable emitting messages.
   * - `emitToolCalls: boolean | string | string[]?`
   *   Configure how tool calls are emitted. By default, all tool calls are emitted. Pass false to
   *   disable emitting tool calls. Pass a string or list of strings to emit only specific tool calls.
   * - `emitIntermediateState: IntermediateStateConfig[]?`
   *   Lets you emit tool calls as streaming LangGraph state.
   */
  options?: OptionsConfig,
): RunnableConfig {
  if (baseConfig && typeof baseConfig !== "object") {
    throw new CopilotKitMisuseError({
      message: "baseConfig must be an object or null/undefined",
    });
  }

  if (options && typeof options !== "object") {
    throw new CopilotKitMisuseError({
      message: "options must be an object when provided",
    });
  }

  // Validate emitIntermediateState structure
  if (options?.emitIntermediateState) {
    if (!Array.isArray(options.emitIntermediateState)) {
      throw new CopilotKitMisuseError({
        message: "emitIntermediateState must be an array when provided",
      });
    }

    options.emitIntermediateState.forEach((state, index) => {
      if (!state || typeof state !== "object") {
        throw new CopilotKitMisuseError({
          message: `emitIntermediateState[${index}] must be an object`,
        });
      }

      if (!state.stateKey || typeof state.stateKey !== "string") {
        throw new CopilotKitMisuseError({
          message: `emitIntermediateState[${index}] must have a valid 'stateKey' string property`,
        });
      }

      if (!state.tool || typeof state.tool !== "string") {
        throw new CopilotKitMisuseError({
          message: `emitIntermediateState[${index}] must have a valid 'tool' string property`,
        });
      }

      if (state.toolArgument && typeof state.toolArgument !== "string") {
        throw new CopilotKitMisuseError({
          message: `emitIntermediateState[${index}].toolArgument must be a string when provided`,
        });
      }
    });
  }

  try {
    const metadata = baseConfig?.metadata || {};

    if (options?.emitAll) {
      metadata["copilotkit:emit-tool-calls"] = true;
      metadata["copilotkit:emit-messages"] = true;
    } else {
      if (options?.emitToolCalls !== undefined) {
        metadata["copilotkit:emit-tool-calls"] = options.emitToolCalls;
      }
      if (options?.emitMessages !== undefined) {
        metadata["copilotkit:emit-messages"] = options.emitMessages;
      }
    }

    if (options?.emitIntermediateState) {
      const snakeCaseIntermediateState = options.emitIntermediateState.map((state) => ({
        tool: state.tool,
        tool_argument: state.toolArgument,
        state_key: state.stateKey,
      }));

      metadata["copilotkit:emit-intermediate-state"] = snakeCaseIntermediateState;
    }

    baseConfig = baseConfig || {};

    return {
      ...baseConfig,
      metadata: metadata,
    };
  } catch (error) {
    throw new CopilotKitMisuseError({
      message: `Failed to customize config: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}
/**
 * Exits the current agent after the run completes. Calling copilotkit_exit() will
 * not immediately stop the agent. Instead, it signals to CopilotKit to stop the agent after
 * the run completes.
 *
 * ### Examples
 *
 * ```typescript
 * import { copilotkitExit } from "@copilotkit/sdk-js";
 *
 * async function myNode(state: Any):
 *   await copilotkitExit(config)
 *   return state
 * ```
 */
export async function copilotkitExit(
  /**
   * The LangChain/LangGraph configuration.
   */
  config: RunnableConfig,
) {
  if (!config) {
    throw new CopilotKitMisuseError({
      message: "LangGraph configuration is required for copilotkitExit",
    });
  }

  try {
    await dispatchCustomEvent("copilotkit_exit", {}, config);
  } catch (error) {
    throw new CopilotKitMisuseError({
      message: `Failed to dispatch exit event: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}
/**
 * Emits intermediate state to CopilotKit. Useful if you have a longer running node and you want to
 * update the user with the current state of the node.
 *
 * ### Examples
 *
 * ```typescript
 * import { copilotkitEmitState } from "@copilotkit/sdk-js";
 *
 * for (let i = 0; i < 10; i++) {
 *   await someLongRunningOperation(i);
 *   await copilotkitEmitState(config, { progress: i });
 * }
 * ```
 */
export async function copilotkitEmitState(
  /**
   * The LangChain/LangGraph configuration.
   */
  config: RunnableConfig,
  /**
   * The state to emit.
   */
  state: any,
) {
  if (!config) {
    throw new CopilotKitMisuseError({
      message: "LangGraph configuration is required for copilotkitEmitState",
    });
  }

  if (state === undefined) {
    throw new CopilotKitMisuseError({
      message: "State is required for copilotkitEmitState",
    });
  }

  try {
    await dispatchCustomEvent("copilotkit_manually_emit_intermediate_state", state, config);
  } catch (error) {
    throw new CopilotKitMisuseError({
      message: `Failed to emit state: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}
/**
 * Manually emits a message to CopilotKit. Useful in longer running nodes to update the user.
 * Important: You still need to return the messages from the node.
 *
 * ### Examples
 *
 * ```typescript
 * import { copilotkitEmitMessage } from "@copilotkit/sdk-js";
 *
 * const message = "Step 1 of 10 complete";
 * await copilotkitEmitMessage(config, message);
 *
 * // Return the message from the node
 * return {
 *   "messages": [AIMessage(content=message)]
 * }
 * ```
 */
export async function copilotkitEmitMessage(
  /**
   * The LangChain/LangGraph configuration.
   */
  config: RunnableConfig,
  /**
   * The message to emit.
   */
  message: string,
) {
  if (!config) {
    throw new CopilotKitMisuseError({
      message: "LangGraph configuration is required for copilotkitEmitMessage",
    });
  }

  if (!message || typeof message !== "string") {
    throw new CopilotKitMisuseError({
      message: "Message must be a non-empty string for copilotkitEmitMessage",
    });
  }

  try {
    await dispatchCustomEvent(
      "copilotkit_manually_emit_message",
      { message, message_id: randomId(), role: "assistant" },
      config,
    );
  } catch (error) {
    throw new CopilotKitMisuseError({
      message: `Failed to emit message: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}
/**
 * Manually emits a tool call to CopilotKit.
 *
 * ### Examples
 *
 * ```typescript
 * import { copilotkitEmitToolCall } from "@copilotkit/sdk-js";
 *
 * await copilotkitEmitToolCall(config, name="SearchTool", args={"steps": 10})
 * ```
 */
export async function copilotkitEmitToolCall(
  /**
   * The LangChain/LangGraph configuration.
   */
  config: RunnableConfig,
  /**
   * The name of the tool to emit.
   */
  name: string,
  /**
   * The arguments to emit.
   */
  args: any,
) {
  if (!config) {
    throw new CopilotKitMisuseError({
      message: "LangGraph configuration is required for copilotkitEmitToolCall",
    });
  }

  if (!name || typeof name !== "string") {
    throw new CopilotKitMisuseError({
      message: "Tool name must be a non-empty string for copilotkitEmitToolCall",
    });
  }

  if (args === undefined) {
    throw new CopilotKitMisuseError({
      message: "Tool arguments are required for copilotkitEmitToolCall",
    });
  }

  try {
    await dispatchCustomEvent(
      "copilotkit_manually_emit_tool_call",
      { name, args, id: randomId() },
      config,
    );
  } catch (error) {
    throw new CopilotKitMisuseError({
      message: `Failed to emit tool call '${name}': ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

export function convertActionToDynamicStructuredTool(actionInput: any): DynamicStructuredTool<any> {
  if (!actionInput) {
    throw new CopilotKitMisuseError({
      message: "Action input is required but was not provided",
    });
  }

  if (!actionInput.name || typeof actionInput.name !== "string") {
    throw new CopilotKitMisuseError({
      message: "Action must have a valid 'name' property of type string",
    });
  }

  if (!actionInput.description || typeof actionInput.description !== "string") {
    throw new CopilotKitMisuseError({
      message: `Action '${actionInput.name}' must have a valid 'description' property of type string`,
    });
  }

  if (!actionInput.parameters) {
    throw new CopilotKitMisuseError({
      message: `Action '${actionInput.name}' must have a 'parameters' property`,
    });
  }

  try {
    return new DynamicStructuredTool({
      name: actionInput.name,
      description: actionInput.description,
      schema: convertJsonSchemaToZodSchema(actionInput.parameters, true),
      func: async () => {
        return "";
      },
    });
  } catch (error) {
    throw new CopilotKitMisuseError({
      message: `Failed to convert action '${actionInput.name}' to DynamicStructuredTool: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}
/**
 * Use this function to convert a list of actions you get from state
 * to a list of dynamic structured tools.
 *
 * ### Examples
 *
 * ```typescript
 * import { convertActionsToDynamicStructuredTools } from "@copilotkit/sdk-js";
 *
 * const tools = convertActionsToDynamicStructuredTools(state.copilotkit.actions);
 * ```
 */
export function convertActionsToDynamicStructuredTools(
  /**
   * The list of actions to convert.
   */
  actions: any[],
): DynamicStructuredTool<any>[] {
  if (!Array.isArray(actions)) {
    throw new CopilotKitMisuseError({
      message: "Actions must be an array",
    });
  }

  return actions.map((action, index) => {
    try {
      return convertActionToDynamicStructuredTool(action);
    } catch (error) {
      throw new CopilotKitMisuseError({
        message: `Failed to convert action at index ${index}: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  });
}

export function copilotKitInterrupt({
  message,
  action,
  args,
}: {
  message?: string;
  action?: string;
  args?: Record<string, any>;
}) {
  if (!message && !action) {
    throw new CopilotKitMisuseError({
      message:
        "Either message or action (and optional arguments) must be provided for copilotKitInterrupt",
    });
  }

  if (action && typeof action !== "string") {
    throw new CopilotKitMisuseError({
      message: "Action must be a string when provided to copilotKitInterrupt",
    });
  }

  if (message && typeof message !== "string") {
    throw new CopilotKitMisuseError({
      message: "Message must be a string when provided to copilotKitInterrupt",
    });
  }

  if (args && typeof args !== "object") {
    throw new CopilotKitMisuseError({
      message: "Args must be an object when provided to copilotKitInterrupt",
    });
  }

  let interruptValues = null;
  let interruptMessage = null;
  let answer = null;

  try {
    if (message) {
      interruptValues = message;
      interruptMessage = new AIMessage({ content: message, id: randomId() });
    } else {
      const toolId = randomId();
      interruptMessage = new AIMessage({
        content: "",
        tool_calls: [{ id: toolId, name: action, args: args ?? {} }],
      });
      interruptValues = {
        action,
        args: args ?? {},
      };
    }

    const response = interrupt({
      __copilotkit_interrupt_value__: interruptValues,
      __copilotkit_messages__: [interruptMessage],
    });
    answer = response[response.length - 1].content;

    return {
      answer,
      messages: response,
    };
  } catch (error) {
    throw new CopilotKitMisuseError({
      message: `Failed to create interrupt: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}
