/**
 * Custom MCP Tools for Training Plan Creation
 *
 * These tools provide the PlanCreatorAgent with capabilities to:
 * - Generate training plans based on goals and schedule
 * - Support hybrid training (strength + cardio)
 * - Handle periodization and deload planning
 */

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { TrainingPlan, PlanDay, WorkoutType, Exercise } from "../types/index.js";

// Split configurations with muscle group mappings
const SPLIT_TEMPLATES: Record<string, { days: number; structure: WorkoutType[] }> = {
  'ppl': { days: 6, structure: ['push', 'pull', 'legs', 'push', 'pull', 'legs'] },
  'ppl_3': { days: 3, structure: ['push', 'pull', 'legs'] },
  'upper_lower': { days: 4, structure: ['upper', 'lower', 'upper', 'lower'] },
  'torso_limbs': { days: 4, structure: ['torso', 'limbs', 'torso', 'limbs'] },
  'full_body': { days: 3, structure: ['full_body', 'full_body', 'full_body'] },
  'bro_split': { days: 5, structure: ['push', 'pull', 'legs', 'upper', 'lower'] }
};

// Exercise recommendations per workout type
const EXERCISE_RECOMMENDATIONS: Record<WorkoutType, string[]> = {
  'push': ['Bench Press', 'Overhead Press', 'Incline Dumbbell Press', 'Dips', 'Lateral Raises', 'Tricep Pushdowns'],
  'pull': ['Deadlift', 'Barbell Row', 'Pull-Ups', 'Face Pulls', 'Barbell Curls', 'Hammer Curls'],
  'legs': ['Squat', 'Romanian Deadlift', 'Leg Press', 'Leg Curl', 'Calf Raises', 'Lunges'],
  'torso': ['Bench Press', 'Barbell Row', 'Overhead Press', 'Pull-Ups', 'Dumbbell Flyes', 'Face Pulls'],
  'limbs': ['Squat', 'Romanian Deadlift', 'Barbell Curls', 'Tricep Extensions', 'Lateral Raises', 'Calf Raises'],
  'upper': ['Bench Press', 'Barbell Row', 'Overhead Press', 'Pull-Ups', 'Bicep Curls', 'Tricep Extensions'],
  'lower': ['Squat', 'Romanian Deadlift', 'Leg Press', 'Leg Curl', 'Calf Raises', 'Hip Thrusts'],
  'full_body': ['Squat', 'Bench Press', 'Barbell Row', 'Overhead Press', 'Romanian Deadlift', 'Pull-Ups'],
  'custom': []
};

/**
 * Generate a periodized training plan
 */
function generatePlan(
  name: string,
  splitType: string,
  daysPerWeek: number,
  goal: 'hypertrophy' | 'strength' | 'endurance',
  includeCardio: boolean
): TrainingPlan {
  const template = SPLIT_TEMPLATES[splitType] || SPLIT_TEMPLATES['ppl_3'];

  // Adjust rep ranges based on goal
  const repRanges = {
    hypertrophy: { min: 8, max: 12, sets: 4 },
    strength: { min: 3, max: 6, sets: 5 },
    endurance: { min: 12, max: 20, sets: 3 }
  };
  const repConfig = repRanges[goal];

  const days: PlanDay[] = [];
  for (let i = 0; i < Math.min(daysPerWeek, template.structure.length); i++) {
    const workoutType = template.structure[i];
    const exercises = EXERCISE_RECOMMENDATIONS[workoutType] || [];

    days.push({
      dayNumber: i + 1,
      name: `${workoutType.charAt(0).toUpperCase() + workoutType.slice(1).replace('_', ' ')} Day`,
      workoutType,
      exercises: exercises.slice(0, 6).map((name, idx) => ({
        exerciseId: `exercise-${name.toLowerCase().replace(/\s+/g, '-')}`,
        order: idx + 1,
        targetSets: repConfig.sets,
        targetRepsMin: repConfig.min,
        targetRepsMax: repConfig.max
      }))
    });
  }

  // Add cardio days if requested
  if (includeCardio && daysPerWeek > days.length) {
    days.push({
      dayNumber: days.length + 1,
      name: 'Easy Run',
      workoutType: 'custom',
      exercises: [{
        exerciseId: 'cardio-easy-run',
        order: 1,
        targetSets: 1,
        targetRepsMin: 20,
        targetRepsMax: 40,
        notes: '20-40 minutes Zone 2 running'
      }]
    });
  }

  return {
    id: `plan-${Date.now()}`,
    name,
    daysPerWeek,
    splitType,
    days
  };
}

/**
 * Create the Plan Tools MCP Server
 */
export const planToolsServer = createSdkMcpServer({
  name: "plan-tools",
  version: "1.0.0",
  tools: [
    // Generate Training Plan
    tool(
      "generate_plan",
      "Generate a personalized training plan based on goals, schedule, and preferences",
      {
        name: z.string().describe("Name for the training plan"),
        splitType: z.enum(['ppl', 'ppl_3', 'upper_lower', 'torso_limbs', 'full_body', 'bro_split'])
          .describe("Type of training split"),
        daysPerWeek: z.number().min(2).max(6).describe("Number of training days per week"),
        goal: z.enum(['hypertrophy', 'strength', 'endurance']).describe("Primary training goal"),
        includeCardio: z.boolean().default(false).describe("Whether to include cardio sessions")
      },
      async (args) => {
        const plan = generatePlan(
          args.name,
          args.splitType,
          args.daysPerWeek,
          args.goal,
          args.includeCardio
        );

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              plan,
              summary: {
                totalDays: plan.days.length,
                exercisesPerDay: plan.days.map(d => d.exercises.length),
                splitExplanation: getSplitExplanation(args.splitType, args.goal)
              }
            }, null, 2)
          }]
        };
      }
    ),

    // Get Split Recommendations
    tool(
      "get_split_recommendations",
      "Get training split recommendations based on experience level and available days",
      {
        experienceLevel: z.enum(['beginner', 'intermediate', 'advanced']).describe("Training experience level"),
        availableDays: z.number().min(2).max(6).describe("Number of days available for training"),
        goal: z.enum(['hypertrophy', 'strength', 'general_fitness']).describe("Primary goal")
      },
      async (args) => {
        let recommendations: { split: string; reason: string; optimal: boolean }[] = [];

        if (args.experienceLevel === 'beginner') {
          recommendations = [
            { split: 'full_body', reason: 'Best for beginners - high frequency, motor learning', optimal: args.availableDays <= 3 },
            { split: 'upper_lower', reason: 'Good progression from full body', optimal: args.availableDays === 4 }
          ];
        } else if (args.experienceLevel === 'intermediate') {
          recommendations = [
            { split: 'upper_lower', reason: 'Good volume distribution, recovery balance', optimal: args.availableDays === 4 },
            { split: 'ppl_3', reason: 'Classic bodybuilding split, good volume', optimal: args.availableDays === 3 },
            { split: 'ppl', reason: 'Maximum frequency and volume', optimal: args.availableDays >= 5 }
          ];
        } else {
          recommendations = [
            { split: 'ppl', reason: 'High frequency for advanced lifters', optimal: args.availableDays >= 5 },
            { split: 'torso_limbs', reason: 'Alternative to PPL with different emphasis', optimal: args.availableDays === 4 }
          ];
        }

        // Filter based on available days
        recommendations = recommendations.filter(r => {
          const template = SPLIT_TEMPLATES[r.split];
          return template && template.days <= args.availableDays;
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              experienceLevel: args.experienceLevel,
              availableDays: args.availableDays,
              goal: args.goal,
              recommendations,
              bestChoice: recommendations.find(r => r.optimal)?.split || recommendations[0]?.split
            }, null, 2)
          }]
        };
      }
    ),

    // Calculate Periodization
    tool(
      "calculate_periodization",
      "Calculate periodization phases for a training block",
      {
        totalWeeks: z.number().min(4).max(16).describe("Total number of weeks in the training block"),
        goal: z.enum(['hypertrophy', 'strength', 'peaking']).describe("Primary goal of the block"),
        includeDeload: z.boolean().default(true).describe("Whether to include deload weeks")
      },
      async (args) => {
        const phases: { week: number; phase: string; intensity: string; volume: string; notes: string }[] = [];

        if (args.goal === 'hypertrophy') {
          // Hypertrophy periodization: Accumulation -> Intensification -> Deload
          const accumWeeks = Math.floor(args.totalWeeks * 0.5);
          const intensWeeks = Math.floor(args.totalWeeks * 0.35);
          const deloadWeeks = args.includeDeload ? Math.max(1, args.totalWeeks - accumWeeks - intensWeeks) : 0;

          for (let w = 1; w <= accumWeeks; w++) {
            phases.push({
              week: w,
              phase: 'Accumulation',
              intensity: '65-75% 1RM',
              volume: 'High (15-20 sets/muscle)',
              notes: 'Focus on volume, RPE 7-8'
            });
          }
          for (let w = accumWeeks + 1; w <= accumWeeks + intensWeeks; w++) {
            phases.push({
              week: w,
              phase: 'Intensification',
              intensity: '75-85% 1RM',
              volume: 'Moderate (12-16 sets/muscle)',
              notes: 'Increase weight, RPE 8-9'
            });
          }
          if (args.includeDeload) {
            for (let w = accumWeeks + intensWeeks + 1; w <= args.totalWeeks; w++) {
              phases.push({
                week: w,
                phase: 'Deload',
                intensity: '50-60% 1RM',
                volume: 'Low (8-10 sets/muscle)',
                notes: 'Recovery focus, RPE 5-6'
              });
            }
          }
        } else if (args.goal === 'strength') {
          // Strength periodization: Volume -> Strength -> Peaking
          const volWeeks = Math.floor(args.totalWeeks * 0.4);
          const strWeeks = Math.floor(args.totalWeeks * 0.4);
          const peakWeeks = args.totalWeeks - volWeeks - strWeeks;

          for (let w = 1; w <= volWeeks; w++) {
            phases.push({
              week: w,
              phase: 'Volume',
              intensity: '70-80% 1RM',
              volume: 'High (5x5-8)',
              notes: 'Build work capacity'
            });
          }
          for (let w = volWeeks + 1; w <= volWeeks + strWeeks; w++) {
            phases.push({
              week: w,
              phase: 'Strength',
              intensity: '80-90% 1RM',
              volume: 'Moderate (5x3-5)',
              notes: 'Progressive overload focus'
            });
          }
          for (let w = volWeeks + strWeeks + 1; w <= args.totalWeeks; w++) {
            phases.push({
              week: w,
              phase: args.includeDeload && w === args.totalWeeks ? 'Deload' : 'Peaking',
              intensity: args.includeDeload && w === args.totalWeeks ? '60% 1RM' : '90-95% 1RM',
              volume: 'Low (3x1-3)',
              notes: args.includeDeload && w === args.totalWeeks ? 'Active recovery' : 'Test new maxes'
            });
          }
        } else {
          // Peaking periodization
          for (let w = 1; w <= args.totalWeeks; w++) {
            const isDeload = args.includeDeload && (w % 4 === 0);
            phases.push({
              week: w,
              phase: isDeload ? 'Deload' : `Week ${w}`,
              intensity: isDeload ? '60% 1RM' : `${80 + Math.min(w * 2, 15)}% 1RM`,
              volume: isDeload ? 'Low' : 'Moderate',
              notes: isDeload ? 'Recovery' : 'Building to peak'
            });
          }
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              totalWeeks: args.totalWeeks,
              goal: args.goal,
              includesDeload: args.includeDeload,
              phases,
              summary: {
                phaseCounts: phases.reduce((acc, p) => {
                  acc[p.phase] = (acc[p.phase] || 0) + 1;
                  return acc;
                }, {} as Record<string, number>)
              }
            }, null, 2)
          }]
        };
      }
    ),

    // Optimize Hybrid Schedule
    tool(
      "optimize_hybrid_schedule",
      "Optimize a weekly schedule combining strength training and cardio",
      {
        strengthDays: z.number().min(2).max(4).describe("Number of strength training days"),
        cardioDays: z.number().min(1).max(3).describe("Number of cardio sessions"),
        cardioType: z.enum(['running', 'cycling', 'swimming', 'mixed']).describe("Primary cardio type"),
        prioritize: z.enum(['strength', 'cardio', 'balanced']).describe("What to prioritize")
      },
      async (args) => {
        const weekDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
        const schedule: { day: string; activity: string; notes: string }[] = [];

        // Optimal scheduling rules:
        // 1. No cardio before leg day
        // 2. Easy cardio can be after upper body
        // 3. Hard cardio needs 48h before strength
        // 4. At least one rest day per week

        if (args.prioritize === 'strength' || args.prioritize === 'balanced') {
          // Strength-first scheduling
          const strengthSchedule = args.strengthDays === 4
            ? [0, 2, 4, 5] // Mon, Wed, Fri, Sat
            : args.strengthDays === 3
            ? [0, 2, 4] // Mon, Wed, Fri
            : [0, 3]; // Mon, Thu

          strengthSchedule.forEach((dayIdx, i) => {
            const isLegDay = i % 2 === (args.strengthDays > 2 ? 0 : 1);
            schedule.push({
              day: weekDays[dayIdx],
              activity: isLegDay ? 'Lower Body' : 'Upper Body',
              notes: 'Full strength session'
            });
          });

          // Add cardio on non-strength days, avoiding day before legs
          const strengthDays = new Set(strengthSchedule);
          let cardioAdded = 0;
          for (let i = 0; i < 7 && cardioAdded < args.cardioDays; i++) {
            if (!strengthDays.has(i)) {
              // Check if next day is leg day
              const nextDayIsLegs = strengthSchedule.some(
                (s, idx) => s === (i + 1) % 7 && idx % 2 === 0
              );
              const isEasyCardio = nextDayIsLegs || args.prioritize === 'strength';

              schedule.push({
                day: weekDays[i],
                activity: isEasyCardio ? 'Easy Cardio' : 'Quality Cardio',
                notes: isEasyCardio
                  ? `Zone 2 ${args.cardioType}, 30-40 min`
                  : `Intervals or tempo ${args.cardioType}, 20-30 min`
              });
              cardioAdded++;
            }
          }
        } else {
          // Cardio-priority scheduling
          const cardioDays = args.cardioDays === 3
            ? [1, 3, 5] // Tue, Thu, Sat
            : [1, 4]; // Tue, Fri

          cardioDays.forEach(dayIdx => {
            schedule.push({
              day: weekDays[dayIdx],
              activity: 'Quality Cardio',
              notes: `Main ${args.cardioType} session`
            });
          });

          // Add strength around cardio
          const cardioSet = new Set(cardioDays);
          let strengthAdded = 0;
          for (let i = 0; i < 7 && strengthAdded < args.strengthDays; i++) {
            if (!cardioSet.has(i) && !cardioSet.has(i - 1)) {
              schedule.push({
                day: weekDays[i],
                activity: strengthAdded % 2 === 0 ? 'Upper Body' : 'Lower Body',
                notes: 'Strength session'
              });
              strengthAdded++;
            }
          }
        }

        // Sort by day
        schedule.sort((a, b) => weekDays.indexOf(a.day) - weekDays.indexOf(b.day));

        // Add rest days
        const scheduledDays = new Set(schedule.map(s => s.day));
        weekDays.forEach(day => {
          if (!scheduledDays.has(day)) {
            schedule.push({
              day,
              activity: 'Rest',
              notes: 'Recovery day'
            });
          }
        });

        schedule.sort((a, b) => weekDays.indexOf(a.day) - weekDays.indexOf(b.day));

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              configuration: {
                strengthDays: args.strengthDays,
                cardioDays: args.cardioDays,
                cardioType: args.cardioType,
                priority: args.prioritize
              },
              schedule,
              tips: [
                'Keep hard cardio sessions 48h away from leg day',
                'Easy Zone 2 cardio can be done more frequently',
                'Listen to your body and adjust as needed',
                args.prioritize === 'strength'
                  ? 'Prioritize strength sessions when fatigued'
                  : 'Schedule quality cardio when fresh'
              ]
            }, null, 2)
          }]
        };
      }
    )
  ]
});

/**
 * Get explanation for a split type
 */
function getSplitExplanation(splitType: string, goal: string): string {
  const explanations: Record<string, string> = {
    'ppl': 'Push/Pull/Legs split trains each muscle group twice per week with optimal recovery between sessions.',
    'ppl_3': '3-day PPL provides full coverage with one session per movement pattern per week.',
    'upper_lower': 'Upper/Lower split balances training frequency with recovery, ideal for intermediate lifters.',
    'torso_limbs': 'Torso/Limbs separates core movements from arm/leg focus days.',
    'full_body': 'Full body training maximizes frequency and is ideal for beginners or time-constrained lifters.',
    'bro_split': 'Traditional bodybuilding split with high volume per muscle group once per week.'
  };

  return `${explanations[splitType] || 'Custom split configuration.'} Optimized for ${goal} with appropriate rep ranges and volume.`;
}
