// ============================================
// NEON COMPRESS V5
// Independent MP4 Fast Start Engine
// No FFmpeg / No CompressBase / No Re-encoding
// ============================================

(function () {
"use strict";

const CONTAINERS = new Set([
  "moov",
  "trak",
  "mdia",
  "minf",
  "stbl",
  "edts",
  "dinf",
  "mvex"
]);

function readType(view, offset) {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3)
  );
}

function readBoxes(data, start = 0, end = data.byteLength) {
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
      if (offset + 16 > end) throw new Error("Invalid MP4 box");

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
      throw new Error("Invalid MP4 box size: " + type);
    }

    boxes.push({
      type,
      start: offset,
      end: offset + size,
      size,
      headerSize,
      data: data.subarray(offset, offset + size)
    });

    offset += size;
  }

  return boxes;
}

function joinArrays(arrays) {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const output = new Uint8Array(total);

  let position = 0;

  for (const array of arrays) {
    output.set(array, position);
    position += array.length;
  }

  return output;
}

function makeBox(type, payload) {
  const size = payload.length + 8;

  if (size <= 0xffffffff) {
    const output = new Uint8Array(size);
    const view = new DataView(output.buffer);

    view.setUint32(0, size);

    for (let i = 0; i < 4; i++) {
      output[4 + i] = type.charCodeAt(i);
    }

    output.set(payload, 8);
    return output;
  }

  const output = new Uint8Array(payload.length + 16);
  const view = new DataView(output.buffer);

  view.setUint32(0, 1);

  for (let i = 0; i < 4; i++) {
    output[4 + i] = type.charCodeAt(i);
  }

  view.setUint32(8, 0);
  view.setUint32(12, output.length);
  output.set(payload, 16);

  return output;
}

function parseTree(data, start = 0, end = data.length) {
  return readBoxes(data, start, end).map(box => {
    if (!CONTAINERS.has(box.type)) {
      return { ...box, children: null };
    }

    const childStart = box.start + box.headerSize;

    return {
      ...box,
      children: parseTree(data, childStart, box.end)
    };
  });
}

function serializeTree(boxes, shift) {
  return joinArrays(boxes.map(box => {
    if (box.type === "stco" || box.type === "co64") {
      return updateChunkOffsets(box, shift);
    }

    if (box.children) {
      const children = serializeTree(box.children, shift);
      const payload = joinArrays([
        box.data.subarray(0, box.headerSize),
        children
      ]);

      return makeBox(box.type, payload);
    }

    return box.data;
  }));
}

function updateChunkOffsets(box, shift) {
  const view = new DataView(
    box.data.buffer,
    box.data.byteOffset,
    box.data.byteLength
  );

  const count = view.getUint32(box.headerSize + 4);
  const entrySize = box.type === "co64" ? 8 : 4;
  const entriesStart = box.headerSize + 8;

  if (
    entriesStart + count * entrySize > box.data.length
  ) {
    throw new Error("Invalid chunk offset table");
  }

  const payload = new Uint8Array(box.data.length - box.headerSize);
  payload.set(box.data.subarray(box.headerSize));

  const newView = new DataView(
    payload.buffer,
    payload.byteOffset,
    payload.byteLength
  );

  for (let i = 0; i < count; i++) {
    const position = 8 + i * entrySize;

    if (entrySize === 4) {
      const value = newView.getUint32(position);

      if (value >= shift.insertionPoint) {
        const updated = value + shift.amount;

        if (updated > 0xffffffff) {
          throw new Error(
            "Chunk offset requires co64 upgrade. Processing stopped safely."
          );
        }

        newView.setUint32(position, updated);
      }
    } else {
      const high = newView.getUint32(position);
      const low = newView.getUint32(position + 4);

      const value = high * 4294967296 + low;

      if (value >= shift.insertionPoint) {
        const updated = value + shift.amount;

        if (!Number.isSafeInteger(updated)) {
          throw new Error("Unsafe 64-bit chunk offset");
        }

        newView.setUint32(position, Math.floor(updated / 4294967296));
        newView.setUint32(position + 4, updated % 4294967296);
      }
    }
  }

  return makeBox(box.type, payload);
}

async function readFile(file) {
  return new Uint8Array(await file.arrayBuffer());
}

async function inspectVideoV5(file) {
  if (!(file instanceof Blob)) {
    throw new Error("Please select a video file");
  }

  const data = await readFile(file);
  const boxes = readBoxes(data);

  const ftyp = boxes.find(b => b.type === "ftyp");
  const moov = boxes.find(b => b.type === "moov");
  const mdat = boxes.find(b => b.type === "mdat");

  if (!ftyp || !moov || !mdat) {
    throw new Error("Invalid or unsupported MP4 file");
  }

  return {
    fileName: file.name || "video.mp4",
    fileSize: file.size,
    fileSizeMB: (file.size / 1048576).toFixed(2),
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

async function rebuildMP4FastStartV5(file) {
  const data = await readFile(file);
  const boxes = readBoxes(data);

  const moov = boxes.find(b => b.type === "moov");
  const ftyp = boxes.find(b => b.type === "ftyp");
  const firstMdat = boxes.find(b => b.type === "mdat");

  if (!moov || !ftyp || !firstMdat) {
    throw new Error("Required MP4 boxes are missing");
  }

  if (moov.start < firstMdat.start) {
    return {
      file: new Blob([data], { type: "video/mp4" }),
      changed: false
    };
  }

  const tree = parseTree(data, moov.start, moov.end);

  const newMoov = serializeTree(tree, {
    insertionPoint: firstMdat.start,
    amount: moov.size
  });

  const beforeMdat = data.subarray(0, firstMdat.start);
  const afterMdat = data.subarray(firstMdat.start, moov.start);
  const afterMoov = data.subarray(moov.end);

  const output = joinArrays([
    beforeMdat,
    newMoov,
    afterMdat,
    afterMoov
  ]);

  return {
    file: new Blob([output], { type: "video/mp4" }),
    changed: true
  };
}

async function optimizeVideoV5(file) {
  const before = await inspectVideoV5(file);

  const rebuilt = await rebuildMP4FastStartV5(file);

  const after = await inspectVideoV5(rebuilt.file);

  if (!after.fastStart) {
    throw new Error("Fast Start verification failed");
  }

  return {
    file: rebuilt.file,
    method: "MP4 FAST START",
    changes: {
      fastStartApplied: rebuilt.changed,
      originalSize: before.fileSize,
      outputSize: rebuilt.file.size,
      resolution: "Original video samples preserved",
      videoReencoding: false,
      fpsInterpolation: false,
      audioReencoding: false
    }
  };
}

window.NEON_V5 = {
  inspectVideoV5,
  optimizeVideoV5,
  rebuildMP4FastStartV5
};

})();
