/**
 * PCM Player Processor Worklet - Optimized Version
 * Based on Deepgram's approach but with efficient read index instead of shift()
 * 
 * Key improvement: Uses read index instead of array.shift() which is O(n)
 * This prevents performance degradation on large buffers
 */

class PCMPlayerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = [];
    this.readIndex = 0;  // Track read position instead of shifting
    this.isPlaying = false;
    this.MIN_BUFFER_TO_START = 24000 * 0.3; // 0.3 seconds before starting
    this.logCounter = 0;
    this.COMPACT_THRESHOLD = 48000; // Compact buffer when 2 seconds have been read
    
    this.port.onmessage = (event) => {
      // Handle clear command for barge-in (user interruption)
      if (event.data === 'clear') {
        const wasPlaying = this.isPlaying;
        const clearedSamples = this.buffer.length - this.readIndex;
        this.buffer = [];
        this.readIndex = 0;
        this.isPlaying = false;
        console.log(`[PCMProcessor] 🛑 Buffer cleared (barge-in) - cleared ${clearedSamples} samples, was playing: ${wasPlaying}`);
        return;
      }
      
      // Push all incoming samples to buffer
      const samples = event.data;
      for (let i = 0; i < samples.length; i++) {
        this.buffer.push(samples[i]);
      }
      
      // Start playback once we have enough buffered
      const availableSamples = this.buffer.length - this.readIndex;
      if (!this.isPlaying && availableSamples >= this.MIN_BUFFER_TO_START) {
        this.isPlaying = true;
        console.log('[PCMProcessor] ✅ Playback started (pre-buffer filled)');
      }
      
      // Compact buffer periodically to prevent memory growth
      // Only remove already-read samples
      if (this.readIndex > this.COMPACT_THRESHOLD) {
        this.buffer = this.buffer.slice(this.readIndex);
        this.readIndex = 0;
      }
      
      // Periodic logging (every 50 messages ≈ 1 second)
      this.logCounter++;
      if (this.logCounter % 50 === 0) {
        const seconds = (availableSamples / 24000).toFixed(2);
        console.log(`[PCMProcessor] Buffer: ${seconds}s | Pending: ${availableSamples}`);
      }
    };
  }

  process(inputs, outputs) {
    const output = outputs[0];
    const channel = output[0];

    // If not playing yet, output silence
    if (!this.isPlaying) {
      channel.fill(0);
      return true;
    }

    // Fill output with buffered samples using read index (O(1) per sample)
    for (let i = 0; i < channel.length; i++) {
      if (this.readIndex < this.buffer.length) {
        channel[i] = this.buffer[this.readIndex];
        this.readIndex++;
      } else {
        channel[i] = 0; // Silence on underrun
      }
    }

    return true;
  }
}

registerProcessor('pcm-player-processor', PCMPlayerProcessor);
