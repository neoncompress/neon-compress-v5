// =====================================================
// NEON COMPRESS V5.2
// INDEPENDENT VIDEO PROCESSING ENGINE
//
// QUALITY METHOD  : Original stream copy
// FPS METHOD      : Preserve original frame timing
// TIKTOK OPTIMIZER: H.264 MP4 re-encoding
//
// No CompressBase dependency
// Single-thread FFmpeg WASM
// =====================================================

(function () {
"use strict";

const NEON_CONFIG = {
    version: "5.2",

    ffmpeg: "0.12.10",

    coreURL:
      "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.js",

    wasmURL:
      "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.wasm",

    defaultMode: "tiktok",

    crf: 18,

    preset: "medium",

    audioBitrate: "192k"
};

let ffmpegInstance = null;
let ffmpegLoading = null;


// =====================================================
// BASIC UTILITIES
// =====================================================

function formatSize(bytes) {
    return (bytes / 1048576).toFixed(2) + " MB";
}

function readType(view, offset) {
    return String.fromCharCode(
        view.getUint8(offset),
        view.getUint8(offset + 1),
        view.getUint8(offset + 2),
        view.getUint8(offset + 3)
    );
}

function readBoxes(data, start = 0, end = data.length) {

    const view = new DataView(
        data.buffer,
        data.byteOffset,
        data.byteLength
    );

    const boxes = [];

    let offset = start;

    while (offset + 8 <= end) {

        let size = view.getUint32(offset);

        const type = readType(view, offset + 4);

        let headerSize = 8;

        if (size === 1) {

            if (offset + 16 > end) {
                throw new Error("Invalid MP4 extended box");
            }

            const high = view.getUint32(offset + 8);
            const low = view.getUint32(offset + 12);

            size = high * 4294967296 + low;

            headerSize = 16;

        } else if (size === 0) {

            size = end - offset;
        }

        if (
            !Number.isSafeInteger(size) ||
            size < headerSize ||
            offset + size > end
        ) {
            throw new Error("Invalid MP4 box: " + type);
        }

        boxes.push({
            type,
            start: offset,
            end: offset + size,
            size,
            headerSize
        });

        offset += size;
    }

    return boxes;
}


// ============================================
// FIXED MP4 INSPECTOR — NEON V5.3
// Reads MP4 box headers without loading mdat
// ============================================

async function inspectVideoV5(file) {

    if (!(file instanceof Blob)) {
        throw new Error("Please select a video file.");
    }

    if (!file.size) {
        throw new Error("Video file is empty.");
    }

    const boxes = [];
    let offset = 0;

    while (offset + 8 <= file.size) {

        const headerBuffer = await file.slice(
            offset,
            Math.min(offset + 16, file.size)
        ).arrayBuffer();

        const view = new DataView(headerBuffer);

        let size = view.getUint32(0);

        const type = String.fromCharCode(
            view.getUint8(4),
            view.getUint8(5),
            view.getUint8(6),
            view.getUint8(7)
        );

        let headerSize = 8;

        if (size === 1) {

            if (headerBuffer.byteLength < 16) {
                throw new Error("Invalid extended MP4 box.");
            }

            const high = view.getUint32(8);
            const low = view.getUint32(12);

            size = high * 4294967296 + low;

            headerSize = 16;

        } else if (size === 0) {

            size = file.size - offset;

        }

        if (
            !Number.isSafeInteger(size) ||
            size < headerSize ||
            offset + size > file.size
        ) {
            throw new Error(
                "Invalid MP4 box: " + type
            );
        }

        boxes.push({
            type: type,
            start: offset,
            end: offset + size,
            size: size,
            headerSize: headerSize
        });

        offset += size;
    }

    if (offset !== file.size) {
        throw new Error("Invalid MP4 box structure.");
    }

    const ftyp = boxes.find(b => b.type === "ftyp");
    const moov = boxes.find(b => b.type === "moov");
    const mdat = boxes.find(b => b.type === "mdat");

    if (!ftyp || !moov || !mdat) {
        throw new Error(
            "Required MP4 boxes are missing."
        );
    }

    return {

        fileName: file.name || "video.mp4",

        fileSize: file.size,

        fileSizeMB: formatSize(file.size),

        format: "MP4",

        ftyp: true,

        moov: true,

        mdat: true,

        fastStart: moov.start < mdat.start,

        moovPosition: moov.start,

        mdatPosition: mdat.start,

        topLevelBoxes: boxes.map(b => b.type)

    };
}


// ============================================
// NEON V5.3 — FFmpeg Worker CORS FIX
// ============================================

async function loadFFmpeg() {

    if (ffmpegInstance && ffmpegInstance.loaded) {
        return ffmpegInstance;
    }

    if (ffmpegLoading) {
        return ffmpegLoading;
    }

    ffmpegLoading = (async () => {

        const { FFmpeg } = await import(
            "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js"
        );

        const { toBlobURL } = await import(
            "https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/esm/index.js"
        );

        const ffmpeg = new FFmpeg();

        ffmpeg.on("log", ({ message }) => {
            console.log("[NEON FFmpeg]", message);
        });

        ffmpeg.on("progress", ({ progress }) => {

            const percent = Math.max(
                0,
                Math.min(100, Math.round(progress * 100))
            );

            if (typeof window.NEON_V5_PROGRESS === "function") {
                window.NEON_V5_PROGRESS(percent);
            }
        });

        const baseURL =
            "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd";

        const workerModuleURL =
            "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/worker.js";

        const [coreURL, wasmURL] = await Promise.all([

            toBlobURL(
                baseURL + "/ffmpeg-core.js",
                "text/javascript"
            ),

            toBlobURL(
                baseURL + "/ffmpeg-core.wasm",
                "application/wasm"
            )

        ]);

        // Create a same-origin Blob Worker wrapper.
        // The wrapper imports the original ESM worker.

        const workerSource =
            `import("${workerModuleURL}");`;

        const workerBlob = new Blob(
            [workerSource],
            { type: "text/javascript" }
        );

        const classWorkerURL =
            URL.createObjectURL(workerBlob);

        await ffmpeg.load({

            coreURL,
            wasmURL,
            classWorkerURL

        });

        ffmpegInstance = ffmpeg;

        return ffmpeg;

    })();

    try {

        return await ffmpegLoading;

    } catch (error) {

        ffmpegLoading = null;

        console.error("[NEON FFmpeg ERROR]", error);

        throw new Error(
            "FFmpeg loading failed: " + error.message
        );

    }
}


// =====================================================
// FILE CLEANUP
// =====================================================

async function cleanupFFmpeg(ffmpeg, files) {

    for (const name of files) {

        try {
            await ffmpeg.deleteFile(name);
        } catch (error) {
            console.warn("Cleanup skipped:", name);
        }

    }
}


// =====================================================
// QUALITY METHOD
// Original Video Stream Copy
// =====================================================

async function qualityMethod(file) {

    const ffmpeg = await loadFFmpeg();

    const inputName = "neon_input.mp4";
    const outputName = "neon_quality.mp4";

    try {

        await ffmpeg.writeFile(
            inputName,
            new Uint8Array(await file.arrayBuffer())
        );

        await ffmpeg.exec([

            "-i", inputName,

            "-map", "0:v:0",

            "-map", "0:a?",

            "-c", "copy",

            "-map_metadata", "0",

            "-movflags", "+faststart",

            "-f", "mp4",

            outputName

        ]);

        const result = await ffmpeg.readFile(outputName);

        return new Blob(
            [result.buffer.slice(
                result.byteOffset,
                result.byteOffset + result.byteLength
            )],
            { type: "video/mp4" }
        );

    } finally {

        await cleanupFFmpeg(
            ffmpeg,
            [inputName, outputName]
        );

    }
}


// =====================================================
// FPS METHOD
// Preserve Original Frame Timing
// =====================================================

async function fpsMethod(file) {

    const ffmpeg = await loadFFmpeg();

    const inputName = "neon_fps_input.mp4";
    const outputName = "neon_fps_output.mp4";

    try {

        await ffmpeg.writeFile(
            inputName,
            new Uint8Array(await file.arrayBuffer())
        );

        await ffmpeg.exec([

            "-i", inputName,

            "-map", "0:v:0",

            "-map", "0:a?",

            "-c", "copy",

            "-fps_mode", "passthrough",

            "-map_metadata", "0",

            "-movflags", "+faststart",

            "-f", "mp4",

            outputName

        ]);

        const result = await ffmpeg.readFile(outputName);

        return new Blob(
            [result.buffer.slice(
                result.byteOffset,
                result.byteOffset + result.byteLength
            )],
            { type: "video/mp4" }
        );

    } finally {

        await cleanupFFmpeg(
            ffmpeg,
            [inputName, outputName]
        );

    }
}


// =====================================================
// TIKTOK OPTIMIZER
// H.264 MP4 RE-ENCODING
// =====================================================

async function tiktokOptimizer(file) {

    const ffmpeg = await loadFFmpeg();

    const inputName = "neon_tiktok_input.mp4";
    const outputName = "neon_tiktok_output.mp4";

    try {

        await ffmpeg.writeFile(
            inputName,
            new Uint8Array(await file.arrayBuffer())
        );

        await ffmpeg.exec([

            "-i", inputName,

            "-map", "0:v:0",

            "-map", "0:a?",

            // H.264 Video
            "-c:v", "libx264",

            // High visual quality
            "-preset", NEON_CONFIG.preset,

            "-crf", String(NEON_CONFIG.crf),

            // Compatible pixel format
            "-pix_fmt", "yuv420p",

            "-profile:v", "high",

            // Keep original frame timing
            "-fps_mode", "passthrough",

            // AAC Audio
            "-c:a", "aac",

            "-b:a", NEON_CONFIG.audioBitrate,

            "-ar", "48000",

            // Preserve metadata
            "-map_metadata", "0",

            // MP4 Fast Start
            "-movflags", "+faststart",

            "-f", "mp4",

            outputName

        ]);

        const result = await ffmpeg.readFile(outputName);

        return new Blob(
            [result.buffer.slice(
                result.byteOffset,
                result.byteOffset + result.byteLength
            )],
            { type: "video/mp4" }
        );

    } finally {

        await cleanupFFmpeg(
            ffmpeg,
            [inputName, outputName]
        );

    }
}


// =====================================================
// MAIN PROCESSING API
// =====================================================

async function optimizeVideoV5(file, options = {}) {

    if (!(file instanceof Blob)) {
        throw new Error("Please select a valid MP4 video.");
    }

    const mode = (
        options.mode || NEON_CONFIG.defaultMode
    ).toLowerCase();

    const before = await inspectVideoV5(file);

    let output;

    if (mode === "quality") {

        output = await qualityMethod(file);

    } else if (mode === "fps") {

        output = await fpsMethod(file);

    } else if (mode === "tiktok") {

        output = await tiktokOptimizer(file);

    } else {

        throw new Error("Unknown processing mode: " + mode);

    }

    if (!output || !output.size) {
        throw new Error("Processing produced an empty video.");
    }

    const after = await inspectVideoV5(output);

    return {

        file: output,

        method: mode.toUpperCase(),

        changes: {

            inputSize: before.fileSize,

            outputSize: after.fileSize,

            fastStart: after.fastStart,

            videoReencoding: mode === "tiktok",

            fpsInterpolation: false,

            fpsTimingPreserved: true,

            audioReencoding: mode === "tiktok",

            codec: mode === "tiktok" ? "H.264" : "Original",

            resolution: "No upscaling",

            qualitySetting: mode === "tiktok"
                ? "CRF " + NEON_CONFIG.crf
                : "Original stream",

            originalFrameTiming: true

        }

    };

}


// =====================================================
// PUBLIC API
// =====================================================

window.NEON_V5 = {

    version: NEON_CONFIG.version,

    inspectVideoV5,

    optimizeVideoV5,

    qualityMethod,

    fpsMethod,

    tiktokOptimizer,

    loadFFmpeg

};

console.log(
    "NEON COMPRESS V5.2 ENGINE READY"
);

})();
