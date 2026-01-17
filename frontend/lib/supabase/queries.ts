/**
 * Supabase query helpers for frontend data operations.
 *
 * Provides typed functions for CRUD operations on projects, chunks, and speakers.
 * Uses the browser Supabase client for RLS-protected access.
 */
import { createClient } from './client'
import type {
    Project,
    Job,
    Chunk,
    Speaker,
    ChunkUpdate,
    SpeakerUpdate,
    SpeakerInsert,
    ProjectUpdate,
} from './types'

// ============================================================================
// Projects
// ============================================================================

/**
 * Fetch all projects for the current user.
 */
export async function fetchProjects(): Promise<Project[]> {
    const supabase = createClient()
    const { data, error } = await supabase
        .from('projects')
        .select('*')
        .order('created_at', { ascending: false })

    if (error) throw error
    return data || []
}

/**
 * Fetch a single project by ID.
 */
export async function fetchProjectById(id: string): Promise<Project | null> {
    const supabase = createClient()
    const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('id', id)
        .single()

    if (error) {
        if (error.code === 'PGRST116') return null // Not found
        throw error
    }
    return data
}

/**
 * Fetch jobs for a project.
 */
export async function fetchProjectJobs(projectId: string): Promise<Job[]> {
    const supabase = createClient()
    const { data, error } = await supabase
        .from('jobs')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })

    if (error) throw error
    return data || []
}

/**
 * Update a project.
 */
export async function updateProject(
    id: string,
    updates: ProjectUpdate
): Promise<Project> {
    const supabase = createClient()
    const { data, error } = await supabase
        .from('projects')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

    if (error) throw error
    return data
}

/**
 * Delete a project.
 */
export async function deleteProject(id: string): Promise<void> {
    const supabase = createClient()
    const { error } = await supabase.from('projects').delete().eq('id', id)

    if (error) throw error
}

// ============================================================================
// Chunks
// ============================================================================

/**
 * Fetch all chunks for a project.
 */
export async function fetchChunks(projectId: string): Promise<Chunk[]> {
    const supabase = createClient()
    const { data, error } = await supabase
        .from('chunks')
        .select('*')
        .eq('project_id', projectId)
        .order('start_ms', { ascending: true })

    if (error) throw error
    return data || []
}

/**
 * Update a chunk (text, speaker, etc).
 */
export async function updateChunk(
    id: string,
    updates: ChunkUpdate
): Promise<Chunk> {
    const supabase = createClient()
    const { data, error } = await supabase
        .from('chunks')
        .update({ ...updates, is_edited: true })
        .eq('id', id)
        .select()
        .single()

    if (error) throw error
    return data
}

// ============================================================================
// Speakers
// ============================================================================

/**
 * Fetch all speakers for a project.
 */
export async function fetchSpeakers(projectId: string): Promise<Speaker[]> {
    const supabase = createClient()
    const { data, error } = await supabase
        .from('speakers')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true })

    if (error) throw error
    return data || []
}

/**
 * Create a new speaker.
 */
export async function createSpeaker(
    projectId: string,
    label: string
): Promise<Speaker> {
    const supabase = createClient()
    const insert: SpeakerInsert = {
        project_id: projectId,
        label,
    }

    const { data, error } = await supabase
        .from('speakers')
        .insert(insert)
        .select()
        .single()

    if (error) throw error
    return data
}

/**
 * Update a speaker.
 */
export async function updateSpeaker(
    id: string,
    updates: SpeakerUpdate
): Promise<Speaker> {
    const supabase = createClient()
    const { data, error } = await supabase
        .from('speakers')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

    if (error) throw error
    return data
}

/**
 * Delete a speaker.
 */
export async function deleteSpeaker(id: string): Promise<void> {
    const supabase = createClient()
    const { error } = await supabase.from('speakers').delete().eq('id', id)

    if (error) throw error
}
