/**
 * Custom MCP Tools for Fitness Coaching
 *
 * These tools provide the FitnessCoachAgent with capabilities to:
 * - Get progressive overload recommendations
 * - Log workout sets
 * - Analyze training progress
 * - Access exercise library
 */

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { ProgressionRecommendation, WorkoutSet } from "../types/index.js";

// Calculate estimated 1RM using Epley formula
function calculateEstimated1RM(weight: number, reps: number): number {
  if (reps === 1) return weight;
  return Math.round(weight * (1 + reps / 30) * 10) / 10;
}

// Determine progression recommendation based on RPE and history
function getProgressionLogic(
  lastWeight: number,
  lastReps: number,
  lastRPE: number,
  equipment: string
): { weight: number; reps: { min: number; max: number }; reasoning: string; trend: string } {
  const increment = equipment === 'barbell' ? 2.5 : 1.25;

  if (lastRPE <= 7) {
    // Easy - increase weight
    return {
      weight: lastWeight + increment,
      reps: { min: lastReps - 1, max: lastReps + 1 },
      reasoning: `RPE ${lastRPE} indicates room for progression. Increasing weight by ${increment}kg.`,
      trend: 'progressing'
    };
  } else if (lastRPE === 8) {
    // Target zone - increase reps slightly
    return {
      weight: lastWeight,
      reps: { min: lastReps, max: lastReps + 2 },
      reasoning: `RPE 8 is ideal. Try to add 1-2 reps before increasing weight.`,
      trend: 'progressing'
    };
  } else if (lastRPE === 9) {
    // Hard but sustainable - maintain
    return {
      weight: lastWeight,
      reps: { min: lastReps - 1, max: lastReps },
      reasoning: `RPE 9 is challenging. Maintain current weight and aim for consistency.`,
      trend: 'plateau'
    };
  } else {
    // Too hard - consider deload
    return {
      weight: lastWeight * 0.9,
      reps: { min: lastReps, max: lastReps + 2 },
      reasoning: `RPE ${lastRPE} indicates fatigue. Reducing weight by 10% for recovery.`,
      trend: 'deload_needed'
    };
  }
}

/**
 * Create the Fitness Tools MCP Server
 */
export const fitnessToolsServer = createSdkMcpServer({
  name: "fitness-tools",
  version: "1.0.0",
  tools: [
    // Get Progression Recommendation
    tool(
      "get_progression",
      "Get weight and rep recommendations for an exercise based on progressive overload principles and RPE",
      {
        exerciseId: z.string().describe("UUID of the exercise"),
        exerciseName: z.string().describe("Name of the exercise for display"),
        lastWeight: z.number().describe("Weight used in last session (kg)"),
        lastReps: z.number().describe("Reps completed in last session"),
        lastRPE: z.number().min(1).max(10).describe("Rate of Perceived Exertion (1-10) from last session"),
        equipment: z.enum(["barbell", "dumbbell", "cable", "machine", "bodyweight", "kettlebell", "ez_bar"])
          .describe("Equipment type for increment calculation")
      },
      async (args) => {
        const progression = getProgressionLogic(
          args.lastWeight,
          args.lastReps,
          args.lastRPE,
          args.equipment
        );

        const recommendation: ProgressionRecommendation = {
          exerciseId: args.exerciseId,
          exerciseName: args.exerciseName,
          recommendedWeight: progression.weight,
          recommendedReps: progression.reps,
          previousWeight: args.lastWeight,
          previousReps: args.lastReps,
          reasoning: progression.reasoning,
          trend: progression.trend as ProgressionRecommendation['trend'],
          confidence: args.lastRPE ? 'high' : 'medium'
        };

        return {
          content: [{
            type: "text",
            text: JSON.stringify(recommendation, null, 2)
          }]
        };
      }
    ),

    // Log Workout Set
    tool(
      "log_set",
      "Log a completed workout set with weight, reps, and optional RPE",
      {
        exerciseId: z.string().describe("UUID of the exercise"),
        exerciseName: z.string().describe("Name of the exercise"),
        weight: z.number().positive().describe("Weight used (kg)"),
        reps: z.number().int().positive().describe("Number of reps completed"),
        rpe: z.number().min(1).max(10).optional().describe("Rate of Perceived Exertion (1-10)"),
        notes: z.string().optional().describe("Optional notes about the set")
      },
      async (args) => {
        const set: WorkoutSet = {
          exerciseId: args.exerciseId,
          exerciseName: args.exerciseName,
          weight: args.weight,
          reps: args.reps,
          rpe: args.rpe,
          notes: args.notes
        };

        const estimated1RM = calculateEstimated1RM(args.weight, args.reps);
        const volume = args.weight * args.reps;

        // In production, this would save to Supabase via MCP
        const response = {
          success: true,
          logged: set,
          stats: {
            estimated1RM,
            volume,
            intensity: args.rpe ? `RPE ${args.rpe}` : 'Not recorded'
          },
          feedback: args.rpe && args.rpe >= 9
            ? "Great effort! Consider slightly lower weight next set for optimal training stimulus."
            : args.rpe && args.rpe <= 6
            ? "Feeling strong! You could increase weight on the next set."
            : "Good set! Keep it up."
        };

        return {
          content: [{
            type: "text",
            text: JSON.stringify(response, null, 2)
          }]
        };
      }
    ),

    // Interpret Natural Language Effort
    tool(
      "interpret_effort",
      "Convert natural language effort descriptions to RPE values",
      {
        description: z.string().describe("Natural language description of effort (e.g., 'felt easy', 'was a grind', 'could do 2 more')")
      },
      async (args) => {
        const desc = args.description.toLowerCase();
        let rpe: number;
        let reasoning: string;

        if (desc.includes('easy') || desc.includes('warm-up') || desc.includes('leicht')) {
          rpe = 5;
          reasoning = "Easy/warm-up effort indicates low intensity";
        } else if (desc.includes('could do') && desc.includes('more')) {
          const moreMatch = desc.match(/(\d+)\s*more/);
          const repsInReserve = moreMatch ? parseInt(moreMatch[1]) : 3;
          rpe = 10 - repsInReserve;
          reasoning = `${repsInReserve} reps in reserve translates to RPE ${rpe}`;
        } else if (desc.includes('good') || desc.includes('solid') || desc.includes('gut')) {
          rpe = 7;
          reasoning = "Good/solid effort typically indicates RPE 7-8";
        } else if (desc.includes('hard') || desc.includes('tough') || desc.includes('schwer')) {
          rpe = 8;
          reasoning = "Hard/tough effort indicates RPE 8-9";
        } else if (desc.includes('grind') || desc.includes('struggle') || desc.includes('max')) {
          rpe = 9;
          reasoning = "Grinding/struggling indicates near-maximal effort";
        } else if (desc.includes('fail') || desc.includes('couldn\'t')) {
          rpe = 10;
          reasoning = "Failure or inability to complete indicates RPE 10";
        } else {
          rpe = 7;
          reasoning = "Defaulting to moderate effort (RPE 7) based on description";
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ rpe, reasoning, originalDescription: args.description }, null, 2)
          }]
        };
      }
    ),

    // Get Exercise Form Cues
    tool(
      "get_form_cues",
      "Get form cues and technique tips for an exercise",
      {
        exerciseName: z.string().describe("Name of the exercise")
      },
      async (args) => {
        // In production, this would query the exercise library from Supabase
        const formCuesDatabase: Record<string, string[]> = {
          "bench press": [
            "Retract and depress shoulder blades",
            "Plant feet firmly on the floor",
            "Lower bar to mid-chest with control",
            "Drive through feet on the press",
            "Keep wrists straight over elbows"
          ],
          "squat": [
            "Brace core before descending",
            "Push knees out over toes",
            "Keep chest up throughout",
            "Descend until hip crease below knee",
            "Drive through full foot on ascent"
          ],
          "deadlift": [
            "Bar over mid-foot at start",
            "Shoulders slightly in front of bar",
            "Brace core and engage lats",
            "Push floor away, don't pull bar",
            "Lock out hips and knees together"
          ],
          "overhead press": [
            "Grip slightly outside shoulders",
            "Elbows slightly in front of bar",
            "Squeeze glutes for stability",
            "Press bar in slight arc around face",
            "Lock out fully overhead"
          ],
          "row": [
            "Hinge at hips, keep back flat",
            "Pull to lower chest/upper abs",
            "Lead with elbows, not hands",
            "Squeeze shoulder blades at top",
            "Control the negative"
          ]
        };

        const exerciseLower = args.exerciseName.toLowerCase();
        let cues: string[] = [];
        let matchedExercise = "";

        for (const [name, exerciseCues] of Object.entries(formCuesDatabase)) {
          if (exerciseLower.includes(name) || name.includes(exerciseLower)) {
            cues = exerciseCues;
            matchedExercise = name;
            break;
          }
        }

        if (cues.length === 0) {
          cues = [
            "Focus on controlled movement",
            "Maintain proper breathing",
            "Use full range of motion",
            "Keep core engaged throughout"
          ];
          matchedExercise = "general";
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              exercise: args.exerciseName,
              matched: matchedExercise,
              formCues: cues
            }, null, 2)
          }]
        };
      }
    )
  ]
});
