// Test-build stand-in for the on-device matching model (the real one downloads 158 MB). It favours
// the option whose name appears in a fixed phrase table, so extension tests are deterministic.
const PHRASES = { 'company story': 'About us', 'reach the shop': 'Contact' };
export async function loadAssistantModel(progress) {
  progress(1, 2); progress(2, 2);
  return {
    async decide(state, _question, options) {
      const wanted = Object.entries(PHRASES).find(([phrase]) => state.includes(phrase))?.[1];
      const raw = options.map(option => (wanted && option.includes(`"${wanted}"`) ? 50 : 1));
      const sum = raw.reduce((a, b) => a + b, 0);
      return { probs: raw.map(value => value / sum) };
    },
    async yes() { return 0; },
  };
}
