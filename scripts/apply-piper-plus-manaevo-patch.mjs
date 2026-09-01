import { readFileSync, writeFileSync } from "node:fs";

const INDEX_PATH = "node_modules/piper-plus/src/index.js";
const SESSION_PATH = "node_modules/piper-plus/src/webgpu-session-manager.js";

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) {
    throw new Error(`piper-plus 0.6.0 patch drift at ${label}`);
  }
  return source.replace(before, after);
}

let index = readFileSync(INDEX_PATH, "utf8");

index = replaceOnce(
  index,
  "      progress({ stage: 'model', progress: 0.1, message: 'Downloading config...' });\n      let configResponse = await fetch(configUrl);\n      if (!configResponse.ok && configResponse.status === 404 && configFallbackUrl) {\n        configResponse = await fetch(configFallbackUrl);\n      }\n      if (!configResponse.ok) {\n        throw new Error(`Failed to fetch config: ${configResponse.status} ${configResponse.statusText}`);\n      }\n      this._config = await configResponse.json();",
  "      progress({ stage: 'model', progress: 0.1, message: 'Loading config...' });\n      // ManaEvo parity: reuse the config cached with the exact ONNX revision.\n      if (options.modelConfig) {\n        this._config = options.modelConfig;\n      } else {\n        let configResponse = await fetch(configUrl);\n        if (!configResponse.ok && configResponse.status === 404 && configFallbackUrl) {\n          configResponse = await fetch(configFallbackUrl);\n        }\n        if (!configResponse.ok) {\n          throw new Error(`Failed to fetch config: ${configResponse.status} ${configResponse.statusText}`);\n        }\n        this._config = await configResponse.json();\n      }",
  "cached model config",
);

index = replaceOnce(
  index,
  "      this._modelUrl = modelUrl;\n      this._session = await this._sessionManager.createSession(modelUrl);\n\n      progress({ stage: 'model', progress: 0.7, message: 'Model loaded.' });",
  "      this._modelUrl = modelUrl;\n      this._session = await this._sessionManager.createSession(modelUrl);\n\n      // ManaEvo parity: detect the Tsukuyomi graph's required built-in-speaker inputs.\n      const inputNames = this._session.inputNames || [];\n      this._hasSpeakerEmbedding = inputNames.includes('speaker_embedding');\n      this._hasProsodyFeatures = inputNames.includes('prosody_features');\n      const speakerInputIndex = inputNames.indexOf('speaker_embedding');\n      const inputMetadata = this._session.inputMetadata;\n      const speakerMetadata = Array.isArray(inputMetadata)\n        ? inputMetadata[speakerInputIndex]\n        : inputMetadata?.speaker_embedding;\n      const speakerShape = speakerMetadata?.shape || speakerMetadata?.dimensions || speakerMetadata?.dims;\n      this._speakerEmbeddingSize = Number.isInteger(speakerShape?.[1]) && speakerShape[1] > 0\n        ? speakerShape[1]\n        : 256;\n      const speakerMaskInputIndex = inputNames.indexOf('speaker_embedding_mask');\n      const speakerMaskMetadata = Array.isArray(inputMetadata)\n        ? inputMetadata[speakerMaskInputIndex]\n        : inputMetadata?.speaker_embedding_mask;\n      const speakerMaskShape = speakerMaskMetadata?.shape\n        || speakerMaskMetadata?.dimensions\n        || speakerMaskMetadata?.dims;\n      this._speakerEmbeddingMaskShape = Array.isArray(speakerMaskShape)\n        && speakerMaskShape.length > 0\n        && speakerMaskShape.every((dimension) => Number.isInteger(dimension) && dimension > 0)\n        ? speakerMaskShape\n        : [1, 1];\n\n      progress({ stage: 'model', progress: 0.7, message: 'Model loaded.' });",
  "speaker graph metadata",
);

index = replaceOnce(
  index,
  "    // Attach speaker embedding for voice cloning\n    if (speakerEmbedding && speakerEmbedding.length > 0) {\n      feeds.speaker_embedding = new ort.Tensor(\n        'float32',\n        speakerEmbedding,\n        [1, speakerEmbedding.length]\n      );\n      feeds.speaker_embedding_mask = new ort.Tensor(\n        'int64',\n        new BigInt64Array([1n]),\n        [1]\n      );\n    }",
  "    // ManaEvo parity: no caller embedding means the model's built-in Tsukuyomi voice.\n    // A zero vector + mask=0 selects that learned/default path; mask=1 is only\n    // for an explicitly supplied voice-cloning embedding.\n    const sessionInputNames = new Set(this._session.inputNames || []);\n    const hasSpeakerEmbeddingMask = sessionInputNames.has('speaker_embedding_mask');\n    if (this._hasSpeakerEmbedding) {\n      const hasEmbedding = speakerEmbedding && speakerEmbedding.length > 0;\n      const embedding = hasEmbedding\n        ? speakerEmbedding\n        : new Float32Array(this._speakerEmbeddingSize || 256);\n      feeds.speaker_embedding = new ort.Tensor(\n        'float32',\n        embedding,\n        [1, embedding.length]\n      );\n      if (hasSpeakerEmbeddingMask) {\n        feeds.speaker_embedding_mask = new ort.Tensor(\n          'int64',\n          new BigInt64Array([hasEmbedding ? 1n : 0n]),\n          this._speakerEmbeddingMaskShape || [1, 1]\n        );\n      }\n    } else if (speakerEmbedding && speakerEmbedding.length > 0) {\n      feeds.speaker_embedding = new ort.Tensor(\n        'float32',\n        speakerEmbedding,\n        [1, speakerEmbedding.length]\n      );\n      if (hasSpeakerEmbeddingMask) {\n        feeds.speaker_embedding_mask = new ort.Tensor(\n          'int64',\n          new BigInt64Array([1n]),\n          this._speakerEmbeddingMaskShape || [1, 1]\n        );\n      }\n    }",
  "built-in speaker selection",
);

index = replaceOnce(
  index,
  "    if (prosodyFeatures && this._config.prosody_id_map) {",
  "    if (prosodyFeatures && this._config.prosody_id_map && this._hasProsodyFeatures) {",
  "prosody graph guard",
);

index = replaceOnce(
  index,
  "    const audio = new Float32Array(audioTensor.data);",
  "    const audio = audioTensor.data instanceof Float32Array\n      ? audioTensor.data\n      : new Float32Array(audioTensor.data);",
  "audio no-copy",
);

index = replaceOnce(
  index,
  "      durations = new Float32Array(results.durations.data);",
  "      durations = results.durations.data instanceof Float32Array\n        ? results.durations.data\n        : new Float32Array(results.durations.data);",
  "duration no-copy",
);

writeFileSync(INDEX_PATH, index);

let sessionManager = readFileSync(SESSION_PATH, "utf8");
sessionManager = replaceOnce(
  sessionManager,
  "        const options = {\n          executionProviders: [provider],\n          graphOptimizationLevel: 'extended',\n          enableMemPattern: true,\n        };",
  "        const ua = globalThis.navigator?.userAgent || '';\n        const platform = globalThis.navigator?.platform || '';\n        const appleTouchDevice = /iPad|iPhone|iPod/.test(ua)\n          || (platform === 'MacIntel' && globalThis.navigator?.maxTouchPoints > 1);\n        const options = {\n          executionProviders: [provider],\n          graphOptimizationLevel: 'extended',\n          enableMemPattern: !appleTouchDevice,\n          enableCpuMemArena: !appleTouchDevice,\n          executionMode: 'sequential',\n        };",
  "iOS session memory policy",
);
writeFileSync(SESSION_PATH, sessionManager);

console.log("Applied ManaEvo Piper Plus 0.6.0 Tsukuyomi runtime patch.");
