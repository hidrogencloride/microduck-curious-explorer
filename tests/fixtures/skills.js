/** Example inventory for the practice field, not a discovered robot inventory. */
export const FIXTURE_SKILLS = Object.freeze([
  Object.freeze({
    id: 'custom-gait',
    name: 'Custom walking style',
    label: 'Custom walking style',
    description: 'An example owner-installed gait. Explorer leaves it in place.',
    kind: 'gait',
    preview: true,
  }),
  Object.freeze({
    id: 'polite-bow',
    name: 'Polite bow',
    label: 'Polite bow',
    description: 'An example greeting skill. Used only with your permission.',
    kind: 'skill',
    role: 'greeting',
    preview: true,
  }),
]);
