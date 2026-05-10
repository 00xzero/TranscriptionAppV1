/**
 * SPIKE — temporary file to validate ffmpeg/ffprobe bundle size in NFT trace.
 * Delete before committing.
 */
import ffmpegPath from "@ffmpeg-installer/ffmpeg";
import ffprobePath from "@ffprobe-installer/ffprobe";
import { inngest } from "@/infra/inngest/client";

export const spikeWaveform = inngest.createFunction(
    {
        id: "spike-waveform-bundle-check",
        triggers: [{ event: "spike/check" }],
        retries: 0,
    },
    async () => {
        return {
            ffmpeg: ffmpegPath.path,
            ffprobe: ffprobePath.path,
        };
    }
);
