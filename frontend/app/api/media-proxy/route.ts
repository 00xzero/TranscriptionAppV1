/**
 * Media Proxy Endpoint for Local Development
 * 
 * Proxies media file requests to local Supabase storage.
 * This allows Deepgram to access local media files through a single ngrok tunnel.
 * 
 * Security:
 * - Requires MEDIA_PROXY_SECRET token in query params (prevents unauthorized access)
 * - Only allows paths that match valid storage key format (userId/projectId/filename)
 * - Only enabled when DEEPGRAM_USE_PROXY=true
 * 
 * Usage: GET /api/media-proxy?path=<storage-path>&token=<secret>
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Use env var or deterministic fallback for local dev
// Both this file and start/route.ts must use the same fallback
const PROXY_SECRET = process.env.MEDIA_PROXY_SECRET || "local-dev-proxy-secret";

// Export the secret so it can be used when generating proxy URLs
export function getProxySecret(): string {
    return PROXY_SECRET;
}

// Validate storage path format: userId/projectId/filename
// This prevents path traversal and limits scope to valid media paths
function isValidStoragePath(path: string): boolean {
    // Must match: uuid/uuid/filename pattern
    const uuidPattern = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
    const pathPattern = new RegExp(`^${uuidPattern}/${uuidPattern}/[^/]+$`, "i");
    return pathPattern.test(path);
}

export async function GET(request: NextRequest) {
    // Only allow when proxy mode is enabled
    if (process.env.DEEPGRAM_USE_PROXY !== "true") {
        return NextResponse.json(
            { error: "Media proxy is not enabled" },
            { status: 403 }
        );
    }

    const searchParams = request.nextUrl.searchParams;
    const path = searchParams.get("path");
    const token = searchParams.get("token");

    // Validate required params
    if (!path) {
        return NextResponse.json({ error: "Missing path parameter" }, { status: 400 });
    }

    // Validate token (prevents unauthorized access)
    if (!token || token !== PROXY_SECRET) {
        console.warn("[media-proxy] Invalid or missing token");
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Validate path format (prevents path traversal attacks)
    if (!isValidStoragePath(path)) {
        console.warn("[media-proxy] Invalid path format:", path);
        return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }

    try {
        const supabase = createAdminClient();

        // Download file from Supabase storage
        const { data, error } = await supabase.storage
            .from("media")
            .download(path);

        if (error || !data) {
            console.error("[media-proxy] Download error:", error);
            return NextResponse.json(
                { error: "Failed to fetch media" },
                { status: 404 }
            );
        }

        // Determine content type from path extension
        const ext = path.split('.').pop()?.toLowerCase() || '';
        const contentTypes: Record<string, string> = {
            'mp3': 'audio/mpeg',
            'wav': 'audio/wav',
            'ogg': 'audio/ogg',
            'flac': 'audio/flac',
            'mp4': 'video/mp4',
            'webm': 'video/webm',
            'mov': 'video/quicktime',
            'm4a': 'audio/mp4',
            'aac': 'audio/aac',
        };
        const contentType = contentTypes[ext] || 'application/octet-stream';

        // Get the file as an ArrayBuffer
        const arrayBuffer = await data.arrayBuffer();
        const contentLength = arrayBuffer.byteLength;

        // Return with proper headers for streaming
        // Deepgram needs Content-Length and proper Content-Type
        return new NextResponse(arrayBuffer, {
            status: 200,
            headers: {
                "Content-Type": contentType,
                "Content-Length": String(contentLength),
                "Accept-Ranges": "bytes",
                "Cache-Control": "private, max-age=3600",
                // Prevent caching by intermediaries (security)
                "X-Content-Type-Options": "nosniff",
            },
        });
    } catch (error) {
        console.error("[media-proxy] Error:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
