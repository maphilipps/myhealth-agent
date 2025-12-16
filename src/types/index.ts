/**
 * Type definitions for myHealth Agent
 */

export interface Exercise {
  id: string;
  name: string;
  muscleGroup: MuscleGroup;
  equipment: Equipment;
  isCompound: boolean;
  defaultSets: number;
  defaultRepsMin: number;
  defaultRepsMax: number;
  restSeconds: number;
  formCues?: string[];
}

export type MuscleGroup =
  | 'chest'
  | 'back'
  | 'shoulders'
  | 'biceps'
  | 'triceps'
  | 'quadriceps'
  | 'hamstrings'
  | 'glutes'
  | 'calves'
  | 'core'
  | 'forearms';

export type Equipment =
  | 'barbell'
  | 'dumbbell'
  | 'cable'
  | 'machine'
  | 'bodyweight'
  | 'kettlebell'
  | 'ez_bar';

export interface WorkoutSet {
  exerciseId: string;
  exerciseName: string;
  weight: number;
  reps: number;
  rpe?: number;
  notes?: string;
}

export interface ProgressionRecommendation {
  exerciseId: string;
  exerciseName: string;
  recommendedWeight: number;
  recommendedReps: { min: number; max: number };
  previousWeight: number;
  previousReps: number;
  reasoning: string;
  trend: 'progressing' | 'plateau' | 'regressing' | 'deload_needed';
  confidence: 'high' | 'medium' | 'low';
}

export interface WorkoutSession {
  id: string;
  userId: string;
  workoutType: WorkoutType;
  startedAt: Date;
  endedAt?: Date;
  sets: WorkoutSet[];
  notes?: string;
}

export type WorkoutType =
  | 'push'
  | 'pull'
  | 'legs'
  | 'torso'
  | 'limbs'
  | 'upper'
  | 'lower'
  | 'full_body'
  | 'custom';

export interface PersonalRecord {
  exerciseId: string;
  exerciseName: string;
  weight: number;
  reps: number;
  estimated1RM: number;
  achievedAt: Date;
}

export interface TrainingPlan {
  id: string;
  name: string;
  daysPerWeek: number;
  splitType: string;
  days: PlanDay[];
}

export interface PlanDay {
  dayNumber: number;
  name: string;
  workoutType: WorkoutType;
  exercises: PlanExercise[];
}

export interface PlanExercise {
  exerciseId: string;
  order: number;
  targetSets: number;
  targetRepsMin: number;
  targetRepsMax: number;
  notes?: string;
}
