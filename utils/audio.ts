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
    private audioElement: HTMLAudioElement | null = null;
    private audioSource: MediaElementAudioSourceNode | null = null;
    private currentFilename: string | null = null;
    private currentObjectUrl: string | null = null;
    private stopTimeout: any = null;

    constructor() {
        this.context = getAudioContext();
    }

    async loadAudioFile(file: File | FileSystemFileHandle): Promise<void> {
        const f = file instanceof File ? file : await (file as FileSystemFileHandle).getFile();
        if (this.currentFilename === f.name && this.audioElement) return;

        this.currentFilename = f.name;

        if (this.currentObjectUrl) {
            URL.revokeObjectURL(this.currentObjectUrl);
        }

        if (this.audioSource) {
            this.audioSource.disconnect();
            this.audioSource = null;
        }

        this.currentObjectUrl = URL.createObjectURL(f);
        this.audioElement = new Audio();
        this.audioElement.src = this.currentObjectUrl;

        this.audioSource = this.context.createMediaElementSource(this.audioElement);
    }

    stop() {
        if (this.audioElement) {
            this.audioElement.pause();
        }
        if (this.stopTimeout) {
            clearTimeout(this.stopTimeout);
            this.stopTimeout = null;
        }
        if (this.audioSource) {
            try { this.audioSource.disconnect(); } catch (e) { }
        }
    }

    async playSubRegion(options: AudioPlayOptions) {
        if (!this.audioElement || !this.audioSource) return;

        // Ensure context is resumed (browser requirement)
        if (this.context.state === 'suspended') {
            await this.context.resume();
        }

        this.stop();

        // Bandpass Filter
        const minFreq = options.minFreq ?? 500;
        const maxFreq = options.maxFreq ?? 12000;

        const highpass = this.context.createBiquadFilter();
        highpass.type = 'highpass';
        highpass.frequency.value = minFreq;

        const lowpass = this.context.createBiquadFilter();
        lowpass.type = 'lowpass';
        lowpass.frequency.value = maxFreq;

        this.audioSource.connect(highpass);
        highpass.connect(lowpass);
        lowpass.connect(this.context.destination);

        const offsetSeconds = options.startTimeMs / 1000;
        const durationSeconds = options.durationMs / 1000;

        this.audioElement.currentTime = offsetSeconds;

        try {
            await this.audioElement.play();

            this.stopTimeout = setTimeout(() => {
                this.audioElement?.pause();
            }, durationSeconds * 1000);
        } catch (e) {
            console.error("Audio playback failed", e);
        }
    }
}
