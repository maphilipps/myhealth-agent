/**
 * myHealth Agent - AI-powered Fitness Coach
 *
 * This agent provides personalized workout coaching with:
 * - Progressive overload recommendations based on RPE
 * - Natural language workout logging
 * - Form cues and technique guidance
 * - Training plan management
 */

import {
  query,
  type SDKMessage,
  type SDKAssistantMessage,
  type SDKResultMessage,
  type SDKSystemMessage
} from "@anthropic-ai/claude-agent-sdk";
import { fitnessToolsServer } from "./tools/fitness-tools.js";
import { planToolsServer } from "./tools/plan-tools.js";
import {
  FITNESS_COACH_SYSTEM_PROMPT,
  fitnessSubagents
} from "./agents/fitness-coach.js";

/**
 * Extract text content from an assistant message
 */
function getAssistantContent(message: SDKAssistantMessage): string {
  const content = message.message.content;
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map(block => block.text)
      .join('\n');
  }
  return '';
}

/**
 * Run the Fitness Coach Agent
 */
async function runFitnessCoach(userPrompt: string): Promise<void> {
  console.log("\n🏋️ myHealth Fitness Coach\n");
  console.log(`User: ${userPrompt}\n`);
  console.log("─".repeat(50));

  const response = query({
    prompt: userPrompt,
    options: {
      model: "claude-sonnet-4-5",
      systemPrompt: FITNESS_COACH_SYSTEM_PROMPT,

      // Custom MCP tools
      mcpServers: {
        "fitness-tools": fitnessToolsServer,
        "plan-tools": planToolsServer
      },

      // Allow all custom tools
      allowedTools: [
        // Fitness tools
        "mcp__fitness-tools__get_progression",
        "mcp__fitness-tools__log_set",
        "mcp__fitness-tools__interpret_effort",
        "mcp__fitness-tools__get_form_cues",
        // Plan tools
        "mcp__plan-tools__generate_plan",
        "mcp__plan-tools__get_split_recommendations",
        "mcp__plan-tools__calculate_periodization",
        "mcp__plan-tools__optimize_hybrid_schedule"
      ],

      // Subagents for specialized tasks
      agents: fitnessSubagents,

      // Permission handling
      permissionMode: "default",

      // Optional: Set a budget limit
      // maxBudgetUsd: 1.0
    }
  });

  // Process streaming response
  for await (const message of response) {
    handleMessage(message);
  }

  console.log("\n" + "─".repeat(50));
}

/**
 * Handle different message types from the SDK
 */
function handleMessage(message: SDKMessage): void {
  switch (message.type) {
    case 'assistant': {
      const content = getAssistantContent(message);
      if (content) {
        console.log(`\n🤖 Coach: ${content}`);
      }
      break;
    }

    case 'system': {
      const sysMsg = message as SDKSystemMessage;
      if (sysMsg.subtype === 'init') {
        console.log(`\n📋 Session initialized with ${sysMsg.tools.length} tools`);
      }
      break;
    }

    case 'result': {
      const result = message as SDKResultMessage;
      if (result.subtype === 'success') {
        console.log(`\n✅ Completed in ${result.num_turns} turns ($${result.total_cost_usd.toFixed(4)})`);
      } else {
        console.log(`\n⚠️ Ended with: ${result.subtype}`);
        if ('errors' in result && result.errors) {
          result.errors.forEach((err: string) => console.error(`  - ${err}`));
        }
      }
      break;
    }

    case 'tool_progress': {
      console.log(`\n🔧 Tool in progress: ${message.tool_name} (${message.elapsed_time_seconds}s)`);
      break;
    }

    case 'stream_event': {
      // Streaming events - usually for partial content
      // Can be enabled with includePartialMessages option
      break;
    }

    case 'user':
      // User messages - typically from system
      break;

    case 'auth_status':
      // Authentication status updates
      if (message.error) {
        console.error(`\n❌ Auth error: ${message.error}`);
      }
      break;
  }
}

/**
 * Interactive CLI mode
 */
async function interactiveMode(): Promise<void> {
  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log("\n🏋️ myHealth Fitness Coach - Interactive Mode");
  console.log("Type your message or 'exit' to quit.\n");

  const askQuestion = (): void => {
    rl.question("You: ", async (input) => {
      const trimmed = input.trim();

      if (trimmed.toLowerCase() === 'exit') {
        console.log("\nGoodbye! Keep training! 💪\n");
        rl.close();
        return;
      }

      if (trimmed) {
        await runFitnessCoach(trimmed);
      }

      askQuestion();
    });
  };

  askQuestion();
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length > 0) {
    // Single query mode
    const prompt = args.join(' ');
    await runFitnessCoach(prompt);
  } else {
    // Interactive mode
    await interactiveMode();
  }
}

// Run the agent
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
