/**
 * The vocabulary of behaviour: what can start a rule, what it can check, and
 * what it can do. A rule reads "when <trigger>, if <conditions>, then
 * <actions>". Shared, because the editor builds rules from the same schemas
 * main runs them by.
 */

import { z } from 'zod';

const clockSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be a time like 23:00');
/** A program by its file name, 'dota2.exe'; matched without case or extension. */
const programSchema = z.string().trim().min(1, 'a program is needed').max(260);
const groupSchema = z.string().min(1, 'a group of lines is needed').max(64);
const fileSchema = z
  .string()
  .max(120)
  .regex(/^[A-Za-z0-9_][A-Za-z0-9_ .-]*$/, 'not a valid asset file name')
  .refine((name) => !name.includes('..'), 'not a valid asset file name');

/* ------------------------------------------------------------------ */
/* When                                                                */
/* ------------------------------------------------------------------ */

export const triggerSchema = z.discriminatedUnion('type', [
  /** A program starts. */
  z.object({ type: z.literal('programStarted'), program: programSchema }),
  /** A program closes — the last of its windows and processes. */
  z.object({ type: z.literal('programStopped'), program: programSchema }),
  /** A program's window comes to the front. */
  z.object({ type: z.literal('programFocused'), program: programSchema }),
  /** Every day at this time. */
  z.object({ type: z.literal('time'), at: clockSchema }),
  /** Again and again, somewhere between these many minutes apart. */
  z
    .object({ type: z.literal('every'), minMinutes: z.number().min(1).max(1440), maxMinutes: z.number().min(1).max(1440) })
    .refine((every) => every.maxMinutes >= every.minMinutes, 'the longest wait cannot be shorter than the shortest'),
  /** The user is back at the computer after at least this long away from it. */
  z.object({ type: z.literal('returned'), afterMinutes: z.number().min(1).max(1440) }),
  /** SHARD has just started. */
  z.object({ type: z.literal('startup') }),
  /** The character itself was clicked. */
  z.object({ type: z.literal('clicked') })
]);

/* ------------------------------------------------------------------ */
/* If                                                                  */
/* ------------------------------------------------------------------ */

export const conditionSchema = z.discriminatedUnion('type', [
  /** Only some of the time. */
  z.object({ type: z.literal('chance'), percent: z.number().min(0).max(100) }),
  /** Only between these times of day; may run past midnight. */
  z.object({ type: z.literal('timeBetween'), from: clockSchema, to: clockSchema }),
  /** Only while a program is (or is not) running. */
  z.object({ type: z.literal('programRunning'), program: programSchema, running: z.boolean() })
]);

/* ------------------------------------------------------------------ */
/* Then                                                                */
/* ------------------------------------------------------------------ */

export const actionSchema = z.discriminatedUnion('type', [
  /** Say a line picked from a group. */
  z.object({ type: z.literal('say'), group: groupSchema }),
  /** Play one of the character's sounds. */
  z.object({ type: z.literal('sound'), file: fileSchema }),
  /** Come on screen for a while, whatever its presence rules say. */
  z.object({ type: z.literal('show'), seconds: z.number().min(1).max(3600) }),
  /** Get out of sight for a while. */
  z.object({ type: z.literal('hide'), minutes: z.number().min(1).max(1440) })
]);

export const ruleSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(80),
  enabled: z.boolean(),
  when: triggerSchema,
  if: z.array(conditionSchema).max(16),
  then: z.array(actionSchema).min(1, 'a rule has to do something').max(16),
  /** How long before this rule may fire again. 0 is no limit. */
  cooldownSec: z.number().min(0).max(7 * 24 * 3600)
});

export type Trigger = z.infer<typeof triggerSchema>;
export type RuleCondition = z.infer<typeof conditionSchema>;
export type RuleAction = z.infer<typeof actionSchema>;
export type Rule = z.infer<typeof ruleSchema>;
