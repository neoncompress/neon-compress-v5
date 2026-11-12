// Processing.js — current CompressBase Quality + FPS integration
// Uses the current official client helper's local `sl-sr` method by default.
// The helper preserves the MP4's "Patched by Compressbase" comment as required.
// Do not strip or overwrite that output comment.

let compressBaseModulePromise = null;

const SUPPORTED_METHODS = new Set([
  'sl-sr',
  'variant-1',
  'variant-2',
  'variant-3',
]);

async function getCompressBase() {
  if (!compressBaseModulePromise) {
    compressBaseModulePromise = import(
      /* @vite-ignore */ 'https://compressbase.com/method-api/client.mjs'
    ).catch((error) => {
      compressBaseModulePromise = null;
      throw error;
    });
  }
  return compressBaseModulePromise;
}

/**
 * Add CompressBase's required visible credit beside the processing tool.
 * Call once from the UI, passing the element beside your upload/process controls.
 *
 * @param {HTMLElement} container
 * @returns {HTMLElement} The visible credit element.
 */
export function addCompressBaseCredit(container) {
  if (!container || typeof container.append !== 'function') {
    throw new Error('Pass the page element beside the video processing tool.');
  }

  const existing = container.querySelector?.('[data-compressbase-credit]');
  if (existing) return existing;

  const credit = document.createElement('p');
  credit.dataset.compressbaseCredit = 'true';
  credit.append('Powered by ');

  const link = document.createElement('a');
  link.href = 'https://compressbase.com/';
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = 'CompressBase';
  credit.append(link);
  container.append(credit);

  return credit;
}

/**
 * Process an MP4 with CompressBase's current Quality + FPS method.
 *
 * @param {File|Blob} file MP4 chosen by the visitor.
 * @param {(percent: number) => void} onProgress Optional progress callback.
 * @param {string} mode Kept for compatibility with the existing app.
 * @param {{
 *   postingDevice?: string,
 *   signal?: AbortSignal,
 *   onStatus?: (message: string) => void,
 *   creditContainer?: HTMLElement
 * }} options
 * @returns {Promise<{blob: Blob, name: string}>}
 */
export async function optimizeVideo(
  file,
  onProgress = () => {},
  mode = 'max',
  options = {}
) {
  const {
    postingDevice = 'sl-sr',
    signal,
    onStatus = () => {},
    creditContainer,
  } = options ?? {};

  if (!file || typeof file.slice !== 'function' || typeof file.size !== 'number') {
    throw new Error('Please select a valid video file.');
  }
  if (file.name && !/\.mp4$/i.test(file.name)) {
    throw new Error('Please select an MP4 video.');
  }
  if (file.size < 16) {
    throw new Error('The selected video file is too small or empty.');
  }
  if (file.size > 8 * 1024 ** 3) {
    throw new Error('The current CompressBase helper supports MP4 files up to 8 GiB.');
  }
  if (!SUPPORTED_METHODS.has(postingDevice)) {
    throw new Error('Choose sl-sr or one of the current variants: variant-1, variant-2, variant-3.');
  }

  // If the app supplies a container, create the required visible credit there.
  if (creditContainer) addCompressBaseCredit(creditContainer);

  signal?.throwIfAborted();
  onProgress(5);
  onStatus(
    postingDevice === 'sl-sr'
      ? 'Applying the current local Quality + FPS method…'
      : 'Preparing the MP4 for the selected Quality + FPS variant…'
  );

  try {
    const { patchVideo } = await getCompressBase();
    if (typeof patchVideo !== 'function') {
      throw new Error('The current CompressBase patchVideo helper did not load.');
    }

    signal?.throwIfAborted();
    const output = await patchVideo(file, {
      postingDevice,
      signal,
      onStatus: (message) => {
        onStatus(message);
        onProgress(75);
      },
    });

    signal?.throwIfAborted();
    if (!(output instanceof Blob) || output.size < 16) {
      throw new Error('CompressBase returned an empty or invalid MP4.');
    }

    const inputName = file.name || 'video.mp4';
    const baseName = inputName.replace(/\.mp4$/i, '');
    const name = mode === 'tiktok'
      ? `${baseName}-neon-tiktok-quality-fps.mp4`
      : 'neoncompress.mp4';

    onProgress(100);
    onStatus('Done. The CompressBase comment is kept in the output as required.');
    return { blob: output, name };
  } catch (error) {
    console.error('NEON COMPRESS processing error:', error);
    throw error;
  }
}
