/**
 * Spoken acknowledgements with the browser's speech synthesis, in Swedish,
 * like an officer of the watch repeating an order ("Djup trettiotvå, ja").
 * Silent if the device has no Swedish voice or no speech synthesis.
 */
export class Voice {
  enabled = false;
  private voice: SpeechSynthesisVoice | null = null;

  constructor() {
    if (!this.available) return;
    const pick = () => {
      const voices = speechSynthesis.getVoices();
      this.voice = voices.find((v) => v.lang === 'sv-SE') ?? voices.find((v) => v.lang.startsWith('sv')) ?? null;
    };
    pick();
    speechSynthesis.addEventListener('voiceschanged', pick);
  }

  get available(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  /** True when a Swedish voice is installed. */
  get hasSwedish(): boolean {
    return this.voice !== null;
  }

  /** Speaks the text, replacing anything still being said (latest order wins). */
  say(text: string): void {
    if (!this.enabled || !this.available || !this.voice) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.voice = this.voice;
    u.lang = this.voice.lang;
    u.rate = 1.1;
    speechSynthesis.speak(u);
  }

  stop(): void {
    if (this.available) speechSynthesis.cancel();
  }
}

/**
 * What to say for a log line, or null. Spoken: the player's own orders,
 * alarms (grounding, water over the bridge, emergency blow, the keel
 * warning) and scenario results. Not spoken: the assistant's routine
 * orders, typing errors and long help texts.
 */
export function speechFor(text: string, kind: 'ack' | 'error' | 'info', source?: string): string | null {
  if (kind === 'ack') return source === 'assist' ? null : text;
  if (kind === 'error') {
    // Refused orders and typing errors are shown, not read; alarms and failures are read.
    if (source === 'console' || source === 'keyboard' || source === 'touch') return null;
    return firstSentence(text);
  }
  if (/^Mål klart|^Uppdraget slutfört/.test(text)) return firstSentence(text.split(':')[0]!);
  return null;
}

const firstSentence = (text: string): string => text.split(/[.!]\s/)[0]!.replace(/[.!]$/, '');
