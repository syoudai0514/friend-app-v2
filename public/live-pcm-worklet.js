class LivePcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sourceRate = 24000;
    this.startBufferMs = 220;
    this.capacity = 24000 * 40;
    this.ring = new Float32Array(this.capacity);
    this.readIndex = 0;
    this.writeIndex = 0;
    this.available = 0;
    this.phase = 0;
    this.started = false;
    this.ended = false;
    this.underrunReported = false;
    this.levelCounter = 0;
    this.port.onmessage = (event) => this.handleMessage(event.data);
  }

  reset() {
    this.readIndex = 0;
    this.writeIndex = 0;
    this.available = 0;
    this.phase = 0;
    this.started = false;
    this.ended = false;
    this.underrunReported = false;
    this.port.postMessage({ type: "flushed" });
  }

  handleMessage(message) {
    if (!message || typeof message !== "object") return;
    if (message.type === "configure") {
      if (Number.isFinite(message.sourceRate) && message.sourceRate > 4000) {
        this.sourceRate = message.sourceRate;
      }
      if (Number.isFinite(message.startBufferMs) && message.startBufferMs >= 80) {
        this.startBufferMs = Math.min(600, message.startBufferMs);
      }
      return;
    }
    if (message.type === "flush") {
      this.reset();
      return;
    }
    if (message.type === "end") {
      this.ended = true;
      return;
    }
    if (message.type !== "pcm" || !(message.samples instanceof ArrayBuffer)) return;

    const samples = new Float32Array(message.samples);
    if (samples.length >= this.capacity) {
      const tail = samples.subarray(samples.length - this.capacity + 1);
      this.reset();
      for (let i = 0; i < tail.length; i += 1) {
        this.ring[this.writeIndex] = tail[i];
        this.writeIndex = (this.writeIndex + 1) % this.capacity;
        this.available += 1;
      }
      this.port.postMessage({ type: "overflow" });
      return;
    }

    const free = this.capacity - this.available;
    if (samples.length > free) {
      const discard = samples.length - free;
      this.readIndex = (this.readIndex + discard) % this.capacity;
      this.available -= discard;
      this.port.postMessage({ type: "overflow" });
    }
    for (let i = 0; i < samples.length; i += 1) {
      this.ring[this.writeIndex] = samples[i];
      this.writeIndex = (this.writeIndex + 1) % this.capacity;
      this.available += 1;
    }
  }

  process(_inputs, outputs) {
    const output = outputs[0]?.[0];
    if (!output) return true;
    output.fill(0);

    const startThreshold = Math.max(2, Math.round(this.sourceRate * this.startBufferMs / 1000));
    if (!this.started && this.available >= startThreshold) {
      this.started = true;
      this.underrunReported = false;
      this.port.postMessage({ type: "started", bufferedSamples: this.available });
    }

    if (!this.started) {
      if (this.ended && this.available > 1) {
        this.started = true;
        this.port.postMessage({ type: "started", bufferedSamples: this.available });
      } else {
        return true;
      }
    }

    const ratio = this.sourceRate / sampleRate;
    let sumSquares = 0;
    let written = 0;

    for (let frame = 0; frame < output.length; frame += 1) {
      if (this.available < 2) {
        if (this.ended) {
          if (this.started) {
            this.started = false;
            this.port.postMessage({ type: "drained" });
          }
        } else if (!this.underrunReported) {
          this.underrunReported = true;
          this.port.postMessage({ type: "underrun" });
        }
        break;
      }

      const nextIndex = (this.readIndex + 1) % this.capacity;
      const sample = this.ring[this.readIndex] +
        (this.ring[nextIndex] - this.ring[this.readIndex]) * this.phase;
      output[frame] = sample;
      sumSquares += sample * sample;
      written += 1;

      this.phase += ratio;
      while (this.phase >= 1 && this.available > 1) {
        this.phase -= 1;
        this.readIndex = (this.readIndex + 1) % this.capacity;
        this.available -= 1;
      }
    }

    if (written > 0) {
      this.underrunReported = false;
      this.levelCounter += 1;
      if (this.levelCounter >= 4) {
        this.levelCounter = 0;
        const rms = Math.sqrt(sumSquares / written);
        this.port.postMessage({ type: "level", level: Math.min(1, rms * 5) });
      }
    }
    return true;
  }
}

registerProcessor("live-pcm-player", LivePcmProcessor);
