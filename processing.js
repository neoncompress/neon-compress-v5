// ======================================================
// NEON COMPRESS V5
// CompressBase Max Quality + FPS Integration
// Independent Processing Engine
// ======================================================

(function () {
  "use strict";

  let compressBaseModulesPromise = null;
  let processingInProgress = false;

  const SUPPORTED_VARIANTS = new Set([
    "variant-1",
    "variant-2",
    "variant-3"
  ]);

  // ======================================================
  // LOAD COMPRESSBASE MODULES
  // ======================================================

  async function getCompressBaseModules() {

    if (!compressBaseModulesPromise) {

      compressBaseModulesPromise = Promise.all([

        import(
          "https://compressbase.com/method-api/downscale.mjs"
        ),

        import(
          "https://compressbase.com/method-api/client.mjs"
        )

      ])
      .then(([downscaleModule, clientModule]) => {

        if (
          typeof downscaleModule.downscaleVideo !== "function"
        ) {
          throw new Error(
            "CompressBase downscaleVideo module failed."
          );
        }

        if (
          typeof clientModule.patchVideo !== "function"
        ) {
          throw new Error(
            "CompressBase patchVideo module failed."
          );
        }

        return {
          downscaleVideo: downscaleModule.downscaleVideo,
          patchVideo: clientModule.patchVideo
        };

      })
      .catch(error => {

        compressBaseModulesPromise = null;

        throw error;

      });

    }

    return compressBaseModulesPromise;
  }

  // ======================================================
  // COMPRESSBASE CREDIT
  // ======================================================

  function addCompressBaseCredit(container) {

    if (!container) return null;

    const existing = container.querySelector(
      "[data-compressbase-credit]"
    );

    if (existing) return existing;

    const credit = document.createElement("p");

    credit.dataset.compressbaseCredit = "true";

    credit.style.cssText = `
      text-align:center;
      color:#888;
      font-size:11px;
      margin-top:15px;
    `;

    credit.append("Powered by ");

    const link = document.createElement("a");

    link.href = "https://compressbase.com/";

    link.target = "_blank";

    link.rel = "noopener noreferrer";

    link.textContent = "CompressBase";

    link.style.color = "#ff334e";

    credit.append(link);

    container.append(credit);

    return credit;
  }

  // ======================================================
  // FILE SIZE
  // ======================================================

  function formatSize(bytes) {

    return (
      bytes / 1024 / 1024
    ).toFixed(2) + " MB";

  }

  // ======================================================
  // INSPECT VIDEO V5
  // ======================================================

  async function inspectVideoV5(file) {

    if (!file) {
      throw new Error("Please select a video.");
    }

    if (file.size < 16) {
      throw new Error("Invalid video file.");
    }

    const url = URL.createObjectURL(file);

    try {

      const video = document.createElement("video");

      video.preload = "metadata";

      video.muted = true;

      video.playsInline = true;

      video.src = url;

      await new Promise((resolve, reject) => {

        video.onloadedmetadata = resolve;

        video.onerror = () => {
          reject(
            new Error("Cannot read video metadata.")
          );
        };

      });

      const result = {

        engine: "NEON COMPRESS V5",

        fileName: file.name,

        fileSize: formatSize(file.size),

        fileType: file.type || "Unknown",

        duration: Number(
          video.duration.toFixed(3)
        ),

        resolution: {

          width: video.videoWidth,

          height: video.videoHeight

        },

        aspectRatio:
          video.videoWidth +
          "x" +
          video.videoHeight,

        fps: "Not reliably detectable through browser metadata inspection",

        processing: "Ready"

      };

      video.remove();

      return result;

    } finally {

      URL.revokeObjectURL(url);

    }

  }

  // ======================================================
  // OUTPUT FILE NAME
  // ======================================================

  function makeOutputFile(blob) {

    return new File(
      [blob],
      "neoncompress-v5.mp4",
      {
        type: "video/mp4",
        lastModified: Date.now()
      }
    );

  }

  // ======================================================
  // OPTIMIZE VIDEO V5
  // ======================================================

  async function optimizeVideoV5(
    file,
    onProgress = () => {},
    options = {}
  ) {

    if (!file) {
      throw new Error("Please select a video.");
    }

    if (file.size < 16) {
      throw new Error("Invalid video file.");
    }

    if (processingInProgress) {

      throw new Error(
        "Another video is already processing."
      );

    }

    const {

      postingDevice = "variant-1",

      signal,

      onStatus = () => {},

      engine = "auto",

      frameLiteQuality,

      assetsBaseURL

    } = options;

    if (!SUPPORTED_VARIANTS.has(postingDevice)) {

      throw new Error(
        "Invalid posting device variant."
      );

    }

    if (
      !["auto", "compatibility"].includes(engine)
    ) {

      throw new Error(
        "Invalid processing engine."
      );

    }

    processingInProgress = true;

    try {

      signal?.throwIfAborted();

      onProgress(1);

      onStatus(
        "Loading NEON V5 processing engine..."
      );

      // LOAD MODULES

      const {
        downscaleVideo,
        patchVideo
      } = await getCompressBaseModules();

      signal?.throwIfAborted();

      // STEP 1: DOWNSCALE

      onStatus(
        "Processing video frames..."
      );

      const mp4 = await downscaleVideo(file, {

        signal,

        engine,

        ...(assetsBaseURL
          ? { assetsBaseURL }
          : {}),

        ...(Number.isFinite(frameLiteQuality)
          ? { frameLiteQuality }
          : {}),

        onStatus: message => {

          onStatus(message);

        },

        onProgress: fraction => {

          if (Number.isFinite(fraction)) {

            const value = Math.max(
              0,
              Math.min(1, fraction)
            );

            onProgress(
              Math.round(5 + value * 85)
            );

          }

        }

      });

      signal?.throwIfAborted();

      if (
        !(mp4 instanceof Blob) ||
        mp4.size < 16
      ) {

        throw new Error(
          "Video frame processing failed."
        );

      }

      // STEP 2: PATCH METADATA

      onStatus(
        "Applying Quality + FPS metadata..."
      );

      onProgress(93);

      const output = await patchVideo(mp4, {

        postingDevice,

        signal,

        onStatus: message => {

          onStatus(message);

          onProgress(97);

        }

      });

      signal?.throwIfAborted();

      if (
        !(output instanceof Blob) ||
        output.size < 16
      ) {

        throw new Error(
          "CompressBase returned an invalid MP4."
        );

      }

      // STEP 3: CREATE FILE

      onProgress(99);

      const outputFile = makeOutputFile(output);

      onProgress(100);

      onStatus(
        "NEON COMPRESS V5 processing complete."
      );

      return {

        file: outputFile,

        method:
          "CompressBase Max Quality + FPS",

        changes: [

          "Local video frame processing",

          "Quality + FPS metadata patch",

          "MP4 output generated",

          "Original audio/video payload handling depends on the processing engine"

        ]

      };

    } catch (error) {

      console.error(
        "NEON V5 Processing Error:",
        error
      );

      throw error;

    } finally {

      processingInProgress = false;

    }

  }

  // ======================================================
  // INITIALIZE
  // ======================================================

  function initialize() {

    const container = document.querySelector(
      ".card"
    );

    if (container) {

      addCompressBaseCredit(container);

    }

  }

  // ======================================================
  // PUBLIC API
  // ======================================================

  window.NEON_V5 = {

    inspectVideoV5,

    optimizeVideoV5,

    addCompressBaseCredit,

    version: "5.0.0"

  };

  if (document.readyState === "loading") {

    document.addEventListener(
      "DOMContentLoaded",
      initialize
    );

  } else {

    initialize();

  }

})();
