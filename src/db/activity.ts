import type { ParsedEvents } from "../types";

/**
 * Every UTC offset in use is a whole number of quarter hours, so quarter-hour
 * slots add up exactly to any local hour, day, week, or month.
 */
export const SLOT_MS = 15 * 60 * 1000;

/** The model of the rows that hold a slot's messages and tool calls, which no model is credited with. */
export const NO_MODEL = "";

/** A session's activity within one UTC quarter hour, with model usage kept apart by model. */
export interface ActivitySlot {
  /** Milliseconds since the epoch at the start of the quarter hour. */
  slotStart: number;
  model: string;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  requests: number;
  /** Null when none of the usage recorded AI credits. */
  aiCredits: number | null;
  requestsWithoutAiCredits: number;
}

function slotStartOf(timestamp: string | null): number | null {
  if (timestamp === null) return null;
  const time = Date.parse(timestamp);
  return Number.isFinite(time) ? Math.floor(time / SLOT_MS) * SLOT_MS : null;
}

/**
 * Totals a session's messages, tool calls, and model usage by the quarter hour
 * they were recorded in, counting them as the statistics do: messages injected
 * by skills, other agents, or the system are left out, and items without a
 * readable time count at the session's last update.
 */
export function rollUpActivity(
  events: Pick<ParsedEvents, "messages" | "toolCalls" | "usage">,
  sessionUpdatedAt: string | null,
): ActivitySlot[] {
  const fallbackSlotStart = slotStartOf(sessionUpdatedAt);
  const slots = new Map<string, ActivitySlot>();

  function slotFor(timestamp: string | null, model: string): ActivitySlot | null {
    const slotStart = slotStartOf(timestamp) ?? fallbackSlotStart;
    if (slotStart === null) return null;
    const key = `${slotStart}\0${model}`;
    let slot = slots.get(key);
    if (!slot) {
      slot = {
        slotStart,
        model,
        userMessages: 0,
        assistantMessages: 0,
        toolCalls: 0,
        requests: 0,
        aiCredits: null,
        requestsWithoutAiCredits: 0,
      };
      slots.set(key, slot);
    }
    return slot;
  }

  for (const message of events.messages) {
    if (message.role === "user" && message.source !== null) continue;
    const slot = slotFor(message.timestamp, NO_MODEL);
    if (!slot) continue;
    if (message.role === "user") slot.userMessages += 1;
    else slot.assistantMessages += 1;
  }

  for (const call of events.toolCalls) {
    const slot = slotFor(call.timestamp, NO_MODEL);
    if (slot) slot.toolCalls += 1;
  }

  for (const usage of events.usage) {
    const slot = slotFor(usage.timestamp, usage.model);
    if (!slot) continue;
    slot.requests += usage.requests;
    if (usage.aiCredits === null) slot.requestsWithoutAiCredits += usage.requests;
    else slot.aiCredits = (slot.aiCredits ?? 0) + usage.aiCredits;
  }

  return [...slots.values()].sort(
    (a, b) => a.slotStart - b.slotStart || (a.model < b.model ? -1 : a.model > b.model ? 1 : 0),
  );
}
