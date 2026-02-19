/**
 * Audio Context Singleton
 */
let audioCtx: AudioContext | null = null;
const getAudioContext = () => {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return audioCtx;
};

export interface AudioPlayOptions {
    startTimeMs: number;
    durationMs: number;
    minFreq?: number;
    maxFreq?: number;
}

/**
 * Parses the filename to extract the start time in milliseconds.
 * Format: ..._t<time>...
 * Example: Bridge2958_20200706$070000_ch1_w000001_t5000.png -> 5000
 */
export const extractStartTimeFromFilename = (filename: string): number => {
    const match = filename.match(/t(\d+)/);
    if (match && match[1]) {
        return parseInt(match[1], 10);
    }
    return 0;
};

/**
 * Extracts the base name for the audio file.
 * Example: Bridge2958_20200706$070000_ch1_w000000_t0.png 
 * matches to Bridge2958_20200706$070000.wav (based on prefix assumption from user)
 * Actually user said: "audio file name is Bridge2958_20200706$070000.wav"
 * So we need to strip _ch1_w000000_t0.png
 */
export const getAudioFilename = (imageName: string): string => {
    // Logic: Split by _ch1 or the first segment that looks like the variable part?
    // User example: Bridge2958_20200706$070000_ch1_w000000_t0.png
    // Audio: Bridge2958_20200706$070000.wav
    // It seems like we split by `_ch`.
    const parts = imageName.split(/_(ch\d+|w\d+|t\d+)/);
    if (parts.length > 0) {
        // Reconstruct the base if needed, or just take the first part if it's clean
        // Bridge2958_20200706$070000 is the first part before _ch1...
        return `${parts[0]}.wav`;
    }
    return imageName.replace('.png', '.wav'); // Fallback
};

export class AudioPlayer {
    private context: AudioContext;
    private audioBuffer: AudioBuffer | null = null;
    private currentSource: AudioBufferSourceNode | null = null;
    private currentFilename: string | null = null;

    constructor() {
        this.context = getAudioContext();
    }

    async loadAudioFile(file: File | FileSystemFileHandle): Promise<void> {
        const f = file instanceof File ? file : await (file as FileSystemFileHandle).getFile();
        if (this.currentFilename === f.name && this.audioBuffer) return;

        this.currentFilename = f.name;
        const arrayBuffer = await f.arrayBuffer();
        this.audioBuffer = await this.context.decodeAudioData(arrayBuffer);
    }

    stop() {
        if (this.currentSource) {
            try {
                this.currentSource.stop();
            } catch (e) {
                // ignore
            }
            this.currentSource = null;
        }
    }

    async playSubRegion(options: AudioPlayOptions) {
        if (!this.audioBuffer) return;

        // Ensure context is resumed (browser requirement)
        if (this.context.state === 'suspended') {
            await this.context.resume();
        }

        this.stop();

        const source = this.context.createBufferSource();
        source.buffer = this.audioBuffer;

        // Bandpass Filter
        const minFreq = options.minFreq ?? 500;
        const maxFreq = options.maxFreq ?? 12000;

        const highpass = this.context.createBiquadFilter();
        highpass.type = 'highpass';
        highpass.frequency.value = minFreq;

        const lowpass = this.context.createBiquadFilter();
        lowpass.type = 'lowpass';
        lowpass.frequency.value = maxFreq;

        source.connect(highpass);
        highpass.connect(lowpass);
        lowpass.connect(this.context.destination);

        const offsetSeconds = options.startTimeMs / 1000;
        const durationSeconds = options.durationMs / 1000;

        source.start(0, offsetSeconds, durationSeconds);
        this.currentSource = source;
    }
}
