/**
 * Dead Letter Queue (DLQ) Utility
 * 
 * Persists failed events for manual recovery when all retry attempts are exhausted.
 * Used by Inngest onFailure handlers as a last resort.
 */

import { createAdminClient } from "@/lib/supabase/admin";

export interface FailedEventData {
  eventName: string;
  eventData: Record<string, unknown>;
  errorMessage: string;
  errorStack?: string;
  projectId?: string;
  jobId?: string;
}

/**
 * Persist a failed event to the dead letter queue
 * 
 * Call this from Inngest onFailure handlers when you want to ensure
 * the failure is recorded even if the handler itself fails.
 */
export async function persistToDeadLetterQueue(
  data: FailedEventData
): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const supabase = createAdminClient();

    const { data: inserted, error } = await supabase
      .from("failed_events")
      .insert({
        event_name: data.eventName,
        event_data: data.eventData,
        error_message: data.errorMessage,
        error_stack: data.errorStack,
        project_id: data.projectId || null,
        job_id: data.jobId || null,
      })
      .select("id")
      .single();

    if (error) {
      console.error("[DLQ] Failed to persist to dead letter queue:", error);
      return { success: false, error: error.message };
    }

    console.log(`[DLQ] Event persisted to dead letter queue: ${inserted.id}`);
    return { success: true, id: inserted.id };
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    console.error("[DLQ] Exception persisting to dead letter queue:", errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * Mark a failed event as resolved
 * 
 * Call this when an admin has investigated and resolved the issue.
 */
export async function resolveFailedEvent(
  id: string,
  resolvedBy: string,
  notes?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = createAdminClient();

    const { error } = await supabase
      .from("failed_events")
      .update({
        resolved_at: new Date().toISOString(),
        resolved_by: resolvedBy,
        resolution_notes: notes,
      })
      .eq("id", id);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    return { success: false, error: errorMessage };
  }
}
